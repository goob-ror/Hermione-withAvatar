import { NextRequest, NextResponse } from 'next/server'
import {
  publicProviders,
  getProvider,
  upsertProvider,
  setActiveProvider,
  deleteProvider,
  storeIsWritable,
  resolvedKey,
  type ProviderKind,
} from '@/lib/agent/providers'
import { probeProvider } from '@/lib/agent/openai'
import { CATALOG, catalogEntry, catalogForUrl } from '@/lib/agent/catalog'
import { invalidateModelCache } from '@/lib/agent/discovery'
import { z } from 'zod'
import { id as nonEmpty, parseBody } from '@/lib/http/validate'

const Kind = z.enum(['ollama', 'openai'])

/** Save (create/update) a provider. Empty apiKey clears the stored key; omitted keeps it. */
const SaveBody = z.object({
  id: nonEmpty().optional(),
  label: z.string().max(100).optional(),
  kind: Kind.optional(),
  baseUrl: nonEmpty(2000),
  apiKey: z.string().max(4000).optional(),
  apiKeyEnv: z.string().max(100).optional(),
  catalogId: z.string().max(50).optional(),
  defaultModel: z.string().max(200).optional(),
  activate: z.boolean().optional(),
})

/** Probe an endpoint (saved provider by id, or an unsaved URL + key). */
const ProbeBody = z.object({
  id: z.string().max(200).optional(),
  baseUrl: z.string().max(2000).optional(),
  kind: Kind.optional(),
  apiKey: z.string().max(4000).optional(),
  apiKeyEnv: z.string().max(100).optional(),
  useStoredKey: z.boolean().optional(),
  persist: z.boolean().optional(),
})

/**
 * Value of a catalog-known key env var, but only when `baseUrl` points at
 * that catalog entry's own host — an env key is never sent anywhere else.
 */
function envNameAllowed(name: unknown, baseUrl: string): name is string {
  if (typeof name !== 'string' || !name) return false
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`).host
  } catch {
    return false
  }
  return CATALOG.some((c) => c.keyEnv?.includes(name) && new URL(c.baseUrl).host === host)
}

function catalogEnvKey(name: unknown, baseUrl: string): string | undefined {
  return envNameAllowed(name, baseUrl) ? process.env[name]?.trim() || undefined : undefined
}

/** GET /api/providers — every configured provider, active one flagged. Never returns keys. */
export async function GET() {
  const { activeId, providers } = publicProviders()
  const active = providers.find((p) => p.id === activeId)
  return NextResponse.json({
    activeId,
    providers,
    writable: storeIsWritable(),
    activeKind: active?.kind ?? 'ollama',
    // Presets for the "add" form. Key env var names only, never values.
    catalog: CATALOG.map(({ id, label, kind, scope, baseUrl, keyEnv, keyUrl, keyPlaceholder }) => ({
      id,
      label,
      kind,
      scope,
      baseUrl,
      keyEnv: keyEnv?.[0],
      keyUrl,
      keyPlaceholder,
    })),
  })
}

/**
 * POST /api/providers — save (create or update) a provider.
 * Body: { id?, label?, kind?('ollama'|'openai'), baseUrl, apiKey?, defaultModel? }
 * An empty `apiKey` clears the stored token; omitting it keeps the current one.
 */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, SaveBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const baseUrl = body.baseUrl

  try {
    const saved = upsertProvider({
      id: body.id ? String(body.id) : undefined,
      label: body.label ? String(body.label) : undefined,
      kind: (body.kind === 'ollama' ? 'ollama' : 'openai') as ProviderKind,
      baseUrl,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      // Only env names the catalog knows, and only for that entry's own host.
      apiKeyEnv:
        typeof body.apiKeyEnv === 'string'
          ? body.apiKeyEnv === '' || envNameAllowed(body.apiKeyEnv, baseUrl)
            ? body.apiKeyEnv
            : undefined
          : undefined,
      catalogId: catalogEntry(body.catalogId)?.id ?? catalogForUrl(baseUrl)?.id,
      defaultModel: body.defaultModel ? String(body.defaultModel) : undefined,
    })

    if (body.activate !== false) setActiveProvider(saved.id)
    invalidateModelCache(saved.id)

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
  const parsed = await parseBody(req, z.object({ activeId: nonEmpty() }))
  if (!parsed.ok) return parsed.response
  const id = parsed.data.activeId
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
  invalidateModelCache(id)
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
  const parsed = await parseBody(req, ProbeBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const id = body.id ? String(body.id) : ''
  const stored = id ? getProvider(id) : undefined
  const useStoredKey = body.useStoredKey === true || (!!stored && body.apiKey === undefined)

  const baseUrl = String(body.baseUrl ?? stored?.baseUrl ?? '').trim()
  const typedKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined
  const apiKey = useStoredKey
    ? stored
      ? resolvedKey(stored)
      : undefined
    : typedKey ?? (baseUrl ? catalogEnvKey(body.apiKeyEnv, baseUrl) : undefined)

  if (!baseUrl) return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 })

  const probe = await probeProvider(baseUrl, apiKey || undefined)

  if (probe.ok && body.persist === true && stored) {
    try {
      upsertProvider({
        id: stored.id,
        label: stored.label,
        kind: probe.kind === 'ollama' ? 'ollama' : 'openai',
        baseUrl: probe.endpoint,
        // Never write an env-sourced key to disk; only a key typed in this request.
        apiKey: typedKey,
        defaultModel: stored.defaultModel || probe.models[0]?.id,
      })
    } catch {
      /* a probe result is still useful even if persistence fails */
    }
  }

  return NextResponse.json({ ...probe, baseUrl, models: probe.models })
}
