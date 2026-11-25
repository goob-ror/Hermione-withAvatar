import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { getProvider, HELPER_ROLES, helperSetting, setHelperModel, type HelperRole } from '@/lib/agent/providers'
import { helperCandidates } from '@/lib/agent/helpers'

/**
 * Hermione's helper models (voice / worker / judge), separate from the main model.
 *   GET  → { helpers: { [role]: { mode: 'auto'|'saved'|'off', chain: [{ providerId, model, label, source }] } } }
 *   POST { role, mode: 'auto' } | { role, mode: 'off' } | { role, mode: 'pick', providerId, model }
 */
async function view() {
  const label = (id: string) => {
    try {
      return getProvider(id).label
    } catch {
      return id
    }
  }
  const out: Record<string, unknown> = {}
  for (const role of HELPER_ROLES) {
    const s = helperSetting(role)
    const chain = await helperCandidates(role)
    out[role] = {
      mode: !s ? 'auto' : 'off' in s ? 'off' : 'saved',
      chain: chain.map((m) => ({ ...m, label: label(m.providerId) })),
    }
  }
  return NextResponse.json({ helpers: out })
}

export async function GET() {
  return view()
}

const Role = z.enum(HELPER_ROLES)
const Body = z.discriminatedUnion('mode', [
  z.object({ role: Role, mode: z.literal('auto') }),
  z.object({ role: Role, mode: z.literal('off') }),
  z.object({ role: Role, mode: z.literal('pick'), providerId: z.string().trim().min(1).max(120), model: z.string().trim().min(1).max(200) }),
])

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    setHelperModel(b.role as HelperRole, b.mode === 'auto' ? null : b.mode === 'off' ? { off: true } : { providerId: b.providerId, model: b.model })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 400 })
  }
  return view()
}
