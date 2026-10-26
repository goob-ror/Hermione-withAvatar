import { NextRequest, NextResponse } from 'next/server'
import { resumeAgent } from '@/lib/agent/loop'
import { getSession } from '@/lib/agent/session'
import { agentStream } from '@/lib/agent/stream'

/**
 * POST /api/agent/approve — resolve a gated tool call and resume the loop.
 * Body: { sessionId, callId, decision: 'approve' | 'deny', thinkingEffort? }
 * Returns the same NDJSON event stream as /api/agent.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = String(body.sessionId ?? '').trim()
  const callId = String(body.callId ?? '').trim()
  const decision = body.decision === 'deny' ? 'deny' : 'approve'
  const thinkingEffort = body.thinkingEffort ?? 'low'

  if (!sessionId || !callId) {
    return NextResponse.json({ error: 'sessionId and callId are required' }, { status: 400 })
  }

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json(
      { error: 'unknown session — the server may have restarted; start a new message' },
      { status: 404 },
    )
  }

  return agentStream((emit) => resumeAgent(session, callId, decision, { thinkingEffort }, emit))
}
