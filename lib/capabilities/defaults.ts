import { addConnector } from './connectors'
import { claudeMarketplaces, DEFAULT_MARKETPLACES } from './marketplace'
import { loadCapabilities, updateCapabilities } from './store'

/**
 * Hermione's recommended capabilities.
 *
 * Installed by default, once (removing one later sticks):
 *   - starter skills shipped in capabilities/skills (research-brief,
 *     debug-systematically, code-review, project-onboarding, short-video-script)
 *   - Context7 and DeepWiki: free, hosted, read-only MCP servers (library docs,
 *     Q&A over GitHub repos) — no key, nothing installed locally
 *   - the open marketplaces (Anthropic's plugins + skills, and any Claude
 *     marketplaces you already use)
 *
 * Recommended, one click in Capabilities → Browse: the RECOMMENDED list.
 */

export interface Recommended {
  ref: string
  kind: 'connector' | 'skill'
  title: string
  why: string
  /** Installed on first run. */
  byDefault?: boolean
  connector?: {
    transport: 'stdio' | 'http'
    url?: string
    command?: string
    args?: string[]
    trustReadOnly?: boolean
    inputs?: { key: string; kind: 'env' | 'header'; description: string; template?: string; secret: boolean; required: boolean }[]
  }
}

export const RECOMMENDED: Recommended[] = [
  {
    ref: 'connector:context7',
    kind: 'connector',
    title: 'Context7',
    why: 'Up-to-date docs and code examples for libraries and frameworks — fewer outdated answers when coding.',
    byDefault: true,
    connector: { transport: 'http', url: 'https://mcp.context7.com/mcp', trustReadOnly: true },
  },
  {
    ref: 'connector:deepwiki',
    kind: 'connector',
    title: 'DeepWiki',
    why: 'Ask questions about any public GitHub repository and read its generated docs.',
    byDefault: true,
    connector: { transport: 'http', url: 'https://mcp.deepwiki.com/mcp', trustReadOnly: true },
  },
  {
    ref: 'connector:sequential-thinking',
    kind: 'connector',
    title: 'Sequential Thinking',
    why: 'A scratchpad for step-by-step reasoning on hard, multi-step problems (runs locally with npx).',
    connector: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], trustReadOnly: true },
  },
  {
    ref: 'connector:playwright',
    kind: 'connector',
    title: 'Playwright',
    why: 'Drive a real browser for end-to-end web testing (runs locally with npx; actions go to the judge).',
    connector: { transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'] },
  },
  {
    ref: 'connector:github',
    kind: 'connector',
    title: 'GitHub',
    why: "Issues, pull requests, code search and repos through GitHub's official MCP server.",
    connector: {
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      inputs: [{ key: 'Authorization', kind: 'header', description: 'A GitHub personal access token', template: 'Bearer {token}', secret: true, required: true }],
    },
  },
  { ref: 'skill:anthropic-skills/skills/frontend-design', kind: 'skill', title: 'frontend-design', why: 'Distinctive, production-grade web UI instead of generic-looking pages.' },
  { ref: 'skill:anthropic-skills/skills/mcp-builder', kind: 'skill', title: 'mcp-builder', why: 'Build your own MCP servers — new connectors for Hermione.' },
  { ref: 'skill:anthropic-skills/skills/skill-creator', kind: 'skill', title: 'skill-creator', why: 'Write and improve skills well (pairs with skill_propose).' },
  { ref: 'skill:anthropic-skills/skills/webapp-testing', kind: 'skill', title: 'webapp-testing', why: 'Test local web apps with Playwright scripts.' },
  { ref: 'skill:anthropic-skills/skills/doc-coauthoring', kind: 'skill', title: 'doc-coauthoring', why: 'A structured workflow for writing docs, proposals and specs together.' },
]

/** Add the defaults once: marketplaces and the default connectors. Never throws. */
export async function ensureDefaults(): Promise<void> {
  // Marketplaces added in later versions reach existing installs once.
  const caps0 = loadCapabilities()
  if (caps0.defaultsSeeded && !caps0.marketplaces.some((m) => m.id === 'hermes') && !caps0.seenMarketplaces?.includes('hermes')) {
    updateCapabilities((d) => {
      d.marketplaces.push(DEFAULT_MARKETPLACES.find((m) => m.id === 'hermes')!)
      d.seenMarketplaces = [...(d.seenMarketplaces ?? []), 'hermes']
    })
  }
  if (loadCapabilities().defaultsSeeded) return
  updateCapabilities((d) => {
    const have = new Set(d.marketplaces.map((m) => m.url.toLowerCase()))
    for (const m of DEFAULT_MARKETPLACES) if (!have.has(m.url.toLowerCase())) d.marketplaces.push(m), have.add(m.url.toLowerCase())
    for (const c of claudeMarketplaces()) {
      if (have.has(c.url.toLowerCase())) continue
      d.marketplaces.push({ id: c.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), url: c.url, label: c.label })
      have.add(c.url.toLowerCase())
    }
    d.defaultsSeeded = true
    d.seenMarketplaces = DEFAULT_MARKETPLACES.map((m) => m.id)
  })
  const existing = new Set(loadCapabilities().connectors.map((c) => c.url ?? c.command))
  for (const r of RECOMMENDED.filter((x) => x.byDefault && x.connector)) {
    const c = r.connector!
    if (existing.has(c.url ?? c.command)) continue
    await addConnector({ label: r.title, transport: c.transport, url: c.url, command: c.command, args: c.args, trustReadOnly: c.trustReadOnly, source: 'default' }).catch(() => {})
  }
}
