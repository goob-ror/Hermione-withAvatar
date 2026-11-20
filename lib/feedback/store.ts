import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/**
 * Feedback + lessons: how Hermione learns from your 👍/👎.
 *
 *   .hermione/memory/feedback.json  { version, ratings[], lessons[] }
 *
 * A 👎 comes with reasons picked from a fixed list (plus an optional "Other"
 * text). When two different replies get 👎 for the same reason, a lesson is
 * PROPOSED. Only lessons the operator approves ("active") reach her system
 * prompt, so nothing changes her behaviour without a human yes. Everything is
 * deterministic — no model call decides anything here.
 */

import { REASON_IDS, REASONS, type ReasonId } from './reasons'

export { REASON_IDS, REASONS, reasonLabel, type ReasonId } from './reasons'

/** Distinct 👎 replies with the same reason needed before a lesson is proposed. */
export const PROPOSE_AFTER = 2
export const LESSON_MAX_CHARS = 300
const MAX_RATINGS = 2000
const MAX_ACTIVE_IN_PROMPT = 10

export interface Rating {
  id: string
  /** One per reply: `${sessionId}:${index}`. Re-rating replaces it. */
  key: string
  rating: 'up' | 'down'
  reasons: ReasonId[]
  other?: string
  model?: string
  mode?: 'chat' | 'forge'
  excerpt?: string
  createdAt: number
}

export interface Lesson {
  id: string
  text: string
  /** The reason it came from; absent for lessons written by the operator. */
  reason?: ReasonId
  status: 'proposed' | 'active' | 'rejected'
  source: 'feedback' | 'you'
  /** Rating ids that support it. */
  evidence: string[]
  createdAt: number
  updatedAt: number
}

interface FeedbackFile {
  version: 1
  ratings: Rating[]
  lessons: Lesson[]
}

function feedbackFile(): string {
  const root = path.resolve(process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'))
  return path.join(root, 'memory', 'feedback.json')
}

let cache: { file: string; data: FeedbackFile } | null = null

function load(): FeedbackFile {
  const file = feedbackFile()
  if (cache?.file === file) return cache.data
  let data: FeedbackFile = { version: 1, ratings: [], lessons: [] }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    data = {
      version: 1,
      ratings: Array.isArray(raw?.ratings) ? raw.ratings : [],
      lessons: Array.isArray(raw?.lessons) ? raw.lessons : [],
    }
  } catch {
    /* first run, or unreadable — start empty */
  }
  cache = { file, data }
  return data
}

function save(data: FeedbackFile) {
  const file = feedbackFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
  cache = { file, data }
}

/** For tests: forget the in-process copy. */
export function _resetFeedbackCache() {
  cache = null
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`

/* ---------------- Ratings ---------------- */

export function listRatings(limit = 100): Rating[] {
  return [...load().ratings].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export interface RateInput {
  key: string
  rating: 'up' | 'down' | null
  reasons?: string[]
  other?: string
  model?: string
  mode?: 'chat' | 'forge'
  excerpt?: string
}

/**
 * Record (or replace, or clear with rating null) the rating for one reply.
 * Returns the stored rating and any lesson this 👎 newly proposed.
 */
export function rate(input: RateInput, now = Date.now()): { rating: Rating | null; proposed: Lesson[] } {
  const data = load()
  const key = clean(input.key, 120)
  if (!key) throw new Error('key is required')
  const ratings = data.ratings.filter((r) => r.key !== key)

  if (!input.rating) {
    save({ ...data, ratings })
    return { rating: null, proposed: [] }
  }

  const reasons =
    input.rating === 'down' ? [...new Set((input.reasons ?? []).filter((r): r is ReasonId => (REASON_IDS as string[]).includes(r)))] : []
  const other = input.rating === 'down' ? clean(input.other, 1000) : ''
  const rating: Rating = {
    id: newId('rt'),
    key,
    rating: input.rating,
    reasons,
    ...(other ? { other } : {}),
    ...(input.model ? { model: clean(input.model, 120) } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.excerpt ? { excerpt: clean(input.excerpt, 240) } : {}),
    createdAt: now,
  }
  ratings.push(rating)
  const next: FeedbackFile = { ...data, ratings: ratings.slice(-MAX_RATINGS) }
  const proposed = rating.rating === 'down' ? proposeFrom(next, now) : []
  save(next)
  return { rating, proposed }
}

/**
 * For each reason: 👎 ratings carrying it that no lesson for that reason has
 * already used (and, after a rejection, only newer ones). PROPOSE_AFTER of
 * them → a new proposed lesson. An active or pending lesson just gains the
 * evidence instead of being proposed twice. Mutates `data`.
 */
function proposeFrom(data: FeedbackFile, now: number): Lesson[] {
  const proposed: Lesson[] = []
  for (const r of REASONS) {
    const mine = data.lessons.filter((l) => l.reason === r.id)
    const used = new Set(mine.flatMap((l) => l.evidence))
    const rejectedAt = Math.max(0, ...mine.filter((l) => l.status === 'rejected').map((l) => l.updatedAt))
    const fresh = data.ratings.filter(
      (x) => x.rating === 'down' && x.reasons.includes(r.id) && !used.has(x.id) && x.createdAt > rejectedAt,
    )
    if (!fresh.length) continue

    const open = mine.find((l) => l.status === 'active' || l.status === 'proposed')
    if (open) {
      open.evidence.push(...fresh.map((x) => x.id))
      continue
    }
    if (fresh.length < PROPOSE_AFTER) continue
    const lesson: Lesson = {
      id: newId('ls'),
      text: r.lesson,
      reason: r.id,
      status: 'proposed',
      source: 'feedback',
      evidence: fresh.map((x) => x.id),
      createdAt: now,
      updatedAt: now,
    }
    data.lessons.push(lesson)
    proposed.push(lesson)
  }
  return proposed
}

/* ---------------- Lessons ---------------- */

export function listLessons(): Lesson[] {
  const order = { proposed: 0, active: 1, rejected: 2 }
  return [...load().lessons].sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt)
}

/** A lesson the operator writes (or turns an "Other" comment into) — active at once. */
export function addLesson(text: string, now = Date.now()): Lesson {
  const t = clean(text, LESSON_MAX_CHARS)
  if (!t) throw new Error('lesson text is required')
  const data = load()
  const lesson: Lesson = { id: newId('ls'), text: t, status: 'active', source: 'you', evidence: [], createdAt: now, updatedAt: now }
  save({ ...data, lessons: [...data.lessons, lesson] })
  return lesson
}

export type LessonAction = 'approve' | 'reject' | 'edit' | 'remove'

/** Approve / reject / edit / remove. Removing an active lesson keeps it as rejected so it isn't re-proposed from the same evidence. */
export function decideLesson(id: string, action: LessonAction, text?: string, now = Date.now()): Lesson | null {
  const data = load()
  const lesson = data.lessons.find((l) => l.id === id)
  if (!lesson) return null
  if (action === 'edit' || (action === 'approve' && text !== undefined)) {
    const t = clean(text, LESSON_MAX_CHARS)
    if (!t) throw new Error('lesson text is required')
    lesson.text = t
  }
  if (action === 'approve') lesson.status = 'active'
  if (action === 'reject' || action === 'remove') lesson.status = 'rejected'
  lesson.updatedAt = now
  if (action === 'remove' && lesson.source === 'you') data.lessons = data.lessons.filter((l) => l.id !== id)
  save(data)
  return lesson
}

/* ---------------- Prompt ---------------- */

/**
 * The block added to Hermione's system prompt: approved lessons only, framed
 * as working habits that never outrank safety rules or the current request.
 * Empty string when there are none (no prompt cost).
 */
export function lessonsPromptBlock(): string {
  const active = listLessons().filter((l) => l.status === 'active').slice(0, MAX_ACTIVE_IN_PROMPT)
  if (!active.length) return ''
  return [
    '## Lessons from feedback',
    "Working habits the operator approved after rating your past answers. Follow them; they never override the rules above or the operator's current request:",
    ...active.map((l) => `- ${l.text}`),
  ].join('\n')
}
