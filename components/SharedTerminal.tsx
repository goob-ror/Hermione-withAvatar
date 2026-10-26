'use client'

// The shared terminal. One shell per session, attached to by NDJSON stream.
// Both the operator and the agent write into the same process: commands the
// agent runs appear here live, and anything the operator types is in scope for
// the agent's terminal_read. Interrupt kills the shell tree either way.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Cpu, Eraser, GripHorizontal, Square, Terminal as TerminalIcon } from 'lucide-react'

interface Line {
  seq: number
  stream: 'out' | 'err' | 'sys' | 'input'
  text: string
}

export function SharedTerminal({
  sessionId,
  open,
  onToggle,
  /** Set when the agent writes into the terminal, so the panel can flag it. */
  lastAgentCommand,
}: {
  sessionId: string
  open: boolean
  onToggle: (open: boolean) => void
  lastAgentCommand?: { command: string; at: number } | null
}) {
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [shell, setShell] = useState('')
  const [connected, setConnected] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const [historyAt, setHistoryAt] = useState(-1)
  
  // Dragging state
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const terminalRef = useRef<HTMLDivElement | null>(null)
  
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)

  /* ---------------------------------------------------------------- */
  /* Dragging                                                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      setPosition({
        x: Math.max(0, e.clientX - dragOffsetRef.current.x),
        y: Math.max(0, e.clientY - dragOffsetRef.current.y),
      })
    }

    const onMouseUp = () => {
      draggingRef.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const startDrag = (e: React.MouseEvent) => {
    draggingRef.current = true
    const rect = terminalRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffsetRef.current = {
        x: e.clientX - (position?.x ?? rect.left),
        y: e.clientY - (position?.y ?? rect.top),
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Live stream                                                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!open || !sessionId) return

    let closed = false
    const controller = new AbortController()

    const run = async () => {
      try {
        const res = await fetch(`/api/terminal?sessionId=${encodeURIComponent(sessionId)}&stream=1`, {
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          setConnected(false)
          return
        }
        setConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!closed) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          let nl = buffer.indexOf('\n')
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            nl = buffer.indexOf('\n')
            if (!line) continue
            try {
              const evt = JSON.parse(line)
              if (evt.type === 'snapshot') {
                setShell(evt.shell ?? '')
                // The ring buffer is a flat string — render it as one system block.
                setLines(evt.buffer ? [{ seq: 0, stream: 'sys', text: evt.buffer }] : [])
              } else if (evt.type === 'chunk') {
                setLines((prev) => [...prev.slice(-900), { seq: evt.seq, stream: evt.stream, text: evt.text }])
              }
            } catch {
              /* partial line */
            }
          }
        }
      } catch {
        if (!closed) setConnected(false)
      }
    }

    run()
    return () => {
      closed = true
      controller.abort()
    }
  }, [open, sessionId])

  /* Keep the view pinned to the bottom unless the operator scrolled up. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !pinnedRef.current) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  /* ---------------------------------------------------------------- */
  /* Input                                                             */
  /* ---------------------------------------------------------------- */

  const send = useCallback(
    async (payload: string) => {
      if (!payload) return
      setLines((prev) => [...prev.slice(-900), { seq: Date.now(), stream: 'input', text: `$ ${payload}\n` }])
      setBusy(true)
      try {
        const res = await fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, input: payload }),
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          setLines((prev) => [
            ...prev,
            { seq: Date.now(), stream: 'sys', text: `\n[input rejected: ${detail?.error ?? res.status}]\n` },
          ])
        }
      } catch (err: any) {
        setLines((prev) => [
          ...prev,
          { seq: Date.now(), stream: 'sys', text: `\n[input failed: ${err?.message ?? err}]\n` },
        ])
      }
    },
    [sessionId],
  )

  const submit = useCallback(() => {
    const cmd = input.trim()
    if (!cmd) return
    setHistory((h) => [...h, cmd])
    setHistoryAt(-1)
    setInput('')
    send(cmd)
  }, [input, send])

  const interrupt = useCallback(async () => {
    setBusy(false)
    try {
      await fetch(`/api/terminal?sessionId=${encodeURIComponent(sessionId)}&by=user`, { method: 'DELETE' })
    } catch {
      /* the stream will show the restart */
    }
  }, [sessionId])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (!history.length) return
        const next = historyAt === -1 ? history.length - 1 : Math.max(0, historyAt - 1)
        setHistoryAt(next)
        setInput(history[next])
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyAt === -1) return
        const next = historyAt + 1
        if (next >= history.length) {
          setHistoryAt(-1)
          setInput('')
        } else {
          setHistoryAt(next)
          setInput(history[next])
        }
        return
      }
      // Ctrl+C interrupts, like a real terminal.
      if (e.key === 'c' && e.ctrlKey) {
        e.preventDefault()
        interrupt()
      }
    },
    [history, historyAt, submit, interrupt],
  )

  const rendered = useMemo(
    () =>
      lines.map((l, i) => {
        const color =
          l.stream === 'err'
            ? 'text-[#d98a5f]'
            : l.stream === 'sys'
              ? 'text-[#6f6b70]'
              : l.stream === 'input'
                ? 'text-[#c5a871]'
                : 'text-[#cfccc7]'
        return (
          <span key={`${l.seq}-${i}`} className={`${color} whitespace-pre-wrap break-words`}>
            {l.text}
          </span>
        )
      }),
    [lines],
  )

  const agentActive = lastAgentCommand && Date.now() - lastAgentCommand.at < 15000

  if (!open) {
    return (
      <button
        onClick={() => onToggle(true)}
        className="flex items-center gap-2 w-full px-3 py-2 text-[11px] font-mono text-zinc-400 hover:text-[#d2b278] border-t border-[#222026] bg-[#111013] transition-colors"
      >
        <TerminalIcon className="size-3.5" />
        Shared terminal
        <ChevronUp className="size-3 ml-auto" />
      </button>
    )
  }

  return (
    <section
      ref={terminalRef}
      style={
        position
          ? {
              position: 'fixed',
              left: `${position.x}px`,
              top: `${position.y}px`,
              width: '680px',
              zIndex: 9999,
            }
          : {
              position: 'relative',
              zIndex: 50,
            }
      }
      className="border border-[#3a353f] bg-[#0d0c0e] flex flex-col shadow-2xl rounded-lg overflow-hidden"
    >
      {/* Header / Drag Handle */}
      <div
        onMouseDown={startDrag}
        className="flex items-center gap-2 px-3 py-1.5 border-b border-[#222026] bg-[#111013] cursor-grab active:cursor-grabbing select-none"
      >
        <GripHorizontal className="size-4 text-zinc-500" />
        <TerminalIcon className="size-3.5 text-[#b69a72]" />
        <span className="text-[11px] font-mono text-[#dedbd7]">Shared terminal</span>
        <span className="text-[10px] font-mono text-[#6f6b70] truncate max-w-48">{shell || 'starting…'}</span>
        <span
          className={`size-1.5 rounded-full ${connected ? 'bg-[#7fd6a0]' : 'bg-[#7a4b4b]'}`}
          title={connected ? 'connected' : 'disconnected'}
        />
        {agentActive && (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-[#80a9c1] bg-[#80a9c1]/10 border border-[#2f4757] px-1.5 py-0.5 rounded">
            <Cpu className="size-2.5" /> agent typing
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={interrupt}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono text-[#d98a5f] hover:bg-[#231a1c] border border-[#3a2f26] transition-colors"
            title="Interrupt (Ctrl+C)"
          >
            <Square className="size-2.5" /> interrupt
          </button>
          <button
            onClick={() => setLines([])}
            className="p-1 rounded text-zinc-500 hover:text-white hover:bg-[#232128] transition-colors"
            title="Clear view"
          >
            <Eraser className="size-3" />
          </button>
          <button
            onClick={() => onToggle(false)}
            className="p-1 rounded text-zinc-500 hover:text-white hover:bg-[#232128] transition-colors"
            title="Close"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-[1.5] bg-[#0b0a0c]"
        style={{ height: '240px' }}
      >
        {rendered}
        {!lines.length && <span className="text-[#5d5a60]">type a command — the agent sees it too</span>}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-[#222026] bg-[#111013]">
        <span className="text-[11.5px] font-mono text-[#c5a871]">$</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="run anything — full shell syntax"
          spellCheck={false}
          autoComplete="off"
          className="flex-1 bg-transparent text-[11.5px] font-mono text-[#dedbd7] placeholder:text-[#5d5a60] focus:outline-none"
        />
        {busy && <span className="text-[10px] font-mono text-[#5d5a60]">running…</span>}
      </div>
    </section>
  )
}