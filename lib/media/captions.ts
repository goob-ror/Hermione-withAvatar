/**
 * Word-timed captions for a clip, as an ASS subtitle file FFmpeg burns in.
 *
 * The words always come from the script (so names and spelling are exactly
 * as written). Their timing comes from Groq Whisper when a key is set, else
 * an estimate spread over each beat's voiceover.
 */

export interface TimedWord {
  word: string
  start: number
  end: number
}

export interface BeatTiming {
  /** Spoken text of the beat. */
  vo: string
  /** Where the beat's voiceover starts and ends in the full voice track (s). */
  start: number
  speechEnd: number
  /** Where the beat (and its picture) ends. */
  end: number
  /** Text overlay for the beat (ON-SCREEN), shown at the top. */
  overlay?: string
}

export const splitWords = (s: string) => s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)

/** Spread each beat's words over its speech, longer words taking longer. */
export function estimateWords(beats: BeatTiming[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const b of beats) {
    const words = splitWords(b.vo)
    if (!words.length) continue
    const weights = words.map((w) => 0.6 + w.replace(/[^\p{L}\p{N}]/gu, '').length * 0.18 + (/[.,!?;:]$/.test(w) ? 0.5 : 0))
    const total = weights.reduce((a, c) => a + c, 0)
    let t = b.start
    words.forEach((w, i) => {
      const d = ((b.speechEnd - b.start) * weights[i]) / total
      out.push({ word: w, start: t, end: t + d })
      t += d
    })
  }
  return out
}

/**
 * Put the script's words on Whisper's timeline, beat by beat: when Whisper
 * heard the same number of words they pair up one-to-one, otherwise each
 * script word takes the time of the Whisper word at the same relative spot.
 */
export function alignWords(beats: BeatTiming[], heard: TimedWord[]): TimedWord[] {
  const out: TimedWord[] = []
  for (const b of beats) {
    const words = splitWords(b.vo)
    const inBeat = heard.filter((h) => h.start >= b.start - 0.15 && h.start < b.speechEnd + 0.3)
    if (!words.length) continue
    if (!inBeat.length) {
      out.push(...estimateWords([b]))
      continue
    }
    words.forEach((w, i) => {
      const j = inBeat.length === words.length ? i : Math.min(inBeat.length - 1, Math.floor((i * inBeat.length) / words.length))
      const h = inBeat[j]
      const nextStart = inBeat[j + 1]?.start ?? b.speechEnd
      out.push({ word: w, start: h.start, end: Math.max(h.end, Math.min(nextStart, h.start + 0.6)) })
    })
  }
  // Keep time moving forward even where several script words share one heard word.
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].start) out[i].start = out[i - 1].start
    if (out[i].start <= out[i - 1].start && i > 0) {
      const gap = Math.max(0.12, (out[i].end - out[i].start) / 2)
      out[i].start = out[i - 1].start + gap
      if (out[i].end < out[i].start + 0.1) out[i].end = out[i].start + 0.1
    }
  }
  return out
}

/** Groq Whisper (free tier): word timestamps for a WAV. */
export async function groqWordTimes(wav: Buffer, key: string, language?: string): Promise<TimedWord[]> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'voice.wav')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  if (language) form.append('language', language)
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Groq Whisper ${res.status}`)
  const data = await res.json()
  return (data?.words ?? [])
    .map((w: any) => ({ word: String(w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w: TimedWord) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end))
}

/* ---------------- ASS ---------------- */

const ts = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const sec = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Text safe inside an ASS dialogue line (no override blocks, no line-break codes). */
export const assText = (s: string) => s.replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\r?\n/g, ' ').trim()

/** Groups of up to `size` words, breaking after sentence punctuation. */
export function chunkWords(words: TimedWord[], size = 3): TimedWord[][] {
  const chunks: TimedWord[][] = []
  let cur: TimedWord[] = []
  for (const w of words) {
    cur.push(w)
    if (cur.length >= size || /[.!?…,;:]$/.test(w.word)) {
      chunks.push(cur)
      cur = []
    }
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * The subtitle file: big centred captions three words at a time, the word
 * being spoken in yellow; each beat's ON-SCREEN text in a box at the top.
 */
export function buildAss(words: TimedWord[], beats: BeatTiming[], font = 'Arial'): string {
  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${font},88,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,560,1`,
    `Style: Overlay,${font},62,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4141018,-1,0,0,0,100,100,0,0,3,18,0,8,90,90,230,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const lines: string[] = []
  for (const b of beats) {
    if (b.overlay?.trim()) lines.push(`Dialogue: 1,${ts(b.start)},${ts(b.end)},Overlay,,0,0,0,,${assText(b.overlay)}`)
  }
  const chunks = chunkWords(words)
  chunks.forEach((chunk, ci) => {
    const chunkEnd = Math.max(chunk[chunk.length - 1].end, (chunks[ci + 1]?.[0].start ?? chunk[chunk.length - 1].end + 0.4) - 0.02)
    chunk.forEach((w, wi) => {
      const start = wi === 0 ? chunk[0].start : w.start
      const end = wi === chunk.length - 1 ? chunkEnd : chunk[wi + 1].start
      if (end <= start) return
      const text = chunk.map((x, xi) => (xi === wi ? `{\\c&H00E6FF&}${assText(x.word)}{\\c&HFFFFFF&}` : assText(x.word))).join(' ')
      lines.push(`Dialogue: 0,${ts(start)},${ts(end)},Caption,,0,0,0,,${text}`)
    })
  })
  return `${[...head, ...lines].join('\n')}\n`
}
