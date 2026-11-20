import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import {
  addMemory,
  addNote,
  deleteMemory,
  deleteNote,
  listMemories,
  listNotes,
  MEMORY_CATEGORIES,
  MEMORY_MAX_CHARS,
  NOTE_MAX_CHARS,
  updateMemory,
  updateNote,
} from '@/lib/memory/bank'

/**
 * The Memory Bank page's API.
 *   GET                         → { memories, notes }
 *   POST   { kind, ... }        → add a memory or a note
 *   PATCH  { kind, id, ... }    → edit one
 *   DELETE ?kind=memory&id=…    → delete one
 */
export async function GET() {
  return NextResponse.json({ memories: listMemories(), notes: listNotes() })
}

const Category = z.enum(MEMORY_CATEGORIES)
const Tags = z.union([z.array(z.string().max(40)).max(20), z.string().max(400)])

const AddBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('memory'), text: z.string().min(1).max(MEMORY_MAX_CHARS * 2), category: Category.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal('note'), title: z.string().max(200).optional(), content: z.string().min(1).max(NOTE_MAX_CHARS), tags: Tags.optional() }),
])

const EditBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('memory'), id: z.string().min(1).max(40), text: z.string().max(MEMORY_MAX_CHARS * 2).optional(), category: Category.optional(), pinned: z.boolean().optional() }),
  z.object({ kind: z.literal('note'), id: z.string().min(1).max(40), title: z.string().max(200).optional(), content: z.string().max(NOTE_MAX_CHARS).optional(), tags: Tags.optional() }),
])

const fail = (err: any, status = 400) => NextResponse.json({ error: err?.message ?? String(err) }, { status })

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, AddBody)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    if (b.kind === 'memory') return NextResponse.json(addMemory({ text: b.text, category: b.category, pinned: b.pinned, source: 'you' }))
    return NextResponse.json({ note: addNote(b) })
  } catch (err) {
    return fail(err)
  }
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseBody(req, EditBody)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    const item = b.kind === 'memory' ? updateMemory(b.id, b) : updateNote(b.id, b)
    return item ? NextResponse.json({ [b.kind]: item }) : fail(new Error(`no ${b.kind} ${b.id}`), 404)
  } catch (err) {
    return fail(err)
  }
}

export async function DELETE(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind')
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if ((kind !== 'memory' && kind !== 'note') || !id) return fail(new Error('kind (memory|note) and id are required'))
  const ok = kind === 'memory' ? deleteMemory(id) : deleteNote(id)
  return ok ? NextResponse.json({ ok }) : fail(new Error(`no ${kind} ${id}`), 404)
}
