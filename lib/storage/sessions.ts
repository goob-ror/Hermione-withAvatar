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
  /** Which flow the session belongs to. Missing on older files = 'chat'. */
  mode?: 'chat' | 'forge'
  /** Model the session last ran on. */
  model?: string
  /**
   * The model-facing history (assistant tool calls + tool results), minus the
   * system prompt — so a resumed session keeps its working context. Long tool
   * outputs are trimmed on disk. Missing on older files.
   */
  history?: Array<Record<string, unknown>>
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

    // Folders are named by creation date, but a session's *last activity* can be
    // much later — so read the recent folders fully, sort by activity, THEN cut.
    // (Stopping at `limit` while reading used to drop the most recent sessions.)
    const dates = fs.readdirSync(sessionsRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
    const sessions: SessionData[] = []

    for (const date of dates.slice(0, 60)) {
      const dateDir = path.join(sessionsRoot, date)
      const files = fs.readdirSync(dateDir).filter(f => f.endsWith('.json'))

      for (const file of files) {
        try {
          sessions.push(JSON.parse(fs.readFileSync(path.join(dateDir, file), 'utf-8')))
        } catch {
          // Skip corrupted files
        }
      }
    }

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
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
