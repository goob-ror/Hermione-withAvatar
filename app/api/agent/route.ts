import { NextRequest, NextResponse } from 'next/server'
import { runAgent, systemPromptFor } from '@/lib/agent/loop'
import { ensureSession } from '@/lib/agent/session'
import { agentStream } from '@/lib/agent/stream'
import { activeProviderId, getProvider, publicProviders } from '@/lib/agent/providers'
import { listModels } from '@/lib/agent/openai'

/**
 * GET /api/agent — health of the ACTIVE provider plus its model list.
 * Keeps the legacy `models: [{ name }]` shape so existing clients still work.
 */
export async function GET(req: NextRequest) {
  const providerId = new URL(req.url).searchParams.get('providerId') || undefined
  const provider = getProvider(providerId ?? activeProviderId())

  try {
    const models = await listModels(provider.baseUrl, provider.apiKey, provider.kind)
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
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = String(body.sessionId ?? '').trim()
  const model = String(body.model ?? '').trim()
  const message = String(body.message ?? '')
  const thinkingEffort = body.thinkingEffort ?? 'low'
  const providerId = body.providerId ? String(body.providerId) : undefined

  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  if (!model) return NextResponse.json({ error: 'model is required' }, { status: 400 })
  if (!message.trim()) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const resolvedProvider = providerId ?? activeProviderId()
  const prompt = await systemPromptFor(model, resolvedProvider)
  const session = ensureSession(sessionId, model, prompt, resolvedProvider)

  // Keep the system prompt in sync when the operator switches models or
  // providers mid-session (native tools vs text protocol differ per model).
  if (session.messages[0]?.role === 'system' && session.messages[0].content !== prompt) {
    session.messages[0] = { role: 'system', content: prompt }
  }

  session.messages.push({ role: 'user', content: message })

  return agentStream((emit) => runAgent(session, { thinkingEffort, providerId: resolvedProvider }, emit))
}
