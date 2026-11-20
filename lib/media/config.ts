import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { configDir } from '@/lib/agent/providers'

/**
 * Clip studio settings and FFmpeg.
 *
 *   .hermione/media.json  { pexelsKey?, groqKey? }   — free keys the operator pastes in
 *   tools/ffmpeg/*\/bin/ffmpeg.exe                    — portable FFmpeg (or one on PATH)
 *   .hermione/clips/<jobId>/                          — rendered clips and their parts
 *
 * Keys never leave the server: the settings API only reports whether each is set.
 */

interface MediaFile {
  pexelsKey?: string
  groqKey?: string
}

const mediaFile = () => path.join(configDir(), 'media.json')

function readMedia(): MediaFile {
  try {
    return JSON.parse(fs.readFileSync(mediaFile(), 'utf8')) ?? {}
  } catch {
    return {}
  }
}

export function pexelsKey(): string | undefined {
  return readMedia().pexelsKey || process.env.PEXELS_API_KEY || undefined
}

export function groqKey(): string | undefined {
  return readMedia().groqKey || process.env.GROQ_API_KEY || undefined
}

/** Set (non-empty) or clear ('' / null) keys; undefined leaves one unchanged. */
export function saveMediaKeys(input: { pexelsKey?: string | null; groqKey?: string | null }) {
  const cur = readMedia()
  for (const k of ['pexelsKey', 'groqKey'] as const) {
    const v = input[k]
    if (v === undefined) continue
    const clean = (v ?? '').trim()
    if (clean) cur[k] = clean
    else delete cur[k]
  }
  fs.mkdirSync(path.dirname(mediaFile()), { recursive: true })
  fs.writeFileSync(mediaFile(), JSON.stringify(cur, null, 2))
}

let ffmpegCache: { at: number; bin: string | null } | null = null

/** The FFmpeg binary: the project's portable copy first, else FFMPEG_PATH, else "ffmpeg" on PATH (checked). */
export async function ffmpegPath(): Promise<string | null> {
  if (ffmpegCache && Date.now() - ffmpegCache.at < 30_000) return ffmpegCache.bin
  let bin: string | null = null
  const toolsDir = path.join(process.cwd(), 'tools', 'ffmpeg')
  try {
    for (const d of fs.readdirSync(toolsDir)) {
      const exe = path.join(toolsDir, d, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      if (fs.existsSync(exe)) {
        bin = exe
        break
      }
    }
  } catch {
    /* no portable copy */
  }
  if (!bin && process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) bin = process.env.FFMPEG_PATH
  if (!bin) bin = (await run('ffmpeg', ['-version'], { timeoutMs: 5000 }).then(() => 'ffmpeg').catch(() => null)) as string | null
  ffmpegCache = { at: Date.now(), bin }
  return bin
}

export function clipsDir(): string {
  return path.join(configDir(), 'clips')
}

/** Run a program; resolves with stderr (FFmpeg logs there), rejects with its last lines. */
export function run(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true })
    let err = ''
    child.stderr.on('data', (c: Buffer) => {
      err += c.toString()
      if (err.length > 200_000) err = err.slice(-100_000)
    })
    child.stdout.on('data', () => {})
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 300_000)
    const onAbort = () => child.kill('SIGKILL')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolve(err)
      else reject(new Error(`${path.basename(bin)} failed (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`))
    })
  })
}
