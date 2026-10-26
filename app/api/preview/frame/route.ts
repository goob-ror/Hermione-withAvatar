import { getPage } from '@/lib/preview/store'

export const dynamic = 'force-dynamic'

/**
 * GET /api/preview/frame?sessionId=… — serves the rewritten page that the
 * preview iframe renders. Served from our own origin on purpose: that is what
 * makes the document scriptable by the console (and by the bridge).
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
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
    )
  }

  return new Response(page.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
      // The frame is deliberately frameable and scriptable from the console.
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}
