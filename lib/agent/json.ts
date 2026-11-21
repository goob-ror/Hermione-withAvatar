/**
 * Small, forgiving JSON helpers for model output.
 */

/**
 * Fix common LLM JSON slips:
 *   "term" (500+ searches)   → "term (500+ searches)"   (text after a closing quote)
 *   trailing commas before } or ]
 *   smart quotes used as delimiters
 */
export function repairJson(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/"([^"\n]*)"[ \t]*(\([^()\n]*\)|[^\s,:}\]"\n][^,}\]\n"]*?)(?=\s*[,}\]])/g, (_, inner, tail) =>
      JSON.stringify(`${inner} ${String(tail).trim()}`),
    )
    .replace(/,\s*([}\]])/g, '$1')
}

export interface ParsedArgs {
  args: Record<string, any>
  /** Set when the model's arguments could not be understood — report it back instead of guessing. */
  error?: string
  /** What the model actually sent (trimmed), for the error message. */
  raw?: string
}

/**
 * Tool-call arguments as models really send them: a JSON string, an already
 * parsed object (some providers), a double-encoded string, or slightly broken
 * JSON. Never silently turns bad input into `{}` — the caller gets an error to
 * hand back to the model so it can retry.
 */
export function parseToolArgs(raw: unknown): ParsedArgs {
  if (raw === undefined || raw === null || raw === '') return { args: {} }
  if (typeof raw === 'object') {
    return Array.isArray(raw)
      ? { args: {}, error: 'arguments must be a JSON object, got an array', raw: JSON.stringify(raw).slice(0, 500) }
      : { args: raw as Record<string, any> }
  }
  const text = String(raw).trim()
  if (!text) return { args: {} }

  const attempt = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let value = attempt(text) ?? attempt(repairJson(text))
  // Double-encoded: "{\"path\":\".\"}"
  if (typeof value === 'string') value = attempt(value) ?? attempt(repairJson(value))

  if (value && typeof value === 'object' && !Array.isArray(value)) return { args: value as Record<string, any> }
  return {
    args: {},
    error: value === undefined ? 'arguments were not valid JSON' : 'arguments must be a JSON object',
    raw: text.slice(0, 500),
  }
}
