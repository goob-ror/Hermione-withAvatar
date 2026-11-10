import type { ToolDef } from '@/lib/agent/types'
import { browserStatus, chromeSearch, BotWallError } from '@/lib/browser/chrome'

/**
 * web_search — free, keyless, auto-approved.
 *
 * Backends, first that answers wins:
 *   1. Chrome profile  — the operator's installed Chrome with Hermione's
 *                        persistent profile (Browser settings). Real cookies and
 *                        sign-in, so the fewest bot walls. Off until set up.
 *   2. DuckDuckGo HTML — html.duckduckgo.com, works without JS or a key.
 *   3. Bing HTML       — fallback; result quality varies without cookies.
 *   4. Google API      — only when GOOGLE_API_KEY + GOOGLE_SEARCH_CX are set.
 *   5. SearXNG         — only when SEARXNG_INSTANCE is set to your own instance
 *                        (public instances now answer bots with a captcha page).
 *
 * Results are DATA. The loop already treats every tool output as untrusted.
 */

interface SearchResult {
  title: string
  url: string
  snippet: string
}

type TimeRange = 'day' | 'week' | 'month' | 'year'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function decodeEntities(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------------- DuckDuckGo ---------------- */

const DDG_TIME: Record<TimeRange, string> = { day: 'd', week: 'w', month: 'm', year: 'y' }

function unwrapDdg(href: string): string {
  const raw = decodeEntities(href)
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw, 'https://duckduckgo.com')
    return url.searchParams.get('uddg') || url.toString()
  } catch {
    return raw
  }
}

export function parseDuckDuckGo(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)
  for (const block of blocks) {
    if (/result--ad/.test(block.slice(0, 200))) continue
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const url = unwrapDdg(link[1])
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/)
    results.push({ title: decodeEntities(link[2]), url, snippet: snippet ? decodeEntities(snippet[1]) : '' })
    if (results.length >= maxResults) break
  }
  return results
}

async function duckDuckGoSearch(query: string, maxResults: number, timeRange?: TimeRange): Promise<SearchResult[]> {
  // GET, not POST: the POST form trips DuckDuckGo's bot check far more often.
  const url = new URL('https://html.duckduckgo.com/html/')
  url.searchParams.set('q', query)
  if (timeRange) url.searchParams.set('df', DDG_TIME[timeRange])
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  })
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  const html = await res.text()
  if (/anomaly-modal|Unfortunately, bots use DuckDuckGo too/i.test(html)) throw new Error('DuckDuckGo bot check')
  return parseDuckDuckGo(html, maxResults)
}

/* ---------------- Bing ---------------- */

const BING_TIME: Record<TimeRange, string> = {
  day: 'ex1:"ez1"',
  week: 'ex1:"ez2"',
  month: 'ex1:"ez3"',
  year: 'ex1:"ez5"',
}

/** Bing wraps links as /ck/a?…&u=a1<base64url of the real URL>. */
function unwrapBing(href: string): string {
  const raw = decodeEntities(href)
  try {
    const url = new URL(raw)
    const u = url.searchParams.get('u')
    if (url.hostname.endsWith('bing.com') && u?.startsWith('a1')) {
      return Buffer.from(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    }
    return raw
  } catch {
    return raw
  }
}

export function parseBing(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = []
  const blocks = html.split(/<li class="b_algo"/).slice(1)
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const url = unwrapBing(link[1])
    if (!/^https?:\/\//.test(url)) continue
    const snippet = block.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ?? block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    results.push({ title: decodeEntities(link[2]), url, snippet: snippet ? decodeEntities(snippet[1]) : '' })
    if (results.length >= maxResults) break
  }
  return results
}

async function bingSearch(query: string, maxResults: number, timeRange?: TimeRange): Promise<SearchResult[]> {
  const url = new URL('https://www.bing.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(Math.min(20, maxResults + 2)))
  if (timeRange) url.searchParams.set('filters', BING_TIME[timeRange])
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  })
  if (!res.ok) throw new Error(`Bing ${res.status}`)
  return parseBing(await res.text(), maxResults)
}

/* ---------------- Keyed / self-hosted (optional) ---------------- */

async function googleApiSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', process.env.GOOGLE_API_KEY!)
  url.searchParams.set('cx', process.env.GOOGLE_SEARCH_CX!)
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(Math.min(10, maxResults)))
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`Google API ${res.status}`)
  const data = await res.json()
  return (data.items || []).map((item: any) => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || '',
  }))
}

async function searxngSearch(instance: string, query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL(`${instance.replace(/\/+$/, '')}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`SearXNG ${res.status}`)
  const data = await res.json().catch(() => {
    throw new Error('SearXNG returned a non-JSON page (bot check?)')
  })
  return (data.results || []).slice(0, maxResults).map((item: any) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: item.content || '',
  }))
}

/* ---------------- Tool ---------------- */

export const webSearch: ToolDef = {
  name: 'web_search',
  description:
    'Search the web (your Chrome profile when set up, else DuckDuckGo / Bing). Returns titles, URLs and snippets. Optional time_range narrows to recent results. Runs automatically.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return (default 6, max 10)' },
      time_range: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Only results from the past day / week / month / year',
      },
    },
    required: ['query'],
  },
  async run(args) {
    const query = String(args.query ?? '').trim()
    if (!query) return { ok: false, output: 'query is required' }

    const maxResults = Math.min(10, Math.max(1, Number(args.max_results) || 6))
    const timeRange = (['day', 'week', 'month', 'year'] as const).find((t) => t === args.time_range)

    const strategies: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = []
    if (browserStatus().enabled) {
      strategies.push({ name: 'Chrome profile', fn: () => chromeSearch(query, maxResults, timeRange) })
    }
    strategies.push({ name: 'DuckDuckGo', fn: () => duckDuckGoSearch(query, maxResults, timeRange) })
    strategies.push({ name: 'Bing', fn: () => bingSearch(query, maxResults, timeRange) })
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_CX) {
      strategies.push({ name: 'Google API', fn: () => googleApiSearch(query, maxResults) })
    }
    const searx = process.env.SEARXNG_INSTANCE?.trim()
    if (searx && !/searx\.be/i.test(searx)) {
      strategies.push({ name: 'SearXNG', fn: () => searxngSearch(searx, query, maxResults) })
    }

    const failures: string[] = []
    for (const strategy of strategies) {
      try {
        const results = await strategy.fn()
        if (!results.length) {
          failures.push(`${strategy.name}: no results`)
          continue
        }
        const lines = [
          `# Search results for "${query}"${timeRange ? ` (past ${timeRange})` : ''} — via ${strategy.name}`,
          '',
        ]
        if (failures.length) lines.push(`(fell back after: ${failures.join('; ')})`, '')
        results.forEach((r, i) => {
          lines.push(`## ${i + 1}. ${r.title}`, `URL: ${r.url}`)
          if (r.snippet) lines.push(r.snippet)
          lines.push('')
        })
        return { ok: true, output: lines.join('\n').trim() }
      } catch (err: any) {
        const tag = err instanceof BotWallError ? 'bot check' : 'error'
        failures.push(`${strategy.name} ${tag}: ${err?.message || 'unknown'}`)
      }
    }

    return { ok: false, output: `All search backends failed:\n- ${failures.join('\n- ')}` }
  },
}
