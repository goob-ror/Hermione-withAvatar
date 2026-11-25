import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Own config dir: never touch the real .hermione.
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-caps-'))
process.env.HERMIONE_CONFIG_DIR = cfg
const ECHO = path.join(process.cwd(), 'tests', 'fixtures', 'mcp-echo-server.mjs')
process.env.HERMIONE_TEST_ECHO = ECHO

import { _resetCapabilitiesCache, capabilitiesDir, loadCapabilities, setToolPolicy } from '@/lib/capabilities/store'
import {
  addSkillSource,
  approveProposal,
  findSkill,
  listSkills,
  parseSkillMd,
  proposeSkill,
  rejectProposal,
  setSkillEnabled,
  skillsPromptBlock,
  writeOwnSkill,
} from '@/lib/capabilities/skills'
import { TOOL_MAP, effectivePolicy, isToolAllowed, toolsFor } from '@/lib/tools'
import { addConnector, connectorStatus, expandVars, removeConnector } from '@/lib/capabilities/connectors'
import { installPlugin, removePlugin } from '@/lib/capabilities/plugins'

afterAll(() => fs.rmSync(cfg, { recursive: true, force: true }))
beforeEach(() => {
  fs.rmSync(capabilitiesDir(), { recursive: true, force: true })
  _resetCapabilitiesCache()
})

const run = (name: string, args: object) => TOOL_MAP[name].run(args, { sessionId: 's', emit: () => {} })

describe('skills', () => {
  it('reads SKILL.md front matter, including folded descriptions', () => {
    const { meta, body } = parseSkillMd('---\nname: vfx\ndescription: >\n  Make flashy\n  combat effects.\n---\n\nStep 1.')
    expect(meta).toMatchObject({ name: 'vfx', description: 'Make flashy combat effects.' })
    expect(body.trim()).toBe('Step 1.')
  })

  it('own and linked skills: listed, in the prompt (names only), loadable with skill_use', async () => {
    writeOwnSkill('review-pr', 'Review a pull request carefully.', '1. Read the diff.\n2. Run the tests.')
    const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-skills-'))
    fs.mkdirSync(path.join(linked, 'bandit-vfx'))
    fs.writeFileSync(path.join(linked, 'bandit-vfx', 'SKILL.md'), '---\nname: bandit-vfx\ndescription: Make VFX for The Bandit Beater.\n---\nLayer textures.')
    fs.writeFileSync(path.join(linked, 'bandit-vfx', 'palette.md'), '# Palette\nred, gold')
    addSkillSource(linked)

    expect(listSkills().filter((s) => s.source !== 'builtin').map((s) => `${s.name}:${s.source}`)).toEqual(['review-pr:own', 'bandit-vfx:linked'])
    const block = skillsPromptBlock()
    expect(block).toMatch(/- review-pr: Review a pull request carefully\./)
    expect(block).not.toMatch(/Run the tests/) // instructions stay out of the prompt

    const used = await run('skill_use', { name: 'bandit-vfx' })
    expect(used.output).toMatch(/Layer textures/)
    expect(used.output).toMatch(/palette\.md/)
    expect((await run('skill_read', { name: 'bandit-vfx', path: 'palette.md' })).output).toMatch(/red, gold/)
    expect((await run('skill_read', { name: 'bandit-vfx', path: '../../../etc/passwd' })).ok).toBe(false) // never outside the skill

    setSkillEnabled('bandit-vfx', false)
    expect(skillsPromptBlock()).not.toMatch(/bandit-vfx/)
    expect((await run('skill_use', { name: 'bandit-vfx' })).ok).toBe(false)
    fs.rmSync(linked, { recursive: true, force: true })
  })

  it('Hermione can only PROPOSE a skill: inert until approved; reject removes it', async () => {
    const out = await run('skill_propose', { name: 'deploy-check', description: 'Check a deploy.', instructions: 'Hit /health.', reason: 'Worked twice.' })
    expect(out.ok).toBe(true)
    expect(findSkill('deploy-check')).toBeUndefined() // not usable yet
    expect(skillsPromptBlock()).not.toMatch(/deploy-check/)
    expect(listSkills({ includeProposed: true }).find((s) => s.name === 'deploy-check')?.source).toBe('proposed')

    approveProposal('deploy-check')
    expect(findSkill('deploy-check')).toMatchObject({ source: 'own', enabled: true })

    proposeSkill('bad-idea', 'x', 'y', 'z')
    rejectProposal('bad-idea')
    expect(listSkills({ includeProposed: true }).some((s) => s.name === 'bad-idea')).toBe(false)
    expect((await run('skill_propose', { name: 'Bad Name!', description: 'x', instructions: 'y', reason: 'z' })).ok).toBe(false)
  })
})

describe('tool policies', () => {
  it('"off" hides a tool from Hermione entirely; default comes back', () => {
    setToolPolicy('web_search', 'off')
    expect(toolsFor('chat').some((t) => t.name === 'web_search')).toBe(false)
    expect(isToolAllowed('web_search')).toBe(false)
    setToolPolicy('web_search', 'default')
    expect(isToolAllowed('web_search')).toBe(true)
    expect(loadCapabilities().tools.web_search).toBeUndefined()
  })
})

describe('connectors (a real MCP server over stdio)', () => {
  it('registers its tools: read-only runs, the rest defaults to the judge; removing unregisters', async () => {
    const c = await addConnector({ label: 'Echo', transport: 'stdio', command: 'node', args: [ECHO] })
    for (let i = 0; i < 100 && connectorStatus()[0]?.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100))
    expect(connectorStatus()[0]).toMatchObject({ status: 'ready', tools: ['mcp__echo__echo', 'mcp__echo__write_note'] })

    expect(TOOL_MAP.mcp__echo__echo).toMatchObject({ tier: 'auto', source: 'connector' })
    expect(effectivePolicy('mcp__echo__echo')).toBe('default')
    expect(TOOL_MAP.mcp__echo__write_note).toMatchObject({ tier: 'confirm', defaultPolicy: 'judge' })
    expect(effectivePolicy('mcp__echo__write_note')).toBe('judge')
    expect(toolsFor('forge').some((t) => t.name === 'mcp__echo__echo')).toBe(true)

    expect(await run('mcp__echo__echo', { text: 'hi' })).toEqual({ ok: true, output: 'echo: hi' })
    expect((await run('mcp__echo__write_note', { note: 'x' })).output).toBe('stored 1 note(s)')

    await removeConnector(c.id)
    expect(TOOL_MAP.mcp__echo__echo).toBeUndefined()
    expect(connectorStatus()).toEqual([])
  }, 30_000)

  it('a server that fails to start is reported, not fatal', async () => {
    await addConnector({ label: 'Broken', transport: 'stdio', command: 'node', args: [path.join(cfg, 'missing.mjs')] })
    for (let i = 0; i < 100 && !['failed', 'ready'].includes(connectorStatus()[0]?.status); i++) await new Promise((r) => setTimeout(r, 100))
    expect(connectorStatus()[0].status).toBe('failed')
    await removeConnector(connectorStatus()[0].id)
  }, 30_000)

  it('expands ${VAR}, ${VAR:-default} and ${CLAUDE_PLUGIN_ROOT}', () => {
    process.env.HERMIONE_X = 'xx'
    expect(expandVars('${CLAUDE_PLUGIN_ROOT}/s.js ${HERMIONE_X} ${NOPE:-27182}', '/p')).toBe('/p/s.js xx 27182')
  })
})

describe('plugins', () => {
  it('installs a Claude-style plugin: its skill appears and its MCP server becomes a connector; removing cleans up', async () => {
    const p = await installPlugin(path.join(process.cwd(), 'tests', 'fixtures', 'mcp-plugin'))
    expect(p).toMatchObject({ name: 'demo-plugin', version: '0.1.0', enabled: true })
    expect(findSkill('demo-skill')).toMatchObject({ source: 'plugin', origin: 'demo-plugin' })
    for (let i = 0; i < 100 && connectorStatus()[0]?.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100))
    expect(connectorStatus()[0]).toMatchObject({ label: 'demo-plugin: echo', source: 'plugin', status: 'ready' })

    await removePlugin(p.id)
    expect(findSkill('demo-skill')).toBeUndefined()
    expect(connectorStatus()).toEqual([])
    expect(fs.existsSync(p.dir)).toBe(false)
  }, 30_000)
})
