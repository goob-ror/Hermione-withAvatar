import { helperComplete, type HelperModel } from '@/lib/agent/helpers'
import { addressAsSir, sanitizeTags, stripTags } from './expression'
export { detailFor } from '@/lib/voice/detail'

/**
 * Hermione's thinking commentary: the short lines she says (and shows under
 * the avatar) while a long task runs — written by the voice helper from what
 * she is actually doing, never repeating a line in the same run. If the
 * helper is off, slow or odd, varied rule-based lines take over.
 */

export interface CommentaryInput {
  /** The tool she's using ('web_search', 'delegate' …) or 'thinking'. */
  activity: string
  /** A short, safe detail: the search query, a site's hostname, a file name… */
  detail?: string
  /** Seconds since the request started. */
  elapsedS: number
  /** Lines already said in this run. */
  said: string[]
  /** Workers running right now. */
  workers?: number
}

const MAX_LINE = 110

/** Varied fallback lines, by activity. `{d}` is the detail (lines with it are skipped when there is none). */
const BANK: Record<string, string[]> = {
  web_search: ['Searching for {d} now, sir.', 'Looking up {d}.', 'Combing through the search results.', 'Still digging, a few more results to check.'],
  web_fetch: ['Reading {d} now.', 'Going through {d}, sir.', 'Still reading, almost there.', 'This page is a long one, bear with me.'],
  page_open: ['Opening {d} in the browser.', 'Working in the browser now.', 'Still on the page, one moment.'],
  page_act: ['Working through the page.', 'Clicking through, nearly done.'],
  image_search: ['Picking out some pictures for you.', 'Finding the best pictures.'],
  video_search: ['Looking through videos on {d}.', 'Checking what is trending.'],
  delegate: ['I have workers looking into {d}.', 'My workers are on it, sir.', 'Waiting on the workers, they are fast.', 'The workers are still reading, almost there.'],
  fs_read: ['Going through {d}.', 'Reading your files.'],
  fs_list: ['Looking through the project folder.'],
  fs_write: ['Writing {d} now.', 'Saving the changes.'],
  shell_run: ['Running {d}.', 'The command is still running.'],
  terminal_run: ['Running {d} in the terminal.', 'Still running, hang on.'],
  thinking: ['Let me think this through.', 'Putting it all together now.', 'Nearly there, sir.', 'Still thinking, this one deserves care.', 'Turning it over, one moment.'],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

/** A line from the bank: fits the activity, uses the detail when there is one, not said yet. */
export function ruleCommentary(input: CommentaryInput): string {
  const said = new Set(input.said.map(norm))
  const pool = [...(BANK[input.activity] ?? []), ...BANK.thinking]
  const filled = pool
    .filter((l) => !l.includes('{d}') || input.detail)
    .map((l) => l.replace('{d}', input.detail ?? ''))
    .filter((l) => !said.has(norm(l)))
  if (input.workers && input.workers > 1) filled.unshift(`${input.workers} workers are on it, sir.`)
  return filled.find((l) => !said.has(norm(l))) ?? 'Still working on it, sir.'
}

const SYSTEM = [
  'You write ONE short line that Hermione says out loud while she works on a task, so the operator knows she is busy. She is refined, witty, warm, confident; she calls the operator "sir".',
  `Rules: one sentence, at most ${MAX_LINE} characters, English, no emoji, no markdown, no URLs, no quotes. Mention what she is doing using the detail when it helps. Never promise results, never invent facts. Vary the wording: do not repeat or closely echo the lines already said.`,
  'Reply with the line only.',
].join('\n')

/** Clean a helper's reply into one speakable line, or null. */
export function cleanCommentary(reply: string, said: string[]): string | null {
  const line = addressAsSir(
    stripTags(sanitizeTags(reply))
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .split(/\n+/)[0]
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_#`]+/g, '')
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (!/\w/.test(line) || line.length > MAX_LINE) return null
  const n = norm(line)
  if (said.some((s) => norm(s) === n)) return null
  return line
}

export async function commentaryLine(
  input: CommentaryInput,
  deps: { complete?: any; candidates?: HelperModel[] } = {},
): Promise<{ text: string; by: 'model' | 'rules' }> {
  const rule = () => ({ text: ruleCommentary(input), by: 'rules' as const })
  try {
    const prompt = [
      `Doing now: ${input.activity}${input.detail ? ` (${input.detail})` : ''}${input.workers ? `, ${input.workers} worker(s) running` : ''}`,
      `Working for: ${Math.round(input.elapsedS)} s`,
      `Already said: ${input.said.length ? input.said.map((s) => `"${s}"`).join(' ') : '(nothing yet)'}`,
    ].join('\n')
    // One model, short budget: a late line is a useless line.
    const candidates = deps.candidates ?? (await import('@/lib/agent/helpers').then((h) => h.helperCandidates('voice'))).slice(0, 1)
    if (!candidates.length) return rule()
    const out = await helperComplete('voice', { system: SYSTEM, prompt, temperature: 0.9, timeoutMs: 2_500 }, { complete: deps.complete, candidates })
    const line = cleanCommentary(out.text, input.said)
    return line ? { text: line, by: 'model' } : rule()
  } catch {
    return rule()
  }
}
