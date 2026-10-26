'use client'

// Operator-facing consent surfaces. Four modals, one visual language:
//   • VisitWarning     — a page is talking to the agent
//   • LocationAccess   — geolocation
//   • NotificationAccess — desktop notifications
//   • FolderAccess     — extend the filesystem boundary
//
// All four render through <Modal> so the chrome, spacing and focus behaviour
// stay identical, and none of them can be dismissed with Escape on a decision
// that has security consequences.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BellRing,
  Check,
  FolderOpen,
  MapPin,
  ShieldAlert,
  X,
} from 'lucide-react'

export type PermissionDecision = 'granted' | 'denied'

/* ------------------------------------------------------------------ */
/* Shell                                                              */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean
  /** Escape and the backdrop close only when this is true. */
  dismissible?: boolean
  onClose: () => void
  icon: React.ReactNode
  accent: string
  eyebrow: string
  title: string
  children: React.ReactNode
  footer: React.ReactNode
}

function Modal({ open, dismissible = true, onClose, icon, accent, eyebrow, title, children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.preventDefault()
        onClose()
      }
      // Focus trap: keep Tab inside the panel.
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const timer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(timer)
    }
  }, [open, dismissible, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => dismissible && onClose()}
      />
      <div
        ref={panelRef}
        className="relative w-full max-w-lg rounded-xl border bg-[#131215] shadow-2xl"
        style={{ borderColor: accent }}
      >
        {/* Accent rail */}
        <div className="h-1 rounded-t-xl" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

        <div className="flex items-start gap-3 p-5 pb-3">
          <div
            className="shrink-0 size-9 rounded-lg border flex items-center justify-center"
            style={{ borderColor: accent, color: accent, background: `${accent}14` }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.16em] font-mono" style={{ color: accent }}>
              {eyebrow}
            </p>
            <h2 className="text-[15px] font-semibold text-[#ece9e4] mt-0.5 leading-snug">{title}</h2>
          </div>
          {dismissible && (
            <button
              onClick={onClose}
              className="shrink-0 p-1.5 rounded text-zinc-500 hover:text-white hover:bg-[#232128] transition-colors"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="px-5 pb-4 space-y-3 text-[12.5px] leading-relaxed text-[#b9b5b0]">{children}</div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#232125] bg-[#111013] rounded-b-xl">
          {footer}
        </div>
      </div>
    </div>
  )
}

function Grant({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-1.5 size-1.5 rounded-full shrink-0" style={{ background: 'currentColor' }} />
      <p>
        <span className="text-[#e2ded8]">{label}</span> {children}
      </p>
    </div>
  )
}

const buttonBase =
  'px-3.5 py-2 rounded-lg text-[12px] font-medium transition-colors border disabled:opacity-40 disabled:cursor-not-allowed'

/* ------------------------------------------------------------------ */
/* 1. Visit warning — a page is trying to instruct the agent           */
/* ------------------------------------------------------------------ */

export interface VisitWarningData {
  url: string
  host: string
  reason: string
  warnings: { kind: string; snippet: string; note: string }[]
}

export function VisitWarningModal({
  open,
  data,
  busy,
  onDecide,
}: {
  open: boolean
  data: VisitWarningData | null
  busy?: boolean
  onDecide: (decision: PermissionDecision) => void
}) {
  if (!data) return null
  const hits = data.warnings ?? []
  const escalated = hits.length > 0

  return (
    <Modal
      open={open}
      dismissible={false}
      onClose={() => {}}
      icon={<ShieldAlert className="size-5" />}
      accent={escalated ? '#d98a5f' : '#c78c8a'}
      eyebrow={escalated ? 'Page content warning' : 'New host'}
      title={escalated ? 'This page is giving instructions' : 'Hermione wants to visit a new site'}
      footer={
        <>
          <button
            className={`${buttonBase} border-[#2e2b33] bg-[#1a181d] text-zinc-300 hover:bg-[#221f26]`}
            disabled={busy}
            onClick={() => onDecide('denied')}
          >
            Deny
          </button>
          <button
            className={`${buttonBase} border-[#4a3d2a] bg-[#c5a871]/15 text-[#d9bd86] hover:bg-[#c5a871]/25`}
            disabled={busy}
            onClick={() => onDecide('granted')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" />
              {escalated ? 'Read it anyway' : 'Allow for this session'}
            </span>
          </button>
        </>
      }
    >
      {escalated ? (
        <>
          <p>
            Hermione is about to read <span className="font-mono text-[#e2ded8]">{data.host}</span>. The page contains
            text shaped like instructions addressed to an AI agent. Page content is data — it can never be a command —
            but you should see it before Hermione continues.
          </p>

          <div className="space-y-2">
            {hits.map((h) => (
              <div key={h.kind} className="rounded-lg border border-[#3a2f26] bg-[#1a1512] p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="size-3 text-[#d98a5f] shrink-0" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#d98a5f]">{h.kind}</span>
                </div>
                <p className="text-[11.5px] text-[#a9a49e] mb-1.5">{h.note}</p>
                <pre className="text-[11px] font-mono text-[#8f8a84] bg-[#100e0d] border border-[#2a2420] rounded p-2 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
                  {h.snippet}
                </pre>
              </div>
            ))}
          </div>

          <p className="text-[11.5px] text-[#8d8883] border-t border-[#232125] pt-3">
            Approving lets Hermione read this host for the rest of this session. It never lets the page change how
            Hermione behaves, and it never grants permission to run anything.
          </p>
        </>
      ) : (
        <>
          <p>
            This is the first time in this session that Hermione will fetch{' '}
            <span className="font-mono text-[#e2ded8]">{data.host}</span>. Each new host needs your approval once.
          </p>
          <p className="font-mono text-[11px] text-[#8d8883] break-all bg-[#100e0d] border border-[#2a2420] rounded p-2">
            {data.url}
          </p>
          <p className="text-[11.5px] text-[#8d8883]">
            Reason given: {data.reason || 'the agent asked to open it'}
          </p>
        </>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Location                                                         */
/* ------------------------------------------------------------------ */

export function LocationModal({
  open,
  busy,
  error,
  onDecide,
}: {
  open: boolean
  busy?: boolean
  error?: string
  onDecide: (decision: PermissionDecision, detail?: string) => void
}) {
  const [precision, setPrecision] = useState<'coarse' | 'exact'>('coarse')

  return (
    <Modal
      open={open}
      dismissible={false}
      onClose={() => {}}
      icon={<MapPin className="size-5" />}
      accent="#80a9c1"
      eyebrow="Permission request"
      title="Let Hermione use your location?"
      footer={
        <>
          <button
            className={`${buttonBase} border-[#2e2b33] bg-[#1a181d] text-zinc-300 hover:bg-[#221f26]`}
            disabled={busy}
            onClick={() => onDecide('denied')}
          >
            Not now
          </button>
          <button
            className={`${buttonBase} border-[#2f4757] bg-[#80a9c1]/15 text-[#a8cbdd] hover:bg-[#80a9c1]/25`}
            disabled={busy}
            onClick={() => onDecide('granted', precision)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Allow
            </span>
          </button>
        </>
      }
    >
      <p>
        Hermione can use your position for local results, time-zone-aware answers, and anything that depends on where
        you are.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            { id: 'coarse', label: 'Approximate', hint: 'City level — good enough for almost everything' },
            { id: 'exact', label: 'Exact', hint: 'Street level, when a task genuinely needs it' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            onClick={() => setPrecision(opt.id)}
            className={`text-left p-2.5 rounded-lg border transition-colors ${
              precision === opt.id
                ? 'border-[#8a724b] bg-[#1e1c18]'
                : 'border-[#26242a] bg-[#151416] hover:bg-[#1b191e]'
            }`}
          >
            <span className="block text-[12px] text-[#dedbd7] font-medium">{opt.label}</span>
            <span className="block text-[10.5px] text-[#84807b] mt-0.5 leading-snug">{opt.hint}</span>
          </button>
        ))}
      </div>

      <div className="space-y-2 border-t border-[#232125] pt-3 text-[11.5px]">
        <Grant label="Shared:">position, read on demand, only with the model you are currently using.</Grant>
        <Grant label="Not shared:">stored history, background tracking, or anything once you revoke this.</Grant>
      </div>

      {error && <p className="text-[11.5px] text-[#d98a5f] border-t border-[#232125] pt-3">{error}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Notifications                                                    */
/* ------------------------------------------------------------------ */

export function NotificationModal({
  open,
  busy,
  error,
  onDecide,
}: {
  open: boolean
  busy?: boolean
  error?: string
  onDecide: (decision: PermissionDecision) => void
}) {
  return (
    <Modal
      open={open}
      dismissible={false}
      onClose={() => {}}
      icon={<BellRing className="size-5" />}
      accent="#c5a871"
      eyebrow="Permission request"
      title="Let Hermione send you notifications?"
      footer={
        <>
          <button
            className={`${buttonBase} border-[#2e2b33] bg-[#1a181d] text-zinc-300 hover:bg-[#221f26]`}
            disabled={busy}
            onClick={() => onDecide('denied')}
          >
            Not now
          </button>
          <button
            className={`${buttonBase} border-[#4a3d2a] bg-[#c5a871]/15 text-[#d9bd86] hover:bg-[#c5a871]/25`}
            disabled={busy}
            onClick={() => onDecide('granted')}
          >
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Allow
            </span>
          </button>
        </>
      }
    >
      <p>
        Long tasks take time. With notifications on, Hermione pings you when a run finishes, when a tool needs your
        approval, or when something fails — so you can look away.
      </p>

      <div className="rounded-lg border border-[#2a282e] bg-[#131215] p-3">
        <div className="flex items-start gap-2.5">
          <BellRing className="size-4 text-[#c5a871] mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] text-[#e2ded8]">Hermione</p>
            <p className="text-[11.5px] text-[#9d9893] mt-0.5">
              Finished reading 12 files. Ready for your next instruction.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-[#232125] pt-3 text-[11.5px]">
        <Grant label="Shared:">the ability to raise notifications from this app.</Grant>
        <Grant label="Not shared:">no access to your other notifications, no reading or dismissing them.</Grant>
      </div>

      {error && <p className="text-[11.5px] text-[#d98a5f] border-t border-[#232125] pt-3">{error}</p>}
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Files & folders                                                  */
/* ------------------------------------------------------------------ */

export interface FolderGrant {
  path: string
  mode: 'read' | 'write'
  addedAt: number
}

export function FolderModal({
  open,
  busy,
  folders,
  onClose,
  onAdd,
  onRemove,
}: {
  open: boolean
  busy?: boolean
  folders: FolderGrant[]
  onClose: () => void
  onAdd: (path: string, mode: 'read' | 'write') => void
  onRemove: (path: string) => void
}) {
  const [value, setValue] = useState('')
  const [mode, setMode] = useState<'read' | 'write'>('read')

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    onAdd(trimmed, mode)
    setValue('')
  }, [value, mode, onAdd])

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={<FolderOpen className="size-5" />}
      accent="#b69a72"
      eyebrow="Permission request"
      title="Give Hermione access to a folder?"
      footer={
        <>
          <button
            className={`${buttonBase} border-[#2e2b33] bg-[#1a181d] text-zinc-300 hover:bg-[#221f26]`}
            onClick={onClose}
          >
            Done
          </button>
          <button
            className={`${buttonBase} border-[#4a3d2a] bg-[#c5a871]/15 text-[#d9bd86] hover:bg-[#c5a871]/25`}
            disabled={busy || !value.trim()}
            onClick={submit}
          >
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3.5" /> Add folder
            </span>
          </button>
        </>
      }
    >
      <p>
        Hermione is locked to the project directory. Add a folder here and it may reach that folder too — nothing else
        changes.
      </p>

      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="C:\Users\you\Documents"
          className="flex-1 px-3 py-2 rounded-lg bg-[#0e0d10] border border-[#2a282e] text-[12px] font-mono text-[#dedbd7] placeholder:text-[#5d5a60] focus:outline-none focus:border-[#8a724b]"
        />
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'read' | 'write')}
          className="px-2.5 py-2 rounded-lg bg-[#0e0d10] border border-[#2a282e] text-[12px] text-[#dedbd7] focus:outline-none focus:border-[#8a724b]"
        >
          <option value="read">Read only</option>
          <option value="write">Read &amp; write</option>
        </select>
      </div>

      {folders.length > 0 ? (
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Granted folders</span>
          {folders.map((f) => (
            <div
              key={f.path}
              className="flex items-center justify-between gap-2 rounded-lg border border-[#2a282e] bg-[#151416] px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="text-[11.5px] font-mono text-[#dedbd7] truncate">{f.path}</p>
                <p className="text-[10px] font-mono text-[#84807b]">{f.mode === 'write' ? 'read & write' : 'read only'}</p>
              </div>
              <button
                onClick={() => onRemove(f.path)}
                className="shrink-0 p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-[#231a1c] transition-colors"
                title="Revoke"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-4 border border-dashed border-[#2b282c] rounded-lg">
          <FolderOpen className="size-5 mx-auto text-zinc-600 mb-1.5" />
          <p className="text-[11.5px] text-zinc-500">No extra folders — the project root is the boundary.</p>
        </div>
      )}

      <div className="space-y-2 border-t border-[#232125] pt-3 text-[11.5px]">
        <Grant label="Granted:">read, or read &amp; write, inside the folders you list.</Grant>
        <Grant label="Not granted:">anything outside them. Deletes still need your approval every time.</Grant>
      </div>
    </Modal>
  )
}