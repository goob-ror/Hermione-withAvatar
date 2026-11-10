import type { ChatMessage, ToolCall } from './types'
import { loadSession as loadSessionFromDisk, saveSession as saveSessionToDisk, type SessionData, type SessionMessage } from '@/lib/storage/sessions'

export type SessionMode = 'chat' | 'forge'

export function parseMode(value: unknown): SessionMode {
  return value === 'forge' ? 'forge' : 'chat'
}

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
  /** 'chat' = general assistant, 'forge' = Content Forge. Fixed at creation. */
  mode: SessionMode
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

export function ensureSession(
  id: string,
  model: string,
  systemPrompt: string,
  providerId?: string,
  mode: SessionMode = 'chat',
): Session {
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
    mode,
    messages: [{ role: 'system', content: systemPrompt }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  SESSIONS.set(id, session)
  return session
}

export function resetSession(
  id: string,
  model: string,
  systemPrompt: string,
  providerId?: string,
  mode: SessionMode = 'chat',
): Session {
  SESSIONS.delete(id)
  return ensureSession(id, model, systemPrompt, providerId, mode)
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

/** Placeholder; the agent route swaps in the real system prompt on the next turn. */
const RESTORED_SYSTEM = 'You are Hermione.'

/** Tool outputs kept on disk per message — the model only needs the gist of old ones. */
const STORED_TOOL_CHARS = 4000

const isToolResultText = (text: string) => text.startsWith('TOOL RESULT —')

function sessionFromStored(stored: SessionData): Session {
  const messages: ChatMessage[] = [{ role: 'system', content: RESTORED_SYSTEM }]

  if (Array.isArray(stored.history) && stored.history.length) {
    // Full working context: tool calls, tool results, per-message model and time.
    for (const raw of stored.history) {
      const m = raw as unknown as ChatMessage
      if (m && typeof m.content === 'string' && ['user', 'assistant', 'tool'].includes(m.role)) messages.push(m)
    }
  } else {
    // Older files: transcript only.
    for (const msg of stored.messages) {
      const at = Date.parse(msg.time) || undefined
      if (msg.role === 'user') messages.push({ role: 'user', content: msg.text, at })
      else if (msg.role === 'agent') messages.push({ role: 'assistant', content: msg.text, at, model: msg.modelUsed })
    }
  }

  return {
    id: stored.id,
    model: stored.model || 'hermes',
    providerId: stored.providerId,
    mode: parseMode(stored.mode),
    messages,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

function sessionToStored(session: Session): SessionData {
  const messages: SessionMessage[] = []
  let firstUserMessage: string | undefined
  const now = Date.now()

  for (const msg of session.messages) {
    // Stamp once, on first save — later saves keep the original time.
    if (msg.role !== 'system' && !msg.at) msg.at = now
    const time = new Date(msg.at ?? now).toISOString()

    if (msg.role === 'user') {
      // Text-protocol tool results ride as user messages — not part of the transcript.
      if (isToolResultText(msg.content)) continue
      messages.push({ role: 'user', text: msg.content, time })
      if (!firstUserMessage) firstUserMessage = msg.content.slice(0, 100)
    } else if (msg.role === 'assistant') {
      // Frames that only carry a tool call have no visible text.
      if (!msg.content.trim()) continue
      messages.push({ role: 'agent', text: msg.content, time, modelUsed: msg.model ?? session.model })
    }
  }

  const history = session.messages
    .filter((m) => m.role !== 'system')
    .map((m) =>
      (m.role === 'tool' || isToolResultText(m.content)) && m.content.length > STORED_TOOL_CHARS
        ? { ...m, content: `${m.content.slice(0, STORED_TOOL_CHARS)}\n… [trimmed when saved]` }
        : m,
    )

  return {
    id: session.id,
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt,
    title: firstUserMessage || (session.mode === 'forge' ? 'New forge project' : 'New conversation'),
    messages,
    providerId: session.providerId,
    mode: session.mode,
    model: session.model,
    history: history as unknown as Array<Record<string, unknown>>,
    agentName: 'Hermione',
    metadata: {
      messageCount: messages.length,
      firstMessage: firstUserMessage,
      lastActivity: session.updatedAt,
    },
  }
}
