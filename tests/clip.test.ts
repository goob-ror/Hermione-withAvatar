import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { alignWords, assText, buildAss, chunkWords, estimateWords, type BeatTiming } from '@/lib/media/captions'
import { pickVideoFile } from '@/lib/media/pexels'
import { parseBeats } from '@/lib/tools/clip'
import { describeTool } from '@/lib/agent/stepText'

// Renders go to a temp config dir, never the real .hermione/clips.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-clip-'))
process.env.HERMIONE_CONFIG_DIR = dir
afterAll(() => {
  if (process.env.KEEP_CLIP_DIR) console.log(`clip test dir kept: ${dir}`)
  else fs.rmSync(dir, { recursive: true, force: true })
})

const beats: BeatTiming[] = [
  { vo: 'Akun SSCASN sudah dibuka!', start: 0, speechEnd: 2, end: 2.25, overlay: 'AKUN DIBUKA' },
  { vo: 'Siapkan KTP dan email aktif.', start: 2.25, speechEnd: 4.5, end: 4.75 },
]

describe('captions', () => {
  it('estimates word times inside each beat, in order', () => {
    const w = estimateWords(beats)
    expect(w.map((x) => x.word)).toEqual(['Akun', 'SSCASN', 'sudah', 'dibuka!', 'Siapkan', 'KTP', 'dan', 'email', 'aktif.'])
    expect(w[0].start).toBe(0)
    expect(w[3].end).toBeCloseTo(2, 5)
    expect(w[4].start).toBeCloseTo(2.25, 5)
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThanOrEqual(w[i - 1].start)
  })

  it("keeps the script's words but takes Whisper's timing", () => {
    const heard = [
      { word: 'Akun', start: 0.1, end: 0.4 },
      { word: 'SSC', start: 0.45, end: 0.9 },
      { word: 'ASN', start: 0.9, end: 1.2 },
      { word: 'sudah', start: 1.25, end: 1.5 },
      { word: 'dibuka', start: 1.55, end: 1.95 },
      { word: 'Siapkan', start: 2.3, end: 2.8 },
      { word: 'KTP', start: 2.85, end: 3.2 },
      { word: 'dan', start: 3.25, end: 3.4 },
      { word: 'email', start: 3.45, end: 3.8 },
      { word: 'aktif', start: 3.85, end: 4.3 },
    ]
    const w = alignWords(beats, heard)
    expect(w.map((x) => x.word)).toEqual(['Akun', 'SSCASN', 'sudah', 'dibuka!', 'Siapkan', 'KTP', 'dan', 'email', 'aktif.'])
    expect(w[4]).toMatchObject({ word: 'Siapkan', start: 2.3 }) // same count in beat 2 → one-to-one
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThan(w[i - 1].start)
  })

  it('groups words three at a time, breaking at punctuation', () => {
    const chunks = chunkWords(estimateWords(beats)).map((c) => c.map((w) => w.word).join(' '))
    expect(chunks).toEqual(['Akun SSCASN sudah', 'dibuka!', 'Siapkan KTP dan', 'email aktif.'])
  })

  it('writes an ASS file: yellow current word, overlay box, no injected override codes', () => {
    const ass = buildAss(estimateWords([{ ...beats[0], vo: 'Hi {\\pos(0,0)} there' }, beats[1]]), beats)
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('Style: Overlay,')
    expect(ass).toMatch(/Dialogue: 1,0:00:00\.00,0:00:02\.25,Overlay,,0,0,0,,AKUN DIBUKA/)
    expect(ass).toMatch(/\{\\c&H00E6FF&\}Hi\{\\c&HFFFFFF&\}/)
    expect(ass).not.toContain('\\pos')
    expect(assText('a {b} c\\d')).toBe('a b c/d')
  })
})

describe('clip_render input', () => {
  it('cleans beats and ignores empty ones', () => {
    expect(parseBeats([{ vo: ' Halo  semua ', on_screen: 'HALO', broll: 'people waving' }, { vo: '' }, { text: 'Ayo daftar', seconds: 99 }])).toEqual([
      { vo: 'Halo semua', onScreen: 'HALO', broll: 'people waving' },
      { vo: 'Ayo daftar', seconds: 20 },
    ])
    expect(parseBeats('nope')).toBeNull()
    expect(parseBeats([{ on_screen: 'only text' }])).toBeNull()
  })

  it('picks a portrait, roughly 1080-wide mp4 and skips 4K', () => {
    const f = pickVideoFile({
      video_files: [
        { link: 'a', file_type: 'video/mp4', width: 3840, height: 2160 },
        { link: 'b', file_type: 'video/mp4', width: 2160, height: 3840 },
        { link: 'c', file_type: 'video/mp4', width: 1080, height: 1920 },
        { link: 'd', file_type: 'video/mp4', width: 1920, height: 1080 },
      ],
    })
    expect(f?.link).toBe('c')
    expect(pickVideoFile({ video_files: [] })).toBeNull()
  })

  it('describes the production tools in plain words', () => {
    expect(describeTool('clip_render', { title: 'CPNS tips' })).toBe('Making the clip “CPNS tips”')
    expect(describeTool('clip_upload', { platform: 'tiktok' }, true)).toBe('Prepared the TikTok upload')
  })
})

// A real render with the PC's FFmpeg + VoxCPM2 (English; no keys: plain backdrops, estimated timing).
// Opt-in (HERMIONE_TEST_VOICE=1): it loads the voice model on the GPU.
const ffmpegDir = path.join(process.cwd(), 'tools', 'ffmpeg')
const haveTools =
  fs.existsSync(ffmpegDir) &&
  fs.readdirSync(ffmpegDir).length > 0 &&
  process.env.HERMIONE_TEST_VOICE === '1' &&
  fs.existsSync(path.join(process.cwd(), 'tools', 'voxcpm', '.venv')) &&
  !process.env.PEXELS_API_KEY &&
  !process.env.GROQ_API_KEY

describe.skipIf(!haveTools)('renderClip (real FFmpeg + VoxCPM2)', () => {
  it('renders a 1080×1920 MP4 with voice, captions and a cover', async () => {
    const { renderClip } = await import('@/lib/media/render')
    const steps: string[] = []
    const r = await renderClip({
      title: 'Test clip',
      beats: [
        { vo: 'Hello! This is a quick test.', onScreen: 'TEST' },
        { vo: 'Captions follow every word.' },
      ],
      onProgress: (s) => steps.push(s),
    })
    expect(fs.existsSync(r.file)).toBe(true)
    expect(fs.existsSync(r.cover)).toBe(true)
    expect(r.captionTiming).toBe('estimate')
    expect(r.warnings.join(' ')).toMatch(/no Pexels key/)
    expect(steps).toContain('Rendering the clip')
    const ffprobe = path.join(ffmpegDir, fs.readdirSync(ffmpegDir)[0], 'bin', 'ffprobe.exe')
    const probe = JSON.parse(
      execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', r.file]).toString(),
    )
    const video = probe.streams.find((s: any) => s.codec_type === 'video')
    expect(video).toMatchObject({ width: 1080, height: 1920 })
    expect(probe.streams.some((s: any) => s.codec_type === 'audio')).toBe(true)
    expect(Number(probe.format.duration)).toBeCloseTo(r.duration, 0)
    // Intermediates are cleaned up; the useful parts stay.
    expect(fs.readdirSync(r.dir).sort()).toEqual(['captions.ass', 'clip.mp4', 'cover.jpg', 'credits.txt', 'fonts', 'job.json', 'voice.wav'])
  }, 180_000)
})
