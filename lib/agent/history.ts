import type { ChatMessage } from './types'

/**
 * What actually gets sent to the model each round.
 *
 * The session keeps the full history (for persistence and the UI); the model
 * gets a compacted copy, because every round re-sends everything:
 *
 *  - the system prompt, always;
 *  - the last KEEP_EXCHANGES exchanges (an exchange = one operator message and
 *    everything after it) — tool calls stay paired with their results, which
 *    OpenAI-style APIs require;
 *  - inside those, tool outputs older than FULL_TOOL_EXCHANGES exchanges are
 *    cut to a short excerpt (a fetched page is huge and rarely needed again);
 *  - anything older collapses into a one-line-per-request summary appended to
 *    the system prompt — extractive, so it costs no extra model call.
 *
 * Text-protocol tool results arrive as `user` messages starting with
 * "TOOL RESULT —"; they are treated as tool output, not as new exchanges.
 */

const KEEP_EXCHANGES = 6
const FULL_TOOL_EXCHANGES = 2
const OLD_TOOL_CHARS = 600
const OLD_ASSISTANT_CHARS = 1500
const SUMMARY_LINE_CHARS = 160
const SUMMARY_MAX_LINES = 20

function isTextToolResult(m: ChatMessage): boolean {
  return m.role === 'user' && m.content.startsWith('TOOL RESULT —')
}

function isExchangeStart(m: ChatMessage): boolean {
  return m.role === 'user' && !isTextToolResult(m)
}

function excerpt(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… [trimmed ${text.length - max} chars from an earlier step to save tokens]`
}

export function compactHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 2) return messages
  const [first, ...rest] = messages
  const system = first.role === 'system' ? first : undefined
  const body = system ? rest : messages

  const starts = body.map((m, i) => (isExchangeStart(m) ? i : -1)).filter((i) => i >= 0)
  if (starts.length <= FULL_TOOL_EXCHANGES && !system) return messages

  const keepFrom = starts.length > KEEP_EXCHANGES ? starts[starts.length - KEEP_EXCHANGES] : 0
  const fullToolsFrom = starts.length > FULL_TOOL_EXCHANGES ? starts[starts.length - FULL_TOOL_EXCHANGES] : 0

  // Older exchanges → short summary of what the operator asked and how it went.
  const older = body.slice(0, keepFrom)
  const summary: string[] = []
  for (let i = 0; i < older.length; i++) {
    const m = older[i]
    if (!isExchangeStart(m)) continue
    const ask = m.content.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_LINE_CHARS)
    const reply = older.slice(i + 1).find((n) => n.role === 'assistant' && n.content && !n.tool_calls?.length)
    const answer = reply ? ` → ${reply.content.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_LINE_CHARS)}` : ''
    summary.push(`- ${ask}${answer}`)
  }

  const kept = body.slice(keepFrom).map((m, idx) => {
    const absolute = keepFrom + idx
    if (absolute >= fullToolsFrom) return m
    if (m.role === 'tool') return { ...m, content: excerpt(m.content, OLD_TOOL_CHARS) }
    if (isTextToolResult(m)) return { ...m, content: excerpt(m.content, OLD_TOOL_CHARS) }
    if (m.role === 'assistant' && m.content.length > OLD_ASSISTANT_CHARS) {
      return { ...m, content: excerpt(m.content, OLD_ASSISTANT_CHARS) }
    }
    return m
  })

  const out: ChatMessage[] = []
  if (system) {
    const tail = summary.slice(-SUMMARY_MAX_LINES)
    out.push(
      tail.length
        ? {
            ...system,
            content: `${system.content}\n\nEarlier in this conversation (summary of ${summary.length} older request${
              summary.length === 1 ? '' : 's'
            }):\n${tail.join('\n')}`,
          }
        : system,
    )
  }
  out.push(...kept)
  return out
}

/** Rough size, for logging/tests: ~4 chars per token. */
export function approxTokens(messages: ChatMessage[]): number {
  return Math.round(messages.reduce((n, m) => n + m.content.length + JSON.stringify(m.tool_calls ?? '').length, 0) / 4)
}
