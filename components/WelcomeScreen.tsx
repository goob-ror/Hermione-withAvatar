'use client'

// The Claude-inspired welcome screen: centered greeting, middle input,
// then switches to the normal layout after the first message.

import { ArrowUp, Sparkles } from 'lucide-react'
import { Live2DAvatar } from './Live2DAvatar'
import { ParticleNetwork } from './ParticleNetwork'
import { useEffect, useRef } from 'react'

export interface WelcomeScreenProps {
  userName?: string
  onSubmit: (text: string) => void
  disabled?: boolean
}

export function WelcomeScreen({ userName = 'friend', onSubmit, disabled }: WelcomeScreenProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const spokenRef = useRef(false)

  useEffect(() => {
    // Auto-focus the input after mount
    const timer = setTimeout(() => inputRef.current?.focus(), 200)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Speak the greeting via PiperTTS once
    if (spokenRef.current) return
    spokenRef.current = true
    
    const greeting = `Hey, ${userName}. I'm Hermione. Let's build something today.`
    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: greeting }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.play().catch(() => {
          /* user gesture required or audio blocked */
        })
      })
      .catch(() => {
        /* TTS unavailable */
      })
  }, [userName])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const val = e.currentTarget.value.trim()
      if (val && !disabled) {
        onSubmit(val)
        e.currentTarget.value = ''
      }
    }
  }

  return (
    <div className="welcome-screen">
      <ParticleNetwork particleColor="#a5b4c7" lineColor="#a5b4c7" particleCount={90} maxDistance={140} speed={0.25} />
      {/* Avatar in a floating card */}
      <div className="welcome-avatar-card">
        <Live2DAvatar state="idle" />
      </div>

      {/* Greeting */}
      <div className="welcome-greeting">
        <div className="welcome-icon">
          <Sparkles className="size-8" strokeWidth={1.5} />
        </div>
        <h1 className="welcome-title">Hey, {userName}</h1>
        <p className="welcome-subtitle">I'm Hermione. Let's build something today.</p>
      </div>

      {/* Centered input */}
      <div className="welcome-input-container">
        <textarea
          ref={inputRef}
          placeholder="What are we working on?"
          className="welcome-input"
          rows={1}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            e.currentTarget.style.height = 'auto'
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
          }}
        />
        <button
          className="welcome-send"
          disabled={disabled}
          onClick={() => {
            const val = inputRef.current?.value.trim()
            if (val && !disabled) {
              onSubmit(val)
              if (inputRef.current) inputRef.current.value = ''
            }
          }}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>

      {/* Footer hint */}
      <p className="welcome-hint">
        I'll read files, run commands, and write code. Everything is root-locked to the project directory until you
        grant extra folders.
      </p>
    </div>
  )
}