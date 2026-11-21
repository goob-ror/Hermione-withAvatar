'use client'

import { useState } from 'react'
import { ChevronDown, History, MessageSquare } from 'lucide-react'
import { ForgeIcon } from './ModeSwitcher'

export interface RecentSession {
  id: string
  title: string
  updatedAt: number
  messageCount: number
}

const SHOW_FIRST = 4

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * "Pick up where you left off" on the intro: the latest chats (or Forge
 * projects) of this mode, newest first. The first few show; the rest expand.
 */
export function RecentSessions({
  sessions,
  forge,
  onOpen,
  disabled,
}: {
  sessions: RecentSession[]
  forge: boolean
  onOpen: (id: string) => void
  disabled?: boolean
}) {
  const [all, setAll] = useState(false)
  if (!sessions.length) return null
  const shown = all ? sessions : sessions.slice(0, SHOW_FIRST)
  const Icon = forge ? ForgeIcon : MessageSquare

  return (
    <section className={`welcome-recent ${forge ? 'is-forge' : ''}`} aria-label={forge ? 'Recent Forge projects' : 'Recent conversations'}>
      <div className="welcome-recent-head">
        <History className="size-3.5" />
        <span>{forge ? 'Pick up a recent project' : 'Continue a conversation'}</span>
      </div>
      <div className="welcome-recent-list">
        {shown.map((s) => (
          <button key={s.id} type="button" disabled={disabled} onClick={() => onOpen(s.id)} title={s.title}>
            <Icon className="size-3.5 flex-none welcome-recent-icon" />
            <span className="welcome-recent-title">{s.title || 'Untitled'}</span>
            <span className="welcome-recent-meta">
              {ago(s.updatedAt)}
              {s.messageCount ? ` · ${s.messageCount} msg${s.messageCount === 1 ? '' : 's'}` : ''}
            </span>
          </button>
        ))}
      </div>
      {sessions.length > SHOW_FIRST && (
        <button type="button" className="welcome-recent-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show all ${sessions.length}`}
          <ChevronDown className={`size-3.5 transition-transform ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </section>
  )
}
