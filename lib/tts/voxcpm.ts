import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Hermione's voice: VoxCPM2 running as a local service
 * (scripts/voxcpm_server.py, in the tools/voxcpm Python environment).
 *
 * Started with the Next server (instrumentation.ts) and kept loaded (~5.5 GB
 * of GPU memory) so she can speak at once. Stopped — the whole process tree —
 * when the server exits. HERMIONE_VOXCPM_IDLE_MIN=N unloads it after N minutes
 * unused (it reloads on the next line); HERMIONE_VOXCPM=off disables it.
 */

const PORT = Number(process.env.VOXCPM_PORT) || 8765
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = process.cwd()
const PYTHON = join(ROOT, 'tools', 'voxcpm', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
const SCRIPT = join(ROOT, 'scripts', 'voxcpm_server.py')

/** off = not installed; idle = installed but not running (starts on demand). */
export type VoxState = 'off' | 'idle' | 'starting' | 'ready' | 'failed'

export interface VoxHealth {
  state: VoxState
  error?: string
  voice?: string
}

const g = globalThis as unknown as {
  __hermioneVox?: {
    child: ChildProcess | null
    startedAt: number
    lastError?: string
    failedAt?: number
    lastUsed?: number
    timer?: NodeJS.Timeout
    exitHook?: boolean
  }
}
const proc = (g.__hermioneVox ??= { child: null, startedAt: 0 })
/** After a failed start (e.g. not enough memory), wait this long before trying again. */
const RETRY_AFTER_MS = 120_000
/** Optional: stop the service after this long unused (0 = keep it loaded). */
const VOX_IDLE_MS = (Number(process.env.HERMIONE_VOXCPM_IDLE_MIN) || 0) * 60_000

/** Kill the service and anything it started. */
function stopTree(child: ChildProcess | null) {
  if (!child?.pid || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill('SIGTERM')
}

/** Unload after VOX_IDLE_MS unused; stop with the server. */
function watchIdle() {
  if (!proc.timer && VOX_IDLE_MS > 0) {
    proc.timer = setInterval(() => {
      if (proc.child && proc.child.exitCode === null && Date.now() - (proc.lastUsed ?? proc.startedAt) > VOX_IDLE_MS) {
        stopTree(proc.child)
        proc.child = null
      }
    }, 60_000)
    proc.timer.unref()
  }
  if (!proc.exitHook) {
    proc.exitHook = true
    const stop = () => stopTree(proc.child)
    process.once('exit', stop)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.once(sig, () => {
        stop()
        process.exit(0)
      })
    }
  }
}

export function voxInstalled(): boolean {
  return process.env.HERMIONE_VOXCPM !== 'off' && existsSync(PYTHON) && existsSync(SCRIPT)
}

async function health(): Promise<{ ready: boolean; loading: boolean; error: string | null; voice?: string } | null> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** Start the service if it isn't running (no-op when installed and already up). */
export async function ensureVox(): Promise<void> {
  if (!voxInstalled()) return
  if (proc.child && proc.child.exitCode === null) return
  if (await health()) return // already running (e.g. survived a hot reload)
  if (proc.failedAt && Date.now() - proc.failedAt < RETRY_AFTER_MS) return
  const child = spawn(PYTHON, [SCRIPT, '--port', String(PORT)], {
    cwd: ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      HF_HOME: join(ROOT, 'tools', 'voxcpm', 'hf'),
      HF_HUB_OFFLINE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.child = child
  proc.startedAt = Date.now()
  proc.lastUsed = Date.now()
  watchIdle()
  proc.lastError = undefined
  proc.failedAt = undefined
  let tail = ''
  const keep = (b: Buffer) => {
    tail = (tail + b.toString()).slice(-2000)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  child.on('exit', (code) => {
    if (proc.child === child) {
      proc.child = null
      if (code) {
        const failed = tail.match(/failed to load: (.+)/)?.[1]
        proc.lastError = failed ?? `voice service exited (${code}): ${tail.trim().split('\n').slice(-2).join(' | ')}`
        proc.failedAt = Date.now()
      }
    }
  })
}

/** Stop the service now and give its GPU memory back. */
export function voxUnload(): void {
  stopTree(proc.child)
  proc.child = null
}

/** Where the voice service is, WITHOUT starting it (status displays). */
export async function voxPeek(): Promise<VoxHealth> {
  if (!voxInstalled()) return { state: 'off' }
  const h = await health()
  if (h?.ready) return { state: 'ready', voice: h.voice }
  if (h?.error) return { state: 'failed', error: h.error }
  if (h?.loading || (proc.child && proc.child.exitCode === null)) return { state: 'starting' }
  if (proc.failedAt && Date.now() - proc.failedAt < RETRY_AFTER_MS) return { state: 'failed', error: proc.lastError }
  return { state: 'idle' }
}

/** Where the voice service is. Calling it also starts the service. */
export async function voxHealth(): Promise<VoxHealth> {
  if (!voxInstalled()) return { state: 'off' }
  await ensureVox()
  const h = await health()
  if (h?.ready) return { state: 'ready', voice: h.voice }
  if (h?.error) return { state: 'failed', error: h.error }
  if (h?.loading || (proc.child && proc.child.exitCode === null)) return { state: 'starting' }
  return { state: 'failed', error: proc.lastError ?? 'the voice service is not running' }
}

/**
 * Speech from VoxCPM2, or null when it isn't ready (caller falls back).
 * `waitMs` waits for the model to finish loading first (used by clip renders).
 */
export async function voxSpeak(text: string, opts: { waitMs?: number; style?: string; lang?: 'en' | 'id'; signal?: AbortSignal } = {}): Promise<Buffer | null> {
  if (!voxInstalled()) return null
  proc.lastUsed = Date.now()
  const until = Date.now() + (opts.waitMs ?? 0)
  for (;;) {
    const h = await voxHealth()
    if (h.state === 'ready') break
    if (h.state !== 'starting' || Date.now() >= until || opts.signal?.aborted) return null
    await new Promise((r) => setTimeout(r, 1500))
  }
  try {
    const res = await fetch(`${BASE}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style: opts.style, lang: opts.lang ?? 'en' }),
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000),
    })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  } finally {
    proc.lastUsed = Date.now()
  }
}

/**
 * Streamed speech: the service's raw 16-bit PCM as it is generated (first audio
 * in ~0.2 s), or null when the voice isn't ready within `waitMs`.
 */
export async function voxStream(
  text: string,
  opts: { waitMs?: number; style?: string; lang?: 'en' | 'id'; signal?: AbortSignal } = {},
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null> {
  if (!voxInstalled()) return null
  proc.lastUsed = Date.now()
  const until = Date.now() + (opts.waitMs ?? 0)
  for (;;) {
    const h = await voxHealth()
    if (h.state === 'ready') break
    if (h.state !== 'starting' || Date.now() >= until || opts.signal?.aborted) return null
    await new Promise((r) => setTimeout(r, 1500))
  }
  try {
    const res = await fetch(`${BASE}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style: opts.style, lang: opts.lang ?? 'en' }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) return null
    return { body: res.body, sampleRate: Number(res.headers.get('X-Sample-Rate')) || 48000 }
  } catch {
    return null
  }
}
