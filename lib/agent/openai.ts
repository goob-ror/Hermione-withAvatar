import type { ChatMessage, Emit } from './types'

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

export interface ChatTurn {
  content: string
  thinking: string
  toolCalls: Array<{ id?: string; function: { name: string; arguments: any } }>
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
  authError: boolean
  detail: string
}

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
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

function parseModels(payload: any): ModelEntry[] {
  const raw: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : []

  const models: ModelEntry[] = []
  for (const item of raw) {
    const id =
      typeof item === 'string'
        ? item
        : (item?.id ?? item?.name ?? item?.model ?? item?.slug ?? '').toString()
    if (!id) continue
    models.push({
      id,
      ownedBy: item?.owned_by ?? item?.ownedBy ?? undefined,
      context: item?.context_length ?? item?.context_window ?? item?.details?.context_length ?? undefined,
    })
  }
  return models.sort((a, b) => a.id.localeCompare(b.id))
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
        headers: authHeaders(apiKey),
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
        const models = parseModels(body)
        if (models.length || body) {
          return {
            ok: true,
            kind: 'openai',
            endpoint: root,
            latencyMs: Date.now() - started,
            models,
            authError: false,
            detail: `${models.length} model${models.length === 1 ? '' : 's'} available`,
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
        const models = parseModels(await res.json().catch(() => null))
        return {
          ok: true,
          kind: 'ollama',
          endpoint: root,
          latencyMs: Date.now() - started,
          models,
          authError: false,
          detail: `${models.length} local model${models.length === 1 ? '' : 's'}`,
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
    authError,
    detail: lastDetail,
  }
}

/** List models for a saved provider config (no throw, empty list on failure). */
export async function listModels(baseUrl: string, apiKey?: string, kind: 'ollama' | 'openai' = 'openai'): Promise<ModelEntry[]> {
  if (kind === 'ollama') {
    const root = endpointRoot(baseUrl).replace(/\/v1$/i, '')
    try {
      const res = await fetch(`${root}/api/tags`, { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (res.ok) return parseModels(await res.json().catch(() => null))
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

export async function openaiChat(opts: CustomChatOptions, emit: Emit): Promise<ChatTurn> {
  const url = `${endpointRoot(opts.baseUrl)}/chat/completions`
  const payload: Record<string, any> = {
    model: opts.model,
    messages: toCustomMessages(opts.messages),
    stream: true,
    temperature: opts.temperature ?? 0.3,
  }
  if (opts.tools?.length) {
    payload.tools = opts.tools
    payload.tool_choice = 'auto'
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(opts.apiKey),
    body: JSON.stringify(payload),
    signal: opts.signal ?? AbortSignal.timeout(180_000),
  })

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
    return { content, thinking, toolCalls }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let thinking = ''
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

  return { content, thinking, toolCalls }
}
