import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-market-'))
process.env.HERMIONE_CONFIG_DIR = cfg

// Defaults must not dial out in tests: record the connectors instead of starting them.
const added: any[] = []
vi.mock('@/lib/capabilities/connectors', async (orig) => {
  const real = await orig<typeof import('@/lib/capabilities/connectors')>()
  return {
    ...real,
    addConnector: async (input: any) => {
      added.push(input)
      const { updateCapabilities } = await import('@/lib/capabilities/store')
      updateCapabilities((d) => {
        d.connectors.push({ id: input.label.toLowerCase(), label: input.label, transport: input.transport, url: input.url, command: input.command, args: input.args, enabled: true, source: input.source ?? 'you', addedAt: 1, ...(input.trustReadOnly ? { trustReadOnly: true } : {}) })
      })
      return input
    },
  }
})

import { _resetCapabilitiesCache, capabilitiesDir, loadCapabilities } from '@/lib/capabilities/store'
import { addMarketplace, browseMarketplaces, installMarketSkill, repoUrl } from '@/lib/capabilities/marketplace'
import { installPlugin, removePlugin } from '@/lib/capabilities/plugins'
import { findSkill, listSkills } from '@/lib/capabilities/skills'
import { fillTemplate, planInstall } from '@/lib/capabilities/registry'
import { ensureDefaults, RECOMMENDED } from '@/lib/capabilities/defaults'
import { installRef } from '@/lib/capabilities/install'

/** A local Git repo in the Claude marketplace format. */
function makeMarketRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'market-repo-'))
  const w = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  w('skills/pdf-tools/SKILL.md', '---\nname: pdf-tools\ndescription: Work with PDF files.\n---\nUse pypdf.')
  w('skills/pdf-tools/reference.md', '# API')
  w('skills/xlsx-tools/SKILL.md', '---\nname: xlsx-tools\ndescription: Work with spreadsheets.\n---\nUse openpyxl.')
  w('plugins/lint-helper/.claude-plugin/plugin.json', '{"name":"lint-helper","description":"Lint things","version":"1.2.0"}')
  w('plugins/lint-helper/skills/lint/SKILL.md', '---\nname: lint\ndescription: Run linters.\n---\nRun eslint.')
  w(
    '.claude-plugin/marketplace.json',
    JSON.stringify({
      name: 'test-market',
      plugins: [
        { name: 'lint-helper', description: 'Lint things', category: 'development', source: './plugins/lint-helper' },
        { name: 'doc-skills', description: 'Only the PDF skill', source: './', strict: false, skills: ['./skills/pdf-tools'] },
      ],
    }),
  )
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']]) spawnSync('git', args, { cwd: dir })
  return dir
}

const repo = makeMarketRepo()
afterAll(() => {
  fs.rmSync(cfg, { recursive: true, force: true })
  fs.rmSync(repo, { recursive: true, force: true })
})
beforeEach(() => {
  fs.rmSync(capabilitiesDir(), { recursive: true, force: true })
  _resetCapabilitiesCache()
  added.length = 0
})

describe('Git marketplaces', () => {
  it('normalizes repo references', () => {
    expect(repoUrl('anthropics/skills')).toBe('https://github.com/anthropics/skills.git')
    expect(repoUrl('https://github.com/a/b')).toBe('https://github.com/a/b.git')
    expect(() => repoUrl('not a repo')).toThrow()
  })

  it('lists plugins and skills (marketplace entries + skills/ folder) from a cloned marketplace', () => {
    addMarketplace(repo, 'Test market')
    const { plugins, skills, errors } = browseMarketplaces()
    expect(errors).toEqual([])
    expect(plugins.map((p) => p.ref)).toEqual([expect.stringMatching(/^plugin:.+\/lint-helper$/), expect.stringMatching(/^plugin:.+\/doc-skills$/)])
    expect(skills.map((s) => s.name).sort()).toEqual(['pdf-tools', 'xlsx-tools'])
  })

  it('installs a single skill as one of her own (with its files and origin)', () => {
    addMarketplace(repo, 'Test market')
    const ref = browseMarketplaces().skills.find((s) => s.name === 'pdf-tools')!.ref
    expect(installMarketSkill(ref)).toBe('pdf-tools')
    const s = findSkill('pdf-tools')!
    expect(s).toMatchObject({ source: 'own', origin: expect.stringMatching(/Test market/) })
    expect(s.files).toContain('reference.md')
  })

  it('installs marketplace plugins — a folder plugin, and a "strict: false" one built from its listed skills', async () => {
    addMarketplace(repo, 'Test market')
    const { plugins } = browseMarketplaces()
    const lint = await installPlugin(plugins[0].ref)
    expect(lint).toMatchObject({ name: 'lint-helper', version: '1.2.0', origin: 'Test market: lint-helper' })
    expect(findSkill('lint')).toMatchObject({ source: 'plugin' })

    const docs = await installPlugin(plugins[1].ref)
    expect(docs.name).toBe('doc-skills')
    expect(findSkill('pdf-tools')).toMatchObject({ source: 'plugin' })
    expect(findSkill('xlsx-tools')).toBeUndefined() // not listed by the entry
    await removePlugin(docs.id)
    await removePlugin(lint.id)
  })
})

describe('MCP Registry install plans', () => {
  const base = { name: 'io.example/x', description: '', remotes: [] as any[], packages: [] as any[] }
  it('prefers a hosted server, with header templates filled in', () => {
    const plan = planInstall({ ...base, remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp', headers: [{ name: 'Authorization', value: 'Bearer {key}', isRequired: true, isSecret: true }] }] })
    expect(plan).toMatchObject({ transport: 'http', url: 'https://x.example/mcp', inputs: [{ key: 'Authorization', kind: 'header', required: true }] })
    expect(fillTemplate('Bearer {key}', 'abc')).toBe('Bearer abc')
    expect(fillTemplate(undefined, 'abc')).toBe('abc')
  })
  it('falls back to an npm package run with npx, passing its env vars as inputs', () => {
    const plan = planInstall({ ...base, packages: [{ registryType: 'npm', identifier: '@x/mcp', version: '1.0.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'X_KEY', isSecret: true }] }] })
    expect(plan).toMatchObject({ transport: 'stdio', command: 'npx', args: ['-y', '@x/mcp@1.0.0'], inputs: [{ key: 'X_KEY', kind: 'env', required: false }] })
  })
  it('says clearly when a server can not run here', () => {
    expect(() => planInstall({ ...base, remotes: [{ type: 'sse', url: 'https://x/sse' }] })).toThrow(/can't run/)
  })
})

describe('defaults', () => {
  it('seeds the open marketplaces and Context7 + DeepWiki once, as trusted read-only', async () => {
    await ensureDefaults()
    const caps = loadCapabilities()
    expect(caps.defaultsSeeded).toBe(true)
    expect(caps.marketplaces.map((m) => m.id)).toEqual(expect.arrayContaining(['claude-plugins-official', 'anthropic-skills', 'hermes']))
    expect(added.map((a) => [a.label, a.url, a.trustReadOnly])).toEqual([
      ['Context7', 'https://mcp.context7.com/mcp', true],
      ['DeepWiki', 'https://mcp.deepwiki.com/mcp', true],
    ])
    // Removing them sticks: running again adds nothing.
    added.length = 0
    await ensureDefaults()
    expect(added).toEqual([])
  })

  it('ships starter skills, on by default', () => {
    const builtin = listSkills().filter((s) => s.source === 'builtin').map((s) => s.name)
    expect(builtin).toEqual(expect.arrayContaining(['research-brief', 'debug-systematically', 'code-review', 'project-onboarding', 'short-video-script']))
    expect(listSkills().filter((s) => s.source === 'builtin').every((s) => s.enabled && s.description.length > 30)).toBe(true)
  })

  it('a recommended connector that needs a token refuses to install without one', async () => {
    expect(RECOMMENDED.find((r) => r.ref === 'connector:github')?.connector?.inputs?.[0].required).toBe(true)
    await expect(installRef('connector:github')).rejects.toThrow(/Authorization is required/)
    await installRef('connector:github', { Authorization: 'ghp_test' })
    expect(added[0]).toMatchObject({ label: 'GitHub', headers: { Authorization: 'Bearer ghp_test' } })
  })
})

/* ---------- Hermes Marketplace (local fixture in the Hermes catalog format) ---------- */
import { updateCapabilities } from '@/lib/capabilities/store'
import { browsePlugins, browseSkills, hermesMcpListing } from '@/lib/capabilities/install'
import { hermesSkillPaths } from '@/lib/capabilities/hermes'

/** A local folder as a file:// Git URL (forward slashes on Windows too). */
const fileUrl = (dir: string) => `file://${dir.split(path.sep).join('/')}`

function gitRepo(files: Record<string, string>): { dir: string; sha: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-fx-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  for (const args of [['init', '-q'], ['config', 'uploadpack.allowAnySHA1InWant', 'true'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']]) spawnSync('git', args, { cwd: dir })
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
  return { dir, sha }
}

describe('Hermes Marketplace', () => {
  // A portable plugin repo (Agent Plugins v1: plugin.json + mcp.json + skills/).
  const plugin = gitRepo({
    'pkg/plugin.json': '{"name":"echo-pack","version":"2.0.0","description":"Echo MCP plus a skill"}',
    'pkg/mcp.json': JSON.stringify({ mcpServers: { echo: { type: 'streamable-http', url: 'https://echo.example/mcp' } } }),
    'pkg/skills/echo-howto/SKILL.md': '---\nname: echo-howto\ndescription: How to use echo.\n---\nCall echo.',
  })
  const catalog = gitRepo({
    'plugin-catalog/echo-pack.yaml': `name: echo-pack\ntitle: Echo Pack\nrepo: ${fileUrl(plugin.dir)}\nsha: ${plugin.sha}\nsubdir: pkg\ntier: official\ncategory: tools\ndescription: Echo things.\ncapabilities:\n  provides_tools: []\n  provides_hooks: []\n  provides_middleware: []\n`,
    'plugin-catalog/py-only.yaml': `name: py-only\nrepo: https://example.com/x.git\nsha: ${'a'.repeat(40)}\ntier: community\ndescription: Python hooks.\ncapabilities:\n  provides_tools: [do_thing]\n`,
    'plugin-catalog/bad-pin.yaml': 'name: bad-pin\nrepo: https://example.com/y.git\nsha: main\ndescription: Not pinned.\n',
    'optional-mcps/aws-knowledge/manifest.yaml': 'name: aws-knowledge\ndescription: AWS docs.\ntransport:\n  type: http\n  url: https://knowledge-mcp.global.api.aws\nauth:\n  type: none\n',
    'optional-mcps/airtable/manifest.yaml': 'name: airtable\ndescription: Airtable bases.\ntransport:\n  type: http\n  url: https://mcp.airtable.com/mcp\nauth:\n  type: oauth\n',
    'skills/research/arxiv/SKILL.md': '---\nname: arxiv\ndescription: Search arXiv papers.\n---\nUse the API.',
    'optional-skills/devops/docker-management/SKILL.md': '---\nname: docker-management\ndescription: Manage Docker.\n---\nUse docker.',
    'agent/core.py': 'print("not part of the catalog")',
  })
  afterAll(() => {
    fs.rmSync(plugin.dir, { recursive: true, force: true })
    fs.rmSync(catalog.dir, { recursive: true, force: true })
  })
  const addHermes = () =>
    updateCapabilities((d) => {
      d.marketplaces = [{ id: 'hermes', url: fileUrl(catalog.dir), label: 'Hermes Marketplace', kind: 'hermes' }]
    })

  it('fetches only the catalog folders and lists its plugins, skills and curated MCP servers', async () => {
    addHermes()
    const plugins = browsePlugins('')
    expect(plugins.map((p) => [p.name, p.tier, !!p.problem])).toEqual([
      ['Echo Pack', 'official', false],
      ['py-only', 'community', true], // Python hooks: Hermes-only
    ]) // the unpinned entry is skipped
    expect(browseSkills('').map((s) => s.name).sort()).toEqual(['arxiv', 'docker-management'])
    const cache = path.join(capabilitiesDir(), 'cache', 'hermes')
    expect(fs.existsSync(path.join(cache, 'agent'))).toBe(false) // sparse: only the catalog folders are fetched
    expect(hermesSkillPaths(cache)).toEqual(expect.arrayContaining(['skills/research/arxiv', 'optional-skills/devops/docker-management']))

    const mcps = await hermesMcpListing('')
    expect(mcps.map((m) => [m.title, m.problem ?? 'ok'])).toEqual([
      ['aws-knowledge', 'ok'],
      ['airtable', expect.stringMatching(/OAuth/)],
    ])
  })

  it('installs a portable plugin at its pinned commit; refuses Hermes-only plugins and OAuth servers', async () => {
    addHermes()
    const p = await installPlugin('plugin:hermes/echo-pack')
    expect(p).toMatchObject({ name: 'echo-pack', version: '2.0.0', origin: expect.stringContaining(`@ ${plugin.sha.slice(0, 7)}`) })
    expect(findSkill('echo-howto')).toMatchObject({ source: 'plugin' })
    expect(added).toEqual([expect.objectContaining({ label: 'echo-pack: echo', transport: 'http', url: 'https://echo.example/mcp', source: 'plugin' })])

    await expect(installPlugin('plugin:hermes/py-only')).rejects.toThrow(/Hermes-only/)
    await expect(installRef('hermes-mcp:airtable')).rejects.toThrow(/OAuth/)
    await installRef('hermes-mcp:aws-knowledge')
    expect(added.at(-1)).toMatchObject({ label: 'aws-knowledge', url: 'https://knowledge-mcp.global.api.aws' })
    await removePlugin(p.id)
  })

  it('installs a single Hermes skill from a nested category folder', () => {
    addHermes()
    expect(installMarketSkill('skill:hermes/optional-skills/devops/docker-management')).toBe('docker-management')
    expect(findSkill('docker-management')).toMatchObject({ source: 'own', origin: expect.stringMatching(/Hermes Marketplace/) })
  })
})
