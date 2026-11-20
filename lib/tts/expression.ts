/**
 * Hermione's vocal expressions — cue tags (<chuckle>, <sigh> …) that speech.ts
 * turns into a VoxCPM2 delivery style (the tags are never spoken),
 * used sparingly. Pure text helpers (no Node or browser APIs), shared by the
 * server (lib/tts/speech.ts) and the browser (lib/voice/speaker.ts).
 *
 * Rules (SOUL.md: refined, dry, calm — never melodramatic):
 *   - at most ONE tag per line (a line is one TTS request: a waiting line, a
 *     summary, or one ≤ 280-char Read-aloud chunk, i.e. ~2 sentences);
 *   - cues come only from interjections that open a sentence:
 *       "Haha" / "Ha," / "Heh"      → <chuckle>  (the "haha" itself is dropped)
 *       "Phew" / "Whew"             → <sigh>     (the word is dropped)
 *       "Finally, it's done…"       → <sigh>     (only "finally" + done/there/it works…)
 *       "Oh!" / "Whoa"              → <gasp>     (the word is kept; "Oh," / "Oh no" are not cues)
 *       "Ugh"                       → <groan>    (the word is dropped)
 *       "Hmm"                       → <sigh>, but only for ~1 in 4 such lines (stable per line)
 *   - no tags at all on errors, failures, apologies or bad news;
 *   - tags already in the text are sanitized: unknown or off-character ones
 *     (<cough>, <sniffle>, <yawn>, <smile> …) removed, only the first kept.
 *
 * VoxCPM2, the browser's speechSynthesis fallback and anything on screen get
 * the text with every tag stripped (stripTags).
 */

/** Every cue tag (recognised so it can be stripped). */
export const CUE_TAGS = ['laugh', 'chuckle', 'sigh', 'cough', 'sniffle', 'groan', 'yawn', 'gasp'] as const
export type CueTag = (typeof CUE_TAGS)[number]

/** The ones that suit Hermione; the rest are removed even if the text asks for them. */
export const ALLOWED_TAGS: readonly CueTag[] = ['laugh', 'chuckle', 'sigh', 'gasp', 'groan']

/** Any simple word-tag: <laugh>, < sigh >, <smile> … (not "a < b" or HTML with attributes). */
const ANY_TAG = /<\s*([a-z_]{2,20})\s*>/gi
const KNOWN_TAG = new RegExp(`<\\s*(?:${CUE_TAGS.join('|')})\\s*>`, 'gi')

/** Remove every cue tag (before VoxCPM2, browser speech and on-screen text). */
export function stripTags(text: string): string {
  return text
    .replace(KNOWN_TAG, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:…])/g, '$1')
    .trim()
}

/**
 * Apply `fn` to the text between cue tags, leaving the tags untouched —
 * so Markdown/symbol cleaning (which removes ">") can't mangle "<laugh>".
 */
export function outsideTags(text: string, fn: (part: string) => string): string {
  const parts = text.split(/(<\s*(?:laugh|chuckle|sigh|cough|sniffle|groan|yawn|gasp)\s*>)/i)
  return parts.map((p, i) => (i % 2 ? p.replace(/\s+/g, '').toLowerCase() : fn(p))).join('')
}

/** Unknown tags removed, off-character ones removed, only the first allowed tag kept. */
export function sanitizeTags(text: string): string {
  let kept = false
  const out = text.replace(ANY_TAG, (_m, name: string) => {
    const tag = name.toLowerCase() as CueTag
    if (kept || !ALLOWED_TAGS.includes(tag)) return ' '
    kept = true
    return `<${tag}>`
  })
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:…])/g, '$1').trim()
}

/** Errors, failures, apologies, bad news: no laughing, groaning or gasping at those. */
const SOMBER =
  /\b(?:errors?|fail(?:s|ed|ing|ure|ures)?|wrong|sorry|apolog\w*|unfortunately|sadly|couldn'?t|could not|can'?t|cannot|unable|broken|crash(?:ed|es)?|lost|died|dies|death|dead|passed away|funeral|sick|ill|injur\w*|hurt|grief|griev\w*|sad|bad news|denied|refused|oh no|emergency|danger\w*)\b/i

export const isSomber = (text: string) => SOMBER.test(text)

interface Cue {
  re: RegExp
  tag: CueTag
  /** Drop the matched interjection (true) or keep the words and just add the tag. */
  drop: boolean
  /** Only for some lines (stable per text), e.g. 1 in 4. */
  oneIn?: number
}

/** Sentence-opening interjections → tags. Easy to tune: edit this list. */
const CUES: Cue[] = [
  { re: /^(?:ha(?:[\s-]?ha)+|hah|ha|heh(?:[\s-]?heh)*|lol)\b[\s,.!…]*/i, tag: 'chuckle', drop: true },
  { re: /^(?:phew|whew)\b[\s,.!…]*/i, tag: 'sigh', drop: true },
  { re: /^finally(?:[.!]|,?\s+(?=(?:it'?s|that'?s|we'?re|you'?re|done|finished|there|got|it works|all set|sorted)\b))/i, tag: 'sigh', drop: false },
  { re: /^(?:oh|ooh)!/i, tag: 'gasp', drop: false },
  { re: /^(?:whoa|woah)\b/i, tag: 'gasp', drop: false },
  { re: /^ugh+\b[\s,.!…]*/i, tag: 'groan', drop: true },
  { re: /^hm+\b/i, tag: 'sigh', drop: false, oneIn: 4 },
]

/** Literal laughter anywhere ("that's clever, haha") — not worth reading aloud. */
const HAHA = /[\s,]*\b(?:ha(?:[\s-]?ha)+|heh(?:[\s-]?heh)+|lol)\b[.!]*/gi

/** Small stable hash, so "1 in 4" lines are always the same ones. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const capitalize = (s: string) => s.replace(/^\s*([a-z])/, (_m, c: string) => c.toUpperCase())

/** Tidy what removing words/tags leaves: double spaces, orphan commas, a lower-case opening. */
const tidy = (s: string) =>
  s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(^|[>.!?…])\s*,\s*/g, '$1 ')
    .replace(/ +([,.!?;:…])/g, '$1')
    .trim()
    .replace(/^((?:<[a-z]+>\s*)?)([a-z])/, (_m, tag: string, c: string) => tag + c.toUpperCase())

/** Literal "haha" isn't read aloud (its closing . or ! stays). */
const dropLaughter = (s: string) => (s.search(HAHA) < 0 ? s : tidy(s.replace(HAHA, (m) => m.match(/[.!]+$/)?.[0] ?? '')))

/**
 * Add at most one expression cue tag to a line. Deterministic:
 * the same text always gets the same result. A tag the text already carries
 * is sanitized and counts as the one.
 */
export function expressive(text: string): string {
  let line = sanitizeTags(text)
  if (!line) return line
  if (isSomber(stripTags(line))) {
    // No emotional sounds on bad news.
    const plain = stripTags(line)
    const out = dropLaughter(plain)
    return /\w/.test(out) ? out : plain
  }

  let tagged = /<[a-z]+>/.test(line)
  if (!tagged) {
    // A cue may open any sentence (start of the line, or after . ! ? … and a space).
    const starts = [0, ...[...line.matchAll(/[.!?…]+\s+/g)].map((m) => m.index! + m[0].length)]
    outer: for (const at of starts) {
      const tail = line.slice(at)
      for (const cue of CUES) {
        const m = tail.match(cue.re)
        if (!m) continue
        if (cue.oneIn && hash(line) % cue.oneIn !== 0) break
        const rest = cue.drop ? capitalize(tail.slice(m[0].length)) : tail
        if (!/\w/.test(dropLaughter(rest))) break // "Haha!" alone: a bare tag is unreliable
        line = `${line.slice(0, at)}<${cue.tag}> ${rest}`
        tagged = true
        break outer
      }
    }
  }
  if (!tagged) {
    // Laughter mid-line ("clever, haha"): one chuckle in place of the first.
    let first = true
    const swapped = line.replace(HAHA, (m) => {
      const end = m.match(/[.!]+$/)?.[0] ?? ''
      if (!first) return end
      first = false
      return ` <chuckle>${end}`
    })
    if (!first && /\w/.test(stripTags(swapped))) return tidy(swapped)
  }
  const out = dropLaughter(line)
  return /\w/.test(stripTags(out)) ? out : line
}

/** Expressions on unless HERMIONE_VOICE_EXPRESSIONS is off/0/false/no. */
export function expressionsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(?:off|0|false|no)$/i.test((env.HERMIONE_VOICE_EXPRESSIONS ?? '').trim())
}

/**
 * The operator's name, as shown on screen (app/page.tsx). Out loud Hermione
 * says "sir" instead — every spoken path goes through addressAsSir().
 */
export const OPERATOR_NAMES = ['Serpto']

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "Hi, Serpto." → "Hi, sir."; "Serpto, look." → "Sir, look." (whole words, any case). */
export function addressAsSir(text: string, names: readonly string[] = OPERATOR_NAMES): string {
  const list = [...new Set([...OPERATOR_NAMES, ...names])].map((n) => n.trim()).filter((n) => n.length >= 2)
  if (!list.length) return text
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  return text.replace(re, (_m, at: number, all: string) => {
    const before = all.slice(0, at)
    return /(?:^|[.!?…]\s+|^(?:<[a-z]+>\s*)+|[.!?…]\s+<[a-z]+>\s*)$/.test(before) ? 'Sir' : 'sir'
  })
}

/** Opening salutations that may end in "!" ("Hello, sir!"). */
const SALUTATION = /^(?:<[a-z]+>\s*)?(?:hello|hi|hey|welcome|good (?:morning|afternoon|evening|to see you)|nice to see you|ready when you are)\b[^.!?…]{0,60}\./i

/**
 * Energy for short friendly lines (greetings): the opening salutation ends in
 * "!" instead of "." — once, only when the line has no "!" yet, and never on
 * bad news. The voice reads that brighter; still one "!" at most (SOUL.md).
 */
export function upbeat(text: string): string {
  if (text.length > 160 || text.includes('!') || isSomber(stripTags(text))) return text
  return text.replace(SALUTATION, (m) => `${m.slice(0, -1)}!`)
}
