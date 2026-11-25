import type { Emit } from './types'

/** Wrap an agent run in an NDJSON streaming Response. */
export function agentStream(runner: (emit: Emit, signal: AbortSignal) => Promise<void>, requestSignal?: AbortSignal): Response {
  const encoder = new TextEncoder()
  // Stop button / closed tab: the client drops the stream, and the run stops at its next step.
  const stop = new AbortController()
  requestSignal?.addEventListener('abort', () => stop.abort(), { once: true })
  const stream = new ReadableStream({
    cancel() {
      stop.abort()
    },
    async start(controller) {
      const emit: Emit = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          // client went away
        }
      }

      try {
        await runner(emit, stop.signal)
      } catch (err: any) {
        emit({ type: 'error', message: err?.message ?? String(err) })
      } finally {
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
