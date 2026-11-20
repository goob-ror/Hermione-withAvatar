'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, Check, FilePlus2, FileText, Lightbulb, Pencil, Pin, PinOff, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { LessonsPanel, pendingLessonCount } from '@/components/LessonsPanel'

type Category = 'preference' | 'fact' | 'project' | 'person' | 'other'

interface Memory {
  id: string
  text: string
  category: Category
  pinned: boolean
  source: 'hermione' | 'you'
  createdAt: number
  updatedAt: number
}

interface Note {
  id: string
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'preference', label: 'Preference' },
  { id: 'fact', label: 'About you' },
  { id: 'project', label: 'Project' },
  { id: 'person', label: 'Person' },
  { id: 'other', label: 'Other' },
]
const catLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c

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

async function api(method: string, body?: unknown, query = ''): Promise<any> {
  const res = await fetch(`/api/memory-bank${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || (data.issues && data.issues.join('; ')) || `${res.status}`)
  return data
}

/**
 * The Memory Bank: what Hermione remembers about you (she adds to it on her
 * own; you can add, edit, pin and delete) and your notes library she can search.
 */
export function MemoryBank({ refreshKey = 0 }: { refreshKey?: number }) {
  const [tab, setTab] = useState<'memories' | 'notes' | 'lessons'>('memories')
  /** Lessons waiting for a yes/no — shown on the tab. */
  const [pending, setPending] = useState(0)
  useEffect(() => {
    pendingLessonCount().then(setPending).catch(() => {})
  }, [refreshKey])
  const [memories, setMemories] = useState<Memory[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const reload = useCallback(async () => {
    try {
      const data = await api('GET')
      setMemories(data.memories ?? [])
      setNotes(data.notes ?? [])
      setError('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on open
    void reload()
  }, [reload, refreshKey])

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
    await reload()
  }

  return (
    <section className="mb-page">
      <header className="mb-head">
        <div className="mb-title">
          <Brain className="size-5" />
          <div>
            <h1>Memory Bank</h1>
            <p>What Hermione remembers about you across chats, and your notes she can search.</p>
          </div>
        </div>
        <div className="mb-search">
          <Search className="size-3.5" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      <div className="mb-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'memories'} className={tab === 'memories' ? 'is-on' : ''} onClick={() => setTab('memories')}>
          Memories <span>{memories.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'is-on' : ''} onClick={() => setTab('notes')}>
          Notes <span>{notes.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'lessons'} className={tab === 'lessons' ? 'is-on' : ''} onClick={() => setTab('lessons')}>
          <Lightbulb className="inline size-3.5" /> Lessons {pending > 0 && <span>{pending} to review</span>}
        </button>
      </div>

      {error && <div className="mb-error">⚠ {error}</div>}

      {!loaded ? (
        <div className="mb-empty">Loading…</div>
      ) : tab === 'lessons' ? (
        <LessonsPanel refreshKey={refreshKey} query={query} onPending={setPending} />
      ) : tab === 'memories' ? (
        <MemoriesPanel memories={memories} query={query} run={run} />
      ) : (
        <NotesPanel notes={notes} query={query} run={run} />
      )}
    </section>
  )
}

/* ---------------- Memories ---------------- */

function MemoriesPanel({
  memories,
  query,
  run,
}: {
  memories: Memory[]
  query: string
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<Category>('preference')
  const [filter, setFilter] = useState<Category | 'all'>('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return memories.filter((m) => (filter === 'all' || m.category === filter) && (!q || m.text.toLowerCase().includes(q)))
  }, [memories, query, filter])

  const add = async () => {
    const t = text.trim()
    if (!t) return
    await run(() => api('POST', { kind: 'memory', text: t, category }))
    setText('')
  }

  return (
    <div className="mb-panel">
      <form
        className="mb-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder='Teach Hermione something, e.g. "I prefer prices in rupiah"'
          aria-label="New memory"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)} aria-label="Category">
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" className="mb-primary" disabled={!text.trim()}>
          <Plus className="size-3.5" /> Remember
        </button>
      </form>

      <div className="mb-filters">
        {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((id) => {
          const count = id === 'all' ? memories.length : memories.filter((m) => m.category === id).length
          if (id !== 'all' && !count) return null
          return (
            <button key={id} type="button" className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
              {id === 'all' ? 'All' : catLabel(id)} <span>{count}</span>
            </button>
          )
        })}
      </div>

      {!memories.length ? (
        <div className="mb-empty">
          <Brain className="size-6" />
          <strong>No memories yet</strong>
          <span>Tell Hermione about yourself in a chat — she saves what&rsquo;s worth remembering — or add one above.</span>
        </div>
      ) : !shown.length ? (
        <div className="mb-empty">Nothing matches.</div>
      ) : (
        <ul className="mb-list">
          {shown.map((m) => (
            <MemoryRow key={m.id} m={m} run={run} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MemoryRow({ m, run }: { m: Memory; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [confirm, setConfirm] = useState(false)

  const save = async () => {
    const t = draft.trim()
    if (t && t !== m.text) await run(() => api('PATCH', { kind: 'memory', id: m.id, text: t }))
    setEditing(false)
  }

  return (
    <li className={`mb-memory ${m.pinned ? 'is-pinned' : ''}`}>
      <span className={`mb-cat mb-cat-${m.category}`}>{catLabel(m.category)}</span>
      <div className="mb-memory-body">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={300}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') {
                setDraft(m.text)
                setEditing(false)
              }
            }}
            onBlur={() => void save()}
            aria-label="Edit memory"
          />
        ) : (
          <p onDoubleClick={() => setEditing(true)}>{m.text}</p>
        )}
        <span className="mb-meta">
          {m.source === 'hermione' ? 'Saved by Hermione' : 'Added by you'} · {ago(m.updatedAt)}
        </span>
      </div>
      <div className="mb-actions">
        <select
          value={m.category}
          onChange={(e) => void run(() => api('PATCH', { kind: 'memory', id: m.id, category: e.target.value }))}
          aria-label="Change category"
          title="Change category"
        >
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" title="Edit" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          title={m.pinned ? 'Unpin' : 'Pin — always keep this in mind'}
          className={m.pinned ? 'is-on' : ''}
          onClick={() => void run(() => api('PATCH', { kind: 'memory', id: m.id, pinned: !m.pinned }))}
        >
          {m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        {confirm ? (
          <>
            <button type="button" className="mb-danger" title="Delete for good" onClick={() => void run(() => api('DELETE', undefined, `?kind=memory&id=${encodeURIComponent(m.id)}`))}>
              <Check className="size-3.5" /> Delete
            </button>
            <button type="button" title="Keep it" onClick={() => setConfirm(false)}>
              <X className="size-3.5" />
            </button>
          </>
        ) : (
          <button type="button" title="Delete" onClick={() => setConfirm(true)}>
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  )
}

/* ---------------- Notes ---------------- */

function NotesPanel({
  notes,
  query,
  run,
}: {
  notes: Note[]
  query: string
  run: (fn: () => Promise<unknown>) => Promise<void>
}) {
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes.filter(
      (n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.includes(q)),
    )
  }, [notes, query])

  const current = selected && selected !== 'new' ? notes.find((n) => n.id === selected) ?? null : null

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return
    await run(async () => {
      for (const f of Array.from(files).slice(0, 20)) {
        if (f.size > 2_000_000) throw new Error(`${f.name} is over 2 MB`)
        const content = await f.text()
        if (content.trim()) await api('POST', { kind: 'note', title: f.name.replace(/\.(md|markdown|txt)$/i, ''), content: content.slice(0, 200_000) })
      }
    })
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="mb-panel mb-notes">
      <div className="mb-notes-list">
        <div className="mb-notes-toolbar">
          <button type="button" className="mb-primary" onClick={() => setSelected('new')}>
            <FilePlus2 className="size-3.5" /> New note
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} title="Import .txt or .md files">
            <Upload className="size-3.5" /> Import
          </button>
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
        </div>
        {!notes.length ? (
          <div className="mb-empty">
            <FileText className="size-6" />
            <strong>No notes yet</strong>
            <span>Write or import notes — docs, ideas, references. Hermione can search them when you ask.</span>
          </div>
        ) : !shown.length ? (
          <div className="mb-empty">Nothing matches.</div>
        ) : (
          <ul>
            {shown.map((n) => (
              <li key={n.id}>
                <button type="button" className={selected === n.id ? 'is-on' : ''} onClick={() => setSelected(n.id)}>
                  <strong>{n.title}</strong>
                  <span className="snippet">{n.content.replace(/\s+/g, ' ').slice(0, 110)}</span>
                  <span className="mb-meta">
                    {n.tags.map((t) => `#${t}`).join(' ')} {n.tags.length ? '· ' : ''}
                    {ago(n.updatedAt)} · {n.content.length.toLocaleString()} chars
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-editor">
        {selected === 'new' || current ? (
          <NoteEditor
            key={current?.id ?? 'new'}
            note={current}
            onSave={async (n) => {
              await run(async () => {
                if (current) await api('PATCH', { kind: 'note', id: current.id, ...n })
                else {
                  const { note } = await api('POST', { kind: 'note', ...n })
                  setSelected(note.id)
                }
              })
            }}
            onDelete={
              current
                ? async () => {
                    await run(() => api('DELETE', undefined, `?kind=note&id=${encodeURIComponent(current.id)}`))
                    setSelected(null)
                  }
                : undefined
            }
            onCancel={() => setSelected(null)}
          />
        ) : (
          <div className="mb-empty">
            <FileText className="size-6" />
            <span>Pick a note to read or edit, or start a new one.</span>
          </div>
        )}
      </div>
    </div>
  )
}

function NoteEditor({
  note,
  onSave,
  onDelete,
  onCancel,
}: {
  note: Note | null
  onSave: (n: { title: string; content: string; tags: string }) => Promise<void>
  onDelete?: () => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(note?.title ?? '')
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [confirm, setConfirm] = useState(false)
  const [saved, setSaved] = useState(false)
  const dirty = !note || title !== note.title || content !== note.content || tags !== note.tags.join(', ')

  const save = async () => {
    if (!content.trim()) return
    await onSave({ title, content, tags })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <form
      className="mb-note-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <input className="mb-note-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Note title" />
      <input className="mb-note-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" aria-label="Tags" />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write anything Hermione should be able to look up — Markdown works."
        aria-label="Note text"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault()
            void save()
          }
        }}
      />
      <div className="mb-note-actions">
        <span className="mb-meta">{note ? `Edited ${ago(note.updatedAt)} · Ctrl+S saves` : 'Ctrl+S saves'}</span>
        {onDelete &&
          (confirm ? (
            <>
              <button type="button" className="mb-danger" onClick={() => void onDelete()}>
                <Check className="size-3.5" /> Delete note
              </button>
              <button type="button" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm(true)}>
              <Trash2 className="size-3.5" /> Delete
            </button>
          ))}
        {!note && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="mb-primary" disabled={!content.trim() || (!dirty && !!note)}>
          {saved ? <Check className="size-3.5" /> : null} {saved ? 'Saved' : note ? 'Save' : 'Add note'}
        </button>
      </div>
    </form>
  )
}
