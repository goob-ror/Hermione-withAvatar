import fs from 'fs'
import path from 'path'

/**
 * Session persistence: stores conversation history, agent memory, and configuration.
 * 
 * Structure:
 * .hermione/
 *   sessions/
 *     2026-10-25/
 *       session-uuid.json  # Individual session files
 *     index.json           # Session metadata index
 *   memory/
 *     profile.json         # Hermione's persistent profile
 *     knowledge.json       # Long-term knowledge base
 *     preferences.json     # User preferences
 */

export interface SessionMessage {
  role: 'user' | 'agent'
  text: string
  thinkingText?: string
  time: string
  modelUsed?: string
}

export interface SessionData {
  id: string
  createdAt: number
  updatedAt: number
  title: string
  messages: SessionMessage[]
  providerId?: string
  agentName: string
  metadata: {
    messageCount: number
    firstMessage?: string
    lastActivity: number
  }
}

export interface AgentProfile {
  name: string
  personality: string
  createdAt: number
  updatedAt: number
  conversationCount: number
  totalMessages: number
  memories: string[] // Key facts about user and context
  skills: string[] // Topics the agent has learned
}

function storageDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function sessionsDir(): string {
  return path.join(storageDir(), 'sessions')
}

function memoryDir(): string {
  return path.join(storageDir(), 'memory')
}

function sessionFile(sessionId: string, date: string): string {
  const dateDir = path.join(sessionsDir(), date)
  return path.join(dateDir, `${sessionId}.json`)
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// Session CRUD

export function saveSession(session: SessionData): void {
  const date = new Date(session.createdAt).toISOString().split('T')[0]
  const dateDir = path.join(sessionsDir(), date)
  ensureDir(dateDir)
  
  const file = sessionFile(session.id, date)
  fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8')
}

export function loadSession(sessionId: string, date?: string): SessionData | null {
  try {
    // If date provided, load directly
    if (date) {
      const file = sessionFile(sessionId, date)
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
      }
      return null
    }

    // Otherwise search recent dates
    const sessionsRoot = sessionsDir()
    if (!fs.existsSync(sessionsRoot)) return null

    const dates = fs.readdirSync(sessionsRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
    
    for (const d of dates.slice(0, 30)) { // Check last 30 days
      const file = sessionFile(sessionId, d)
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
      }
    }

    return null
  } catch (err) {
    console.error('Failed to load session:', err)
    return null
  }
}

export function listRecentSessions(limit = 20): SessionData[] {
  try {
    const sessionsRoot = sessionsDir()
    if (!fs.existsSync(sessionsRoot)) return []

    const dates = fs.readdirSync(sessionsRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
    const sessions: SessionData[] = []

    for (const date of dates) {
      const dateDir = path.join(sessionsRoot, date)
      const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))
      
      for (const file of files) {
        if (sessions.length >= limit) return sessions
        
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dateDir, file), 'utf-8'))
          sessions.push(data)
        } catch {
          // Skip corrupted files
        }
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (err) {
    console.error('Failed to list sessions:', err)
    return []
  }
}

export function deleteSession(sessionId: string): boolean {
  try {
    const sessionsRoot = sessionsDir()
    if (!fs.existsSync(sessionsRoot)) return false

    const dates = fs.readdirSync(sessionsRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    
    for (const date of dates) {
      const file = sessionFile(sessionId, date)
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        return true
      }
    }

    return false
  } catch (err) {
    console.error('Failed to delete session:', err)
    return false
  }
}

// Agent profile & memory

export function loadAgentProfile(): AgentProfile {
  const file = path.join(memoryDir(), 'profile.json')
  
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load agent profile:', err)
  }

  // Default profile
  return {
    name: 'Hermione',
    personality: 'Analytical, curious, and supportive AI assistant',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    conversationCount: 0,
    totalMessages: 0,
    memories: [],
    skills: [],
  }
}

export function saveAgentProfile(profile: AgentProfile): void {
  ensureDir(memoryDir())
  const file = path.join(memoryDir(), 'profile.json')
  profile.updatedAt = Date.now()
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf-8')
}

export function addMemory(memory: string): void {
  const profile = loadAgentProfile()
  if (!profile.memories.includes(memory)) {
    profile.memories.push(memory)
    saveAgentProfile(profile)
  }
}

export function addSkill(skill: string): void {
  const profile = loadAgentProfile()
  if (!profile.skills.includes(skill)) {
    profile.skills.push(skill)
    saveAgentProfile(profile)
  }
}

export function updateConversationStats(messageCount: number): void {
  const profile = loadAgentProfile()
  profile.conversationCount += 1
  profile.totalMessages += messageCount
  saveAgentProfile(profile)
}
