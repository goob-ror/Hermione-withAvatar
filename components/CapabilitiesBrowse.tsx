'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Download, ExternalLink, Globe, Package, Plug, Plus, RefreshCw, Sparkles, Star, Trash2 } from 'lucide-react'

type View = 'recommended' | 'mcp' | 'plugins' | 'skills' | 'marketplaces'
interface Input {
  key: string
  kind: 'env' | 'header'
  description?: string
  required: boolean
  secret: boolean
}
interface Item {
  ref: string
  title: string
  description: string
  meta?: string
  link?: string
  installed: boolean
  inputs: Input[]
  problem?: string
  kind: 'connector' | 'plugin' | 'skill'
}

async function market(method: string, body?: unknown, query = ''): Promise<any> {
  const res = await fetch(`/api/capabilities/market${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || (data.issues && data.issues.join('; ')) || `${res.status}`)
  return data
}

/** Normalize the three listings into one card shape. */
function toItems(view: View, d: any): Item[] {
  if (view === 'recommended')
    return (d.items ?? []).map((r: any) => ({ ref: r.ref, title: r.title, description: r.why, meta: r.kind === 'skill' ? 'skill · Anthropic skills' : `connector${r.byDefault ? ' · installed by default' : ''}`, installed: r.installed, inputs: r.inputs ?? [], kind: r.kind }))
  if (view === 'mcp')
    return (d.servers ?? []).map((s: any) => ({
      ref: s.ref,
      title: s.title || s.name.split('/').pop(),
      description: s.description,
      meta: [s.name, s.plan?.via, s.version && `v${s.version}`].filter(Boolean).join(' · '),
      link: s.website || s.repository,
      installed: s.installed,
      inputs: s.plan?.inputs ?? [],
      problem: s.problem,
      kind: 'connector',
    }))
  if (view === 'plugins')
    return (d.items ?? []).map((p: any) => ({
      ref: p.ref,
      title: p.name,
      description: p.description,
      meta: [p.marketplace, p.tier, p.category, p.skills ? `${p.skills.length} skills` : ''].filter(Boolean).join(' · '),
      installed: p.installed,
      inputs: [],
      problem: p.problem,
      kind: 'plugin',
    }))
  return (d.items ?? []).map((s: any) => ({ ref: s.ref, title: s.name, description: s.description, meta: s.marketplace, installed: s.installed, inputs: [], kind: 'skill' }))
}

/**
 * Capabilities → Browse: the open agent marketplaces — the official MCP
 * Registry, Claude plugin marketplaces and skill repos — plus Hermione's
 * curated recommendations. Install is one click (a form when a key is needed).
 */
export function CapabilitiesBrowse({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<View>('recommended')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [form, setForm] = useState<{ ref: string; values: Record<string, string> } | null>(null)
  const [busy, setBusy] = useState('')
  const [markets, setMarkets] = useState<{ id: string; label: string; url: string; builtin?: boolean }[]>([])
  const [repo, setRepo] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (more = false) => {
      setLoading(true)
      try {
        if (view === 'marketplaces') {
          setMarkets((await market('GET', undefined, '?kind=marketplaces')).marketplaces)
          return
        }
        const query = `?kind=${view}&q=${encodeURIComponent(q)}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        const d = await market('GET', undefined, query)
        const next = toItems(view, d)
        setItems((prev) => (more ? [...prev, ...next] : next))
        setCursor(d.nextCursor)
        setErrors(d.errors ?? [])
        setNote('')
      } catch (e: any) {
        setNote(`⚠ ${e.message}`)
      } finally {
        setLoading(false)
      }
    },
    [view, q, cursor],
  )

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(false), view === 'recommended' || view === 'marketplaces' ? 0 : 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, q])

  const install = async (item: Item, values?: Record<string, string>) => {
    const needs = item.inputs.filter((i) => i.required)
    if (needs.length && !values) return setForm({ ref: item.ref, values: {} })
    setBusy(item.ref)
    try {
      const d = await market('POST', { action: 'install', ref: item.ref, inputs: values ?? {} })
      setNote(`✓ ${d.message}`)
      setForm(null)
      onChanged()
      await load(false)
    } catch (e: any) {
      setNote(`⚠ ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  const refresh = async () => {
    setBusy('refresh')
    try {
      const d = await market('POST', { action: 'refresh' })
      setNote(`✓ ${d.message}`)
      setErrors(d.errors ?? [])
      await load(false)
    } catch (e: any) {
      setNote(`⚠ ${e.message}`)
    } finally {
      setBusy('')
    }
  }

  const VIEWS: [View, string, typeof Star][] = [
    ['recommended', 'Recommended', Star],
    ['mcp', 'MCP servers', Plug],
    ['plugins', 'Plugins', Package],
    ['skills', 'Skills', Sparkles],
    ['marketplaces', 'Marketplaces', Globe],
  ]

  return (
    <div className="mb-panel">
      <div className="cap-toolbar">
        <div className="mb-filters" style={{ margin: 0 }}>
          {VIEWS.map(([id, label, Icon]) => (
            <button key={id} type="button" className={view === id ? 'is-on' : ''} onClick={() => setView(id)}>
              <Icon className="inline size-3 mr-1" />
              {label}
            </button>
          ))}
        </div>
        {view !== 'recommended' && view !== 'marketplaces' && (
          <div className="cap-inline">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view === 'mcp' ? 'Search the MCP Registry, e.g. postgres, figma, notion' : `Search ${view}`} aria-label="Search the marketplace" />
          </div>
        )}
        {(view === 'plugins' || view === 'skills' || view === 'marketplaces') && (
          <button type="button" className="mb-primary" onClick={() => void refresh()} disabled={busy === 'refresh'} title="Fetch the latest from every marketplace">
            <RefreshCw className={`size-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> Refresh
          </button>
        )}
      </div>

      <p className="mb-meta cap-intro">
        {view === 'recommended'
          ? 'Hand-picked for Hermione. Context7 and DeepWiki are free, read-only and installed by default.'
          : view === 'mcp'
            ? 'Hermes-curated servers first, then the official MCP Registry. Hosted servers connect directly; packages run locally (npx / uvx). Read-only tools run freely, the rest go to the judge.'
            : view === 'marketplaces'
              ? 'Open Git repos in the Claude marketplace format. Plugins and skills from all of them appear under Plugins and Skills.'
              : 'From the Hermes Marketplace and the Claude plugin marketplaces (cached Git clones, refreshed daily). Hermes plugins install at their reviewed, pinned commit. Installing copies files into Hermione — nothing runs at install time.'}
      </p>
      {note && <div className={note.startsWith('✓') ? 'cap-ok' : 'mb-error'}>{note}</div>}
      {errors.map((e) => (
        <div key={e} className="mb-error">
          ⚠ {e}
        </div>
      ))}

      {view === 'marketplaces' ? (
        <>
          <form
            className="cap-inline"
            onSubmit={(e) => {
              e.preventDefault()
              setBusy('add')
              void market('POST', { action: 'marketplace.add', repo: repo.trim() })
                .then((d) => {
                  setNote(`✓ ${d.message}`)
                  setRepo('')
                  return load(false)
                })
                .catch((err) => setNote(`⚠ ${err.message}`))
                .finally(() => setBusy(''))
            }}
          >
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="Add a marketplace: owner/repo or a Git URL" aria-label="Marketplace repo" />
            <button type="submit" disabled={!repo.trim() || busy === 'add'}>
              <Plus className="size-3.5" /> {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
          </form>
          {markets.map((m) => (
            <div key={m.id} className="cap-row">
              <div className="cap-main">
                <div className="cap-name">
                  <Globe className="size-3.5" /> <strong>{m.label}</strong>
                  {m.builtin && <span className="cap-src">default</span>}
                </div>
                <code className="cap-path">{m.url}</code>
              </div>
              <div className="mb-actions">
                <button type="button" title="Remove" onClick={() => void market('POST', { action: 'marketplace.remove', id: m.id }).then(() => load(false))}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </>
      ) : loading && !items.length ? (
        <div className="mb-empty">{view === 'plugins' || view === 'skills' ? 'Loading the marketplaces (the first time clones them, ~10 s)…' : 'Loading…'}</div>
      ) : items.length ? (
        <div className="cap-grid">
          {items.map((it) => (
            <div key={it.ref} className={`cap-card ${it.installed ? 'is-installed' : ''}`}>
              <div className="cap-name">
                {it.kind === 'skill' ? <Sparkles className="size-3.5" /> : it.kind === 'plugin' ? <Package className="size-3.5" /> : <Plug className="size-3.5" />}
                <strong>{it.title}</strong>
                {it.link && (
                  <a href={it.link} target="_blank" rel="noreferrer noopener" title="Website / repository">
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <p className="cap-desc">{it.description}</p>
              {it.meta && <span className="cap-path">{it.meta}</span>}
              {it.problem && <span className="cap-error">{it.problem}</span>}
              {form?.ref === it.ref ? (
                <form
                  className="cap-keys"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void install(it, form.values)
                  }}
                >
                  {it.inputs.map((i) => (
                    <label key={i.key}>
                      <span>
                        {i.key}
                        {i.required ? ' *' : ''} {i.description && <em>— {i.description}</em>}
                      </span>
                      <input
                        type={i.secret ? 'password' : 'text'}
                        autoComplete="off"
                        value={form.values[i.key] ?? ''}
                        onChange={(e) => setForm({ ...form, values: { ...form.values, [i.key]: e.target.value } })}
                      />
                    </label>
                  ))}
                  <span className="mb-meta">Saved only on this PC (.hermione), never shown again in the page.</span>
                  <div className="mb-note-actions">
                    <button type="button" onClick={() => setForm(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="mb-primary" disabled={busy === it.ref || it.inputs.some((i) => i.required && !form.values[i.key]?.trim())}>
                      <Download className="size-3.5" /> Install
                    </button>
                  </div>
                </form>
              ) : (
                <div className="cap-card-actions">
                  {it.inputs.some((i) => i.required) && !it.installed && <span className="cap-src">needs a key</span>}
                  {it.installed ? (
                    <span className="cap-installed">
                      <Check className="size-3.5" /> Installed
                    </span>
                  ) : (
                    <button type="button" className="mb-primary" disabled={!!it.problem || busy === it.ref} onClick={() => void install(it)}>
                      <Download className="size-3.5" /> {busy === it.ref ? 'Installing…' : 'Install'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-empty">Nothing found.</div>
      )}
      {view === 'mcp' && cursor && items.length > 0 && (
        <div className="mb-note-actions" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => void load(true)} disabled={loading}>
            {loading ? 'Loading…' : 'More'}
          </button>
        </div>
      )}
    </div>
  )
}
