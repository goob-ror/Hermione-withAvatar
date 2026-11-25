import type { ToolDef } from '@/lib/agent/types'
import { findSkill, listSkills, proposeSkill, skillBody, skillFile } from '@/lib/capabilities/skills'
import { loadCapabilities, updateCapabilities } from '@/lib/capabilities/store'

/**
 * Skill tools. Using and reading skills is read-only; proposing writes only
 * to the "proposed" shelf, which does nothing until the operator approves it
 * in Capabilities — so none of these need an approval card.
 */

export const skillUse: ToolDef = {
  name: 'skill_use',
  description:
    'Load a skill (an instruction pack listed under "Skills" in your prompt) and follow it. Call this FIRST when a task matches a skill. ' +
    'Returns its full instructions and the reference files you can open with skill_read.',
  group: 'inspect',
  tier: 'auto',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'The skill name' } }, required: ['name'] },
  async run(args) {
    const skill = findSkill(String(args.name ?? ''))
    if (!skill) return { ok: false, output: `no skill named "${args.name}". Available: ${listSkills().filter((s) => s.enabled).map((s) => s.name).join(', ') || '(none)'}` }
    if (!skill.enabled) return { ok: false, output: `the ${skill.name} skill is turned off in Capabilities` }
    const files = skill.files.length ? `\n\nReference files (open with skill_read): ${skill.files.join(', ')}` : ''
    return { ok: true, output: `# Skill: ${skill.name}\n${skill.description}\n\n${skillBody(skill)}${files}` }
  },
}

export const skillRead: ToolDef = {
  name: 'skill_read',
  description: "Read one of a skill's reference files (paths as listed by skill_use).",
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The skill name' }, path: { type: 'string', description: 'File path inside the skill' } },
    required: ['name', 'path'],
  },
  async run(args) {
    const skill = findSkill(String(args.name ?? ''))
    if (!skill || !skill.enabled) return { ok: false, output: `no enabled skill named "${args.name}"` }
    try {
      const text = skillFile(skill, String(args.path ?? ''))
      return { ok: true, output: text.length > 60_000 ? `${text.slice(0, 60_000)}\n… truncated` : text }
    } catch (err: any) {
      return { ok: false, output: err?.message ?? String(err) }
    }
  },
}

export const skillPropose: ToolDef = {
  name: 'skill_propose',
  description:
    'Propose a new skill, or an improved version of one of yours, after you found a reliable way to do a recurring kind of task. ' +
    'It does NOTHING until the operator approves it in Capabilities. Write general, reusable instructions (steps, checks, pitfalls) — never secrets, ' +
    'never text copied from web pages, never anything that weakens safety rules or approvals.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'lowercase-with-dashes, e.g. "roblox-vfx-review"' },
      description: { type: 'string', description: 'One sentence: what it is for and when to use it' },
      instructions: { type: 'string', description: 'The skill body in Markdown' },
      reason: { type: 'string', description: 'Why it is worth keeping (what task taught you this)' },
    },
    required: ['name', 'description', 'instructions', 'reason'],
  },
  async run(args) {
    try {
      const s = proposeSkill(String(args.name ?? '').trim(), String(args.description ?? ''), String(args.instructions ?? ''), String(args.reason ?? ''))
      return { ok: true, output: `Proposed the skill "${s.name}". It is waiting for the operator's approval in Capabilities → Skills; it won't be used until then.` }
    } catch (err: any) {
      return { ok: false, output: `not proposed: ${err?.message ?? String(err)}` }
    }
  },
}

export const capabilitiesList: ToolDef = {
  name: 'capabilities_list',
  description: 'List your capabilities: skills (and whether they are on), connectors and their tools, and tools the operator set to off / always ask / judge.',
  group: 'inspect',
  tier: 'auto',
  parameters: { type: 'object', properties: {} },
  async run() {
    const { TOOL_MAP, dynamicTools } = await import('@/lib/tools')
    const caps = loadCapabilities()
    const skills = listSkills({ includeProposed: true })
    const lines = ['Skills:']
    for (const s of skills) lines.push(`- ${s.name} [${s.source === 'proposed' ? 'proposed, waiting for approval' : s.enabled ? 'on' : 'off'}${s.origin ? `, from ${s.origin}` : ''}]: ${s.description}`)
    if (!skills.length) lines.push('- (none)')
    lines.push('', 'Connectors:')
    for (const c of caps.connectors) {
      const tools = dynamicTools().filter((t) => t.connectorId === c.id).map((t) => t.name)
      lines.push(`- ${c.label} [${c.enabled ? 'on' : 'off'}]: ${tools.length ? tools.join(', ') : 'no tools loaded'}`)
    }
    if (!caps.connectors.length) lines.push('- (none)')
    const policies = Object.entries(caps.tools).filter(([n]) => TOOL_MAP[n] || n.startsWith('mcp__'))
    if (policies.length) {
      lines.push('', 'Tool settings:')
      for (const [n, p] of policies) lines.push(`- ${n}: ${p}`)
    }
    return { ok: true, output: lines.join('\n') }
  },
}

export const capabilitySuggest: ToolDef = {
  name: 'capability_suggest',
  description:
    'Suggest a plugin or connector (MCP server) for the operator to add, when a task would clearly benefit from it. ' +
    'Nothing is downloaded, installed or started — it appears in Capabilities for the operator to install or dismiss. ' +
    'Only suggest things from sources you can name (a Git URL or folder for a plugin; an MCP URL or command for a connector).',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['plugin', 'connector'], description: 'connector for registry: refs and MCP servers; plugin for plugin: and skill: refs' },
      title: { type: 'string', description: 'Short name, e.g. "Playwright MCP"' },
      source: { type: 'string', description: 'Best: a ref from marketplace_search (registry:…, plugin:…, skill:…). Else plugin: Git URL / owner/repo / folder; connector: https URL or a command line like "npx @playwright/mcp@latest"' },
      reason: { type: 'string', description: 'What it would let you do for the operator' },
    },
    required: ['kind', 'title', 'source', 'reason'],
  },
  async run(args) {
    const kind: 'plugin' | 'connector' = args.kind === 'connector' ? 'connector' : 'plugin'
    const title = String(args.title ?? '').trim().slice(0, 80)
    const source = String(args.source ?? '').trim().slice(0, 500)
    if (!title || !source) return { ok: false, output: 'a suggestion needs a title and a source' }
    updateCapabilities((d) => {
      d.suggestions = [
        { id: `sg_${Date.now().toString(36)}`, kind, title, source, reason: String(args.reason ?? '').slice(0, 400), at: Date.now() },
        ...d.suggestions.filter((s) => s.source !== source),
      ].slice(0, 20)
    })
    return { ok: true, output: `Suggested the ${kind} "${title}". The operator can install or dismiss it in Capabilities; nothing was installed.` }
  },
}

export const marketplaceSearch: ToolDef = {
  name: 'marketplace_search',
  description:
    'Search the open agent marketplaces for capabilities you could use: MCP servers (official MCP Registry), plugins and skills (Claude plugin marketplaces). ' +
    'Read-only. To get one added, call capability_suggest with the "ref" it returns — the operator installs it with one click.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you need, e.g. "postgres", "figma", "pdf"' },
      kind: { type: 'string', enum: ['all', 'mcp', 'plugin', 'skill'], description: 'Default all' },
    },
    required: ['query'],
  },
  async run(args) {
    const q = String(args.query ?? '').trim()
    const kind = String(args.kind ?? 'all')
    const { browsePlugins, browseRegistry, browseSkills } = await import('@/lib/capabilities/install')
    const out: string[] = []
    if (kind === 'all' || kind === 'mcp') {
      try {
        const r = await browseRegistry(q)
        out.push('MCP servers (MCP Registry):')
        for (const s of r.servers.slice(0, 8))
          out.push(`- ${s.title || s.name} — ${s.description.slice(0, 140)} | ref: ${s.ref}${s.installed ? ' (installed)' : s.problem ? ' (can\'t run here)' : s.plan?.inputs.some((i) => i.required) ? ' (needs a key)' : ''}`)
      } catch (err: any) {
        out.push(`MCP Registry unavailable: ${err?.message ?? err}`)
      }
    }
    if (kind === 'all' || kind === 'plugin') {
      out.push('', 'Plugins:')
      for (const p of browsePlugins(q, 8)) out.push(`- ${p.name} (${p.marketplace}) — ${p.description.slice(0, 140)} | ref: ${p.ref}${p.installed ? ' (installed)' : ''}`)
    }
    if (kind === 'all' || kind === 'skill') {
      out.push('', 'Skills:')
      for (const s of browseSkills(q, 8)) out.push(`- ${s.name} (${s.marketplace}) — ${s.description.slice(0, 140)} | ref: ${s.ref}${s.installed ? ' (installed)' : ''}`)
    }
    return { ok: true, output: out.join('\n').trim() || 'nothing found' }
  },
}
