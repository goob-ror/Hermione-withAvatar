import type { ToolDef } from '@/lib/agent/types'

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX
const SEARXNG_INSTANCE = process.env.SEARXNG_INSTANCE || 'https://searx.be'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function googleApiSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  if (!GOOGLE_API_KEY || !GOOGLE_CX) {
    throw new Error('GOOGLE_API_KEY and GOOGLE_SEARCH_CX not configured')
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1')
  url.searchParams.set('key', GOOGLE_API_KEY)
  url.searchParams.set('cx', GOOGLE_CX)
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(Math.min(10, maxResults)))

  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    throw new Error(`Google API error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const items = data.items || []

  return items.map((item: any) => ({
    title: item.title || '',
    url: item.link || '',
    snippet: item.snippet || '',
  }))
}

async function searxngSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL(`${SEARXNG_INSTANCE}/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('engines', 'google,bing,duckduckgo')

  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'Hermione/0.6 (local agent)' },
  })

  if (!res.ok) {
    throw new Error(`SearXNG error: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  const results = data.results || []

  return results.slice(0, maxResults).map((item: any) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: item.content || '',
  }))
}

async function directGoogleSearch(query: string, maxResults: number): Promise<SearchResult[]> {
  const url = new URL('https://www.google.com/search')
  url.searchParams.set('q', query)
  url.searchParams.set('num', String(Math.min(20, maxResults)))

  const res = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })

  if (!res.ok) {
    throw new Error(`Google direct fetch failed: ${res.status}`)
  }

  const html = await res.text()

  // Very basic HTML parsing - looks for common Google result patterns
  const results: SearchResult[] = []
  const linkPattern = /<a[^>]+href="\/url\?q=([^"&]+)[^>]*>([^<]*)<\/a>/g
  const snippetPattern = /<span[^>]*class="[^"]*st[^"]*"[^>]*>([^<]*)<\/span>/g

  let match
  const links: Array<{ url: string; title: string }> = []
  while ((match = linkPattern.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1])
      if (decoded.startsWith('http') && !decoded.includes('google.com')) {
        links.push({ url: decoded, title: match[2].trim() || decoded })
      }
    } catch {}
  }

  const snippets: string[] = []
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, '').trim())
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || '',
    })
  }

  if (results.length === 0) {
    throw new Error('No results extracted (Google may have changed their HTML structure)')
  }

  return results
}

export const webSearch: ToolDef = {
  name: 'web_search',
  description:
    'Search the web using Google (via API, SearXNG, or direct fetch). Returns titles, URLs, and snippets. Auto-approved.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return (default 5, max 10)' },
    },
    required: ['query'],
  },
  async run(args) {
    const query = String(args.query ?? '').trim()
    if (!query) {
      return { ok: false, output: 'query is required' }
    }

    const maxResults = Math.min(10, Math.max(1, Number(args.max_results) || 5))

    const strategies: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = []

    if (GOOGLE_API_KEY && GOOGLE_CX) {
      strategies.push({ name: 'Google API', fn: () => googleApiSearch(query, maxResults) })
    }

    strategies.push({ name: 'SearXNG', fn: () => searxngSearch(query, maxResults) })
    strategies.push({ name: 'Google direct', fn: () => directGoogleSearch(query, maxResults) })

    let lastError: Error | null = null
    for (const strategy of strategies) {
      try {
        const results = await strategy.fn()
        if (results.length === 0) continue

        const lines = [`# Search results for "${query}" (via ${strategy.name})`, '']
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          lines.push(`## ${i + 1}. ${r.title}`)
          lines.push(`URL: ${r.url}`)
          if (r.snippet) lines.push(`${r.snippet}`)
          lines.push('')
        }

        return { ok: true, output: lines.join('\n').trim() }
      } catch (err: any) {
        lastError = err
        continue
      }
    }

    return {
      ok: false,
      output: `All search strategies failed. Last error: ${lastError?.message || 'unknown'}`,
    }
  },
}
