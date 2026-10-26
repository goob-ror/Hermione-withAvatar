import { NextRequest, NextResponse } from 'next/server'
import {
  publicProviders,
  getProvider,
  upsertProvider,
  setActiveProvider,
  deleteProvider,
  storeIsWritable,
  type ProviderKind,
} from '@/lib/agent/providers'
import { probeProvider } from '@/lib/agent/openai'

/** GET /api/providers — every configured provider, active one flagged. Never returns keys. */
export async function GET() {
  const { activeId, providers } = publicProviders()
  const active = providers.find((p) => p.id === activeId)
  return NextResponse.json({
    activeId,
    providers,
    writable: storeIsWritable(),
    activeKind: active?.kind ?? 'ollama',
  })
}

/**
 * POST /api/providers — save (create or update) a provider.
 * Body: { id?, label?, kind?('ollama'|'openai'), baseUrl, apiKey?, defaultModel? }
 * An empty `apiKey` clears the stored token; omitting it keeps the current one.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const baseUrl = String(body.baseUrl ?? '').trim()
  if (!baseUrl) return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 })

  try {
    const saved = upsertProvider({
      id: body.id ? String(body.id) : undefined,
      label: body.label ? String(body.label) : undefined,
      kind: (body.kind === 'ollama' ? 'ollama' : 'openai') as ProviderKind,
      baseUrl,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      defaultModel: body.defaultModel ? String(body.defaultModel) : undefined,
    })

    if (body.activate !== false) setActiveProvider(saved.id)

    const { activeId, providers } = publicProviders()
    return NextResponse.json({
      ok: true,
      activeId,
      provider: providers.find((p) => p.id === saved.id),
      providers,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'could not save provider' }, { status: 500 })
  }
}

/**
 * PATCH /api/providers — switch the active provider without editing it.
 * Body: { activeId }
 */
export async function PATCH(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const id = String(body.activeId ?? '').trim()
  if (!id) return NextResponse.json({ error: 'activeId is required' }, { status: 400 })
  try {
    setActiveProvider(id)
    return NextResponse.json({ ok: true, ...publicProviders() })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'could not activate provider' }, { status: 404 })
  }
}

/**
 * DELETE /api/providers?id=... — drop a saved provider (the implicit local
 * Ollama entry cannot be removed, it just falls back to the env default).
 */
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })
  const existed = deleteProvider(id)
  return NextResponse.json({ ok: true, removed: existed, ...publicProviders() })
}

/**
 * PUT /api/providers — probe an endpoint and list its models.
 * Body: { baseUrl, apiKey?, id?, persist? }
 *
 * Testing against a *saved* provider: pass `id` only (and `useStoredKey: true`).
 * Testing an unsaved URL: pass baseUrl + apiKey. When `persist` is true and the
 * probe succeeds, the resolved endpoint + model list are written to the store.
 */
export async function PUT(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const id = body.id ? String(body.id) : ''
  const stored = id ? getProvider(id) : undefined
  const useStoredKey = body.useStoredKey === true || (!!stored && body.apiKey === undefined)

  const baseUrl = String(body.baseUrl ?? stored?.baseUrl ?? '').trim()
  const apiKey = useStoredKey ? stored?.apiKey : typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined

  if (!baseUrl) return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 })

  const probe = await probeProvider(baseUrl, apiKey || undefined)

  if (probe.ok && body.persist === true && stored) {
    try {
      upsertProvider({
        id: stored.id,
        label: stored.label,
        kind: probe.kind === 'ollama' ? 'ollama' : 'openai',
        baseUrl: probe.endpoint,
        apiKey,
        defaultModel: stored.defaultModel || probe.models[0]?.id,
      })
    } catch {
      /* a probe result is still useful even if persistence fails */
    }
  }

  return NextResponse.json({ ...probe, baseUrl, models: probe.models })
}
