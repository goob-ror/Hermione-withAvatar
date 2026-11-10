import type { NextRequest } from 'next/server'

/**
 * Cross-site request guard for state-changing routes.
 *
 * Browsers attach `Origin` to cross-origin POST/PUT/PATCH/DELETE (and to
 * same-origin ones). A request whose Origin is another site — or the opaque
 * "null" origin of a sandboxed frame — is refused. Requests with no Origin
 * (curl, server-to-server) are allowed: they are not driven by a web page.
 */
export function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  if (origin === 'null') return true
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
    return new URL(origin).host !== host
  } catch {
    return true
  }
}
