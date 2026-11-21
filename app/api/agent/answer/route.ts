import { NextRequest, NextResponse } from 'next/server'
import { resumeAgent } from '@/lib/agent/loop'
import { getSession } from '@/lib/agent/session'
import { agentStream } from '@/lib/agent/stream'
import { z } from 'zod'
import { id, parseBody, ThinkingEffort } from '@/lib/http/validate'

/**
 * POST /api/agent/answer — answer Hermione's ask_user question and resume.
 * Body: { sessionId, callId, choices: string[], other?: string, skipped?: boolean, thinkingEffort? }
 * The choices are checked against the options she offered. Returns the same
 * NDJSON event stream as /api/agent.
 */
const AnswerBody = z.object({
  sessionId: id(),
  callId: id(),
  choices: z.array(z.string().max(200)).max(8).default([]),
  other: z.string().max(2000).optional(),
  skipped: z.boolean().optional(),
  thinkingEffort: ThinkingEffort.default('low'),
})

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, AnswerBody)
  if (!parsed.ok) return parsed.response
  const { sessionId, callId, choices, other, skipped, thinkingEffort } = parsed.data

  const session = getSession(sessionId)
  if (!session) {
    return NextResponse.json(
      { error: 'unknown session — the server may have restarted; reply in the chat instead' },
      { status: 404 },
    )
  }

  const answer = skipped ? null : { choices, other }
  return agentStream(
    (emit, signal) => resumeAgent(session, callId, { kind: 'answer', answer }, { thinkingEffort, signal }, emit),
    req.signal,
  )
}
