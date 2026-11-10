import { NextRequest, NextResponse } from 'next/server'
import { resumeAgent } from '@/lib/agent/loop'
import { getSession } from '@/lib/agent/session'
import { agentStream } from '@/lib/agent/stream'
import { z } from 'zod'
import { id, parseBody, ThinkingEffort } from '@/lib/http/validate'

/**
 * POST /api/agent/approve — resolve a gated tool call and resume the loop.
 * Body: { sessionId, callId, decision: 'approve' | 'deny', thinkingEffort? }
 * Returns the same NDJSON event stream as /api/agent.
 */
// `decision` must be stated explicitly — a missing or misspelled value used to
// count as "approve", which would have run a gated shell/file action.
const ApproveBody = z.object({
  sessionId: id(),
  callId: id(),
  decision: z.enum(['approve', 'deny']),
  thinkingEffort: ThinkingEffort.default('low'),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, ApproveBody)
  if (!parsed.ok) return parsed.response
  const { sessionId, callId, decision, thinkingEffort } = parsed.data

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json(
      { error: 'unknown session — the server may have restarted; start a new message' },
      { status: 404 },
    )
  }

  return agentStream((emit) => resumeAgent(session, callId, decision, { thinkingEffort }, emit))
}
