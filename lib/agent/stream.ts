import type { Emit } from './types'
import { idleChatterLoop } from './idleChatter'

/** Wrap an agent run in an NDJSON streaming Response. */
export function agentStream(runner: (emit: Emit) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
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
        await runner(emit)
      } catch (err: any) {
        emit({ type: 'error', message: err?.message ?? String(err) })
      } finally {
        // Stop the chatter loop
        shouldStopChatter.value = true
        await chatterTask.catch(() => {})
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
