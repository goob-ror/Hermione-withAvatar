'use client'

import { useCallback, useEffect, useState } from 'react'
import { Blocks, Check, Download, Eye, FolderPlus, Lightbulb, Package, Pencil, Plug, Plus, RotateCw, Search, Sparkles, Trash2, Wrench, X } from 'lucide-react'

type Policy = 'default' | 'off' | 'ask' | 'judge'
interface Skill {
  name: string
  description: string
  dir: string
  source: 'own' | 'linked' | 'plugin' | 'proposed'
  origin?: string
  enabled: boolean
  files: string[]
  reason?: string
}
interface Tool {
  name: string
  description: string
  tier: 'auto' | 'confirm'
  source: 'builtin' | 'connector'
  connectorId?: string
  policy: Policy
  defaultPolicy: Policy
}
interface Connector {
  id: string
  label: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  enabled: boolean
  source: string
  pluginId?: string
  status: 'off' | 'starting' | 'ready' | 'failed'
  error?: string
  tools: string[]
}
interface Plugin {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  origin?: string
}
interface Suggestion {
  id: string
  kind: 'plugin' | 'connector'
  title: string
  source: string
  reason: string
}
interface Data {
  skills: Skill[]
  skillSources: string[]
  claudeSkills: { dir: string; exists: boolean; linked: boolean }
  tools: Tool[]
  connectors: Connector[]
  plugins: Plugin[]
  suggestions: Suggestion[]
}
interface ClaudeServer {
  name: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  needsEnv: string[]
}

async function api(method: string, body?: unknown, query = ''): Promise<any> {
  const res = await fetch(`/api/capabilities${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || (data.issues && data.issues.join('; ')) || `${res.status}`)
  return data
}

/** "npx -y @scope/pkg --flag 'a b'" → command + args. */
export function splitCommand(line: string): { command: string; args: string[] } {
  const parts = [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3])
  return { command: parts[0] ?? '', args: parts.slice(1) }
}

const POLICY_LABEL: Record<Policy, string> = { default: 'Default', off: 'Off', ask: 'Always ask', judge: 'Judge decides' }

/**
 * Capabilities: what Hermione can use beyond her built-in tools — skills
 * (instruction packs), connectors (MCP servers), plugins (bundles), and how
 * each tool is gated.
 */
export function Capabilities({ refreshKey = 0 }: { refreshKey?: number }) {
  const [tab, setTab] = useState<'skills' | 'tools' | 'connectors' | 'plugins'>('skills')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  const reload = useCallback(async () => {
    try {
      setData(await api('GET'))
      setError('')
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from the server on open
    void reload()
  }, [reload, refreshKey])

  // Connectors start in the background: refresh while any is starting.
  useEffect(() => {
    if (!data?.connectors.some((c) => c.status === 'starting')) return
    const t = setTimeout(() => void reload(), 2000)
    return () => clearTimeout(t)
  }, [data, reload])

  const act = async (body: unknown) => {
    try {
      setData(await api('POST', body))
      setError('')
      return true
    } catch (e: any) {
      setError(e.message)
      return false
    }
  }

  const pending = data?.skills.filter((s) => s.source === 'proposed').length ?? 0
  return (
    <section className="mb-page">
      <header className="mb-head">
        <div className="mb-title">
          <Blocks className="size-5" />
          <div>
            <h1>Capabilities</h1>
            <p>Skills, connectors and plugins Hermione can use, and how each tool is gated.</p>
          </div>
        </div>
        <div className="mb-search">
          <Search className="size-3.5" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} />
        </div>
      </header>

      <div className="mb-tabs" role="tablist">
        {(
          [
            ['skills', 'Skills', data?.skills.filter((s) => s.source !== 'proposed').length ?? 0],
            ['tools', 'Tools', data?.tools.length ?? 0],
            ['connectors', 'Connectors', data?.connectors.length ?? 0],
            ['plugins', 'Plugins', data?.plugins.length ?? 0],
          ] as const
        ).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            {label} <span>{n}</span>
            {id === 'skills' && pending > 0 && <span className="cap-badge">{pending} to review</span>}
          </button>
        ))}
      </div>

      {error && <div className="mb-error">⚠ {error}</div>}
      {data && data.suggestions.length > 0 && <Suggestions items={data.suggestions} act={act} />}
      {!data ? (
        <div className="mb-empty">Loading…</div>
      ) : tab === 'skills' ? (
        <SkillsPanel data={data} query={query} act={act} />
      ) : tab === 'tools' ? (
        <ToolsPanel data={data} query={query} act={act} />
      ) : tab === 'connectors' ? (
        <ConnectorsPanel data={data} query={query} act={act} />
      ) : (
        <PluginsPanel data={data} query={query} act={act} />
      )}
    </section>
  )
}

type Act = (body: unknown) => Promise<boolean>
const match = (q: string, ...s: (string | undefined)[]) => !q.trim() || s.some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()))

function Suggestions({ items, act }: { items: Suggestion[]; act: Act }) {
  const install = (s: Suggestion) => {
    if (s.kind === 'plugin') return act({ action: 'plugin.install', source: s.source })
    if (/^https?:\/\//i.test(s.source)) return act({ action: 'connector.add', label: s.title, transport: 'http', url: s.source })
    const { command, args } = splitCommand(s.source)
    return act({ action: 'connector.add', label: s.title, transport: 'stdio', command, args })
  }
  return (
    <div className="cap-suggestions">
      {items.map((s) => (
        <div key={s.id} className="cap-suggestion">
          <Lightbulb className="size-4 flex-none" />
          <div>
            <strong>
              Hermione suggests the {s.kind} “{s.title}”
            </strong>
            <span>{s.reason}</span>
            <code>{s.source}</code>
          </div>
          <div className="mb-actions">
            <button type="button" className="is-on" onClick={() => void install(s).then((ok) => ok && act({ action: 'suggestion.dismiss', id: s.id }))}>
              <Download className="size-3.5" /> Install
            </button>
            <button type="button" onClick={() => void act({ action: 'suggestion.dismiss', id: s.id })}>
              <X className="size-3.5" /> Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------------- Skills ---------------- */

function SkillsPanel({ data, query, act }: { data: Data; query: string; act: Act }) {
  const [view, setView] = useState<{ name: string; body: string } | null>(null)
  const [edit, setEdit] = useState<{ name: string; description: string; body: string; isNew: boolean } | null>(null)
  const [sourceDir, setSourceDir] = useState('')

  const open = async (name: string) => {
    if (view?.name === name) return setView(null)
    try {
      const d = await api('GET', undefined, `?skill=${encodeURIComponent(name)}`)
      setView({ name, body: d.body })
    } catch {
      /* ignore */
    }
  }
  const startEdit = async (s: Skill) => {
    const d = await api('GET', undefined, `?skill=${encodeURIComponent(s.name)}`)
    setEdit({ name: s.name, description: s.description, body: d.body, isNew: false })
  }

  const proposed = data.skills.filter((s) => s.source === 'proposed')
  const active = data.skills.filter((s) => s.source !== 'proposed' && match(query, s.name, s.description))

  const row = (s: Skill) => (
    <div key={`${s.source}-${s.name}`} className={`cap-row ${s.source === 'proposed' ? 'is-proposed' : ''} ${!s.enabled && s.source !== 'proposed' ? 'is-off' : ''}`}>
      <div className="cap-main">
        <div className="cap-name">
          <Sparkles className="size-3.5" /> <strong>{s.name}</strong>
          <span className={`cap-src cap-src-${s.source}`}>{s.source === 'own' ? 'Hermione' : s.source === 'linked' ? 'linked' : s.source === 'plugin' ? `plugin: ${s.origin}` : 'proposed'}</span>
          {s.files.length > 0 && <span className="mb-meta">{s.files.length} files</span>}
        </div>
        <p>{s.description || <em>no description</em>}</p>
        {s.reason && <p className="mb-meta">Why: {s.reason}</p>}
        {view?.name === s.name && <pre className="cap-body">{view.body}</pre>}
      </div>
      <div className="mb-actions">
        <button type="button" onClick={() => void open(s.name)} title="View instructions">
          <Eye className="size-3.5" />
        </button>
        {s.source === 'proposed' ? (
          <>
            <button type="button" className="is-on" onClick={() => void act({ action: 'skill.approve', name: s.name })}>
              <Check className="size-3.5" /> Approve
            </button>
            <button type="button" onClick={() => void act({ action: 'skill.reject', name: s.name })}>
              <X className="size-3.5" /> Reject
            </button>
          </>
        ) : (
          <>
            {s.source === 'own' && (
              <>
                <button type="button" onClick={() => void startEdit(s)} title="Edit">
                  <Pencil className="size-3.5" />
                </button>
                <button type="button" onClick={() => window.confirm(`Delete the skill "${s.name}"?`) && void act({ action: 'skill.delete', name: s.name })} title="Delete">
                  <Trash2 className="size-3.5" />
                </button>
              </>
            )}
            <Toggle on={s.enabled} onChange={(v) => void act({ action: 'skill.toggle', name: s.name, enabled: v })} label={`Use ${s.name}`} />
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="mb-panel">
      <div className="cap-toolbar">
        <button type="button" className="mb-primary" onClick={() => setEdit({ name: '', description: '', body: '', isNew: true })}>
          <Plus className="size-3.5" /> New skill
        </button>
        {data.claudeSkills.exists && !data.claudeSkills.linked && (
          <button type="button" className="mb-primary" onClick={() => void act({ action: 'source.claude' })} title={data.claudeSkills.dir}>
            <Download className="size-3.5" /> Use my Claude skills
          </button>
        )}
        <form
          className="cap-inline"
          onSubmit={(e) => {
            e.preventDefault()
            if (sourceDir.trim()) void act({ action: 'source.add', dir: sourceDir.trim() }).then((ok) => ok && setSourceDir(''))
          }}
        >
          <input value={sourceDir} onChange={(e) => setSourceDir(e.target.value)} placeholder="Link a skills folder, e.g. C:\path\to\skills" aria-label="Skills folder" />
          <button type="submit" disabled={!sourceDir.trim()}>
            <FolderPlus className="size-3.5" /> Link
          </button>
        </form>
      </div>

      {edit && (
        <form
          className="cap-editor"
          onSubmit={(e) => {
            e.preventDefault()
            void act({ action: 'skill.save', name: edit.name.trim(), description: edit.description, body: edit.body }).then((ok) => ok && setEdit(null))
          }}
        >
          <input value={edit.name} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="skill-name" aria-label="Skill name" />
          <input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="When to use it, in one sentence" aria-label="Description" />
          <textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="Instructions (Markdown): steps, checks, pitfalls…" aria-label="Instructions" />
          <div className="mb-note-actions">
            <button type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <button type="submit" className="mb-primary" disabled={!edit.name || !edit.description.trim() || !edit.body.trim()}>
              <Check className="size-3.5" /> Save skill
            </button>
          </div>
        </form>
      )}

      {proposed.length > 0 && <div className="mb-lesson-group">Proposed by Hermione — inactive until you approve</div>}
      {proposed.map(row)}
      <div className="mb-lesson-group">Skills ({active.length})</div>
      {active.length ? active.map(row) : <div className="mb-empty">No skills yet. Write one, link a folder, or use your Claude skills.</div>}
      {data.skillSources.length > 0 && (
        <>
          <div className="mb-lesson-group">Linked folders</div>
          {data.skillSources.map((d) => (
            <div key={d} className="cap-row">
              <code className="cap-path">{d}</code>
              <div className="mb-actions">
                <button type="button" onClick={() => void act({ action: 'source.remove', dir: d })} title="Unlink">
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/* ---------------- Tools ---------------- */

function ToolsPanel({ data, query, act }: { data: Data; query: string; act: Act }) {
  const groups: [string, Tool[]][] = [
    ['Built-in', data.tools.filter((t) => t.source === 'builtin')],
    ...data.connectors.map((c) => [c.label, data.tools.filter((t) => t.connectorId === c.id)] as [string, Tool[]]),
  ]
  const defaultText = (t: Tool) =>
    t.defaultPolicy === 'judge' ? 'Default: judge decides' : t.tier === 'auto' ? 'Default: runs (read-only)' : 'Default: follows Permissions'
  return (
    <div className="mb-panel">
      <p className="mb-meta cap-intro">
        Read-only tools run without asking. Tools that change things follow your Permissions mode — or set one to <strong>Judge decides</strong> (the judge model
        approves clear, low-risk calls; you’re asked only when it’s unsure), <strong>Always ask</strong>, or <strong>Off</strong>. Hard limits always apply.
      </p>
      {groups.map(([label, tools]) => {
        const shown = tools.filter((t) => match(query, t.name, t.description))
        if (!shown.length) return null
        return (
          <div key={label}>
            <div className="mb-lesson-group">{label}</div>
            {shown.map((t) => (
              <div key={t.name} className={`cap-row ${t.policy === 'off' ? 'is-off' : ''}`}>
                <div className="cap-main">
                  <div className="cap-name">
                    <Wrench className="size-3.5" /> <code>{t.name}</code>
                  </div>
                  <p className="cap-desc">{t.description}</p>
                </div>
                <select value={t.policy} onChange={(e) => void act({ action: 'tool.policy', name: t.name, policy: e.target.value })} aria-label={`${t.name} policy`} title={defaultText(t)}>
                  {(['default', 'judge', 'ask', 'off'] as Policy[]).map((p) => (
                    <option key={p} value={p}>
                      {p === 'default' ? defaultText(t) : POLICY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Connectors ---------------- */

function ConnectorsPanel({ data, query, act }: { data: Data; query: string; act: Act }) {
  const [form, setForm] = useState({ label: '', transport: 'stdio' as 'stdio' | 'http', line: '' })
  const [claude, setClaude] = useState<{ servers: ClaudeServer[]; picked: Set<string> } | null>(null)

  const add = () => {
    const body =
      form.transport === 'http'
        ? { action: 'connector.add', label: form.label.trim(), transport: 'http', url: form.line.trim() }
        : { action: 'connector.add', label: form.label.trim(), transport: 'stdio', ...splitCommand(form.line.trim()) }
    void act(body).then((ok) => ok && setForm({ label: '', transport: form.transport, line: '' }))
  }
  const loadClaude = async () => {
    const d = await api('GET', undefined, '?claudeConnectors=1')
    setClaude({ servers: d.servers, picked: new Set() })
  }

  const list = data.connectors.filter((c) => match(query, c.label, c.command, c.url))
  return (
    <div className="mb-panel">
      <form
        className="cap-editor cap-connector-form"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Name, e.g. Playwright" aria-label="Connector name" />
        <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })} aria-label="Type">
          <option value="stdio">Local command</option>
          <option value="http">HTTP URL</option>
        </select>
        <input
          value={form.line}
          onChange={(e) => setForm({ ...form, line: e.target.value })}
          placeholder={form.transport === 'http' ? 'https://example.com/mcp' : 'npx -y @playwright/mcp@latest'}
          aria-label="Command or URL"
        />
        <button type="submit" className="mb-primary" disabled={!form.label.trim() || !form.line.trim()}>
          <Plug className="size-3.5" /> Add
        </button>
        <button type="button" className="mb-primary" onClick={() => void loadClaude()}>
          <Download className="size-3.5" /> From Claude…
        </button>
      </form>

      {claude && (
        <div className="cap-claude">
          <div className="mb-lesson-group">MCP servers in your Claude plugins — pick the ones to add</div>
          <div className="cap-claude-list">
            {claude.servers.map((s) => (
              <label key={s.name} className="cap-check">
                <input
                  type="checkbox"
                  checked={claude.picked.has(s.name)}
                  onChange={(e) => {
                    const picked = new Set(claude.picked)
                    if (e.target.checked) picked.add(s.name)
                    else picked.delete(s.name)
                    setClaude({ ...claude, picked })
                  }}
                />
                <strong>{s.name}</strong>
                <code>{s.transport === 'http' ? s.url : `${s.command} ${(s.args ?? []).join(' ')}`}</code>
              </label>
            ))}
          </div>
          <div className="mb-note-actions">
            <span className="mb-meta">Remote servers that need a sign-in (OAuth) won’t connect yet.</span>
            <button type="button" onClick={() => setClaude(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="mb-primary"
              disabled={!claude.picked.size}
              onClick={() => void act({ action: 'connector.claude', names: [...claude.picked] }).then((ok) => ok && setClaude(null))}
            >
              <Check className="size-3.5" /> Add {claude.picked.size || ''}
            </button>
          </div>
        </div>
      )}

      {list.length ? (
        list.map((c) => (
          <div key={c.id} className={`cap-row ${c.enabled ? '' : 'is-off'}`}>
            <div className="cap-main">
              <div className="cap-name">
                <Plug className="size-3.5" /> <strong>{c.label}</strong>
                <span className={`cap-status is-${c.status}`}>{c.status === 'ready' ? `${c.tools.length} tools` : c.status}</span>
                {c.source !== 'you' && <span className="cap-src">{c.source === 'plugin' ? 'plugin' : 'from Claude'}</span>}
              </div>
              <code className="cap-path">{c.transport === 'http' ? c.url : `${c.command} ${(c.args ?? []).join(' ')}`}</code>
              {c.error && <p className="cap-error">{c.error}</p>}
            </div>
            <div className="mb-actions">
              <button type="button" onClick={() => void act({ action: 'connector.restart', id: c.id })} title="Restart" disabled={!c.enabled}>
                <RotateCw className="size-3.5" />
              </button>
              {!c.pluginId && (
                <button type="button" onClick={() => window.confirm(`Remove the connector "${c.label}"?`) && void act({ action: 'connector.remove', id: c.id })} title="Remove">
                  <Trash2 className="size-3.5" />
                </button>
              )}
              <Toggle on={c.enabled} onChange={(v) => void act({ action: 'connector.toggle', id: c.id, enabled: v })} label={`Use ${c.label}`} />
            </div>
          </div>
        ))
      ) : (
        <div className="mb-empty">No connectors. Add an MCP server by command or URL, or pick some from your Claude plugins.</div>
      )}
    </div>
  )
}

/* ---------------- Plugins ---------------- */

function PluginsPanel({ data, query, act }: { data: Data; query: string; act: Act }) {
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const list = data.plugins.filter((p) => match(query, p.name, p.description))
  return (
    <div className="mb-panel">
      <form
        className="mb-add"
        onSubmit={(e) => {
          e.preventDefault()
          setBusy(true)
          void act({ action: 'plugin.install', source: source.trim() }).then((ok) => {
            setBusy(false)
            if (ok) setSource('')
          })
        }}
      >
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="A plugin folder, a Git URL, or owner/repo on GitHub" aria-label="Plugin source" />
        <button type="submit" className="mb-primary" disabled={!source.trim() || busy}>
          <Package className="size-3.5" /> {busy ? 'Installing…' : 'Install'}
        </button>
      </form>
      <p className="mb-meta cap-intro">A plugin bundles skills (skills/…/SKILL.md) and MCP servers (.mcp.json). Claude plugins work as they are.</p>
      {list.length ? (
        list.map((p) => (
          <div key={p.id} className={`cap-row ${p.enabled ? '' : 'is-off'}`}>
            <div className="cap-main">
              <div className="cap-name">
                <Package className="size-3.5" /> <strong>{p.name}</strong>
                {p.version && <span className="mb-meta">v{p.version}</span>}
              </div>
              {p.description && <p>{p.description}</p>}
              {p.origin && <code className="cap-path">{p.origin}</code>}
            </div>
            <div className="mb-actions">
              <button type="button" onClick={() => window.confirm(`Remove the plugin "${p.name}" and its connectors?`) && void act({ action: 'plugin.remove', id: p.id })} title="Remove">
                <Trash2 className="size-3.5" />
              </button>
              <Toggle on={p.enabled} onChange={(v) => void act({ action: 'plugin.toggle', id: p.id, enabled: v })} label={`Use ${p.name}`} />
            </div>
          </div>
        ))
      ) : (
        <div className="mb-empty">No plugins installed.</div>
      )}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`cap-toggle ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  )
}
