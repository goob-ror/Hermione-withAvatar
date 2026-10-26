import type { ChatMessage, ToolCall } from './types'
import { loadSession as loadSessionFromDisk, saveSession as saveSessionToDisk, type SessionData, type SessionMessage } from '@/lib/storage/sessions'

export interface PendingApproval {
  callId: string
  tool: string
  args: Record<string, any>
  /** Remaining calls from the same assistant message, processed after this one. */
  queue: ToolCall[]
  native: boolean
  providerCallId?: string
}

export interface Session {
  id: string
  model: string
  /** Provider this session is pinned to; falls back to the active one. */
  providerId?: string
  messages: ChatMessage[]
  pending?: PendingApproval
  updatedAt: number
  createdAt: number
}

/**
 * In-memory cache with disk persistence.
 * Sessions are saved after each turn and loaded on demand.
 */
const SESSIONS = new Map<string, Session>()
const TTL_MS = 6 * 60 * 60 * 1000

function prune() {
  const cutoff = Date.now() - TTL_MS
  for (const [id, session] of SESSIONS) {
    if (session.updatedAt < cutoff) SESSIONS.delete(id)
  }
}

export function getSession(id: string): Session | undefined {
  prune()
  const cached = SESSIONS.get(id)
  if (cached) return cached
  
  // Try loading from disk
  const stored = loadSessionFromDisk(id)
  if (stored) {
    const session = sessionFromStored(stored)
    SESSIONS.set(id, session)
    return session
  }
  
  return undefined
}

export function ensureSession(id: string, model: string, systemPrompt: string, providerId?: string): Session {
  prune()
  const existing = SESSIONS.get(id) ?? (loadSessionFromDisk(id) ? sessionFromStored(loadSessionFromDisk(id)!) : undefined)
  
  if (existing) {
    existing.model = model
    if (providerId) existing.providerId = providerId
    existing.updatedAt = Date.now()
    if (existing.messages[0]?.role !== 'system') {
      existing.messages.unshift({ role: 'system', content: systemPrompt })
    }
    SESSIONS.set(id, existing)
    return existing
  }
  
  const session: Session = {
    id,
    model,
    providerId,
    messages: [{ role: 'system', content: systemPrompt }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  SESSIONS.set(id, session)
  return session
}

export function resetSession(id: string, model: string, systemPrompt: string, providerId?: string): Session {
  SESSIONS.delete(id)
  return ensureSession(id, model, systemPrompt, providerId)
}

export function touch(session: Session) {
  session.updatedAt = Date.now()
}

export function sessionCount(): number {
  return SESSIONS.size
}

export function persistSession(session: Session): void {
  try {
    const stored = sessionToStored(session)
    saveSessionToDisk(stored)
  } catch (err) {
    console.error('Failed to persist session:', err)
  }
}

// Conversion helpers between Session and SessionData formats

function sessionFromStored(stored: SessionData): Session {
  const messages: ChatMessage[] = [{ role: 'system', content: 'You are Hermione, a helpful AI assistant.' }]
  
  for (const msg of stored.messages) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.text })
    } else if (msg.role === 'agent') {
      messages.push({ role: 'assistant', content: msg.text })
    }
  }
  
  return {
    id: stored.id,
    model: 'hermes',
    providerId: stored.providerId,
    messages,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

function sessionToStored(session: Session): SessionData {
  const messages: SessionMessage[] = []
  let firstUserMessage: string | undefined
  
  for (const msg of session.messages) {
    if (msg.role === 'user') {
      const text = msg.content
      messages.push({ role: 'user', text, time: new Date().toISOString() })
      if (!firstUserMessage) firstUserMessage = text.slice(0, 100)
    } else if (msg.role === 'assistant') {
      messages.push({ 
        role: 'agent', 
        text: msg.content,
        time: new Date().toISOString(),
        modelUsed: session.model 
      })
    }
  }
  
  return {
    id: session.id,
    createdAt: session.createdAt || Date.now(),
    updatedAt: session.updatedAt,
    title: firstUserMessage || 'New conversation',
    messages,
    providerId: session.providerId,
    agentName: 'Hermione',
    metadata: {
      messageCount: messages.length,
      firstMessage: firstUserMessage,
      lastActivity: session.updatedAt,
    },
  }
}
