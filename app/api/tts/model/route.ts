import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { getProvider, setVoiceModel, voiceModelSetting } from '@/lib/agent/providers'
import { voiceModel } from '@/lib/tts/voiceAgent'

/**
 * The model behind Hermione's voice subagent (separate from the chat model).
 *   GET  → { mode: 'auto' | 'saved' | 'off', effective: { providerId, model, label, source } | null }
 *   POST { mode: 'auto' } | { mode: 'off' } | { mode: 'pick', providerId, model }
 */
function view() {
  const setting = voiceModelSetting()
  const m = voiceModel()
  let label = ''
  try {
    if (m) label = getProvider(m.providerId).label
  } catch {
    /* provider removed */
  }
  return NextResponse.json({
    mode: !setting ? 'auto' : 'off' in setting ? 'off' : 'saved',
    effective: m ? { ...m, label } : null,
  })
}

export async function GET() {
  return view()
}

const Body = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('auto') }),
  z.object({ mode: z.literal('off') }),
  z.object({ mode: z.literal('pick'), providerId: z.string().trim().min(1).max(120), model: z.string().trim().min(1).max(200) }),
])

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    setVoiceModel(b.mode === 'auto' ? null : b.mode === 'off' ? { off: true } : { providerId: b.providerId, model: b.model })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 400 })
  }
  return view()
}
