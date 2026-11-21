import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
// vi.mock below is hoisted above this import, so greetings.ts gets the stand-in voice.
import { GREETING_LINES, MAX_GREETINGS, greetingDir, nextLine, pickGreeting } from '@/lib/tts/greetings'

// Own config dir, and a stand-in for the VoxCPM2 voice (no GPU in tests).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-greet-'))
process.env.HERMIONE_CONFIG_DIR = dir

const vox = vi.hoisted(() => ({ ready: true, made: [] as string[] }))
vi.mock('@/lib/tts/voxcpm', () => ({
  voxHealth: async () => ({ state: vox.ready ? 'ready' : 'starting' }),
}))
vi.mock('@/lib/tts/voiceAgent', () => ({
  voiceModel: () => null,
  voiceLine: async (text: string) => ({ text, by: 'rules', ms: 0 }),
}))
vi.mock('@/lib/tts/speech', () => ({
  speak: async (text: string) => {
    vox.made.push(text)
    return { wav: Buffer.from(`RIFF-fake-wav:${text}`), engine: 'voxcpm' }
  },
}))


const settle = () => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  fs.rmSync(path.join(dir, 'voice-cache'), { recursive: true, force: true })
  vox.ready = true
  vox.made = []
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('intro greeting cache', () => {
  it('has five different lines for each screen', () => {
    for (const mode of ['chat', 'forge'] as const) {
      expect(GREETING_LINES[mode]).toHaveLength(MAX_GREETINGS)
      expect(new Set(GREETING_LINES[mode]).size).toBe(MAX_GREETINGS)
      expect(GREETING_LINES[mode].every((l) => l.includes('{name}'))).toBe(true)
    }
  })

  it('picks a line not cached yet, with the name filled in', () => {
    const used = GREETING_LINES.chat.slice(0, 4).map((l) => l.replaceAll('{name}', 'Serpto'))
    expect(nextLine('chat', 'Serpto', used)).toBe(GREETING_LINES.chat[4].replaceAll('{name}', 'Serpto'))
    expect(nextLine('chat', 'Serpto', GREETING_LINES.chat.map((l) => l.replaceAll('{name}', 'Serpto')))).toBeNull()
  })

  it('makes the first one on the spot, then fills up to 5 in the background, then only replays', async () => {
    const first = await pickGreeting('chat', 'Serpto')
    expect(first).toMatchObject({ fresh: true, cached: 1 })
    expect(first!.text).toContain('Serpto')

    for (let i = 0; i < 10; i++) {
      const g = await pickGreeting('chat', 'Serpto')
      expect(g?.fresh).toBe(false) // always instant from the cache
      await settle() // let the background top-up finish
    }
    const index = JSON.parse(fs.readFileSync(path.join(greetingDir('chat', 'Serpto'), 'index.json'), 'utf8'))
    expect(index.entries).toHaveLength(MAX_GREETINGS)
    expect(new Set(index.entries.map((e: any) => e.text)).size).toBe(MAX_GREETINGS) // all different
    expect(vox.made).toHaveLength(MAX_GREETINGS) // never more than 5 generated
  })

  it('keeps Chat and Content Forge separate', async () => {
    const chat = await pickGreeting('chat', 'Serpto')
    const forge = await pickGreeting('forge', 'Serpto')
    expect(GREETING_LINES.forge.map((l) => l.replaceAll('{name}', 'Serpto'))).toContain(forge!.text)
    expect(GREETING_LINES.chat.map((l) => l.replaceAll('{name}', 'Serpto'))).toContain(chat!.text)
  })

  it('returns nothing while the voice is loading and nothing is cached', async () => {
    vox.ready = false
    expect(await pickGreeting('forge', 'Serpto')).toBeNull()
    expect(vox.made).toHaveLength(0)
  })

  it('still plays cached greetings while the voice is loading', async () => {
    await pickGreeting('chat', 'Serpto')
    vox.ready = false
    const g = await pickGreeting('chat', 'Serpto')
    expect(g?.fresh).toBe(false)
  })

  it('starts a fresh cache for a different name', async () => {
    await pickGreeting('chat', 'Serpto')
    const other = await pickGreeting('chat', 'Alex')
    expect(other).toMatchObject({ fresh: true, cached: 1 })
    expect(other!.text).toContain('Alex')
  })
})
