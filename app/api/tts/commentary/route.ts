import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { commentaryLine } from '@/lib/tts/commentary'

/**
 * POST /api/tts/commentary { activity, detail?, elapsedS, said[], workers? } → { text, by }
 * One thinking line for Hermione to say while she works (voice helper, rules fallback).
 */
const Body = z.object({
  activity: z.string().trim().min(1).max(40),
  detail: z.string().trim().max(80).optional(),
  elapsedS: z.number().min(0).max(36_000),
  said: z.array(z.string().max(200)).max(20).default([]),
  workers: z.number().int().min(0).max(16).optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  return NextResponse.json(await commentaryLine(parsed.data))
}
