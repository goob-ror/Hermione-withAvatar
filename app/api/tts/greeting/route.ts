import { NextRequest, NextResponse } from 'next/server'
import { pickGreeting, type GreetingMode } from '@/lib/tts/greetings'

/**
 * GET /api/tts/greeting?mode=chat|forge&name=… → a cached intro greeting in
 * Hermione's natural voice (audio/wav), picked at random — or a freshly made
 * one when none is cached yet. 204 when there's nothing to play yet (the
 * natural voice is still loading and nothing is cached).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const mode: GreetingMode = p.get('mode') === 'forge' ? 'forge' : 'chat'
  const name = (p.get('name') ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40) || 'there'
  const g = await pickGreeting(mode, name).catch(() => null)
  if (!g) return new NextResponse(null, { status: 204 })
  return new NextResponse(new Uint8Array(g.wav), {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(g.wav.length),
      'Cache-Control': 'no-store',
      'X-Greeting': g.fresh ? 'new' : 'cached',
      'X-Greeting-Count': String(g.cached),
      'X-Greeting-Text': encodeURIComponent(g.text),
    },
  })
}
