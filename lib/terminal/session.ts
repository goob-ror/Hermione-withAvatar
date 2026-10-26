// A single shell process per session, shared by the operator and the agent.
//
// The operator types into the UI, the agent writes through `terminal_run`, and
// both see the same byte stream and the same scrollback. Interrupt is real: the
// shell's process tree is killed and a fresh shell is spawned into the same
// scrollback, so neither side can wedge the other.
//
// Deliberately NOT a PTY: no native module, no node-pty build step. The shell
// reads commands from a pipe and we render our own prompt in the UI, so output
// stays clean and parseable.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { agentRoot } from '@/lib/agent/paths'

const RING_LIMIT = 200_000
const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
/** How long to wait for output to go quiet before treating a run as finished. */
const SETTLE_MS = 250
/** Hard ceiling on waiting for the done-marker. */
const MARKER_GRACE_MS = 1_500

export interface TerminalChunk {
  seq: number
  stream: 'out' | 'err' | 'sys'
  text: string
  at: number
}

interface SharedTerminal {
  id: string
  proc: ChildProcessWithoutNullStreams | null
  shell: string
  buffer: string
  seq: number
  subscribers: Set<(chunk: TerminalChunk) => void>
  /** Collector for the run currently in flight, if any. */
  active: { id: string; chunks: string[]; resolve: (s: string) => void; done: boolean } | null
  busy: boolean
  lastActivity: number
  killed: number
}

const TERMINALS = new Map<string, SharedTerminal>()
const TTL_MS = 6 * 60 * 60 * 1000

function shellFor(): string {
  if (process.platform === 'win32') {
    // git-bash is what the surrounding tooling uses; fall back to cmd.
    const candidates = [process.env.SHELL, 'C:/Program Files/Git/bin/bash.exe', 'bash']
    return candidates.find((c) => c && !c.toLowerCase().endsWith('cmd.exe')) || 'bash'
  }
  return process.env.SHELL || '/bin/bash'
}

function prune() {
  const cutoff = Date.now() - TTL_MS
  for (const [id, t] of TERMINALS) {
    if (t.lastActivity < cutoff && !t.busy) {
      try {
        t.proc?.kill()
      } catch {
        /* already gone */
      }
      TERMINALS.delete(id)
    }
  }
}

function sysText(t: SharedTerminal, text: string) {
  publish(t, 'sys', text)
}

function publish(t: SharedTerminal, stream: TerminalChunk['stream'], text: string) {
  if (!text) return
  t.seq += 1
  t.buffer += text
  if (t.buffer.length > RING_LIMIT) t.buffer = t.buffer.slice(t.buffer.length - RING_LIMIT)
  t.lastActivity = Date.now()

  if (t.active && !t.active.done && stream !== 'sys') {
    t.active.chunks.push(text)
    const marker = doneMarker(t.active.id)
    const joined = t.active.chunks.join('')
    const at = joined.indexOf(marker)
    if (at !== -1) {
      const body = joined.slice(0, at)
      t.active.done = true
      t.active.resolve(body)
    }
  }

  const chunk: TerminalChunk = { seq: t.seq, stream, text, at: t.lastActivity }
  for (const fn of t.subscribers) {
    try {
      fn(chunk)
    } catch {
      /* subscriber died */
    }
  }
}

function doneMarker(id: string): string {
  return `__HERMIONE_DONE_${id}__`
}

function spawnShell(t: SharedTerminal) {
  const shell = shellFor()
  t.shell = shell

  const proc = spawn(/*turbopackIgnore: true*/ shell, [], {
    cwd: agentRoot(),
    env: {
      ...process.env,
      PS1: '',
      PS2: '',
      PROMPT_COMMAND: '',
      TERM: 'dumb',
      // Keep child tools from buffering output forever.
      PYTHONUNBUFFERED: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams

  proc.stdout.setEncoding('utf-8')
  proc.stderr.setEncoding('utf-8')
  proc.stdout.on('data', (d: string) => publish(t, 'out', d))
  proc.stderr.on('data', (d: string) => publish(t, 'err', d))

  proc.on('exit', (code) => {
    if (t.proc !== proc) return // superseded by an interrupt
    t.proc = null
    if (t.active && !t.active.done) {
      t.active.done = true
      t.active.resolve(t.active.chunks.join(''))
    }
    sysText(t, `\n[shell exited with code ${code ?? '?'} — type anything to restart]\n`)
  })

  proc.on('error', (err: Error) => {
    sysText(t, `\n[shell failed to start: ${err.message}]\n`)
  })

  t.proc = proc
  sysText(t, `[terminal ready · ${shell} · ${agentRoot()}]\n`)
}

export function getTerminal(sessionId: string): SharedTerminal {
  prune()
  let t = TERMINALS.get(sessionId)
  if (!t) {
    t = {
      id: sessionId,
      proc: null,
      shell: '',
      buffer: '',
      seq: 0,
      subscribers: new Set(),
      active: null,
      busy: false,
      lastActivity: Date.now(),
      killed: 0,
    }
    TERMINALS.set(sessionId, t)
    spawnShell(t)
  }
  if (!t.proc) spawnShell(t)
  return t
}

export function terminalSnapshot(sessionId: string): { buffer: string; shell: string; busy: boolean } {
  const t = getTerminal(sessionId)
  return { buffer: t.buffer, shell: t.shell, busy: t.busy }
}

export function subscribe(sessionId: string, fn: (chunk: TerminalChunk) => void): () => void {
  const t = getTerminal(sessionId)
  t.subscribers.add(fn)
  return () => {
    t.subscribers.delete(fn)
  }
}

/** Operator keystrokes. Sent verbatim; the shell decides what it means. */
export function writeInput(sessionId: string, data: string): { ok: boolean; output: string } {
  const t = getTerminal(sessionId)
  if (!t.proc) return { ok: false, output: 'shell is not running' }
  t.busy = true
  t.proc.stdin.write(data.endsWith('\n') ? data : `${data}\n`)
  return { ok: true, output: '' }
}

/**
 * Kill the shell's whole process tree and start a fresh one in the same
 * scrollback. This is the only reliable interrupt for a piped (non-PTY) shell,
 * and it works the same whether the operator or the agent asks for it.
 */
export function interrupt(sessionId: string, by: 'user' | 'agent' = 'user'): { ok: boolean; output: string } {
  const t = getTerminal(sessionId)
  const proc = t.proc
  t.killed += 1

  if (t.active && !t.active.done) {
    t.active.done = true
    t.active.resolve(t.active.chunks.join('') || '(interrupted before any output)')
  }
  t.active = null
  t.busy = false

  if (!proc) {
    sysText(t, `\n[interrupt by ${by}: no shell running, starting a fresh one]\n`)
    spawnShell(t)
    return { ok: true, output: 'no shell was running; started a fresh one' }
  }

  t.proc = null
  try {
    if (process.platform === 'win32' && proc.pid) {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true })
    } else {
      proc.kill('SIGKILL')
    }
  } catch {
    /* best effort */
  }

  sysText(t, `\n[— interrupted by ${by} — new shell below —]\n`)
  spawnShell(t)
  return { ok: true, output: 'interrupted; fresh shell started' }
}

/**
 * Run a command in the shared terminal and capture just its output.
 * Used by the agent's `terminal_run` tool — the operator sees the same bytes
 * live, because they arrive through the same subscription.
 */
export async function runInTerminal(
  sessionId: string,
  command: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; output: string; interrupted?: boolean }> {
  const t = getTerminal(sessionId)
  const cmd = command.trim()
  if (!cmd) return { ok: false, output: 'empty command' }
  if (!t.proc) spawnShell(t)
  if (t.active) return { ok: false, output: 'the terminal is already running a command — interrupt it first' }

  const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1000, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  sysText(t, `\n$ ${cmd}\n`)
  t.busy = true

  let sawOutput = false

  const captured = await new Promise<string>((resolve) => {
    let settled = false
    const rec = { id, chunks: [] as string[], done: false }
    const finish = (text: string) => {
      if (settled) return
      settled = true
      rec.done = true
      resolve(text)
    }

    t.active = { id, chunks: rec.chunks, resolve: finish, done: false }

    let quietTimer: NodeJS.Timeout | null = null
    const armQuiet = () => {
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => {
        if (!rec.done) finish(`${rec.chunks.join('')}\n[no output for ${SETTLE_MS}ms — still running in the terminal]`)
      }, SETTLE_MS + MARKER_GRACE_MS + 400)
    }

    const watcher = (chunk: TerminalChunk) => {
      if (chunk.stream !== 'sys') {
        sawOutput = true
        armQuiet()
      }
    }
    t.subscribers.add(watcher)
    armQuiet()

    // Marker carries the exit code so failures are reported honestly.
    t.proc?.stdin.write(`${cmd}\n`)
    t.proc?.stdin.write(`echo "${doneMarker(id)}:$?"\n`)

    setTimeout(() => {
      t.subscribers.delete(watcher)
      if (quietTimer) clearTimeout(quietTimer)
      if (!rec.done) finish(`${rec.chunks.join('')}\n[timed out after ${timeout}ms — still running in the terminal]`)
    }, timeout).unref?.()
  })

  t.busy = false
  t.active = null

  // Strip the echoed command + marker echo line that the shell may repeat back.
  let body = captured
  const markerLine = new RegExp(`^.*${doneMarker(id)}:\\d+.*$`, 'gm')
  const exitMatch = new RegExp(`${doneMarker(id)}:(\\d+)`).exec(body)
  body = body.replace(markerLine, '').replace(new RegExp(`^\\$ ${escapeRe(cmd)}\\s*$`, 'gm'), '')
  body = body.replace(/\s+$/, '')

  const exitCode = exitMatch ? Number(exitMatch[1]) : null
  const output = body || '(no output)'

  if (!sawOutput) return { ok: true, output }

  if (exitCode !== null && exitCode !== 0) {
    return { ok: false, output: `${output}\n[exit ${exitCode}]` }
  }
  return { ok: true, output }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function listTerminals(): { id: string; shell: string; busy: boolean; bytes: number }[] {
  prune()
  return [...TERMINALS.values()].map((t) => ({
    id: t.id,
    shell: t.shell,
    busy: t.busy,
    bytes: t.buffer.length,
  }))
}
