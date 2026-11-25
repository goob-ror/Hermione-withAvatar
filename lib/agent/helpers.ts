import { completeText } from './complete'
import { allProviderModels } from './discovery'
import { activeProviderId, getProvider, helperSetting, listProviders, type HelperRole } from './providers'

/**
 * Hermione's helper models — cheap, fast models that work beside the main
 * chat model:
 *
 *   voice  — writes her spoken lines            default: Gemini 3.1 Flash Lite
 *   worker — read-only research sub-agents       default: Claude Haiku 4.5 (any provider that lists it)
 *   judge  — reviews risky actions in Auto mode  default: Claude Haiku 4.5
 *
 * Each role: the saved choice (Helper models menu → providers.json "helpers"),
 * else HERMIONE_<ROLE>_MODEL (+ HERMIONE_<ROLE>_PROVIDER), else the default.
 * "off" (saved or env) turns a helper off. Calls fall back down the list
 * primary → Gemini Flash Lite → the main chat model, so a helper never
 * strands a task.
 */

export const GEMINI_FLASH_LITE = 'gemini-3.1-flash-lite'
export const isGemini = (baseUrl: string) => /generativelanguage\.googleapis\.com/i.test(baseUrl)

export interface HelperModel {
  providerId: string
  model: string
  source: 'saved' | 'env' | 'default' | 'fallback' | 'main'
}

const OFF = /^(?:off|0|false|no)$/i
const envName = (role: HelperRole) => `HERMIONE_${role.toUpperCase()}_MODEL`

/** The saved or env choice: a model, null (off), or undefined (automatic). */
export function chosenHelper(role: HelperRole, env: Record<string, string | undefined> = process.env): HelperModel | null | undefined {
  const saved = helperSetting(role)
  if (saved && 'off' in saved) return null
  const providers = listProviders()
  if (saved && providers.some((p) => p.id === saved.providerId)) return { ...saved, source: 'saved' }
  const envModel = env[envName(role)]?.trim()
  if (envModel && OFF.test(envModel)) return null
  if (envModel) {
    const wanted = env[`HERMIONE_${role.toUpperCase()}_PROVIDER`]?.trim()
    const p =
      providers.find((x) => x.id === wanted) ??
      (/gemini/i.test(envModel) ? providers.find((x) => isGemini(x.baseUrl)) : undefined) ??
      getProvider(activeProviderId())
    return { providerId: p.id, model: envModel, source: 'env' }
  }
  return undefined
}

export function geminiLite(): HelperModel | null {
  const p = listProviders().find((x) => isGemini(x.baseUrl))
  return p ? { providerId: p.id, model: GEMINI_FLASH_LITE, source: 'fallback' } : null
}

export function mainModel(): HelperModel | null {
  const p = getProvider(activeProviderId())
  return p.defaultModel ? { providerId: p.id, model: p.defaultModel, source: 'main' } : null
}

/** A provider that lists Claude Haiku (4.5 preferred), active provider first. */
async function findHaiku(): Promise<HelperModel | null> {
  const groups = await allProviderModels(false).catch(() => [])
  const active = activeProviderId()
  const ordered = [...groups].sort((a, b) => (a.providerId === active ? -1 : b.providerId === active ? 1 : 0))
  for (const re of [/claude-haiku-4\.5$/i, /claude-haiku/i]) {
    for (const g of ordered) {
      if (!g.online) continue
      const m = g.models.find((x) => re.test(x.id) && !/thinking|agentic/i.test(x.id))
      if (m) return { providerId: g.providerId, model: m.id, source: 'default' }
    }
  }
  return null
}

/** The models a helper tries, in order. Empty when the helper is off. */
export async function helperCandidates(role: HelperRole, env: Record<string, string | undefined> = process.env): Promise<HelperModel[]> {
  const chosen = chosenHelper(role, env)
  if (chosen === null) return []
  const primary = chosen ?? (role === 'voice' ? geminiLite() : await findHaiku())
  const seen = new Set<string>()
  return [primary, geminiLite(), mainModel()].filter((m): m is HelperModel => {
    if (!m) return false
    const k = `${m.providerId}::${m.model}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Gemini's thinking turns a ~1 s helper call into ~5 s; helpers don't need it. */
export function fastOpts(m: HelperModel): { reasoningEffort?: 'none' } {
  try {
    return isGemini(getProvider(m.providerId).baseUrl) ? { reasoningEffort: 'none' } : {}
  } catch {
    return {}
  }
}

/**
 * One-shot helper call, trying the role's models in order. Throws only when
 * every candidate failed (or the helper is off).
 */
export async function helperComplete(
  role: HelperRole,
  opts: { system?: string; prompt: string; temperature?: number; timeoutMs?: number },
  deps: { complete?: typeof completeText; candidates?: HelperModel[] } = {},
): Promise<{ text: string; model: string; providerId: string }> {
  const list = deps.candidates ?? (await helperCandidates(role))
  if (!list.length) throw new Error(`the ${role} helper is off`)
  let last: unknown
  for (const m of list) {
    try {
      return await (deps.complete ?? completeText)({ ...opts, providerId: m.providerId, model: m.model, ...fastOpts(m) })
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
