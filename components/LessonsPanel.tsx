'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Pencil, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react'

/**
 * Memory Bank → Lessons: what Hermione learned from your 👍/👎.
 * Proposed lessons wait here for Approve / Edit / Reject; only approved ones
 * reach her prompt. Also shows recent 👎 feedback ("Other" comments can be
 * turned into a lesson).
 */

export interface Lesson {
  id: string
  text: string
  reason?: string
  status: 'proposed' | 'active' | 'rejected'
  source: 'feedback' | 'you'
  evidence: string[]
  updatedAt: number
}

interface FeedbackRating {
  id: string
  rating: 'up' | 'down'
  reasons: string[]
  other?: string
  model?: string
  excerpt?: string
  createdAt: number
}

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString()
}

async function feedbackApi(method: string, body?: unknown): Promise<any> {
  const res = await fetch('/api/feedback', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || (data.issues && data.issues.join('; ')) || `${res.status}`)
  return data
}

/** How many lessons wait for review (for the tab badge). */
export async function pendingLessonCount(): Promise<number> {
  const d = await feedbackApi('GET')
  return (d.lessons ?? []).filter((l: Lesson) => l.status === 'proposed').length
}

export function LessonsPanel({ refreshKey, query, onPending }: { refreshKey: number; query: string; onPending: (n: number) => void }) {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [ratings, setRatings] = useState<FeedbackRating[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [proposeAfter, setProposeAfter] = useState(2)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [showRejected, setShowRejected] = useState(false)

  const reload = useCallback(async () => {
    try {
      const d = await feedbackApi('GET')
      setLessons(d.lessons ?? [])
      setRatings(d.ratings ?? [])
      setReasons(Object.fromEntries((d.reasons ?? []).map((r: { id: string; label: string }) => [r.id, r.label])))
      setProposeAfter(d.proposeAfter ?? 2)
      onPending((d.lessons ?? []).filter((l: Lesson) => l.status === 'proposed').length)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [onPending])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on open
    void reload()
  }, [reload, refreshKey])

  const act = async (body: unknown, method = 'PATCH') => {
    try {
      await feedbackApi(method, body)
      setEditing(null)
    } catch (e: any) {
      setError(e.message)
    }
    await reload()
  }

  const q = query.trim().toLowerCase()
  const match = (l: Lesson) => !q || l.text.toLowerCase().includes(q)
  const proposed = lessons.filter((l) => l.status === 'proposed' && match(l))
  const active = lessons.filter((l) => l.status === 'active' && match(l))
  const rejected = lessons.filter((l) => l.status === 'rejected' && match(l))
  const downs = ratings.filter((r) => r.rating === 'down')
  const ups = ratings.length - downs.length

  const save = (l: Lesson, t: string) => act({ id: l.id, action: l.status === 'proposed' ? 'approve' : 'edit', text: t })

  const row = (l: Lesson) => {
    const isEditing = editing?.id === l.id
    return (
      <div key={l.id} className={`mb-lesson is-${l.status}`}>
        <div>
          {isEditing ? (
            <input
              autoFocus
              value={editing.text}
              maxLength={300}
              aria-label="Lesson text"
              onChange={(e) => setEditing({ id: l.id, text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save(l, editing.text)
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <p>{l.text}</p>
          )}
          <span className="mb-meta">
            {l.source === 'you' ? 'Written by you' : `From ${l.evidence.length} 👎 · ${reasons[l.reason ?? ''] ?? l.reason}`} · {ago(l.updatedAt)}
          </span>
        </div>
        <div className="mb-actions">
          {isEditing ? (
            <>
              <button type="button" className="is-on" onClick={() => void save(l, editing.text)}>
                <Check className="size-3.5" /> {l.status === 'proposed' ? 'Save & approve' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                <X className="size-3.5" /> Cancel
              </button>
            </>
          ) : l.status === 'proposed' ? (
            <>
              <button type="button" className="is-on" onClick={() => void act({ id: l.id, action: 'approve' })}>
                <Check className="size-3.5" /> Approve
              </button>
              <button type="button" onClick={() => setEditing({ id: l.id, text: l.text })}>
                <Pencil className="size-3.5" /> Edit
              </button>
              <button type="button" onClick={() => void act({ id: l.id, action: 'reject' })}>
                <X className="size-3.5" /> Reject
              </button>
            </>
          ) : l.status === 'active' ? (
            <>
              <button type="button" onClick={() => setEditing({ id: l.id, text: l.text })} title="Edit">
                <Pencil className="size-3.5" />
              </button>
              <button type="button" onClick={() => void act({ id: l.id, action: 'remove' })} title="Stop using this lesson">
                <Trash2 className="size-3.5" />
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void act({ id: l.id, action: 'approve' })}>
              Restore
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-panel">
      {error && <div className="mb-error">⚠ {error}</div>}
      <form
        className="mb-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          void act({ kind: 'lesson', text: text.trim() }, 'POST')
          setText('')
        }}
      >
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder='Teach Hermione a habit, e.g. "Show the command before running it"'
          aria-label="New lesson"
        />
        <button type="submit" className="mb-primary" disabled={!text.trim()}>
          <Plus className="size-3.5" /> Add lesson
        </button>
      </form>

      <p className="mb-meta mb-lesson-intro">
        <ThumbsUp className="inline size-3" /> {ups} · <ThumbsDown className="inline size-3" /> {downs.length} rated replies. When {proposeAfter} replies
        get 👎 for the same reason, Hermione proposes a lesson. Only approved lessons go into her prompt.
      </p>

      {proposed.length > 0 && <div className="mb-lesson-group">To review</div>}
      {proposed.map(row)}

      <div className="mb-lesson-group">In use ({active.length})</div>
      {active.length ? (
        active.map(row)
      ) : (
        <div className="mb-empty">No lessons yet. Rate replies with 👎 and say what went wrong, or add one above.</div>
      )}

      {rejected.length > 0 && (
        <button type="button" className="mb-lesson-group" onClick={() => setShowRejected((v) => !v)}>
          {showRejected ? '▾' : '▸'} Rejected / removed ({rejected.length})
        </button>
      )}
      {showRejected && rejected.map(row)}

      {downs.length > 0 && <div className="mb-lesson-group">Recent 👎 feedback</div>}
      {downs.slice(0, 20).map((r) => (
        <div key={r.id} className="mb-feedback">
          <div className="row">
            <span className="mb-meta">
              {ago(r.createdAt)}
              {r.model ? ` · ${r.model}` : ''}
            </span>
            {r.other && (
              <button type="button" onClick={() => setText(r.other!.slice(0, 300))}>
                Make lesson
              </button>
            )}
          </div>
          {r.reasons.length > 0 && (
            <div className="why">
              {r.reasons.map((id) => (
                <span key={id}>{reasons[id] ?? id}</span>
              ))}
            </div>
          )}
          {r.other && <blockquote>{r.other}</blockquote>}
          {r.excerpt && (
            <div className="mb-meta">
              Reply: {r.excerpt.slice(0, 140)}
              {r.excerpt.length > 140 ? '…' : ''}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
