import type { ToolDef } from '@/lib/agent/types'
import { fsDelete, fsList, fsRead, fsWrite } from './fs'
import { shellRun, SHELL_ALLOWLIST } from './shell'
import { siteInspect, webFetch, allowedDomains } from './web'
import { pageAct, pageOpen, pageRead } from './page'
import { terminalInterrupt, terminalRead, terminalRun } from './terminal'
import { getTime, getCalendar } from './time'
import { webSearch } from './search'

export const TOOLS: ToolDef[] = [
  fsList,
  fsRead,
  fsWrite,
  fsDelete,
  shellRun,
  webFetch,
  webSearch,
  siteInspect,
  pageOpen,
  pageRead,
  pageAct,
  terminalRun,
  terminalRead,
  terminalInterrupt,
  getTime,
  getCalendar,
]

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

export function isKnownTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_MAP, name)
}

/** Ollama `tools` payload — the same schema every model sees. */
export function toolSchemas() {
  return TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/** Text-protocol description for models without the `tools` capability. */
export function textToolProtocol(): string {
  const list = TOOLS.map((t) => {
    const args = (t.parameters as any).properties ?? {}
    const argDoc = Object.entries(args)
      .map(([k, v]: [string, any]) => `${k}${(t.parameters as any).required?.includes(k) ? '' : '?'}: ${v.type}`)
      .join(', ')
    return `- ${t.name}(${argDoc}) [${t.tier}] — ${t.description}`
  }).join('\n')

  return [
    '## Tools',
    'You can call tools. To call one, reply with EXACTLY one fenced json block and nothing else:',
    '```json',
    '{"tool": "fs_list", "args": {"path": "."}}',
    '```',
    'Rules:',
    '- One tool call per reply. Wait for the TOOL RESULT before the next call.',
    '- Never invent a tool name. Never pass arguments not listed below.',
    `- Paths are relative to the agent root. Shell binaries are limited to: ${SHELL_ALLOWLIST.join(', ')}`,
    `- site_inspect is restricted to: ${allowedDomains().join(', ') || '(no domains allowlisted — it will refuse)'}`,
    'When you have enough information, answer in plain prose with no json block.',
    '',
    'Available tools:',
    list,
  ].join('\n')
}

export { SHELL_ALLOWLIST, allowedDomains }
