/**
 * What Hermione says out loud — pure text helpers (no browser APIs), so they
 * can be tested.
 */

/** Markdown → plain sentences (code blocks become a short mention). */
export function plainSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/^\s*>\s?(\[!\w+\]\s*)?/gm, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~]+/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const firstSentence = (text: string, max = 170) => {
  const one = text.replace(/\s+/g, ' ').trim()
  const m = one.match(/^.{12,}?[.!?](?=\s|$)/)
  const s = (m ? m[0] : one).trim()
  return s.length > max ? `${s.slice(0, max).replace(/\s+\S*$/, '')}…` : s
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * A short spoken version of an answer: the opening line, what the list holds
 * ("8 picks: A, B and C, and more"), and a closing tip — or the whole answer
 * when it is already short. At most ~300 characters.
 */
export function spokenSummary(md: string, max = 300): string {
  const text = md.trim()
  if (!text) return ''
  const hasCode = /```/.test(text)
  const plain = plainSpeech(text)

  if (plain.length <= 220 && !hasCode) return plain.replace(/\n/g, ' ')

  const blocks = text.split(/\n{2,}/)
  const parts: string[] = []

  // Opening: the first ordinary paragraph (not a heading, list, picture or quote).
  const opening = blocks.find((b) => {
    const t = b.trim()
    return t && !/^(#|[-*+]\s|\d+[.)]\s|!\[|>|```|\|)/.test(t)
  })
  if (opening) parts.push(firstSentence(plainSpeech(opening)))

  // The list: how many items and the first few names (bold lead or first words).
  const items = [...text.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/gm)].map((m) => m[1])
  if (items.length >= 2) {
    const names = items
      .map((line) => {
        const bold = line.match(/\*\*([^*]{2,40})\*\*/)
        const name = bold ? bold[1] : plainSpeech(line).split(/\s[—–-]\s|[:.]/)[0]
        return name.replace(/\s+/g, ' ').trim()
      })
      .filter((n) => n && n.length <= 40)
    const shown = names.slice(0, 3)
    if (shown.length) {
      parts.push(`${items.length} in the list: ${joinNames(shown)}${items.length > shown.length ? ', and more' : ''}.`)
    }
  }

  // Closing tip / note / warning.
  // "Pro tip:", "Travel tip:", "Quick note:", "Heads up:", "> [!TIP]" …
  const tip = blocks.find((b) =>
    /^\s*(?:>\s*)?(?:\[!(?:tip|note|warning|important|caution)\]|(?:\*\*)?(?:[\w-]+\s){0,2}(?:tip|note|warning|heads up)s?\b)/i.test(b),
  )
  if (tip) parts.push(firstSentence(plainSpeech(tip)))

  if (hasCode) parts.push("I've put the code in the chat.")
  if (!parts.length) parts.push(firstSentence(plain, 220))

  let out = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, '')}…`
  return out
}

/** Lines for when a task runs long, by what she is doing. */
const WAITING: Record<string, string[]> = {
  web_search: ['Still searching the web for you.', 'Digging through search results.'],
  image_search: ['Finding some pictures for you.', 'Picking out the best pictures.'],
  web_fetch: ['Reading through the page.', 'Still reading, almost there.'],
  page_read: ['Reading through the page.', 'Still reading, almost there.'],
  site_inspect: ['Looking over the site.'],
  page_open: ['Working in the browser.', 'Still on the page, one moment.'],
  page_act: ['Working in the browser.', 'Still on the page, one moment.'],
  shell_run: ['Running that command, nearly done.', 'Still running, hang on.'],
  terminal_run: ['Running that in the terminal.', 'Still running, hang on.'],
  fs_read: ['Going through your files.'],
  fs_list: ['Going through your files.'],
  fs_write: ['Writing that file.'],
  thinking: ['Still thinking this one through.', 'Give me a moment, this is a big one.', 'Nearly there, putting it together.'],
}

export function waitingLine(activity: string | undefined, nth: number): string {
  const lines = WAITING[activity ?? 'thinking'] ?? WAITING.thinking
  return lines[nth % lines.length]
}
