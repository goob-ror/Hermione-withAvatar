import dns from 'dns/promises'
import net from 'net'

/**
 * fetch() restricted to the PUBLIC internet, for tools that run without
 * approval. Every hop (including redirects) must resolve only to public
 * addresses, so a page can't steer the agent into localhost (Hermione's own
 * API), the LAN (routers, NAS), or cloud metadata endpoints.
 */

export class PrivateAddressError extends Error {}

function isPrivateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  )
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('::ffff:')) return isPrivateV4(lower.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower)
}

export function isPrivateIp(ip: string): boolean {
  return net.isIPv4(ip) ? isPrivateV4(ip) : net.isIPv6(ip) ? isPrivateV6(ip) : true
}

export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PrivateAddressError(`only http(s) URLs are allowed, got ${url.protocol}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new PrivateAddressError(`${host} is a local address — not reachable by automatic tools`)
  }
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address)
  if (!addresses.length) throw new Error(`could not resolve ${host}`)
  const bad = addresses.find(isPrivateIp)
  if (bad) throw new PrivateAddressError(`${host} resolves to a private address (${bad}) — not reachable by automatic tools`)
}

/** fetch that re-checks every redirect hop. */
export async function publicFetch(
  input: string | URL,
  init: RequestInit & { maxRedirects?: number } = {},
): Promise<{ res: Response; finalUrl: URL }> {
  let url = new URL(String(input))
  const maxRedirects = init.maxRedirects ?? 5
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(url)
    const res = await fetch(url, { ...init, redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url)
      continue
    }
    return { res, finalUrl: url }
  }
  throw new Error(`too many redirects (>${maxRedirects})`)
}
