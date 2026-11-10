import { NextResponse } from 'next/server'
import { openPage } from '@/lib/preview/open'
import { clearPage, pageInfo } from '@/lib/preview/store'
import { z } from 'zod'
import { id, parseBody } from '@/lib/http/validate'

export const dynamic = 'force-dynamic'

/** GET /api/preview?sessionId=… — what is currently loaded. */
export async function GET(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId') || ''
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  return NextResponse.json(pageInfo(sessionId))
}

/**
 * POST /api/preview {sessionId, url} — open a URL in the preview panel.
 * Same allowlist and same caps as the `page_open` tool; this exists so the
 * operator can drive the panel directly without going through the model.
 */
const PreviewBody = z.object({
  sessionId: id(),
  url: id(4000),
  maxChars: z.number().int().positive().max(60_000).optional(),
})

export async function POST(req: Request) {
  const parsed = await parseBody(req, PreviewBody)
  if (!parsed.ok) return parsed.response
  const { sessionId, url } = parsed.data
  const body = parsed.data

  // The operator typed this URL into the preview bar themselves — that is the
  // visit consent. (proxy.ts guarantees only Hermione's own page can call this.)
  const result = await openPage(sessionId, url, { maxChars: Number(body?.maxChars) || undefined, acknowledged: true })
  if (!result.ok) return NextResponse.json({ ok: false, error: result.output }, { status: 400 })

  return NextResponse.json({
    ok: true,
    url: result.page!.url,
    title: result.page!.title,
    description: result.page!.description,
    textLength: result.page!.text.length,
    bytes: result.page!.bytes,
  })
}

/** DELETE /api/preview?sessionId=… — close the page. */
export async function DELETE(req: Request) {
  const sessionId = new URL(req.url).searchParams.get('sessionId') || ''
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  clearPage(sessionId)
  return NextResponse.json({ ok: true })
}
