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

/**
 * Tools each workspace mode exposes. Every tool definition is re-sent on every
 * model call, so Content Forge (research + preview) doesn't carry the shell,
 * terminal and file-writing tools it never uses.
 */
const FORGE_TOOLS = new Set([
  'web_search', 'web_fetch', 'site_inspect',
  'page_open', 'page_read', 'page_act',
  'fs_list', 'fs_read',
  'get_time', 'get_calendar',
])

export type ToolMode = 'chat' | 'forge'

export function toolsFor(mode: ToolMode = 'chat'): ToolDef[] {
  return mode === 'forge' ? TOOLS.filter((t) => FORGE_TOOLS.has(t.name)) : TOOLS
}

export function isToolAllowed(name: string, mode: ToolMode = 'chat'): boolean {
  return mode !== 'forge' || FORGE_TOOLS.has(name)
}

/** Ollama / OpenAI `tools` payload for the given mode. */
export function toolSchemas(mode: ToolMode = 'chat') {
  return toolsFor(mode).map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/** Text-protocol description for models without the `tools` capability. */
export function textToolProtocol(mode: ToolMode = 'chat'): string {
  const list = toolsFor(mode).map((t) => {
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
