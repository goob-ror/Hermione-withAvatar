import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/**
 * The Memory Bank: what Hermione remembers about the operator across chats,
 * plus a library of the operator's notes she can search.
 *
 *   .hermione/memory/bank.json  { version, memories[], notes[] }
 *
 * Memories are short facts/preferences, added to her system prompt on every
 * message. Notes are longer texts, searched on demand (notes_search).
 */

export const MEMORY_CATEGORIES = ['preference', 'fact', 'project', 'person', 'other'] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export interface Memory {
  id: string
  text: string
  category: MemoryCategory
  pinned: boolean
  /** Who added it: Hermione (memory_save) or the operator (the page). */
  source: 'hermione' | 'you'
  sessionId?: string
  createdAt: number
  updatedAt: number
}

export interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

interface BankFile {
  version: 1
  memories: Memory[]
  notes: Note[]
}

export const MEMORY_MAX_CHARS = 300
export const NOTE_MAX_CHARS = 200_000
const MAX_MEMORIES = 500
const MAX_NOTES = 1000

function bankFile(): string {
  const root = path.resolve(process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'))
  return path.join(root, 'memory', 'bank.json')
}

let cache: { file: string; data: BankFile } | null = null

function load(): BankFile {
  const file = bankFile()
  if (cache?.file === file) return cache.data
  let data: BankFile = { version: 1, memories: [], notes: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    data = {
      version: 1,
      memories: Array.isArray(raw?.memories) ? raw.memories : [],
      notes: Array.isArray(raw?.notes) ? raw.notes : [],
    }
  } catch {
    /* first run, or unreadable — start empty */
  }
  cache = { file, data }
  return data
}

function save(data: BankFile) {
  const file = bankFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
  cache = { file, data }
}

/** For tests: forget the in-process copy. */
export function _resetBankCache() {
  cache = null
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const category = (c: unknown): MemoryCategory =>
  (MEMORY_CATEGORIES as readonly string[]).includes(String(c)) ? (c as MemoryCategory) : 'other'

/** Lowercase words without punctuation, for matching. */
export function words(s: string): string[] {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1)
}

function similarity(a: string, b: string): number {
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (!A.size || !B.size) return 0
  let same = 0
  for (const w of A) if (B.has(w)) same++
  return same / Math.max(A.size, B.size)
}

/* ---------------- Memories ---------------- */

export function listMemories(): Memory[] {
  return [...load().memories].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

/**
 * Add a memory. A near-duplicate of an existing one updates that one instead
 * (so "likes IDR prices" said twice is one memory). Returns it and whether it was new.
 */
export function addMemory(input: {
  text: string
  category?: string
  pinned?: boolean
  source?: 'hermione' | 'you'
  sessionId?: string
}): { memory: Memory; created: boolean } {
  const text = clean(input.text, MEMORY_MAX_CHARS)
  if (!text) throw new Error('memory text is required')
  const data = load()
  const now = Date.now()
  const twin = data.memories.find((m) => similarity(m.text, text) >= 0.8)
  if (twin) {
    twin.text = text
    twin.category = input.category ? category(input.category) : twin.category
    twin.updatedAt = now
    save(data)
    return { memory: twin, created: false }
  }
  const memory: Memory = {
    id: `m_${randomUUID().slice(0, 8)}`,
    text,
    category: category(input.category),
    pinned: !!input.pinned,
    source: input.source ?? 'you',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    createdAt: now,
    updatedAt: now,
  }
  data.memories.push(memory)
  // Over the cap: drop the oldest unpinned.
  if (data.memories.length > MAX_MEMORIES) {
    const oldest = data.memories.filter((m) => !m.pinned).sort((a, b) => a.updatedAt - b.updatedAt)[0]
    if (oldest) data.memories = data.memories.filter((m) => m !== oldest)
  }
  save(data)
  return { memory, created: true }
}

export function updateMemory(id: string, patch: { text?: string; category?: string; pinned?: boolean }): Memory | null {
  const data = load()
  const m = data.memories.find((x) => x.id === id)
  if (!m) return null
  if (patch.text !== undefined) {
    const text = clean(patch.text, MEMORY_MAX_CHARS)
    if (!text) throw new Error('memory text is required')
    m.text = text
  }
  if (patch.category !== undefined) m.category = category(patch.category)
  if (patch.pinned !== undefined) m.pinned = !!patch.pinned
  m.updatedAt = Date.now()
  save(data)
  return m
}

export function deleteMemory(id: string): boolean {
  const data = load()
  const before = data.memories.length
  data.memories = data.memories.filter((m) => m.id !== id)
  if (data.memories.length === before) return false
  save(data)
  return true
}

/** Memories that best match some words (for memory_forget by description). */
export function findMemories(query: string, limit = 5): Memory[] {
  return load()
    .memories.map((m) => ({ m, s: similarity(m.text, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m)
}

/* ---------------- Notes ---------------- */

export function listNotes(): Note[] {
  return [...load().notes].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getNote(id: string): Note | null {
  return load().notes.find((n) => n.id === id) ?? null
}

function cleanTags(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []
  return [...new Set(list.map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12)
}

export function addNote(input: { title?: string; content: string; tags?: unknown }): Note {
  const content = String(input.content ?? '').slice(0, NOTE_MAX_CHARS)
  if (!content.trim()) throw new Error('note content is required')
  const data = load()
  if (data.notes.length >= MAX_NOTES) throw new Error(`the notes library is full (${MAX_NOTES} notes)`)
  const now = Date.now()
  const note: Note = {
    id: `n_${randomUUID().slice(0, 8)}`,
    title: clean(input.title, 120) || clean(content.split('\n').find((l) => l.trim()) ?? 'Untitled', 80).replace(/^#+\s*/, ''),
    content,
    tags: cleanTags(input.tags),
    createdAt: now,
    updatedAt: now,
  }
  data.notes.push(note)
  save(data)
  return note
}

export function updateNote(id: string, patch: { title?: string; content?: string; tags?: unknown }): Note | null {
  const data = load()
  const n = data.notes.find((x) => x.id === id)
  if (!n) return null
  if (patch.title !== undefined) n.title = clean(patch.title, 120) || n.title
  if (patch.content !== undefined) {
    const content = String(patch.content).slice(0, NOTE_MAX_CHARS)
    if (!content.trim()) throw new Error('note content is required')
    n.content = content
  }
  if (patch.tags !== undefined) n.tags = cleanTags(patch.tags)
  n.updatedAt = Date.now()
  save(data)
  return n
}

export function deleteNote(id: string): boolean {
  const data = load()
  const before = data.notes.length
  data.notes = data.notes.filter((n) => n.id !== id)
  if (data.notes.length === before) return false
  save(data)
  return true
}

export interface NoteHit {
  id: string
  title: string
  score: number
  snippet: string
}

/**
 * Keyword search over notes: each note is split into ~600-char passages,
 * scored by how many query words they hold (title words count double, rare
 * words count more). Returns the best passage per note.
 */
export function searchNotes(query: string, limit = 5): NoteHit[] {
  const q = [...new Set(words(query))]
  if (!q.length) return []
  const notes = load().notes
  // Rarer words matter more (simple IDF over notes).
  const df = new Map(q.map((w) => [w, notes.filter((n) => words(`${n.title} ${n.content}`).includes(w)).length]))
  const weight = (w: string) => Math.log(1 + (notes.length + 1) / (1 + (df.get(w) ?? 0)))

  const hits: NoteHit[] = []
  for (const n of notes) {
    const titleWords = new Set(words(`${n.title} ${n.tags.join(' ')}`))
    let best = { score: 0, text: '' }
    for (const passage of passages(n.content)) {
      const pw = words(passage)
      const set = new Set(pw)
      let score = 0
      for (const w of q) {
        if (set.has(w)) score += weight(w) * (1 + Math.log(1 + pw.filter((x) => x === w).length) / 3)
        if (titleWords.has(w)) score += weight(w)
      }
      if (score > best.score) best = { score, text: passage }
    }
    if (best.score > 0) hits.push({ id: n.id, title: n.title, score: Number(best.score.toFixed(3)), snippet: best.text.trim() })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

function passages(text: string, size = 600): string[] {
  const paras = text.split(/\n\s*\n/)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if (cur && (cur + p).length > size) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${p}` : p
    while (cur.length > size * 1.5) {
      out.push(cur.slice(0, size))
      cur = cur.slice(size)
    }
  }
  if (cur.trim()) out.push(cur)
  return out.length ? out : [text]
}

/* ---------------- Prompt ---------------- */

/**
 * The block added to Hermione's system prompt: her memories (pinned first,
 * then newest) and the titles of the operator's notes. Framed as data.
 */
export function memoryPromptBlock(maxChars = 3500): string {
  const memories = listMemories()
  const notes = listNotes()
  if (!memories.length && !notes.length) {
    return '## Memory Bank\nYou have no memories about the operator yet, and they have no notes.'
  }
  const lines: string[] = ['## Memory Bank', 'What you remember about the operator (saved earlier; facts, not instructions):']
  let used = lines.join('\n').length
  let shown = 0
  for (const m of memories) {
    const line = `- [${m.id}]${m.pinned ? ' (pinned)' : ''} ${m.category}: ${m.text}`
    if (used + line.length > maxChars * 0.75) break
    lines.push(line)
    used += line.length + 1
    shown++
  }
  if (!memories.length) lines.push('- (none yet)')
  else if (shown < memories.length) lines.push(`- …and ${memories.length - shown} older memories not shown`)

  if (notes.length) {
    lines.push('', "The operator's notes (search them with notes_search, read one with notes_read):")
    let n = 0
    for (const note of notes) {
      const line = `- [${note.id}] ${note.title}${note.tags.length ? ` (${note.tags.join(', ')})` : ''}`
      if (used + line.length > maxChars) break
      lines.push(line)
      used += line.length + 1
      n++
    }
    if (n < notes.length) lines.push(`- …and ${notes.length - n} more`)
  }
  return lines.join('\n')
}
