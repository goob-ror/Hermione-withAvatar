import { spawnSync } from 'child_process'

/**
 * The official MCP Registry (registry.modelcontextprotocol.io): the open
 * catalog of MCP servers. Hermione searches it and turns an entry into a
 * connector — a hosted URL when the server offers one, else its npm / PyPI /
 * Docker package run locally (npx / uvx / docker).
 */

export const REGISTRY = 'https://registry.modelcontextprotocol.io/v0'

export interface RegistryServer {
  name: string
  title?: string
  description: string
  version?: string
  website?: string
  repository?: string
  remotes: { type: string; url: string; headers?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean; value?: string }[] }[]
  packages: {
    registryType: string
    identifier: string
    version?: string
    transport?: { type?: string; url?: string }
    runtimeArguments?: any[]
    packageArguments?: any[]
    environmentVariables?: { name: string; description?: string; isRequired?: boolean; isSecret?: boolean; default?: string }[]
  }[]
}

const clean = (s: any): RegistryServer => ({
  name: String(s.name),
  title: s.title,
  description: String(s.description ?? ''),
  version: s.version,
  website: s.websiteUrl,
  repository: s.repository?.url,
  remotes: Array.isArray(s.remotes) ? s.remotes : [],
  packages: Array.isArray(s.packages) ? s.packages : [],
})

async function get(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`MCP Registry answered ${r.status}`)
  return r.json()
}

/** Search (latest versions only). */
export async function searchRegistry(query: string, cursor?: string): Promise<{ servers: RegistryServer[]; nextCursor?: string }> {
  const p = new URLSearchParams({ limit: '30', version: 'latest' })
  if (query.trim()) p.set('search', query.trim())
  if (cursor) p.set('cursor', cursor)
  const j = await get(`${REGISTRY}/servers?${p}`)
  return { servers: (j.servers ?? []).map((x: any) => clean(x.server ?? x)), nextCursor: j.metadata?.nextCursor }
}

export async function getRegistryServer(name: string): Promise<RegistryServer> {
  const j = await get(`${REGISTRY}/servers/${encodeURIComponent(name)}/versions/latest`)
  return clean(j.server ?? j)
}

const have = (cmd: string) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { windowsHide: true }).status === 0

export interface InstallPlan {
  transport: 'stdio' | 'http'
  url?: string
  command?: string
  args?: string[]
  /** Values the operator must (or may) provide: env vars for packages, headers for hosted servers. */
  inputs: { key: string; kind: 'env' | 'header'; description?: string; required: boolean; secret: boolean; template?: string }[]
  via: string
}

/** Positional/named package arguments with fixed values (others need the operator). */
function fixedArgs(list: any[] | undefined): string[] {
  const out: string[] = []
  for (const a of list ?? []) {
    const value = a?.value ?? a?.default
    if (value === undefined) continue
    if (a.type === 'named' && a.name) out.push(String(a.name), String(value))
    else out.push(String(value))
  }
  return out
}

/** How to run a registry server here: hosted first, then npm (npx), PyPI (uvx), Docker. */
export function planInstall(s: RegistryServer): InstallPlan {
  const remote = s.remotes.find((r) => r.type === 'streamable-http' && /^https?:\/\//.test(r.url))
  if (remote) {
    return {
      transport: 'http',
      url: remote.url,
      via: 'hosted server',
      inputs: (remote.headers ?? []).map((h) => ({ key: h.name, kind: 'header', description: h.description, required: h.isRequired !== false, secret: h.isSecret !== false, template: h.value })),
    }
  }
  const envInputs = (p: RegistryServer['packages'][number]) =>
    (p.environmentVariables ?? []).map((e) => ({ key: e.name, kind: 'env' as const, description: e.description, required: !!e.isRequired, secret: !!e.isSecret, template: e.default }))
  const stdio = (t?: { type?: string }) => !t?.type || t.type === 'stdio'
  const npm = s.packages.find((p) => p.registryType === 'npm' && stdio(p.transport))
  if (npm && have('npx')) {
    return { transport: 'stdio', command: 'npx', args: ['-y', `${npm.identifier}${npm.version ? `@${npm.version}` : ''}`, ...fixedArgs(npm.packageArguments)], inputs: envInputs(npm), via: 'npm (npx)' }
  }
  const py = s.packages.find((p) => p.registryType === 'pypi' && stdio(p.transport))
  if (py && have('uvx')) {
    return { transport: 'stdio', command: 'uvx', args: [`${py.identifier}${py.version ? `==${py.version}` : ''}`, ...fixedArgs(py.packageArguments)], inputs: envInputs(py), via: 'PyPI (uvx)' }
  }
  const oci = s.packages.find((p) => p.registryType === 'oci' && stdio(p.transport))
  if (oci && have('docker')) {
    const env = envInputs(oci)
    return { transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', ...env.flatMap((e) => ['-e', e.key]), oci.identifier, ...fixedArgs(oci.packageArguments)], inputs: env, via: 'Docker' }
  }
  const kinds = [...new Set([...s.remotes.map((r) => r.type), ...s.packages.map((p) => p.registryType)])].join(', ') || 'nothing'
  throw new Error(`can't run ${s.name} here (it offers: ${kinds}; Hermione needs a hosted streamable-http URL, or npx / uvx / docker for packages)`)
}

/** "Bearer {token}" + {token: "abc"} → "Bearer abc"; a bare value is used as-is. */
export function fillTemplate(template: string | undefined, value: string): string {
  if (!template || !/\{[^}]+\}/.test(template)) return value
  return template.replace(/\{[^}]+\}/, value)
}
