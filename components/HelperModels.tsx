'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Cpu } from 'lucide-react'

interface Group {
  providerId: string
  label: string
  scope: 'local' | 'cloud'
  online: boolean
  models: { id: string }[]
}

type Role = 'voice' | 'worker' | 'judge'
interface Link {
  providerId: string
  model: string
  label: string
  source: string
}
interface Helper {
  mode: 'auto' | 'saved' | 'off'
  chain: Link[]
}

const ROLES: { role: Role; title: string; hint: string }[] = [
  { role: 'worker', title: 'Workers', hint: 'Read-only research sub-agents she delegates to (up to 4 at once).' },
  { role: 'judge', title: 'Judge', hint: 'Reviews risky actions when permissions are on Auto.' },
  { role: 'voice', title: 'Voice', hint: 'Writes her greetings, summaries and thinking lines.' },
]

/**
 * "Helpers" menu: which cheap, fast model does each side job beside the main
 * chat model. Auto picks Claude Haiku for workers and the judge, Gemini Flash
 * Lite for the voice; each falls back to Gemini, then the main model.
 */
export function HelperModels({ groups }: { groups: Group[] }) {
  const [open, setOpen] = useState(false)
  const [helpers, setHelpers] = useState<Record<Role, Helper> | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement | null>(null)

  const load = () =>
    fetch('/api/helpers')
      .then((r) => r.json())
      .then((d) => setHelpers(d.helpers))
      .catch(() => {})

  useEffect(() => {
    if (open) void load()
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const choose = async (role: Role, value: string) => {
    const split = value.indexOf('::')
    const body =
      value === 'auto' || value === 'off'
        ? { role, mode: value }
        : { role, mode: 'pick', providerId: value.slice(0, split), model: value.slice(split + 2) }
    try {
      const r = await fetch('/api/helpers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `${r.status}`)
      setHelpers(d.helpers)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 bg-[#18161a] hover:bg-[#201d24] text-[#dedbd7] text-[10px] font-mono px-2 py-1 rounded border border-[#2e2a33]"
        title="Helper models: cheaper models that do side jobs (research workers, safety judge, voice lines) beside the main model"
        aria-expanded={open}
      >
        <Cpu className="size-3" /> Helpers <ChevronDown className="size-3 text-zinc-500" />
      </button>
      {open && (
        <div className="helper-menu" role="dialog" aria-label="Helper models">
          {ROLES.map(({ role, title, hint }) => {
            const h = helpers?.[role]
            const first = h?.chain[0]
            const value = !h ? 'auto' : h.mode === 'auto' ? 'auto' : h.mode === 'off' || !first ? 'off' : `${first.providerId}::${first.model}`
            const listed = groups.some((g) => g.providerId === first?.providerId && g.models.some((m) => m.id === first?.model))
            return (
              <div key={role} className="helper-row">
                <div>
                  <strong>{title}</strong>
                  <span>{hint}</span>
                  {h && h.chain.length > 0 && (
                    <span className="chain">{h.chain.map((c) => c.model).join(' → ')}</span>
                  )}
                </div>
                <select value={value} onChange={(e) => void choose(role, e.target.value)} aria-label={`${title} model`}>
                  <option value="auto">Auto{h?.mode === 'auto' && first ? ` (${first.model})` : ''}</option>
                  <option value="off">Off</option>
                  {h?.mode === 'saved' && first && !listed && <option value={value}>{first.model}</option>}
                  {groups
                    .filter((g) => g.models.length)
                    .map((g) => (
                      <optgroup key={g.providerId} label={`${g.scope === 'local' ? '⌂' : '☁'} ${g.label}`}>
                        {g.models.map((m) => (
                          <option key={m.id} value={`${g.providerId}::${m.id}`}>
                            {m.id}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </div>
            )
          })}
          {error && <div className="helper-error">⚠ {error}</div>}
        </div>
      )}
    </div>
  )
}
