'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Cpu,
  Globe2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wifi,
  X,
  Zap,
  Radar,
  Cloud,
  ExternalLink,
} from 'lucide-react'

interface CatalogPreset {
  id: string
  label: string
  kind: 'openai' | 'ollama'
  scope: 'local' | 'cloud'
  baseUrl: string
  keyEnv?: string
  keyUrl?: string
  keyPlaceholder?: string
}

interface Discovered {
  catalogId: string
  label: string
  scope: 'local' | 'cloud'
  kind: 'ollama' | 'openai'
  baseUrl: string
  online: boolean
  models: { id: string }[]
  latencyMs: number
  detail: string
  keyEnv?: string
  keyUrl?: string
  configuredId?: string
}

export interface PublicProvider {
  id: string
  label: string
  kind: 'ollama' | 'openai'
  baseUrl: string
  hasKey: boolean
  keyHint: string
  keyEnv?: string
  catalogId?: string
  defaultModel?: string
  isActive: boolean
  isDefault?: boolean
}

interface ProbeState {
  ok: boolean
  kind: string
  endpoint: string
  latencyMs: number
  models: { id: string; ownedBy?: string; context?: number }[]
  hidden?: { id: string; reason: string }[]
  authError: boolean
  detail: string
}

interface ProviderSettingsProps {
  isOpen: boolean
  onClose: () => void
  activeProviderId: string
  onProvidersChange: (payload: { activeId: string; providers: PublicProvider[] }) => void
}

/** Used until the server's catalog arrives. */
const FALLBACK_PRESETS: CatalogPreset[] = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434', kind: 'ollama', scope: 'local' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', kind: 'openai', scope: 'local' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', kind: 'openai', scope: 'cloud' },
]

const emptyForm = {
  id: '',
  label: '',
  kind: 'openai' as 'openai' | 'ollama',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  catalogId: '',
}

export function ProviderSettings({ isOpen, onClose, activeProviderId, onProvidersChange }: ProviderSettingsProps) {
  const [providers, setProviders] = useState<PublicProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState(false)
  const [probe, setProbe] = useState<ProbeState | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [catalog, setCatalog] = useState<CatalogPreset[]>(FALLBACK_PRESETS)
  const [discovered, setDiscovered] = useState<Discovered[]>([])
  const [scanning, setScanning] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const handleTestRef = useRef<(() => void) | null>(null)
  // The parent passes a fresh inline callback every render. Keeping it in a ref
  // stops `load` from changing identity, which otherwise re-fires the open
  // effect → parent setState → new callback → infinite update loop.
  const onProvidersChangeRef = useRef(onProvidersChange)
  onProvidersChangeRef.current = onProvidersChange

  const scan = useCallback(async (refresh = false) => {
    setScanning(true)
    try {
      const res = await fetch(`/api/providers/discover${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const data = await res.json()
      // Show what is actually reachable: running local runtimes, and cloud APIs whose key is in the env.
      const hits: Discovered[] = [...(data.local || []), ...(data.cloud || [])].filter(
        (b: Discovered) => b.online || (b.scope === 'cloud' && b.detail !== 'no key in environment'),
      )
      setDiscovered(hits)
    } catch {
      setDiscovered([])
    } finally {
      setScanning(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/providers', { cache: 'no-store' })
      const data = await res.json()
      const list: PublicProvider[] = data.providers || []
      if (Array.isArray(data.catalog) && data.catalog.length) setCatalog(data.catalog)
      setProviders(list)
      onProvidersChangeRef.current({ activeId: data.activeId, providers: list })
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'could not load providers' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      load()
      scan()
      setMessage(null)
    }
  }, [isOpen, load, scan])

  /** One-click add for a detected backend. Cloud keys stay in the env — only the var name is saved. */
  const addDiscovered = async (b: Discovered) => {
    setAdding(b.catalogId)
    setMessage(null)
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: b.label,
          kind: b.kind,
          baseUrl: b.baseUrl,
          catalogId: b.catalogId,
          apiKeyEnv: b.scope === 'cloud' ? b.keyEnv : undefined,
          defaultModel: b.models[0]?.id,
          activate: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'err', text: data.error || 'could not add provider' })
        return
      }
      setProviders(data.providers || [])
      onProvidersChange({ activeId: data.activeId, providers: data.providers || [] })
      setMessage({ type: 'ok', text: `${b.label} added — ${b.models.length} models available` })
      scan(true)
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'could not add provider' })
    } finally {
      setAdding(null)
    }
  }

  const applyPreset = (preset: CatalogPreset) => {
    setForm((f) => ({
      ...f,
      baseUrl: preset.baseUrl,
      kind: preset.kind,
      label: preset.label,
      catalogId: preset.id,
    }))
    setProbe(null)
    setMessage(null)
  }

  const activePreset = catalog.find((c) => c.id === form.catalogId)

  // Pasting a key into a preset is enough: probe automatically to list its models.
  useEffect(() => {
    if (!isOpen || !form.apiKey.trim() || !form.baseUrl.trim()) return
    const timer = setTimeout(() => {
      handleTestRef.current?.()
    }, 700)
    return () => clearTimeout(timer)
  }, [isOpen, form.apiKey, form.baseUrl])

  const resetForm = () => {
    setForm(emptyForm)
    setEditing(false)
    setProbe(null)
    setShowKey(false)
  }

  const startEdit = (p: PublicProvider) => {
    setForm({
      id: p.id,
      label: p.label,
      kind: p.kind,
      baseUrl: p.baseUrl,
      apiKey: '',
      defaultModel: p.defaultModel || '',
      catalogId: p.catalogId || '',
    })
    setEditing(true)
    setProbe(null)
    setMessage(null)
  }

  /** Probe whatever is currently typed — saved provider uses its stored token. */
  const handleTest = async () => {
    if (!form.baseUrl.trim()) {
      setMessage({ type: 'err', text: 'Enter a base URL first' })
      return
    }
    setTesting(true)
    setProbe(null)
    setMessage(null)
    try {
      const res = await fetch('/api/providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: form.baseUrl.trim(),
          kind: form.kind,
          // Blank field on an existing provider = reuse the stored token.
          apiKey: form.apiKey ? form.apiKey : undefined,
          useStoredKey: editing && !form.apiKey,
          // No key typed: the server may use the preset's env var (only for that preset's host).
          apiKeyEnv: !form.apiKey ? activePreset?.keyEnv : undefined,
          id: editing ? form.id : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'err', text: data.error || `${res.status} ${res.statusText}` })
        return
      }
      setProbe(data)
      if (data.ok && !form.defaultModel && data.models?.[0]) {
        setForm((f) => ({ ...f, defaultModel: data.models[0].id }))
      }
      if (!data.ok) {
        setMessage({
          type: 'err',
          text: data.authError ? 'Endpoint reachable but the token was rejected' : data.detail,
        })
      }
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'probe failed' })
    } finally {
      setTesting(false)
    }
  }

  handleTestRef.current = handleTest

  const handleSave = async () => {
    if (!form.baseUrl.trim()) {
      setMessage({ type: 'err', text: 'Base URL is required' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing ? form.id : undefined,
          label: form.label.trim() || undefined,
          kind: form.kind,
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey ? form.apiKey : editing ? undefined : '',
          defaultModel: form.defaultModel.trim() || undefined,
          catalogId: form.catalogId || undefined,
          apiKeyEnv: !form.apiKey && !editing ? activePreset?.keyEnv : undefined,
          activate: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ type: 'err', text: data.error || 'save failed' })
        return
      }
      setProviders(data.providers || [])
      onProvidersChange({ activeId: data.activeId, providers: data.providers || [] })
      setMessage({ type: 'ok', text: `${data.provider?.label || 'Provider'} saved and activated` })
      resetForm()
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'save failed' })
    } finally {
      setSaving(false)
    }
  }

  const handleActivate = async (id: string) => {
    const res = await fetch('/api/providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId: id }),
    })
    const data = await res.json()
    if (res.ok) {
      setProviders(data.providers || [])
      onProvidersChange({ activeId: data.activeId, providers: data.providers || [] })
    } else {
      setMessage({ type: 'err', text: data.error || 'could not activate' })
    }
  }

  const handleDelete = async (p: PublicProvider) => {
    const res = await fetch(`/api/providers?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      setProviders(data.providers || [])
      onProvidersChange({ activeId: data.activeId, providers: data.providers || [] })
      if (form.id === p.id) resetForm()
    }
  }

  if (!isOpen) return null

  const inputClass =
    'w-full bg-[#151416] border border-[#2a292d] focus:border-[#c5a871] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none font-mono'
  const labelClass = 'text-xs font-medium text-zinc-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden bg-[#111013] border border-[#2c2a30] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#262429]">
          <div className="flex items-center gap-2.5">
            <Server className="size-4 text-[#d2b278]" />
            <div>
              <h2 className="text-sm font-semibold text-white">Model providers</h2>
              <p className="text-[11px] text-zinc-500">
                Local runtimes are found automatically — or add any API with a key
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#1e1c21] transition-colors"
              title="Reload"
            >
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#1e1c21] transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Auto-detected backends */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono flex items-center gap-1.5">
                <Radar className="size-3" /> Detected
              </span>
              <button
                onClick={() => scan(true)}
                disabled={scanning}
                className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1 disabled:opacity-50"
              >
                {scanning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                {scanning ? 'scanning…' : 'rescan'}
              </button>
            </div>
            {discovered.length ? (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {discovered.map((b) => {
                  const configured = !!b.configuredId
                  const isActive = b.configuredId === activeProviderId
                  return (
                    <div
                      key={b.catalogId}
                      className="p-2.5 rounded-lg border border-[#252427] bg-[#151416] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`size-1.5 rounded-full shrink-0 ${b.online ? 'bg-[#7fd6a0]' : 'bg-[#e0a2a2]'}`}
                          />
                          <span className="text-xs font-semibold text-white truncate">{b.label}</span>
                          {b.scope === 'cloud' && b.keyEnv && (
                            <span className="text-[9px] font-mono text-[#c5a871]">${b.keyEnv}</span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-zinc-500 truncate">
                          {b.online ? `${b.models.length} models · ${b.latencyMs} ms` : b.detail}
                        </p>
                      </div>
                      {isActive ? (
                        <span className="text-[9px] font-mono text-[#d2b278] shrink-0">ACTIVE</span>
                      ) : configured ? (
                        <button
                          onClick={() => handleActivate(b.configuredId!)}
                          className="px-2 py-1 text-[10px] rounded bg-[#201e23] hover:bg-[#2b2830] text-zinc-200 border border-[#35323a] shrink-0"
                        >
                          Use
                        </button>
                      ) : (
                        <button
                          onClick={() => addDiscovered(b)}
                          disabled={!b.online || adding === b.catalogId}
                          className="px-2 py-1 text-[10px] rounded bg-[#c5a871] hover:bg-[#d4bb87] disabled:opacity-40 text-black font-medium shrink-0 flex items-center gap-1"
                        >
                          {adding === b.catalogId ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                          Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-[11px] text-zinc-600 font-mono px-1">
                {scanning
                  ? 'Looking for Ollama, LM Studio, llama.cpp, vLLM, Jan… and API keys in the environment'
                  : 'Nothing running locally and no API keys in the environment. Start a local runtime or add an API below.'}
              </p>
            )}
          </div>

          {/* Saved providers */}
          <div className="space-y-2">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-mono">Configured</span>
            <div className="grid gap-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
                    p.id === activeProviderId
                      ? 'bg-[#1e1c18] border-[#8a724b]'
                      : 'bg-[#151416] border-[#252427]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white truncate">{p.label}</span>
                      {p.id === activeProviderId && (
                        <span className="bg-[#c5a871]/20 text-[#d2b278] border border-[#c5a871]/40 text-[9px] font-mono px-1.5 py-0.5 rounded">
                          ACTIVE
                        </span>
                      )}
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#33303a] text-zinc-400">
                        {p.kind === 'ollama' ? 'ollama' : 'chat-completions'}
                      </span>
                      {p.hasKey && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#3b3227] text-[#c5a871] flex items-center gap-1">
                          <KeyRound className="size-2.5" /> {p.keyHint}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">{p.baseUrl}</p>
                    {p.defaultModel && (
                      <p className="text-[10px] font-mono text-zinc-600 truncate">default: {p.defaultModel}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.id !== activeProviderId && (
                      <button
                        onClick={() => handleActivate(p.id)}
                        className="px-2 py-1 text-[10px] rounded bg-[#201e23] hover:bg-[#2b2830] text-zinc-200 border border-[#35323a] transition-colors"
                      >
                        Use
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-[#232128] transition-colors"
                      title="Edit"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-[#231a1c] transition-colors"
                      title={p.isDefault ? 'Remove this entry (the env default still applies)' : 'Delete'}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
              {!providers.length && !loading && (
                <div className="text-center py-6 border border-dashed border-[#2b282c] rounded-lg">
                  <Cpu className="size-6 mx-auto text-zinc-600 mb-1.5" />
                  <p className="text-xs text-zinc-400">No providers yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="border border-[#27252a] rounded-lg p-4 space-y-3.5 bg-[#141317]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                <Plus className="size-3.5 text-[#d2b278]" />
                {editing ? 'Edit provider' : 'Add provider'}
              </span>
              {editing && (
                <button onClick={resetForm} className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono">
                  cancel edit
                </button>
              )}
            </div>

            {/* Presets */}
            {(['cloud', 'local'] as const).map((scope) => (
              <div key={scope} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono text-zinc-600 w-14 shrink-0 flex items-center gap-1">
                  {scope === 'cloud' ? <Cloud className="size-3" /> : <Cpu className="size-3" />}
                  {scope === 'cloud' ? 'API' : 'local'}
                </span>
                {catalog
                  .filter((preset) => preset.scope === scope)
                  .map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                        form.catalogId === preset.id
                          ? 'border-[#8a724b] bg-[#1e1c18] text-[#d2b278]'
                          : 'border-[#302d36] bg-[#1a181d] hover:border-[#4a4356] text-zinc-300'
                      }`}
                      title={preset.baseUrl}
                    >
                      {preset.label}
                    </button>
                  ))}
                {scope === 'cloud' && (
                  <button
                    onClick={() => applyPreset({ id: '', label: '', kind: 'openai', scope: 'cloud', baseUrl: '' })}
                    className="px-2 py-1 text-[10px] font-mono rounded border border-dashed border-[#302d36] text-zinc-500 hover:text-zinc-300"
                    title="Any OpenAI-compatible /v1 endpoint"
                  >
                    custom…
                  </button>
                )}
              </div>
            ))}
            {activePreset?.keyUrl && (
              <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                Paste a {activePreset.label} key — models load automatically.
                <a
                  href={activePreset.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#d2b278] hover:underline inline-flex items-center gap-0.5"
                >
                  get a key <ExternalLink className="size-2.5" />
                </a>
                {activePreset.keyEnv && (
                  <span className="text-zinc-600">
                    · or set <code>{activePreset.keyEnv}</code> in <code>.env</code>
                  </span>
                )}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelClass}>Base URL</label>
                <input
                  value={form.baseUrl}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, baseUrl: e.target.value }))
                    setProbe(null)
                  }}
                  placeholder="https://host/v1"
                  spellCheck={false}
                  className={inputClass}
                />
                <p className="text-[10px] text-zinc-600">
                  A bare host gets <code>/v1</code> appended. Full <code>/chat/completions</code> also works.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>Label</label>
                <input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="my-relay"
                  className={inputClass}
                />
                <div className="flex items-center gap-2 pt-0.5">
                  {(['openai', 'ollama'] as const).map((kind) => (
                    <button
                      key={kind}
                      onClick={() => setForm((f) => ({ ...f, kind }))}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                        form.kind === kind
                          ? 'bg-[#291f33] text-[#d6b7f7] border-[#553b70]'
                          : 'bg-[#151416] text-zinc-500 border-[#262429]'
                      }`}
                    >
                      {kind === 'openai' ? 'chat-completions' : 'ollama native'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className={labelClass}>
                  API token <span className="text-zinc-600 font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <KeyRound className="size-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                    placeholder={
                      editing
                        ? 'leave blank to keep the saved token'
                        : `${activePreset?.keyPlaceholder || 'sk-…'}${activePreset?.scope === 'cloud' ? '' : ' (optional)'}`
                    }
                    spellCheck={false}
                    autoComplete="off"
                    className={`${inputClass} pl-8 pr-16`}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="text-[9px] font-mono text-zinc-500 hover:text-zinc-300"
                    >
                      {showKey ? 'hide' : 'show'}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-600">
                  Stored in <code>.hermione/providers.json</code>
                </p>
              </div>

              <div className="space-y-1.5">
                <label className={labelClass}>Default model</label>
                <input
                  value={form.defaultModel}
                  onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
                  placeholder="pick one from the probe or type it"
                  className={inputClass}
                />
                {probe?.models?.length ? (
                  <div className="relative">
                    <select
                      value={form.defaultModel}
                      onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
                      className={`${inputClass} appearance-none pr-7 cursor-pointer`}
                    >
                      <option value="">— detected models —</option>
                      {probe.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="size-3 text-zinc-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleTest}
                disabled={testing || !form.baseUrl.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#211f24] hover:bg-[#2c2930] disabled:opacity-50 text-[#dedbd7] border border-[#37343c] flex items-center gap-1.5 transition-colors"
              >
                {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Wifi className="size-3.5 text-[#d2b278]" />}
                Test connection
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.baseUrl.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-[#c5a871] hover:bg-[#d4bb87] disabled:opacity-50 text-black font-medium flex items-center gap-1.5 transition-colors"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {editing ? 'Save changes' : 'Save & activate'}
              </button>
            </div>

            {message && (
              <div
                className={`text-[11px] px-2.5 py-1.5 rounded flex items-start gap-1.5 ${
                  message.type === 'ok'
                    ? 'bg-[#14201a] text-[#8fd6ac] border border-[#234a37]'
                    : 'bg-[#201416] text-[#e0a2a2] border border-[#4a2429]'
                }`}
              >
                {message.type === 'ok' ? <Check className="size-3.5 shrink-0" /> : <AlertCircle className="size-3.5 shrink-0" />}
                <span>{message.text}</span>
              </div>
            )}

            {/* Probe result */}
            {probe && (
              <div className="border border-[#2a2830] rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#17161a] flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-zinc-300 font-mono">
                    <Globe2 className="size-3 text-[#d2b278]" />
                    {probe.endpoint}
                  </span>
                  <span className="flex items-center gap-2 font-mono">
                    <span className={probe.ok ? 'text-[#8fd6ac]' : 'text-[#e0a2a2]'}>
                      {probe.ok ? 'reachable' : 'failed'}
                    </span>
                    <span className="text-zinc-500">{probe.latencyMs} ms</span>
                    <span className="text-zinc-500">{probe.models.length} chat models</span>
                    {!!probe.hidden?.length && (
                      <span
                        className="text-zinc-600"
                        title={probe.hidden.map((h) => `${h.id} — ${h.reason}`).join('\n')}
                      >
                        +{probe.hidden.length} non-chat hidden
                      </span>
                    )}
                  </span>
                </div>
                {probe.models.length > 0 ? (
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#201e24]">
                    {probe.models.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setForm((f) => ({ ...f, defaultModel: m.id }))}
                        className={`w-full text-left px-3 py-1.5 text-[11px] font-mono flex items-center justify-between hover:bg-[#1b191e] transition-colors ${
                          form.defaultModel === m.id ? 'text-[#d2b278]' : 'text-zinc-300'
                        }`}
                      >
                        <span className="truncate flex items-center gap-1.5">
                          <Zap className="size-2.5 text-zinc-600" />
                          {m.id}
                        </span>
                        <span className="text-[10px] text-zinc-600 shrink-0 ml-2">
                          {m.ownedBy || (m.context ? `${Math.round(m.context / 1000)}k ctx` : '')}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-2 text-[11px] text-zinc-500 font-mono">{probe.detail}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
