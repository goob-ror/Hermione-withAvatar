import type { ToolDef } from '@/lib/agent/types'

/**
 * image_search — find pictures to show the operator in the chat.
 *
 * Backends, first that answers wins:
 *   1. Bing Images     — the image results page; each tile carries a JSON
 *                        blob with the full image, a Bing-hosted thumbnail
 *                        (hotlink-friendly) and the page it came from.
 *   2. Wikimedia Commons — the public API; free-licensed photos, keyless.
 *
 * The answer embeds the thumbnail URLs as Markdown images; the console
 * renders them as list thumbnails or a gallery. Results are DATA.
 */

export interface ImageResult {
  title: string
  /** Shown in the chat: a reliable, hotlinkable thumbnail. */
  thumb: string
  /** The full-size original (may block hotlinking). */
  full: string
  /** The page the picture is on. */
  source: string
}

const MAX_QUERIES = 10

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
/** Titles go inside Markdown alt text — keep them to plain words. */
const cleanTitle = (t: string) => decode(t).replace(/<[^>]+>/g, '').replace(/[[\]()|*_`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)

/** Bing Images: every result tile has m="{…murl, turl, purl, t…}". */
export function parseBingImages(html: string, max: number): ImageResult[] {
  const out: ImageResult[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/\bm="(\{[^"]*?\})"/g)) {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(decode(m[1]))
    } catch {
      continue
    }
    const full = data.murl
    const thumb = data.turl
    if (!isHttp(full) || !isHttp(thumb) || seen.has(full)) continue
    seen.add(full)
    out.push({
      title: cleanTitle(String(data.t ?? data.desc ?? '')) || 'image',
      thumb,
      full,
      source: isHttp(data.purl) ? data.purl : full,
    })
    if (out.length >= max) break
  }
  return out
}

async function bingImages(query: string, max: number): Promise<ImageResult[]> {
  const url = new URL('https://www.bing.com/images/search')
  url.searchParams.set('q', query)
  url.searchParams.set('form', 'HDRSC2')
  url.searchParams.set('first', '1')
  url.searchParams.set('adlt', 'strict')
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  })
  if (!res.ok) throw new Error(`Bing Images ${res.status}`)
  return parseBingImages(await res.text(), max)
}

export function parseCommons(data: any, max: number): ImageResult[] {
  const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const out: ImageResult[] = []
  for (const p of pages) {
    const info = p.imageinfo?.[0]
    if (!info || !isHttp(info.thumburl) || !/^image\/(jpeg|png|webp|gif)/.test(info.mime ?? 'image/jpeg')) continue
    out.push({
      title: cleanTitle(String(p.title ?? '').replace(/^File:/, '').replace(/\.\w+$/, '')) || 'image',
      thumb: info.thumburl,
      full: isHttp(info.url) ? info.url : info.thumburl,
      source: isHttp(info.descriptionurl) ? info.descriptionurl : info.thumburl,
    })
    if (out.length >= max) break
  }
  return out
}

async function commonsImages(query: string, max: number): Promise<ImageResult[]> {
  const url = new URL('https://commons.wikimedia.org/w/api.php')
  for (const [k, v] of Object.entries({
    action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6', gsrlimit: String(max * 2), prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '480',
  })) url.searchParams.set(k, v)
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'HermioneLocalAgent/1.0 (local desktop assistant)' },
  })
  if (!res.ok) throw new Error(`Wikimedia Commons ${res.status}`)
  return parseCommons(await res.json(), max)
}

export const imageSearch: ToolDef = {
  name: 'image_search',
  description:
    'Find pictures on the web to SHOW the operator. Use it whenever a picture helps: animals and breeds, places, food, products, ' +
    'people in the news, art, "show me…", "what does X look like". Returns ready-to-paste Markdown images. ' +
    'For a list of items pass them all at once (one picture each, e.g. ["Samoyed puppy", "Corgi puppy"]); ' +
    'for several pictures of one thing pass one query and max_results. Runs automatically.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        description: `What to picture, up to ${MAX_QUERIES} items, e.g. ["Samoyed puppy", "Corgi puppy"]`,
      },
      max_results: { type: 'number', description: 'Pictures per item (default 1 for several items, 4 for one; max 8)' },
    },
    required: ['queries'],
  },
  async run(args) {
    // Accept a lone string too ("queries": "Samoyed puppy", or the older "query").
    const raw: unknown[] = Array.isArray(args.queries) ? args.queries : [args.queries ?? args.query]
    const queries = [...new Set(raw.map((q) => (typeof q === 'string' ? q.trim() : '')).filter(Boolean))].slice(0, MAX_QUERIES)
    if (!queries.length) return { ok: false, output: 'queries is required — e.g. ["Samoyed puppy"]' }
    const max = Math.min(8, Math.max(1, Number(args.max_results) || (queries.length > 1 ? 1 : 4)))

    // Gentle on the backends: a few at a time.
    const sections: string[] = []
    for (let i = 0; i < queries.length; i += 3) {
      sections.push(...(await Promise.all(queries.slice(i, i + 3).map((q) => searchOne(q, max)))))
    }
    const found = sections.filter((s) => !s.startsWith('(none)'))
    if (!found.length) return { ok: false, output: `No pictures found:\n${sections.join('\n')}` }
    return {
      ok: true,
      output: [...sections, '', 'Paste the markdown lines exactly as given. Never invent or edit image URLs.'].join('\n'),
    }
  },
}


/** One query through the backends; a text section for the model. */
async function searchOne(query: string, max: number): Promise<string> {
  const failures: string[] = []
  for (const [name, fn] of [
    ['Bing Images', bingImages],
    ['Wikimedia Commons', commonsImages],
  ] as const) {
    try {
      const results = await fn(query, max)
      if (!results.length) {
        failures.push(`${name}: no results`)
        continue
      }
      const lines = [`# "${query}" — via ${name}`]
      results.forEach((r) => {
        lines.push(`- ${r.title}`, `  markdown: ![${r.title}](${r.thumb})`, `  source page: ${r.source}`)
      })
      return lines.join('\n')
    } catch (err: any) {
      failures.push(`${name}: ${err?.message || 'error'}`)
    }
  }
  return `(none) "${query}": ${failures.join('; ')}`
}
