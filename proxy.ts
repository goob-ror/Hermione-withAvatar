import { NextResponse, type NextRequest } from 'next/server'

/**
 * Request guard for Hermione's API (Next 16 `proxy`, formerly middleware).
 *
 * Hermione listens on localhost and its API can run shell commands, write
 * files and change providers. Any web page you visit — or a page rendered in
 * the preview — could otherwise send requests to it. This refuses:
 *
 *  1. Wrong Host (DNS rebinding): an attacker's domain re-pointed at 127.0.0.1
 *     looks "same-origin" to its own scripts. Only loopback hosts are served,
 *     plus HERMIONE_ALLOWED_HOSTS (comma-separated) for deliberate LAN use.
 *  2. Opaque origins (`Origin: null`): sandboxed preview frames, data:/file: pages.
 *  3. Cross-origin writes: POST/PUT/PATCH/DELETE whose Origin is another site
 *     (including another port on localhost).
 *  4. Cross-site background reads: fetch/img/script GETs from other sites.
 *     Top-level navigations stay allowed (the Google OAuth callback is one).
 *
 * Requests without browser headers (curl, server-to-server) pass: they are
 * not driven by a web page.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function hostname(hostHeader: string): string {
  // "[::1]:3000" → "[::1]", "localhost:3000" → "localhost"
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase()
  return hostHeader.split(':')[0].toLowerCase()
}

function allowedHost(hostHeader: string): boolean {
  const name = hostname(hostHeader)
  if (LOOPBACK.has(name)) return true
  const extra = (process.env.HERMIONE_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return extra.includes(name) || extra.includes(hostHeader.toLowerCase())
}

export function proxy(req: NextRequest) {
  // Logged so a blocked attack — or a wrongly blocked legitimate call — is visible.
  const refuse = (reason: string) => {
    console.warn(
      `[proxy] refused ${req.method} ${req.nextUrl.pathname}: ${reason}` +
        ` (origin=${req.headers.get('origin') ?? '-'}, site=${req.headers.get('sec-fetch-site') ?? '-'})`,
    )
    return NextResponse.json({ error: `request refused: ${reason}` }, { status: 403 })
  }

  const host = req.headers.get('host') ?? ''
  if (!allowedHost(host)) return refuse(`host "${host}" is not allowed`)

  const origin = req.headers.get('origin')
  const site = req.headers.get('sec-fetch-site') // same-origin | same-site | cross-site | none
  const mode = req.headers.get('sec-fetch-mode') // navigate | cors | no-cors | …
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)

  if (origin === 'null') return refuse('opaque origin (sandboxed page)')

  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      return refuse('malformed Origin')
    }
    if (originHost !== host && (unsafe || mode !== 'navigate')) return refuse('cross-origin request')
  }

  if ((site === 'cross-site' || site === 'same-site') && mode !== 'navigate') {
    return refuse(`${site} request`)
  }
  if (unsafe && site && site !== 'same-origin' && site !== 'none') {
    return refuse(`${site} write`)
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
