import fs from 'fs'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'
import {
  addSkillSource,
  approveProposal,
  CLAUDE_SKILLS_DIR,
  deleteOwnSkill,

  listSkills,
  proposalReason,
  rejectProposal,
  removeSkillSource,
  setSkillEnabled,
  skillBody,
  writeOwnSkill,
} from '@/lib/capabilities/skills'
import { loadCapabilities, setToolPolicy, TOOL_POLICIES } from '@/lib/capabilities/store'
import { TOOL_MAP, effectivePolicy } from '@/lib/tools'

/**
 * Capabilities (skills, tools, connectors, plugins) — for the operator's page only
 * (proxy.ts guards /api; Hermione has no tool that reaches these actions).
 *   GET              → everything for the page
 *   GET ?skill=name  → one skill's instructions (also pending proposals)
 *   POST { action, … } → change something
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.has('claudeConnectors')) {
    const { claudeServers } = await import('@/lib/capabilities/connectors')
    return NextResponse.json({ servers: claudeServers().map(({ env, headers, ...s }) => ({ ...s, needsEnv: Object.keys(env ?? {}), needsHeaders: Object.keys(headers ?? {}) })) })
  }
  const name = req.nextUrl.searchParams.get('skill')
  if (name) {
    const s = listSkills({ includeProposed: true }).find((x) => x.name === name)
    if (!s) return NextResponse.json({ error: `no skill ${name}` }, { status: 404 })
    return NextResponse.json({ skill: s, body: skillBody(s) })
  }
  const caps = loadCapabilities()
  const { connectorStatus, ensureConnectors } = await import('@/lib/capabilities/connectors')
  void ensureConnectors()
  return NextResponse.json({
    skills: listSkills({ includeProposed: true }).map((s) => ({ ...s, reason: s.source === 'proposed' ? proposalReason(s.name) : undefined })),
    skillSources: caps.skillSources,
    claudeSkills: { dir: CLAUDE_SKILLS_DIR, exists: fs.existsSync(CLAUDE_SKILLS_DIR), linked: caps.skillSources.some((s) => s.toLowerCase() === CLAUDE_SKILLS_DIR.toLowerCase()) },
    tools: Object.values(TOOL_MAP).map((t) => ({
      name: t.name,
      description: t.description,
      group: t.group,
      tier: t.tier,
      source: t.source ?? 'builtin',
      connectorId: t.connectorId,
      policy: effectivePolicy(t.name),
      defaultPolicy: t.defaultPolicy ?? 'default',
    })),
    connectors: connectorStatus(),
    plugins: caps.plugins,
    suggestions: caps.suggestions,
  })
}

const Name = z.string().trim().min(1).max(60)
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skill.toggle'), name: Name, enabled: z.boolean() }),
  z.object({ action: z.literal('skill.save'), name: Name, description: z.string().trim().min(1).max(600), body: z.string().min(1).max(40_000) }),
  z.object({ action: z.literal('skill.delete'), name: Name }),
  z.object({ action: z.literal('skill.approve'), name: Name }),
  z.object({ action: z.literal('skill.reject'), name: Name }),
  z.object({ action: z.literal('source.add'), dir: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('source.remove'), dir: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('source.claude') }),
  z.object({ action: z.literal('tool.policy'), name: z.string().trim().min(1).max(200), policy: z.enum(TOOL_POLICIES) }),
  z.object({
    action: z.literal('connector.add'),
    label: z.string().trim().min(1).max(60),
    transport: z.enum(['stdio', 'http']),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(500)).max(40).optional(),
    url: z.string().trim().max(1000).optional(),
    env: z.record(z.string(), z.string().max(2000)).optional(),
  }),
  z.object({ action: z.literal('connector.toggle'), id: Name, enabled: z.boolean() }),
  z.object({ action: z.literal('connector.remove'), id: Name }),
  z.object({ action: z.literal('connector.restart'), id: Name }),
  z.object({ action: z.literal('connector.claude'), names: z.array(z.string().max(80)).min(1).max(40) }),
  z.object({ action: z.literal('plugin.install'), source: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('plugin.toggle'), id: Name, enabled: z.boolean() }),
  z.object({ action: z.literal('plugin.remove'), id: Name }),
  z.object({ action: z.literal('suggestion.dismiss'), id: Name }),
])

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const b = parsed.data
  try {
    const c = await import('@/lib/capabilities/connectors')
    const p = await import('@/lib/capabilities/plugins')
    switch (b.action) {
      case 'skill.toggle':
        setSkillEnabled(b.name, b.enabled)
        break
      case 'skill.save':
        writeOwnSkill(b.name, b.description, b.body)
        break
      case 'skill.delete':
        deleteOwnSkill(b.name)
        break
      case 'skill.approve':
        approveProposal(b.name)
        break
      case 'skill.reject':
        rejectProposal(b.name)
        break
      case 'source.add':
        addSkillSource(b.dir)
        break
      case 'source.remove':
        removeSkillSource(b.dir)
        break
      case 'source.claude':
        addSkillSource(CLAUDE_SKILLS_DIR)
        break
      case 'tool.policy':
        if (!TOOL_MAP[b.name]) throw new Error(`no tool ${b.name}`)
        setToolPolicy(b.name, b.policy)
        break
      case 'connector.add':
        await c.addConnector(b)
        break
      case 'connector.toggle':
        await c.setConnectorEnabled(b.id, b.enabled)
        break
      case 'connector.remove':
        await c.removeConnector(b.id)
        break
      case 'connector.restart':
        await c.restartConnector(b.id)
        break
      case 'connector.claude':
        await c.importClaudeConnectors(b.names)
        break
      case 'plugin.install':
        await p.installPlugin(b.source)
        break
      case 'plugin.toggle':
        await p.setPluginEnabled(b.id, b.enabled)
        break
      case 'plugin.remove':
        await p.removePlugin(b.id)
        break
      case 'suggestion.dismiss': {
        const { updateCapabilities } = await import('@/lib/capabilities/store')
        updateCapabilities((d) => {
          d.suggestions = d.suggestions.filter((x) => x.id !== b.id)
        })
        break
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 400 })
  }
  return GET(new NextRequest(req.url.split('?')[0]))
}

