import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'

// A fake projects folder:  <tmp>/Projects/{Hermione (agent root), BanditBeater, "My Game", deep/Inner}
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-ws-'))
const projects = path.join(base, 'Projects')
const hermione = path.join(projects, 'Hermione')
const bandit = path.join(projects, 'BanditBeater')
const spaced = path.join(projects, 'My Game')
const inner = path.join(projects, 'deep', 'Inner')
for (const d of [hermione, bandit, spaced, inner]) fs.mkdirSync(d, { recursive: true })
fs.writeFileSync(path.join(bandit, 'readme.md'), 'x')
process.env.AGENT_ROOT = hermione
const cfg = path.join(base, 'cfg')
process.env.HERMIONE_CONFIG_DIR = cfg

import { findFolderByName, parseFolderMention, recentWorkspaces, rememberWorkspace, suggestFolders, withWorkspace, workspaceProblem } from '@/lib/agent/workspace'
import { agentRoot, resolveInRoot } from '@/lib/agent/paths'

afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

describe('@ folder mentions', () => {
  it('reads absolute, quoted, relative and bare-name folders', () => {
    expect(parseFolderMention(`work on @${bandit} please`, cfg).folder).toBe(bandit)
    expect(parseFolderMention(`open @"${spaced}" and fix the bug`, cfg).folder).toBe(spaced)
    expect(parseFolderMention('look at @../BanditBeater.', cfg).folder).toBe(bandit) // relative to Hermione's folder; trailing "." ignored
    expect(parseFolderMention('let us fix @BanditBeater today', cfg).folder).toBe(bandit) // bare name, sibling project
    expect(parseFolderMention('and @inner too', cfg).folder).toBe(inner) // two levels down, any case
  })

  it('ignores emails and people, and reports path-like mentions that fail', () => {
    expect(parseFolderMention('mail me at me@example.com, cc @everyone', cfg)).toEqual({ folder: undefined, problems: [] })
    const missing = parseFolderMention(`use @${path.join(projects, 'Nope')}`, cfg)
    expect(missing.folder).toBeUndefined()
    expect(missing.problems[0]).toMatch(/does not exist|couldn't find/)
    expect(parseFolderMention(`@${path.join(bandit, 'readme.md')}`, cfg).problems[0]).toMatch(/is a file/)
  })

  it('refuses drives, the home folder, system folders and its own settings', () => {
    expect(workspaceProblem(path.parse(base).root)).toMatch(/whole drive/)
    expect(workspaceProblem(os.homedir())).toMatch(/too broad/)
    if (process.platform === 'win32') expect(workspaceProblem(process.env.SystemRoot || 'C:\\Windows')).toMatch(/system folder/)
    fs.mkdirSync(cfg, { recursive: true })
    expect(workspaceProblem(cfg, cfg)).toMatch(/settings folder/)
    expect(workspaceProblem(bandit, cfg)).toBeUndefined()
  })

  it('the last valid folder in a message wins', () => {
    expect(parseFolderMention(`compare @${bandit} with @"${spaced}"`, cfg).folder).toBe(spaced)
  })

  it('finds folders by name and suggests recent ones first', () => {
    expect(findFolderByName('banditbeater')).toBe(bandit)
    rememberWorkspace(cfg, spaced)
    expect(recentWorkspaces(cfg)).toEqual([spaced])
    const s = suggestFolders('', cfg)
    expect(s[0]).toMatchObject({ path: spaced, recent: true })
    expect(suggestFolders('bandit', cfg).map((x) => x.path)).toContain(bandit)
  })
})

describe('the session workspace becomes the root', () => {
  it('agentRoot and path resolution follow the workspace, and still refuse escapes', () => {
    expect(agentRoot()).toBe(hermione)
    withWorkspace(bandit, () => {
      expect(agentRoot()).toBe(bandit)
      expect(resolveInRoot('readme.md')).toBe(path.join(bandit, 'readme.md'))
      expect(() => resolveInRoot('../Hermione/secret.txt')).toThrow(/escapes agent root/)
    })
    expect(agentRoot()).toBe(hermione)
  })

  it('survives awaits (async tools see the same folder)', async () => {
    const seen = await withWorkspace(spaced, async () => {
      await new Promise((r) => setTimeout(r, 5))
      return agentRoot()
    })
    expect(seen).toBe(spaced)
  })
})
