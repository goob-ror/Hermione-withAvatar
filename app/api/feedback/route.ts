import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { id, Mode, parseBody } from '@/lib/http/validate'
import {
  addLesson,
  decideLesson,
  LESSON_MAX_CHARS,
  listLessons,
  listRatings,
  PROPOSE_AFTER,
  rate,
  REASON_IDS,
  REASONS,
} from '@/lib/feedback/store'

/**
 * Feedback on Hermione's replies, and the lessons it produces.
 *   GET                                   → { reasons, ratings, lessons, proposeAfter }
 *   POST  { kind: 'rating', key, rating } → record / replace / clear (rating null) one reply's rating
 *   POST  { kind: 'lesson', text }        → a lesson you write (active at once)
 *   PATCH { id, action, text? }           → approve | reject | edit | remove a lesson
 * Only the operator's page calls this (proxy.ts guards /api). Hermione has no
 * tool that writes here, so web pages and tool output can't change lessons.
 */
export async function GET() {
  return NextResponse.json({
    reasons: REASONS.map(({ id, label }) => ({ id, label })),
    ratings: listRatings(),
    lessons: listLessons(),
    proposeAfter: PROPOSE_AFTER,
  })
}

const PostBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rating'),
    key: id(120),
    rating: z.enum(['up', 'down']).nullable(),
    reasons: z.array(z.enum(REASON_IDS)).max(REASON_IDS.length).default([]),
    other: z.string().max(1000).optional(),
    model: z.string().max(120).optional(),
    mode: Mode.optional(),
    excerpt: z.string().max(2000).optional(),
  }),
  z.object({ kind: z.literal('lesson'), text: z.string().min(1).max(LESSON_MAX_CHARS * 2) }),
])

const PatchBody = z.object({
  id: id(40),
  action: z.enum(['approve', 'reject', 'edit', 'remove']),
  text: z.string().max(LESSON_MAX_CHARS * 2).optional(),
})

const fail = (err: any, status = 400) => NextResponse.json({ error: err?.message ?? String(err) }, { status })

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, PostBody)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    if (b.kind === 'lesson') return NextResponse.json({ lesson: addLesson(b.text) })
    return NextResponse.json(rate(b))
  } catch (err) {
    return fail(err)
  }
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseBody(req, PatchBody)
  if (!parsed.ok) return parsed.response
  try {
    const lesson = decideLesson(parsed.data.id, parsed.data.action, parsed.data.text)
    return lesson ? NextResponse.json({ lesson }) : fail(new Error(`no lesson ${parsed.data.id}`), 404)
  } catch (err) {
    return fail(err)
  }
}
