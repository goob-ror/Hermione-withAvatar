import { NextRequest, NextResponse } from 'next/server'
import {
  loadPhase1Settings as loadSettings,
  savePhase1Settings as saveSettings,
  type Phase1Settings,
} from '@/lib/storage/phase1-settings'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'

export type { Phase1Settings }

export interface LazyDevSessionState {
  mode: 'auto' | 'always' | 'never'
  sessionAsked: boolean
  sessionEnabled: boolean
}


export async function GET() {
  const settings = loadSettings()
  return NextResponse.json(settings)
}

// Only known fields are saved — extra keys in the body are dropped.
const SettingsBody = z.object({
  rtkEnabled: z.boolean(),
  rtkLevel: z.enum(['low', 'medium', 'high']),
  lazyDevMode: z.enum(['auto', 'always', 'never']),
  showTokenCounter: z.boolean(),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = await parseBody(req, SettingsBody)
    if (!parsed.ok) return parsed.response
    const settings: Phase1Settings = parsed.data

    saveSettings(settings)
    return NextResponse.json({ success: true, settings })
  } catch (err) {
    console.error('Failed to save phase1 settings:', err)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
