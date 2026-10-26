import { NextResponse } from 'next/server'
import { resolveCommand } from '@/lib/preview/store'

export const dynamic = 'force-dynamic'

/**
 * POST /api/preview/result {commandId, ok, output}
 * The console posts here after the bridge in the iframe answers a
 * `preview_command` event — this is what unblocks the waiting tool call.
 */
export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const commandId = String(body?.commandId ?? '').trim()
  if (!commandId) return NextResponse.json({ error: 'commandId is required' }, { status: 400 })

  const ok = body?.ok !== false
  const output = String(body?.output ?? '')
  const resolved = resolveCommand(commandId, ok, output)

  if (!resolved) {
    return NextResponse.json({ ok: false, error: 'no command waiting with that id (already answered or timed out)' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
