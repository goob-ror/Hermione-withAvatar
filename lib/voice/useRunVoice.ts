'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { onVoiceChange, setVoiceEnabled, speakAuto, stopSpeaking, voiceEnabled } from './speaker'
import { spokenSummary, waitingLine } from './summary'

/** First waiting line after this long, then every REPEAT_MS, at most MAX_LINES per run. */
const FIRST_MS = 8_000
const REPEAT_MS = 25_000
const MAX_LINES = 3

/**
 * Hermione's spoken companion for a chat run:
 *  - a short line when a task runs long ("Still searching the web for you."),
 *  - "I need your permission…" / her question when she pauses for you,
 *  - a spoken summary when the answer arrives.
 */
export function useRunVoice() {
  const [enabled, setEnabled] = useState(true)
  const activity = useRef('thinking')
  const lines = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // localStorage is read after mount so server and client render the same.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(voiceEnabled())
    return onVoiceChange(setEnabled)
  }, [])

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  /** Say one waiting line, then schedule the next (up to MAX_LINES per run). */
  const schedule = (delay: number) => {
    timer.current = setTimeout(() => {
      speakAuto(waitingLine(activity.current, lines.current))
      lines.current++
      if (lines.current < MAX_LINES) schedule(REPEAT_MS)
      else timer.current = null
    }, delay)
  }

  /** A request to Hermione started (send, retry, approve, answer). */
  const runStarted = useCallback(() => {
    stopSpeaking()
    clear()
    activity.current = 'thinking'
    lines.current = 0
    schedule(FIRST_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The request's stream ended, however it ended. */
  const runEnded = useCallback(() => clear(), [])

  const onEvent = useCallback((event: { type: string; [k: string]: any }) => {
    switch (event.type) {
      case 'tool_call':
        activity.current = event.tool
        break
      case 'token':
        activity.current = 'thinking'
        break
      case 'approval_required':
        clear()
        speakAuto('I need your permission for this step.')
        break
      case 'question':
        clear()
        speakAuto(String(event.question ?? ''))
        break
      case 'final':
        clear()
        speakAuto(spokenSummary(String(event.text ?? '')), 'summary')
        break
      case 'error':
        clear()
        speakAuto('Something went wrong. The details are in the chat.')
        break
      case 'stopped':
        clear()
        stopSpeaking()
        break
    }
  }, [])

  const toggle = useCallback(() => setVoiceEnabled(!voiceEnabled()), [])

  useEffect(() => () => clear(), [])

  return { enabled, toggle, runStarted, runEnded, onEvent }
}
