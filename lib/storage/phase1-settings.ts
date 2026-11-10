import fs from 'fs'
import path from 'path'
import { configDir } from '@/lib/agent/providers'

/** Operator settings for token saving (RTK) and lazy-dev mode. */
export interface Phase1Settings {
  rtkEnabled: boolean
  rtkLevel: 'low' | 'medium' | 'high'
  lazyDevMode: 'auto' | 'always' | 'never'
  showTokenCounter: boolean
}

export const DEFAULT_PHASE1_SETTINGS: Phase1Settings = {
  rtkEnabled: true,
  rtkLevel: 'medium',
  lazyDevMode: 'auto',
  showTokenCounter: true,
}

function settingsFile(): string {
  return path.join(configDir(), 'phase1-settings.json')
}

export function loadPhase1Settings(): Phase1Settings {
  try {
    const file = settingsFile()
    if (fs.existsSync(file)) {
      return { ...DEFAULT_PHASE1_SETTINGS, ...JSON.parse(fs.readFileSync(file, 'utf-8')) }
    }
  } catch (err) {
    console.error('Failed to load phase1 settings:', err)
  }
  return DEFAULT_PHASE1_SETTINGS
}

export function savePhase1Settings(settings: Phase1Settings): void {
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
}
