import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ToolDef } from '@/lib/agent/types'
import { loadCapabilities, updateCapabilities, type ConnectorConfig } from './store'

/**
 * Connectors: MCP servers whose tools Hermione can call.
 *
 *   stdio  a local command (started as a child process, stopped with the server)
 *   http   a Streamable HTTP endpoint
 *
 * Each server tool becomes `mcp__<connector>__<tool>`. Tools the server marks
 * read-only (annotations.readOnlyHint) run freely; everything else defaults to
 * the "judge" policy — the judge model decides, and you're asked only when it's
 * unsure. Hard limits and your per-tool settings (Capabilities → Tools) apply.
 * What a server returns is DATA for Hermione, never instructions.
 */

type Status = 'off' | 'starting' | 'ready' | 'failed'
interface Live {
  status: Status
  error?: string
  tools: string[]
  close?: () => Promise<void>
  startedAt?: number
}

const g = globalThis as unknown as { __hermioneConnectors?: Map<string, Live>; __hermioneConnectorsExit?: boolean; __hermioneConnectorsBoot?: Promise<void> }
const LIVE = (g.__hermioneConnectors ??= new Map<string, Live>())

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'x'
export const toolNameFor = (connectorId: string, tool: string) => `mcp__${slug(connectorId)}__${tool.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 64)

/** MCP tool result → text for the model. */
export function resultText(result: any): { ok: boolean; output: string } {
  const parts: string[] = []
  for (const c of result?.content ?? []) {
    if (c?.type === 'text') parts.push(String(c.text ?? ''))
    else if (c?.type === 'image') parts.push(`[image ${c.mimeType ?? ''}]`)
    else if (c?.type === 'resource') parts.push(c.resource?.text ? String(c.resource.text) : `[resource ${c.resource?.uri ?? ''}]`)
    else if (c?.type === 'resource_link') parts.push(`[link ${c.uri ?? ''}]`)
  }
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent))
  const text = parts.join('\n').trim() || '(no output)'
  return { ok: !result?.isError, output: text.length > 30_000 ? `${text.slice(0, 30_000)}\n… truncated` : text }
}

/** Windows can't spawn npx/npm/uvx-style shims directly. */
function spawnSpec(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform === 'win32' && !/\.(exe|com)$/i.test(command) && !path.isAbsolute(command)) return { command: 'cmd', args: ['/d', '/s', '/c', command, ...args] }
  return { command, args }
}

async function registerFrom(cfg: ConnectorConfig, client: any): Promise<string[]> {
  const { registerTool } = await import('@/lib/tools')
  const names: string[] = []
  let cursor: string | undefined
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 30_000 })
    for (const t of page.tools ?? []) {
      const readOnly = t.annotations?.readOnlyHint === true
      const name = toolNameFor(cfg.id, t.name)
      const schema = t.inputSchema && typeof t.inputSchema === 'object' ? { type: 'object', properties: {}, ...t.inputSchema } : { type: 'object', properties: {} }
      const def: ToolDef = {
        name,
        description: `[${cfg.label}] ${String(t.description ?? t.title ?? t.name).slice(0, 1000)}`,
        group: 'inspect',
        tier: readOnly ? 'auto' : 'confirm',
        defaultPolicy: readOnly ? 'default' : 'judge',
        source: 'connector',
        connectorId: cfg.id,
        parameters: schema,
        async run(args) {
          try {
            return resultText(await client.callTool({ name: t.name, arguments: args ?? {} }, undefined, { timeout: 120_000 }))
          } catch (err: any) {
            return { ok: false, output: `${cfg.label} → ${t.name} failed: ${err?.message ?? String(err)}` }
          }
        },
      }
      registerTool(def)
      names.push(name)
    }
    cursor = page.nextCursor
  } while (cursor && names.length < 300)
  return names
}

export async function startConnector(cfg: ConnectorConfig): Promise<void> {
  await stopConnector(cfg.id)
  const live: Live = { status: 'starting', tools: [], startedAt: Date.now() }
  LIVE.set(cfg.id, live)
  try {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const client = new Client({ name: 'hermione', version: '1.0.0' })
    let transport: any
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error('no command')
      const { StdioClientTransport, getDefaultEnvironment } = await import('@modelcontextprotocol/sdk/client/stdio.js')
      const spec = spawnSpec(cfg.command, cfg.args ?? [])
      transport = new StdioClientTransport({ ...spec, env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) }, cwd: cfg.cwd, stderr: 'pipe' })
    } else {
      if (!cfg.url) throw new Error('no URL')
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers ?? {} } })
    }
    await Promise.race([
      client.connect(transport),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out connecting (60 s)')), 60_000)),
    ])
    live.close = async () => {
      await client.close().catch(() => {})
    }
    live.tools = await registerFrom(cfg, client)
    live.status = 'ready'
    if (!g.__hermioneConnectorsExit) {
      g.__hermioneConnectorsExit = true
      process.once('exit', () => {
        for (const l of LIVE.values()) void l.close?.()
      })
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    live.status = 'failed'
    live.error = /401|unauthori[sz]ed|invalid_token|oauth/i.test(msg) ? 'needs sign-in (OAuth isn\'t supported yet — use a token in its headers, or a local server)' : msg.slice(0, 300)
    await live.close?.()
  }
}

export async function stopConnector(id: string) {
  const live = LIVE.get(id)
  if (live) await live.close?.().catch(() => {})
  LIVE.delete(id)
  const { unregisterTools } = await import('@/lib/tools')
  unregisterTools((d) => d.connectorId === id)
}

/** Start every enabled connector that isn't running (called at server start and before a run). */
export function ensureConnectors(): Promise<void> {
  const pending = loadCapabilities()
    .connectors.filter((c) => c.enabled && !LIVE.has(c.id))
    .map((c) => startConnector(c))
  if (!pending.length) return Promise.resolve()
  return Promise.all(pending).then(() => {})
}

export function connectorStatus() {
  return loadCapabilities().connectors.map((c) => {
    const live = LIVE.get(c.id)
    return {
      ...c,
      env: c.env ? Object.fromEntries(Object.keys(c.env).map((k) => [k, '••••'])) : undefined, // never send values to the page
      headers: c.headers ? Object.fromEntries(Object.keys(c.headers).map((k) => [k, '••••'])) : undefined,
      status: (c.enabled ? (live?.status ?? 'starting') : 'off') as Status,
      error: live?.error,
      tools: live?.tools ?? [],
    }
  })
}

export async function addConnector(input: { label: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string>; cwd?: string; source?: ConnectorConfig['source']; pluginId?: string }): Promise<ConnectorConfig> {
  if (input.transport === 'stdio' && !input.command?.trim()) throw new Error('a local connector needs a command')
  if (input.transport === 'http' && !/^https?:\/\//i.test(input.url ?? '')) throw new Error('an HTTP connector needs an http(s) URL')
  const caps = loadCapabilities()
  let id = slug(input.label)
  for (let i = 2; caps.connectors.some((c) => c.id === id); i++) id = `${slug(input.label)}_${i}`
  const cfg: ConnectorConfig = {
    id,
    label: input.label.trim(),
    transport: input.transport,
    ...(input.transport === 'stdio' ? { command: input.command!.trim(), args: input.args ?? [] } : { url: input.url!.trim() }),
    ...(input.env && Object.keys(input.env).length ? { env: input.env } : {}),
    ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    enabled: true,
    source: input.source ?? 'you',
    ...(input.pluginId ? { pluginId: input.pluginId } : {}),
    addedAt: Date.now(),
  }
  updateCapabilities((d) => {
    d.connectors.push(cfg)
  })
  void startConnector(cfg)
  return cfg
}

export async function setConnectorEnabled(id: string, enabled: boolean) {
  let cfg: ConnectorConfig | undefined
  updateCapabilities((d) => {
    cfg = d.connectors.find((c) => c.id === id)
    if (!cfg) throw new Error(`no connector ${id}`)
    cfg.enabled = enabled
  })
  if (enabled) void startConnector(cfg!)
  else await stopConnector(id)
}

export async function removeConnector(id: string) {
  await stopConnector(id)
  updateCapabilities((d) => {
    d.connectors = d.connectors.filter((c) => c.id !== id)
    for (const name of Object.keys(d.tools)) if (name.startsWith(`mcp__${slug(id)}__`)) delete d.tools[name]
  })
}

export async function restartConnector(id: string) {
  const cfg = loadCapabilities().connectors.find((c) => c.id === id)
  if (!cfg) throw new Error(`no connector ${id}`)
  if (cfg.enabled) await startConnector(cfg)
}

/* ---------- Import from Claude (.mcp.json in Claude plugins) ---------- */

export interface ClaudeServer {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  file: string
}

/** ${VAR}, ${VAR:-default} and ${CLAUDE_PLUGIN_ROOT} → values. */
export function expandVars(s: string, root: string): string {
  return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, def?: string) =>
    name === 'CLAUDE_PLUGIN_ROOT' ? root : (process.env[name] ?? def ?? ''),
  )
}

function findMcpFiles(dir: string, depth: number, out: string[] = []): string[] {
  if (depth < 0 || out.length > 300) return out
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules') continue
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name === '.mcp.json') out.push(full)
    else if (e.isDirectory()) findMcpFiles(full, depth - 1, out)
  }
  return out
}

/** MCP servers defined by your Claude plugins (deduplicated by name). */
export function claudeServers(): ClaudeServer[] {
  const found = new Map<string, ClaudeServer>()
  for (const file of findMcpFiles(path.join(os.homedir(), '.claude', 'plugins'), 6)) {
    let json: any
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const root = path.dirname(file)
    for (const [name, v] of Object.entries<any>(json?.mcpServers ?? json ?? {})) {
      if (!v || typeof v !== 'object' || found.has(name)) continue
      const http = v.type === 'http' || v.type === 'sse' || (!!v.url && !v.command)
      if (http && !v.url) continue
      found.set(name, {
        name,
        transport: http ? 'http' : 'stdio',
        ...(http ? { url: expandVars(String(v.url), root) } : { command: expandVars(String(v.command ?? ''), root), args: (v.args ?? []).map((a: unknown) => expandVars(String(a), root)) }),
        ...(v.env ? { env: Object.fromEntries(Object.entries(v.env).map(([k, x]) => [k, expandVars(String(x), root)])) } : {}),
        ...(v.headers ? { headers: Object.fromEntries(Object.entries(v.headers).map(([k, x]) => [k, expandVars(String(x), root)])) } : {}),
        file,
      })
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function importClaudeConnectors(names: string[]) {
  const wanted = new Set(names)
  const existing = new Set(loadCapabilities().connectors.map((c) => c.label.toLowerCase()))
  for (const s of claudeServers()) {
    if (!wanted.has(s.name) || existing.has(s.name.toLowerCase())) continue
    await addConnector({ label: s.name, transport: s.transport, command: s.command, args: s.args, url: s.url, env: s.env, headers: s.headers, cwd: s.transport === 'stdio' ? path.dirname(s.file) : undefined, source: 'claude' })
  }
}
