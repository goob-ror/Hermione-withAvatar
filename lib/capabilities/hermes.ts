import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { MarketplaceRecord } from './store'

/**
 * The Hermes Marketplace (Nous Research's Hermes Agent, MIT): an open,
 * human-reviewed catalog in the NousResearch/hermes-agent repo —
 *
 *   plugin-catalog/<name>.yaml        plugins pinned to an exact commit SHA
 *   optional-mcps/<name>/manifest.yaml  curated MCP servers
 *   skills/…/SKILL.md, optional-skills/…/SKILL.md   skills (same open standard)
 *
 * The repo is 1.5 GB, so only those folders are fetched (sparse clone, ~45 MB).
 *
 * What runs in Hermione: skills, MCP servers, and "portable" plugins (Agent
 * Plugins v1: plugin.json + mcp.json + skills/). Plugins that declare Python
 * tools / hooks / middleware run only inside Hermes Agent and are marked so.
 */

export const HERMES_MARKETPLACE: MarketplaceRecord = {
  id: 'hermes',
  url: 'https://github.com/NousResearch/hermes-agent.git',
  label: 'Hermes Marketplace',
  kind: 'hermes',
  builtin: true,
}
export const HERMES_FOLDERS = ['plugin-catalog', 'optional-mcps', 'optional-skills', 'skills']

function git(args: string[], cwd?: string) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 240_000, windowsHide: true })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim().split('\n').pop()}`)
}

/** Fetch only the catalog folders (or refresh them). */
export function sparseSync(url: string, dir: string, refresh: boolean) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', '--quiet', url, dir])
    git(['sparse-checkout', 'set', ...HERMES_FOLDERS], dir)
  } else if (refresh) {
    git(['fetch', '--depth', '1', '--filter=blob:none', '--quiet', 'origin'], dir)
    git(['reset', '--hard', '--quiet', 'FETCH_HEAD'], dir)
  }
}

export interface HermesPlugin {
  name: string
  title?: string
  description: string
  repo: string
  sha: string
  subdir?: string
  version?: string
  tier?: string
  category?: string
  docs?: string
  /** Declares Python tools / hooks / middleware: runs only inside Hermes Agent. */
  hermesOnly: boolean
}

export interface HermesMcp {
  name: string
  description: string
  url?: string
  auth: string
  source?: string
  excludedTools: string[]
}

const read = (f: string) => yaml.load(fs.readFileSync(f, 'utf8')) as any

export function hermesPlugins(dir: string): HermesPlugin[] {
  const out: HermesPlugin[] = []
  let files: string[] = []
  try {
    files = fs.readdirSync(path.join(dir, 'plugin-catalog')).filter((f) => f.endsWith('.yaml') && f !== 'removed.yaml')
  } catch {
    return out
  }
  for (const f of files) {
    try {
      const e = read(path.join(dir, 'plugin-catalog', f))
      if (!e?.name || !e.repo || !/^[0-9a-f]{40}$/.test(String(e.sha ?? ''))) continue
      const c = e.capabilities ?? {}
      out.push({
        name: String(e.name),
        title: e.title,
        description: String(e.description ?? '').replace(/\s+/g, ' ').trim(),
        repo: String(e.repo),
        sha: String(e.sha),
        subdir: e.subdir ? String(e.subdir) : undefined,
        version: e.version ? String(e.version) : undefined,
        tier: e.tier,
        category: e.category,
        docs: e.docs_url,
        hermesOnly: !!(c.provides_tools?.length || c.provides_hooks?.length || c.provides_middleware?.length),
      })
    } catch {
      /* a malformed entry */
    }
  }
  const rank = (t?: string) => (t === 'official' ? 0 : t === 'verified' ? 1 : 2)
  return out.sort((a, b) => Number(a.hermesOnly) - Number(b.hermesOnly) || rank(a.tier) - rank(b.tier) || a.name.localeCompare(b.name))
}

export function hermesMcps(dir: string): HermesMcp[] {
  const out: HermesMcp[] = []
  let names: string[] = []
  try {
    names = fs.readdirSync(path.join(dir, 'optional-mcps'))
  } catch {
    return out
  }
  for (const n of names) {
    try {
      const m = read(path.join(dir, 'optional-mcps', n, 'manifest.yaml'))
      out.push({
        name: String(m.name ?? n),
        description: String(m.description ?? '').replace(/\s+/g, ' ').trim(),
        url: m.transport?.type === 'http' ? m.transport.url : undefined,
        auth: String(m.auth?.type ?? 'none'),
        source: m.source,
        excludedTools: m.tools?.default_excluded ?? [],
      })
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => Number(a.auth !== 'none') - Number(b.auth !== 'none') || a.name.localeCompare(b.name))
}

/** Every SKILL.md under skills/ and optional-skills/ (relative paths). */
export function hermesSkillPaths(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string, depth: number) => {
    if (depth > 4) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      out.push(rel)
      return
    }
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'index-cache') walk(`${rel}/${e.name}`, depth + 1)
  }
  walk('skills', 0)
  walk('optional-skills', 0)
  return out
}

/** Clone a plugin repo at its pinned commit (the Hermes trust model). */
export function fetchPinned(repo: string, sha: string, dest: string) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  git(['init', '--quiet'], dest)
  git(['fetch', '--depth', '1', '--quiet', repo, sha], dest)
  git(['checkout', '--quiet', 'FETCH_HEAD'], dest)
}
