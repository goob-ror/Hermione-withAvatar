// Per-session preview state: the page the operator opened, plus the bridge
// handshake for commands that must run in the browser.

export interface PreviewPage {
  url: string
  title: string
  description: string
  /** Rewritten HTML actually served to the iframe. */
  html: string
  /** Distilled readable text — what the model sees. */
  text: string
  headings: string[]
  links: { text: string; href: string }[]
  bytes: number
  fetchedAt: number
}

const PAGES = new Map<string, PreviewPage>()

export function setPage(sessionId: string, page: PreviewPage) {
  PAGES.set(sessionId, page)
}

export function getPage(sessionId: string): PreviewPage | undefined {
  return PAGES.get(sessionId)
}

export function clearPage(sessionId: string) {
  PAGES.delete(sessionId)
}

export function pageInfo(sessionId: string) {
  const page = PAGES.get(sessionId)
  if (!page) return { open: false as const }
  return {
    open: true as const,
    url: page.url,
    title: page.title,
    description: page.description,
    textLength: page.text.length,
    bytes: page.bytes,
    fetchedAt: page.fetchedAt,
    headings: page.headings,
  }
}

/* ------------------------------------------------------------------ */
/* Bridge: a tool asks the browser to run something and waits for it.  */
/* ------------------------------------------------------------------ */

export interface CommandResult {
  ok: boolean
  output: string
}

interface Deferred {
  resolve: (result: CommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

const COMMANDS = new Map<string, Deferred>()

/**
 * Register a command and return a promise that settles when the browser posts
 * the result back. Times out rather than hanging the loop forever.
 */
export function awaitCommand(commandId: string, timeoutMs = 30000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      COMMANDS.delete(commandId)
      resolve({
        ok: false,
        output: `the preview never answered within ${Math.round(timeoutMs / 1000)}s — is the console tab open with a page loaded?`,
      })
    }, timeoutMs)
    COMMANDS.set(commandId, { resolve, timer })
  })
}

export function resolveCommand(commandId: string, ok: boolean, output: string): boolean {
  const deferred = COMMANDS.get(commandId)
  if (!deferred) return false
  clearTimeout(deferred.timer)
  COMMANDS.delete(commandId)
  deferred.resolve({ ok, output })
  return true
}

export function pendingCommandCount(): number {
  return COMMANDS.size
}
