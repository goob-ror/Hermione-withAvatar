// Operator-consent state for capabilities the browser cannot ask for on the
// agent's behalf: geolocation, notifications, and filesystem reach.
//
// Kept server-side so the agent can read what it is allowed to do, and so a
// restart does not silently re-grant anything. Browser-native permissions
// (Notifications, geolocation prompt) are still requested by the client; this
// store only records the operator's answer and what the agent may assume.

import fs from 'node:fs'
import path from 'node:path'
import { configDir } from '@/lib/agent/providers'

export type CapabilityId = 'location' | 'notifications' | 'filesystem'
export type CapabilityState = 'granted' | 'denied' | 'prompt'

export interface CapabilityRecord {
  id: CapabilityId
  state: CapabilityState
  /** Free-form detail: chosen directory, accuracy mode, scopes. */
  detail?: string
  decidedAt?: number
}

/** Every capability the UI knows how to ask about. */
export const CAPABILITIES: ReadonlyArray<{
  id: CapabilityId
  title: string
  blurb: string
  /** What the agent gains. Shown verbatim in the modal. */
  grants: string
  /** What it does NOT gain. Shown verbatim. */
  limits: string
  browserBacked: boolean
}> = Object.freeze([
  {
    id: 'location',
    title: 'Location',
    blurb: 'Let Hermione use your approximate location for local results and time-aware answers.',
    grants: 'Coarse position (city-level), read on demand. Shared with the active model only when a task needs it.',
    limits: 'Never stored on disk, never sent to a provider you are not currently using, never tracked over time.',
    browserBacked: true,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    blurb: 'Let Hermione raise a desktop notification when a long task finishes or needs you.',
    grants: 'Permission to show notifications from this app while it is open or serving in the background.',
    limits: 'No access to your other notifications, no ability to read or dismiss them.',
    browserBacked: true,
  },
  {
    id: 'filesystem',
    title: 'Files & folders',
    blurb: 'Let Hermione reach specific folders outside the project root.',
    grants: 'Read — and optionally write — inside folders you pick, one at a time.',
    limits: 'Nothing outside the folders you add. The project root stays the default boundary.',
    browserBacked: false,
  },
])

function storePath(): string {
  return path.join(configDir(), 'permissions.json')
}

interface StoredShape {
  version: 1
  capabilities: CapabilityRecord[]
  /** Extra folders the operator allowed beyond the agent root. */
  extraFolders: { path: string; mode: 'read' | 'write'; addedAt: number }[]
}

function read(): StoredShape {
  try {
    const text = fs.readFileSync(storePath(), 'utf-8')
    const parsed = JSON.parse(text)
    return {
      version: 1,
      capabilities: Array.isArray(parsed?.capabilities) ? parsed.capabilities : [],
      extraFolders: Array.isArray(parsed?.extraFolders) ? parsed.extraFolders : [],
    }
  } catch {
    return { version: 1, capabilities: [], extraFolders: [] }
  }
}

function write(next: StoredShape): void {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  const file = storePath()
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      /* best effort */
    }
  }
}

/** Current state of every capability, with `prompt` for anything undecided. */
export function permissionsView(): { capabilities: CapabilityRecord[]; extraFolders: StoredShape['extraFolders'] } {
  const stored = read()
  const byId = new Map(stored.capabilities.map((c) => [c.id, c]))
  return {
    capabilities: CAPABILITIES.map((c) => byId.get(c.id) ?? { id: c.id, state: 'prompt' as CapabilityState }),
    extraFolders: stored.extraFolders,
  }
}

export function setCapability(id: CapabilityId, state: CapabilityState, detail?: string): CapabilityRecord {
  if (!CAPABILITIES.some((c) => c.id === id)) throw new Error(`unknown capability: ${id}`)
  const stored = read()
  const record: CapabilityRecord = { id, state, detail, decidedAt: Date.now() }
  stored.capabilities = [...stored.capabilities.filter((c) => c.id !== id), record]
  write(stored)
  return record
}

export function addFolder(folderPath: string, mode: 'read' | 'write'): StoredShape['extraFolders'][number] {
  const resolved = path.resolve(folderPath)
  const stored = read()
  const entry = { path: resolved, mode, addedAt: Date.now() }
  stored.extraFolders = [...stored.extraFolders.filter((f) => f.path !== resolved), entry]
  write(stored)
  return entry
}

export function removeFolder(folderPath: string): boolean {
  const resolved = path.resolve(folderPath)
  const stored = read()
  const before = stored.extraFolders.length
  stored.extraFolders = stored.extraFolders.filter((f) => f.path !== resolved)
  write(stored)
  return stored.extraFolders.length !== before
}

/** Extra folders the operator granted, for the path guard in lib/tools/fs.ts. */
export function grantedFolders(): StoredShape['extraFolders'] {
  return read().extraFolders
}

/** Does this absolute path sit inside a granted folder? */
export function isInsideGrantedFolder(absPath: string): { allowed: boolean; mode?: 'read' | 'write' } {
  const resolved = path.resolve(absPath)
  for (const folder of read().extraFolders) {
    const rel = path.relative(folder.path, resolved)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return { allowed: true, mode: folder.mode }
    }
  }
  return { allowed: false }
}