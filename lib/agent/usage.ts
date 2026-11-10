import fs from 'fs'
import path from 'path'
import { configDir } from './providers'
import type { ChatMessage } from './types'

/**
 * Token usage ledger: daily totals per provider, from the counts providers
 * report (OpenAI-style `usage`, Ollama `prompt_eval_count`/`eval_count`).
 * When a provider reports nothing, an estimate (~4 chars/token) is recorded
 * and flagged, so totals never silently read zero.
 *
 * Stored in .hermione/usage.json, last 31 days.
 */

export interface UsageTotals {
  input: number
  output: number
  calls: number
  /** Calls whose numbers are estimates (provider reported nothing). */
  estimatedCalls: number
}

interface Ledger {
  days: Record<string, Record<string, UsageTotals>>
}

const KEEP_DAYS = 31

function file(): string {
  return path.join(configDir(), 'usage.json')
}

function today(): string {
  // Local calendar day — "today" should match the operator's clock.
  return new Date().toLocaleDateString('en-CA')
}

function read(): Ledger {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf-8'))
    return data && typeof data.days === 'object' ? data : { days: {} }
  } catch {
    return { days: {} }
  }
}

function write(ledger: Ledger) {
  const keep = Object.keys(ledger.days).sort().slice(-KEEP_DAYS)
  ledger.days = Object.fromEntries(keep.map((d) => [d, ledger.days[d]]))
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(file(), `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8')
  } catch {
    /* usage is informational */
  }
}

export function recordUsage(providerId: string, input: number, output: number, estimated: boolean) {
  const ledger = read()
  const day = (ledger.days[today()] ??= {})
  const row = (day[providerId] ??= { input: 0, output: 0, calls: 0, estimatedCalls: 0 })
  row.input += Math.max(0, Math.round(input))
  row.output += Math.max(0, Math.round(output))
  row.calls += 1
  if (estimated) row.estimatedCalls += 1
  write(ledger)
}

export function usageToday(): { day: string; total: UsageTotals; byProvider: Record<string, UsageTotals> } {
  const day = today()
  const byProvider = read().days[day] ?? {}
  const total = Object.values(byProvider).reduce(
    (t, r) => ({
      input: t.input + r.input,
      output: t.output + r.output,
      calls: t.calls + r.calls,
      estimatedCalls: t.estimatedCalls + r.estimatedCalls,
    }),
    { input: 0, output: 0, calls: 0, estimatedCalls: 0 },
  )
  return { day, total, byProvider }
}

/** ~4 characters per token — only used when the provider reports nothing. */
export function estimateTokens(messages: ChatMessage[], output: string): { input: number; output: number } {
  const chars = messages.reduce((n, m) => n + m.content.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0)
  return { input: Math.ceil(chars / 4), output: Math.ceil(output.length / 4) }
}
