import fs from 'fs'
import os from 'os'
import path from 'path'
import { capabilitiesDir, loadCapabilities, ownSkillsDir, updateCapabilities } from './store'

/**
 * Skills: instruction packs in the Claude format — a folder with a SKILL.md
 * (front matter `name` + `description`, then the instructions) and optional
 * reference files next to it.
 *
 * Only the names and descriptions go in Hermione's prompt; she loads a
 * skill's full instructions with `skill_use` when a task matches.
 *
 *   builtin  capabilities/skills/<name>/ — Hermione's starter pack, shipped with her
 *   own      .hermione/capabilities/skills/<name>/
 *   linked   any folder you add as a source (e.g. ~/.claude/skills), read live
 *   plugin   skills/ inside an installed plugin
 *   proposed .hermione/capabilities/proposed/<name>/ — written by Hermione,
 *            inert until you approve it
 */

export interface Skill {
  name: string
  description: string
  dir: string
  source: 'builtin' | 'own' | 'linked' | 'plugin' | 'proposed'
  /** The linked folder or plugin it came from. */
  origin?: string
  enabled: boolean
  /** Reference files next to SKILL.md (relative paths). */
  files: string[]
}

export const proposedDir = () => path.join(capabilitiesDir(), 'proposed')
/** The starter skills shipped in the repo. */
export const builtinSkillsDir = () => path.join(process.cwd(), 'capabilities', 'skills')
export const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const NAME = /^[a-z0-9][a-z0-9-]{1,48}$/
const MAX_SKILL_CHARS = 40_000

/** Front matter (`key: value` lines between --- fences) and the body. */
export function parseSkillMd(text: string): { meta: Record<string, string>; body: string } {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  let key = ''
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (kv) {
      key = kv[1].toLowerCase()
      meta[key] = kv[2].replace(/^["']|["']$/g, '').replace(/^[>|]-?\s*$/, '')
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = `${meta[key]} ${line.trim()}`.trim() // folded / continued value
    }
  }
  return { meta, body: m[2] }
}

export function skillMd(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description.replace(/\s+/g, ' ').trim()}\n---\n\n${body.trim()}\n`
}

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= 60 || e.name.startsWith('.') || e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) listFiles(full, base, out)
    else if (e.name !== 'SKILL.md') out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}

function readSkill(dir: string, source: Skill['source'], origin: string | undefined, enabled: (n: string) => boolean): Skill | null {
  try {
    const { meta } = parseSkillMd(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
    const name = (meta.name || path.basename(dir)).trim()
    let from = origin
    try {
      from = fs.readFileSync(path.join(dir, '.origin'), 'utf8').trim() || origin
    } catch {
      /* no recorded origin */
    }
    return { name, description: (meta.description || '').trim(), dir, source, origin: from, enabled: source !== 'proposed' && enabled(name), files: listFiles(dir) }
  } catch {
    return null
  }
}

function skillsIn(root: string, source: Skill['source'], origin: string | undefined, enabled: (n: string) => boolean): Skill[] {
  let dirs: string[] = []
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, e.name))
  } catch {
    return []
  }
  return dirs.map((d) => readSkill(d, source, origin, enabled)).filter((s): s is Skill => !!s)
}

/** Every skill: own, plugin, linked, then built-in (first name wins), plus pending proposals. */
export function listSkills(opts: { includeProposed?: boolean } = {}): Skill[] {
  const caps = loadCapabilities()
  const enabled = (n: string) => caps.skills[n]?.enabled !== false
  const found: Skill[] = [
    ...skillsIn(ownSkillsDir(), 'own', undefined, enabled),
    ...caps.plugins.filter((p) => p.enabled).flatMap((p) => skillsIn(path.join(p.dir, 'skills'), 'plugin', p.name, enabled)),
    ...caps.skillSources.flatMap((src) => skillsIn(src, 'linked', src, enabled)),
    ...skillsIn(builtinSkillsDir(), 'builtin', undefined, enabled),
  ]
  const seen = new Set<string>()
  const out = found.filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)))
  return opts.includeProposed ? [...out, ...skillsIn(proposedDir(), 'proposed', undefined, () => false)] : out
}

export function findSkill(name: string): Skill | undefined {
  return listSkills().find((s) => s.name.toLowerCase() === name.trim().toLowerCase())
}

/** The full instructions of an enabled skill. */
export function skillBody(skill: Skill): string {
  const { body } = parseSkillMd(fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8'))
  return body.length > MAX_SKILL_CHARS ? `${body.slice(0, MAX_SKILL_CHARS)}\n… truncated` : body
}

/** Read a reference file inside a skill's folder (never outside it). */
export function skillFile(skill: Skill, rel: string): string {
  const abs = path.resolve(skill.dir, rel)
  const inside = path.relative(skill.dir, abs)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error(`${rel} is not inside the ${skill.name} skill`)
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new Error(`${rel} is not a file`)
  if (st.size > 200_000) throw new Error(`${rel} is too large (${Math.round(st.size / 1024)} KB)`)
  const text = fs.readFileSync(abs, 'utf8')
  if (/\u0000/.test(text.slice(0, 2000))) throw new Error(`${rel} is not a text file`)
  return text
}

/** The prompt block: enabled skills, names + descriptions only (≤ maxChars). */
export function skillsPromptBlock(maxChars = 2000): string {
  const skills = listSkills().filter((s) => s.enabled && s.description)
  if (!skills.length) return ''
  const lines = ['## Skills', 'Instruction packs you can load. When a task matches one, call skill_use with its name FIRST and follow it (it may point to files you read with skill_read):']
  let used = lines.join('\n').length
  let shown = 0
  for (const s of skills) {
    const line = `- ${s.name}: ${s.description.slice(0, 220)}`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length + 1
    shown++
  }
  if (shown < skills.length) lines.push(`- …and ${skills.length - shown} more (capabilities_list shows all)`)
  return lines.join('\n')
}

/* ---------- Managing ---------- */

export function validSkillName(name: string): string | undefined {
  return NAME.test(name) ? undefined : 'a skill name is 2–49 lowercase letters, digits or dashes, starting with a letter or digit'
}

/** Write (or overwrite) one of Hermione's own skills. */
export function writeOwnSkill(name: string, description: string, body: string): Skill {
  const problem = validSkillName(name)
  if (problem) throw new Error(problem)
  if (!description.trim() || !body.trim()) throw new Error('a skill needs a description and instructions')
  const dir = path.join(ownSkillsDir(), name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(name, description, body))
  return readSkill(dir, 'own', undefined, () => true)!
}

/** Hermione's proposal: written to proposed/, inert until approved. */
export function proposeSkill(name: string, description: string, body: string, reason: string): Skill {
  const problem = validSkillName(name)
  if (problem) throw new Error(problem)
  if (!description.trim() || !body.trim()) throw new Error('a skill needs a description and instructions')
  if (body.length > MAX_SKILL_CHARS) throw new Error(`instructions are limited to ${MAX_SKILL_CHARS} characters`)
  const dir = path.join(proposedDir(), name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd(name, description, body))
  fs.writeFileSync(path.join(dir, '.proposal.json'), JSON.stringify({ reason: reason.slice(0, 500), at: Date.now() }, null, 2))
  return readSkill(dir, 'proposed', undefined, () => false)!
}

export function proposalReason(name: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(proposedDir(), name, '.proposal.json'), 'utf8')).reason
  } catch {
    return undefined
  }
}

/** Approve: the proposal becomes (or replaces) her own skill. */
export function approveProposal(name: string): Skill {
  const from = path.join(proposedDir(), name)
  if (!fs.existsSync(path.join(from, 'SKILL.md'))) throw new Error(`no proposed skill "${name}"`)
  const to = path.join(ownSkillsDir(), name)
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(ownSkillsDir(), { recursive: true })
  fs.renameSync(from, to)
  fs.rmSync(path.join(to, '.proposal.json'), { force: true })
  updateCapabilities((d) => {
    d.skills[name] = { enabled: true }
  })
  return readSkill(to, 'own', undefined, () => true)!
}

export function rejectProposal(name: string) {
  fs.rmSync(path.join(proposedDir(), name), { recursive: true, force: true })
}

export function deleteOwnSkill(name: string) {
  const dir = path.join(ownSkillsDir(), name)
  if (!fs.existsSync(dir)) throw new Error(`"${name}" is not one of Hermione's own skills`)
  fs.rmSync(dir, { recursive: true, force: true })
}

export function setSkillEnabled(name: string, enabled: boolean) {
  updateCapabilities((d) => {
    d.skills[name] = { enabled }
  })
}

export function addSkillSource(dir: string) {
  const abs = path.resolve(dir)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`${abs} is not a folder`)
  updateCapabilities((d) => {
    if (!d.skillSources.some((s) => path.resolve(s).toLowerCase() === abs.toLowerCase())) d.skillSources.push(abs)
  })
}

export function removeSkillSource(dir: string) {
  updateCapabilities((d) => {
    d.skillSources = d.skillSources.filter((s) => path.resolve(s).toLowerCase() !== path.resolve(dir).toLowerCase())
  })
}
