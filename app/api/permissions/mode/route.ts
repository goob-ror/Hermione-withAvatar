import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import { PERMISSION_MODES, permissionMode, recentAudit, setPermissionMode } from '@/lib/permissions/mode'

/**
 * Permission mode for approval-gated actions.
 *   GET  → { mode: 'ask'|'auto'|'off', audit: [recent decisions made without the operator] }
 *   POST { mode } → set it
 * Only the operator's page calls this (proxy.ts guards /api); the agent has no
 * tool that can change it.
 */
export async function GET() {
  return NextResponse.json({ mode: permissionMode(), audit: recentAudit(30) })
}

const Body = z.object({ mode: z.enum(PERMISSION_MODES) })

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  setPermissionMode(parsed.data.mode)
  return NextResponse.json({ mode: permissionMode(), audit: recentAudit(30) })
}
