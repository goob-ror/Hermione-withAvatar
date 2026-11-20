'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, RotateCcw, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react'
import { currentSpeaker, speak, SPEAK_EVENT, stopSpeaking } from '@/lib/voice/speaker'
import { outsideTags } from '@/lib/tts/expression'

export type Rating = 'up' | 'down'

/** Markdown → plain sentences for reading aloud (code blocks are skipped). */
export function speakable(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|[-:| ]*$/gm, '')
    .replace(/\|/g, ', ')
  // Strip leftover symbols but keep expression cue tags (<chuckle> …) whole.
  return outsideTags(text, (part) => part.replace(/[*_~>]+/g, ''))
    .replace(/\n{2,}/g, '.\n')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The row under one of Hermione's answers: copy, retry (last answer only),
 * read aloud and thumbs up/down.
 */
export function ReplyActions({
  id,
  text,
  rating,
  onRate,
  onRetry,
}: {
  id: string
  text: string
  rating?: Rating
  onRate: (rating: Rating | undefined) => void
  onRetry?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [speaking, setSpeakingState] = useState(() => typeof window !== 'undefined' && currentSpeaker() === id)

  useEffect(() => {
    const on = (e: Event) => setSpeakingState((e as CustomEvent).detail === id)
    window.addEventListener(SPEAK_EVENT, on)
    return () => window.removeEventListener(SPEAK_EVENT, on)
  }, [id])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  // Hermione's VoxCPM2 voice when available, else the browser's; one speaker at a time.
  const readAloud = () => {
    if (speaking) stopSpeaking()
    else void speak(speakable(text), id)
  }

  // Stopped before any text: only Retry makes sense.
  if (!text.trim()) {
    return onRetry ? (
      <div className="reply-actions" role="toolbar" aria-label="Reply actions">
        <button type="button" title="Retry — answer this again" onClick={onRetry}>
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    ) : null
  }

  return (
    <div className="reply-actions" role="toolbar" aria-label="Reply actions">
      <button type="button" title={copied ? 'Copied' : 'Copy'} onClick={copy}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {onRetry && (
        <button type="button" title="Retry — answer this again" onClick={onRetry}>
          <RotateCcw className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        title={speaking ? 'Stop reading' : 'Read aloud'}
        className={speaking ? 'is-on' : ''}
        onClick={readAloud}
      >
        {speaking ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
      </button>
      <button
        type="button"
        title="Good answer"
        className={rating === 'up' ? 'is-on' : ''}
        aria-pressed={rating === 'up'}
        onClick={() => onRate(rating === 'up' ? undefined : 'up')}
      >
        <ThumbsUp className="size-3.5" />
      </button>
      <button
        type="button"
        title="Bad answer"
        className={rating === 'down' ? 'is-on' : ''}
        aria-pressed={rating === 'down'}
        onClick={() => onRate(rating === 'down' ? undefined : 'down')}
      >
        <ThumbsDown className="size-3.5" />
      </button>
    </div>
  )
}
