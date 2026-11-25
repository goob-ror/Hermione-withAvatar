'use client'

import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'

type Mode = 'ask' | 'auto' | 'off'

const TITLES: Record<Mode, string> = {
  ask: 'Ask: every write, command and website action waits for your approval.',
  auto: 'Auto: a small judge model runs clearly-requested, low-risk actions and asks you about the rest. Hard limits always apply.',
  off: 'Off: runs actions without asking. Hard limits still block disk wipes and still ask about payments, logins, credentials and installs.',
}

/**
 * Permissions: Ask / Auto / Off, in the composer. Off shows a standing banner
 * (rendered by the page via `onMode`) so it's never on by accident.
 */
export function PermissionMode({ onMode }: { onMode?: (m: Mode) => void }) {
  const [mode, setMode] = useState<Mode>('ask')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/permissions/mode')
      .then((r) => r.json())
      .then((d) => {
        setMode(d.mode)
        onMode?.(d.mode)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async (m: Mode) => {
    if (m === 'off' && !window.confirm('Turn permissions off?\n\nHermione will write files, run commands and act on websites without asking. Hard limits still block disk wipes and still ask about payments, logins, credentials and installs.')) return
    try {
      const r = await fetch('/api/permissions/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: m }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `${r.status}`)
      setMode(d.mode)
      onMode?.(d.mode)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }

  const Icon = mode === 'off' ? ShieldAlert : mode === 'auto' ? ShieldQuestion : ShieldCheck
  return (
    <div className="relative flex items-center">
      <Icon className={`size-3 absolute left-2 pointer-events-none ${mode === 'off' ? 'text-[#e08a6a]' : mode === 'auto' ? 'text-[#80a9c1]' : 'text-[#7fd6a0]'}`} />
      <select
        value={mode}
        onChange={(e) => void choose(e.target.value as Mode)}
        title={error || TITLES[mode]}
        aria-label="Permission mode"
        className={`text-[11px] font-mono pl-6 pr-2 py-1 rounded border appearance-none cursor-pointer focus:outline-none bg-[#18161a] hover:bg-[#201d24] ${mode === 'off' ? 'text-[#f0b49a] border-[#5a352a]' : 'text-[#dedbd7] border-[#2e2a33]'}`}
      >
        <option value="ask">Permissions: Ask</option>
        <option value="auto">Permissions: Auto</option>
        <option value="off">Permissions: Off</option>
      </select>
    </div>
  )
}
