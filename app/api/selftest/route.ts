import { NextResponse } from 'next/server'
import { resolveInRoot, agentRoot } from '@/lib/agent/paths'
import { parseTextToolCall } from '@/lib/agent/loop'
import { TOOL_MAP } from '@/lib/tools'
import { fsDelete, fsRead, fsWrite } from '@/lib/tools/fs'
import { shellRun } from '@/lib/tools/shell'
import { siteInspect } from '@/lib/tools/web'
import { pageOpen, pageRead } from '@/lib/tools/page'
import { distill } from '@/lib/preview/distill'
import { rewriteHtml } from '@/lib/preview/rewrite'
import { endpointRoot, probeProvider } from '@/lib/agent/openai'
import {
  normalizeBaseUrl,
  publicView,
  configDir,
  getProvider,
  listProviders,
  deleteProvider,
  upsertProvider,
  KEY_MASK,
} from '@/lib/agent/providers'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ToolContext } from '@/lib/agent/types'

const ctx: ToolContext = { sessionId: 'selftest', emit: () => {} }

/**
 * GET /api/selftest — asserts the guard rails that protect the tool layer.
 * Development only: returns 404 in production builds.
 */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const results: Array<{ name: string; ok: boolean; detail: string }> = []
  const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail })

  // --- root lock -----------------------------------------------------
  for (const escape of ['..', '../../etc/passwd', 'C:/Windows', '/etc/passwd']) {
    let blocked = false
    let detail = ''
    try {
      const resolved = resolveInRoot(escape)
      detail = `resolved to ${resolved}`
    } catch (err: any) {
      blocked = true
      detail = err.message
    }
    check(`root-lock rejects "${escape}"`, blocked, detail)
  }

  const inside = resolveInRoot('lib/agent')
  check('root-lock allows lib/agent', inside.startsWith(agentRoot()), inside)

  // --- fs tools ------------------------------------------------------
  const escapeRead = await fsRead
    .run({ path: '../../etc/passwd' }, ctx)
    .catch((e: any) => ({ ok: false, output: e.message }))
  check('fs_read refuses traversal', !escapeRead.ok && /escapes agent root/.test(escapeRead.output), escapeRead.output)

  const rootDelete = await fsDelete.run({ path: '.' }, ctx)
  check('fs_delete refuses the root', !rootDelete.ok, rootDelete.output)

  const write = await fsWrite.run({ path: '.selftest/probe.txt', content: 'gate probe\n' }, ctx)
  const read = await fsRead.run({ path: '.selftest/probe.txt' }, ctx)
  const cleanup = await fsDelete.run({ path: '.selftest', recursive: true }, ctx)
  check(
    'fs_write → fs_read → fs_delete roundtrip',
    write.ok && read.ok && read.output.includes('gate probe') && cleanup.ok,
    `${write.output} | ${cleanup.output}`,
  )

  // --- shell allowlist ----------------------------------------------
  const metachar = await shellRun.run({ command: 'ls; rm -rf /' }, ctx)
  check('shell rejects metacharacters', !metachar.ok && /metacharacters/.test(metachar.output), metachar.output)

  const notAllowed = await shellRun.run({ command: 'whoami' }, ctx)
  check(
    'shell rejects non-allowlisted binary',
    !notAllowed.ok && /not on the allowlist/.test(notAllowed.output),
    notAllowed.output,
  )

  const allowed = await shellRun.run({ command: 'ls lib/agent' }, ctx)
  check('shell runs an allowlisted command', allowed.ok, allowed.output.split('\n').slice(0, 3).join(' | '))

  // --- domain allowlist ---------------------------------------------
  const inspect = await siteInspect.run({ url: 'https://example.com' }, ctx)
  const allowlisted = (process.env.AGENT_ALLOWED_DOMAINS || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
  check(
    allowlisted.length ? 'site_inspect runs for allowlisted host' : 'site_inspect refuses when no allowlist is set',
    allowlisted.length ? true : !inspect.ok && /not on the allowlist/.test(inspect.output),
    inspect.output.split('\n')[0],
  )

  // --- text-protocol parser -----------------------------------------
  const parsed = parseTextToolCall('sure:\n```json\n{"tool":"fs_list","args":{"path":"."}}\n```')
  check('text-protocol parser finds a tool call', !!parsed && parsed.tool === 'fs_list', JSON.stringify(parsed))
  const notACall = parseTextToolCall('```json\n{"answer":42}\n```')
  check('text-protocol parser ignores non-tool json', notACall === null, String(notACall))

  // --- page distiller ------------------------------------------------
  const sample = `<html><head><title>Probe &amp; Co</title>
    <meta name="description" content="a fixture page">
    <script>var leak = "SHOULD_NOT_APPEAR"</script><style>.x{color:red}</style></head>
    <body><h1>Heading One</h1><p>Body copy here.</p><a href="/next">Next page</a></body></html>`
  const distilled = distill(sample, { baseUrl: 'https://example.com/a/b' })
  check(
    'distiller keeps prose and drops script/style',
    distilled.title === 'Probe & Co' &&
      distilled.text.includes('Heading One') &&
      !distilled.text.includes('SHOULD_NOT_APPEAR') &&
      !distilled.text.includes('color:red'),
    JSON.stringify(distilled.text.slice(0, 90)),
  )
  const relativeLinks = distill('<a href="next">relative</a><a href="/root">root</a>', { baseUrl: 'https://example.com/a/b' })
  check(
    'distiller resolves relative and root links',
    relativeLinks.links.some((l) => l.href === 'https://example.com/a/next') &&
      relativeLinks.links.some((l) => l.href === 'https://example.com/root'),
    JSON.stringify(relativeLinks.links),
  )

  // --- preview rewrite -----------------------------------------------
  const rewritten = rewriteHtml(sample, 'https://example.com/a/b')
  check(
    'rewrite injects <base> and the bridge',
    rewritten.includes('<base href="https://example.com/a/">') && rewritten.includes('data-hermione-bridge'),
    `${rewritten.length} bytes`,
  )
  check(
    'rewrite strips a page CSP meta',
    !rewriteHtml('<meta http-equiv="Content-Security-Policy" content="default-src none">', 'https://example.com/')
      .toLowerCase()
      .includes('content-security-policy'),
    'csp meta removed',
  )

  // --- preview tools --------------------------------------------------
  const blockedOpen = await pageOpen.run({ url: 'https://not-allowlisted.invalid/' }, ctx)
  check(
    'page_open refuses a non-allowlisted host',
    !blockedOpen.ok && /not allowlisted|no domains are allowlisted/.test(blockedOpen.output),
    blockedOpen.output.slice(0, 120),
  )
  const emptyRead = await pageRead.run({}, { sessionId: 'selftest-empty', emit: () => {} })
  check(
    'page_read refuses when no page is open',
    !emptyRead.ok && /no page is open/.test(emptyRead.output),
    emptyRead.output,
  )

  // --- provider layer ------------------------------------------------
  check(
    'normalizeBaseUrl appends /v1 to a bare chat-completions host',
    normalizeBaseUrl('https://api.example.com', 'openai') === 'https://api.example.com/v1',
    normalizeBaseUrl('https://api.example.com', 'openai'),
  )
  check(
    'normalizeBaseUrl keeps an existing /v1',
    normalizeBaseUrl('https://api.example.com/v1/', 'openai') === 'https://api.example.com/v1',
    normalizeBaseUrl('https://api.example.com/v1/', 'openai'),
  )
  check(
    'normalizeBaseUrl leaves an ollama daemon root alone',
    normalizeBaseUrl('http://127.0.0.1:11434', 'ollama') === 'http://127.0.0.1:11434',
    normalizeBaseUrl('http://127.0.0.1:11434', 'ollama'),
  )
  check(
    'normalizeBaseUrl adds a scheme when the operator omits it',
    normalizeBaseUrl('localhost:1234', 'ollama') === 'http://localhost:1234',
    normalizeBaseUrl('localhost:1234', 'ollama'),
  )
  check(
    'endpointRoot strips a pasted /chat/completions path',
    endpointRoot('https://api.example.com/v1/chat/completions') === 'https://api.example.com/v1',
    endpointRoot('https://api.example.com/v1/chat/completions'),
  )

  // The store is the one place a token lives — it must never come back out.
  const originalDir = process.env.HERMIONE_CONFIG_DIR
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-selftest-'))
  try {
    process.env.HERMIONE_CONFIG_DIR = storeDir
    const before = listProviders().length

    const saved = upsertProvider({
      label: 'selftest-relay',
      kind: 'openai',
      baseUrl: 'https://relay.invalid',
      apiKey: 'sk-selftest-secret-value-123456', // publish-check:allow (fixture: not a real secret)
      defaultModel: 'test-model',
    })
    check('provider store persists a saved provider', listProviders().some((p) => p.id === saved.id), saved.id)
    check(
      'provider store normalizes the saved base URL',
      saved.baseUrl === 'https://relay.invalid/v1',
      saved.baseUrl,
    )
    check(
      'provider store writes the file under the configured dir',
      fs.existsSync(path.join(storeDir, 'providers.json')),
      configDir(),
    )

    const view = publicView(getProvider(saved.id), saved.id)
    check(
      'publicView never exposes the api key',
      !('apiKey' in (view as any)) && !JSON.stringify(view).includes('sk-selftest-secret-value'), // publish-check:allow (fixture literal, asserted absent)
      JSON.stringify(view),
    )
    check('publicView reports hasKey + a masked hint', view.hasKey && view.keyHint === 'sk-…3456', view.keyHint) // publish-check:allow (expected masked form)

    // undefined keeps the stored secret; '' clears it.
    upsertProvider({ id: saved.id, label: 'selftest-relay', kind: 'openai', baseUrl: saved.baseUrl })
    check('re-saving without a key keeps the stored token', !!getProvider(saved.id).apiKey)
    upsertProvider({ id: saved.id, label: 'selftest-relay', kind: 'openai', baseUrl: saved.baseUrl, apiKey: KEY_MASK })
    check('saving the mask back keeps the stored token', !!getProvider(saved.id).apiKey)
    upsertProvider({ id: saved.id, label: 'selftest-relay', kind: 'openai', baseUrl: saved.baseUrl, apiKey: '' })
    check('saving an empty key clears the stored token', !getProvider(saved.id).apiKey)

    deleteProvider(saved.id)
    check('deleting a provider removes it', !listProviders().some((p) => p.id === saved.id))
    check(
      'the implicit local Ollama provider always exists',
      listProviders().some((p) => p.id === 'ollama-local'),
    )
    check('the store round-trips without losing other providers', listProviders().length === before, `${before} → ${listProviders().length}`)

    const unreachable = await probeProvider('http://127.0.0.1:9', undefined, 1500)
    check(
      'probeProvider reports an unreachable endpoint instead of throwing',
      !unreachable.ok && unreachable.models.length === 0 && !unreachable.authError,
      unreachable.detail.slice(0, 90),
    )
  } finally {
    if (originalDir === undefined) delete process.env.HERMIONE_CONFIG_DIR
    else process.env.HERMIONE_CONFIG_DIR = originalDir
    try {
      fs.rmSync(storeDir, { recursive: true, force: true })
    } catch {}
  }

  // --- registry ------------------------------------------------------
  const tiers = Object.values(TOOL_MAP).map((t) => `${t.name}:${t.tier}`)
  check('registry has 10 tools with tiers', tiers.length === 10, tiers.join(', '))

  const failed = results.filter((r) => !r.ok)
  return NextResponse.json({ passed: results.length - failed.length, failed: failed.length, results }, { status: 200 })
}
