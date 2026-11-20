'use client'

// Avatar remark subtitle — displays idle chatter from the subagent with
// mood-based styling. Mounted inside the session-agent-frame so it overlays
// the Live2D avatar.

import { useEffect, useRef, useState } from 'react'

export interface AvatarRemarkProps {
  text: string
  mood: 'curious' | 'thoughtful' | 'concentrating' | 'attentive' | 'processing' | 'patient' | 'engaged' | 'idle'
  durationMs: number
  onDone?: () => void
}

export function AvatarRemark({ text, mood, durationMs, onDone }: AvatarRemarkProps) {
  const [fade, setFade] = useState(true)
  // The page re-renders on every streamed token; keep the timers from restarting.
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    // Subtitle only: remarks come every few seconds, so they aren't spoken.
    // Hermione's voice (waiting lines + answer summaries) lives in lib/voice.

    // Fade out and call onDone
    const fadeTimer = setTimeout(() => {
      setFade(false)
    }, durationMs)

    const clearTimer = setTimeout(() => {
      done.current?.()
    }, durationMs + 300)

    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(clearTimer)
    }
  }, [text, durationMs])

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
