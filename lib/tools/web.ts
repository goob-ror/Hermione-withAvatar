import tls from 'tls'
import type { ToolDef } from '@/lib/agent/types'

const MAX_BYTES = 2 * 1024 * 1024

/** Get domain allowlist from env or return unrestricted mode. */
export function allowedDomains(): string[] {
  const env = process.env.AGENT_ALLOWED_DOMAINS || ''
  // If explicitly set to "*" or "unrestricted", allow everything
  if (env.trim() === '*' || env.trim() === 'unrestricted') {
    return ['*']
  }
  return env
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export function isDomainAllowed(hostname: string): boolean {
  const allowed = allowedDomains()
  // If allowlist contains '*', allow everything
  if (allowed.includes('*')) {
    return true
  }
  // If allowlist is empty, deny everything
  if (allowed.length === 0) {
    return false
  }
  const host = hostname.toLowerCase()
  return allowed.some((a) => host === a || host.endsWith(`.${a}`))
}

function parseUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error(`not a valid URL: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`only http(s) URLs are allowed, got ${url.protocol}`)
  }
  return url
}

export const webFetch: ToolDef = {
  name: 'web_fetch',
  description:
    'Fetch a URL and return its text content (HTML tags are not stripped). http(s) only, 2 MB cap. Requires approval.',
  group: 'browse',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL' },
      max_chars: { type: 'number', description: 'Truncate the returned text to this many characters (default 8000)' },
    },
    required: ['url'],
  },
  async run(args) {
    const url = parseUrl(String(args.url ?? ''))
    const maxChars = Math.min(50000, Math.max(500, Number(args.max_chars) || 8000))

    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': 'Hermione/0.5 (local agent)' },
    })

    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BYTES) {
      return { ok: false, output: `response too large (${buf.length} bytes, cap ${MAX_BYTES})` }
    }

    const text = buf.toString('utf-8')
    const body = text.length > maxChars ? `${text.slice(0, maxChars)}\n… truncated at ${maxChars} chars` : text
    return {
      ok: res.ok,
      output: `# ${res.status} ${res.statusText} — ${url.toString()}\ncontent-type: ${res.headers.get('content-type') ?? '?'}\n\n${body}`,
    }
  },
}

function securityHeaders(headers: Headers): string[] {
  const checks: Array<[string, string]> = [
    ['strict-transport-security', 'HSTS'],
    ['content-security-policy', 'CSP'],
    ['x-frame-options', 'X-Frame-Options'],
    ['x-content-type-options', 'X-Content-Type-Options'],
    ['referrer-policy', 'Referrer-Policy'],
    ['permissions-policy', 'Permissions-Policy'],
  ]
  return checks.map(([key, label]) => `${headers.get(key) ? '✓' : '✗'} ${label}: ${headers.get(key) ?? 'absent'}`)
}

function readCertificate(hostname: string, port = 443): Promise<string> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate()
      if (!cert || !cert.valid_to) {
        resolve('TLS: certificate not presented')
      } else {
        resolve(
          `TLS: subject=${cert.subject?.CN ?? '?'} issuer=${cert.issuer?.O ?? cert.issuer?.CN ?? '?'} ` +
            `valid ${cert.valid_from} → ${cert.valid_to} protocol=${socket.getProtocol()}`,
        )
      }
      socket.end()
    })
    socket.on('error', (err) => resolve(`TLS: ${err.message}`))
    socket.on('timeout', () => {
      resolve('TLS: connection timed out')
      socket.destroy()
    })
  })
}

export const siteInspect: ToolDef = {
  name: 'site_inspect',
  description:
    'Passive inspection of an allowlisted host: response headers, security-header presence and TLS certificate. No scanning, no exploitation. Requires approval.',
  group: 'inspect',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Absolute http(s) URL on an allowlisted domain' },
    },
    required: ['url'],
  },
  async run(args) {
    const url = parseUrl(String(args.url ?? ''))
    if (!isDomainAllowed(url.hostname)) {
      return {
        ok: false,
        output:
          `${url.hostname} is not on the allowlist — refusing. ` +
          `Set AGENT_ALLOWED_DOMAINS (comma-separated) to permit it. Currently: ${allowedDomains().join(', ') || '(empty)'}`,
      }
    }

    const lines: string[] = [`# passive inspection — ${url.toString()}`]
    const tlsLine = url.protocol === 'https:' ? await readCertificate(url.hostname) : 'TLS: not used (http)'
    lines.push(tlsLine)

    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Hermione/0.5 (passive inspection)' },
      })
      lines.push(`status: ${res.status} ${res.statusText}`)
      lines.push(`server: ${res.headers.get('server') ?? 'absent'}`)
      lines.push(`powered-by: ${res.headers.get('x-powered-by') ?? 'absent'}`)
      lines.push('', 'security headers:')
      lines.push(...securityHeaders(res.headers).map((l) => `  ${l}`))

      const cookies = res.headers.getSetCookie?.() ?? []
      if (cookies.length) {
        lines.push('', 'set-cookie flags:')
        for (const c of cookies) {
          const name = c.split('=')[0]
          const flags = ['HttpOnly', 'Secure', 'SameSite'].filter((f) => c.toLowerCase().includes(f.toLowerCase()))
          lines.push(`  ${name}: ${flags.length ? flags.join(', ') : 'no HttpOnly/Secure/SameSite'}`)
        }
      }
    } catch (err: any) {
      lines.push(`request failed: ${err.message}`)
    }

    return { ok: true, output: lines.join('\n') }
  },
}
