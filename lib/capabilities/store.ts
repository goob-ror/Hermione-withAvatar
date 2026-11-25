import fs from 'fs'
import path from 'path'
import { configDir } from '@/lib/agent/providers'

/**
 * Hermione's Capabilities — what she can use beyond her built-in brain:
 *
 *   tools       per-tool policy for every tool she has (built-in or connector)
 *   skills      instruction packs (SKILL.md), from her own store or linked folders
 *   connectors  MCP servers whose tools she can call
 *   plugins     bundles of skills + connectors
 *
 *   .hermione/capabilities/config.json   this file's state
 *   .hermione/capabilities/skills/<name>/SKILL.md   skills written here (or by her, once approved)
 */

/**
 * How a tool is gated:
 *   default — its own tier: read-only runs, others follow the permission mode
 *   off     — hidden from her entirely
 *   ask     — always shows you an approval card (even in Auto or Off)
 *   judge   — the judge model decides (even in Ask mode); you're asked only when it's unsure
 */
export const TOOL_POLICIES = ['default', 'off', 'ask', 'judge'] as const
export type ToolPolicy = (typeof TOOL_POLICIES)[number]

export interface ConnectorConfig {
  id: string
  label: string
  /** stdio: a local command. http: a Streamable HTTP endpoint. */
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  /** Where it came from: added by you, a plugin, or imported from Claude. */
  source: 'you' | 'plugin' | 'claude'
  pluginId?: string
  addedAt: number
}

export interface PluginRecord {
  id: string
  name: string
  description?: string
  version?: string
  /** Installed folder (copied into .hermione/capabilities/plugins, or a linked folder). */
  dir: string
  enabled: boolean
  installedAt: number
  origin?: string
}

/** Something Hermione suggests adding; the operator installs or dismisses it. */
export interface Suggestion {
  id: string
  kind: 'plugin' | 'connector'
  title: string
  /** plugin: folder or Git URL. connector: an http(s) URL or a command line. */
  source: string
  reason: string
  at: number
}

export interface CapabilitiesFile {
  version: 1
  tools: Record<string, ToolPolicy>
  /** Extra folders whose sub-folders are skills (e.g. ~/.claude/skills). */
  skillSources: string[]
  /** Per-skill switch (key = skill name); missing = enabled. */
  skills: Record<string, { enabled: boolean }>
  connectors: ConnectorConfig[]
  plugins: PluginRecord[]
  suggestions: Suggestion[]
}

export const capabilitiesDir = () => path.join(configDir(), 'capabilities')
const file = () => path.join(capabilitiesDir(), 'config.json')
export const ownSkillsDir = () => path.join(capabilitiesDir(), 'skills')
export const pluginsDir = () => path.join(capabilitiesDir(), 'plugins')

const empty = (): CapabilitiesFile => ({ version: 1, tools: {}, skillSources: [], skills: {}, connectors: [], plugins: [], suggestions: [] })

let cache: { file: string; mtime: number; data: CapabilitiesFile } | null = null

export function loadCapabilities(): CapabilitiesFile {
  const f = file()
  let mtime = 0
  try {
    mtime = fs.statSync(f).mtimeMs
  } catch {
    return empty()
  }
  if (cache && cache.file === f && cache.mtime === mtime) return cache.data
  let data = empty()
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
    data = {
      version: 1,
      tools: Object.fromEntries(
        Object.entries(raw?.tools ?? {}).filter(([, v]) => (TOOL_POLICIES as readonly string[]).includes(v as string)),
      ) as Record<string, ToolPolicy>,
      skillSources: Array.isArray(raw?.skillSources) ? raw.skillSources.filter((s: unknown) => typeof s === 'string') : [],
      skills: raw?.skills && typeof raw.skills === 'object' ? raw.skills : {},
      connectors: Array.isArray(raw?.connectors) ? raw.connectors : [],
      plugins: Array.isArray(raw?.plugins) ? raw.plugins : [],
      suggestions: Array.isArray(raw?.suggestions) ? raw.suggestions : [],
    }
  } catch {
    /* unreadable: start empty */
  }
  cache = { file: f, mtime, data }
  return data
}

export function saveCapabilities(data: CapabilitiesFile) {
  fs.mkdirSync(capabilitiesDir(), { recursive: true })
  const tmp = `${file()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file())
  cache = null
}

export function updateCapabilities(fn: (d: CapabilitiesFile) => void): CapabilitiesFile {
  const d = structuredClone(loadCapabilities())
  fn(d)
  saveCapabilities(d)
  return d
}

/** A tool's policy (connector tools that aren't read-only default to "judge"). */
export function toolPolicy(name: string, fallback: ToolPolicy = 'default'): ToolPolicy {
  return loadCapabilities().tools[name] ?? fallback
}

export function setToolPolicy(name: string, policy: ToolPolicy) {
  updateCapabilities((d) => {
    if (policy === 'default') delete d.tools[name]
    else d.tools[name] = policy
  })
}

/** For tests. */
export function _resetCapabilitiesCache() {
  cache = null
}
