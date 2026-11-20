'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react'
import { ArrowLeft, ArrowRight, ArrowUp, Globe2, Loader2, RotateCw, Volume2, VolumeX } from 'lucide-react'

/**
 * The live preview: a real Chrome tab (one per chat session) that you and
 * Hermione share. You see it as a stream of frames and drive it with your
 * mouse and keyboard; Hermione drives the same tab with her page tools.
 */

interface Meta {
  url: string
  title: string
  loading: boolean
  muted: boolean
  audible: boolean
  width: number
  height: number
}

const SPECIAL_KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'F5',
])

export function LivePreview({ sessionId, onUrlChange }: { sessionId: string; onUrlChange?: (url: string, title: string) => void }) {
  const imgRef = useRef<HTMLImageElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(true)
  /** Bumped when the tab is closed, so the stream re-attaches to the next one. */
  const [streamKey, setStreamKey] = useState(0)
  const lastMove = useRef(0)
  const wheel = useRef({ dx: 0, dy: 0, x: 0, y: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> | 0 })
  const onUrlChangeRef = useRef(onUrlChange)
  onUrlChangeRef.current = onUrlChange

  const post = (body: Record<string, unknown>) =>
    fetch('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...body }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false }))

  // Input must reach the tab in order (a mouse-up overtaking its mouse-down loses the click),
  // so events go one at a time. Moves are dropped while others are still queued.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)
  const send = (event: Record<string, unknown>) => {
    if (event.type === 'move' && pending.current > 0) return
    pending.current++
    queue.current = queue.current
      .then(() => post({ action: 'input', event }))
      .finally(() => {
        pending.current--
      })
  }

  // Pause the stream while the panel is hidden (narrow windows keep it off-screen).
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const check = () => setVisible(getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().left > -5000)
    check()
    const mq = window.matchMedia('(max-width: 1100px)')
    mq.addEventListener('change', check)
    window.addEventListener('resize', check)
    return () => {
      mq.removeEventListener('change', check)
      window.removeEventListener('resize', check)
    }
  }, [])

  // Frames + meta over server-sent events.
  useEffect(() => {
    if (!visible) return
    setHasFrame(false)
    const es = new EventSource(`/api/live/stream?sessionId=${encodeURIComponent(sessionId)}`)
    es.addEventListener('frame', (e) => {
      if (imgRef.current) imgRef.current.src = `data:image/jpeg;base64,${(e as MessageEvent).data}`
      setHasFrame(true)
    })
    es.addEventListener('meta', (e) => {
      const m: Meta = JSON.parse((e as MessageEvent).data)
      setMeta(m)
      onUrlChangeRef.current?.(m.url, m.title)
    })
    es.addEventListener('fail', (e) => setError(JSON.parse((e as MessageEvent).data).error))
    return () => es.close()
  }, [sessionId, visible, streamKey])

  // Keep the tab's viewport the same shape as the panel, so clicks map 1:1.
  useEffect(() => {
    const el = stageRef.current
    if (!el || !visible) return
    let t: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => {
        const r = el.getBoundingClientRect()
        if (r.width > 50 && r.height > 50) post({ action: 'viewport', width: r.width, height: r.height })
      }, 250)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, visible])

  const point = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const buttonOf = (b: number) => (b === 2 ? 'right' : b === 1 ? 'middle' : 'left')

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault()
    stageRef.current?.focus()
    send({ type: 'down', ...point(e), button: buttonOf(e.button) })
  }
  const onMouseUp = (e: MouseEvent) => {
    e.preventDefault()
    send({ type: 'up', ...point(e), button: buttonOf(e.button) })
  }
  const onMouseMove = (e: MouseEvent) => {
    const now = Date.now()
    if (now - lastMove.current < 70) return // ~14/s is plenty for hover menus
    lastMove.current = now
    send({ type: 'move', ...point(e) })
  }
  const onWheel = (e: WheelEvent) => {
    const w = wheel.current
    const p = point(e)
    w.dx += e.deltaX
    w.dy += e.deltaY
    w.x = p.x
    w.y = p.y
    if (w.timer) return
    w.timer = setTimeout(() => {
      send({ type: 'wheel', x: w.x, y: w.y, dx: Math.round(w.dx), dy: Math.round(w.dy) })
      w.dx = 0
      w.dy = 0
      w.timer = 0
    }, 60)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Meta'].filter(Boolean) as string[]
    if (e.key.length === 1 && !mods.length) {
      e.preventDefault()
      send({ type: 'text', text: e.key })
      return
    }
    if (mods.length && /^[a-z]$/i.test(e.key) && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return // paste handled below
    if (SPECIAL_KEYS.has(e.key) || (mods.length && e.key.length === 1)) {
      e.preventDefault()
      const key = [...mods, e.shiftKey && e.key.length > 1 ? 'Shift' : '', e.key.length === 1 ? e.key.toLowerCase() : e.key]
        .filter(Boolean)
        .join('+')
      send({ type: 'key', key })
    }
  }
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text) return
    e.preventDefault()
    send({ type: 'text', text })
  }

  const go = async (raw: string) => {
    setEditing(false)
    setError('')
    const res = await post({ action: 'navigate', url: raw })
    if (res && res.ok === false && res.error) setError(res.error)
  }

  return (
    <div className="live-preview">
      <div className="live-bar">
        <button type="button" title="Back" onClick={() => post({ action: 'back' })}>
          <ArrowLeft className="size-3.5" />
        </button>
        <button type="button" title="Forward" onClick={() => post({ action: 'forward' })}>
          <ArrowRight className="size-3.5" />
        </button>
        <button type="button" title="Reload" onClick={() => post({ action: 'reload' })}>
          {meta?.loading ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
        </button>
        <form
          className="live-address"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) go(address)
          }}
        >
          <Globe2 className="size-3 text-zinc-500" />
          <input
            value={editing ? address : (meta?.url ?? '')}
            onFocus={(e) => {
              setAddress(meta?.url ?? '')
              setEditing(true)
              e.currentTarget.select()
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search or type a URL"
            spellCheck={false}
          />
          <button type="submit" title="Go">
            <ArrowUp className="size-3" />
          </button>
        </form>
        <button
          type="button"
          className={meta?.audible && !meta?.muted ? 'is-audible' : ''}
          title={meta?.muted ? 'Unmute this page' : meta?.audible ? 'This page is playing sound — mute it' : 'Mute this page'}
          onClick={() => post({ action: 'mute', muted: !meta?.muted })}
        >
          {meta?.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
      </div>

      {error && <div className="preview-error">{error}</div>}

      <div
        ref={stageRef}
        className="live-stage"
        tabIndex={0}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseMove={onMouseMove}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} alt={meta?.title || 'Live preview'} draggable={false} style={{ opacity: hasFrame && meta?.url ? 1 : 0 }} />
        {!meta?.url && (
          <div className="live-empty">
            <span className="site-kicker">LIVE BROWSER</span>
            <h2>Browse anything</h2>
            <p>Type a site or a search above. You and Hermione share this tab: you can click and type here, and she can act on it with her page tools.</p>
          </div>
        )}
      </div>

      <div className="preview-status">
        <span title={meta?.url}>{meta?.title || meta?.url || 'no page'}</span>
        {meta?.url ? (
          <button type="button" title="Close the page" onClick={() => post({ action: 'close' }).then(() => {
              setMeta(null)
              setHasFrame(false)
              setStreamKey((k) => k + 1)
            })}>
            Close page
          </button>
        ) : null}
      </div>
    </div>
  )
}
