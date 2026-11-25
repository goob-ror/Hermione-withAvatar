import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { ensureDefaults } from '@/lib/capabilities/defaults'
import { browsePlugins, browseRegistry, browseSkills, installRef, marketListing, recommended } from '@/lib/capabilities/install'
import { addMarketplace, marketplaces, removeMarketplace } from '@/lib/capabilities/marketplace'

/**
 * Capabilities → Browse: the open marketplaces.
 *   GET ?kind=recommended
 *   GET ?kind=plugins|skills&q=…        (Git marketplaces, cached clones)
 *   GET ?kind=mcp&q=…&cursor=…          (official MCP Registry)
 *   GET ?kind=marketplaces
 *   POST { action: 'install', ref, inputs? } | { action: 'refresh' }
 *        | { action: 'marketplace.add', repo } | { action: 'marketplace.remove', id }
 * Operator's page only (proxy.ts guards /api).
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const q = p.get('q') ?? ''
  try {
    await ensureDefaults()
    switch (p.get('kind')) {
      case 'plugins':
        return NextResponse.json({ items: browsePlugins(q), errors: marketListing().errors })
      case 'skills':
        return NextResponse.json({ items: browseSkills(q), errors: marketListing().errors })
      case 'mcp':
        return NextResponse.json(await browseRegistry(q, p.get('cursor') ?? undefined))
      case 'marketplaces':
        return NextResponse.json({ marketplaces: marketplaces() })
      default:
        return NextResponse.json({ items: recommended() })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 502 })
  }
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('install'), ref: z.string().trim().min(3).max(400), inputs: z.record(z.string(), z.string().max(4000)).optional() }),
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('marketplace.add'), repo: z.string().trim().min(3).max(400) }),
  z.object({ action: z.literal('marketplace.remove'), id: z.string().trim().min(1).max(80) }),
])

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    switch (b.action) {
      case 'install':
        return NextResponse.json({ message: await installRef(b.ref, b.inputs ?? {}) })
      case 'refresh': {
        const d = marketListing(true)
        return NextResponse.json({ message: `Refreshed: ${d.plugins.length} plugins, ${d.skills.length} skills.`, errors: d.errors })
      }
      case 'marketplace.add': {
        const m = addMarketplace(b.repo)
        const d = marketListing(true)
        return NextResponse.json({ message: `Added ${m.label}.`, errors: d.errors })
      }
      case 'marketplace.remove':
        removeMarketplace(b.id)
        marketListing(true)
        return NextResponse.json({ message: 'Removed.' })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 400 })
  }
}
