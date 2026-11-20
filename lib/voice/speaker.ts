'use client'

import { addressAsSir, stripTags } from '@/lib/tts/expression'

/**
 * Hermione's voice in the browser: her local voice (VoxCPM2) when available,
 * else the browser's own speech. One thing speaks at a time; a new line
 * replaces the old one.
 *
 * Normally the audio is STREAMED (/api/tts/stream): ~0.9 s is buffered, then
 * every piece is scheduled on one Web Audio timeline as it arrives, so she
 * starts talking in about a second instead of after the whole line. If that
 * isn't possible, each chunk is fetched as a WAV (/api/tts) while the
 * previous one plays.
 */

export const SPEAK_EVENT = 'hermione-speaking'
const VOICE_KEY = 'hermione-voice'
const VOICE_EVENT = 'hermione-voice'

let speakingId: string | null = null
let generation = 0
let audio: HTMLAudioElement | null = null
let localVoice: boolean | null = null
let audioCtx: AudioContext | null = null
/** Streamed pieces scheduled on audioCtx (stopped by stopSpeaking). */
let streamSources: AudioBufferSourceNode[] = []
/**
 * Seconds to buffer before playing a stream. Generation runs ~1.2x real time,
 * so a longer line needs a bigger head start to play without a gap:
 * ~0.6 s + a quarter of its estimated length (speech ≈ 14 characters/s), ≤ 4 s.
 */
export const streamLead = (chars: number) => Math.min(4, 0.6 + 0.25 * (chars / 14))
/** Re-buffer this much if playback ever catches up with generation. */
const REBUFFER_S = 0.9

export const currentSpeaker = () => speakingId

function setSpeaking(id: string | null) {
  speakingId = id
  window.dispatchEvent(new CustomEvent(SPEAK_EVENT, { detail: id }))
}

/** Automatic speech (waiting lines + answer summaries) on/off; on by default. */
export function voiceEnabled(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setVoiceEnabled(on: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, on ? 'on' : 'off')
  } catch {
    /* storage blocked — still applies to this page */
  }
  if (!on) stopSpeaking()
  window.dispatchEvent(new CustomEvent(VOICE_EVENT, { detail: on }))
}

export function onVoiceChange(fn: (on: boolean) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent).detail)
  window.addEventListener(VOICE_EVENT, h)
  return () => window.removeEventListener(VOICE_EVENT, h)
}

let engine: 'voxcpm' | null = null
let checkedAt = 0

/**
 * Is Hermione's local voice (VoxCPM2) available? Re-checked
 * every 20 s, which also lets the server start the voice early.
 */
export async function voiceAvailable(): Promise<boolean> {
  if (localVoice !== null && Date.now() - checkedAt < 20_000) return localVoice
  try {
    const r = await fetch('/api/tts')
    const d = await r.json()
    localVoice = !!d?.available
    engine = d?.engine ?? null
  } catch {
    localVoice = false
  }
  checkedAt = Date.now()
  return localVoice
}

/**
 * Chunks for speaking: with a local voice the first chunk is just the opening
 * sentence (≤ 90 chars, ~5 s to generate) so she starts talking quickly; the
 * rest is generated while that plays.
 */
export function speechChunks(text: string, slowVoice: boolean): string[] {
  if (!slowVoice) return chunkText(text, 280)
  const [first, ...rest] = chunkText(text, 140)
  if (!first) return []
  if (first.length <= 90) return [first, ...rest]
  const opening = chunkText(first, 90)
  return [...opening, ...rest]
}

/** Split into ≤ max-char chunks at sentence (then word) boundaries. */
export function chunkText(text: string, max = 280): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?…]+[.!?…]*\s*/g) ?? []
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length <= max) {
      cur += s
      continue
    }
    if (cur.trim()) out.push(cur.trim())
    cur = ''
    if (s.length <= max) cur = s
    else {
      // A very long sentence: cut at word boundaries.
      let rest = s
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max) > max / 2 ? rest.lastIndexOf(' ', max) : max
        out.push(rest.slice(0, cut).trim())
        rest = rest.slice(cut)
      }
      cur = rest
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function stopSpeaking() {
  generation++
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
  window.speechSynthesis?.cancel()
  for (const s of streamSources) {
    try {
      s.stop()
    } catch {
      /* already stopped */
    }
  }
  streamSources = []
  if (speakingId) setSpeaking(null)
}

/**
 * Speak `chunks` from the streaming endpoint on one continuous timeline.
 * False when streaming can't start (no Web Audio, sound blocked until the page
 * is clicked, voice not ready) so the caller uses the WAV path instead.
 */
async function streamChunks(chunks: string[], gen: number): Promise<boolean> {
  const Ctx = typeof window !== 'undefined' ? window.AudioContext : undefined
  if (!Ctx) return false
  audioCtx ??= new Ctx()
  const ctx = audioCtx
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  if (ctx.state !== 'running') return false // autoplay blocked: the WAV path knows how to wait for a click

  let next = 0 // when the scheduled audio ends (ctx time)
  const schedule = (samples: Float32Array, rate: number) => {
    if (!samples.length || gen !== generation) return
    const buf = ctx.createBuffer(1, samples.length, rate)
    buf.getChannelData(0).set(samples)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    const at = Math.max(next, ctx.currentTime + 0.03)
    src.start(at)
    next = at + buf.duration
    streamSources.push(src)
    src.onended = () => {
      streamSources = streamSources.filter((x) => x !== src)
    }
  }

  // One head start for the whole utterance: the timeline is continuous across chunks.
  let lead = streamLead(chunks.reduce((n, c) => n + c.length, 0))
  for (let i = 0; i < chunks.length; i++) {
    if (gen !== generation) return true
    let res: Response
    try {
      res = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunks[i] }),
      })
    } catch {
      if (i === 0) return false
      continue
    }
    if (!res.ok || !res.body) {
      if (i === 0) return false
      continue
    }
    const rate = Number(res.headers.get('X-Sample-Rate')) || 48000
    const reader = res.body.getReader()
    let carry: Uint8Array | null = null // an odd trailing byte between reads
    let pending: Float32Array[] = []
    let pendingLen = 0
    // Buffer first — at the start, and again if playback caught up with generation.
    let buffering = next < ctx.currentTime + 0.05
    const flush = () => {
      const all = new Float32Array(pendingLen)
      let o = 0
      for (const p of pending) {
        all.set(p, o)
        o += p.length
      }
      pending = []
      pendingLen = 0
      schedule(all, rate)
    }
    for (;;) {
      const { value, done } = await reader.read()
      if (gen !== generation) {
        void reader.cancel().catch(() => {})
        return true
      }
      if (done) break
      let bytes = value
      if (carry) {
        const joined = new Uint8Array(carry.length + bytes.length)
        joined.set(carry)
        joined.set(bytes, carry.length)
        bytes = joined
        carry = null
      }
      if (bytes.length % 2) {
        carry = bytes.slice(-1)
        bytes = bytes.slice(0, -1)
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const f = new Float32Array(bytes.length / 2)
      for (let k = 0; k < f.length; k++) f[k] = view.getInt16(k * 2, true) / 32768
      if (!buffering && next < ctx.currentTime + 0.05) {
        buffering = true // ran dry: rebuffer a little
        lead = REBUFFER_S
      }
      if (buffering) {
        pending.push(f)
        pendingLen += f.length
        if (pendingLen / rate >= lead) {
          flush()
          buffering = false
        }
      } else schedule(f, rate)
    }
    if (pendingLen) flush()
  }
  // Wait for the scheduled audio to finish (or to be stopped).
  while (gen === generation && ctx.currentTime < next) {
    await new Promise((r) => setTimeout(r, Math.min(250, Math.max(20, (next - ctx.currentTime) * 1000))))
  }
  return true
}

async function fetchWav(text: string): Promise<Blob | null> {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return r.ok ? await r.blob() : null
  } catch {
    return null
  }
}

function playBlob(blob: Blob, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== generation) return resolve()
    const url = URL.createObjectURL(blob)
    const el = new Audio(url)
    audio = el
    const done = () => {
      URL.revokeObjectURL(url)
      if (audio === el) audio = null
      resolve()
    }
    el.onended = done
    el.onerror = done
    el.play().catch((err) => {
      // Browsers block sound until the page has been clicked or typed in.
      // Play on the first click / key press instead (within 30 s) rather than drop it.
      if (err?.name !== 'NotAllowedError') return done()
      const retry = () => {
        cleanup()
        if (gen !== generation) return done()
        el.play().catch(done)
      }
      const cleanup = () => {
        clearTimeout(giveUp)
        window.removeEventListener('pointerdown', retry)
        window.removeEventListener('keydown', retry)
      }
      const giveUp = setTimeout(() => {
        cleanup()
        done()
      }, 30_000)
      window.addEventListener('pointerdown', retry, { once: true })
      window.addEventListener('keydown', retry, { once: true })
    })
  })
}

/**
 * Wait (up to `maxWaitMs`) for Hermione's natural voice (VoxCPM2) to finish
 * loading. True when it's ready; false if it's off, failed, or took too long.
 */
export async function waitForMainVoice(maxWaitMs: number, cancelled: () => boolean): Promise<boolean> {
  const until = Date.now() + maxWaitMs
  while (Date.now() < until && !cancelled()) {
    try {
      const d = await fetch('/api/tts').then((r) => r.json())
      localVoice = !!d?.available
      engine = d?.engine ?? null
      checkedAt = Date.now()
      if (d?.engine) return true
      if (d?.state === 'off' || d?.state === 'failed') return false
    } catch {
      return false
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

function browserSpeak(text: string, gen: number): Promise<void> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis
    // The browser's voice can't do expression tags (<chuckle> …): it would read them out.
    // Out loud the operator is "sir", as with her own voice.
    const line = addressAsSir(stripTags(text))
    if (!synth || gen !== generation || !line) return resolve()
    const u = new SpeechSynthesisUtterance(line)
    const voices = synth.getVoices()
    const voice =
      voices.find((v) => /en[-_]GB/i.test(v.lang) && /female|libby|sonia|hazel|zira/i.test(v.name)) ||
      voices.find((v) => /^en/i.test(v.lang))
    if (voice) u.voice = voice
    u.rate = 1.02
    u.onend = u.onerror = () => resolve()
    synth.speak(u)
  })
}

/**
 * Say `text` (plain sentences). Stops whatever was speaking. Resolves when
 * finished or interrupted. `id` marks who is speaking (for button states).
 */
/** Play a ready-made clip (e.g. a cached greeting) through the same one-at-a-time speaker. */
export async function playClip(blob: Blob, id = 'auto'): Promise<void> {
  stopSpeaking()
  const gen = generation
  setSpeaking(id)
  try {
    await playBlob(blob, gen)
  } finally {
    if (gen === generation && speakingId === id) setSpeaking(null)
  }
}

/**
 * Hermione's intro greeting: a cached one in her natural voice when there is
 * one (instant); otherwise wait for the natural voice to load and make one;
 * otherwise say `fallback` with whatever voice is available.
 */
export async function greet(mode: 'chat' | 'forge', name: string, fallback: string, cancelled: () => boolean): Promise<void> {
  if (!voiceEnabled()) return
  const url = `/api/tts/greeting?mode=${mode}&name=${encodeURIComponent(name)}`
  const fetchGreeting = async () => {
    try {
      const r = await fetch(url)
      return r.status === 200 ? await r.blob() : null
    } catch {
      return null
    }
  }
  let clip = await fetchGreeting()
  if (!clip && !cancelled()) {
    // Nothing cached yet: wait for the natural voice (it loads with the app), then make one.
    if (await waitForMainVoice(90_000, cancelled)) clip = await fetchGreeting()
  }
  if (cancelled() || !voiceEnabled()) return
  if (clip) return playClip(clip, 'greeting')
  if (await voiceAvailable()) await speak(fallback, 'greeting')
}

export async function speak(text: string, id = 'auto'): Promise<void> {
  stopSpeaking()
  const gen = generation
  setSpeaking(id)
  const available = await voiceAvailable()
  const chunks = speechChunks(text, engine !== null)
  if (!chunks.length) {
    if (speakingId === id) setSpeaking(null)
    return
  }
  try {
    // Streaming first (starts in ~1 s); the WAV path below if it can't start.
    if (available && (await streamChunks(chunkText(text, 280), gen))) return
    if (gen !== generation) return
    if (available) {
      let next = fetchWav(chunks[0])
      for (let i = 0; i < chunks.length; i++) {
        const blob = await next
        if (gen !== generation) return
        if (i + 1 < chunks.length) next = fetchWav(chunks[i + 1])
        if (blob) await playBlob(blob, gen)
        else await browserSpeak(chunks[i], gen) // voice busy or failed: don't skip the line
      }
    } else {
      for (const c of chunks) await browserSpeak(c, gen)
    }
  } finally {
    if (gen === generation && speakingId === id) setSpeaking(null)
  }
}

/**
 * Ask Hermione's voice subagent (POST /api/tts/line) to turn a line into
 * spoken dialog. Gives up after ~3.5 s and keeps the original line.
 */
async function polished(text: string, style: 'summary'): Promise<string> {
  try {
    const r = await fetch('/api/tts/line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style }),
      signal: AbortSignal.timeout(3_500),
    })
    const d = r.ok ? await r.json() : null
    return typeof d?.text === 'string' && d.text.trim() ? d.text : text
  } catch {
    return text
  }
}

/**
 * Automatic speech only when the operator has voice on; never cuts off a Read
 * aloud. `style: 'summary'` lets the voice subagent phrase it first.
 */
export function speakAuto(text: string, style?: 'summary') {
  if (!voiceEnabled() || !text.trim()) return
  if (speakingId && speakingId !== 'auto') return
  if (!style) return void speak(text, 'auto')
  void polished(text, style).then((line) => {
    // Something else started speaking while the line was being written: don't cut it off.
    if (speakingId && speakingId !== 'auto') return
    void speak(line, 'auto')
  })
}
