import { cleanForSpeech } from './audio'
import { addressAsSir, expressionsEnabled, expressive, sanitizeTags, stripTags, upbeat } from './expression'
import { voxHealth, voxInstalled, voxSpeak, voxStream, type VoxHealth } from './voxcpm'
import type { VoiceLang } from './language'

/**
 * Hermione's speech, one entry point, one voice: VoxCPM2 (natural, 48 kHz,
 * English and Indonesian, cloned from tools/voxcpm/voice/reference-<lang>.wav).
 * Loaded when the Next server starts (instrumentation.ts) and kept loaded.
 *
 *   live - waiting lines, answer summaries, Read aloud: wait up to ~40 s for
 *          the voice to finish loading.
 *   clip - clip voiceovers: wait up to ~2 min so a clip always gets a voice.
 *
 * Expressions: VoxCPM2 has no sound tags, so the expression layer's cue (a
 * chuckle, a sigh, a bright greeting) becomes a short delivery style for the
 * line instead (styleFor), and the tags themselves are never sent.
 *
 * When the voice isn't installed or failed to start, speak() throws "no voice
 * is available" and the browser falls back to its own speech.
 */

export type Engine = 'voxcpm'

export interface Speech {
  wav: Buffer
  engine: Engine
}

const LIVE_WAIT_MS = 40_000
const CLIP_WAIT_MS = 120_000

export const engineLabel = (_e: Engine = 'voxcpm') => 'VoxCPM2'

export async function speechStatus(): Promise<{ engine: Engine | null; vox: VoxHealth }> {
  const vox = await voxHealth()
  return { engine: vox.state === 'ready' ? 'voxcpm' : null, vox }
}

const why = (h: { state: string; error?: string }) =>
  `no voice is available (VoxCPM2 ${h.state === 'failed' ? `failed: ${h.error ?? 'unknown error'}` : h.state === 'starting' ? 'is still loading' : 'is off'})`

/** The delivery style a line's expression cue asks for ('' = her normal voice). */
export function styleFor(tagged: string, opts: { greeting?: boolean } = {}): string {
  const tag = tagged.match(/<(laugh|chuckle|sigh|gasp|groan)>/)?.[1]
  if (tag === 'laugh' || tag === 'chuckle') return 'amused, a light laugh in her voice'
  if (tag === 'sigh') return 'relieved, with a soft sigh'
  if (tag === 'gasp') return 'pleasantly surprised'
  if (tag === 'groan') return 'mildly exasperated, dry'
  if (opts.greeting) return 'bright, energetic and warm, genuinely glad'
  return ''
}

type SpeakOpts = { purpose?: 'live' | 'clip'; signal?: AbortSignal; lang?: VoiceLang; mode?: 'chat' | 'forge'; greeting?: boolean }

/** What VoxCPM2 is actually sent: the cleaned line, its language and delivery style. */
export function prepareLine(text: string, opts: SpeakOpts = {}): { line: string; lang: VoiceLang; style: string } {
  // Out loud the operator is "sir". The expression layer picks at most one cue
  // (and drops a literal "haha"); VoxCPM2 gets it as a style, never as a tag.
  const cleaned = cleanForSpeech(sanitizeTags(addressAsSir(text)))
  const lang = opts.lang ?? 'en'
  const expressed = expressionsEnabled() && lang === 'en' ? expressive(opts.greeting ? upbeat(cleaned) : cleaned) : cleaned
  const line = stripTags(expressed)
  if (!line) throw new Error('nothing to say')
  // Clips keep her plain cloned voice so every beat matches.
  const style = expressionsEnabled() && lang === 'en' && opts.purpose !== 'clip' ? styleFor(expressed, { greeting: opts.greeting }) : ''
  return { line, lang, style }
}

export async function speak(text: string, opts: SpeakOpts = {}): Promise<Speech> {
  const waitMs = opts.purpose === 'clip' ? CLIP_WAIT_MS : LIVE_WAIT_MS
  const { line, lang, style } = prepareLine(text, opts)
  if (!voxInstalled()) throw new Error('no voice is available (VoxCPM2 is not installed in tools/voxcpm)')
  const wav = await voxSpeak(line, { waitMs, signal: opts.signal, lang, style })
  if (!wav) throw new Error(why(await voxHealth()))
  return { wav, engine: 'voxcpm' }
}

/** Live speech as a stream of 16-bit PCM (starts playing in ~1 s instead of after the whole line). */
export async function speakStream(text: string, opts: SpeakOpts = {}): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }> {
  const { line, lang, style } = prepareLine(text, opts)
  if (!voxInstalled()) throw new Error('no voice is available (VoxCPM2 is not installed in tools/voxcpm)')
  const out = await voxStream(line, { waitMs: LIVE_WAIT_MS, signal: opts.signal, lang, style })
  if (!out) throw new Error(why(await voxHealth()))
  return out
}

/** The PCM samples and format of a WAV, wherever its "data" chunk sits. */
export function readWav(wav: Buffer): { pcm: Buffer; rate: number; channels: number; bits: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let rate = 22050
  let channels = 1
  let bits = 16
  let at = 12
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    const body = at + 8
    if (id === 'fmt ') {
      channels = wav.readUInt16LE(body + 2)
      rate = wav.readUInt32LE(body + 4)
      bits = wav.readUInt16LE(body + 14)
    } else if (id === 'data') {
      return { pcm: wav.subarray(body, Math.min(wav.length, body + size)), rate, channels, bits }
    }
    at = body + size + (size % 2)
  }
  throw new Error('WAV has no audio data')
}
