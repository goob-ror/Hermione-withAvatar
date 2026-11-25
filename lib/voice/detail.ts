/** Pure helper shared by the browser (useRunVoice) and the server (commentary.ts). */

/** A short, safe detail for a tool call's arguments: no URLs (hostnames only), no long text. */
export function detailFor(tool: string, args: Record<string, any> = {}): string | undefined {
  const short = (s: unknown, n = 40) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim()
    return t ? (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t) : undefined
  }
  const host = (u: unknown) => {
    try {
      return new URL(String(u)).hostname.replace(/^www\./, '')
    } catch {
      return undefined
    }
  }
  switch (tool) {
    case 'web_search':
    case 'image_search':
    case 'video_search':
      return short(args.query)
    case 'web_fetch':
    case 'page_open':
    case 'site_inspect':
      return host(args.url)
    case 'fs_read':
    case 'fs_write':
    case 'fs_list':
      return short(String(args.path ?? '').split(/[\\/]/).pop())
    case 'shell_run':
    case 'terminal_run':
      return short(String(args.command ?? '').split(/\s+/).slice(0, 2).join(' '), 24)
    case 'delegate':
      return short(args.task, 36)
    default:
      return undefined
  }
}
