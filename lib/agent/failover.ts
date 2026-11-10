import fs from 'fs'
import path from 'path'
import { configDir, getProvider, listProviders } from './providers'
import { allProviderModels } from './discovery'
import { hiddenReason } from './modelFilter'

/**
 * Provider failover.
 *
 * When a provider says "out of quota / rate limited / no credit", the
 * (provider, model) pair is marked exhausted until the time the provider asks
 * for (or a sensible default), and the caller moves to the next working
 * option: cheaper models on the same provider first, then other online
 * providers — local ones first, since they cost nothing.
 *
 * Exhausted pairs are skipped up front on later turns, so no request is
 * wasted on them. State is persisted to .hermione/exhausted.json.
 */

export type ExhaustKind = 'rate' | 'quota' | 'billing'

interface Mark {
  until: number
  kind: ExhaustKind
  reason: string
}

const RATE_DEFAULT_MS = 60 * 1000
const QUOTA_DEFAULT_MS = 6 * 60 * 60 * 1000
const BILLING_DEFAULT_MS = 24 * 60 * 60 * 1000

let marks: Record<string, Mark> | null = null

function file(): string {
  return path.join(configDir(), 'exhausted.json')
}

function load(): Record<string, Mark> {
  if (marks) return marks
  try {
    marks = JSON.parse(fs.readFileSync(file(), 'utf-8')) || {}
  } catch {
    marks = {}
  }
  return marks!
}

function save() {
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(file(), `${JSON.stringify(load(), null, 2)}\n`, 'utf-8')
  } catch {
    /* memory is enough for this process */
  }
}

const key = (providerId: string, model: string) => `${providerId}::${model}`

/**
 * Classify a provider error. Returns undefined when it is NOT a
 * quota/rate/billing problem (auth errors, bad requests, outages are not
 * failover triggers — a different model would not help or would hide a bug).
 */
export function classifyExhaustion(message: string): ExhaustKind | undefined {
  const m = message.toLowerCase()
  if (/\(402\)|insufficient_quota|credit balance|billing|payment required|insufficient (credits|funds|balance)/.test(m)) {
    return 'billing'
  }
  if (/resource_exhausted|exceeded your current quota|quota (exceeded|exhausted)|daily (limit|quota)|free[- ]tier.*limit|tokens per day|requests per day/.test(m)) {
    return 'quota'
  }
  if (/\(429\)|rate[ _-]?limit|too many requests|tokens per minute|requests per minute/.test(m)) return 'rate'
  return undefined
}

/** "retryDelay": "34s" (Gemini) · "try again in 20s" / "in 1m30s" (OpenAI, Groq) · Retry-After style seconds. */
export function parseRetryMs(message: string): number | undefined {
  const delay = message.match(/"?retry_?delay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i)
  if (delay) return Math.ceil(Number(delay[1]) * 1000)
  const human = message.match(/(?:try again|retry) in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?/i)
  if (human && (human[1] || human[2] || human[3])) {
    return ((Number(human[1] ?? 0) * 60 + Number(human[2] ?? 0)) * 60 + Number(human[3] ?? 0)) * 1000
  }
  return undefined
}

export function markExhausted(providerId: string, model: string, message: string): Mark | undefined {
  const kind = classifyExhaustion(message)
  if (!kind) return undefined
  const fallback = kind === 'rate' ? RATE_DEFAULT_MS : kind === 'quota' ? QUOTA_DEFAULT_MS : BILLING_DEFAULT_MS
  // A provider-supplied retry time wins, but never shorter than 10 s.
  const wait = Math.max(10_000, parseRetryMs(message) ?? fallback)
  const mark: Mark = { until: Date.now() + wait, kind, reason: message.replace(/\s+/g, ' ').slice(0, 200) }
  load()[key(providerId, model)] = mark
  // Billing problems hit every model on the key — mark the whole provider.
  if (kind === 'billing') load()[key(providerId, '*')] = mark
  save()
  return mark
}

export function exhaustedMark(providerId: string, model: string): Mark | undefined {
  const all = load()
  const now = Date.now()
  for (const k of [key(providerId, model), key(providerId, '*')]) {
    const mark = all[k]
    if (mark && mark.until > now) return mark
    if (mark) {
      delete all[k]
      save()
    }
  }
  return undefined
}

export function clearExhausted(providerId?: string) {
  const all = load()
  for (const k of Object.keys(all)) if (!providerId || k.startsWith(`${providerId}::`)) delete all[k]
  save()
}

/* ------------------------------------------------------------------ */
/* Choosing the next option                                            */
/* ------------------------------------------------------------------ */

export interface Candidate {
  providerId: string
  providerLabel: string
  model: string
}

/** Cheap/fast first — whole name segments only ("gemini" must not match "mini"). */
function cheapRank(id: string): number {
  return /(^|[-_.:/])(lite|mini|flash|haiku|small|nano|[1-9]b)([-_.:]|$)/i.test(id) ? 0 : 1
}

/**
 * Next usable (provider, model) after `failed`. Same provider first (other
 * models often have their own quota), then other online providers with
 * local ones before cloud, each provider's remembered model before others.
 */
export async function nextCandidate(failed: { providerId: string; model: string }, tried: Set<string>): Promise<Candidate | null> {
  const groups = await allProviderModels(false).catch(() => [])
  const usable = (providerId: string, model: string) =>
    !tried.has(key(providerId, model)) && !exhaustedMark(providerId, model) && !hiddenReason({}, model, getProvider(providerId).baseUrl)

  const same = groups.find((g) => g.providerId === failed.providerId)
  if (same?.online && !exhaustedMark(failed.providerId, '*')) {
    const pick = same.models
      .map((m) => m.id)
      .filter((id) => usable(same.providerId, id))
      .sort((a, b) => cheapRank(a) - cheapRank(b))[0]
    if (pick) return { providerId: same.providerId, providerLabel: same.label, model: pick }
  }

  const others = groups
    .filter((g) => g.providerId !== failed.providerId && g.online && g.models.length)
    .sort((a, b) => (a.scope === 'local' ? 0 : 1) - (b.scope === 'local' ? 0 : 1))
  for (const g of others) {
    const ids = g.models.map((m) => m.id)
    const ordered = [...(g.defaultModel && ids.includes(g.defaultModel) ? [g.defaultModel] : []), ...ids.sort((a, b) => cheapRank(a) - cheapRank(b))]
    const pick = ordered.find((id) => usable(g.providerId, id))
    if (pick) return { providerId: g.providerId, providerLabel: g.label, model: pick }
  }
  return null
}

export function providerLabel(providerId: string): string {
  return listProviders().find((p) => p.id === providerId)?.label ?? providerId
}

export const failoverKey = key
