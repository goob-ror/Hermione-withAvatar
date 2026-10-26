// HTML → compact readable text. This is the "page distiller" from the roadmap:
// small-context models cannot eat 300 KB of markup, so every page that enters
// the loop is reduced to the prose that matters.

const BLOCK_TAGS = [
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'br', 'hr', 'pre', 'blockquote',
  'table', 'ul', 'ol', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'form',
]

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', middot: '·',
  times: '×', rarr: '→', larr: '←', deg: '°', euro: '€', pound: '£',
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match)
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 9 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Text inside <title>, decoded and trimmed. */
export function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!match) return ''
  return decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Meta description, useful as a one-line summary of the page. */
export function extractDescription(html: string): string {
  const match =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html) ||
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html)
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 400) : ''
}

export interface Distilled {
  title: string
  description: string
  text: string
  headings: string[]
  links: { text: string; href: string }[]
  charCount: number
}

/**
 * Strip everything that is not readable prose: scripts, styles, svg, embedded
 * frames, comments, ARIA-only helper text. Then collapse whitespace and keep
 * one blank line between blocks so structure survives.
 */
export function distill(html: string, opts: { baseUrl?: string; maxChars?: number } = {}): Distilled {
  const maxChars = Math.min(60000, Math.max(500, opts.maxChars ?? 12000))
  const title = extractTitle(html)
  const description = extractDescription(html)

  const headings: string[] = []
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi
  let headingMatch: RegExpExecArray | null
  while ((headingMatch = headingRe.exec(html)) !== null) {
    const text = decodeEntities(headingMatch[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (text) headings.push(`h${headingMatch[1]}: ${text}`)
  }

  const links: { text: string; href: string }[] = []
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRe.exec(html)) !== null && links.length < 60) {
    const href = decodeEntities(linkMatch[1]).trim()
    const text = decodeEntities(linkMatch[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) continue
    links.push({ text: text.slice(0, 80) || href.slice(0, 80), href: absolutize(href, opts.baseUrl) })
  }

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')

  body = decodeEntities(body)

  const blockRe = new RegExp(`</?(?:${BLOCK_TAGS.join('|')})\\b[^>]*>`, 'gi')
  body = body.replace(blockRe, '\n')

  const text = body
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n… truncated (${text.length} chars total)` : text

  return { title, description, text: clipped, headings, links, charCount: text.length }
}

function absolutize(href: string, base?: string): string {
  if (!base) return href
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

/** One-line summary the loop can put in a system note. */
export function summarise(d: Distilled): string {
  const bits = [`title: ${d.title || '(none)'}`]
  if (d.description) bits.push(`description: ${d.description}`)
  if (d.headings.length) bits.push(`headings: ${d.headings.slice(0, 12).join(' | ')}`)
  return bits.join('\n')
}
