import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Own config dir: never touch the real .hermione/providers.json.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-helpers-'))
process.env.HERMIONE_CONFIG_DIR = dir
const file = path.join(dir, 'providers.json')

// Model lists as discovery would report them (no network in tests).
vi.mock('@/lib/agent/discovery', () => ({
  allProviderModels: async () => [
    { providerId: 'router', label: '9router', online: true, models: [{ id: 'Hermione' }, { id: 'kr/claude-haiku-4.5-thinking' }, { id: 'kr/claude-haiku-4.5' }] },
    { providerId: 'gem', label: 'Google Gemini', online: true, models: [{ id: 'gemini-3.1-flash-lite' }] },
  ],
}))

import { helperCandidates, helperComplete } from '@/lib/agent/helpers'
import { familyOf } from '@/lib/agent/failover'

const ROUTER = { id: 'router', kind: 'openai', label: '9router', baseUrl: 'https://router.example/v1', defaultModel: 'Hermione', createdAt: 1, updatedAt: 1 }
const GEMINI = { id: 'gem', kind: 'openai', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', createdAt: 1, updatedAt: 1 }
const write = (extra: object = {}) => fs.writeFileSync(file, JSON.stringify({ version: 1, activeId: 'router', providers: [ROUTER, GEMINI], ...extra }))

beforeEach(() => {
  write()
  for (const r of ['VOICE', 'WORKER', 'JUDGE']) delete process.env[`HERMIONE_${r}_MODEL`]
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const ids = (list: { providerId: string; model: string }[]) => list.map((m) => `${m.providerId}::${m.model}`)

describe('helper models', () => {
  it('defaults: workers and judge on Claude Haiku, voice on Gemini Flash Lite, each falling back to Gemini then the main model', async () => {
    expect(ids(await helperCandidates('worker'))).toEqual(['router::kr/claude-haiku-4.5', 'gem::gemini-3.1-flash-lite', 'router::Hermione'])
    expect(ids(await helperCandidates('judge'))).toEqual(['router::kr/claude-haiku-4.5', 'gem::gemini-3.1-flash-lite', 'router::Hermione'])
    expect(ids(await helperCandidates('voice'))).toEqual(['gem::gemini-3.1-flash-lite', 'router::Hermione'])
  })

  it('a saved choice or env model comes first; "off" means no helper at all', async () => {
    write({ helpers: { worker: { providerId: 'gem', model: 'gemini-3.1-flash-lite' }, judge: { off: true } } })
    expect(ids(await helperCandidates('worker'))).toEqual(['gem::gemini-3.1-flash-lite', 'router::Hermione'])
    expect(await helperCandidates('judge')).toEqual([])
    process.env.HERMIONE_VOICE_MODEL = 'off'
    expect(await helperCandidates('voice')).toEqual([])
  })

  it('reads the older top-level "voice" setting', async () => {
    write({ voice: { off: true } })
    expect(await helperCandidates('voice')).toEqual([])
  })

  it('helperComplete falls back down the chain, and turns Gemini thinking off', async () => {
    const seen: any[] = []
    const complete = (async (opts: any) => {
      seen.push(opts)
      if (opts.model === 'kr/claude-haiku-4.5') throw new Error('503 busy')
      return { text: 'ok', model: opts.model, providerId: opts.providerId }
    }) as any
    const out = await helperComplete('worker', { prompt: 'hi' }, { complete })
    expect(out.model).toBe('gemini-3.1-flash-lite')
    expect(seen.map((s) => s.model)).toEqual(['kr/claude-haiku-4.5', 'gemini-3.1-flash-lite'])
    expect(seen[1].reasoningEffort).toBe('none')
    expect(seen[0].reasoningEffort).toBeUndefined()
  })

  it('failover recognises model families', () => {
    expect(familyOf('kr/claude-haiku-4.5')).toBe('claude')
    expect(familyOf('kr/gpt-5.6-sol')).toBe('gpt')
    expect(familyOf('Hermione')).toBe('')
  })
})
