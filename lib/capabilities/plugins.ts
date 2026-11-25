import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { addConnector, expandVars, removeConnector, setConnectorEnabled } from './connectors'
import { loadCapabilities, pluginsDir, updateCapabilities, type PluginRecord } from './store'

/**
 * Plugins: bundles of skills and connectors, in the Claude plugin layout —
 *
 *   <plugin>/.claude-plugin/plugin.json   { name, description, version }   (or plugin.json)
 *   <plugin>/skills/<skill>/SKILL.md       skills (picked up automatically)
 *   <plugin>/.mcp.json                     MCP servers → connectors
 *
 * Installing copies a local folder (or clones a Git URL) into
 * .hermione/capabilities/plugins/<id>. Only the operator installs plugins
 * (from Capabilities); Hermione can only suggest one.
 */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'plugin'

export function readManifest(dir: string): { name: string; description?: string; version?: string } {
  for (const f of [path.join(dir, '.claude-plugin', 'plugin.json'), path.join(dir, 'plugin.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (j?.name) return { name: String(j.name), description: j.description ? String(j.description) : undefined, version: j.version ? String(j.version) : undefined }
    } catch {
      /* next */
    }
  }
  return { name: path.basename(dir) }
}

const isGitUrl = (s: string) => /^(?:https?:\/\/|git@)[^\s]+$/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)

/** Install from a local folder or a Git URL ("owner/repo" means GitHub). */
export async function installPlugin(source: string): Promise<PluginRecord> {
  const src = source.trim()
  fs.mkdirSync(pluginsDir(), { recursive: true })
  const tmp = path.join(pluginsDir(), `.incoming-${Date.now()}`)
  let origin = src
  if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
    fs.cpSync(src, tmp, { recursive: true, filter: (f) => !/[\\/](?:node_modules|\.git)(?:[\\/]|$)/.test(path.relative(src, f) ? `/${path.relative(src, f)}` : '') })
  } else if (isGitUrl(src)) {
    origin = /^[\w.-]+\/[\w.-]+$/.test(src) ? `https://github.com/${src}.git` : src
    const r = spawnSync('git', ['clone', '--depth', '1', origin, tmp], { encoding: 'utf8', timeout: 120_000, windowsHide: true })
    if (r.status !== 0) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw new Error(`git clone failed: ${(r.stderr || r.error?.message || '').trim().split('\n').pop()}`)
    }
    fs.rmSync(path.join(tmp, '.git'), { recursive: true, force: true })
  } else {
    throw new Error(`${src} is neither a folder nor a Git URL`)
  }

  const manifest = readManifest(tmp)
  let id = slug(manifest.name)
  const caps = loadCapabilities()
  for (let i = 2; caps.plugins.some((p) => p.id === id); i++) id = `${slug(manifest.name)}-${i}`
  const dir = path.join(pluginsDir(), id)
  fs.renameSync(tmp, dir)
  const rec: PluginRecord = { id, name: manifest.name, description: manifest.description, version: manifest.version, dir, enabled: true, installedAt: Date.now(), origin }
  updateCapabilities((d) => {
    d.plugins.push(rec)
  })

  // Its MCP servers become connectors owned by the plugin.
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'))
    for (const [name, v] of Object.entries<any>(j?.mcpServers ?? j ?? {})) {
      const http = v?.type === 'http' || v?.type === 'sse' || (!!v?.url && !v?.command)
      if (http && !v.url) continue
      await addConnector({
        label: `${manifest.name}: ${name}`,
        transport: http ? 'http' : 'stdio',
        ...(http ? { url: expandVars(String(v.url), dir) } : { command: expandVars(String(v.command ?? ''), dir), args: (v.args ?? []).map((a: unknown) => expandVars(String(a), dir)) }),
        ...(v.env ? { env: Object.fromEntries(Object.entries(v.env).map(([k, x]) => [k, expandVars(String(x), dir)])) } : {}),
        cwd: dir,
        source: 'plugin',
        pluginId: id,
      })
    }
  } catch {
    /* no .mcp.json */
  }
  return rec
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  updateCapabilities((d) => {
    const p = d.plugins.find((x) => x.id === id)
    if (!p) throw new Error(`no plugin ${id}`)
    p.enabled = enabled
  })
  for (const c of loadCapabilities().connectors.filter((c) => c.pluginId === id)) await setConnectorEnabled(c.id, enabled)
}

export async function removePlugin(id: string) {
  const p = loadCapabilities().plugins.find((x) => x.id === id)
  if (!p) throw new Error(`no plugin ${id}`)
  for (const c of loadCapabilities().connectors.filter((c) => c.pluginId === id)) await removeConnector(c.id)
  // Only ever delete inside Hermione's own plugins folder.
  const rel = path.relative(pluginsDir(), p.dir)
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(p.dir, { recursive: true, force: true })
  updateCapabilities((d) => {
    d.plugins = d.plugins.filter((x) => x.id !== id)
  })
}
