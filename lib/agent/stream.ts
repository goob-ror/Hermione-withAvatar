import type { Emit } from './types'
import { idleChatterLoop } from './idleChatter'

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

      // Start idle chatter in parallel
      const shouldStopChatter = { value: false }
      const chatterTask = (async () => {
        for await (const remark of idleChatterLoop(shouldStopChatter)) {
          emit(remark as any)
        }
      })()

      try {
        await runner(emit, stop.signal)
      } catch (err: any) {
        emit({ type: 'error', message: err?.message ?? String(err) })
      } finally {
        // Stop the chatter loop. Don't wait for its 2–8 s sleep: the answer is
        // done, so close the stream now (the loop exits without emitting).
        shouldStopChatter.value = true
        void chatterTask.catch(() => {})
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
