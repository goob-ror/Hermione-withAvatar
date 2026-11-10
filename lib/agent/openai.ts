import type { ChatMessage, Emit } from './types'
import { hiddenReason } from './modelFilter'

/**
 * OpenAI-compatible transport.
 *
 * Talks to anything that implements `POST {base}/chat/completions` and
 * `GET {base}/models`: OpenAI, Anthropic-compatible relays, OpenRouter,
 * Groq, Together, Fireworks, vLLM, LM Studio, llama.cpp server, Ollama's own
 * `/v1` shim, or a private gateway.
 *
 * Only three things are assumed: bearer auth in the `Authorization` header,
 * SSE streaming with `data:` frames, and `tools` shaped like OpenAI's function
 * schema (which is exactly what `toolSchemas()` already produces).
 */

export interface TokenUsage {
  input: number
  output: number
}

export interface ChatTurn {
  content: string
  thinking: string
  toolCalls: Array<{ id?: string; function: { name: string; arguments: any } }>
  /** Real counts when the provider reports them. */
  usage?: TokenUsage
}

export interface CustomChatOptions {
  baseUrl: string
  apiKey?: string
  model: string
  messages: ChatMessage[]
  tools?: unknown[]
  thinking?: boolean
  temperature?: number
  signal?: AbortSignal
}

export interface ModelEntry {
  id: string
  ownedBy?: string
  context?: number
}

export interface ProbeResult {
  ok: boolean
  kind: 'openai' | 'ollama' | 'unknown'
  endpoint: string
  latencyMs: number
  models: ModelEntry[]
  /** Listed by the provider but filtered out because they cannot chat. */
  hidden: HiddenModel[]
  authError: boolean
  detail: string
}

function authHeaders(apiKey?: string, url?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  // Anthropic's OpenAI-compatible chat path takes a bearer token, but its
  // /v1/models listing only accepts the native headers — send both.
  if (apiKey && url && /(^|\.)anthropic\.com/i.test(safeHost(url))) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  return headers
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Strip a trailing /chat/completions or /models when the operator pasted a full URL. */
export function endpointRoot(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|completions|models)$/i, '')
}

function candidates(baseUrl: string): string[] {
  const root = endpointRoot(baseUrl)
  const out = [root]
  if (!/\/v\d+[a-z]*$/i.test(root)) out.push(`${root}/v1`)
  // Ollama daemon endpoints are checked last so an OpenAI-compatible /v1 wins.
  out.push(root.replace(/\/v1$/i, ''))
  return [...new Set(out)]
}

function rawList(payload: any): any[] {
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []
}

function itemId(item: any): string {
  let id =
    typeof item === 'string' ? item : (item?.id ?? item?.name ?? item?.model ?? item?.slug ?? '').toString()
  // Gemini lists `models/gemini-…` but its chat endpoint wants the bare id.
  if (id.startsWith('models/')) id = id.slice('models/'.length)
  return id
}

export interface HiddenModel {
  id: string
  reason: string
}

/**
 * Parse a model list and split it into chat-capable models and the ones
 * hidden because they cannot chat (embeddings, TTS, image gen, …).
 * `extraMeta` lets a caller merge richer metadata keyed by id (Gemini native list).
 */
function parseModels(
  payload: any,
  baseUrl?: string,
  extraMeta?: Map<string, any>,
): { models: ModelEntry[]; hidden: HiddenModel[] } {
  const models: ModelEntry[] = []
  const hidden: HiddenModel[] = []
  for (const item of rawList(payload)) {
    const id = itemId(item)
    if (!id) continue
    const meta = extraMeta?.get(id) ?? item
    const reason = hiddenReason(meta, id, baseUrl)
    if (reason) {
      hidden.push({ id, reason })
      continue
    }
    models.push({
      id,
      ownedBy: item?.owned_by ?? item?.ownedBy ?? undefined,
      context:
        item?.context_length ?? item?.context_window ?? item?.details?.context_length ?? meta?.inputTokenLimit ?? undefined,
    })
  }
  return {
    models: models.sort((a, b) => a.id.localeCompare(b.id)),
    hidden: hidden.sort((a, b) => a.id.localeCompare(b.id)),
  }
}

/**
 * Gemini's OpenAI-compatible /models omits capabilities; its native list has
 * `supportedGenerationMethods`. Key goes in a header, never the URL.
 */
async function geminiNativeMeta(root: string, apiKey: string | undefined, timeoutMs: number): Promise<Map<string, any> | undefined> {
  if (!apiKey || !/generativelanguage\.googleapis\.com/i.test(safeHost(root))) return undefined
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return undefined
    const body = await res.json().catch(() => null)
    const map = new Map<string, any>()
    for (const item of rawList(body)) {
      const id = itemId(item)
      if (id) map.set(id, item)
    }
    return map.size ? map : undefined
  } catch {
    return undefined
  }
}

/**
 * Probe an endpoint: resolve the right base path, then read its model list.
 * Never throws — a failure comes back as `ok: false` with the reason.
 */
export async function probeProvider(baseUrl: string, apiKey?: string, timeoutMs = 12000): Promise<ProbeResult> {
  const started = Date.now()
  let lastDetail = 'no endpoint answered'
  let authError = false
  let tried = ''
  let reportedEndpoint = ''

  for (const root of candidates(baseUrl)) {
    // 1. Model list on the standard path.
    const modelsUrl = `${root}/models`
    tried = modelsUrl
    if (!reportedEndpoint) reportedEndpoint = modelsUrl
    let authRejectedHere = false
    try {
      const res = await fetch(modelsUrl, {
        headers: authHeaders(apiKey, modelsUrl),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status === 401 || res.status === 403) {
        authError = true
        authRejectedHere = true
        lastDetail = `${modelsUrl} → ${res.status} ${res.statusText} (token rejected)`
        // The host answered as a keyed API — a different candidate path will
        // not change the verdict, and /api/tags would only muddy the report.
        reportedEndpoint = modelsUrl
        break
      }
      if (res.ok) {
        const body = await res.json().catch(() => null)
        const extra = await geminiNativeMeta(root, apiKey, timeoutMs)
        const { models, hidden } = parseModels(body, root, extra)
        if (models.length || hidden.length || body) {
          return {
            ok: true,
            kind: 'openai',
            endpoint: root,
            latencyMs: Date.now() - started,
            models,
            hidden,
            authError: false,
            detail: countDetail(models.length, hidden.length, 'model'),
          }
        }
      }
      lastDetail = `${modelsUrl} → ${res.status} ${res.statusText}`
    } catch (err: any) {
      lastDetail = `${modelsUrl} → ${err?.name === 'TimeoutError' ? 'timed out' : err?.message || 'unreachable'}`
    }

    // 2. Ollama-native model list, for a daemon that is not /v1-shimmed.
    //    Skipped after an auth rejection: that host already speaks the
    //    keyed API, so an unauthenticated /api/tags probe tells us nothing.
    if (authRejectedHere) continue
    const tagsUrl = `${root}/api/tags`
    tried = tagsUrl
    try {
      const res = await fetch(tagsUrl, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      if (res.ok) {
        const { models, hidden } = parseModels(await res.json().catch(() => null), root)
        return {
          ok: true,
          kind: 'ollama',
          endpoint: root,
          latencyMs: Date.now() - started,
          models,
          hidden,
          authError: false,
          detail: countDetail(models.length, hidden.length, 'local model'),
        }
      }
    } catch {
      /* keep the previous detail */
    }
  }

  return {
    ok: false,
    kind: 'unknown',
    endpoint: reportedEndpoint || tried,
    latencyMs: Date.now() - started,
    models: [],
    hidden: [],
    authError,
    detail: lastDetail,
  }
}

function countDetail(shown: number, hidden: number, noun: string): string {
  const base = `${shown} chat ${noun}${shown === 1 ? '' : 's'}`
  return hidden ? `${base} (${hidden} non-chat hidden)` : base
}

/** List models for a saved provider config (no throw, empty list on failure). */
export async function listModels(baseUrl: string, apiKey?: string, kind: 'ollama' | 'openai' = 'openai'): Promise<ModelEntry[]> {
  if (kind === 'ollama') {
    const root = endpointRoot(baseUrl).replace(/\/v1$/i, '')
    try {
      const res = await fetch(`${root}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (res.ok) return parseModels(await res.json().catch(() => null), root).models
    } catch {
      /* fall through to the OpenAI probe */
    }
  }
  const probe = await probeProvider(baseUrl, apiKey)
  return probe.models
}

/* ------------------------------------------------------------------ */
/* Message translation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ollama and OpenAI disagree about how a tool result is addressed. Our internal
 * ChatMessage keeps Ollama's `tool_name`; OpenAI wants `tool_call_id`, and an
 * assistant message needs its `tool_calls[].id` echoed back verbatim.
 */
function toCustomMessages(messages: ChatMessage[]): any[] {
  const out: any[] = []
  // Remember the ids of the last assistant turn so orphan tool messages still address something.
  let pendingIds: string[] = []

  for (const m of messages) {
    if (m.role === 'tool') {
      const id = (m as any).tool_call_id || pendingIds.shift() || `call_${out.length}`
      out.push({ role: 'tool', tool_call_id: id, content: m.content })
      continue
    }

    if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((call: any, index: number) => ({
        id: call.id || `call_${out.length}_${index}`,
        type: 'function',
        function: {
          name: call.function?.name ?? '',
          arguments:
            typeof call.function?.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function?.arguments ?? {}),
        },
      }))
      pendingIds = calls.map((c) => c.id)
      const msg: any = { role: 'assistant', content: m.content ?? '' }
      if (calls.length) msg.tool_calls = calls
      // Skip empty assistant frames that only exist to carry a tool call.
      if (!calls.length && !m.content) continue
      out.push(msg)
      continue
    }

    out.push({ role: m.role, content: m.content })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Streaming chat                                                      */
/* ------------------------------------------------------------------ */

interface AccumToolCall {
  id?: string
  name: string
  args: string
}

/** Hosts that rejected `stream_options` — never send it to them again. */
const NO_STREAM_OPTIONS = new Set<string>()

function readUsage(u: any): TokenUsage | undefined {
  if (!u || typeof u !== 'object') return undefined
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0)
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0)
  return input || output ? { input, output } : undefined
}

export async function openaiChat(opts: CustomChatOptions, emit: Emit): Promise<ChatTurn> {
  const url = `${endpointRoot(opts.baseUrl)}/chat/completions`
  const host = safeHost(url)
  const payload: Record<string, any> = {
    model: opts.model,
    messages: toCustomMessages(opts.messages),
    stream: true,
    temperature: opts.temperature ?? 0.3,
  }
  // Ask for real token counts in the final stream chunk.
  if (!NO_STREAM_OPTIONS.has(host)) payload.stream_options = { include_usage: true }
  if (opts.tools?.length) {
    payload.tools = opts.tools
    payload.tool_choice = 'auto'
  }

  const send = () =>
    fetch(url, {
      method: 'POST',
      headers: authHeaders(opts.apiKey, url),
      body: JSON.stringify(payload),
      signal: opts.signal ?? AbortSignal.timeout(180_000),
    })

  let res = await send()

  // A server that doesn't know `stream_options` → drop it, remember, retry once.
  if (res.status === 400 && payload.stream_options) {
    const detail = await res.clone().text().catch(() => '')
    if (/stream_options|include_usage|unrecognized|unknown (field|param)|extra (inputs|fields)/i.test(detail)) {
      NO_STREAM_OPTIONS.add(host)
      delete payload.stream_options
      res = await send()
    }
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    const hint = res.status === 401 || res.status === 403 ? ' — check the API token' : ''
    throw new Error(`${opts.model} via ${new URL(url).host} failed (${res.status})${hint}: ${detail.slice(0, 300)}`)
  }

  // Some gateways ignore `stream: true` and return one JSON document.
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('event-stream') && !contentType.includes('ndjson')) {
    const body = await res.json().catch(() => null)
    const choice = body?.choices?.[0]
    const content: string = choice?.message?.content ?? ''
    const thinking: string = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? ''
    if (thinking) emit({ type: 'thinking', delta: thinking })
    if (content) emit({ type: 'token', delta: content })
    const toolCalls = (choice?.message?.tool_calls || []).map((call: any) => ({
      id: call.id,
      function: { name: call.function?.name ?? '', arguments: call.function?.arguments ?? {} },
    }))
    return { content, thinking, toolCalls, usage: readUsage(body?.usage) }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let thinking = ''
  let usage: TokenUsage | undefined
  const calls: AccumToolCall[] = []

  const consumeLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) return
    if (!trimmed.startsWith('data:')) return
    const data = trimmed.slice(5).trim()
    if (!data || data === '[DONE]') return

    let chunk: any
    try {
      chunk = JSON.parse(data)
    } catch {
      return
    }
    if (chunk.error) throw new Error(String(chunk.error?.message || chunk.error))
    // The usage chunk arrives last (often with an empty `choices`).
    usage = readUsage(chunk.usage) ?? usage

    const delta = chunk.choices?.[0]?.delta ?? chunk.choices?.[0]?.message ?? {}
    const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking
    if (typeof reasoning === 'string' && reasoning) {
      thinking += reasoning
      emit({ type: 'thinking', delta: reasoning })
    }
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      emit({ type: 'token', delta: delta.content })
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const piece of delta.tool_calls) {
        const index = typeof piece.index === 'number' ? piece.index : calls.length
        if (!calls[index]) calls[index] = { name: '', args: '' }
        if (piece.id) calls[index].id = piece.id
        if (piece.function?.name) calls[index].name += piece.function.name
        if (piece.function?.arguments) calls[index].args += piece.function.arguments
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      consumeLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) consumeLine(buffer)

  const toolCalls = calls
    .filter((c) => c && c.name)
    .map((c) => {
      let args: any = {}
      try {
        args = c.args ? JSON.parse(c.args) : {}
      } catch {
        args = {}
      }
      return { id: c.id, function: { name: c.name, arguments: args } }
    })

  return { content, thinking, toolCalls, usage }
}
