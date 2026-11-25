import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseSkillMd, skillMd, validSkillName } from './skills'
import { fetchPinned, HERMES_MARKETPLACE, hermesPlugins, hermesSkillPaths, sparseSync } from './hermes'
import { capabilitiesDir, loadCapabilities, ownSkillsDir, updateCapabilities, type MarketplaceRecord } from './store'

/**
 * Plugin & skill marketplaces — open Git repos in the Claude marketplace
 * format (.claude-plugin/marketplace.json), e.g.
 *
 *   anthropics/claude-plugins-official   300+ plugins
 *   anthropics/skills                    Anthropic's example skills
 *
 * Each is shallow-cloned into .hermione/capabilities/cache/<id> and refreshed
 * at most once a day (or on "Refresh"), so browsing never hits GitHub's API
 * limits. Installing copies files into Hermione's own folders — nothing runs
 * at install time.
 */

export const DEFAULT_MARKETPLACES: MarketplaceRecord[] = [
  { id: 'claude-plugins-official', url: 'https://github.com/anthropics/claude-plugins-official.git', label: 'Claude plugins (official)', builtin: true },
  { id: 'anthropic-skills', url: 'https://github.com/anthropics/skills.git', label: 'Anthropic skills', builtin: true },
  HERMES_MARKETPLACE,
]

const cacheDir = (id: string) => path.join(capabilitiesDir(), 'cache', id)
const DAY = 24 * 60 * 60 * 1000
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'market'

export function marketplaces(): MarketplaceRecord[] {
  return loadCapabilities().marketplaces
}

/** "owner/repo", a GitHub URL or any git URL → a clone URL. */
export function repoUrl(input: string): string {
  const s = input.trim()
  // A Git repo on this PC (your own marketplace).
  if (path.isAbsolute(s) && fs.existsSync(path.join(s, '.git'))) return path.resolve(s)
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return `https://github.com/${s}.git`
  if (/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(s)) return `${s.replace(/\/$/, '')}.git`
  if (/^(?:https?:\/\/|git@)\S+$/.test(s)) return s
  throw new Error(`${input} is not a Git repo (use owner/repo or a URL)`)
}

export function addMarketplace(input: string, label?: string): MarketplaceRecord {
  const url = repoUrl(input)
  const id = slug(url.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('-'))
  const rec: MarketplaceRecord = { id, url, label: label ?? url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') }
  updateCapabilities((d) => {
    if (!d.marketplaces.some((m) => m.id === id || m.url === url)) d.marketplaces.push(rec)
  })
  return rec
}

export function removeMarketplace(id: string) {
  updateCapabilities((d) => {
    d.marketplaces = d.marketplaces.filter((m) => m.id !== id)
  })
  fs.rmSync(cacheDir(id), { recursive: true, force: true })
}

/** Marketplaces your Claude Code knows (~/.claude/plugins/known_marketplaces.json). */
export function claudeMarketplaces(): { label: string; url: string }[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json'), 'utf8'))
    return Object.entries<any>(j)
      .map(([label, v]) => {
        const src = v?.source ?? v
        const url = src?.source === 'github' && src.repo ? `https://github.com/${src.repo}.git` : src?.url
        return url ? { label, url: String(url) } : null
      })
      .filter((x): x is { label: string; url: string } => !!x)
  } catch {
    return []
  }
}

function git(args: string[], cwd?: string) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 180_000, windowsHide: true })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.error?.message || '').trim().split('\n').pop()}`)
}

/** Clone a repo shallowly into `dest` (replacing it). */
export function shallowClone(url: string, dest: string) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  git(['clone', '--depth', '1', '--quiet', url, dest])
}

/** Make sure a marketplace's cache exists and is at most a day old. */
export function syncMarketplace(m: MarketplaceRecord, force = false): string {
  const dir = cacheDir(m.id)
  const stamp = path.join(dir, '.hermione-synced')
  let age = Infinity
  try {
    age = Date.now() - fs.statSync(stamp).mtimeMs
  } catch {
    /* never synced */
  }
  if (m.kind === 'hermes') {
    sparseSync(m.url, dir, force || age > DAY)
    fs.writeFileSync(stamp, String(Date.now()))
    return dir
  }
  if (!fs.existsSync(path.join(dir, '.git'))) shallowClone(m.url, dir)
  else if (force || age > DAY) {
    try {
      git(['fetch', '--depth', '1', '--quiet', 'origin'], dir)
      git(['reset', '--hard', '--quiet', 'FETCH_HEAD'], dir)
    } catch {
      shallowClone(m.url, dir) // a broken cache: start again
    }
  }
  fs.writeFileSync(stamp, String(Date.now()))
  return dir
}

export interface MarketPlugin {
  ref: string
  marketplace: string
  name: string
  description: string
  category?: string
  version?: string
  source: unknown
  skills?: string[]
  /** Hermes Marketplace trust tier: official / verified / community. */
  tier?: string
  /** Runs only inside Hermes Agent (Python tools/hooks): can't run in Hermione. */
  problem?: string
}

export interface MarketSkill {
  ref: string
  marketplace: string
  name: string
  description: string
  path: string
}

function readMarketplaceJson(dir: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8'))
  } catch {
    return null
  }
}

/** Every plugin and skill the marketplaces offer (syncing caches as needed). */
export function browseMarketplaces(opts: { force?: boolean } = {}): { plugins: MarketPlugin[]; skills: MarketSkill[]; errors: string[] } {
  const plugins: MarketPlugin[] = []
  const skills: MarketSkill[] = []
  const errors: string[] = []
  for (const m of marketplaces()) {
    let dir: string
    try {
      dir = syncMarketplace(m, opts.force)
    } catch (err: any) {
      errors.push(`${m.label}: ${err?.message ?? err}`)
      continue
    }
    const seenSkill = new Set<string>()
    if (m.kind === 'hermes') {
      for (const p of hermesPlugins(dir)) {
        plugins.push({
          ref: `plugin:${m.id}/${p.name}`,
          marketplace: m.label,
          name: p.title || p.name,
          description: p.description,
          category: p.category,
          version: p.version,
          tier: p.tier,
          source: { repo: p.repo, sha: p.sha, subdir: p.subdir },
          ...(p.hermesOnly ? { problem: 'Hermes-only plugin (Python tools/hooks that run inside Hermes Agent)' } : {}),
        })
      }
      for (const rel of hermesSkillPaths(dir)) {
        try {
          const { meta } = parseSkillMd(fs.readFileSync(path.join(dir, rel, 'SKILL.md'), 'utf8'))
          skills.push({ ref: `skill:${m.id}/${rel}`, marketplace: m.label, name: meta.name || path.basename(rel), description: meta.description || '', path: rel })
        } catch {
          /* skip */
        }
      }
      continue
    }
    const j = readMarketplaceJson(dir)
    const addSkill = (rel: string) => {
      const norm = rel.replace(/^\.\//, '').replace(/\\/g, '/').replace(/\/$/, '')
      if (seenSkill.has(norm)) return
      try {
        const { meta } = parseSkillMd(fs.readFileSync(path.join(dir, norm, 'SKILL.md'), 'utf8'))
        seenSkill.add(norm)
        skills.push({ ref: `skill:${m.id}/${norm}`, marketplace: m.label, name: meta.name || path.basename(norm), description: meta.description || '', path: norm })
      } catch {
        /* not a skill */
      }
    }
    for (const p of j?.plugins ?? []) {
      if (!p?.name) continue
      plugins.push({
        ref: `plugin:${m.id}/${p.name}`,
        marketplace: m.label,
        name: String(p.name),
        description: String(p.description ?? ''),
        category: p.category,
        version: p.version,
        source: p.source,
        skills: Array.isArray(p.skills) ? p.skills.map(String) : undefined,
      })
      for (const s of p.skills ?? []) addSkill(String(s))
    }
    // Repos that keep skills at skills/<name>/SKILL.md (like anthropics/skills).
    try {
      for (const e of fs.readdirSync(path.join(dir, 'skills'), { withFileTypes: true })) if (e.isDirectory()) addSkill(`skills/${e.name}`)
    } catch {
      /* no skills folder */
    }
  }
  return { plugins, skills, errors }
}

const copyFiltered = (from: string, to: string) =>
  fs.cpSync(from, to, { recursive: true, filter: (f) => !/[\\/](?:\.git|node_modules)(?:[\\/]|$)/.test(f.slice(from.length)) })

/** Install one marketplace skill as one of Hermione's own skills. */
export function installMarketSkill(ref: string): string {
  const m = ref.match(/^skill:([^/]+)\/(.+)$/)
  if (!m) throw new Error(`not a skill reference: ${ref}`)
  const market = marketplaces().find((x) => x.id === m[1])
  if (!market) throw new Error(`unknown marketplace ${m[1]}`)
  const dir = syncMarketplace(market)
  const src = path.resolve(dir, m[2])
  if (path.relative(dir, src).startsWith('..')) throw new Error('bad skill path')
  const { meta, body } = parseSkillMd(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'))
  const name = (meta.name || path.basename(src)).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const problem = validSkillName(name)
  if (problem) throw new Error(problem)
  const dest = path.join(ownSkillsDir(), name)
  fs.rmSync(dest, { recursive: true, force: true })
  copyFiltered(src, dest)
  // Keep the original front matter fields we understand, and note where it came from.
  fs.writeFileSync(path.join(dest, 'SKILL.md'), skillMd(name, meta.description || '', body))
  fs.writeFileSync(path.join(dest, '.origin'), `${market.label}: ${m[2]}\n`)
  return name
}

/** Fetch a marketplace plugin into a temporary folder ready for installPlugin(). */
export function stageMarketPlugin(ref: string): { dir: string; origin: string; cleanup: () => void } {
  const m = ref.match(/^plugin:([^/]+)\/(.+)$/)
  if (!m) throw new Error(`not a plugin reference: ${ref}`)
  const market = marketplaces().find((x) => x.id === m[1])
  if (!market) throw new Error(`unknown marketplace ${m[1]}`)
  const repo = syncMarketplace(market)
  const tmp = path.join(capabilitiesDir(), 'cache', `.stage-${Date.now()}`)
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })

  if (market.kind === 'hermes') {
    const p = hermesPlugins(repo).find((x) => x.name === m[2])
    if (!p) throw new Error(`${m[2]} is not in the ${market.label}`)
    if (p.hermesOnly) throw new Error(`${p.title || p.name} is a Hermes-only plugin (Python code that runs inside Hermes Agent) — it can't run in Hermione`)
    try {
      fetchPinned(p.repo, p.sha, path.join(tmp, 'repo'))
      const root = path.join(tmp, 'repo', p.subdir ?? '')
      const portable = ['mcp.json', '.mcp.json', 'skills'].some((f) => fs.existsSync(path.join(root, f)))
      if (!portable) throw new Error(`${p.title || p.name} has no MCP servers or skills Hermione can use (it's built for Hermes Agent)`)
      const out = path.join(tmp, 'plugin')
      copyFiltered(root, out)
      if (!fs.existsSync(path.join(out, '.claude-plugin', 'plugin.json')) && !fs.existsSync(path.join(out, 'plugin.json'))) {
        fs.writeFileSync(path.join(out, 'plugin.json'), JSON.stringify({ name: p.name, description: p.description, version: p.version }, null, 2))
      }
      return { dir: out, origin: `${market.label}: ${p.name} @ ${p.sha.slice(0, 7)}`, cleanup }
    } catch (err) {
      cleanup()
      throw err
    }
  }

  const entry = (readMarketplaceJson(repo)?.plugins ?? []).find((p: any) => p?.name === m[2])
  if (!entry) throw new Error(`${m[2]} is not in ${market.label}`)
  let root: string
  const src = entry.source
  if (typeof src === 'string') {
    root = path.resolve(repo, src)
    if (path.relative(repo, root).startsWith('..')) throw new Error('bad plugin path')
  } else if (src?.source === 'github' && src.repo) {
    shallowClone(`https://github.com/${src.repo}.git`, path.join(tmp, 'repo'))
    root = path.join(tmp, 'repo', src.path ?? '')
  } else if ((src?.source === 'url' || src?.source === 'git-subdir') && src.url) {
    shallowClone(String(src.url), path.join(tmp, 'repo'))
    root = path.join(tmp, 'repo', src.path ?? '')
  } else {
    throw new Error(`unsupported plugin source for ${entry.name}`)
  }

  // A marketplace entry that lists its skills (strict: false) defines the plugin itself.
  const out = path.join(tmp, 'plugin')
  fs.mkdirSync(out, { recursive: true })
  if (Array.isArray(entry.skills) && entry.skills.length) {
    for (const s of entry.skills) copyFiltered(path.resolve(root, String(s)), path.join(out, 'skills', path.basename(String(s))))
    for (const f of ['.mcp.json']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(out, f))
  } else {
    copyFiltered(root, out)
  }
  if (!fs.existsSync(path.join(out, '.claude-plugin', 'plugin.json')) && !fs.existsSync(path.join(out, 'plugin.json'))) {
    fs.mkdirSync(path.join(out, '.claude-plugin'), { recursive: true })
    fs.writeFileSync(path.join(out, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: entry.name, description: entry.description, version: entry.version }, null, 2))
  }
  return { dir: out, origin: `${market.label}: ${entry.name}`, cleanup }
}
