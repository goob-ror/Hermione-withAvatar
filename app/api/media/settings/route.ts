import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { ffmpegPath, groqKey, pexelsKey, saveMediaKeys } from '@/lib/media/config'
import { speechStatus } from '@/lib/tts/speech'

/**
 * Clip studio setup. GET → what's ready (never the keys themselves).
 * POST { pexelsKey?, groqKey? } → save ('' clears one).
 */
export async function GET() {
  const speech = await speechStatus()
  return NextResponse.json({
    ffmpeg: !!(await ffmpegPath()),
    vox: speech.vox.state,
    voxError: speech.vox.error ?? null,
    pexels: !!pexelsKey(),
    groq: !!groqKey(),
  })
}

const Keys = z.object({
  pexelsKey: z.string().max(200).nullable().optional(),
  groqKey: z.string().max(200).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Keys)
  if (!parsed.ok) return parsed.response
  saveMediaKeys(parsed.data)
  return NextResponse.json({ ok: true, pexels: !!pexelsKey(), groq: !!groqKey() })
}
