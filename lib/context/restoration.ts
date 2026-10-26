/**
 * Session context restoration - remember what user was working on
 * 
 * Stores:
 * - Recent focus items (emails, tasks, events, files)
 * - Conversation summary
 * - Active projects/contexts
 * - Last accessed resources
 */

import fs from 'fs'
import path from 'path'

export interface SessionContext {
  sessionId: string
  createdAt: number
  lastActivity: number
  
  // What the user was working on
  activeItems: {
    email?: { id: string; subject: string; from: string }
    task?: { id: string; title: string; status: string }
    event?: { id: string; title: string; time: string }
    file?: { id: string; name: string; path: string }
    issue?: { number: number; title: string; repo: string }
  }
  
  // Conversation context
  conversationSummary?: string
  recentTopics: string[]
  
  // Resources accessed
  recentResources: Array<{
    type: 'email' | 'task' | 'event' | 'file' | 'issue' | 'snippet'
    id: string
    title: string
    timestamp: number
  }>
  
  // User preferences for this session
  preferences: {
    defaultTaskList?: string
    defaultCalendar?: string
    focusMode?: boolean
  }
}

const sessionStates = new Map<string, SessionContext>()

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function contextFile(sessionId: string): string {
  return path.join(configDir(), 'context', `${sessionId}.json`)
}

function ensureContextDir(): void {
  const dir = path.join(configDir(), 'context')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function defaultContext(sessionId: string): SessionContext {
  return {
    sessionId,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    activeItems: {},
    recentTopics: [],
    recentResources: [],
    preferences: {},
  }
}

export function getSessionContext(sessionId: string): SessionContext {
  // Try in-memory first
  if (sessionStates.has(sessionId)) {
    return sessionStates.get(sessionId)!
  }

  // Try disk
  try {
    const file = contextFile(sessionId)
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      sessionStates.set(sessionId, data)
      return data
    }
  } catch (err) {
    console.error('Failed to load session context:', err)
  }

  // Create new
  const ctx = defaultContext(sessionId)
  sessionStates.set(sessionId, ctx)
  return ctx
}

export function saveSessionContext(ctx: SessionContext): void {
  sessionStates.set(ctx.sessionId, ctx)
  
  // Persist to disk
  try {
    ensureContextDir()
    const file = contextFile(ctx.sessionId)
    fs.writeFileSync(file, JSON.stringify(ctx, null, 2), 'utf-8')
  } catch (err) {
    console.error('Failed to save session context:', err)
  }
}

export function setActiveEmail(sessionId: string, email: { id: string; subject: string; from: string }): void {
  const ctx = getSessionContext(sessionId)
  ctx.activeItems.email = email
  ctx.lastActivity = Date.now()
  addRecentResource(sessionId, 'email', email.id, email.subject)
  saveSessionContext(ctx)
}

export function setActiveTask(sessionId: string, task: { id: string; title: string; status: string }): void {
  const ctx = getSessionContext(sessionId)
  ctx.activeItems.task = task
  ctx.lastActivity = Date.now()
  addRecentResource(sessionId, 'task', task.id, task.title)
  saveSessionContext(ctx)
}

export function setActiveEvent(sessionId: string, event: { id: string; title: string; time: string }): void {
  const ctx = getSessionContext(sessionId)
  ctx.activeItems.event = event
  ctx.lastActivity = Date.now()
  addRecentResource(sessionId, 'event', event.id, event.title)
  saveSessionContext(ctx)
}

export function setActiveFile(sessionId: string, file: { id: string; name: string; path: string }): void {
  const ctx = getSessionContext(sessionId)
  ctx.activeItems.file = file
  ctx.lastActivity = Date.now()
  addRecentResource(sessionId, 'file', file.id, file.name)
  saveSessionContext(ctx)
}

export function setActiveIssue(sessionId: string, issue: { number: number; title: string; repo: string }): void {
  const ctx = getSessionContext(sessionId)
  ctx.activeItems.issue = issue
  ctx.lastActivity = Date.now()
  addRecentResource(sessionId, 'issue', `${issue.repo}#${issue.number}`, issue.title)
  saveSessionContext(ctx)
}

function addRecentResource(
  sessionId: string,
  type: 'email' | 'task' | 'event' | 'file' | 'issue' | 'snippet',
  id: string,
  title: string
): void {
  const ctx = getSessionContext(sessionId)
  
  // Remove if already exists (move to top)
  ctx.recentResources = ctx.recentResources.filter(r => !(r.type === type && r.id === id))
  
  // Add to top
  ctx.recentResources.unshift({
    type,
    id,
    title,
    timestamp: Date.now(),
  })
  
  // Keep last 20
  ctx.recentResources = ctx.recentResources.slice(0, 20)
}

export function addTopic(sessionId: string, topic: string): void {
  const ctx = getSessionContext(sessionId)
  
  if (!ctx.recentTopics.includes(topic)) {
    ctx.recentTopics.unshift(topic)
    ctx.recentTopics = ctx.recentTopics.slice(0, 10)
  }
  
  ctx.lastActivity = Date.now()
  saveSessionContext(ctx)
}

export function setConversationSummary(sessionId: string, summary: string): void {
  const ctx = getSessionContext(sessionId)
  ctx.conversationSummary = summary
  ctx.lastActivity = Date.now()
  saveSessionContext(ctx)
}

export function getRecentResources(sessionId: string, limit: number = 5): SessionContext['recentResources'] {
  const ctx = getSessionContext(sessionId)
  return ctx.recentResources.slice(0, limit)
}

export function getSuggestions(sessionId: string): {
  topics: string[]
  resources: SessionContext['recentResources']
  summary?: string
} {
  const ctx = getSessionContext(sessionId)
  
  return {
    topics: ctx.recentTopics.slice(0, 5),
    resources: ctx.recentResources.slice(0, 5),
    summary: ctx.conversationSummary,
  }
}

export function clearSessionContext(sessionId: string): void {
  sessionStates.delete(sessionId)
  
  try {
    const file = contextFile(sessionId)
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
  } catch (err) {
    console.error('Failed to clear session context:', err)
  }
}

/**
 * Restore previous session context when user resumes
 */
export function restorePreviousSession(): SessionContext | null {
  try {
    ensureContextDir()
    const dir = path.join(configDir(), 'context')
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    
    if (files.length === 0) return null
    
    // Sort by modification time (newest first)
    const sorted = files
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time)
    
    const latest = sorted[0]
    const data = JSON.parse(fs.readFileSync(path.join(dir, latest.name), 'utf-8'))
    
    // Only restore if within last 24 hours
    if (Date.now() - data.lastActivity < 24 * 60 * 60 * 1000) {
      return data
    }
  } catch (err) {
    console.error('Failed to restore previous session:', err)
  }
  
  return null
}
