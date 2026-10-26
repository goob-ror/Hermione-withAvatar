import { execFile } from 'child_process'
import type { ToolDef } from '@/lib/agent/types'
import { agentRoot } from '@/lib/agent/paths'

/**
 * Allowlisted binaries. `shell_run` never spawns a shell: the command string is
 * tokenised into argv, the binary is matched against this list, and it runs via
 * execFile — so `;`, `|`, `>`, backticks and `$()` are inert arguments rather
 * than chaining operators. Anything containing those characters is rejected
 * before it reaches execFile anyway.
 */
export const SHELL_ALLOWLIST = [
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'echo',
  'stat', 'du', 'df', 'tree', 'file', 'sort', 'uniq',
  'node', 'npm', 'pnpm', 'npx', 'git',
  'python', 'python3', 'php', 'curl',
  'mkdir', 'cp', 'mv', 'touch',
]

const METACHARACTERS = /[;&|<>`$\n\r]/

/** Split a command line into argv, honouring single and double quotes. */
export function tokenize(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let has = false

  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      has = true
      continue
    }
    if (/\s/.test(ch)) {
      if (has || current) {
        out.push(current)
        current = ''
        has = false
      }
      continue
    }
    current += ch
  }
  if (has || current) out.push(current)
  return out
}

export const shellRun: ToolDef = {
  name: 'shell_run',
  description:
    'Run one allowlisted command inside the agent root. No shell, no pipes, no redirection — argv only. Requires approval.',
  group: 'shell',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: `Command line, e.g. "ls -la lib". Allowed binaries: ${SHELL_ALLOWLIST.join(', ')}`,
      },
      timeout_ms: { type: 'number', description: 'Timeout in ms (default 30000, max 120000)' },
    },
    required: ['command'],
  },
  async run(args) {
    const command = String(args.command ?? '').trim()
    if (!command) return { ok: false, output: 'empty command' }

    if (METACHARACTERS.test(command)) {
      return {
        ok: false,
        output: 'rejected: shell metacharacters are not allowed (no pipes, chaining, redirection or substitution)',
      }
    }

    const argv = tokenize(command)
    const bin = argv[0]
    if (!SHELL_ALLOWLIST.includes(bin)) {
      return {
        ok: false,
        output: `rejected: "${bin}" is not on the allowlist. Allowed: ${SHELL_ALLOWLIST.join(', ')}`,
      }
    }

    const timeout = Math.min(120000, Math.max(1000, Number(args.timeout_ms) || 30000))

    return new Promise((resolve) => {
      execFile(
        bin,
        argv.slice(1),
        { cwd: agentRoot(), timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          const parts: string[] = []
          if (stdout) parts.push(stdout.toString().trimEnd())
          if (stderr) parts.push(`[stderr]\n${stderr.toString().trimEnd()}`)
          if (err) {
            const code = (err as any).code
            parts.push(`[exit ${code ?? 'error'}] ${err.message.split('\n')[0]}`)
            resolve({ ok: false, output: parts.join('\n') || err.message })
            return
          }
          resolve({ ok: true, output: parts.join('\n') || '(no output)' })
        },
      )
    })
  },
}
