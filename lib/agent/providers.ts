import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Model provider registry.
 *
 * A provider is either the local Ollama daemon (`kind: 'ollama'`) or any
 * OpenAI-compatible HTTP endpoint (`kind: 'openai'`) — a hosted API, a relay,
 * LM Studio, vLLM, llama.cpp server, OpenRouter, whatever speaks
 * `POST /chat/completions`.
 *
 * The file lives OUTSIDE the repo surface that gets published:
 *   <project>/.hermione/providers.json      (gitignored)
 * API keys are stored only here and are never handed back to the browser —
 * `publicView()` is the only shape that leaves the server.
 */

export type ProviderKind = 'ollama' | 'openai'

export interface Provider {
  id: string
  label: string
  kind: ProviderKind
  /** Base URL without the trailing slash. `https://host/v1` for openai kind. */
  baseUrl: string
  /** Write-only field: accepted on save, never echoed back. */
  apiKey?: string
  defaultModel?: string
  createdAt: number
  updatedAt: number
}

export interface ProviderPublic {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  hasKey: boolean
  /** Masked hint so the operator can tell two keys apart without seeing them. */
  keyHint: string
  defaultModel?: string
  isActive: boolean
  isDefault?: boolean
}

interface ProviderFile {
  version: 1
  activeId: string
  providers: Provider[]
}

export const KEY_MASK = '••••••••'

export function configDir(): string {
  // turbopackIgnore: the store is runtime state, never a build input.
  return path.resolve(
    /* turbopackIgnore: true */ process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

export function configFile(): string {
  return path.join(configDir(), 'providers.json')
}

function ollamaBase(): string {
  return (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '')
}

/** The implicit provider that always exists, even with no config file. */
export function defaultProvider(): Provider {
  return {
    id: 'ollama-local',
    label: 'Ollama (local)',
    kind: 'ollama',
    baseUrl: ollamaBase(),
    createdAt: 0,
    updatedAt: 0,
  }
}

function readRaw(): ProviderFile {
  try {
    const text = fs.readFileSync(configFile(), 'utf-8')
    const parsed = JSON.parse(text)
    const providers: Provider[] = Array.isArray(parsed?.providers) ? parsed.providers : []
    const clean = providers.filter((p) => p && typeof p.id === 'string' && typeof p.baseUrl === 'string')
    return {
      version: 1,
      activeId: typeof parsed?.activeId === 'string' ? parsed.activeId : defaultProvider().id,
      providers: clean.map((p) => ({ ...p, kind: p.kind === 'ollama' ? 'ollama' : 'openai' })),
    }
  } catch {
    return { version: 1, activeId: defaultProvider().id, providers: [] }
  }
}

function writeRaw(file: ProviderFile) {
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${configFile()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, 'utf-8')
  fs.renameSync(tmp, configFile())
  // Best effort: keep the directory private on POSIX hosts.
  try {
    if (process.platform !== 'win32') fs.chmodSync(configFile(), 0o600)
  } catch {
    /* ignore */
  }
}

/** Saved providers, with the implicit local Ollama first when nothing overrides it. */
export function listProviders(): Provider[] {
  const file = readRaw()
  const base = defaultProvider()
  const hasOllama = file.providers.some((p) => p.id === base.id)
  return hasOllama ? file.providers : [base, ...file.providers]
}

export function activeProviderId(): string {
  const file = readRaw()
  const all = listProviders()
  return all.some((p) => p.id === file.activeId) ? file.activeId : all[0]?.id ?? defaultProvider().id
}

export function getProvider(id?: string | null): Provider {
  const all = listProviders()
  if (id) {
    const hit = all.find((p) => p.id === id)
    if (hit) return hit
  }
  const active = all.find((p) => p.id === activeProviderId())
  return active ?? all[0] ?? defaultProvider()
}

export interface ProviderInput {
  id?: string
  label?: string
  kind?: ProviderKind
  baseUrl: string
  /** `undefined` = keep the stored key, empty string = clear it. */
  apiKey?: string
  defaultModel?: string
}

export function normalizeBaseUrl(raw: string, kind: ProviderKind): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('baseUrl is required')
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  // Ollama is addressed at its daemon root; everything else wants /v1.
  if (kind === 'openai' && !/\/(v\d+[a-z]*|api\/chat|chat\/completions)$/i.test(url)) {
    url = `${url}/v1`
  }
  return url.replace(/\/+$/, '')
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function upsertProvider(input: ProviderInput): Provider {
  const kind: ProviderKind = input.kind === 'ollama' ? 'ollama' : 'openai'
  const baseUrl = normalizeBaseUrl(input.baseUrl, kind)
  const file = readRaw()
  const now = Date.now()

  const existingIndex = input.id ? file.providers.findIndex((p) => p.id === input.id) : -1
  const existing = existingIndex >= 0 ? file.providers[existingIndex] : undefined
  const label = (input.label || existing?.label || new URL(baseUrl).host || 'provider').trim()

  // apiKey: undefined keeps the stored secret, '' clears it, anything else replaces it.
  let apiKey = existing?.apiKey
  if (typeof input.apiKey === 'string') {
    const next = input.apiKey.trim()
    apiKey = next === '' || next === KEY_MASK ? (next === KEY_MASK ? existing?.apiKey : undefined) : next
  }

  const provider: Provider = {
    id: existing?.id || `${kind}-${slug(label) || 'provider'}-${crypto.randomBytes(3).toString('hex')}`,
    label,
    kind,
    baseUrl,
    apiKey: apiKey || undefined,
    defaultModel: (input.defaultModel || existing?.defaultModel || '').trim() || undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  if (existingIndex >= 0) file.providers[existingIndex] = provider
  else file.providers.push(provider)

  // First provider added becomes active unless one was chosen already.
  if (!file.providers.some((p) => p.id === file.activeId)) file.activeId = provider.id
  writeRaw(file)
  return provider
}

export function setActiveProvider(id: string): Provider {
  const file = readRaw()
  const all = listProviders()
  const provider = all.find((p) => p.id === id)
  if (!provider) throw new Error(`unknown provider: ${id}`)
  // Persist the implicit Ollama entry the first time it is selected explicitly.
  if (!file.providers.some((p) => p.id === provider.id)) file.providers.unshift(provider)
  file.activeId = provider.id
  writeRaw(file)
  return provider
}

export function deleteProvider(id: string): boolean {
  const file = readRaw()
  const before = file.providers.length
  file.providers = file.providers.filter((p) => p.id !== id)
  if (file.activeId === id) file.activeId = file.providers[0]?.id ?? defaultProvider().id
  writeRaw(file)
  return file.providers.length !== before
}

function keyHint(key?: string): string {
  if (!key) return ''
  if (key.length <= 8) return KEY_MASK
  return `${key.slice(0, 3)}…${key.slice(-4)}`
}

export function publicView(p: Provider, activeId: string): ProviderPublic {
  return {
    id: p.id,
    label: p.label,
    kind: p.kind,
    baseUrl: p.baseUrl,
    hasKey: !!p.apiKey,
    keyHint: keyHint(p.apiKey),
    defaultModel: p.defaultModel,
    isActive: p.id === activeId,
    isDefault: p.id === defaultProvider().id,
  }
}

export function publicProviders(): { activeId: string; providers: ProviderPublic[] } {
  const activeId = activeProviderId()
  return { activeId, providers: listProviders().map((p) => publicView(p, activeId)) }
}

export function storeIsWritable(): boolean {
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    return true
  } catch {
    return false
  }
}
