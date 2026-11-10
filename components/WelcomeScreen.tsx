'use client'

// The Claude-inspired welcome screen: centered greeting, middle input,
// then switches to the normal layout after the first message.
// Two variants: Chat (general assistant) and Content Forge.

import { ArrowUp, Sparkles } from 'lucide-react'
import { Live2DAvatar } from './Live2DAvatar'
import { ParticleNetwork } from './ParticleNetwork'
import { ForgeIcon, type AppMode } from './ModeSwitcher'
import { TrendRecommendations } from './TrendRecommendations'
import { useEffect, useRef, useState } from 'react'

export interface WelcomeScreenProps {
  userName?: string
  mode?: AppMode
  onSubmit: (text: string) => void
  disabled?: boolean
  /** Active model/provider — used if the trend recommendations need generating. */
  model?: string
  providerId?: string
}

const PLATFORMS = ['YouTube Shorts', 'TikTok', 'Instagram Reels'] as const

/** Forge pipeline — `ready` steps work today (via web research), the rest are being built. */
const PIPELINE: { label: string; ready: boolean }[] = [
  { label: 'Discover', ready: true },
  { label: 'Analyze', ready: true },
  { label: 'Clip', ready: false },
  { label: 'Edit', ready: false },
  { label: 'Package', ready: true },
  { label: 'Publish', ready: false },
]

export function WelcomeScreen({
  userName = 'friend',
  mode = 'chat',
  onSubmit,
  disabled,
  model,
  providerId,
}: WelcomeScreenProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const spokenRef = useRef(false)
  const forge = mode === 'forge'
  const [platforms, setPlatforms] = useState<string[]>(['YouTube Shorts'])

  useEffect(() => {
    // Auto-focus the input after mount
    const timer = setTimeout(() => inputRef.current?.focus(), 200)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Speak the greeting via PiperTTS once
    if (spokenRef.current) return
    spokenRef.current = true

    const greeting = forge
      ? `Welcome to the Content Forge, ${userName}. Pick a topic and let's find what's trending.`
      : `Hey, ${userName}. I'm Hermione. Let's build something today.`
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
  }, [userName, forge])

  /** In Forge, the chosen platforms ride along with the first message. */
  const compose = (text: string) =>
    forge && platforms.length ? `${text}\n\nTarget platforms: ${platforms.join(', ')}` : text

  const submit = (raw: string | undefined) => {
    const val = raw?.trim()
    if (!val || disabled) return
    onSubmit(compose(val))
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(e.currentTarget.value)
    }
  }

  const fillTopic = (topic: { headline: string; angle: string }, countryName: string) => {
    if (!inputRef.current) return
    inputRef.current.value =
      `Trending in ${countryName}: "${topic.headline}". Find the short-form videos driving this, ` +
      `tell me why they took off, and suggest my own take. Angle to consider: ${topic.angle}`
    inputRef.current.style.height = 'auto'
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
    inputRef.current.focus()
  }

  const togglePlatform = (p: string) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))

  return (
    <div className={`welcome-screen ${forge ? 'is-forge' : ''}`}>
      <ParticleNetwork
        particleColor={forge ? '#d9a08a' : '#a5b4c7'}
        lineColor={forge ? '#d9a08a' : '#a5b4c7'}
        particleCount={90}
        maxDistance={140}
        speed={0.25}
      />
      {/* Avatar in a floating card */}
      <div className="welcome-avatar-card">
        <Live2DAvatar state="idle" />
      </div>

      {/* Greeting */}
      <div className="welcome-greeting">
        <div className="welcome-icon" style={forge ? { color: '#f0956f' } : undefined}>
          {forge ? <ForgeIcon className="size-8" /> : <Sparkles className="size-8" strokeWidth={1.5} />}
        </div>
        <h1 className="welcome-title">{forge ? 'Content Forge' : `Hey, ${userName}`}</h1>
        <p className="welcome-subtitle">
          {forge
            ? "Pick a topic. I'll find what's trending and help turn it into clips."
            : "I'm Hermione. Let's build something today."}
        </p>
      </div>

      {forge && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-1.5 -mb-4" aria-label="Forge pipeline">
          {PIPELINE.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1.5">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                  step.ready
                    ? 'border-[#6b4a3c] bg-[#2a1d18] text-[#f0b49a]'
                    : 'border-[#2b292e] bg-[#151416] text-zinc-500'
                }`}
                title={step.ready ? 'Available now (web research)' : 'Coming in a later phase'}
              >
                {step.label}
                {!step.ready && <span className="ml-1 text-zinc-600">soon</span>}
              </span>
              {i < PIPELINE.length - 1 && <span className="text-zinc-700 text-[10px]">→</span>}
            </div>
          ))}
        </div>
      )}

      {/* Centered input */}
      <div className="welcome-input-container">
        <textarea
          ref={inputRef}
          placeholder={forge ? 'What topic should we dig into? e.g. AI tools for students' : 'What are we working on?'}
          className="welcome-input"
          rows={1}
          disabled={disabled}
          onKeyDown={handleKeyDown}
          onInput={(e) => {
            e.currentTarget.style.height = 'auto'
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`
          }}
        />
        <button className="welcome-send" disabled={disabled} onClick={() => submit(inputRef.current?.value)}>
          <ArrowUp className="size-5" />
        </button>
      </div>

      {forge && (
        <div className="relative z-10 flex flex-col items-center gap-2.5 -mt-3 max-w-[640px]">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 mr-1">Platforms</span>
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p)
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  aria-pressed={on}
                  className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                    on
                      ? 'border-[#8a5a44] bg-[#2a1d18] text-[#f3c1aa]'
                      : 'border-[#2b292e] bg-[#151416] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {p}
                </button>
              )
            })}
          </div>
          <TrendRecommendations model={model} providerId={providerId} onPick={fillTopic} />
        </div>
      )}

      {/* Footer hint */}
      <p className="welcome-hint">
        {forge
          ? "Footage rights first: I'll favor your own videos and original content, and flag copyright risk on anything else."
          : "I'll read files, run commands, and write code. Everything is root-locked to the project directory until you grant extra folders."}
      </p>
    </div>
  )
}
