import { CATALOG, envKeyFor, type CatalogEntry } from './catalog'
import { listProviders, resolvedKey, activeProviderId, type Provider } from './providers'
import { endpointRoot, probeProvider, type ModelEntry } from './openai'

/**
 * Auto-discovery.
 *
 * - Local runtimes: every catalog `local` entry is probed on its default
 *   port in parallel with a short timeout. Only a host that answers with a
 *   real model list counts as found.
 * - Cloud APIs: an entry counts as found when its API-key env var is set;
 *   the key is then used (server-side only) to read the model list.
 */

export interface DiscoveredBackend {
  catalogId: string
  label: string
  scope: 'local' | 'cloud'
  kind: 'ollama' | 'openai'
  baseUrl: string
  online: boolean
  models: ModelEntry[]
  latencyMs: number
  detail: string
  /** Env var that supplied the key (cloud only). */
  keyEnv?: string
  keyUrl?: string
  keyPlaceholder?: string
  /** Saved provider that already points at this backend, if any. */
  configuredId?: string
}

const LOCAL_TIMEOUT_MS = 1500
const CLOUD_TIMEOUT_MS = 8000

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^localhost/, '127.0.0.1')
  } catch {
    return ''
  }
}

function configuredFor(entry: CatalogEntry, saved: Provider[]): string | undefined {
  const host = hostOf(entry.baseUrl)
  return saved.find((p) => p.catalogId === entry.id || hostOf(p.baseUrl) === host)?.id
}

async function probeLocal(entry: CatalogEntry, saved: Provider[]): Promise<DiscoveredBackend> {
  const probe = await probeProvider(entry.baseUrl, undefined, LOCAL_TIMEOUT_MS)
  // A non-LLM web server on the same port may answer 200 with junk —
  // require at least one model before calling it a hit.
  const online = probe.ok && probe.models.length > 0
  return {
    catalogId: entry.id,
    label: entry.label,
    scope: 'local',
    kind: probe.kind === 'ollama' ? 'ollama' : entry.kind,
    baseUrl: online ? probe.endpoint : entry.baseUrl,
    online,
    models: online ? probe.models : [],
    latencyMs: probe.latencyMs,
    detail: online ? probe.detail : 'not running',
    configuredId: configuredFor(entry, saved),
  }
}

async function probeCloud(entry: CatalogEntry, saved: Provider[]): Promise<DiscoveredBackend> {
  const env = envKeyFor(entry)
  const base: DiscoveredBackend = {
    catalogId: entry.id,
    label: entry.label,
    scope: 'cloud',
    kind: 'openai',
    baseUrl: entry.baseUrl,
    online: false,
    models: [],
    latencyMs: 0,
    detail: env ? '' : 'no key in environment',
    keyEnv: env?.name ?? entry.keyEnv?.[0],
    keyUrl: entry.keyUrl,
    keyPlaceholder: entry.keyPlaceholder,
    configuredId: configuredFor(entry, saved),
  }
  if (!env) return base
  const probe = await probeProvider(entry.baseUrl, env.value, CLOUD_TIMEOUT_MS)
  return {
    ...base,
    online: probe.ok,
    models: probe.models,
    latencyMs: probe.latencyMs,
    detail: probe.ok ? probe.detail : probe.authError ? `$${env.name} was rejected` : probe.detail,
  }
}

let discoverCache: { at: number; result: DiscoveredBackend[] } | null = null
const DISCOVER_TTL_MS = 15_000

export async function discoverBackends(force = false): Promise<DiscoveredBackend[]> {
  if (!force && discoverCache && Date.now() - discoverCache.at < DISCOVER_TTL_MS) return discoverCache.result
  const saved = listProviders()
  const result = await Promise.all(
    CATALOG.map((entry) => (entry.scope === 'local' ? probeLocal(entry, saved) : probeCloud(entry, saved))),
  )
  discoverCache = { at: Date.now(), result }
  return result
}

/* ------------------------------------------------------------------ */
/* Unified model list across every configured provider                 */
/* ------------------------------------------------------------------ */

export interface ProviderModels {
  providerId: string
  label: string
  kind: 'ollama' | 'openai'
  scope: 'local' | 'cloud'
  isActive: boolean
  online: boolean
  defaultModel?: string
  models: ModelEntry[]
  detail: string
}

const modelsCache = new Map<string, { at: number; value: ProviderModels }>()
const MODELS_TTL_MS = 30_000

function isLocalUrl(url: string): boolean {
  const host = hostOf(url).split(':')[0]
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[::1\]$|::1$)/.test(host) || host.endsWith('.local')
}

async function modelsFor(p: Provider, activeId: string, force: boolean): Promise<ProviderModels> {
  const cached = modelsCache.get(p.id)
  if (!force && cached && Date.now() - cached.at < MODELS_TTL_MS) {
    return { ...cached.value, isActive: p.id === activeId }
  }
  const local = isLocalUrl(p.baseUrl)
  const probe = await probeProvider(
    p.kind === 'ollama' ? endpointRoot(p.baseUrl).replace(/\/v1$/i, '') : p.baseUrl,
    resolvedKey(p),
    local ? 2500 : CLOUD_TIMEOUT_MS,
  )
  const value: ProviderModels = {
    providerId: p.id,
    label: p.label,
    kind: p.kind,
    scope: local ? 'local' : 'cloud',
    isActive: p.id === activeId,
    online: probe.ok,
    defaultModel: p.defaultModel,
    models: probe.models,
    detail: probe.ok ? probe.detail : probe.authError ? 'API key rejected' : probe.detail,
  }
  modelsCache.set(p.id, { at: Date.now(), value })
  return value
}

export async function allProviderModels(force = false): Promise<ProviderModels[]> {
  const activeId = activeProviderId()
  return Promise.all(listProviders().map((p) => modelsFor(p, activeId, force)))
}

export function invalidateModelCache(providerId?: string) {
  if (providerId) modelsCache.delete(providerId)
  else modelsCache.clear()
  discoverCache = null
}
