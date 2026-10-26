import { NextRequest, NextResponse } from 'next/server'
import {
  getTerminal,
  interrupt,
  subscribe,
  terminalSnapshot,
  writeInput,
  listTerminals,
} from '@/lib/terminal/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Snapshot for a session, or the list of live terminals. */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json({ terminals: listTerminals() })
  }

  const stream = req.nextUrl.searchParams.get('stream')
  if (stream !== '1') {
    const snap = terminalSnapshot(sessionId)
    return NextResponse.json({ sessionId, ...snap })
  }

  // Live byte stream. Replays the ring buffer first so a reconnecting client
  // never loses scrollback, then forwards every new chunk.
  const encoder = new TextEncoder()
  const t = getTerminal(sessionId)

  const body = new ReadableStream({
    start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
        } catch {
          /* client gone */
        }
      }

      send({ type: 'snapshot', buffer: t.buffer, shell: t.shell })

      const unsubscribe = subscribe(sessionId, (chunk) => {
        send({ type: 'chunk', ...chunk })
      })

      const keepAlive = setInterval(() => send({ type: 'ping', at: Date.now() }), 15000)

      const cleanup = () => {
        clearInterval(keepAlive)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Operator input: raw keystrokes or a submitted line. */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = String(body.sessionId ?? '').trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })

  const data = String(body.input ?? '')
  if (!data) return NextResponse.json({ error: 'input is required' }, { status: 400 })

  const result = writeInput(sessionId, data)
  return NextResponse.json(result, { status: result.ok ? 200 : 409 })
}

/** Interrupt — kills the shell tree and starts a fresh one in the same scrollback. */
export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  const by = req.nextUrl.searchParams.get('by') === 'agent' ? 'agent' : 'user'
  return NextResponse.json(interrupt(sessionId, by))
}
