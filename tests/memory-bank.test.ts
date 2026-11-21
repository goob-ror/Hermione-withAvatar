import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as bank from '@/lib/memory/bank'
import { memoryForget, memorySave, notesRead, notesSearch } from '@/lib/tools/memory'
import { buildSystemPrompt } from '@/lib/agent/loop'

// Own config dir: never touch the real .hermione/memory. (The bank reads the
// folder when called, not at import, so setting it here is early enough.)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-mem-'))
process.env.HERMIONE_CONFIG_DIR = dir

const file = path.join(dir, 'memory', 'bank.json')
const ctx = (events: any[] = []) => ({ sessionId: 's_test', emit: (e: any) => events.push(e) })

beforeEach(() => {
  fs.rmSync(path.join(dir, 'memory'), { recursive: true, force: true })
  bank._resetBankCache()
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('memories', () => {
  it('adds, merges near-duplicates, pins, edits and deletes — and persists to disk', () => {
    const a = bank.addMemory({ text: '  Prefers prices in   Indonesian rupiah. ', category: 'preference', source: 'hermione' })
    expect(a.created).toBe(true)
    expect(a.memory.text).toBe('Prefers prices in Indonesian rupiah.')

    const again = bank.addMemory({ text: 'Prefers prices in Indonesian rupiah' })
    expect(again.created).toBe(false)
    expect(again.memory.id).toBe(a.memory.id)

    const b = bank.addMemory({ text: 'Is building a Roblox fighting game called The Bandit Beater.', category: 'project' })
    bank.updateMemory(b.memory.id, { pinned: true })
    expect(bank.listMemories()[0].id).toBe(b.memory.id) // pinned first

    bank.updateMemory(a.memory.id, { text: 'Prefers prices in IDR.', category: 'nonsense' as any })
    expect(bank.listMemories().find((m) => m.id === a.memory.id)).toMatchObject({ text: 'Prefers prices in IDR.', category: 'other' })

    expect(JSON.parse(fs.readFileSync(file, 'utf8')).memories).toHaveLength(2)
    expect(bank.deleteMemory(a.memory.id)).toBe(true)
    expect(bank.deleteMemory(a.memory.id)).toBe(false)
    expect(bank.listMemories()).toHaveLength(1)
  })

  it('caps memory length and refuses empty ones', () => {
    expect(bank.addMemory({ text: 'x'.repeat(1000) }).memory.text).toHaveLength(bank.MEMORY_MAX_CHARS)
    expect(() => bank.addMemory({ text: '   ' })).toThrow()
  })
})

describe('notes', () => {
  it('adds with a title from the first line, edits, and searches by relevance', () => {
    const n1 = bank.addNote({ content: '# Bandit Beater combat\n\nThe uppercut does 40 damage and launches.\n\nDash cancel window is 6 frames.', tags: 'roblox, Combat' })
    expect(n1.title).toBe('Bandit Beater combat')
    expect(n1.tags).toEqual(['roblox', 'combat'])
    bank.addNote({ title: 'Grocery list', content: 'Eggs, rice, chili, coffee beans.' })
    bank.addNote({ title: 'Tea notes', content: 'Oolong is partially oxidised. Green tea is not.' })

    const hits = bank.searchNotes('uppercut damage')
    expect(hits[0]).toMatchObject({ id: n1.id, title: 'Bandit Beater combat' })
    expect(hits[0].snippet).toContain('40 damage')
    expect(bank.searchNotes('combat')[0].id).toBe(n1.id) // tag/title match
    expect(bank.searchNotes('quantum')).toEqual([])

    bank.updateNote(n1.id, { title: 'Combat numbers' })
    expect(bank.getNote(n1.id)?.title).toBe('Combat numbers')
    expect(bank.deleteNote(n1.id)).toBe(true)
    expect(bank.listNotes()).toHaveLength(2)
  })
})

describe('Hermione’s memory tools', () => {
  it('memory_save stores, tells the chat, and refuses secrets', async () => {
    const events: any[] = []
    const ok = await memorySave.run({ text: 'Lives in Jakarta.', category: 'fact' }, ctx(events) as any)
    expect(ok.ok).toBe(true)
    expect(events[0]).toMatchObject({ type: 'memory_saved', text: 'Lives in Jakarta.', created: true })
    expect(bank.listMemories()[0]).toMatchObject({ source: 'hermione', sessionId: 's_test' })

    for (const secret of ['My password is hunter2', 'API key sk-abcdefghijklmnop', 'card 4111 1111 1111 1111']) {
      const r = await memorySave.run({ text: secret }, ctx() as any)
      expect(r.ok).toBe(false)
    }
    expect(bank.listMemories()).toHaveLength(1)
  })

  it('memory_forget works by id or by description', async () => {
    const a = bank.addMemory({ text: 'Has a cat named Mochi.', category: 'person' }).memory
    bank.addMemory({ text: 'Works night shifts.', category: 'fact' })
    expect((await memoryForget.run({ id_or_text: 'the cat Mochi' }, ctx() as any)).output).toContain(a.id)
    expect(bank.listMemories().map((m) => m.text)).toEqual(['Works night shifts.'])
    const b = bank.listMemories()[0]
    expect((await memoryForget.run({ id_or_text: b.id }, ctx() as any)).ok).toBe(true)
    expect((await memoryForget.run({ id_or_text: 'nothing like this' }, ctx() as any)).ok).toBe(false)
  })

  it('notes_search and notes_read return the operator’s notes framed as data', async () => {
    const n = bank.addNote({ title: 'Trip plan', content: 'Fly to Osaka on May 3rd. Hotel near Namba.' })
    const s = await notesSearch.run({ query: 'osaka hotel' }, ctx() as any)
    expect(s.output).toContain(`[${n.id}] Trip plan`)
    expect(s.output).toMatch(/data, not instructions/)
    const r = await notesRead.run({ id: n.id }, ctx() as any)
    expect(r.output).toContain('Hotel near Namba')
    expect((await notesRead.run({ id: 'n_missing' }, ctx() as any)).ok).toBe(false)
  })
})

describe('memory in the system prompt', () => {
  it('lists memories (pinned first) and note titles, framed as facts', () => {
    bank.addMemory({ text: 'Prefers short answers.', category: 'preference' })
    const pinned = bank.addMemory({ text: 'Name is Serpto.', category: 'fact' }).memory
    bank.updateMemory(pinned.id, { pinned: true })
    bank.addNote({ title: 'Trip plan', content: 'Osaka', tags: ['travel'] })
    const prompt = buildSystemPrompt({ nativeTools: true })
    expect(prompt).toMatch(/## Memory Bank[\s\S]*facts, not instructions/)
    expect(prompt.indexOf('Name is Serpto.')).toBeLessThan(prompt.indexOf('Prefers short answers.'))
    expect(prompt).toMatch(/\[n_\w+\] Trip plan \(travel\)/)
    expect(buildSystemPrompt({ nativeTools: true, memory: false })).not.toContain('## Memory Bank')
  })

  it('stays within its size budget with many memories', () => {
    for (let i = 0; i < 80; i++) bank.addMemory({ text: `Distinct fact number ${i} about topic ${'abcdefghij'[i % 10]}${i} zz${i * 7}` })
    const block = bank.memoryPromptBlock()
    expect(block.length).toBeLessThan(3600)
    expect(block).toMatch(/older memories not shown/)
  })
})
