'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileWarning,
  Globe2,
  LockKeyhole,
  MoreHorizontal,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  UserRound,
  Zap,
} from 'lucide-react'
import { Live2DAvatar } from '@/components/Live2DAvatar'
import { initLive2DPreloader } from '@/lib/live2d/preloader'
import {
  getCachedProviders,
  setCachedProviders,
  getCachedActiveProviderId,
  setCachedActiveProviderId,
  getCachedModels,
  setCachedModels,
  clearModelCache,
  getCachedUIState,
  setCachedUIState,
  getDefaultUIState,
  getCachedLastSession,
  setCachedLastSession,
  type ProviderCacheData,
} from '@/lib/cache/store'
import { ModelManagerModal } from '@/components/ModelManagerModal'
import { ProviderSettings, type PublicProvider } from '@/components/ProviderSettings'
import { SharedTerminal } from '@/components/SharedTerminal'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { AvatarRemark } from '@/components/AvatarRemark'
import { ParticleNetwork } from '@/components/ParticleNetwork'
import { StartupConfigModal, type StartupConfig } from '@/components/StartupConfigModal'
import {
  FolderModal,
  LocationModal,
  NotificationModal,
  VisitWarningModal,
  type FolderGrant,
  type PermissionDecision,
  type VisitWarningData,
} from '@/components/ConsentModals'

type ToolKind = 'shell' | 'browse' | 'inspect'
type ToolState = 'pending' | 'running' | 'done' | 'blocked'

const toolMeta = {
  shell: { label: 'Files & shell', color: 'var(--shell)', icon: SquareTerminal },
  browse: { label: 'Browse & research', color: 'var(--browse)', icon: Globe2 },
  inspect: { label: 'Site inspection', color: 'var(--inspect)', icon: MousePointer2 },
}

interface ToolCardData {
  callId: string
  tool: string
  args: Record<string, unknown>
  group: ToolKind
  tier: 'auto' | 'confirm'
  state: ToolState
  output?: string
  ok?: boolean
}

interface ApprovalData {
  callId: string
  tool: string
  args: Record<string, unknown>
  group: ToolKind
  reason: string
  decision?: 'approved' | 'denied'
}

interface Message {
  role: 'user' | 'agent'
  text: string
  thinkingText?: string
  time?: string
  modelUsed?: string
  toolCards?: ToolCardData[]
  approvals?: ApprovalData[]
}

function ToolIcon({ kind, className = 'size-4' }: { kind: ToolKind; className?: string }) {
  const Icon = toolMeta[kind].icon
  return <Icon className={className} strokeWidth={1.8} />
}

function stamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args || {})
  if (entries.length === 0) return 'no arguments'
  return entries
    .map(([k, v]) => {
      const value = typeof v === 'string' ? v : JSON.stringify(v)
      const clipped = value.length > 90 ? `${value.slice(0, 90)}…` : value
      return `${k}: ${clipped}`
    })
    .join(' · ')
}

function StatusPill({ state, kind }: { state: ToolState; kind: ToolKind }) {
  const labels = { pending: 'Needs approval', running: 'Running', done: 'Done', blocked: 'Blocked' }
  return (
    <span className={`status-pill status-${state}`} style={{ '--status-color': toolMeta[kind].color } as CSSProperties}>
      {state === 'blocked' ? <LockKeyhole className="size-3" /> : state === 'running' ? <span className="pulse-dot" /> : <span className="status-dot" />}
      {labels[state]}
    </span>
  )
}

function ActionCard({ card }: { card: ToolCardData }) {
  const [open, setOpen] = useState(false)
  const output = card.output ?? ''
  const preview = output.split('\n').slice(0, 24).join('\n')
  const truncated = output.split('\n').length > 24

  return (
    <div className={`action-card action-${card.group} ${card.state === 'running' ? 'is-running' : ''}`}>
      <button className="action-summary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="tool-mark" style={{ color: toolMeta[card.group].color }}>
          <ToolIcon kind={card.group} />
        </span>
        <span className="action-copy">
          <strong>
            <code>{card.tool}</code>
          </strong>
          <span>{summarizeArgs(card.args)}</span>
        </span>
        <StatusPill state={card.state} kind={card.group} />
        {open ? <ChevronDown className="size-4 text-zinc-600" /> : <ChevronRight className="size-4 text-zinc-600" />}
      </button>
      {open && (
        <div className="action-detail">
          <code>
            {card.tool}({JSON.stringify(card.args)})
          </code>
          <span>
            {output
              ? `${preview}${truncated ? '\n…' : ''}`
              : card.state === 'running'
                ? 'The agent is running this tool…'
                : 'No output yet'}
          </span>
        </div>
      )}
    </div>
  )
}

function PermissionCard({
  approval,
  busy,
  onDecide,
}: {
  approval: ApprovalData
  busy: boolean
  onDecide: (approval: ApprovalData, decision: 'approve' | 'deny') => void
}) {
  const destructive = approval.tool === 'fs_delete' || approval.tool === 'shell_run'

  if (approval.decision) {
    return (
      <div className="permission-resolved">
        <ShieldCheck className="size-4" /> {approval.decision === 'approved' ? 'Approved' : 'Denied'}{' '}
        <code>{approval.tool}</code> <span>just now</span>
      </div>
    )
  }

  return (
    <div className={`permission-card ${destructive ? 'permission-destructive' : ''}`}>
      <div className="permission-heading">
        <span className="permission-icon" style={{ color: toolMeta[approval.group].color }}>
          <ToolIcon kind={approval.group} />
        </span>
        <div>
          <span className="eyebrow">Permission required</span>
          <strong>{approval.reason}</strong>
        </div>
        <LockKeyhole className="size-4 ml-auto text-zinc-500" />
      </div>
      <div className="permission-code">
        {approval.group === 'inspect' ? <FileWarning className="size-3.5" /> : <Search className="size-3.5" />}
        <span>
          {approval.tool} · {summarizeArgs(approval.args)}
        </span>
      </div>
      <div className="permission-actions">
        <button className="button button-quiet" disabled={busy} onClick={() => onDecide(approval, 'deny')}>
          Deny
        </button>
        <button
          className={`button ${destructive ? 'button-serious' : 'button-approve'}`}
          disabled={busy}
          onClick={() => onDecide(approval, 'approve')}
        >
          {destructive ? 'Approve' : 'Approve call'}
        </button>
      </div>
    </div>
  )
}

async function consumeStream(response: Response, onEvent: (event: any) => void) {
  if (!response.body) throw new Error('no response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) continue
      try {
        onEvent(JSON.parse(line))
      } catch {
        // partial or non-JSON line — ignore
      }
    }
  }
}

export default function Page() {
  // Load UI state from cache with fallback to defaults
  const cachedUIState = typeof window !== 'undefined' ? getCachedUIState() : null
  const defaultUIState = getDefaultUIState()
  
  const [preview, setPreview] = useState(cachedUIState?.preview ?? defaultUIState.preview)
  const [input, setInput] = useState('')
  const [activeModel, setActiveModel] = useState(cachedUIState?.activeModel ?? defaultUIState.activeModel)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [thinkingEffort, setThinkingEffort] = useState<'off' | 'low' | 'medium' | 'high'>(
    cachedUIState?.thinkingEffort ?? defaultUIState.thinkingEffort
  )
  const [isModelModalOpen, setIsModelModalOpen] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [providers, setProviders] = useState<PublicProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  const [companionState, setCompanionState] = useState<'idle' | 'focused' | 'alert'>(
    cachedUIState?.companionState ?? defaultUIState.companionState
  )
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedLastSession()
      if (cached) return cached
    }
    return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [showWelcome, setShowWelcome] = useState(true)
  const [activeRemark, setActiveRemark] = useState<{ text: string; pose: string; mood: string; durationMs: number } | null>(null)
  const [showStartupModal, setShowStartupModal] = useState(false)
  const [startupConfig, setStartupConfig] = useState<StartupConfig | null>(null)
  const [recentSessions, setRecentSessions] = useState<Array<{
    id: string
    title: string
    updatedAt: number
    messageCount: number
  }>>([])
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)

  /* Shared terminal — one shell per session, driven by both sides. */
  const [isTerminalOpen, setIsTerminalOpen] = useState(cachedUIState?.isTerminalOpen ?? defaultUIState.isTerminalOpen)
  const [lastAgentCommand, setLastAgentCommand] = useState<{ command: string; at: number } | null>(null)

  /* Consent surfaces. */
  const [visitRequest, setVisitRequest] = useState<VisitWarningData | null>(null)
  const [visitBusy, setVisitBusy] = useState(false)
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false)
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [folderGrants, setFolderGrants] = useState<FolderGrant[]>([])
  const [capabilities, setCapabilities] = useState<{ id: string; state: string; detail?: string }[]>([])

  const agentIndexRef = useRef<number>(-1)

  /* ---------------------------------------------------------------- */
  /* Preview panel — a real page in a same-origin iframe               */
  /* ---------------------------------------------------------------- */

  const [previewUrl, setPreviewUrl] = useState('')
  const [previewTitle, setPreviewTitle] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  /* Preview width — drag the handle on the panel's left edge (double-click resets). */
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedUIState()
      return cached?.previewWidth ?? 370
    }
    return 370
  })
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const clampWidth = (w: number) => Math.max(300, Math.min(w, Math.max(320, window.innerWidth - 720)))

  useEffect(() => {
    setMounted(true);
    const updateTime = () => {
      setCurrentTime(new Date());
    };
    const interval = setInterval(updateTime, 1000);
    updateTime();
    
    // Preload Live2D models in background (non-blocking)
    initLive2DPreloader().catch(err => console.warn('Live2D preload error:', err))

    // Load providers from cache on mount
    const cachedProviders = getCachedProviders()
    if (cachedProviders) {
      setProviders(cachedProviders.providers)
      setActiveProviderId(cachedProviders.activeProviderId)
    }

    return () => clearInterval(interval);
  }, [])

  // Persist UI state changes to cache (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setCachedUIState({
        preview,
        previewWidth,
        thinkingEffort,
        isTerminalOpen,
        activeModel,
        companionState,
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [preview, previewWidth, thinkingEffort, isTerminalOpen, activeModel, companionState])

  // Persist session ID to cache
  useEffect(() => {
    setCachedLastSession(sessionId)
  }, [sessionId])

  // Persist provider selection to cache
  useEffect(() => {
    if (activeProviderId && providers.length > 0) {
      const cacheData: ProviderCacheData = {
        activeProviderId,
        providers,
      }
      setCachedProviders(cacheData)
      setCachedActiveProviderId(activeProviderId)
    }
  }, [activeProviderId, providers])

  // Load recent sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoadingSessions(true)
      try {
        const res = await fetch('/api/sessions?limit=10', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setRecentSessions(data.sessions || [])
          
          // Check if current sessionId exists in saved sessions
          const currentSessionExists = data.sessions.some((s: any) => s.id === sessionId)
          if (currentSessionExists) {
            // Load messages from that session
            await loadSessionMessages(sessionId)
            setShowWelcome(false) // Don't show welcome for existing sessions
          } else {
            setShowWelcome(true) // Show welcome only for new sessions
          }
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err)
      } finally {
        setIsLoadingSessions(false)
      }
    }
    loadSessions()
  }, [])

  const loadSessionMessages = async (sessionIdToLoad: string) => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionIdToLoad)}`, { 
        cache: 'no-store' 
      })
      if (res.ok) {
        const data = await res.json()
        if (data.session && data.session.messages) {
          // Convert stored messages back to UI format
          const loadedMessages: Message[] = data.session.messages.map((msg: any) => ({
            role: msg.role === 'agent' ? 'agent' : 'user',
            text: msg.text,
            thinkingText: msg.thinkingText || '',
            time: msg.time,
            modelUsed: msg.modelUsed,
            toolCards: [],
            approvals: [],
          }))
          setMessages(loadedMessages)
          agentIndexRef.current = loadedMessages.length - 1
        }
      }
    } catch (err) {
      console.warn('Failed to load session messages:', err)
    }
  }

  // Check for startup configuration
  useEffect(() => {
    fetch('/api/startup')
      .then(res => res.json())
      .then(data => {
        if (!data.initialized) {
          setShowStartupModal(true)
        } else {
          setStartupConfig(data)
        }
      })
      .catch(err => {
        console.error('Failed to load startup config:', err)
        setShowStartupModal(true) // Show modal on error
      })
  }, [])

  const handleStartupComplete = async (config: StartupConfig) => {
    try {
      const res = await fetch('/api/startup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      if (!res.ok) throw new Error('Failed to save startup config')

      setStartupConfig(config)
      setShowStartupModal(false)
      
      // Refresh providers and models list
      loadModels()
    } catch (err) {
      console.error('Failed to save startup config:', err)
      alert('Failed to save configuration. Please try again.')
    }
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startW: previewWidth }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing')
  }

  const onResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setPreviewWidth(clampWidth(drag.startW - (event.clientX - drag.startX)))
  }

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    document.body.classList.remove('is-resizing')
    window.localStorage.setItem('hermione.previewWidth', String(previewWidth))
  }

  const resetWidth = () => {
    setPreviewWidth(370)
    window.localStorage.setItem('hermione.previewWidth', '370')
  }

  const hostOf = (url: string) => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  /** Load a URL into the preview panel (same allowlist as the page_open tool). */
  const openPreview = async (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

    setPreviewLoading(true)
    setPreviewError('')
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, url }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setPreviewError(data.error || `${res.status} ${res.statusText}`)
        return
      }
      setPreviewUrl(data.url)
      setPreviewTitle(data.title || data.url)
      setUrlInput(data.url)
      setPreviewKey(Date.now())
      setPreview(true)
    } catch (err: any) {
      setPreviewError(err?.message || 'preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  /** Hand a command from the agent to the iframe bridge. */
  const relayPreviewCommand = (commandId: string, command: string, args: Record<string, unknown>) => {
    const frame = iframeRef.current
    if (!frame || !frame.contentWindow) {
      fetch('/api/preview/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId, ok: false, output: 'preview iframe is not mounted' }),
      }).catch(() => {})
      return
    }
    frame.contentWindow.postMessage({ __hermione: 'cmd', id: commandId, command, args }, '*')
  }

  // The bridge answers here; forward the result to the waiting tool call.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: any = event.data
      if (!data || data.__hermione !== 'res' || !data.id) return
      fetch('/api/preview/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId: data.id, ok: data.ok !== false, output: String(data.output ?? '') }),
      }).catch(() => {})
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const loadModels = useCallback(
    async (providerIdOverride?: string) => {
      const pid = providerIdOverride ?? activeProviderId
      
      // Try cache first
      const cachedModels = getCachedModels(pid)
      if (cachedModels) {
        const names: string[] = cachedModels.models.map((m: any) => m.name || m.id).filter(Boolean)
        setAvailableModels(names)
        if (names.length) setActiveModel((current) => (names.includes(current) ? current : names[0]))
      }
      
      try {
        const res = await fetch(`/api/agent${pid ? `?providerId=${encodeURIComponent(pid)}` : ''}`, {
          cache: 'no-store',
        })
      const data = await res.json()
      const names: string[] = (data.models || []).map((m: any) => m.name || m.id).filter(Boolean)
      setAvailableModels(names)
      if (data.providers) setProviders(data.providers)
      if (data.activeId) setActiveProviderId(data.activeId)
      if (names.length) setActiveModel((current) => (names.includes(current) ? current : names[0]))
      
      // Cache the models
      if (pid && data.models) {
        setCachedModels(pid, data.models)
      }
      } catch (err) {
        console.log('provider initial query failed', err)
        // Fallback to cached models if fetch fails
        if (cachedModels) {
          const names: string[] = cachedModels.models.map((m: any) => m.name || m.id).filter(Boolean)
          setAvailableModels(names)
        }
      }
    },
    [activeProviderId],
  )

  // Runs on mount and again whenever the active provider changes.
  useEffect(() => {
    loadModels()
  }, [loadModels])

  const applyEvent = (event: any) => {
    const index = agentIndexRef.current

    // Preview events are side effects on the panel, not transcript content.
    if (event.type === 'preview_ready') {
      setPreviewUrl(event.url)
      setPreviewTitle(event.title || event.url)
      setUrlInput(event.url)
      setPreviewKey(Date.now())
      setPreviewError('')
      setPreview(true)
      setCompanionState('focused')
      return
    }
    if (event.type === 'preview_command') {
      relayPreviewCommand(event.commandId, event.command, event.args || {})
      setCompanionState('focused')
      return
    }

    // The agent is writing into the shared terminal — surface it and open the panel.
    if (event.type === 'terminal_command') {
      setLastAgentCommand({ command: event.command, at: Date.now() })
      setIsTerminalOpen(true)
      setCompanionState('focused')
      return
    }
    if (event.type === 'terminal_interrupt') {
      setCompanionState('alert')
      return
    }

    // A page is trying to instruct the agent, or a new host needs consent.
    if (event.type === 'visit_request') {
      setVisitRequest({
        url: event.url,
        host: event.host,
        reason: event.reason || 'the agent asked to open it',
        warnings: [],
      })
      // Scan the page so the modal shows what it actually says, before any
      // decision. The fetch here is throwaway — a denial leaves no session page.
      fetch('/api/visit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: event.url }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.warnings?.length) return
          setVisitRequest((prev) => (prev ? { ...prev, warnings: data.warnings } : prev))
        })
        .catch(() => null)
      setCompanionState('alert')
      return
    }

    // Idle chatter from the subagent — display as a subtitle on the avatar.
    if (event.type === 'remark') {
      setActiveRemark({ text: event.text, pose: event.pose, mood: event.mood as any, durationMs: event.durationMs })
      return
    }

    if (event.type === 'approval_required') setCompanionState('alert')
    if (event.type === 'tool_call' || event.type === 'token') setCompanionState('focused')

    setMessages((prev) => {
      if (index < 0 || !prev[index]) return prev
      const copy = [...prev]
      const msg: Message = { ...copy[index] }

      switch (event.type) {
        case 'thinking':
          msg.thinkingText = (msg.thinkingText || '') + event.delta
          break
        case 'token':
          msg.text = (msg.text || '') + event.delta
          break
        case 'tool_call':
          msg.toolCards = [
            ...(msg.toolCards || []),
            {
              callId: event.callId,
              tool: event.tool,
              args: event.args || {},
              group: (event.group || 'shell') as ToolKind,
              tier: event.tier === 'confirm' ? 'confirm' : 'auto',
              state: event.tier === 'confirm' ? 'pending' : 'running',
            },
          ]
          break
        case 'tool_result':
          msg.toolCards = (msg.toolCards || []).map((card) =>
            card.callId === event.callId
              ? { ...card, state: event.ok ? 'done' : 'blocked', output: event.output, ok: !!event.ok }
              : card,
          )
          break
        case 'approval_required':
          msg.approvals = [
            ...(msg.approvals || []),
            {
              callId: event.callId,
              tool: event.tool,
              args: event.args || {},
              group: (event.group || 'shell') as ToolKind,
              reason: event.reason || 'This action needs approval',
            },
          ]
          break
        case 'final':
          if (event.text) msg.text = event.text
          break
        case 'error':
          msg.text = `${msg.text ? `${msg.text}\n\n` : ''}⚠ ${event.message}`
          break
      }

      copy[index] = msg
      return copy
    })
  }

  const runStream = async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const data = await response.json()
        detail = data.error || detail
      } catch {
        // keep the status text
      }
      throw new Error(detail)
    }

    await consumeStream(response, applyEvent)
  }

  const handleSendMessage = async (messageText?: string) => {
    const userText = (messageText ?? input).trim()
    if (!userText || isStreaming) return

    setInput('')
    setCompanionState('focused')
    setIsStreaming(true)

    const userMessage: Message = { role: 'user', text: userText, time: stamp() }
    const agentMessage: Message = { role: 'agent', text: '', thinkingText: '', modelUsed: activeModel, time: stamp() }

    const nextIndex = messages.length + 1
    agentIndexRef.current = nextIndex
    setMessages((prev) => [...prev, userMessage, agentMessage])

    try {
      await runStream('/api/agent', {
        sessionId,
        model: activeModel,
        message: userText,
        thinkingEffort,
        providerId: activeProviderId || undefined,
      })
    } catch (err: any) {
      setCompanionState('alert')
      setMessages((prev) => {
        const copy = [...prev]
        const current = copy[nextIndex]
        if (current) {
          copy[nextIndex] = { ...current, text: `⚠ ${err?.message || 'request failed'}` }
        }
        return copy
      })
    } finally {
      setIsStreaming(false)
      setCompanionState((state) => (state === 'alert' ? state : 'idle'))
    }
  }

  const handleDecision = async (approval: ApprovalData, decision: 'approve' | 'deny') => {
    const index = agentIndexRef.current
    setMessages((prev) => {
      const copy = [...prev]
      const msg = copy[index]
      if (!msg) return prev
      copy[index] = {
        ...msg,
        approvals: (msg.approvals || []).map((a) =>
          a.callId === approval.callId ? { ...a, decision: decision === 'approve' ? 'approved' : 'denied' } : a,
        ),
        toolCards: (msg.toolCards || []).map((card) =>
          card.callId === approval.callId
            ? {
                ...card,
                state: decision === 'approve' ? 'running' : 'blocked',
                output: decision === 'approve' ? card.output : 'denied by the operator',
              }
            : card,
        ),
      }
      return copy
    })

    setIsStreaming(true)
    setCompanionState('focused')

    try {
      await runStream('/api/agent/approve', {
        sessionId,
        callId: approval.callId,
        decision,
        thinkingEffort,
      })
    } catch (err: any) {
      setCompanionState('alert')
      setMessages((prev) => {
        const copy = [...prev]
        const current = copy[index]
        if (current) copy[index] = { ...current, text: `${current.text}\n\n⚠ ${err?.message || 'approval failed'}` }
        return copy
      })
    } finally {
      setIsStreaming(false)
    }
  }

  const startNewSession = () => {
    setSessionId(`s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`)
    setMessages([])
    agentIndexRef.current = -1
    setCompanionState('idle')
    setShowWelcome(true)
  }

  const resumeSession = async (sessionIdToResume: string) => {
    setSessionId(sessionIdToResume)
    setMessages([])
    agentIndexRef.current = -1
    setCompanionState('idle')
    setShowWelcome(false) // Don't show welcome when resuming
    
    // Load messages from that session
    await loadSessionMessages(sessionIdToResume)
  }

  const formatTime = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  /* ---------------------------------------------------------------- */
  /* Permissions — location, notifications, folders                    */
  /* ---------------------------------------------------------------- */

  const loadPermissions = useCallback(async () => {
    try {
      const res = await fetch('/api/permissions', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setCapabilities(data.capabilities ?? [])
      setFolderGrants(data.extraFolders ?? [])
    } catch {
      /* the modals simply stay closed */
    }
  }, [])

  useEffect(() => {
    loadPermissions()
  }, [loadPermissions])

  const decideCapability = useCallback(
    async (id: 'location' | 'notifications' | 'filesystem', decision: PermissionDecision, detail?: string) => {
      setPermissionBusy(true)
      setPermissionError('')
      try {
        // Browser-backed permissions must be requested by the page itself; the
        // server only records the operator's answer.
        if (decision === 'granted' && id === 'location' && typeof navigator !== 'undefined' && navigator.geolocation) {
          const ok = await new Promise<boolean>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              () => resolve(true),
              () => resolve(false),
              { timeout: 8000, maximumAge: 60000 },
            )
          })
          if (!ok) {
            setPermissionError('The browser refused the location prompt, so the grant was not recorded. Check the site permissions in your browser.')
            setPermissionBusy(false)
            return
          }
        }

        if (
          decision === 'granted' &&
          id === 'notifications' &&
          typeof window !== 'undefined' &&
          'Notification' in window &&
          Notification.permission !== 'granted'
        ) {
          const result = await Notification.requestPermission()
          if (result !== 'granted') {
            setPermissionError('The browser refused the notification prompt, so the grant was not recorded.')
            setPermissionBusy(false)
            return
          }
        }

        const res = await fetch('/api/permissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, state: decision, detail }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? 'could not save')
        setCapabilities(data.capabilities ?? [])
        setFolderGrants(data.extraFolders ?? [])
      } catch (err: any) {
        setPermissionError(err?.message ?? String(err))
      } finally {
        setPermissionBusy(false)
        setIsLocationModalOpen(false)
        setIsNotificationModalOpen(false)
      }
    },
    [],
  )

  const addFolderGrant = useCallback(async (folderPath: string, mode: 'read' | 'write') => {
    setPermissionBusy(true)
    setPermissionError('')
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addFolder', path: folderPath, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'could not add the folder')
      setCapabilities(data.capabilities ?? [])
      setFolderGrants(data.extraFolders ?? [])
    } catch (err: any) {
      setPermissionError(err?.message ?? String(err))
    } finally {
      setPermissionBusy(false)
    }
  }, [])

  const removeFolderGrant = useCallback(async (folderPath: string) => {
    try {
      const res = await fetch(`/api/permissions?path=${encodeURIComponent(folderPath)}`, { method: 'DELETE' })
      const data = await res.json()
      setCapabilities(data.capabilities ?? [])
      setFolderGrants(data.extraFolders ?? [])
    } catch {
      /* leave the list as-is */
    }
  }, [])

  /* Ask for whatever is still undecided, one modal at a time, after mount. */
  const askedRef = useRef(false)
  useEffect(() => {
    if (askedRef.current || !capabilities.length) return
    const pending = capabilities.filter((c) => c.state === 'prompt').map((c) => c.id)
    if (!pending.length) {
      askedRef.current = true
      return
    }
    askedRef.current = true
    const timer = setTimeout(() => {
      if (pending.includes('location')) setIsLocationModalOpen(true)
      else if (pending.includes('notifications')) setIsNotificationModalOpen(true)
    }, 2500)
    return () => clearTimeout(timer)
  }, [capabilities])

  /* ---------------------------------------------------------------- */
  /* Visit gate                                                        */
  /* ---------------------------------------------------------------- */

  const decideVisit = useCallback(
    async (decision: PermissionDecision) => {
      if (!visitRequest) return
      setVisitBusy(true)
      try {
        if (decision === 'denied') {
          setVisitRequest(null)
          return
        }
        await fetch('/api/visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, url: visitRequest.url }),
        })
        setVisitRequest(null)
        // Nudge the agent: the host is approved, it may retry.
        setInput(`The visit to ${visitRequest.host} is approved — go ahead and open it.`)
      } catch {
        setVisitRequest(null)
      } finally {
        setVisitBusy(false)
      }
    },
    [visitRequest, sessionId],
  )

  return (
    <main className="app-shell">
      {/* Top Header */}
      <header className="topbar">
        <div className="brand">          
          <button
            onClick={() => setIsProviderModalOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#171618] hover:bg-[#232126] border border-[#27252a] text-[#dedbd7] transition-colors text-xs font-mono"
            title="Model providers — local Ollama or a custom endpoint with an API token"
          >
            <Server className="size-3 text-[#b7a3d2]" />
            <span className="max-w-27.5 truncate">
              {providers.find((p) => p.id === activeProviderId)?.label || 'provider'}
            </span>
            <span className="size-1.5 rounded-full bg-[#7fd6a0]" />
          </button>
          <button
            onClick={() => setIsModelModalOpen(true)}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#171618] hover:bg-[#232126] border border-[#27252a] text-[#dedbd7] transition-colors text-xs font-mono"
          >
            <Cpu className="size-3 text-[#d2b278]" />
            <span className="max-w-32.5 truncate">{activeModel.replace(':latest', '')}</span>
            <ChevronDown className="size-3 text-zinc-500" />
          </button>
        </div>

        <div className="top-actions">
          <button
            onClick={() => setIsFolderModalOpen(true)}
            className="text-[11px] font-mono text-zinc-400 hover:text-[#d2b278] border border-[#29272b] px-2 py-1 rounded bg-[#131214]"
            title="Reach beyond the project root, folder by folder"
          >
            Access
          </button>
          <button
            onClick={() => setIsTerminalOpen((v) => !v)}
            className="text-[11px] font-mono text-zinc-400 hover:text-[#d2b278] border border-[#29272b] px-2 py-1 rounded bg-[#131214]"
            title="The shell you and the agent share"
          >
            Terminal
          </button>
          <button className={`preview-toggle ${preview ? 'selected' : ''}`} onClick={() => setPreview(!preview)}>
            <Globe2 className="size-3.5" /> {preview ? 'Hide preview' : 'Show preview'} <span className="toggle-dot" />
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      {showWelcome && messages.length === 0 ? (
        <WelcomeScreen
          userName="Serpto"
          onSubmit={(text) => {
            handleSendMessage(text)
          }}
          disabled={isStreaming}
        />
      ) : (
      <div
        className={`workspace-layout ${preview ? '' : 'no-preview'}`}
        style={{ '--preview-w': `${previewWidth}px` } as CSSProperties}
      >
        {/* Sidebar */}
        <aside className="sidebar">
          <button className="new-session" onClick={startNewSession}>
            <Plus className="size-4" /> New session <span>⌘ N</span>
          </button>

          <div className="sidebar-section">
            <div className={`session-agent-frame is-${companionState}`}>
              <Live2DAvatar state={companionState} />
              <span
                className={`avatar-status ${companionState}`}
                title={isStreaming ? 'Thinking…' : 'Ready'}
              />
              {activeRemark && (
                <AvatarRemark
                  text={activeRemark.text}
                  mood={activeRemark.mood as 'curious' | 'thoughtful' | 'concentrating' | 'attentive' | 'processing' | 'patient' | 'engaged' | 'idle'}
                  durationMs={activeRemark.durationMs}
                  onDone={() => setActiveRemark(null)}
                />
              )}
            </div>

            <span className="sidebar-label">
              Sessions <MoreHorizontal className="size-3.5" />
            </span>
            <button className="session active">
              <span className="session-dot" /> 
              {isStreaming ? 'Thinking & answering…' : 'Current session'} 
              <span className="session-time">now</span>
            </button>

            {/* Recent sessions list */}
            {recentSessions.length > 0 && (
              <div className="recent-sessions">
                <span className="text-[10px] text-zinc-500 px-2 py-1 font-mono">History</span>
                {recentSessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => resumeSession(s.id)}
                    className={`session ${s.id === sessionId ? 'active' : ''}`}
                    title={`${s.messageCount} messages`}
                  >
                    <span className="session-dot" />
                    <span className="session-title">{s.title}</span>
                    <span className="session-time">{formatTime(s.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tool Legend */}
          <div className="sidebar-footer">
            <span className="version">Hermione v0.6.0</span>
            <span className="legend-item">
              <i className="legend-swatch shell" /> Files &amp; shell
            </span>
            <span className="legend-item">
              <i className="legend-swatch browse" /> Browse &amp; research
            </span>
            <span className="legend-item">
              <i className="legend-swatch inspect" /> Site inspection
            </span>
          </div>
        </aside>

        {/* Chat / Transcript Column */}
        <section className="chat-column">
          <div className="absolute inset-0 z-1 overflow-hidden pointer-events-none">
            <ParticleNetwork particleColor="#80a9c1" lineColor="#80a9c1" particleCount={70} maxDistance={130} speed={0.3} />
          </div>
          <div className="transcript">
            <div className="date-marker">
              {/* Date and Time Live Update */}
              <span>
                {mounted ? `${currentTime.toLocaleDateString()} ${currentTime.toLocaleTimeString()}` : 'Loading time...'}
              </span>
            </div>

            {messages.length === 0 && (
              <div className="message agent-message">
                <div className="message-avatar agent-avatar">
                  <Zap />
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    Hermione <span>now</span>
                  </div>
                  <p className="whitespace-pre-wrap">
                    Ready. Read-only tools (<code>fs_list</code>, <code>fs_read</code>) run immediately; writes, deletes,
                    shell commands and network calls wait for your approval. Everything is root-locked to the project
                    directory.
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user-message' : 'agent-message'}`}>
                <div className={`message-avatar ${msg.role === 'user' ? 'user-avatar' : 'agent-avatar'}`}>
                  {msg.role === 'user' ? <UserRound /> : <Zap />}
                </div>
                <div className="message-body">
                  <div className="message-meta">
                    {msg.role === 'user' ? 'You' : 'Hermione'} <span>{msg.time || 'now'}</span>
                  </div>

                  {/* Thinking trace streamed from message.thinking */}
                  {msg.thinkingText && (
                    <details className="mt-2 mb-3 bg-[#131215] border border-[#2b2733] rounded-md overflow-hidden group">
                      <summary className="px-2.5 py-1.5 text-[11px] font-mono text-[#aa9db5] flex items-center gap-1.5 cursor-pointer hover:bg-[#1a1820] select-none transition-colors">
                        <Sparkles className="size-3 text-[#b998d3]" />
                        <span>Thinking process</span>
                        <ChevronDown className="size-3 ml-auto transition-transform group-open:rotate-180 text-zinc-500" />
                      </summary>
                      <div className="px-3 py-2 text-[11px] font-mono text-[#8d8396] bg-[#0c0b0e] border-t border-[#201d26] whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                        {msg.thinkingText}
                      </div>
                    </details>
                  )}

                  <p className="whitespace-pre-wrap">
                    {msg.text ||
                      (isStreaming && i === messages.length - 1
                        ? msg.thinkingText
                          ? 'Working through it…'
                          : 'Generating response…'
                        : '')}
                  </p>

                  {/* Real tool cards */}
                  {msg.toolCards?.map((card) => <ActionCard key={card.callId} card={card} />)}

                  {/* Real permission gates */}
                  {msg.approvals && msg.approvals.length > 0 && (
                    <div className="permission-grid">
                      {msg.approvals.map((approval) => (
                        <PermissionCard
                          key={approval.callId}
                          approval={approval}
                          busy={isStreaming}
                          onDecide={handleDecision}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="composer-wrap">
            <div className="composer">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
                onInput={(e) => {
                  e.currentTarget.style.height = 'auto'
                  e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`
                }}
                placeholder="Ask Hermione to inspect, browse, or execute local tasks…"
                rows={1}
                spellCheck={false}
              />
              <button className="send-button" onClick={() => handleSendMessage()} disabled={isStreaming} aria-label="Send">
                <ArrowUp />
              </button>
            </div>
            <div className="composer-meta flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Model Selector Dropdown */}
                <div className="relative flex items-center">
                  <select
                    value={activeModel}
                    onChange={(e) => setActiveModel(e.target.value)}
                    className="bg-[#18161a] hover:bg-[#201d24] text-[#dedbd7] text-[11px] font-mono pl-2 pr-6 py-1 rounded border border-[#2e2a33] focus:outline-none cursor-pointer appearance-none"
                  >
                    {availableModels.length > 0 ? (
                      availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))
                    ) : (
                      <option value={activeModel}>{activeModel}</option>
                    )}
                  </select>
                  <ChevronDown className="size-3 text-zinc-500 absolute right-2 pointer-events-none" />
                </div>

                {/* Thinking effort dropdown */}
                <div className="relative flex items-center">
                  <select
                    value={thinkingEffort}
                    onChange={(e) => setThinkingEffort(e.target.value as 'off' | 'low' | 'medium' | 'high')}
                    className="text-[11px] font-mono flex items-center gap-1.5 px-2 py-1 rounded border transition-colors bg-[#18161a] hover:bg-[#201d24] text-[#dedbd7] border-[#2e2a33] focus:outline-none cursor-pointer appearance-none pr-6"
                    title="Control how deep the model thinks (affects inference time)"
                  >
                    <option value="off">Thinking: OFF</option>
                    <option value="low">Thinking: Low</option>
                    <option value="medium">Thinking: Medium</option>
                    <option value="high">Thinking: High</option>
                  </select>
                  <Sparkles className={`size-3 absolute right-2 pointer-events-none ${
                    thinkingEffort !== 'off' ? 'text-[#c697f7]' : 'text-zinc-500'
                  }`} />
                </div>
              </div>

              <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                <span>
                  Enter to send <kbd>↵</kbd>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Preview panel — a real page in a same-origin iframe the agent can drive */}
        {preview && (
          <aside className="preview-panel">
            <div
              className="preview-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize preview"
              title="Drag to resize · double-click to reset"
              onPointerDown={startResize}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
              onDoubleClick={resetWidth}
            />
            <form
              className="url-bar"
              onSubmit={(event) => {
                event.preventDefault()
                openPreview(urlInput)
              }}
            >
              <LockKeyhole className="size-3" />
              <input
                className="url-input"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="localhost:3123 or https://example.com"
                spellCheck={false}
              />
              <button type="submit" className="url-go" disabled={previewLoading} title="Load this URL">
                <ArrowUp className="size-3" />
              </button>
            </form>

            {previewError && <div className="preview-error">{previewError}</div>}

            <div className="browser-stage">
              {previewUrl ? (
                <iframe
                  ref={iframeRef}
                  key={previewKey}
                  className="site-frame"
                  src={`/api/preview/frame?sessionId=${encodeURIComponent(sessionId)}&v=${previewKey}`}
                  title="Live preview"
                />
              ) : (
                <div className="site-window site-empty">
                  <span className="site-kicker">NO PAGE LOADED</span>
                  <h2>Preview is idle</h2>
                  <p>
                    Type a URL above, or ask the agent to run <code>page_open</code> — it renders here and the
                    agent can then click and type on it.
                  </p>
                  <p className="site-hint">
                    Only allowlisted hosts load. Set <code>AGENT_ALLOWED_DOMAINS</code> in <code>.env.local</code>.
                  </p>
                </div>
              )}
            </div>

            <div className="preview-status">
              <span>
                <Play className="size-3" /> {previewUrl ? hostOf(previewUrl) : 'no page'}
              </span>
              <button
                disabled={!previewUrl}
                title={previewUrl ? 'Close the page in this panel' : 'Nothing to close'}
                onClick={() => {
                  setPreviewUrl('')
                  setPreviewTitle('')
                  setPreviewError('')
                  fetch(`/api/preview?sessionId=${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => {})
                }}
              >
                <Pause className="size-3" /> Close page
              </button>
            </div>
          </aside>
        )}
      </div>
      )}

      {/* The shell both sides share */}
      <div style={{ position: isTerminalOpen ? 'relative' : 'static', zIndex: isTerminalOpen ? 50 : 'auto' }}>
        <SharedTerminal
          sessionId={sessionId}
          open={isTerminalOpen}
          onToggle={setIsTerminalOpen}
          lastAgentCommand={lastAgentCommand}
        />
      </div>

      {/* Startup configuration modal */}
      <StartupConfigModal
        open={showStartupModal}
        onComplete={handleStartupComplete}
      />

      {/* Consent surfaces */}
      <VisitWarningModal
        open={!!visitRequest}
        data={visitRequest}
        busy={visitBusy}
        onDecide={decideVisit}
      />
      <LocationModal
        open={isLocationModalOpen}
        busy={permissionBusy}
        error={permissionError}
        onDecide={(decision, detail) => decideCapability('location', decision, detail)}
      />
      <NotificationModal
        open={isNotificationModalOpen}
        busy={permissionBusy}
        error={permissionError}
        onDecide={(decision) => decideCapability('notifications', decision)}
      />
      <FolderModal
        open={isFolderModalOpen}
        busy={permissionBusy}
        folders={folderGrants}
        onClose={() => {
          setIsFolderModalOpen(false)
          setPermissionError('')
        }}
        onAdd={addFolderGrant}
        onRemove={removeFolderGrant}
      />

      {/* Provider settings (custom endpoint + token) */}
      <ProviderSettings
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        activeProviderId={activeProviderId}
        onProvidersChange={({ activeId, providers: next }) => {
          setActiveProviderId(activeId)
          setProviders(next)
          // Reload the model list for the newly active provider right away.
          loadModels(activeId)
        }}
      />

      {/* Model Manager Modal */}
      <ModelManagerModal
        isOpen={isModelModalOpen}
        onClose={() => setIsModelModalOpen(false)}
        currentModel={activeModel}
        onSelectModel={(modelName) => {
          setActiveModel(modelName)
          setIsModelModalOpen(false)
        }}
      />
    </main>
  )
}
