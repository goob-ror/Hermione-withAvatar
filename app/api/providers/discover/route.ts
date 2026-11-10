import { NextRequest, NextResponse } from 'next/server'
import { discoverBackends } from '@/lib/agent/discovery'

/**
 * GET /api/providers/discover[?refresh=1]
 * Scans local runtimes on their default ports and checks API-key env vars
 * for hosted APIs. Never returns key values — only the env var's name.
 */
export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.has('refresh')
  const backends = await discoverBackends(force)
  return NextResponse.json({
    local: backends.filter((b) => b.scope === 'local'),
    cloud: backends.filter((b) => b.scope === 'cloud'),
  })
}
