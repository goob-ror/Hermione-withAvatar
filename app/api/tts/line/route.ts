import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { voiceLine } from '@/lib/tts/voiceAgent'

/**
 * POST /api/tts/line { text, style } → { text, by, model?, ms }
 * Hermione's voice subagent turns a line she is about to say into spoken
 * dialog (persona, energy, at most one expression tag). Falls back to the
 * deterministic rules on any failure, so it always answers.
 */
const Body = z.object({
  text: z.string().trim().min(1).max(600),
  style: z.enum(['summary', 'greeting']).default('summary'),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const line = await voiceLine(parsed.data.text, parsed.data.style)
  return NextResponse.json(line)
}
