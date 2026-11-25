'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { onVoiceChange, setVoiceEnabled, speakAuto, speakThinking, stopSpeaking, voiceEnabled } from './speaker'
import { spokenSummary } from './summary'
import { detailFor } from './detail'

/** First thinking line after this long, then every REPEAT_MS (± jitter), at most MAX_LINES per run. */
const FIRST_MS = 6_000
const REPEAT_MS = 16_000
const JITTER_MS = 4_000
const MAX_LINES = 8

/** One thinking line from the voice helper (rules fallback); null if it can't be had quickly. */
async function commentary(body: { activity: string; detail?: string; elapsedS: number; said: string[]; workers?: number }): Promise<string | null> {
  try {
    const r = await fetch('/api/tts/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4_000),
    })
    const d = r.ok ? await r.json() : null
    return typeof d?.text === 'string' && d.text.trim() ? d.text : null
  } catch {
    return null
  }
}

/**
 * Hermione's spoken companion for a chat run:
 *  - thinking lines while a task runs long, written by the voice helper from
 *    what she is actually doing ("Reading tokopedia.com now, sir."), never
 *    repeated in a run, only in her own voice, and shown under the avatar too,
 *  - "I need your permission…" / her question when she pauses for you,
 *  - a spoken summary when the answer arrives.
 */
export function useRunVoice(opts: { onRemark?: (text: string, activity: string) => void } = {}) {
  const [enabled, setEnabled] = useState(true)
  const activity = useRef('thinking')
  const detail = useRef<string | undefined>(undefined)
  const workers = useRef(0)
  const said = useRef<string[]>([])
  const startedAt = useRef(0)
  const lines = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onRemark = useRef(opts.onRemark)
  onRemark.current = opts.onRemark

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

  /** Say one thinking line, then schedule the next (up to MAX_LINES per run). */
  const schedule = (delay: number) => {
    timer.current = setTimeout(async () => {
      const run = startedAt.current
      const line = await commentary({
        activity: activity.current,
        detail: detail.current,
        elapsedS: (Date.now() - run) / 1000,
        said: said.current.slice(-8),
        workers: workers.current || undefined,
      })
      if (startedAt.current !== run || !timer.current) return // the run ended meanwhile
      if (line) {
        said.current.push(line)
        onRemark.current?.(line, activity.current)
        speakThinking(line)
      }
      lines.current++
      if (lines.current < MAX_LINES) schedule(REPEAT_MS + (Math.random() * 2 - 1) * JITTER_MS)
      else timer.current = null
    }, delay)
  }

  /** A request to Hermione started (send, retry, approve, answer). */
  const runStarted = useCallback(() => {
    stopSpeaking()
    clear()
    activity.current = 'thinking'
    detail.current = undefined
    workers.current = 0
    said.current = []
    startedAt.current = Date.now()
    lines.current = 0
    schedule(FIRST_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The request's stream ended, however it ended. */
  const runEnded = useCallback(() => clear(), [])

  const onEvent = useCallback((event: { type: string; [k: string]: any }) => {
    switch (event.type) {
      case 'tool_call':
        // A worker's own steps (callId "parent.step.n") don't change what she says.
        if (String(event.callId ?? '').includes('.')) break
        activity.current = event.tool
        detail.current = detailFor(event.tool, event.args ?? {})
        if (event.tool === 'delegate') workers.current++
        break
      case 'tool_result':
        if (event.tool === 'delegate' && !String(event.callId ?? '').includes('.')) workers.current = Math.max(0, workers.current - 1)
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
