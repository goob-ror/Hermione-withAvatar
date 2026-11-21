import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { configDir } from '@/lib/agent/providers'
import { voxHealth } from './voxcpm'
import { speak } from './speech'
import { voiceLine, voiceModel } from './voiceAgent'

/**
 * Cached intro greetings in Hermione's voice (VoxCPM2).
 *
 * Up to 5 per screen (Chat, Content Forge), each a different line, saved in
 * .hermione/voice-cache/greetings/. The intro plays a random cached one at
 * once — even while VoxCPM2 is still loading — and, until there are 5, a new
 * one is generated in the background for next time.
 *
 * The cache is thrown away when the operator's name or Hermione's English
 * voice (tools/voxcpm/voice/reference-en.wav) or the voice model changes.
 */

export type GreetingMode = 'chat' | 'forge'
export const MAX_GREETINGS = 5

export const GREETING_LINES: Record<GreetingMode, string[]> = {
  chat: [
    "Hello, {name}. I'm Hermione. Let's build something today.",
    'Good to see you, {name}. What shall we work on?',
    "Welcome back, {name}. I'm ready whenever you are.",
    'Hello again, {name}. Where would you like to begin?',
    "Hi, {name}. Take your time. I'm here when you're ready.",
  ],
  forge: [
    "Welcome to the Content Forge, {name}. Pick a topic, and let's find what's trending.",
    "Hello, {name}. Let's turn today's trends into something worth watching.",
    'Welcome back to the Forge, {name}. What story shall we tell today?',
    "Hi, {name}. Choose a topic, and I'll dig into what's catching on.",
    "Ready when you are, {name}. Let's find the next clip worth making.",
  ],
}

interface Entry {
  file: string
  text: string
  createdAt: number
}

interface Index {
  /** Fingerprint of the name + voice the clips were made with. */
  key: string
  entries: Entry[]
}

/** Hermione's English reference clip: replacing it changes her voice. */
function voiceRefStamp(): string {
  try {
    const st = fs.statSync(path.join(process.cwd(), 'tools', 'voxcpm', 'voice', 'reference-en.wav'))
    return `${st.size}-${Math.round(st.mtimeMs)}`
  } catch {
    return 'none'
  }
}

/** The voice the clips are made with; a change resets the cache. */
// v3: written by the voice subagent (lib/tts/voiceAgent.ts); a new voice model regenerates them.
const VOICE_ID = () => {
  const m = voiceModel()
  return `voxcpm-v4-${voiceRefStamp()}-${m ? m.model : 'rules'}`
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'you'

export function greetingDir(mode: GreetingMode, name: string): string {
  return path.join(configDir(), 'voice-cache', 'greetings', `${mode}-${slug(name)}`)
}

/** Changes when the operator's name or Hermione's English voice changes. */
function fingerprint(name: string): string {
  return crypto.createHash('sha1').update(`${name}|${VOICE_ID()}`).digest('hex').slice(0, 16)
}

function readIndex(dir: string, key: string): Index {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as Index
    if (idx.key === key) return { key, entries: idx.entries.filter((e) => fs.existsSync(path.join(dir, e.file))) }
  } catch {
    /* none yet */
  }
  // Different name/voice (or first use): start fresh.
  fs.rmSync(dir, { recursive: true, force: true })
  return { key, entries: [] }
}

function writeIndex(dir: string, idx: Index) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 2))
}

/** A line not cached yet (random among the unused ones). */
export function nextLine(mode: GreetingMode, name: string, used: string[]): string | null {
  const lines = GREETING_LINES[mode].map((l) => l.replaceAll('{name}', name))
  const fresh = lines.filter((l) => !used.includes(l))
  return fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : null
}

const generating = new Set<string>()

/** Make and save one new greeting (if the natural voice is ready and the cache isn't full). */
export async function generateGreeting(mode: GreetingMode, name: string): Promise<Entry | null> {
  const dir = greetingDir(mode, name)
  if (generating.has(dir)) return null
  generating.add(dir)
  try {
    if ((await voxHealth()).state !== 'ready') return null
    const idx = readIndex(dir, fingerprint(name))
    if (idx.entries.length >= MAX_GREETINGS) return null
    const text = nextLine(mode, name, idx.entries.map((e) => e.text))
    if (!text) return null
    // The voice subagent makes it sound bright and in-persona (rules if it can't).
    const spoken = await voiceLine(text, 'greeting')
    const wav = await speak(spoken.text, { lang: 'en', greeting: true }).then((s) => s.wav).catch(() => null)
    if (!wav) return null
    const entry: Entry = { file: `greeting-${Date.now()}.wav`, text, createdAt: Date.now() }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, entry.file), wav)
    // Merge with whatever is on disk now (never reset here — that would delete
    // the clip just saved when this is the first one).
    let entries = idx.entries
    try {
      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as Index
      if (onDisk.key === idx.key) entries = onDisk.entries
    } catch {
      /* first greeting: no index yet */
    }
    writeIndex(dir, { key: idx.key, entries: [...entries.filter((e) => e.text !== entry.text), entry] })
    return entry
  } finally {
    generating.delete(dir)
  }
}

/**
 * The greeting to play now:
 *   - cached ones exist → a random one, instantly (and top up the cache in the
 *     background while there are fewer than 5);
 *   - none yet → make one now if the natural voice is ready;
 *   - otherwise null (the caller waits for the voice or uses the backup).
 */
export async function pickGreeting(mode: GreetingMode, name: string): Promise<{ wav: Buffer; text: string; fresh: boolean; cached: number } | null> {
  const dir = greetingDir(mode, name)
  const idx = readIndex(dir, fingerprint(name))
  if (idx.entries.length) {
    const e = idx.entries[Math.floor(Math.random() * idx.entries.length)]
    if (idx.entries.length < MAX_GREETINGS) void generateGreeting(mode, name).catch(() => {})
    return { wav: fs.readFileSync(path.join(dir, e.file)), text: e.text, fresh: false, cached: idx.entries.length }
  }
  const made = await generateGreeting(mode, name)
  if (!made) return null
  return { wav: fs.readFileSync(path.join(dir, made.file)), text: made.text, fresh: true, cached: 1 }
}
