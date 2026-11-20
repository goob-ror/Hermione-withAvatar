// Rewrites a fetched page so it can be rendered *inside* the console as a
// same-origin iframe the parent can script. That same-origin property is the
// whole reason the agent can act on the page without a native browser control.

import { bridgeScript } from './bridge'

// The bridge lives in ./bridge (numbered element snapshot, act-by-number, smart waits).
export { bridgeScript }

/**
 * Strip the bits that would stop this document rendering in a frame, pin
 * relative URLs to the real origin with <base>, and append the bridge.
 */
export function rewriteHtml(html: string, pageUrl: string): string {
  let out = html

  // CSP metas would block our inline bridge (and any external asset).
  out = out.replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')

  // A page-provided <base> would fight ours.
  out = out.replace(/<base\b[^>]*>/gi, '')

  let baseHref = pageUrl
  try {
    baseHref = new URL('.', pageUrl).href
  } catch {
    // keep the raw url
  }
  const base = `<base href="${escapeAttr(baseHref)}">`

  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (match) => `${match}\n${base}`)
  } else {
    out = `${base}\n${out}`
  }

  const bridge = bridgeScript(pageUrl)
  if (/<\/body\s*>/i.test(out)) {
    out = out.replace(/<\/body\s*>/i, `${bridge}\n</body>`)
  } else {
    out = `${out}\n${bridge}`
  }

  return out
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
