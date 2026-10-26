import { NextResponse } from 'next/server'
import { openPage } from '@/lib/preview/open'
import { clearPage, pageInfo } from '@/lib/preview/store'

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
export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = String(body?.sessionId ?? '').trim()
  const url = String(body?.url ?? '').trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  const result = await openPage(sessionId, url, { maxChars: Number(body?.maxChars) || undefined })
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
