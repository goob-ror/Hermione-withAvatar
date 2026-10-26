'use client'

// Avatar remark subtitle — displays idle chatter from the subagent with
// mood-based styling. Mounted inside the session-agent-frame so it overlays
// the Live2D avatar.

import { useEffect, useState } from 'react'

export interface AvatarRemarkProps {
  text: string
  mood: 'curious' | 'thoughtful' | 'concentrating' | 'attentive' | 'processing' | 'patient' | 'engaged' | 'idle'
  durationMs: number
  onDone?: () => void
}

export function AvatarRemark({ text, mood, durationMs, onDone }: AvatarRemarkProps) {
  const [fade, setFade] = useState(true)

  useEffect(() => {
    // Speak the remark via PiperTTS
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.play().catch(() => {
          /* audio blocked or unavailable */
        })
      })
      .catch(() => {
        /* TTS unavailable */
      })

    // Fade out and call onDone
    const fadeTimer = setTimeout(() => {
      setFade(false)
    }, durationMs)

    const clearTimer = setTimeout(() => {
      if (onDone) onDone()
    }, durationMs + 300)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(clearTimer)
    }
  }, [text, durationMs, onDone])

  const moodColors: Record<typeof mood, string> = {
    curious: '#80a9c1',
    thoughtful: '#c5a871',
    concentrating: '#c5a871',
    attentive: '#b69a72',
    processing: '#7fd6a0',
    patient: '#c78c8a',
    engaged: '#d2b278',
    idle: '#6f6b70',
  }

  return (
    <div
      className="avatar-remark"
      style={{
        opacity: fade ? 1 : 0,
        color: moodColors[mood],
        transition: 'opacity 300ms ease-out',
      }}
    >
      <span className="avatar-remark-text">{text}</span>
    </div>
  )
}
