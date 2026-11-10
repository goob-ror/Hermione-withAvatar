import { getPage } from '@/lib/preview/store'

export const dynamic = 'force-dynamic'

/**
 * Every previewed page is SANDBOXED: it gets an opaque origin, so its own
 * scripts cannot read Hermione's cookies/storage, script the console window,
 * or make same-origin calls to /api/* (those arrive with `Origin: null` and are
 * refused by proxy.ts). The console still drives the page through the
 * postMessage bridge, which works across origins.
 *
 * The header enforces this even if the frame URL is opened directly in a tab;
 * the iframe's `sandbox` attribute is a second, independent layer.
 * No allow-same-origin, no allow-top-navigation, no allow-modals.
 */
const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups'

/**
 * GET /api/preview/frame?sessionId=… — serves the rewritten page that the
 * preview iframe renders.
 */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId') || ''
  const page = sessionId ? getPage(sessionId) : undefined

  if (!page) {
    return new Response(
      `<!doctype html><html><head><meta charset="utf-8"><title>No page</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0e0e0f;color:#6f6a70;
font:12px ui-monospace,monospace;text-align:center;padding:24px}</style></head>
<body><div>No page loaded.<br>Type a URL above, or ask the agent to run <code>page_open</code>.</div></body></html>`,
      {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': SANDBOX_CSP,
        },
      },
    )
  }

  return new Response(page.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      // Frameable only by the console itself.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': SANDBOX_CSP,
      'Referrer-Policy': 'no-referrer',
    },
  })
}
