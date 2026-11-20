import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { speak, speechStatus } from '@/lib/tts/speech'

/**
 * GET /api/tts  — is Hermione's voice (VoxCPM2) loaded? Calling it
 *                 also starts the service if it isn't running.
 * POST /api/tts — { text } → audio/wav, plus X-Voice-Engine.
 *
 * 503 when no voice is available: the browser then uses its own.
 */
export async function GET() {
  const s = await speechStatus()
  return NextResponse.json({
    available: !!s.engine,
    engine: s.engine,
    state: s.vox.state,
    error: s.vox.error ?? null,
    voice: s.engine ? 'VoxCPM2' : null,
  })
}

const TtsBody = z.object({
  text: z.string().trim().min(1).max(600),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, TtsBody)
  if (!parsed.ok) return parsed.response
  try {
    const { wav, engine } = await speak(parsed.data.text, { purpose: 'live', signal: req.signal })
    return new NextResponse(new Uint8Array(wav), {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wav.length),
        'Cache-Control': 'no-store',
        'X-Voice-Engine': engine,
      },
    })
  } catch (err: any) {
    const msg = err?.message || 'speech failed'
    const status = msg === 'busy' ? 429 : /no voice is available/.test(msg) ? 503 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
