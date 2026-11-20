/**
 * A remark plugin for the extra pieces in Hermione's answers:
 *
 *  - colour swatches: `#ff8800` (inline code, 3/4/6/8 digits) and bare
 *    #ff8800 in text (6/8 digits only, so "#123" issue numbers stay text)
 *  - image grids: two or more images in a row (one paragraph, or several
 *    image-only paragraphs back to back) become one gallery
 *  - tag pills: [[Best all-rounder]]
 *  - list items starting with a picture → thumbnail rows
 *  - callouts: GitHub-style `> [!NOTE]` / TIP / IMPORTANT / WARNING / CAUTION,
 *    and `> **Note:** …` style quotes
 *
 * It only tags mdast nodes with hName/hProperties; rendering lives in
 * ChatMarkdown. No raw HTML is produced, so the console stays injection-safe.
 */

type MdNode = {
  type: string
  value?: string
  url?: string
  alt?: string | null
  title?: string | null
  children?: MdNode[]
  data?: Record<string, unknown>
}

export const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const HEX_IN_TEXT = /(?<![\w&#/])#(?:[0-9a-f]{8}|[0-9a-f]{6})(?![\w-])/gi

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]
const CALLOUT_ALIASES: Record<string, CalloutKind> = {
  note: 'note', info: 'note', tip: 'tip', hint: 'tip', important: 'important',
  warning: 'warning', warn: 'warning', caution: 'caution', danger: 'caution',
}
const CALLOUT_LABEL: Record<CalloutKind, string> = {
  note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution',
}

/** Leave these alone: links already have their own look, code is code. */
const SKIP = new Set(['link', 'linkReference', 'code', 'html', 'definition', 'image', 'imageReference'])

function swatch(hex: string, isCode: boolean): MdNode {
  return {
    type: 'swatch',
    data: {
      hName: 'span',
      hProperties: { className: isCode ? ['md-swatch', 'is-code'] : ['md-swatch'], dataColor: hex },
      hChildren: [{ type: 'text', value: hex }],
    },
  }
}

/** [[Best all-rounder]] → a small tag pill (1–40 chars, no brackets inside). */
const BADGE = /\[\[([^[\]\n]{1,40})\]\]/g

function badge(label: string): MdNode {
  return {
    type: 'badge',
    data: { hName: 'span', hProperties: { className: ['md-badge'] }, hChildren: [{ type: 'text', value: label.trim() }] },
  }
}

/** Split a text node into text, colour swatches and tag pills (null: nothing to do). */
function splitInline(value: string): MdNode[] | null {
  HEX_IN_TEXT.lastIndex = 0
  BADGE.lastIndex = 0
  const hits = [
    ...[...value.matchAll(HEX_IN_TEXT)].map((m) => ({ at: m.index ?? 0, len: m[0].length, node: swatch(m[0], false) })),
    ...[...value.matchAll(BADGE)].filter((m) => m[1].trim()).map((m) => ({ at: m.index ?? 0, len: m[0].length, node: badge(m[1]) })),
  ].sort((a, b) => a.at - b.at)
  if (!hits.length) return null
  const out: MdNode[] = []
  let last = 0
  for (const h of hits) {
    if (h.at < last) continue // overlaps an earlier hit
    if (h.at > last) out.push({ type: 'text', value: value.slice(last, h.at) })
    out.push(h.node)
    last = h.at + h.len
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

const isWebImage = (n: MdNode) => n.type === 'image' && typeof n.url === 'string' && /^https?:\/\//i.test(n.url)

/** Images in an image-only paragraph (null when it holds anything else). */
function imagesOf(p: MdNode): MdNode[] | null {
  if (p.type !== 'paragraph' || !p.children?.length) return null
  const images: MdNode[] = []
  for (const c of p.children) {
    if (c.type === 'image') images.push(c)
    else if (c.type === 'link' && c.children?.length && c.children.every((x) => x.type === 'image')) images.push(c)
    else if (c.type === 'break' || (c.type === 'text' && !c.value?.trim())) continue
    else return null
  }
  return images.length ? images : null
}

/** Caption under a gallery tile: the image's "title", else its alt text. */
function caption(img: MdNode | undefined): MdNode | null {
  const text = (img?.title || img?.alt || '').trim()
  if (!text || /^(image|picture|photo|img)\s*\d*$/i.test(text)) return null
  return {
    type: 'galleryCaption',
    data: { hName: 'span', hProperties: { className: ['md-gallery-cap'] }, hChildren: [{ type: 'text', value: text }] },
  }
}

/** A gallery tile: the image (plus caption), opening full size in a new tab unless it's already a link. */
function tile(n: MdNode): MdNode | null {
  const img = n.type === 'link' ? n.children?.find(isWebImage) : isWebImage(n) ? n : undefined
  if (!img) return null
  const cap = caption(img)
  const kids = [img, ...(cap ? [cap] : [])]
  if (n.type === 'link') return { ...n, children: kids }
  return { type: 'link', url: img.url, title: img.alt || null, children: kids }
}

/**
 * A list item that starts with a picture — "- ![Samoyed](…) **Samoyed** — fluffy" —
 * becomes a row: thumbnail on the left, the text beside it.
 */
function thumbItem(li: MdNode): boolean {
  const para = li.children?.[0]
  const first = para?.type === 'paragraph' ? para.children?.[0] : undefined
  if (!para || !first) return false
  const isThumb = isWebImage(first) || (first.type === 'link' && first.children?.length === 1 && isWebImage(first.children[0]))
  if (!isThumb) return false

  para.children!.shift()
  // Drop the line break / spaces between the picture and the text.
  while (para.children!.length && (para.children![0].type === 'break' || (para.children![0].type === 'text' && !para.children![0].value?.trim()))) {
    para.children!.shift()
  }
  const lead = para.children![0]
  if (lead?.type === 'text' && lead.value) lead.value = lead.value.replace(/^\s+/, '')
  const body = para.children!.length ? li.children! : li.children!.slice(1)

  li.children = [
    { type: 'thumb', children: [first], data: { hName: 'div', hProperties: { className: ['md-thumb'] } } },
    { type: 'thumbBody', children: body, data: { hName: 'div', hProperties: { className: ['md-thumb-body'] } } },
  ]
  li.data = { ...(li.data ?? {}), hProperties: { className: ['md-thumb-item'] } }
  return true
}

function thumbList(list: MdNode) {
  let any = false
  for (const li of list.children ?? []) if (li.type === 'listItem' && thumbItem(li)) any = true
  if (any) list.data = { ...(list.data ?? {}), hProperties: { className: ['md-thumb-list'] } }
}

function galleries(parent: MdNode) {
  const kids = parent.children
  if (!kids) return
  const next: MdNode[] = []
  for (let i = 0; i < kids.length; ) {
    const first = imagesOf(kids[i])
    if (!first) {
      next.push(kids[i++])
      continue
    }
    const run: MdNode[] = [...first]
    let j = i + 1
    for (let more; j < kids.length && (more = imagesOf(kids[j])); j++) run.push(...more)
    const tiles = run.map(tile).filter((t): t is MdNode => !!t)
    if (tiles.length >= 2) {
      next.push({ type: 'paragraph', children: tiles, data: { hName: 'div', hProperties: { className: ['md-gallery'] } } })
    } else {
      next.push(...kids.slice(i, j))
    }
    i = j
  }
  parent.children = next
}

function callout(q: MdNode) {
  const para = q.children?.[0]
  const head = para?.type === 'paragraph' ? para.children?.[0] : undefined
  if (!para || !head) return
  let kind: CalloutKind | undefined

  if (head.type === 'text' && head.value) {
    // > [!NOTE]
    const m = head.value.match(/^\s*\[!(\w+)\][ \t]*\r?\n?/)
    if (m && CALLOUT_ALIASES[m[1].toLowerCase()]) {
      kind = CALLOUT_ALIASES[m[1].toLowerCase()]
      head.value = head.value.slice(m[0].length)
      if (!head.value) para.children!.shift()
    }
  } else if (head.type === 'strong' && head.children?.length === 1 && head.children[0].type === 'text') {
    // > **Note:** … or > **Note**: …
    const m = head.children[0].value?.trim().match(/^(\w+):?$/)
    const after = para.children![1]
    const colonInside = head.children[0].value?.trim().endsWith(':')
    const colonAfter = after?.type === 'text' && /^\s*:/.test(after.value ?? '')
    if (m && CALLOUT_ALIASES[m[1].toLowerCase()] && (colonInside || colonAfter)) {
      kind = CALLOUT_ALIASES[m[1].toLowerCase()]
      para.children!.shift()
      if (after?.type === 'text') after.value = (after.value ?? '').replace(/^\s*:?\s*/, '')
    }
  }
  if (!kind) return

  if (!para.children!.length) q.children!.shift()
  q.data = { hName: 'div', hProperties: { className: ['md-callout', `md-callout-${kind}`], role: 'note' } }
  q.children!.unshift({
    type: 'calloutTitle',
    data: {
      hName: 'div',
      hProperties: { className: ['md-callout-title'], dataKind: kind },
      hChildren: [{ type: 'text', value: CALLOUT_LABEL[kind] }],
    },
  })
}

function walk(node: MdNode) {
  if (node.type === 'blockquote') callout(node)
  if (node.type === 'list') thumbList(node)
  if (node.children) {
    galleries(node)
    const out: MdNode[] = []
    for (const child of node.children) {
      if (child.type === 'inlineCode' && child.value && HEX_COLOR.test(child.value.trim())) {
        out.push(swatch(child.value.trim(), true))
      } else if (child.type === 'text' && child.value) {
        out.push(...(splitInline(child.value) ?? [child]))
      } else {
        if (!SKIP.has(child.type)) walk(child)
        out.push(child)
      }
    }
    node.children = out
  }
}

export function remarkHermione() {
  return (tree: MdNode) => walk(tree)
}
