'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'

interface Status {
  ffmpeg: boolean
  vox: 'off' | 'idle' | 'starting' | 'ready' | 'failed'
  voxError: string | null
  pexels: boolean
  groq: boolean
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="cs-row">
      <span className={`cs-dot ${ok ? 'is-ok' : ''}`}>{ok ? <Check className="size-3" /> : null}</span>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  )
}

/**
 * Clip studio setup: shows what's ready (FFmpeg, the VoxCPM2 voice) and takes the
 * two free keys. Keys are saved on this PC (.hermione/media.json) and never
 * shown again — only "set" / "not set".
 */
export function ClipSetup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [pexels, setPexels] = useState('')
  const [groq, setGroq] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      setStatus(await fetch('/api/media/settings', { cache: 'no-store' }).then((r) => r.json()))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the server's status when opened
    if (open) void load()
  }, [open, load])

  if (!open) return null

  const save = async (body: Record<string, string | null>) => {
    setBusy(true)
    try {
      await fetch('/api/media/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setPexels('')
      setGroq('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cs-backdrop" role="dialog" aria-modal="true" aria-label="Clip setup" onClick={onClose}>
      <div className="cs-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Clip setup</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <p className="cs-intro">Hermione renders 9:16 clips on this PC for free. Two free keys make them better.</p>

        {status && (
          <div className="cs-rows">
            <Row ok={status.ffmpeg} label="FFmpeg" detail={status.ffmpeg ? 'Ready — renders the video' : 'Missing — put a build in tools/ffmpeg'} />
            <Row
              ok={status.vox === 'ready'}
              label="Voice (VoxCPM2)"
              detail={
                status.vox === 'ready'
                  ? 'Ready — Hermione’s voice, English and Indonesian'
                  : status.vox === 'starting' || status.vox === 'idle'
                    ? 'Loading the model (about 45 s)…'
                    : status.vox === 'failed'
                      ? `Couldn’t start — clips can’t be voiced until it does (${status.voxError ?? 'unknown error'})`
                      : 'Not installed — clips need tools/voxcpm'
              }
            />
          </div>
        )}

        <form
          className="cs-key"
          onSubmit={(e) => {
            e.preventDefault()
            if (pexels.trim()) void save({ pexelsKey: pexels })
          }}
        >
          <label>
            <span>
              Pexels key <em>{status?.pexels ? '· set' : '· not set'}</em>
            </span>
            <small>
              Free stock footage for every beat (200 searches/hour). Without it, clips use plain backdrops.{' '}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer">
                Get a free key <ExternalLink className="size-3 inline" />
              </a>
            </small>
          </label>
          <div className="cs-input">
            <input type="password" autoComplete="off" value={pexels} onChange={(e) => setPexels(e.target.value)} placeholder={status?.pexels ? 'Paste a new key to replace it' : 'Paste your Pexels API key'} />
            <button type="submit" disabled={busy || !pexels.trim()}>Save</button>
            {status?.pexels && (
              <button type="button" className="cs-clear" disabled={busy} onClick={() => void save({ pexelsKey: '' })}>
                Remove
              </button>
            )}
          </div>
        </form>

        <form
          className="cs-key"
          onSubmit={(e) => {
            e.preventDefault()
            if (groq.trim()) void save({ groqKey: groq })
          }}
        >
          <label>
            <span>
              Groq key <em>{status?.groq ? '· set' : '· optional'}</em>
            </span>
            <small>
              Whisper times each caption word exactly (free daily allowance). Without it, timing is estimated.{' '}
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
                Get a free key <ExternalLink className="size-3 inline" />
              </a>
            </small>
          </label>
          <div className="cs-input">
            <input type="password" autoComplete="off" value={groq} onChange={(e) => setGroq(e.target.value)} placeholder={status?.groq ? 'Paste a new key to replace it' : 'Paste your Groq API key'} />
            <button type="submit" disabled={busy || !groq.trim()}>Save</button>
            {status?.groq && (
              <button type="button" className="cs-clear" disabled={busy} onClick={() => void save({ groqKey: '' })}>
                Remove
              </button>
            )}
          </div>
        </form>

        <p className="cs-foot">{saved ? 'Saved.' : 'Keys stay on this PC and are never shown again.'}</p>
      </div>
    </div>
  )
}
