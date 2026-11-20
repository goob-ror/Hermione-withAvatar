import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { speakStream } from '@/lib/tts/speech'

/**
 * POST /api/tts/stream { text } → raw 16-bit mono PCM, streamed while VoxCPM2
 * generates it (X-Sample-Rate tells the rate). The browser starts playing
 * after about a second instead of waiting for the whole line.
 * 503 when the voice isn't available: the browser then uses /api/tts or its own voice.
 */
const Body = z.object({ text: z.string().trim().min(1).max(600) })

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  try {
    const { body, sampleRate } = await speakStream(parsed.data.text, { purpose: 'live', signal: req.signal })
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Sample-Rate': String(sampleRate),
        'X-Voice-Engine': 'voxcpm',
      },
    })
  } catch (err: any) {
    const msg = err?.message || 'speech failed'
    return NextResponse.json({ error: msg }, { status: /no voice is available/.test(msg) ? 503 : 500 })
  }
}
