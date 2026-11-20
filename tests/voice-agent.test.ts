import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanVoiceReply, ruleLine, voiceLine, voiceModel, DEFAULT_GEMINI_VOICE_MODEL, type VoiceModel } from '@/lib/tts/voiceAgent'

// Own config dir: never touch the real .hermione/providers.json.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-voiceagent-'))
process.env.HERMIONE_CONFIG_DIR = dir
const file = path.join(dir, 'providers.json')
const GEMINI = { id: 'gem', kind: 'openai', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', createdAt: 1, updatedAt: 1 }
const MAIN = { id: 'main', kind: 'openai', label: 'Main', baseUrl: 'https://example.test/v1', defaultModel: 'big-model', createdAt: 1, updatedAt: 1 }
const writeProviders = (extra: object = {}, providers: object[] = [MAIN, GEMINI]) =>
  fs.writeFileSync(file, JSON.stringify({ version: 1, activeId: 'main', providers, ...extra }))

beforeEach(() => {
  writeProviders()
  delete process.env.HERMIONE_VOICE_MODEL
  delete process.env.HERMIONE_VOICE_PROVIDER
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const model: VoiceModel = { providerId: 'gem', model: 'flash', source: 'gemini' }
const fake = (text: string | Error, seen: any[] = []) =>
  (async (opts: any) => {
    seen.push(opts)
    if (text instanceof Error) throw text
    return { text, model: 'flash', providerId: 'gem' }
  }) as any

describe('which model is the voice subagent', () => {
  it('defaults to Gemini Flash Lite when a Gemini provider exists, else the main chat model', () => {
    expect(voiceModel()).toMatchObject({ providerId: 'gem', model: DEFAULT_GEMINI_VOICE_MODEL, source: 'gemini' })
    writeProviders({}, [MAIN])
    expect(voiceModel()).toMatchObject({ providerId: 'main', model: 'big-model', source: 'main' })
  })

  it('a saved choice wins; saved "off" and HERMIONE_VOICE_MODEL=off turn it off', () => {
    writeProviders({ voice: { providerId: 'main', model: 'small-model' } })
    expect(voiceModel()).toMatchObject({ providerId: 'main', model: 'small-model', source: 'saved' })
    writeProviders({ voice: { off: true } })
    expect(voiceModel()).toBeNull()
    writeProviders()
    process.env.HERMIONE_VOICE_MODEL = 'off'
    expect(voiceModel()).toBeNull()
  })
})

describe('voiceLine', () => {
  it('uses the model reply, applying the persona rules (sir, one tag)', async () => {
    const seen: any[] = []
    const r = await voiceLine('Hi, Serpto. Ready when you are.', 'greeting', {
      model,
      complete: fake('"<chuckle> Well hello, Serpto! <laugh> Ready when you are."', seen),
    })
    expect(r.by).toBe('model')
    expect(r.text).toBe('<chuckle> Well hello, sir! Ready when you are.')
    expect(seen[0]).toMatchObject({ providerId: 'gem', model: 'flash' })
    expect(seen[0].prompt).toContain('sir') // the name never reaches the voice model
    expect(seen[0].system).toMatch(/greeting/i)
  })

  it('falls back to the rules on errors, timeouts and doubtful replies', async () => {
    const a = await voiceLine('Haha, found 3 picks for you.', 'summary', { model, complete: fake(new Error('timeout')) })
    expect(a).toMatchObject({ by: 'rules', text: '<chuckle> Found 3 picks for you.', error: 'timeout' })
    // Lost a number → not trusted.
    const b = await voiceLine('Found 3 picks for you.', 'summary', { model, complete: fake('Found a few picks for you.') })
    expect(b.by).toBe('rules')
    // Way too long → not trusted.
    const c = await voiceLine('Done.', 'summary', { model, complete: fake('Done. '.repeat(60)) })
    expect(c.by).toBe('rules')
  })

  it('with the voice model off it is just the rules, with no model call', async () => {
    const seen: any[] = []
    const r = await voiceLine('Hello, Serpto.', 'greeting', { model: null, complete: fake('x', seen) })
    expect(seen).toHaveLength(0)
    expect(r).toMatchObject({ by: 'rules', text: 'Hello, sir!' })
    expect(ruleLine('Hello, Serpto.', 'summary')).toBe('Hello, sir.')
  })

  it('cleans model chatter: fences, labels, emoji, unknown tags', () => {
    expect(cleanVoiceReply('Hermione: "All set, sir. <wink> 🎉"', 'All set.')).toBe('All set, sir.')
    expect(cleanVoiceReply('   ', 'All set.')).toBeNull()
  })
})
