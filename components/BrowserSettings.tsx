'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Globe, Loader2, Play, Search, X } from 'lucide-react'

interface Status {
  enabled: boolean
  chromePath: string
  userDataDir: string
  profileDirectory: string
  headless: boolean
  chromeFound: boolean
  detectedChromePath: string
  profileExists: boolean
  isEverydayProfile: boolean
  running: 'idle' | 'headless' | 'setup'
  setupCompletedAt?: number
  lastError?: string
  lastSearchAt?: number
}

/**
 * Browser profile for searches — Hermione's own Chrome profile (recommended)
 * or a profile folder the operator points at. Set up once, then searches go
 * through real Chrome with real cookies instead of bare HTTP requests.
 */
export function BrowserSettings({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [dir, setDir] = useState('')
  const [profile, setProfile] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/browser', { cache: 'no-store' })
    const data: Status = await res.json()
    setStatus(data)
    setDir(data.userDataDir)
    setProfile(data.profileDirectory)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setNote(null)
      load()
    }
  }, [isOpen, load])

  const save = async (patch: Record<string, unknown>) => {
    setBusy('save')
    try {
      const res = await fetch('/api/browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) setNote({ ok: false, text: data.error || 'could not save' })
      else setStatus(data)
    } finally {
      setBusy(null)
    }
  }

  const act = async (action: 'setup' | 'close' | 'test') => {
    setBusy(action)
    setNote(null)
    try {
      const res = await fetch('/api/browser', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      setStatus(data)
      if (data.error) setNote({ ok: false, text: data.error })
      else if (action === 'setup')
        setNote({
          ok: true,
          text: 'Chrome opened. Sign in to Google and accept the consent screen there, then close that window.',
        })
      else if (action === 'test')
        setNote({
          ok: true,
          text: `Search works — ${data.results?.length ?? 0} results in ${data.latencyMs} ms (${data.results?.[0]?.title ?? ''})`,
        })
    } catch (err: any) {
      setNote({ ok: false, text: err?.message || 'request failed' })
    } finally {
      setBusy(null)
    }
  }

  if (!isOpen) return null

  const input =
    'w-full bg-[#151416] border border-[#2a292d] focus:border-[#c5a871] rounded-lg px-3 py-2 text-xs text-white outline-none font-mono'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl max-h-[88vh] overflow-y-auto bg-[#111013] border border-[#2c2a30] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#262429]">
          <div className="flex items-center gap-2.5">
            <Globe className="size-4 text-[#d2b278]" />
            <div>
              <h2 className="text-sm font-semibold text-white">Browser profile</h2>
              <p className="text-[11px] text-zinc-500">Search through real Chrome so bot checks don’t block Hermione</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#1e1c21]">
            <X className="size-4" />
          </button>
        </div>

        {!status ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="size-4 animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Enable */}
            <label className="flex items-start gap-3 p-3 rounded-lg border border-[#27252a] bg-[#151416] cursor-pointer">
              <input
                type="checkbox"
                checked={status.enabled}
                disabled={busy !== null || !status.chromeFound}
                onChange={(e) => save({ enabled: e.target.checked })}
                className="mt-0.5 accent-[#c5a871]"
              />
              <span>
                <span className="block text-xs font-medium text-white">Use the Chrome profile for web searches</span>
                <span className="block text-[11px] text-zinc-500 mt-0.5">
                  When off (or if Chrome hits a bot check), searches fall back to DuckDuckGo, then Bing.
                </span>
              </span>
            </label>

            {/* Status */}
            <div className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[11px] font-mono">
              <span className="text-zinc-500">Chrome</span>
              <span className={status.chromeFound ? 'text-zinc-300 truncate' : 'text-[#e0a2a2]'}>
                {status.chromeFound ? status.chromePath : 'not found — install Chrome or set the path below'}
              </span>
              <span className="text-zinc-500">Profile</span>
              <span className="text-zinc-300 truncate" title={`${status.userDataDir} / ${status.profileDirectory}`}>
                {status.setupCompletedAt
                  ? `set up ${new Date(status.setupCompletedAt).toLocaleDateString()}`
                  : status.profileExists
                    ? 'created, not set up yet'
                    : 'not set up yet'}{' '}
                · {status.profileDirectory}
              </span>
              <span className="text-zinc-500">State</span>
              <span className="text-zinc-300">
                {status.running === 'setup' ? 'setup window open' : status.running === 'headless' ? 'running (hidden)' : 'idle'}
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => act('setup')}
                disabled={busy !== null || !status.chromeFound}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#c5a871] hover:bg-[#d4bb87] disabled:opacity-50 text-black font-medium flex items-center gap-1.5"
              >
                {busy === 'setup' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Set up profile
              </button>
              <button
                onClick={() => act('test')}
                disabled={busy !== null || !status.chromeFound || status.running === 'setup'}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#211f24] hover:bg-[#2c2930] disabled:opacity-50 text-[#dedbd7] border border-[#37343c] flex items-center gap-1.5"
              >
                {busy === 'test' ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                Test search
              </button>
              {status.running !== 'idle' && (
                <button
                  onClick={() => act('close')}
                  disabled={busy !== null}
                  className="px-3 py-1.5 text-xs rounded-lg text-zinc-400 hover:text-white border border-[#2b292e]"
                >
                  Close Chrome
                </button>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              <b className="text-zinc-300">Set up profile</b> opens this profile in a visible Chrome window. Sign in to
              Google and accept the consent screen once; if Google ever shows a bot check, clear it there yourself —
              Hermione never solves captchas.
            </p>

            {note && (
              <div
                className={`text-[11px] px-2.5 py-1.5 rounded flex items-start gap-1.5 ${
                  note.ok
                    ? 'bg-[#14201a] text-[#8fd6ac] border border-[#234a37]'
                    : 'bg-[#201416] text-[#e0a2a2] border border-[#4a2429]'
                }`}
              >
                {note.ok ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
                <span>{note.text}</span>
              </div>
            )}
            {!note && status.lastError && (
              <p className="text-[11px] text-[#e0a2a2] flex gap-1.5">
                <AlertTriangle className="size-3.5 shrink-0" /> {status.lastError}
              </p>
            )}

            {/* Advanced */}
            <details className="border border-[#27252a] rounded-lg p-3 bg-[#141317]">
              <summary className="text-xs text-zinc-300 cursor-pointer">Use a different profile folder</summary>
              <div className="mt-3 space-y-2.5">
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400">Chrome user data folder</label>
                  <input value={dir} onChange={(e) => setDir(e.target.value)} className={input} spellCheck={false} />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400">Profile directory</label>
                  <input
                    value={profile}
                    onChange={(e) => setProfile(e.target.value)}
                    placeholder="Default, Profile 1, …"
                    className={input}
                    spellCheck={false}
                  />
                </div>
                {status.isEverydayProfile && (
                  <p className="text-[11px] text-[#e8c48a] flex gap-1.5">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    This is your everyday Chrome data folder. Chrome 136+ blocks automation here, it can’t be used while
                    your Chrome is open, and Hermione would search as your full signed-in self. The dedicated profile is
                    the safer choice.
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => save({ userDataDir: dir, profileDirectory: profile })}
                    disabled={busy !== null}
                    className="px-3 py-1.5 text-xs rounded-lg bg-[#211f24] hover:bg-[#2c2930] text-[#dedbd7] border border-[#37343c]"
                  >
                    Save folder
                  </button>
                  <button
                    onClick={() => save({ userDataDir: '', profileDirectory: 'Default' }).then(load)}
                    disabled={busy !== null}
                    className="px-3 py-1.5 text-xs rounded-lg text-zinc-400 hover:text-white"
                  >
                    Reset to Hermione’s profile
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}
