import { NextRequest, NextResponse } from 'next/server'
import { runAgent, systemPromptFor } from '@/lib/agent/loop'
import { ensureSession, getSession, parseMode } from '@/lib/agent/session'
import { agentStream } from '@/lib/agent/stream'
import {
  activeProviderId,
  getProvider,
  publicProviders,
  resolvedKey,
  setProviderDefaultModel,
} from '@/lib/agent/providers'
import { listModels } from '@/lib/agent/openai'
import { z } from 'zod'
import { id, Mode, parseBody, ThinkingEffort } from '@/lib/http/validate'

/**
 * GET /api/agent — health of the ACTIVE provider plus its model list.
 * Keeps the legacy `models: [{ name }]` shape so existing clients still work.
 */
export async function GET(req: NextRequest) {
  const providerId = new URL(req.url).searchParams.get('providerId') || undefined
  const provider = getProvider(providerId ?? activeProviderId())

  try {
    const models = await listModels(provider.baseUrl, resolvedKey(provider), provider.kind)
    if (!models.length && provider.kind === 'ollama') {
      return NextResponse.json(
        { online: false, provider: provider.id, error: `no models at ${provider.baseUrl}` },
        { status: 502 },
      )
    }
    return NextResponse.json({
      provider: provider.id,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      online: true,
      models: models.map((m) => ({ ...m, name: m.id, model: m.id })),
      ...publicProviders(),
    })
  } catch (err: any) {
    return NextResponse.json(
      {
        provider: provider.id,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        online: false,
        error: `${provider.label} is unreachable`,
        detail: err?.message ?? String(err),
      },
      { status: 503 },
    )
  }
}

/**
 * POST /api/agent — append a user message and run the agent loop.
 * Body: { sessionId, model, message, thinkingEffort?, providerId? }
 * Returns an NDJSON stream of AgentEvent objects.
 */
const AgentBody = z.object({
  sessionId: id(),
  model: id(),
  message: z.string().max(100_000).refine((s) => s.trim().length > 0, 'message is required'),
  thinkingEffort: ThinkingEffort.default('low'),
  providerId: id().optional(),
  mode: Mode.optional(),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, AgentBody)
  if (!parsed.ok) return parsed.response
  const { sessionId, model, message, thinkingEffort, providerId } = parsed.data
  const body = parsed.data

  const resolvedProvider = providerId ?? activeProviderId()
  // Remember the pick so this provider reopens on the same model next time.
  try {
    setProviderDefaultModel(resolvedProvider, model)
  } catch {
    /* non-fatal */
  }
  // A session's mode is fixed when it is created; later requests can't flip it.
  const mode = getSession(sessionId)?.mode ?? parseMode(body.mode)
  const prompt = await systemPromptFor(model, resolvedProvider, mode)
  const session = ensureSession(sessionId, model, prompt, resolvedProvider, mode)

  // Keep the system prompt in sync when the operator switches models or
  // providers mid-session (native tools vs text protocol differ per model).
  if (session.messages[0]?.role === 'system' && session.messages[0].content !== prompt) {
    session.messages[0] = { role: 'system', content: prompt }
  }

  session.messages.push({ role: 'user', content: message })

  return agentStream((emit) => runAgent(session, { thinkingEffort, providerId: resolvedProvider }, emit))
}
