import { NextRequest, NextResponse } from 'next/server'
import {
  addFolder,
  CAPABILITIES,
  permissionsView,
  removeFolder,
  setCapability,
  type CapabilityId,
  type CapabilityState,
} from '@/lib/permissions/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATES: CapabilityState[] = ['granted', 'denied', 'prompt']

/** Which capabilities are decided, plus the folder grants. */
export async function GET() {
  const view = permissionsView()
  return NextResponse.json({
    ...view,
    catalog: CAPABILITIES,
  })
}

/** Record the operator's answer for one capability, or add a folder grant. */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const action = String(body.action ?? 'set').trim()

  if (action === 'addFolder') {
    const folderPath = String(body.path ?? '').trim()
    if (!folderPath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
    const mode: 'read' | 'write' = body.mode === 'write' ? 'write' : 'read'
    try {
      const entry = addFolder(folderPath, mode)
      return NextResponse.json({ ok: true, folder: entry, ...permissionsView() })
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? 'could not add folder' }, { status: 400 })
    }
  }

  const id = String(body.id ?? '').trim() as CapabilityId
  const state = String(body.state ?? '').trim() as CapabilityState
  if (!CAPABILITIES.some((c) => c.id === id)) {
    return NextResponse.json({ error: `unknown capability: ${id}` }, { status: 400 })
  }
  if (!STATES.includes(state)) {
    return NextResponse.json({ error: `state must be one of: ${STATES.join(', ')}` }, { status: 400 })
  }

  const record = setCapability(id, state, body.detail ? String(body.detail) : undefined)
  return NextResponse.json({ ok: true, capability: record, ...permissionsView() })
}

/** Revoke a folder grant. */
export async function DELETE(req: NextRequest) {
  const folderPath = req.nextUrl.searchParams.get('path')
  if (!folderPath) return NextResponse.json({ error: 'path is required' }, { status: 400 })
  const removed = removeFolder(folderPath)
  return NextResponse.json({ removed, ...permissionsView() })
}