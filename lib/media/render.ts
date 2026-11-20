import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { pcmToWav } from '@/lib/tts/audio'
import { engineLabel, readWav, speak, type Engine, type Speech } from '@/lib/tts/speech'
import { voxInstalled } from '@/lib/tts/voxcpm'
import type { VoiceLang } from '@/lib/tts/language'
import { clipsDir, ffmpegPath, groqKey, pexelsKey, run } from './config'
import { searchStock, type StockClip } from './pexels'
import { alignWords, buildAss, estimateWords, groqWordTimes, type BeatTiming } from './captions'

/**
 * Script → finished vertical clip, all free:
 *   VoxCPM2 voiceover per beat (English, or Indonesian for Indonesian Forge scripts) → Pexels B-roll per beat (or a plain backdrop)
 *   → word-timed captions (Groq Whisper or estimate) → FFmpeg 1080×1920 MP4.
 *
 * Output: .hermione/clips/<jobId>/{clip.mp4, cover.jpg, voice.wav, captions.ass, credits.txt, job.json}
 */

export interface Beat {
  /** Spoken line. */
  vo: string
  /** Text overlay at the top (optional). */
  onScreen?: string
  /** Stock-footage search words (English works best on Pexels). */
  broll?: string
  /** Hold the beat at least this long (s). */
  seconds?: number
}

export interface ClipResult {
  jobId: string
  dir: string
  title: string
  duration: number
  file: string
  cover: string
  credits: string[]
  warnings: string[]
  captionTiming: 'whisper' | 'estimate'
  /** Which voice spoke the clip. */
  voice: Engine
  /** The voiceover's language. */
  voiceLang: VoiceLang
}

export type Progress = (step: string) => void

const W = 1080
const H = 1920
const FPS = 30
/** Breath after each line before the next beat. */
const GAP = 0.25

export const jobDir = (jobId: string) => path.join(clipsDir(), jobId)

export function newJobId(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${slug || 'clip'}-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`
}

/** A font libass can load without system font config: copy a bold Windows font into the job. */
function provideFont(dir: string): string {
  const fontsDir = path.join(dir, 'fonts')
  const candidates = [
    ['C:/Windows/Fonts/arialbd.ttf', 'Arial'],
    ['C:/Windows/Fonts/segoeuib.ttf', 'Segoe UI'],
    ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'DejaVu Sans'],
    ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'Arial'],
  ]
  for (const [file, name] of candidates) {
    if (fs.existsSync(file)) {
      fs.mkdirSync(fontsDir, { recursive: true })
      fs.copyFileSync(file, path.join(fontsDir, path.basename(file)))
      return name
    }
  }
  return 'Arial'
}

async function download(url: string, to: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > 150_000_000) throw new Error('stock clip too large')
  fs.writeFileSync(to, buf)
}

export async function renderClip(input: {
  title: string
  beats: Beat[]
  language?: string
  /** Voice language for the voiceover (English unless an Indonesian Forge clip). */
  voiceLang?: VoiceLang
  /** Only a Content Forge clip may use VoxCPM2 (Indonesian). */
  mode?: 'chat' | 'forge'
  signal?: AbortSignal
  onProgress?: Progress
}): Promise<ClipResult> {
  const ffmpeg = await ffmpegPath()
  if (!ffmpeg) throw new Error('FFmpeg is not installed (tools/ffmpeg)')
  const engine: Engine = 'voxcpm'
  if (!voxInstalled()) throw new Error('VoxCPM2 is not installed (tools/voxcpm) — needed for the voiceover')

  const beats = input.beats.map((b) => ({ ...b, vo: b.vo.replace(/\s+/g, ' ').trim() })).filter((b) => b.vo)
  if (!beats.length) throw new Error('the script has no spoken lines')
  const say = input.onProgress ?? (() => {})
  const warnings: string[] = []
  const jobId = newJobId(input.title)
  const dir = jobDir(jobId)
  fs.mkdirSync(dir, { recursive: true })
  const stop = () => {
    if (input.signal?.aborted) throw new Error('stopped')
  }

  // 1) Voiceover, beat by beat, then one track with a breath between beats.
  // VoxCPM2 for every line (waiting for the model to load first).
  say('Recording the voiceover')
  const parts: { pcm: Buffer; rate: number }[] = []
  try {
    for (const b of beats) {
      stop()
      let got: Speech | null = null
      for (let attempt = 0; attempt < 3 && !got; attempt++) {
        got = await speak(b.vo.slice(0, 600), { purpose: 'clip', signal: input.signal, lang: input.voiceLang ?? 'en', mode: input.mode }).catch(async (e) => {
          if (e?.message !== 'busy') throw e
          await new Promise((r) => setTimeout(r, 700))
          return null
        })
      }
      if (!got) throw new Error('the voice engine stayed busy')
      const w = readWav(got.wav)
      if (w.bits !== 16 || w.channels !== 1) throw new Error('unexpected voice audio format')
      parts.push({ pcm: w.pcm, rate: w.rate })
    }
  } finally {
    // (VoxCPM2 stays loaded: it is Hermione's live voice too.)
  }
  const rate = parts[0].rate
  const timings: BeatTiming[] = []
  const pcmParts: Buffer[] = []
  let t = 0
  beats.forEach((b, i) => {
    const speech = parts[i].pcm.length / (rate * 2)
    const length = Math.max(speech + GAP, b.seconds ?? 0, 1.2)
    const pad = Math.round((length - speech) * rate) * 2
    pcmParts.push(parts[i].pcm, Buffer.alloc(pad))
    timings.push({ vo: b.vo, start: t, speechEnd: t + speech, end: t + length, overlay: b.onScreen })
    t += length
  })
  const duration = t
  const voice = pcmToWav(Buffer.concat(pcmParts), rate)
  fs.writeFileSync(path.join(dir, 'voice.wav'), voice)

  // 2) Caption timing.
  stop()
  let captionTiming: ClipResult['captionTiming'] = 'estimate'
  let words = estimateWords(timings)
  const gkey = groqKey()
  if (gkey) {
    say('Timing the captions')
    try {
      words = alignWords(timings, await groqWordTimes(voice, gkey, input.language))
      captionTiming = 'whisper'
    } catch (err: any) {
      warnings.push(`caption timing fell back to an estimate (${err?.message ?? err})`)
    }
  }
  const font = provideFont(dir)
  fs.writeFileSync(path.join(dir, 'captions.ass'), buildAss(words, timings, font))

  // 3) B-roll per beat (Pexels), cached across clips to spare the free quota.
  const credits: string[] = []
  const key = pexelsKey()
  const stockDir = path.join(clipsDir(), '_stock')
  fs.mkdirSync(stockDir, { recursive: true })
  const used = new Set<number>()
  const footage: (string | null)[] = []
  if (!key) warnings.push('no Pexels key — plain backdrops instead of stock footage (add one in Clip setup)')
  for (let i = 0; i < beats.length; i++) {
    stop()
    const query = (beats[i].broll || beats[i].onScreen || beats[i].vo).slice(0, 80)
    if (!key) {
      footage.push(null)
      continue
    }
    say(`Finding footage (${i + 1}/${beats.length})`)
    let clip: StockClip | null = null
    try {
      clip = await searchStock(query, key, timings[i].end - timings[i].start, used)
    } catch (err: any) {
      warnings.push(`footage for beat ${i + 1}: ${err?.message ?? err}`)
    }
    if (!clip) {
      if (!warnings.some((w) => w.startsWith(`footage for beat ${i + 1}`))) warnings.push(`no stock footage matched "${query}" — plain backdrop used`)
      footage.push(null)
      continue
    }
    const file = path.join(stockDir, `${clip.id}.mp4`)
    try {
      if (!fs.existsSync(file)) await download(clip.url, file)
      footage.push(file)
      credits.push(`Beat ${i + 1}: video by ${clip.author} on Pexels — ${clip.page}`)
    } catch (err: any) {
      warnings.push(`footage for beat ${i + 1}: ${err?.message ?? err}`)
      footage.push(null)
    }
  }

  // 4) One vertical segment per beat, then the full picture track.
  const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p`
  const list: string[] = []
  for (let i = 0; i < beats.length; i++) {
    stop()
    say(`Cutting the picture (${i + 1}/${beats.length})`)
    const seg = `seg${i}.mp4`
    const len = (timings[i].end - timings[i].start).toFixed(3)
    const src = footage[i]
    const args = src
      ? ['-y', '-stream_loop', '-1', '-i', src, '-t', len, '-vf', `${cover},eq=brightness=-0.05:saturation=1.08`, '-an']
      : ['-y', '-f', 'lavfi', '-i', `color=c=0x1b1722:s=${W}x${H}:r=${FPS}`, '-t', len, '-vf', 'vignette=PI/4,format=yuv420p']
    await run(ffmpeg, [...args, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', String(FPS), seg], { cwd: dir, signal: input.signal })
    list.push(`file '${seg}'`)
  }
  fs.writeFileSync(path.join(dir, 'segments.txt'), `${list.join('\n')}\n`)
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', 'picture.mp4'], { cwd: dir, signal: input.signal })

  // 5) Captions + voice → the clip (loudness levelled for phones), and a cover frame.
  stop()
  say('Rendering the clip')
  await run(
    ffmpeg,
    [
      '-y', '-i', 'picture.mp4', '-i', 'voice.wav',
      '-vf', 'ass=captions.ass:fontsdir=fonts',
      '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
      '-t', duration.toFixed(3), '-movflags', '+faststart', 'clip.mp4',
    ],
    { cwd: dir, signal: input.signal, timeoutMs: 600_000 },
  )
  await run(ffmpeg, ['-y', '-ss', Math.min(1, duration / 3).toFixed(2), '-i', 'clip.mp4', '-frames:v', '1', '-q:v', '3', 'cover.jpg'], { cwd: dir })

  // Tidy the intermediates; keep what's useful for re-editing.
  for (const f of fs.readdirSync(dir)) if (/^seg\d+\.mp4$|^segments\.txt$|^picture\.mp4$/.test(f)) fs.rmSync(path.join(dir, f), { force: true })
  fs.writeFileSync(
    path.join(dir, 'credits.txt'),
    `${credits.join('\n') || 'No stock footage used.'}\nVoice: ${engineLabel()} (local)\n`,
  )
  const result: ClipResult = {
    jobId,
    dir,
    title: input.title,
    duration: Number(duration.toFixed(2)),
    file: path.join(dir, 'clip.mp4'),
    cover: path.join(dir, 'cover.jpg'),
    credits,
    warnings,
    captionTiming,
    voice: engine,
    voiceLang: input.voiceLang ?? 'en',
  }
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ ...result, beats, createdAt: Date.now() }, null, 2))
  return result
}
