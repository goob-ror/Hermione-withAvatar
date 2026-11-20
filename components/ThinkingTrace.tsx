'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Sparkles, X } from 'lucide-react'
import { describeTool, formatElapsed, thinkingHeadline } from '@/lib/agent/stepText'

export type TraceStep = { kind: 'thinking'; text: string } | { kind: 'tool'; callId: string }

export interface TraceTool {
  callId: string
  tool: string
  args: Record<string, any>
  state: 'pending' | 'running' | 'done' | 'blocked'
  ok?: boolean
}

/**
 * Claude-style activity row. While Hermione works: a spinner, a shimmering
 * line saying what she's doing right now, and a timer. Once she's done:
 * "Thought for 14s · 3 steps". Click to see every thought and tool step in order.
 */
export function ThinkingTrace({
  steps,
  tools,
  running,
  workedMs,
  activeSince,
  writing,
  fallbackThinking,
  renderTool,
}: {
  steps: TraceStep[]
  tools: TraceTool[]
  running: boolean
  workedMs: number
  activeSince?: number
  /** Her answer has started streaming. */
  writing: boolean
  /** Saved chats have only the thinking text, no steps. */
  fallbackThinking?: string
  renderTool: (callId: string) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  const list: TraceStep[] = steps.length ? steps : fallbackThinking ? [{ kind: 'thinking', text: fallbackThinking }] : []
  const toolById = new Map(tools.map((t) => [t.callId, t]))
  const toolSteps = list.filter((s) => s.kind === 'tool').length
  const thought = list.some((s) => s.kind === 'thinking')
  const elapsed = workedMs + (running && activeSince ? now - activeSince : 0)

  // Nothing happened worth showing (a quick plain answer).
  if (!running && !list.length) return null

  let headline: string
  if (running) {
    const last = list[list.length - 1]
    if (writing && (!last || last.kind === 'thinking')) headline = 'Writing the answer…'
    else if (!last) headline = 'Thinking…'
    else if (last.kind === 'tool') {
      const t = toolById.get(last.callId)
      headline = !t
        ? 'Working…'
        : t.state === 'pending'
          ? 'Waiting for your approval…'
          : t.state === 'running'
            ? `${describeTool(t.tool, t.args)}…`
            : 'Putting it together…' // the tool finished; she's working on what it returned
    } else headline = thinkingHeadline(last.text) || 'Thinking…'
  } else {
    const verb = thought ? 'Thought' : 'Worked'
    headline = `${verb}${elapsed >= 1000 ? ` for ${formatElapsed(elapsed)}` : ''}`
    if (toolSteps) headline += ` · ${toolSteps} step${toolSteps === 1 ? '' : 's'}`
  }

  return (
    <div className={`trace ${running ? 'is-running' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="trace-head" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!list.length}>
        {running ? <span className="trace-spinner" aria-hidden /> : <Sparkles className="size-3.5 trace-icon" />}
        <span className={`trace-line ${running ? 'shimmer' : ''}`} key={running ? headline : 'done'}>
          {headline}
        </span>
        {running && <span className="trace-time">{formatElapsed(elapsed)}</span>}
        {list.length > 0 && <ChevronRight className="size-3.5 trace-chevron" />}
      </button>

      {open && list.length > 0 && (
        <ol className="trace-steps">
          {list.map((s, i) =>
            s.kind === 'thinking' ? (
              <li key={i} className="trace-step is-thinking">
                <span className="trace-dot" />
                <div>
                  <p className="trace-step-title">{thinkingHeadline(s.text, 90) || 'Thinking'}</p>
                  <p className="trace-thought">{s.text.trim()}</p>
                </div>
              </li>
            ) : (
              <ToolStep key={s.callId} tool={toolById.get(s.callId)} live={running}>
                {renderTool(s.callId)}
              </ToolStep>
            ),
          )}
        </ol>
      )}
    </div>
  )
}

function ToolStep({ tool, live, children }: { tool?: TraceTool; live: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!tool) return null
  const working = tool.state === 'running' && live
  const failed = tool.state === 'blocked' || tool.ok === false
  return (
    <li className={`trace-step is-tool ${failed ? 'is-failed' : ''}`}>
      <span className="trace-mark">
        {working ? <span className="trace-spinner small" /> : failed ? <X className="size-3" /> : tool.state === 'pending' ? <span className="trace-dot" /> : <Check className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" className="trace-step-title as-button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {describeTool(tool.tool, tool.args, !working && tool.state !== 'pending')}
          {failed ? ' — didn’t work' : ''}
          <ChevronRight className={`size-3 trace-chevron ${open ? 'is-open' : ''}`} />
        </button>
        {open && <div className="trace-tool-detail">{children}</div>}
      </div>
    </li>
  )
}
