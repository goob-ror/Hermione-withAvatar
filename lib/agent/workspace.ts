import { AsyncLocalStorage } from 'async_hooks'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Per-session workspaces: the operator writes `@<folder>` in a message and that
 * session works in that folder — file tools, shell commands, the shared
 * terminal, the judge and the system prompt all treat it as the project root.
 *
 *   @C:\Projects\Game        absolute path (also D:/x, /home/me/x, ~/x)
 *   @"C:\My Projects\Game"   quoted when it has spaces
 *   @../other-app            relative to Hermione's own folder
 *   @BanditBeater            a bare name: found among your project folders
 *
 * Only the operator's own chat messages are read for mentions (never tool
 * output or web pages). Drive roots, system folders, your home folder itself
 * and Hermione's config folder are refused. Writes and commands in the new
 * folder still go through the permission mode and the hard limits.
 */

const store = new AsyncLocalStorage<string | undefined>()

/** Run `fn` with `dir` as the project root (undefined = Hermione's default root). */
export function withWorkspace<T>(dir: string | undefined, fn: () => T): T {
  return store.run(dir, fn)
}

/** The workspace of the code running now, if a session chose one. */
export function currentWorkspace(): string | undefined {
  return store.getStore()
}

/** Hermione's own default root (AGENT_ROOT, else her install folder). */
export function defaultRoot(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.AGENT_ROOT || process.cwd())
}

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Why a folder can't be a workspace, or undefined when it can. */
export function workspaceProblem(dir: string, configDir?: string): string | undefined {
  const abs = path.resolve(dir)
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    return `${abs} does not exist`
  }
  if (!st.isDirectory()) return `${abs} is a file, not a folder`
  if (same(abs, path.parse(abs).root)) return `${abs} is a whole drive — pick a project folder inside it`
  if (same(abs, os.homedir())) return 'your whole home folder is too broad — pick a project folder inside it'
  const system =
    process.platform === 'win32'
      ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', process.env.ProgramData || 'C:\\ProgramData']
      : ['/etc', '/usr', '/bin', '/sbin', '/boot', '/sys', '/proc', '/System', '/Library']
  if (system.some((s) => inside(abs, s))) return `${abs} is a system folder`
  if (configDir && inside(abs, configDir)) return "that is Hermione's own settings folder"
  return undefined
}

/** Folders a bare name (`@BanditBeater`) is looked up in, nearest first. */
export function searchRoots(): string[] {
  const home = os.homedir()
  const root = defaultRoot()
  const list = [
    path.dirname(root),
    path.dirname(path.dirname(root)),
    path.join(home, 'Documents', 'Projects'),
    path.join(home, 'Documents'),
    path.join(home, 'Desktop'),
    path.join(home, 'source', 'repos'),
    path.join(home, 'Projects'),
  ]
  const seen = new Set<string>()
  return list.filter((d) => {
    const k = path.resolve(d).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    try {
      return fs.statSync(d).isDirectory()
    } catch {
      return false
    }
  })
}

/** Sub-folders of `dir` (and one level deeper), skipping hidden and dependency folders. */
function subfolders(dir: string, depth: number, out: string[] = [], budget = { n: 800 }): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (budget.n-- <= 0) break
    if (!e.isDirectory() || /^(?:\.|node_modules$|__pycache__$|\$)/.test(e.name)) continue
    const full = path.join(dir, e.name)
    out.push(full)
    if (depth > 1) subfolders(full, depth - 1, out, budget)
  }
  return out
}

/** Find a folder by bare name among the project folders (exact name, case-insensitive). */
export function findFolderByName(name: string): string | undefined {
  const want = name.toLowerCase()
  for (const root of searchRoots()) {
    const hit = subfolders(root, 2).find((d) => path.basename(d).toLowerCase() === want)
    if (hit) return hit
  }
  return undefined
}

const MENTION = /(?:^|\s)@(?:"([^"]+)"|'([^']+)'|(\S+))/g

/** Expand ~ and resolve a mention to an absolute path (not checked). */
function resolveMention(raw: string): { abs?: string; pathLike: boolean } {
  const t = raw.replace(/[.,;:!?)\]}]+$/, '')
  const pathLike = /[\\/]|^[a-z]:/i.test(t) || t.startsWith('~')
  if (!t) return { pathLike: false }
  if (t.startsWith('~')) return { abs: path.join(os.homedir(), t.slice(1)), pathLike }
  if (path.isAbsolute(t) || /^[a-z]:[\\/]/i.test(t)) return { abs: path.resolve(t), pathLike }
  if (t.startsWith('./') || t.startsWith('../') || t.startsWith('.\\') || t.startsWith('..\\')) return { abs: path.resolve(defaultRoot(), t), pathLike }
  if (pathLike) return { abs: path.resolve(defaultRoot(), t), pathLike }
  return { abs: findFolderByName(t), pathLike }
}

/**
 * The folder an operator's message points at with @, plus problems with
 * path-like mentions that didn't work (so Hermione can say so). Non-folder
 * mentions like "@everyone" are ignored. The LAST valid folder wins.
 */
export function parseFolderMention(message: string, configDir?: string): { folder?: string; problems: string[] } {
  const problems: string[] = []
  let folder: string | undefined
  for (const m of message.matchAll(MENTION)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    if (/^[\w.+-]+@[\w-]+\.\w/.test(raw)) continue // an email address
    const quoted = m[1] !== undefined || m[2] !== undefined
    const { abs, pathLike } = resolveMention(raw)
    if (!abs) {
      if (pathLike || quoted) problems.push(`couldn't find the folder "${raw}"`)
      continue
    }
    const problem = workspaceProblem(abs, configDir)
    if (problem) {
      if (pathLike || quoted || fs.existsSync(abs)) problems.push(problem)
      continue
    }
    folder = path.resolve(abs)
  }
  return { folder, problems }
}

/* ---------- Recent workspaces (for the @ suggestions) ---------- */

const recentFile = (configDir: string) => path.join(configDir, 'workspaces.json')

export function recentWorkspaces(configDir: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(configDir), 'utf8'))
    return Array.isArray(list) ? list.filter((d) => typeof d === 'string' && fs.existsSync(d)) : []
  } catch {
    return []
  }
}

export function rememberWorkspace(configDir: string, dir: string) {
  try {
    const list = [dir, ...recentWorkspaces(configDir).filter((d) => !same(d, dir))].slice(0, 12)
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(recentFile(configDir), JSON.stringify(list, null, 2))
  } catch {
    /* suggestions are a convenience */
  }
}

/** Folder suggestions for the composer's @ menu: recent first, then project folders matching `q`. */
export function suggestFolders(q: string, configDir: string, limit = 10): { path: string; name: string; recent: boolean }[] {
  const needle = q.trim().toLowerCase().replace(/^["']/, '')
  const out: { path: string; name: string; recent: boolean }[] = []
  const seen = new Set<string>()
  const add = (p: string, recent: boolean) => {
    const k = path.resolve(p).toLowerCase()
    if (seen.has(k) || workspaceProblem(p, configDir)) return
    const name = path.basename(p)
    if (needle && !name.toLowerCase().includes(needle) && !p.toLowerCase().includes(needle)) return
    seen.add(k)
    out.push({ path: path.resolve(p), name, recent })
  }
  for (const r of recentWorkspaces(configDir)) add(r, true)
  // A typed path: list its sub-folders.
  if (/[\\/]/.test(needle)) {
    const base = needle.endsWith('/') || needle.endsWith('\\') ? q.trim() : path.dirname(q.trim())
    for (const d of subfolders(path.resolve(base.replace(/^~/, os.homedir())), 1)) add(d, false)
  }
  // Project folders: top-level ones first; Hermione's own folders are not "another project".
  const own = defaultRoot()
  const depth = new Map<string, number>()
  for (const root of searchRoots()) {
    for (const d of subfolders(root, needle ? 2 : 1)) {
      if (inside(d, own)) continue
      const k = path.resolve(d).toLowerCase()
      if (!depth.has(k)) depth.set(k, path.relative(root, d).split(path.sep).length)
      add(d, false)
    }
  }
  const level = (p: string) => depth.get(p.toLowerCase()) ?? 0
  const starts = (n: string) => Number(!!needle && n.toLowerCase().startsWith(needle))
  return out
    .sort((a, b) => Number(b.recent) - Number(a.recent) || starts(b.name) - starts(a.name) || level(a.path) - level(b.path) || a.name.localeCompare(b.name))
    .slice(0, limit)
}
