/**
 * Live trend signals — free, no API key.
 *
 * Google Trends' daily RSS (`/trending/rss?geo=XX`) lists what a country is
 * searching for right now, with approximate traffic and the news stories
 * driving each term. Those signals ground the LLM so recommendations are
 * real, not invented.
 */

export interface TrendSignal {
  term: string
  /** e.g. "1000+", "50K+" as Google reports it. */
  traffic: string
  /** Numeric form of `traffic`, for ranking. */
  trafficValue: number
  /** Headlines of the news stories attached to the term. */
  news: string[]
  pubDate?: string
}

const FEED_TTL_MS = 60 * 60 * 1000
const feedCache = new Map<string, { at: number; signals: TrendSignal[] }>()

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()
}

function tag(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return match ? decode(match[1]) : ''
}

function trafficNumber(traffic: string): number {
  const m = traffic.replace(/,/g, '').match(/([\d.]+)\s*([KM])?/i)
  if (!m) return 0
  const base = Number(m[1])
  const unit = m[2]?.toUpperCase()
  return unit === 'M' ? base * 1e6 : unit === 'K' ? base * 1e3 : base
}

export function parseTrendsRss(xml: string): TrendSignal[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []
  return items
    .map((item) => {
      const traffic = tag(item, 'ht:approx_traffic')
      const news = (item.match(/<ht:news_item_title>[\s\S]*?<\/ht:news_item_title>/g) ?? [])
        .map((n) => decode(n.replace(/<\/?ht:news_item_title>/g, '')))
        .filter(Boolean)
        .slice(0, 3)
      return {
        term: tag(item, 'title'),
        traffic,
        trafficValue: trafficNumber(traffic),
        news,
        pubDate: tag(item, 'pubDate') || undefined,
      }
    })
    .filter((s) => s.term)
    .sort((a, b) => b.trafficValue - a.trafficValue)
}

/** Current trending searches for a country. Cached for an hour; never throws. */
export async function fetchTrendSignals(geo: string): Promise<TrendSignal[]> {
  const code = geo.toUpperCase()
  const cached = feedCache.get(code)
  if (cached && Date.now() - cached.at < FEED_TTL_MS) return cached.signals
  try {
    const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(code)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hermione/0.6)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return cached?.signals ?? []
    const signals = parseTrendsRss(await res.text())
    feedCache.set(code, { at: Date.now(), signals })
    return signals
  } catch {
    return cached?.signals ?? []
  }
}
