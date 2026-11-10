import { activeProviderId, getProvider, resolvedKey } from './providers'
import { listModels, openaiChat, type TokenUsage } from './openai'
import { estimateTokens, recordUsage } from './usage'
import { hiddenReason } from './modelFilter'
import { exhaustedMark, markExhausted, nextCandidate } from './failover'

/**
 * One-shot, non-streaming completion on any configured provider — for
 * background jobs (trend recommendations, summaries) that are not part of a
 * chat session. Returns the assistant text with any <think> block removed.
 */
export async function completeText(opts: {
  providerId?: string
  model?: string
  system?: string
  prompt: string
  temperature?: number
  timeoutMs?: number
}): Promise<{ text: string; model: string; providerId: string }> {
  let provider = getProvider(opts.providerId ?? activeProviderId())

  // Model: explicit → provider's remembered pick → first listed chat model.
  let model = opts.model?.trim() || provider.defaultModel || ''
  // Never run a background job on a model known not to chat (embeddings, TTS, agent-only…).
  if (model && hiddenReason({}, model, provider.baseUrl)) model = ''
  if (!model) model = (await listModels(provider.baseUrl, resolvedKey(provider), provider.kind))[0]?.id ?? ''
  if (!model) throw new Error(`no model available on ${provider.label}`)

  // Out of quota? Use the failover choice instead of burning a request.
  if (exhaustedMark(provider.id, model)) {
    const next = await nextCandidate({ providerId: provider.id, model }, new Set())
    if (!next) throw new Error(`${provider.label} is out of quota and no other provider is available`)
    provider = getProvider(next.providerId)
    model = next.model
  }
  const key = resolvedKey(provider)

  const messages = [
    ...(opts.system ? [{ role: 'system' as const, content: opts.system }] : []),
    { role: 'user' as const, content: opts.prompt },
  ]
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 90_000)

  let text = ''
  try {
    const out = await callOnce(provider, key, model, messages, opts.temperature ?? 0.4, signal)
    text = out.text
    const used = out.usage ?? estimateTokens(messages, text)
    recordUsage(provider.id, used.input, used.output, !out.usage)
  } catch (err: any) {
    // Record quota/rate errors so every caller (chat, background jobs) skips this pair.
    markExhausted(provider.id, model, err?.message ?? String(err))
    throw err
  }

  return { text: text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim(), model, providerId: provider.id }
}

async function callOnce(
  provider: ReturnType<typeof getProvider>,
  key: string | undefined,
  model: string,
  messages: { role: 'system' | 'user'; content: string }[],
  temperature: number,
  signal: AbortSignal,
): Promise<{ text: string; usage?: TokenUsage }> {
  let text = ''
  let usage: TokenUsage | undefined
  if (provider.kind === 'ollama') {
    const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, options: { temperature } }),
      signal,
    })
    if (!res.ok) throw new Error(`${model} on ${provider.label} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    text = data?.message?.content ?? ''
    if (data?.prompt_eval_count || data?.eval_count) {
      usage = { input: Number(data.prompt_eval_count ?? 0), output: Number(data.eval_count ?? 0) }
    }
  } else {
    const turn = await openaiChat({ baseUrl: provider.baseUrl, apiKey: key, model, messages, temperature, signal }, () => {})
    text = turn.content
    usage = turn.usage
  }
  return { text, usage }
}

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const body = candidate.slice(start, end + 1)
  try {
    return JSON.parse(body) as T
  } catch {
    // Only on failure: repair the slips models commonly make, then try once more.
    try {
      return JSON.parse(repairJson(body)) as T
    } catch {
      return null
    }
  }
}

/**
 * Fix common LLM JSON slips:
 *   "term" (500+ searches)   → "term (500+ searches)"   (text after a closing quote)
 *   trailing commas before } or ]
 *   smart quotes used as delimiters
 */
export function repairJson(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/"([^"\n]*)"[ \t]*(\([^()\n]*\)|[^\s,:}\]"\n][^,}\]\n"]*?)(?=\s*[,}\]])/g, (_, inner, tail) =>
      JSON.stringify(`${inner} ${String(tail).trim()}`),
    )
    .replace(/,\s*([}\]])/g, '$1')
}
