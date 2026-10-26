import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export interface Phase1Settings {
  rtkEnabled: boolean
  rtkLevel: 'low' | 'medium' | 'high'
  lazyDevMode: 'auto' | 'always' | 'never'
  showTokenCounter: boolean
}

export interface LazyDevSessionState {
  mode: 'auto' | 'always' | 'never'
  sessionAsked: boolean
  sessionEnabled: boolean
}

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function settingsFile(): string {
  return path.join(configDir(), 'phase1-settings.json')
}

const DEFAULT_SETTINGS: Phase1Settings = {
  rtkEnabled: true,
  rtkLevel: 'medium',
  lazyDevMode: 'auto',
  showTokenCounter: true,
}

function loadSettings(): Phase1Settings {
  try {
    const file = settingsFile()
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      return { ...DEFAULT_SETTINGS, ...data }
    }
  } catch (err) {
    console.error('Failed to load phase1 settings:', err)
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: Phase1Settings): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const file = settingsFile()
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf-8')
}

export async function GET() {
  const settings = loadSettings()
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  try {
    const settings: Phase1Settings = await req.json()

    // Validate
    if (typeof settings.rtkEnabled !== 'boolean') {
      return NextResponse.json({ error: 'Invalid rtkEnabled' }, { status: 400 })
    }
    if (!['low', 'medium', 'high'].includes(settings.rtkLevel)) {
      return NextResponse.json({ error: 'Invalid rtkLevel' }, { status: 400 })
    }
    if (!['auto', 'always', 'never'].includes(settings.lazyDevMode)) {
      return NextResponse.json({ error: 'Invalid lazyDevMode' }, { status: 400 })
    }
    if (typeof settings.showTokenCounter !== 'boolean') {
      return NextResponse.json({ error: 'Invalid showTokenCounter' }, { status: 400 })
    }

    saveSettings(settings)
    return NextResponse.json({ success: true, settings })
  } catch (err) {
    console.error('Failed to save phase1 settings:', err)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }
}
