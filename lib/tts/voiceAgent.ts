import { completeText } from '@/lib/agent/complete'
import { activeProviderId, getProvider, listProviders, voiceModelSetting, type VoiceModelSetting } from '@/lib/agent/providers'
import { addressAsSir, ALLOWED_TAGS, expressive, sanitizeTags, stripTags, upbeat } from './expression'

/**
 * Hermione's voice subagent: a second, fast model that runs beside her main
 * chat model and turns what she is about to SAY into spoken dialog — her
 * persona, the right energy, at most one expression cue.
 *
 * Used only where a short wait is fine: greetings (rewritten once, when the
 * greeting cache is filled) and spoken answer summaries (~3 s budget).
 * Waiting remarks and Read aloud stay on the instant deterministic rules
 * (expression.ts). Any failure, timeout or doubtful output → the rules.
 *
 * Which model: the saved choice (Settings → voice model, .hermione/providers.json
 * "voice"), else HERMIONE_VOICE_MODEL (+ HERMIONE_VOICE_PROVIDER), else your
 * Google Gemini provider with gemini-3.1-flash-lite, else the main chat model.
 * "off" (saved, or HERMIONE_VOICE_MODEL=off) = rules only.
 */

export type VoiceStyle = 'greeting' | 'summary'

export const DEFAULT_GEMINI_VOICE_MODEL = 'gemini-3.1-flash-lite'
const isGemini = (baseUrl: string) => /generativelanguage\.googleapis\.com/i.test(baseUrl)
const providerBase = (id: string) => {
  try {
    return getProvider(id).baseUrl
  } catch {
    return ''
  }
}

export interface VoiceModel {
  providerId: string
  model: string
  /** Where the choice came from (for the settings UI). */
  source: 'saved' | 'env' | 'gemini' | 'main'
}

/** The model the voice subagent uses right now, or null when it is off. */
export function voiceModel(setting: VoiceModelSetting | undefined = voiceModelSetting(), env = process.env): VoiceModel | null {
  if (setting && 'off' in setting) return null
  const providers = listProviders()
  if (setting && providers.some((p) => p.id === setting.providerId)) return { ...setting, source: 'saved' }

  const envModel = env.HERMIONE_VOICE_MODEL?.trim()
  if (envModel && /^(?:off|0|false|no)$/i.test(envModel)) return null
  if (envModel) {
    const envProvider = env.HERMIONE_VOICE_PROVIDER?.trim()
    const p = providers.find((x) => x.id === envProvider) ?? (isGemini(envModel) ? undefined : providers.find((x) => isGemini(x.baseUrl)))
    return { providerId: p?.id ?? activeProviderId(), model: envModel, source: 'env' }
  }

  const gemini = providers.find((p) => isGemini(p.baseUrl))
  if (gemini) return { providerId: gemini.id, model: DEFAULT_GEMINI_VOICE_MODEL, source: 'gemini' }

  const main = getProvider(activeProviderId())
  return main.defaultModel ? { providerId: main.id, model: main.defaultModel, source: 'main' } : null
}

const PERSONA = [
  "You are the voice director for Hermione, a local AI assistant with an anime avatar. You rewrite ONE line she is about to say out loud, for her text-to-speech voice.",
  'Her persona: refined, witty, technically sharp, warm under a cool exterior, confident, dry humour, honest. Natural complete sentences. Never melodramatic, never gushing, no emoji, no markdown.',
  'Rules:',
  '- Keep the meaning and the content. Never add facts, numbers, names, times of day, places or promises that are not in the line. Keep every number exactly.',
  '- Change the wording only as much as speaking it well needs: rhythm, warmth, energy. Do not invent backstory (no "I missed you", "awaiting your return").',
  '- Address the operator as "sir" if you address them at all.',
  `- You may add at most ONE expression cue tag, only where it sounds natural: ${ALLOWED_TAGS.map((t) => `<${t}>`).join(', ')} (it sets her delivery; it is not read aloud). Usually none. Never on errors, failures or bad news.`,
  '- English only. Reply with the spoken line only — no quotes, no explanation.',
].join('\n')

const STYLE: Record<VoiceStyle, string> = {
  greeting:
    'This is her greeting when the operator opens the app. Deliver the same greeting brighter and more energetic — engaged, warm, a little playful — but still her: confident and witty, not bubbly or gushing. One exclamation mark at most. Keep it about as short as the original.',
  summary:
    'This is her spoken summary after finishing an answer. Confident, warm, conversational, concise. Keep it about as long as the original or shorter.',
}

/** Digits in the original that the rewrite must keep. */
const numbersIn = (s: string): string[] => s.match(/\d+(?:[.,]\d+)?/g) ?? []

/** Clean the model's reply into one speakable line, or null if it can't be trusted. */
export function cleanVoiceReply(reply: string, original: string): string | null {
  let line = reply
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/^(?:hermione|line|spoken line)\s*:\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[*_#`]+/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .trim()
  line = addressAsSir(sanitizeTags(line))
  const words = stripTags(line)
  if (!/\w/.test(words)) return null
  if (words.length > Math.min(420, Math.max(80, original.length * 1.6 + 40))) return null
  const kept = numbersIn(words)
  if (numbersIn(original).some((n) => !kept.includes(n))) return null
  return line
}

/** The deterministic version (also the fallback). */
export function ruleLine(text: string, style: VoiceStyle): string {
  const base = addressAsSir(sanitizeTags(text))
  return expressive(style === 'greeting' ? upbeat(base) : base)
}

export interface VoiceLine {
  text: string
  by: 'model' | 'rules'
  model?: string
  ms: number
  error?: string
}

/** Rewrite `text` for speaking. Never throws; falls back to the rules. */
export async function voiceLine(
  text: string,
  style: VoiceStyle,
  opts: { timeoutMs?: number; complete?: typeof completeText; model?: VoiceModel | null } = {},
): Promise<VoiceLine> {
  const started = Date.now()
  const fallback = (error?: string): VoiceLine => ({ text: ruleLine(text, style), by: 'rules', ms: Date.now() - started, ...(error ? { error } : {}) })
  const original = stripTags(text).trim()
  if (!original) return fallback()
  const model = opts.model === undefined ? voiceModel() : opts.model
  if (!model) return fallback()
  try {
    const out = await (opts.complete ?? completeText)({
      providerId: model.providerId,
      model: model.model,
      system: `${PERSONA}\n\n${STYLE[style]}`,
      prompt: addressAsSir(original),
      temperature: style === 'greeting' ? 0.8 : 0.5,
      timeoutMs: opts.timeoutMs ?? (style === 'greeting' ? 10_000 : 3_000),
      // A rewrite needs no deliberation: Gemini's thinking takes it from ~1 s to ~5 s.
      ...(isGemini(providerBase(model.providerId)) ? { reasoningEffort: 'none' as const } : {}),
    })
    const line = cleanVoiceReply(out.text, original)
    if (!line) return fallback('the reply did not pass the checks')
    return { text: line, by: 'model', model: `${out.providerId}::${out.model}`, ms: Date.now() - started }
  } catch (err: any) {
    return fallback(err?.message ?? String(err))
  }
}
