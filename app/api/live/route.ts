import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { closeTab, history, input, liveAvailable, navigate, setMuted, setViewport } from '@/lib/browser/live'

export const dynamic = 'force-dynamic'

/** GET /api/live — is the live (real Chrome) preview available? */
export async function GET() {
  return NextResponse.json({ available: liveAvailable() })
}

const Point = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) }
const Button = z.enum(['left', 'right', 'middle']).optional()
const InputEvent = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['down', 'up', 'move']), ...Point, button: Button }),
  z.object({ type: z.literal('click'), ...Point, button: Button, count: z.number().int().min(1).max(3).optional() }),
  z.object({ type: z.literal('wheel'), ...Point, dx: z.number().min(-5000).max(5000), dy: z.number().min(-5000).max(5000) }),
  z.object({ type: z.literal('key'), key: z.string().min(1).max(40) }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(5000) }),
])

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), sessionId: z.string().min(1).max(200), url: z.string().min(1).max(4000) }),
  z.object({ action: z.enum(['back', 'forward', 'reload', 'close']), sessionId: z.string().min(1).max(200) }),
  z.object({ action: z.literal('mute'), sessionId: z.string().min(1).max(200), muted: z.boolean() }),
  z.object({ action: z.literal('viewport'), sessionId: z.string().min(1).max(200), width: z.number(), height: z.number() }),
  z.object({ action: z.literal('input'), sessionId: z.string().min(1).max(200), event: InputEvent }),
])

/**
 * POST /api/live — the operator driving the live preview tab.
 * (proxy.ts already restricts /api to Hermione's own page.)
 */
export async function POST(req: NextRequest) {
  if (!liveAvailable()) return NextResponse.json({ error: 'live preview unavailable (Chrome not found)' }, { status: 503 })
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    switch (b.action) {
      case 'navigate':
        return NextResponse.json(await navigate(b.sessionId, b.url))
      case 'back':
      case 'forward':
      case 'reload':
        await history(b.sessionId, b.action)
        return NextResponse.json({ ok: true })
      case 'close':
        await closeTab(b.sessionId)
        return NextResponse.json({ ok: true })
      case 'mute':
        await setMuted(b.sessionId, b.muted)
        return NextResponse.json({ ok: true })
      case 'viewport':
        await setViewport(b.sessionId, b.width, b.height)
        return NextResponse.json({ ok: true })
      case 'input':
        await input(b.sessionId, b.event)
        return NextResponse.json({ ok: true })
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err).split('\n')[0] }, { status: 500 })
  }
}
