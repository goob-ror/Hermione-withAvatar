'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface Group {
  providerId: string
  label: string
  scope: 'local' | 'cloud'
  online: boolean
  models: { id: string }[]
}

interface State {
  mode: 'auto' | 'saved' | 'off'
  effective: { providerId: string; model: string; label: string; source: string } | null
}

/**
 * Which model runs Hermione's voice subagent — the background model that
 * turns her greetings and spoken summaries into expressive dialog, separate
 * from the chat model. Auto = Gemini Flash Lite when a Gemini key is set up.
 */
export function VoiceModelPicker({ groups }: { groups: Group[] }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/tts/model')
      .then((r) => r.json())
      .then(setState)
      .catch(() => {})
  }, [])

  const choose = async (value: string) => {
    const split = value.indexOf('::')
    const body = value === 'auto' || value === 'off' ? { mode: value } : { mode: 'pick', providerId: value.slice(0, split), model: value.slice(split + 2) }
    try {
      const r = await fetch('/api/tts/model', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `${r.status}`)
      setState(d)
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (!state) return null
  const eff = state.effective
  const value = state.mode === 'auto' ? 'auto' : state.mode === 'off' || !eff ? 'off' : `${eff.providerId}::${eff.model}`
  const listed = groups.some((g) => g.providerId === eff?.providerId && g.models.some((m) => m.id === eff?.model))

  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={(e) => void choose(e.target.value)}
        aria-label="Voice model"
        title={
          error ||
          'Voice model: a second, background model that turns Hermione’s greetings and spoken summaries into expressive dialog. Separate from the chat model.'
        }
        className="bg-[#18161a] hover:bg-[#201d24] text-[#dedbd7] text-[10px] font-mono pl-2 pr-6 py-1 rounded border border-[#2e2a33] focus:outline-none cursor-pointer appearance-none max-w-48 truncate"
      >
        <option value="auto">Voice model: Auto{state.mode === 'auto' && eff ? ` (${eff.model})` : ''}</option>
        <option value="off">Voice model: off (rules only)</option>
        {state.mode === 'saved' && eff && !listed && <option value={value}>Voice model: {eff.model}</option>}
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
      <ChevronDown className="size-3 text-zinc-500 absolute right-2 pointer-events-none" />
    </div>
  )
}
