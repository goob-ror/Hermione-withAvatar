import fs from 'fs'
import path from 'path'
import { configDir } from '@/lib/agent/providers'

/**
 * How Hermione handles approval-gated actions (writes, deletes, shell and
 * terminal commands, clicking/typing on websites):
 *
 *   ask  — every one shows you an approval card (default)
 *   auto — the judge helper model allows clearly-requested, low-risk ones and
 *          asks you about the rest
 *   off  — runs them without asking
 *
 * In every mode the hard limits (lib/agent/hardLimits.ts) still block or ask.
 * Every decision made without you is appended to
 * .hermione/permissions/audit.jsonl.
 */

export const PERMISSION_MODES = ['ask', 'auto', 'off'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

const modeFile = () => path.join(configDir(), 'permissions', 'mode.json')
const auditFile = () => path.join(configDir(), 'permissions', 'audit.jsonl')

export function permissionMode(): PermissionMode {
  try {
    const m = JSON.parse(fs.readFileSync(modeFile(), 'utf8'))?.mode
    return (PERMISSION_MODES as readonly string[]).includes(m) ? m : 'ask'
  } catch {
    return 'ask'
  }
}

export function setPermissionMode(mode: PermissionMode) {
  fs.mkdirSync(path.dirname(modeFile()), { recursive: true })
  fs.writeFileSync(modeFile(), JSON.stringify({ mode, changedAt: Date.now() }, null, 2))
}

export interface AuditEntry {
  at: number
  sessionId: string
  tool: string
  args: string
  mode: PermissionMode
  decision: 'allowed' | 'asked' | 'blocked'
  by: 'judge' | 'off' | 'hard-limit'
  reason: string
  model?: string
}

export function audit(entry: Omit<AuditEntry, 'at'>) {
  try {
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true })
    fs.appendFileSync(auditFile(), `${JSON.stringify({ at: Date.now(), ...entry, args: entry.args.slice(0, 600) })}\n`)
  } catch {
    /* auditing must never break a run */
  }
}

export function recentAudit(limit = 50): AuditEntry[] {
  try {
    return fs
      .readFileSync(auditFile(), 'utf8')
      .trim()
      .split('\n')
      .slice(-limit)
      .map((l) => JSON.parse(l))
      .reverse()
  } catch {
    return []
  }
}
