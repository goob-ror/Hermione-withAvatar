import { NextRequest } from 'next/server'
import { liveAvailable, watch } from '@/lib/browser/live'

export const dynamic = 'force-dynamic'

/**
 * GET /api/live/stream?sessionId=… — server-sent events:
 *   event: frame  data: <base64 JPEG>      (only when the page changes)
 *   event: meta   data: {url,title,loading,muted,audible,width,height}
 * The screencast runs only while someone is connected.
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || ''
  if (!sessionId || !liveAvailable()) return new Response('unavailable', { status: 503 })

  const encoder = new TextEncoder()
  let stop: (() => void) | null = null
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
        } catch {
          /* client went away */
        }
      }
      try {
        stop = await watch(sessionId, (ev) => {
          if (ev.type === 'frame') send('frame', ev.data)
          else {
            const { type: _type, ...meta } = ev
            send('meta', JSON.stringify(meta))
          }
        })
      } catch (err: any) {
        send('fail', JSON.stringify({ error: String(err?.message ?? err).split('\n')[0] }))
        controller.close()
        return
      }
      // Keep proxies from closing an idle stream.
      const ping = setInterval(() => send('ping', '{}'), 20_000)
      req.signal.addEventListener('abort', () => {
        clearInterval(ping)
        stop?.()
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      })
    },
    cancel() {
      stop?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  })
}
