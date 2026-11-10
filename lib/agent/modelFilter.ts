import fs from 'fs'
import path from 'path'
import { configDir } from './providers'

/**
 * Which listed models can actually hold a multi-turn chat?
 *
 * Every provider's `/models` mixes chat models with embeddings, speech,
 * image/video generators, moderation classifiers, legacy completion models
 * and Responses-API-only models. Picking one of those fails at chat time,
 * e.g. Gemini: "Multiturn chat is not enabled for models/…".
 *
 * Three layers, strongest first:
 *   1. The provider's own metadata, when the list carries it.
 *   2. Known non-chat naming patterns.
 *   3. A learned blocklist: a model that rejects chat at runtime is
 *      remembered (per provider) and hidden from then on.
 */

/* ------------------------------------------------------------------ */
/* 1. Provider metadata                                                */
/* ------------------------------------------------------------------ */

/** `false` = metadata says no chat, `true` = says chat, `undefined` = no signal. */
function metadataSaysChat(item: any): boolean | undefined {
  if (!item || typeof item !== 'object') return undefined

  // Gemini native list: supportedGenerationMethods.
  const methods: unknown = item.supportedGenerationMethods ?? item.supported_generation_methods
  if (Array.isArray(methods)) return methods.includes('generateContent')

  // Mistral: capabilities.completion_chat.
  if (item.capabilities && typeof item.capabilities === 'object' && !Array.isArray(item.capabilities)) {
    if (typeof item.capabilities.completion_chat === 'boolean') return item.capabilities.completion_chat
  }

  // Ollama (newer builds): capabilities: ['completion', 'tools', …] or ['embedding'].
  if (Array.isArray(item.capabilities) && item.capabilities.length) {
    return item.capabilities.includes('completion') || item.capabilities.includes('chat')
  }

  // Together: type = chat | language | code | embedding | image | moderation | rerank | audio.
  // LM Studio /api/v0: type = llm | vlm | embeddings.
  if (typeof item.type === 'string') {
    const t = item.type.toLowerCase()
    if (['chat', 'llm', 'vlm', 'code'].includes(t)) return true
    if (['embedding', 'embeddings', 'image', 'moderation', 'rerank', 'audio', 'transcribe', 'tts', 'video', 'language'].includes(t))
      return false
  }

  // OpenRouter: architecture.output_modalities must include text.
  const out: unknown = item.architecture?.output_modalities
  if (Array.isArray(out) && out.length) return out.includes('text')

  return undefined
}

/* ------------------------------------------------------------------ */
/* 2. Name patterns                                                    */
/* ------------------------------------------------------------------ */

const NON_CHAT_PATTERNS: Array<[RegExp, string]> = [
  // Embeddings (all providers, incl. local runtimes)
  [/embed|(^|[-_/])(bge|gte|e5)[-_]|nomic-embed|mxbai|all-minilm|snowflake-arctic-embed|text-similarity|text-search/, 'embedding'],
  [/rerank|llama-rank/, 'reranker'],
  // Speech
  [/whisper|transcribe|(^|[-_])tts([-_]|$)|text-to-speech|playai|native-audio|realtime|(^|[-_])live([-_]|$)|-live-preview/, 'audio'],
  // Image / video generation
  [/dall-e|gpt-image|imagen|imagine|image-generation|grok-\d+(\.\d+)?-image|stable-diffusion|sdxl|flux[-.]|(^|[-_/])veo[-_]|sora/, 'image/video generation'],
  // Moderation / safety classifiers
  [/moderation|llama-guard|prompt-guard|shieldgemma|(^|[-_])guard([-_]|$)/, 'moderation'],
  // Legacy completion-only (no chat template on the endpoint)
  [/^(babbage|davinci)(-\d+)?$|^gpt-3\.5-turbo-instruct/, 'completion-only'],
  // OpenAI models only served by the Responses API
  [/^(o1-pro|o3-pro|gpt-5(\.\d+)?-pro|codex-mini|gpt-5(\.\d+)?-codex)|computer-use|deep-research/, 'Responses API only'],
  // Gemini specials
  [/(^|\/)aqa$|-robotics-|(^|[-_])ocr([-_]|$)/, 'not a chat model'],
  [/antigravity/, 'agent-only (multi-turn chat not enabled)'],
  [/(^|[-_/])lyria[-_.]|music/, 'music generation'],
  [/nano-banana|-image(-preview)?$/, 'image generation'],
]

export function nonChatReason(id: string): string | undefined {
  const lower = id.toLowerCase()
  for (const [pattern, reason] of NON_CHAT_PATTERNS) if (pattern.test(lower)) return reason
  return undefined
}

/* ------------------------------------------------------------------ */
/* 3. Learned blocklist                                                */
/* ------------------------------------------------------------------ */

interface Learned {
  [key: string]: { reason: string; at: number }
}

let learnedCache: Learned | null = null

function learnedFile(): string {
  return path.join(configDir(), 'unusable-models.json')
}

function readLearned(): Learned {
  if (learnedCache) return learnedCache
  try {
    learnedCache = JSON.parse(fs.readFileSync(learnedFile(), 'utf-8')) || {}
  } catch {
    learnedCache = {}
  }
  return learnedCache!
}

/** Scope by host so the same model id on two providers is judged separately. */
function learnedKey(scope: string, model: string): string {
  return `${scope}::${model}`
}

export function scopeFor(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

export function markUnusable(baseUrl: string, model: string, reason: string) {
  const learned = readLearned()
  learned[learnedKey(scopeFor(baseUrl), model)] = { reason: reason.slice(0, 200), at: Date.now() }
  try {
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(learnedFile(), `${JSON.stringify(learned, null, 2)}\n`, 'utf-8')
  } catch {
    /* in-memory is still enough for this process */
  }
}

export function learnedReason(baseUrl: string, model: string): string | undefined {
  return readLearned()[learnedKey(scopeFor(baseUrl), model)]?.reason
}

/**
 * Does this chat error mean "this model cannot chat at all" (as opposed to a
 * transient failure, a bad key, or rejected tools)?
 */
export function isNotChatCapableError(message: string): boolean {
  return /multi-?turn chat is not enabled|does not support (chat|multi-?turn|generatecontent)|is not supported for generatecontent|not a chat model|only supported in v1\/responses|not supported in the v1\/chat\/completions|is not supported (with|on|by) (the )?(chat|this endpoint)|not supported for chat|model_not_supported_for_chat|this is not a chat model/i.test(
    message,
  )
}

/* ------------------------------------------------------------------ */
/* Combined                                                            */
/* ------------------------------------------------------------------ */

/** Why `item` should be hidden from the chat picker, or undefined if it is usable. */
export function hiddenReason(item: any, id: string, baseUrl?: string): string | undefined {
  if (baseUrl) {
    const learned = learnedReason(baseUrl, id)
    if (learned) return `rejected chat earlier: ${learned}`
  }
  // Metadata can only hide, never rescue: Gemini, for one, reports
  // `generateContent` on TTS / transcribe / agent-only models too.
  if (metadataSaysChat(item) === false) return 'provider marks it non-chat'
  return nonChatReason(id)
}
