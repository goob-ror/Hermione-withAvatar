import type { ToolDef } from '@/lib/agent/types'
import { interrupt, runInTerminal, terminalSnapshot } from '@/lib/terminal/session'
import { compressTerminalOutput } from '@/lib/compression/rtk'

/**
 * The agent's window into the shared terminal. Same process the operator is
 * typing into, so the agent sees their scrollback and they see its commands.
 */
export const terminalRun: ToolDef = {
  name: 'terminal_run',
  description:
    'Run a command in the shared terminal — the same shell the operator sees and can type into. Full shell syntax (pipes, redirects, chaining) is allowed here, unlike shell_run. Output is captured and returned; the operator watches it live. Requires approval.',
  group: 'shell',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command line to run in the shared terminal, e.g. "git status" or "ls -la | head"',
      },
      timeout_ms: { type: 'number', description: 'Give up waiting after this long (default 120000, max 600000)' },
    },
    required: ['command'],
  },
  async run(args, ctx) {
    const command = String(args.command ?? '').trim()
    if (!command) return { ok: false, output: 'empty command' }

    ctx.emit({
      type: 'terminal_command',
      command,
      cwd: undefined,
    })

    const result = await runInTerminal(ctx.sessionId, command, {
      timeoutMs: Number(args.timeout_ms) || undefined,
    })

    // Apply RTK compression if enabled
    let output = result.output
    let compressionStats = undefined
    
    if (ctx.rtkEnabled && result.ok) {
      const compressed = compressTerminalOutput(output, command)
      output = compressed.text
      compressionStats = compressed.stats
      
      if (compressed.stats.reductionPercent > 10) {
        output = `${output}\n\n[RTK: ${compressed.stats.reductionPercent}% reduction (${compressed.stats.originalBytes}B → ${compressed.stats.compressedBytes}B)]`
      }
    }

    return {
      ok: result.ok,
      output,
      compressionStats,
    }
  },
}

export const terminalInterrupt: ToolDef = {
  name: 'terminal_interrupt',
  description:
    'Stop whatever is running in the shared terminal and start a fresh shell in the same scrollback. Use this when a command hangs, when output is a flood, or when the operator asks you to stop. No approval needed — it is a safety action.',
  group: 'shell',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why you are interrupting (shown to the operator)' },
    },
  },
  async run(args, ctx) {
    const reason = String(args.reason ?? '').trim()
    const result = interrupt(ctx.sessionId, 'agent')
    ctx.emit({ type: 'terminal_interrupt', by: 'agent', reason })
    return {
      ok: result.ok,
      output: reason ? `${result.output} (reason: ${reason})` : result.output,
    }
  },
}

export const terminalRead: ToolDef = {
  name: 'terminal_read',
  description:
    'Read the shared terminal scrollback — everything the operator and you have run in this session, including output you did not produce yourself. Use it to see what the operator is doing before you act.',
  group: 'shell',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      tail_chars: { type: 'number', description: 'Return only the last N characters (default 6000, max 40000)' },
    },
  },
  async run(args, ctx) {
    const snap = terminalSnapshot(ctx.sessionId)
    const cap = Math.min(40000, Math.max(500, Number(args.tail_chars) || 6000))
    let body = snap.buffer.length > cap ? `…\n${snap.buffer.slice(-cap)}` : snap.buffer
    
    // Apply RTK compression if enabled
    if (ctx.rtkEnabled && body) {
      const compressed = compressTerminalOutput(body)
      body = compressed.text
      
      if (compressed.stats.reductionPercent > 10) {
        body = `${body}\n\n[RTK: ${compressed.stats.reductionPercent}% reduction]`
      }
    }
    
    return {
      ok: true,
      output: [
        `shell: ${snap.shell || '(not started)'}`,
        `busy: ${snap.busy ? 'a command is running' : 'idle'}`,
        '',
        body || '(terminal is empty)',
      ].join('\n'),
    }
  },
}
