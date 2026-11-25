import type { ToolDef } from '@/lib/agent/types'
import { toolPolicy, type ToolPolicy } from '@/lib/capabilities/store'
import { fsDelete, fsList, fsRead, fsWrite } from './fs'
import { shellRun, SHELL_ALLOWLIST } from './shell'
import { siteInspect, webFetch, allowedDomains } from './web'
import { pageAct, pageOpen, pageRead } from './page'
import { terminalInterrupt, terminalRead, terminalRun } from './terminal'
import { getTime, getCalendar } from './time'
import { webSearch } from './search'
import { askUser } from './ask'
import { imageSearch } from './images'
import { memoryForget, memorySave, notesRead, notesSearch } from './memory'
import { updatePlan } from './plan'
import { videoInspect, videoSearch } from './video'
import { clipRender, clipUpload } from './clip'
import { delegate } from './delegate'
import { capabilitiesList, capabilitySuggest, marketplaceSearch, skillPropose, skillRead, skillUse } from './skills'

export const TOOLS: ToolDef[] = [
  fsList,
  fsRead,
  fsWrite,
  fsDelete,
  shellRun,
  webFetch,
  webSearch,
  imageSearch,
  siteInspect,
  pageOpen,
  pageRead,
  pageAct,
  terminalRun,
  terminalRead,
  terminalInterrupt,
  getTime,
  getCalendar,
  askUser,
  memorySave,
  memoryForget,
  notesSearch,
  notesRead,
  updatePlan,
  videoSearch,
  videoInspect,
  clipRender,
  clipUpload,
  delegate,
  skillUse,
  skillRead,
  skillPropose,
  capabilitiesList,
  capabilitySuggest,
  marketplaceSearch,
]

/**
 * Tools added at runtime (connector / MCP tools). Process-wide: Next bundles
 * each API route separately, so a module-level map would give the agent route
 * and the Capabilities route different registries.
 */
const g = globalThis as unknown as { __hermioneDynamicTools?: Map<string, ToolDef> }
const DYNAMIC = (g.__hermioneDynamicTools ??= new Map<string, ToolDef>())
const BUILTIN: Record<string, ToolDef> = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

/** Every tool by name: the built-ins plus whatever connectors registered (see registerTool). */
export const TOOL_MAP: Record<string, ToolDef> = new Proxy(BUILTIN, {
  get: (t, name: string) => t[name] ?? DYNAMIC.get(name),
  has: (t, name: string) => name in t || DYNAMIC.has(name),
  ownKeys: (t) => [...Reflect.ownKeys(t), ...[...DYNAMIC.keys()].filter((k) => !(k in t))],
  getOwnPropertyDescriptor: (t, name: string) => {
    const value = t[name] ?? DYNAMIC.get(name)
    return value ? { value, enumerable: true, configurable: true, writable: false } : undefined
  },
})

export function registerTool(def: ToolDef) {
  DYNAMIC.set(def.name, def)
}

export function unregisterTools(pred: (def: ToolDef) => boolean) {
  for (const [name, def] of DYNAMIC) if (pred(def)) DYNAMIC.delete(name)
}

export const dynamicTools = () => [...DYNAMIC.values()]

/** The policy in force for a tool: yours if set, else the tool's own default. */
export function effectivePolicy(name: string): ToolPolicy {
  return toolPolicy(name, TOOL_MAP[name]?.defaultPolicy ?? 'default')
}

export function isKnownTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_MAP, name)
}

/**
 * Tools each workspace mode exposes. Every tool definition is re-sent on every
 * model call, so Content Forge (research + preview) doesn't carry the shell,
 * terminal and file-writing tools it never uses.
 */
const FORGE_TOOLS = new Set([
  'web_search', 'image_search', 'web_fetch', 'site_inspect',
  'page_open', 'page_read', 'page_act',
  'fs_list', 'fs_read',
  'get_time', 'get_calendar',
  'ask_user',
  'memory_save', 'memory_forget', 'notes_search', 'notes_read',
  'update_plan',
  'video_search', 'video_inspect',
  'clip_render', 'clip_upload',
  'delegate',
  'skill_use', 'skill_read', 'skill_propose', 'capabilities_list', 'capability_suggest', 'marketplace_search',
])

export type ToolMode = 'chat' | 'forge'

export function toolsFor(mode: ToolMode = 'chat'): ToolDef[] {
  const builtIn = mode === 'forge' ? TOOLS.filter((t) => FORGE_TOOLS.has(t.name)) : TOOLS
  return [...builtIn, ...DYNAMIC.values()].filter((t) => effectivePolicy(t.name) !== 'off')
}

export function isToolAllowed(name: string, mode: ToolMode = 'chat'): boolean {
  if (effectivePolicy(name) === 'off') return false
  return mode !== 'forge' || FORGE_TOOLS.has(name) || DYNAMIC.has(name)
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
