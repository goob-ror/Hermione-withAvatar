import fs from 'fs'
import path from 'path'
import { activeProviderId, configDir, getProvider, resolvedKey } from '@/lib/agent/providers'
import { completeText, extractJson } from '@/lib/agent/complete'
import { listModels } from '@/lib/agent/openai'
import { countryByCode } from './countries'
import { fetchTrendSignals, type TrendSignal } from './trends'

/**
 * Dynamic topic recommendations for the Content Forge welcome screen.
 *
 * One LLM call produces TWO days at once — what is viral in the operator's
 * country today, and what is likely to trend tomorrow — grounded in live
 * Google Trends signals. The result is cached on disk for 48 hours, so the
 * LLM runs at most once every two days per country (token saving). On day 2
 * yesterday's "tomorrow" list becomes "today".
 */

export interface TopicRec {
  headline: string
  /** One-line content angle: the hook a short video could use. */
  angle: string
  category: string
  /** What backs it: the trend term + traffic, or 'rising' / 'scheduled' for tomorrow. */
  signal: string
}

export type RecSource = 'llm' | 'trends' | 'none'

interface CacheFile {
  version: 1
  country: string
  generatedAt: number
  expiresAt: number
  source: RecSource
  model?: string
  /** Keyed by local date YYYY-MM-DD. */
  days: Record<string, TopicRec[]>
}

export interface RecResponse {
  country: string
  countryName: string
  today: string
  tomorrow: string
  todayTopics: TopicRec[]
  tomorrowTopics: TopicRec[]
  source: RecSource
  model?: string
  generatedAt: number
  expiresAt: number
  cached: boolean
  error?: string
}

const LLM_TTL_MS = 48 * 60 * 60 * 1000
/** Trends-only fallback (LLM unavailable) retries sooner. */
const FALLBACK_TTL_MS = 3 * 60 * 60 * 1000

/** Bump when the prompt changes so old caches are regenerated, not served. */
const PROMPT_VERSION = 2

/** One cache per country + language + prompt version. */
function cacheFile(country: string, lang: string): string {
  return path.join(configDir(), 'forge', `recommendations-${country}-${lang}-v${PROMPT_VERSION}.json`)
}

function readCache(country: string, lang: string): CacheFile | null {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(country, lang), 'utf-8')) as CacheFile
    return data?.version === 1 ? data : null
  } catch {
    return null
  }
}

function writeCache(data: CacheFile, lang: string) {
  try {
    fs.mkdirSync(path.dirname(cacheFile(data.country, lang)), { recursive: true })
    fs.writeFileSync(cacheFile(data.country, lang), `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  } catch {
    /* serving from memory is still fine */
  }
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function clean(text: unknown, max: number): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeTopics(list: unknown): TopicRec[] {
  if (!Array.isArray(list)) return []
  return list
    .map((t: any) => ({
      headline: clean(t?.headline ?? t?.title, 90),
      angle: clean(t?.angle ?? t?.hook ?? t?.why, 200),
      category: clean(t?.category, 24) || 'Trending',
      signal: clean(t?.signal ?? t?.basis, 110),
    }))
    .filter((t) => t.headline)
    .slice(0, 4)
}

function languageName(lang: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || 'English'
  } catch {
    return 'English'
  }
}

function buildPrompt(
  countryName: string,
  today: string,
  tomorrow: string,
  signals: TrendSignal[],
  lang: string,
): string {
  // Plain format (no quotes/parentheses) so models don't copy it into broken JSON.
  const lines = signals.slice(0, 15).map((s, i) => {
    const news = s.news.length ? ` — news: ${s.news.join(' | ')}` : ''
    return `${i + 1}. ${s.term} · ${s.traffic || 'n/a'} searches${news}`
  })
  return [
    `Country: ${countryName}. Today is ${today}; tomorrow is ${tomorrow}.`,
    '',
    'Live Google Trends signals for this country right now:',
    lines.length ? lines.join('\n') : '(no live signals available)',
    '',
    `Write as headlines: I need 3-4 topic recommendations that are currently viral in ${countryName} today, and another 3-4 topics likely to trend there tomorrow.`,
    '',
    'Rules:',
    `- Write headline and angle entirely in ${languageName(lang)}. Translate phrases from the signals; only proper names (people, teams, brands, events) keep their original spelling.`,
    '- TODAY topics must come from the signals above. Give at least 3 when the signals allow; merge true duplicates only; skip anything too thin for short-form video.',
    '- TOMORROW topics: stories from the signals that are still building, or events scheduled for tomorrow in this country that you are confident about (matches, releases, holidays). Never invent news.',
    '- headline: catchy, max 8 words, written for a short-form creator. Keep names in their original spelling.',
    '- angle: one sentence on the hook a 30-60 s video could use.',
    '- category: one or two words (Sports, Entertainment, Tech, News, Lifestyle, Gaming, Finance…).',
    '- signal: a single JSON string. For today: "<trend term> · <volume>", e.g. "suns vs spurs · 500+". For tomorrow: "rising" or "scheduled: <event>".',
    '- Output must be valid JSON: every value is one quoted string, nothing outside the quotes.',
    '- Avoid tragedies, violence and private individuals as "content opportunities".',
    '',
    'Reply with ONLY this JSON, no prose:',
    '{"today":[{"headline":"","angle":"","category":"","signal":""}],"tomorrow":[{"headline":"","angle":"","category":"","signal":""}]}',
  ].join('\n')
}

/** No LLM? Still useful: show the raw top searches as today's topics. */
function fallbackFromSignals(signals: TrendSignal[]): TopicRec[] {
  return signals.slice(0, 4).map((s) => ({
    headline: s.term.replace(/\b\w/g, (c) => c.toUpperCase()),
    angle: s.news[0] ?? 'Trending search right now',
    category: 'Trending',
    signal: `${s.term} · ${s.traffic || 'trending'}`,
  }))
}

const SYSTEM =
  'You are a social-media trend analyst for short-form video creators. You only report trends backed by the data you are given or by well-known scheduled events. You reply with strict JSON.'

/** Cheap, fast models first when we have to fall back. */
function fallbackRank(id: string): number {
  // Whole name segments only — "gemini" must not match "mini".
  if (/(^|[-_.:/])(lite|mini|flash|haiku|small|nano|[1-9]b)([-_.:]|$)/i.test(id)) return 0
  return 1
}

/**
 * One generation, made resilient: the requested model twice (overloads and
 * malformed JSON are usually transient), then up to two cheaper models from
 * the same provider.
 */
async function askWithRetry(opts: { providerId?: string; model?: string; prompt: string }) {
  const tried: string[] = []
  const errors: string[] = []

  const attempt = async (model?: string) => {
    const { text, model: used } = await completeText({
      providerId: opts.providerId,
      model,
      system: SYSTEM,
      prompt: opts.prompt,
      temperature: 0.5,
    })
    tried.push(used)
    const parsed = extractJson<{ today?: unknown; tomorrow?: unknown }>(text)
    const todayTopics = normalizeTopics(parsed?.today)
    if (!todayTopics.length) {
      console.warn(`[forge] ${used} reply had no usable topics (${text.length} chars): ${text.slice(0, 300)}`)
      throw new Error(`${used} returned no usable topics`)
    }
    return { todayTopics, tomorrowTopics: normalizeTopics(parsed?.tomorrow), model: used }
  }

  for (const model of [opts.model, opts.model]) {
    try {
      return await attempt(model)
    } catch (err: any) {
      errors.push(err?.message ?? String(err))
      await new Promise((r) => setTimeout(r, 1500))
    }
  }

  // Fall back to other chat models on the same provider.
  const provider = getProvider(opts.providerId ?? activeProviderId())
  const others = (await listModels(provider.baseUrl, resolvedKey(provider), provider.kind))
    .map((m) => m.id)
    .filter((id) => !tried.includes(id) && id !== opts.model)
    .sort((a, b) => fallbackRank(a) - fallbackRank(b))
    .slice(0, 2)
  for (const model of others) {
    try {
      return await attempt(model)
    } catch (err: any) {
      errors.push(err?.message ?? String(err))
    }
  }
  throw new Error(errors[errors.length - 1] ?? 'no model produced topics')
}

const inflight = new Map<string, Promise<RecResponse>>()

export async function getRecommendations(opts: {
  country: string
  today: string
  /** Two-letter language for headlines (from the browser). */
  lang?: string
  providerId?: string
  model?: string
  refresh?: boolean
}): Promise<RecResponse> {
  const country = countryByCode(opts.country)?.code ?? 'US'
  const lang = /^[a-z]{2}$/.test(opts.lang ?? '') ? opts.lang! : 'en'
  const key = `${country}:${lang}:${opts.today}:${opts.refresh ? 'r' : ''}`
  const running = inflight.get(key)
  if (running) return running
  const job = generate({ ...opts, country, lang }).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function generate(opts: {
  country: string
  today: string
  lang: string
  providerId?: string
  model?: string
  refresh?: boolean
}): Promise<RecResponse> {
  const { country, today, lang } = opts
  const tomorrow = addDays(today, 1)
  const countryName = countryByCode(country)?.name ?? country

  const respond = (data: CacheFile, cached: boolean, error?: string): RecResponse => ({
    country,
    countryName,
    today,
    tomorrow,
    todayTopics: data.days[today] ?? [],
    tomorrowTopics: data.days[tomorrow] ?? [],
    source: data.source,
    model: data.model,
    generatedAt: data.generatedAt,
    expiresAt: data.expiresAt,
    cached,
    error,
  })

  // Serve the cache while it is fresh AND still covers today.
  const existing = readCache(country, lang)
  if (!opts.refresh && existing && Date.now() < existing.expiresAt && existing.days[today]?.length) {
    return respond(existing, true)
  }

  const signals = await fetchTrendSignals(country)
  const now = Date.now()

  try {
    const { todayTopics, tomorrowTopics, model } = await askWithRetry({
      providerId: opts.providerId,
      model: opts.model,
      prompt: buildPrompt(countryName, today, tomorrow, signals, lang),
    })

    const data: CacheFile = {
      version: 1,
      country,
      generatedAt: now,
      expiresAt: now + LLM_TTL_MS,
      source: 'llm',
      model,
      days: { [today]: todayTopics, [tomorrow]: tomorrowTopics },
    }
    writeCache(data, lang)
    return respond(data, false)
  } catch (err: any) {
    const reason = err?.message ?? String(err)
    // A still-valid LLM cache beats a raw fallback (e.g. a forced refresh that failed).
    if (existing && existing.source === 'llm' && Date.now() < existing.expiresAt && existing.days[today]?.length) {
      return respond(existing, true, `refresh failed: ${reason}`)
    }
    const topics = fallbackFromSignals(signals)
    const data: CacheFile = {
      version: 1,
      country,
      generatedAt: now,
      expiresAt: now + FALLBACK_TTL_MS,
      source: topics.length ? 'trends' : 'none',
      days: { [today]: topics },
    }
    if (topics.length) writeCache(data, lang)
    return respond(data, false, reason)
  }
}
