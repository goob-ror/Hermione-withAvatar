/**
 * Plain-words descriptions of what Hermione is doing, for the live
 * "thinking" row (like Claude's): "Searching the web for "puppy breeds"",
 * "Reading akc.org", or the latest sentence of her reasoning.
 */

const clip = (s: string, max: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : one
}

const host = (url: unknown) => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '')
  } catch {
    return String(url ?? '').slice(0, 40) || 'a page'
  }
}

const file = (p: unknown) => {
  const s = String(p ?? '').replace(/\\/g, '/')
  return s.split('/').filter(Boolean).pop() || s || 'the folder'
}

const quoted = (s: unknown, max = 60) => `“${clip(String(s ?? ''), max)}”`

/** What a tool call is doing, as a short present-tense phrase. `done` gives the past tense. */
export function describeTool(tool: string, args: Record<string, any> = {}, done = false): string {
  const t = (now: string, past: string) => (done ? past : now)
  switch (tool) {
    case 'web_search':
      return `${t('Searching', 'Searched')} the web for ${quoted(args.query)}`
    case 'image_search': {
      const qs: string[] = Array.isArray(args.queries) ? args.queries : [args.queries ?? args.query].filter(Boolean)
      const what = qs.length > 2 ? `${qs.slice(0, 2).join(', ')} and ${qs.length - 2} more` : qs.join(' and ')
      return `${t('Finding', 'Found')} pictures of ${clip(what || 'that', 70)}`
    }
    case 'video_search':
      return `${t('Finding', 'Found')} videos about ${quoted(args.query)}`
    case 'video_inspect':
      return `${t('Breaking down', 'Broke down')} a ${/tiktok\.com/i.test(String(args.url)) ? 'TikTok' : 'YouTube'} video`
    case 'clip_render':
      return `${t('Making', 'Made')} the clip${args.title ? ` ${quoted(args.title, 50)}` : ''}`
    case 'clip_upload': {
      const where = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' }[String(args.platform)] ?? 'the platform'
      return `${t('Preparing', 'Prepared')} the ${where} upload`
    }
    case 'web_fetch':
      return `${t('Reading', 'Read')} ${host(args.url)}`
    case 'site_inspect':
      return `${t('Inspecting', 'Inspected')} ${host(args.url)}`
    case 'page_open':
      return `${t('Opening', 'Opened')} ${host(args.url)}`
    case 'page_read':
      return `${t('Reading', 'Read')} the page`
    case 'page_act': {
      const c = String(args.command ?? '')
      if (c === 'click') return `${t('Clicking', 'Clicked')} on the page`
      if (c === 'fill') return `${t('Typing', 'Typed')} ${args.value ? quoted(args.value, 40) : ''} on the page`.replace(/\s+/g, ' ')
      if (c === 'scroll') return `${t('Scrolling', 'Scrolled')} the page`
      if (c === 'press') return `${t('Pressing', 'Pressed')} ${clip(String(args.key ?? 'a key'), 20)}`
      if (c === 'select' || c === 'check') return `${t('Choosing', 'Chose')} an option on the page`
      return `${t('Looking at', 'Looked at')} the page`
    }
    case 'fs_list':
      return `${t('Looking through', 'Looked through')} ${file(args.path)}`
    case 'fs_read':
      return `${t('Reading', 'Read')} ${file(args.path)}`
    case 'fs_write':
      return `${t('Writing', 'Wrote')} ${file(args.path)}`
    case 'fs_delete':
      return `${t('Deleting', 'Deleted')} ${file(args.path)}`
    case 'shell_run':
    case 'terminal_run':
      return `${t('Running', 'Ran')} \`${clip(String(args.command ?? args.cmd ?? 'a command'), 48)}\``
    case 'terminal_read':
      return `${t('Checking', 'Checked')} the terminal`
    case 'terminal_interrupt':
      return `${t('Stopping', 'Stopped')} the terminal command`
    case 'memory_save':
      return `${t('Saving', 'Saved')} to memory`
    case 'memory_forget':
      return `${t('Forgetting', 'Forgot')} a memory`
    case 'notes_search':
      return `${t('Searching', 'Searched')} your notes for ${quoted(args.query)}`
    case 'notes_read':
      return `${t('Reading', 'Read')} your note`
    case 'ask_user':
      return `${t('Asking', 'Asked')} you a question`
    case 'get_time':
      return `${t('Checking', 'Checked')} the time`
    case 'get_calendar':
      return `${t('Checking', 'Checked')} the calendar`
    default:
      return `${t('Using', 'Used')} ${tool.replace(/_/g, ' ')}`
  }
}

/**
 * The newest complete thought in her reasoning, as one short line:
 * "Checking which breeds the AKC ranks highest." While a sentence is still
 * streaming, the last finished one is shown (so the line doesn't flicker).
 */
export function thinkingHeadline(text: string, max = 110): string {
  const clean = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    // Markdown marks only — keep underscores inside words like web_search.
    .replace(/\*+|`+|(^|\s)_+|_+(?=\s|$)/gm, '$1')
    .replace(/^\s*#+\s*|^\s*>\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)/g)
  if (!sentences?.length) return clip(clean, max)
  const done = sentences.map((s) => s.trim()).filter((s) => s.length > 3)
  return clip(done[done.length - 1] ?? clean, max)
}

/** "14s", "1m 05s" */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}
