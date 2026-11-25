import { addConnector } from './connectors'
import { RECOMMENDED } from './defaults'
import { browseMarketplaces, installMarketSkill, type MarketPlugin, type MarketSkill } from './marketplace'
import { installPlugin } from './plugins'
import { fillTemplate, getRegistryServer, planInstall, searchRegistry, type InstallPlan } from './registry'
import { listSkills } from './skills'
import { loadCapabilities } from './store'

/**
 * One install path for everything the marketplaces offer, by reference:
 *   connector:<id>           a recommended connector (lib/capabilities/defaults.ts)
 *   registry:<name>          an MCP Registry server
 *   plugin:<market>/<name>   a plugin from a Git marketplace
 *   skill:<market>/<path>    a single skill from a Git marketplace
 * `inputs` carries keys/tokens a server needs (env vars or headers).
 */

export type Inputs = Record<string, string>

function applyInputs(plan: Pick<InstallPlan, 'inputs'>, inputs: Inputs): { env: Record<string, string>; headers: Record<string, string> } {
  const env: Record<string, string> = {}
  const headers: Record<string, string> = {}
  for (const i of plan.inputs) {
    const v = inputs[i.key]?.trim()
    if (!v) {
      if (i.required) throw new Error(`${i.key} is required${i.description ? ` (${i.description})` : ''}`)
      continue
    }
    if (i.kind === 'env') env[i.key] = v
    else headers[i.key] = fillTemplate(i.template, v)
  }
  return { env, headers }
}

export async function installRef(ref: string, inputs: Inputs = {}): Promise<string> {
  const r = ref.trim()
  if (r.startsWith('connector:')) {
    const rec = RECOMMENDED.find((x) => x.ref === r && x.connector)
    if (!rec) throw new Error(`unknown recommended connector ${r}`)
    const c = rec.connector!
    const { env, headers } = applyInputs({ inputs: c.inputs ?? [] }, inputs)
    await addConnector({ label: rec.title, transport: c.transport, url: c.url, command: c.command, args: c.args, env, headers, trustReadOnly: c.trustReadOnly, source: 'default' })
    return `Added the ${rec.title} connector.`
  }
  if (r.startsWith('registry:')) {
    const s = await getRegistryServer(r.slice('registry:'.length))
    const plan = planInstall(s)
    const { env, headers } = applyInputs(plan, inputs)
    const label = s.title || s.name.split('/').pop() || s.name
    await addConnector({ label, transport: plan.transport, url: plan.url, command: plan.command, args: plan.args, env, headers, source: 'registry', registryName: s.name })
    return `Added ${label} from the MCP Registry (${plan.via}).`
  }
  if (r.startsWith('hermes-mcp:')) {
    const { hermesMcps, HERMES_MARKETPLACE } = await import('./hermes')
    const { syncMarketplace, marketplaces } = await import('./marketplace')
    const market = marketplaces().find((x) => x.kind === 'hermes') ?? HERMES_MARKETPLACE
    const m = hermesMcps(syncMarketplace(market)).find((x) => x.name === r.slice('hermes-mcp:'.length))
    if (!m?.url) throw new Error(`unknown Hermes MCP server ${r}`)
    if (m.auth !== 'none') throw new Error(`${m.name} needs an OAuth sign-in, which Hermione doesn't support yet`)
    await addConnector({ label: m.name, transport: 'http', url: m.url, source: 'registry', registryName: `hermes/${m.name}` })
    return `Added ${m.name} from the Hermes Marketplace.`
  }
  if (r.startsWith('skill:')) return `Installed the skill "${installMarketSkill(r)}".`
  if (r.startsWith('plugin:')) return `Installed the plugin "${(await installPlugin(r)).name}".`
  throw new Error(`unknown reference ${ref}`)
}

/* ---------- Browsing (with "installed" flags) ---------- */

let cache: { at: number; data: ReturnType<typeof browseMarketplaces> } | null = null

export function marketListing(force = false) {
  if (!cache || force || Date.now() - cache.at > 10 * 60_000) cache = { at: Date.now(), data: browseMarketplaces({ force }) }
  return cache.data
}

const hit = (q: string, ...s: (string | undefined)[]) => !q.trim() || q.toLowerCase().split(/\s+/).every((w) => s.some((x) => x?.toLowerCase().includes(w)))

export function browsePlugins(q: string, limit = 60): (MarketPlugin & { installed: boolean })[] {
  const installed = new Set(loadCapabilities().plugins.map((p) => p.origin ?? ''))
  return marketListing()
    .plugins.filter((p) => hit(q, p.name, p.description, p.category, p.tier))
    .slice(0, limit)
    .map((p) => ({ ...p, installed: installed.has(`${p.marketplace}: ${p.name}`) }))
}

export function browseSkills(q: string, limit = 60): (MarketSkill & { installed: boolean })[] {
  const have = new Set(listSkills().map((s) => s.name.toLowerCase()))
  return marketListing()
    .skills.filter((s) => hit(q, s.name, s.description))
    .slice(0, limit)
    .map((s) => ({ ...s, installed: have.has(s.name.toLowerCase()) }))
}

/** The Hermes Marketplace's curated MCP servers matching `q` (Nous-reviewed). */
export async function hermesMcpListing(q: string) {
  const { hermesMcps } = await import('./hermes')
  const { syncMarketplace } = await import('./marketplace')
  const market = loadCapabilities().marketplaces.find((m) => m.kind === 'hermes')
  if (!market) return []
  let dir: string
  try {
    dir = syncMarketplace(market)
  } catch {
    return []
  }
  const installed = new Set(loadCapabilities().connectors.map((c) => c.registryName).filter(Boolean))
  return hermesMcps(dir)
    .filter((m) => hit(q, m.name, m.description))
    .map((m) => ({
      ref: `hermes-mcp:${m.name}`,
      name: `hermes/${m.name}`,
      title: m.name,
      description: m.description,
      website: m.source,
      plan: m.auth === 'none' ? { via: 'Hermes Marketplace · hosted', inputs: [] } : null,
      problem: m.auth === 'none' ? undefined : 'needs an OAuth sign-in (not supported in Hermione yet)',
      installed: installed.has(`hermes/${m.name}`),
    }))
}

export async function browseRegistry(q: string, cursor?: string) {
  const installed = new Set(loadCapabilities().connectors.map((c) => c.registryName).filter(Boolean))
  const { servers, nextCursor } = await searchRegistry(q, cursor)
  // Hermes-curated servers first (first page only).
  const hermes = cursor ? [] : await hermesMcpListing(q)
  return {
    nextCursor,
    servers: [...hermes, ...servers.map((s) => {
      let plan: Pick<InstallPlan, 'via' | 'inputs'> | null = null
      let problem: string | undefined
      try {
        const p = planInstall(s)
        plan = { via: p.via, inputs: p.inputs }
      } catch (err: any) {
        problem = err?.message
      }
      return { ref: `registry:${s.name}`, name: s.name, title: s.title, description: s.description, version: s.version, website: s.website, repository: s.repository, plan, problem, installed: installed.has(s.name) }
    })],
  }
}

export function recommended() {
  const caps = loadCapabilities()
  const skills = new Set(listSkills().map((s) => s.name.toLowerCase()))
  return RECOMMENDED.map((r) => ({
    ref: r.ref,
    kind: r.kind,
    title: r.title,
    why: r.why,
    byDefault: !!r.byDefault,
    inputs: r.connector?.inputs ?? [],
    installed: r.kind === 'skill' ? skills.has(r.title.toLowerCase()) : caps.connectors.some((c) => (c.url ?? c.command) === (r.connector?.url ?? r.connector?.command)),
  }))
}
