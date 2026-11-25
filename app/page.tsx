'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowDown,
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
  Square,
  SquareTerminal,
  UserRound,
  Brain,
  Volume2,
  VolumeX,
  Zap,
  Lightbulb,
} from 'lucide-react'
import { useRunVoice } from '@/lib/voice/useRunVoice'
import { MemoryBank } from '@/components/MemoryBank'
import { ThinkingTrace, type TraceStep } from '@/components/ThinkingTrace'
import { PlanCard, type PlanItem } from '@/components/PlanCard'
import { ClipCard, type ClipData } from '@/components/ClipCard'
import { ClipSetup } from '@/components/ClipSetup'
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
import { ModeSwitcher, ForgeIcon, type AppMode } from '@/components/ModeSwitcher'
import { BrowserSettings } from '@/components/BrowserSettings'
import { ChatMarkdown } from '@/components/ChatMarkdown'
import { LivePreview } from '@/components/LivePreview'
import { ReplyActions, type Rating } from '@/components/ReplyActions'
import { QuestionCard, type QuestionData } from '@/components/QuestionCard'
import { TokenCounter, EMPTY_USAGE, type UsageSum } from '@/components/TokenCounter'
import { SharedTerminal } from '@/components/SharedTerminal'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { AvatarRemark } from '@/components/AvatarRemark'
import { ParticleNetwork } from '@/components/ParticleNetwork'
import { ReplyFeedback } from '@/components/ReplyFeedback'
import { HelperModels } from '@/components/HelperModels'
import { PermissionMode } from '@/components/PermissionMode'
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
  /** Decided without you: Auto judge, permissions Off, or a hard limit. */
  note?: { decision: 'allowed' | 'blocked'; by: 'judge' | 'off' | 'hard-limit'; reason: string }
}

interface ApprovalData {
  callId: string
  tool: string
  args: Record<string, unknown>
  group: ToolKind
  reason: string
  /** 'dismissed': you sent a new message instead, so it was never run. */
  decision?: 'approved' | 'denied' | 'dismissed'
}

interface Message {
  role: 'user' | 'agent'
  text: string
  thinkingText?: string
  time?: string
  modelUsed?: string
  toolCards?: ToolCardData[]
  approvals?: ApprovalData[]
  /** Hermione's multiple-choice questions (ask_user). */
  questions?: QuestionData[]
  /** Her thoughts and tool calls, in the order they happened (the live activity row). */
  steps?: TraceStep[]
  /** Clips she rendered (clip_render). */
  clips?: ClipData[]
  /** Her task checklist (update_plan). */
  plan?: PlanItem[]
  /** Time spent working on this reply so far (ms), and when the current stretch began. */
  workedMs?: number
  activeSince?: number
  /** Memories she saved during this reply (Undo removes a new one). */
  memories?: { id: string; text: string; created: boolean; undone?: boolean }[]
  /** The final answer (or an error) has arrived — tool activity collapses into one line. */
  done?: boolean
  /** The operator pressed Stop before she finished. */
  stopped?: boolean
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
      {card.note && (
        <div className={`auto-note is-${card.note.decision}`}>
          {card.note.decision === 'blocked'
            ? `Blocked by a hard limit: ${card.note.reason}`
            : card.note.by === 'judge'
              ? `Auto-approved by the judge: ${card.note.reason}`
              : 'Ran without asking (permissions are off)'}
        </div>
      )}
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
        <ShieldCheck className="size-4" />{' '}
        {approval.decision === 'approved' ? 'Approved' : approval.decision === 'dismissed' ? 'Not run' : 'Denied'}{' '}
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
  // First render uses defaults on BOTH server and client so hydration matches;
  // the localStorage cache is applied right after mount (see the restore effect).
  const defaultUIState = getDefaultUIState()

  const [preview, setPreview] = useState(defaultUIState.preview)
  const [input, setInput] = useState('')
  const [activeModel, setActiveModel] = useState(defaultUIState.activeModel)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [thinkingEffort, setThinkingEffort] = useState<'off' | 'low' | 'medium' | 'high'>(
    defaultUIState.thinkingEffort
  )
  const [isModelModalOpen, setIsModelModalOpen] = useState(false)
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isBrowserModalOpen, setIsBrowserModalOpen] = useState(false)
  const [providers, setProviders] = useState<PublicProvider[]>([])
  const [activeProviderId, setActiveProviderId] = useState('')
  /** Every configured provider with its live model list — feeds the grouped picker. */
  const [modelGroups, setModelGroups] = useState<
    { providerId: string; label: string; scope: 'local' | 'cloud'; online: boolean; models: { id: string }[] }[]
  >([])
  const [companionState, setCompanionState] = useState<'idle' | 'focused' | 'alert'>(
    defaultUIState.companionState
  )
  const [isStreaming, setIsStreaming] = useState(false)
  /** Permission mode (Ask / Auto / Off); Off shows a banner above the composer. */
  const [permMode, setPermMode] = useState<'ask' | 'auto' | 'off'>('ask')
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = getCachedLastSession()
      if (cached) return cached
    }
    return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
  })
  const [messages, setMessages] = useState<Message[]>([])
  const [showWelcome, setShowWelcome] = useState(true)
  /** Chat = general assistant, Forge = Content Forge. Each has its own sessions. */
  const [appMode, setAppMode] = useState<AppMode>('chat')
  /** The Memory Bank page is open over the workspace (the chat stays mounted underneath). */
  const [memoryOpen, setMemoryOpen] = useState(false)
  /** Bumped when Hermione saves a memory, so an open Memory Bank reloads. */
  const [memoryVersion, setMemoryVersion] = useState(0)
  /** Clip setup window (FFmpeg / voice status, free Pexels + Groq keys). */
  const [clipSetupOpen, setClipSetupOpen] = useState(false)
  /** Real-Chrome live preview available (Chrome installed)? Otherwise the proxied preview is used. */
  const [liveAvailable, setLiveAvailable] = useState(false)
  useEffect(() => {
    fetch('/api/live', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setLiveAvailable(!!d.available))
      .catch(() => {})
  }, [])
  /** Real token usage: this chat (from stream events) and today (from the server ledger). */
  const [chatUsage, setChatUsage] = useState<UsageSum>(EMPTY_USAGE)
  const [todayUsage, setTodayUsage] = useState<UsageSum | null>(null)

  const loadTodayUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/usage', { cache: 'no-store' })
      const data = await res.json()
      if (data?.total) {
        setTodayUsage({
          input: data.total.input,
          output: data.total.output,
          calls: data.total.calls,
          estimated: data.total.estimatedCalls > 0,
        })
      }
    } catch {
      /* counter just hides "today" */
    }
  }, [])

  useEffect(() => {
    loadTodayUsage()
  }, [loadTodayUsage])
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
  const [isTerminalOpen, setIsTerminalOpen] = useState(defaultUIState.isTerminalOpen)
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
  /** Cancels the running request when the operator presses Stop. */
  const abortRef = useRef<AbortController | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  /** Thumbs up/down per reply, kept in this browser (key: session:index). */
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount (SSR-safe)
      setRatings(JSON.parse(localStorage.getItem('hermione-ratings') || '{}'))
    } catch {
      /* storage blocked */
    }
  }, [])
  /** The reply whose "what went wrong?" form is open, and lessons a 👎 just proposed (per reply). */
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [proposedLessons, setProposedLessons] = useState<Record<string, string[]>>({})
  /** Save a rating on the server (feeds lessons). Failures only cost the lesson signal. */
  const sendRating = (key: string, rating: Rating | undefined, msg: Message, extra: { reasons?: string[]; other?: string } = {}) => {
    void fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'rating',
        key,
        rating: rating ?? null,
        ...extra,
        model: msg.modelUsed,
        mode: appMode,
        excerpt: msg.text.slice(0, 2000),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const texts: string[] = (data?.proposed ?? []).map((l: { text: string }) => l.text)
        if (texts.length) {
          setProposedLessons((p) => ({ ...p, [key]: texts }))
          setMemoryVersion((v) => v + 1)
        }
      })
      .catch(() => {})
  }
  const rate = (key: string, rating: Rating | undefined) =>
    setRatings((prev) => {
      const next = { ...prev }
      if (rating) next[key] = rating
      else delete next[key]
      try {
        localStorage.setItem('hermione-ratings', JSON.stringify(next))
      } catch {
        /* storage blocked */
      }
      return next
    })
  const stopRun = () => abortRef.current?.abort()
  /** Hermione's voice: waiting lines on long runs, a spoken summary of each answer. */
  // Her thinking lines are spoken and shown under the avatar (one stream, so they match).
  const voice = useRunVoice({
    onRemark: (text, activity) => {
      const look =
        activity === 'thinking'
          ? { pose: 'tilted_head', mood: 'thoughtful' }
          : activity === 'delegate'
            ? { pose: 'relaxed', mood: 'patient' }
            : /^(web_|page_|site_|image_|video_)/.test(activity)
              ? { pose: 'forward_alert', mood: 'concentrating' }
              : { pose: 'squint', mood: 'processing' }
      if (abortRef.current !== null) setActiveRemark({ text, ...look, durationMs: 6000 })
    },
  })
  /** The message Retry answers again: your most recent one. */
  const lastUserText = (() => {
    for (let k = messages.length - 1; k >= 0; k--) if (messages[k].role === 'user') return messages[k].text
    return ''
  })()

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
  /* ---------------------------------------------------------------- */
  /* Transcript scrolling — follow new text only while you're at the bottom */
  /* ---------------------------------------------------------------- */
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const onTranscriptScroll = () => {
    const el = transcriptRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = near
    setAtBottom(near)
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = transcriptRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    atBottomRef.current = true
    setAtBottom(true)
  }

  // Follow the conversation as it streams — but never yank you down while you're reading above.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  /**
   * "Run" on a shell code block. The command was written by the model, so it
   * always asks first; then it opens the shared terminal and types it in.
   */
  const runInTerminal = async (command: string) => {
    if (!command.trim()) return
    if (!window.confirm(`Run this in the shared terminal?\n\n${command}`)) return
    setIsTerminalOpen(true)
    // The shell starts when the terminal panel opens — retry briefly until it's ready.
    for (let attempt = 0; attempt < 12; attempt++) {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, input: command }),
      }).catch(() => null)
      if (res?.ok) return
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  /** Bridge command ids sent to the preview frame and still awaiting an answer. */
  const issuedCommandsRef = useRef<Set<string>>(new Set())
  /** False while a newly keyed preview frame loads; commands queue until its bridge says "ready". */
  const frameReadyRef = useRef(false)
  const pendingFrameCmdsRef = useRef<{ commandId: string; command: string; args: Record<string, unknown> }[]>([])
  /** Latest openPreview, for the message listener (which is registered once). */
  const openPreviewRef = useRef<((url: string) => void) | null>(null)
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  /* Preview width — drag the handle on the panel's left edge (double-click resets). */
  const [previewWidth, setPreviewWidth] = useState(370)
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

  // Restore cached UI state after hydration. Declared before the persist
  // effect so the defaults never overwrite the cache on first load.
  useEffect(() => {
    const cached = getCachedUIState()
    if (!cached) return
    if (cached.preview !== undefined) setPreview(cached.preview)
    if (cached.activeModel) setActiveModel(cached.activeModel)
    if (cached.thinkingEffort) setThinkingEffort(cached.thinkingEffort)
    if (cached.companionState) setCompanionState(cached.companionState)
    if (cached.isTerminalOpen !== undefined) setIsTerminalOpen(cached.isTerminalOpen)
    if (cached.previewWidth) setPreviewWidth(cached.previewWidth)
    if (cached.appMode) setAppMode(cached.appMode)
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
        appMode,
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [preview, previewWidth, thinkingEffort, isTerminalOpen, activeModel, companionState, appMode])

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

  // On mount: resume the last session (in whichever mode it belongs to).
  useEffect(() => {
    const loadSessions = async () => {
      setIsLoadingSessions(true)
      try {
        const res = await fetch('/api/sessions?limit=50', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          const current = (data.sessions || []).find((s: any) => s.id === sessionId)
          if (current) {
            setAppMode(current.mode === 'forge' ? 'forge' : 'chat')
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

  /** Sidebar history — each mode keeps its own list, like Claude's Chat / Code. */
  const refreshRecentSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions?limit=10&mode=${appMode}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setRecentSessions(data.sessions || [])
      }
    } catch {
      /* keep the previous list */
    }
  }, [appMode])

  useEffect(() => {
    refreshRecentSessions()
  }, [refreshRecentSessions])

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
            done: true, // saved replies are finished: show their action row
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
      frameReadyRef.current = false // new frame: hold commands until its bridge is ready
      setPreviewKey(Date.now())
      setPreview(true)
    } catch (err: any) {
      setPreviewError(err?.message || 'preview failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  openPreviewRef.current = (url: string) => {
    void openPreview(url)
  }

  /** Hand a command from the agent to the iframe bridge (queued until a freshly loaded frame says it's ready). */
  const relayPreviewCommand = (commandId: string, command: string, args: Record<string, unknown>) => {
    if (!frameReadyRef.current) {
      pendingFrameCmdsRef.current.push({ commandId, command, args })
      // Safety net: if "ready" never arrives (e.g. the page blocks scripts), try anyway after 8 s.
      setTimeout(() => {
        if (frameReadyRef.current) return
        const queued = pendingFrameCmdsRef.current.splice(0)
        queued.forEach((c) => postToFrame(c.commandId, c.command, c.args))
      }, 8000)
      return
    }
    postToFrame(commandId, command, args)
  }

  const postToFrame = (commandId: string, command: string, args: Record<string, unknown>) => {
    const frame = iframeRef.current
    if (!frame || !frame.contentWindow) {
      fetch('/api/preview/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId, ok: false, output: 'preview iframe is not mounted' }),
      }).catch(() => {})
      return
    }
    issuedCommandsRef.current.add(commandId)
    frame.contentWindow.postMessage({ __hermione: 'cmd', id: commandId, command, args }, '*')
  }

  // The bridge answers here; forward the result to the waiting tool call.
  // Only the preview frame may answer, and only for commands we actually sent —
  // another window (a popup, an embedded ad) can't inject fake results.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: any = event.data
      if (!data || typeof data.__hermione !== 'string') return
      // Only the preview frame may talk to the console.
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return

      // A freshly loaded page is ready: release commands that were waiting for it.
      if (data.__hermione === 'ready') {
        frameReadyRef.current = true
        const queued = pendingFrameCmdsRef.current.splice(0)
        queued.forEach((c) => postToFrame(c.commandId, c.command, c.args))
        return
      }

      // The operator clicked a link inside the preview — load it through the preview pipeline
      // so the bridge (and Hermione's control of the page) comes along.
      if (data.__hermione === 'navigate' && typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) {
        openPreviewRef.current?.(data.url)
        return
      }

      if (data.__hermione !== 'res' || !data.id) return
      if (!issuedCommandsRef.current.delete(String(data.id))) return
      fetch('/api/preview/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commandId: data.id,
          ok: data.ok !== false,
          output: String(data.output ?? ''),
          navigate: typeof data.navigate === 'string' ? data.navigate : undefined,
        }),
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
      // Keep the current model if this provider has it, else the provider's remembered pick, else the first.
      const remembered: string | undefined = (data.providers || []).find((p: any) => p.id === data.provider)?.defaultModel
      if (names.length)
        setActiveModel((current) =>
          names.includes(current) ? current : remembered && names.includes(remembered) ? remembered : names[0],
        )
      
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

  /** Models from every configured provider (local + API), for the grouped picker. */
  const loadModelGroups = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/models/available${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data.groups)) setModelGroups(data.groups)
    } catch {
      /* picker falls back to the active provider's list */
    }
  }, [])

  useEffect(() => {
    loadModelGroups()
  }, [loadModelGroups, providers.length])

  /** Pick a model from any provider; switches the active provider when needed. */
  const selectModel = useCallback(
    async (providerId: string, model: string) => {
      setActiveModel(model)
      if (providerId && providerId !== activeProviderId) {
        setActiveProviderId(providerId)
        try {
          const res = await fetch('/api/providers', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeId: providerId }),
          })
          const data = await res.json()
          if (res.ok && data.providers) setProviders(data.providers)
        } catch {
          /* the per-turn providerId still routes the request correctly */
        }
      }
    },
    [activeProviderId],
  )

  const applyEvent = (event: any) => {
    const index = agentIndexRef.current
    voice.onEvent(event)
    // She answered, failed, stopped or is waiting on you: the thinking subtitle goes.
    if (['final', 'error', 'stopped', 'approval_required', 'question'].includes(event.type)) setActiveRemark(null)
    if (event.type === 'memory_saved') setMemoryVersion((v) => v + 1)

    // Real token counts per model call.
    if (event.type === 'usage') {
      setChatUsage((u) => ({
        input: u.input + event.input,
        output: u.output + event.output,
        calls: u.calls + 1,
        estimated: u.estimated || !!event.estimated,
      }))
      return
    }

    // Quota/rate failover: follow the server to the model it switched to.
    if (event.type === 'failover') {
      setActiveProviderId(event.toProviderId)
      setActiveModel(event.toModel)
      loadModelGroups(true)
    }

    // The server hid a model that can't chat — refresh the pickers so it disappears.
    if (event.type === 'error' && typeof event.message === 'string' && event.message.includes('[model-hidden]')) {
      event = { ...event, message: event.message.replace('[model-hidden]', '').trim() }
      loadModels()
      loadModelGroups(true)
    }

    // Preview events are side effects on the panel, not transcript content.
    if (event.type === 'preview_ready') {
      setPreviewUrl(event.url)
      setPreviewTitle(event.title || event.url)
      setUrlInput(event.url)
      frameReadyRef.current = false // new frame: hold commands until its bridge is ready
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

    // The agent is writing into the shared terminal. If the panel is closed it
    // stays closed (the bar shows the command); the operator opens it when they want.
    if (event.type === 'terminal_command') {
      setLastAgentCommand({ command: event.command, at: Date.now() })
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
      if (abortRef.current === null) return // the run already ended
      setActiveRemark({ text: event.text, pose: event.pose, mood: event.mood as any, durationMs: event.durationMs })
      return
    }

    if (event.type === 'approval_required' || event.type === 'question') setCompanionState('alert')
    if (event.type === 'tool_call' || event.type === 'token') setCompanionState('focused')

    setMessages((prev) => {
      if (index < 0 || !prev[index]) return prev
      const copy = [...prev]
      const msg: Message = { ...copy[index] }

      switch (event.type) {
        case 'thinking':
          msg.thinkingText = (msg.thinkingText || '') + event.delta
          {
            const steps = [...(msg.steps || [])]
            const last = steps[steps.length - 1]
            if (last?.kind === 'thinking') steps[steps.length - 1] = { kind: 'thinking', text: last.text + event.delta }
            else steps.push({ kind: 'thinking', text: event.delta })
            msg.steps = steps
          }
          break
        case 'token':
          msg.text = (msg.text || '') + event.delta
          break
        case 'tool_call':
          if (event.tool === 'ask_user' || event.tool === 'update_plan') break
          msg.steps = [...(msg.steps || []), { kind: 'tool', callId: event.callId }]
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
        case 'auto_decision':
          msg.toolCards = (msg.toolCards || []).map((card) =>
            card.callId === event.callId ? { ...card, note: { decision: event.decision, by: event.by, reason: event.reason } } : card,
          )
          break
        case 'tool_result':
          if (event.tool === 'ask_user' || event.tool === 'update_plan') break
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
        case 'clip_ready':
          msg.clips = [
            ...(msg.clips || []).filter((c) => c.jobId !== event.jobId),
            { jobId: event.jobId, title: event.title, duration: event.duration, video: event.video, cover: event.cover, warnings: event.warnings || [] },
          ]
          break
        case 'plan':
          msg.plan = event.items
          break
        case 'memory_saved':
          msg.memories = [
            ...(msg.memories || []).filter((m) => m.id !== event.id),
            { id: event.id, text: event.text, created: !!event.created },
          ]
          break
        case 'question':
          msg.questions = [
            ...(msg.questions || []),
            {
              callId: event.callId,
              question: event.question,
              options: event.options || [],
              multiple: !!event.multiple,
              allowOther: event.allowOther !== false,
            },
          ]
          break
        case 'final':
          if (event.text) msg.text = event.text
          msg.done = true
          break
        case 'error':
          msg.text = `${msg.text ? `${msg.text}\n\n` : ''}⚠ ${event.message}`
          msg.done = true
          break
        case 'stopped':
          msg.stopped = true
          msg.done = true
          break
        case 'failover':
          msg.text = `${msg.text ? `${msg.text}\n\n` : ''}↪ ${event.reason} — continuing with ${event.toModel} (${event.toProviderLabel}).\n\n`
          msg.modelUsed = event.toModel
          break
      }

      copy[index] = msg
      return copy
    })
  }

  const runStream = async (url: string, body: Record<string, unknown>) => {
    const controller = new AbortController()
    abortRef.current = controller
    voice.runStarted()
    const runIndex = agentIndexRef.current
    markWorking(runIndex, true)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
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
    } finally {
      voice.runEnded()
      setActiveRemark(null)
      markWorking(runIndex, false)
    }
  }

  /** Start/stop the reply's work timer (the activity row shows it live). */
  const markWorking = (index: number, on: boolean) =>
    setMessages((prev) => {
      const msg = prev[index]
      if (!msg || msg.role !== 'agent') return prev
      const copy = [...prev]
      copy[index] = on
        ? { ...msg, activeSince: Date.now() }
        : { ...msg, activeSince: undefined, workedMs: (msg.workedMs || 0) + (msg.activeSince ? Date.now() - msg.activeSince : 0) }
      return copy
    })

  /** Stop pressed: keep whatever she had written, and mark the reply as stopped. */
  const markStopped = (index: number) =>
    setMessages((prev) => {
      const copy = [...prev]
      const current = copy[index]
      if (current) copy[index] = { ...current, stopped: true, done: true }
      return copy
    })

  /** Send a message — or, with retry, answer the last one again in place of the old reply. */
  const handleSendMessage = async (messageText?: string, opts: { retry?: boolean } = {}) => {
    const userText = (messageText ?? input).trim()
    if (!userText || isStreaming) return

    if (!opts.retry) {
      closeOpenCards()
      setInput('')
      if (composerRef.current) composerRef.current.style.height = 'auto'
    }
    setCompanionState('focused')
    setIsStreaming(true)

    // Sending always brings you back to the latest message.
    atBottomRef.current = true
    setAtBottom(true)
    const userMessage: Message = { role: 'user', text: userText, time: stamp() }
    const agentMessage: Message = { role: 'agent', text: '', thinkingText: '', modelUsed: activeModel, time: stamp() }

    // Retry replaces everything after your last message; a new message adds a user + reply pair.
    const lastUser = messages.map((m) => m.role).lastIndexOf('user')
    const nextIndex = opts.retry ? lastUser + 1 : messages.length + 1
    agentIndexRef.current = nextIndex
    setMessages((prev) => (opts.retry ? [...prev.slice(0, lastUser + 1), agentMessage] : [...prev, userMessage, agentMessage]))
    if (opts.retry) rate(`${sessionId}:${nextIndex}`, undefined)

    try {
      await runStream('/api/agent', {
        sessionId,
        model: activeModel,
        message: userText,
        thinkingEffort,
        providerId: activeProviderId || undefined,
        mode: appMode,
        retry: opts.retry || undefined,
      })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        markStopped(nextIndex)
        return
      }
      setCompanionState('alert')
      setMessages((prev) => {
        const copy = [...prev]
        const current = copy[nextIndex]
        if (current) {
          copy[nextIndex] = { ...current, text: `⚠ ${err?.message || 'request failed'}`, done: true }
        }
        return copy
      })
    } finally {
      abortRef.current = null
      setIsStreaming(false)
      setCompanionState((state) => (state === 'alert' ? state : 'idle'))
      refreshRecentSessions()
      loadTodayUsage()
    }
  }

  /** Undo a memory Hermione just saved: delete it and strike it through in the chat. */
  const undoMemory = async (index: number, id: string) => {
    try {
      const res = await fetch(`/api/memory-bank?kind=memory&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) return
    } catch {
      return
    }
    setMemoryVersion((v) => v + 1)
    setMessages((prev) => {
      const copy = [...prev]
      const msg = copy[index]
      if (msg) copy[index] = { ...msg, memories: msg.memories?.map((m) => (m.id === id ? { ...m, undone: true } : m)) }
      return copy
    })
  }

  /** A new chat message answers any open permission card or question instead. */
  const closeOpenCards = () => {
    setMessages((prev) =>
      prev.some((m) => m.approvals?.some((a) => !a.decision) || m.questions?.some((q) => !q.answer))
        ? prev.map((m) => ({
            ...m,
            approvals: m.approvals?.map((a) => (a.decision ? a : { ...a, decision: 'dismissed' as const })),
            questions: m.questions?.map((q) => (q.answer ? q : { ...q, answer: { choices: [], other: 'Answered in chat' } })),
          }))
        : prev,
    )
  }

  /** Continue the paused run (after a permission decision or an answer) into the same reply. */
  const resumeRun = async (url: string, body: Record<string, unknown>, failText: string) => {
    const index = agentIndexRef.current
    setIsStreaming(true)
    setCompanionState('focused')

    try {
      await runStream(url, { sessionId, thinkingEffort, ...body })
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        markStopped(index)
        return
      }
      setCompanionState('alert')
      setMessages((prev) => {
        const copy = [...prev]
        const current = copy[index]
        if (current) copy[index] = { ...current, text: [current.text, `⚠ ${err?.message || failText}`].join('\n\n'), done: true }
        return copy
      })
    } finally {
      abortRef.current = null
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
    await resumeRun('/api/agent/approve', { callId: approval.callId, decision }, 'approval failed')
  }

  const handleAnswer = async (q: QuestionData, answer: { choices: string[]; other?: string } | 'skipped') => {
    const index = agentIndexRef.current
    setMessages((prev) => {
      const copy = [...prev]
      const msg = copy[index]
      if (!msg) return prev
      copy[index] = { ...msg, questions: (msg.questions || []).map((x) => (x.callId === q.callId ? { ...x, answer } : x)) }
      return copy
    })
    await resumeRun(
      '/api/agent/answer',
      answer === 'skipped'
        ? { callId: q.callId, skipped: true }
        : { callId: q.callId, choices: answer.choices, other: answer.other },
      'sending your answer failed',
    )
  }

  const startNewSession = () => {
    setSessionId(`s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`)
    setMessages([])
    setChatUsage(EMPTY_USAGE)
    agentIndexRef.current = -1
    setCompanionState('idle')
    setShowWelcome(true)
  }

  /** Switching modes opens a fresh session in that mode (its history is in the sidebar). */
  const switchMode = (next: AppMode) => {
    if (next === appMode || isStreaming) return
    setAppMode(next)
    startNewSession()
  }

  const resumeSession = async (sessionIdToResume: string) => {
    setSessionId(sessionIdToResume)
    setMessages([])
    setChatUsage(EMPTY_USAGE)
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
      <header className="topbar relative">
        {/* Chat / Content Forge — like Claude's Chat / Code split */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          <ModeSwitcher
            mode={appMode}
            onChange={(m) => {
              setMemoryOpen(false)
              switchMode(m)
            }}
            disabled={isStreaming}
            memoryOpen={memoryOpen}
            onMemory={() => setMemoryOpen(true)}
          />
        </div>
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
            onClick={() => setIsBrowserModalOpen(true)}
            className="text-[11px] font-mono text-zinc-400 hover:text-[#d2b278] border border-[#29272b] px-2 py-1 rounded bg-[#131214]"
            title="Chrome profile Hermione searches through"
          >
            Browser
          </button>
          {appMode === 'forge' && (
            <button
              onClick={() => setClipSetupOpen(true)}
              className="text-[11px] font-mono text-zinc-400 hover:text-[#f0956f] border border-[#29272b] px-2 py-1 rounded bg-[#131214]"
              title="Clip rendering: FFmpeg, voice, free stock-footage and caption keys"
            >
              Clip setup
            </button>
          )}
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

      {memoryOpen && <MemoryBank refreshKey={memoryVersion} />}

      {/* Main Workspace Layout — hidden, not unmounted, while the Memory Bank is open */}
      <div style={{ display: memoryOpen ? 'none' : 'contents' }}>
      {showWelcome && messages.length === 0 ? (
        <WelcomeScreen
          key={appMode}
          mode={appMode}
          model={activeModel}
          providerId={activeProviderId || undefined}
          userName="Serpto"
          onSubmit={(text) => {
            handleSendMessage(text)
          }}
          disabled={isStreaming}
          recentSessions={recentSessions}
          onOpenSession={(id) => void resumeSession(id)}
        />
      ) : (
      <div
        className={`workspace-layout ${preview ? '' : 'no-preview'}`}
        style={{ '--preview-w': `${previewWidth}px` } as CSSProperties}
      >
        {/* Sidebar */}
        <aside className="sidebar">
          <button className="new-session" onClick={startNewSession}>
            {appMode === 'forge' ? <ForgeIcon className="size-4 text-[#f0956f]" /> : <Plus className="size-4" />}
            {appMode === 'forge' ? 'New project' : 'New session'} <span>⌘ N</span>
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
                  key={activeRemark.text}
                  text={activeRemark.text}
                  mood={activeRemark.mood as 'curious' | 'thoughtful' | 'concentrating' | 'attentive' | 'processing' | 'patient' | 'engaged' | 'idle'}
                  durationMs={activeRemark.durationMs}
                  onDone={() => setActiveRemark(null)}
                />
              )}
            </div>

            <span className="sidebar-label">
              {appMode === 'forge' ? 'Forge projects' : 'Sessions'} <MoreHorizontal className="size-3.5" />
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
          <div className="transcript" ref={transcriptRef} onScroll={onTranscriptScroll}>
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

                  {/* What she's doing right now (spinner + live line + timer), then "Thought for 14s · 3 steps" */}
                  {msg.role === 'agent' && (
                    <ThinkingTrace
                      steps={msg.steps || []}
                      tools={msg.toolCards || []}
                      running={!!msg.activeSince}
                      workedMs={msg.workedMs || 0}
                      activeSince={msg.activeSince}
                      writing={!!msg.text}
                      fallbackThinking={msg.steps?.length ? undefined : msg.thinkingText}
                      renderTool={(id) => {
                        const card = msg.toolCards?.find((c) => c.callId === id)
                        return card ? <ActionCard card={card} /> : null
                      }}
                    />
                  )}

                  {/* Her task checklist */}
                  {msg.plan && msg.plan.length > 0 && <PlanCard items={msg.plan} live={!!msg.activeSince} />}

                  {msg.questions?.filter((q) => q.answer).map((q) => (
                    <QuestionCard key={q.callId} q={q} busy={isStreaming} onAnswer={handleAnswer} />
                  ))}

                  {msg.role === 'user' ? (
                    <div className="user-bubble">{msg.text}</div>
                  ) : msg.text ? (
                    <div className="agent-bubble">
                      <ChatMarkdown text={msg.text} onRunInTerminal={runInTerminal} />
                    </div>
                  ) : null}

                  {/* Clips she rendered */}
                  {msg.clips?.map((c) => <ClipCard key={c.jobId} clip={c} />)}

                  {msg.role === 'agent' && msg.stopped && <div className="reply-stopped">Stopped</div>}

                  {/* Memories she saved while answering */}
                  {msg.memories?.map((m) => (
                    <div key={m.id} className={`memory-note ${m.undone ? 'is-undone' : ''}`}>
                      <Brain className="size-3.5 flex-none" />
                      <span className="flex-none">{m.undone ? 'Forgotten:' : m.created ? 'Saved to memory:' : 'Memory updated:'}</span>
                      <span className="t" title={m.text}>{m.text}</span>
                      {!m.undone && m.created ? (
                        <button type="button" onClick={() => undoMemory(i, m.id)}>Undo</button>
                      ) : !m.undone ? (
                        <button type="button" onClick={() => setMemoryOpen(true)}>View</button>
                      ) : null}
                    </div>
                  ))}

                  {/* Copy · Retry · Read aloud · 👍/👎 once the reply is finished */}
                  {msg.role === 'agent' && msg.done && (msg.text || msg.stopped) && !(isStreaming && i === messages.length - 1) && (
                    <ReplyActions
                      id={`${sessionId}:${i}`}
                      text={msg.text}
                      rating={ratings[`${sessionId}:${i}`]}
                      onRate={(r) => {
                        const key = `${sessionId}:${i}`
                        rate(key, r)
                        sendRating(key, r, msg)
                        setFeedbackFor(r === 'down' ? key : feedbackFor === key ? null : feedbackFor)
                      }}
                      onRetry={
                        i === messages.length - 1 && !isStreaming && lastUserText
                          ? () => handleSendMessage(lastUserText, { retry: true })
                          : undefined
                      }
                    />
                  )}

                  {/* 👎 → "what went wrong?"; lessons it proposed */}
                  {feedbackFor === `${sessionId}:${i}` && msg.role === 'agent' && (
                    <ReplyFeedback
                      replyKey={`${sessionId}:${i}`}
                      onClose={() => setFeedbackFor(null)}
                      onSubmit={(reasons, other) => {
                        sendRating(`${sessionId}:${i}`, 'down', msg, { reasons, other })
                        setFeedbackFor(null)
                      }}
                    />
                  )}
                  {proposedLessons[`${sessionId}:${i}`]?.map((text) => (
                    <div key={text} className="memory-note">
                      <Lightbulb className="size-3.5 flex-none" />
                      <span className="flex-none">Lesson proposed:</span>
                      <span className="t" title={text}>{text}</span>
                      <button type="button" onClick={() => setMemoryOpen(true)}>Review</button>
                    </div>
                  ))}

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

                  {/* Hermione's open questions (ask_user); answered ones sit above the reply */}
                  {msg.questions?.filter((q) => !q.answer).map((q) => (
                    <QuestionCard key={q.callId} q={q} busy={isStreaming} onAnswer={handleAnswer} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="composer-wrap">
            {!atBottom && (
              <button type="button" className="jump-latest" onClick={() => scrollToBottom('smooth')}>
                <ArrowDown className="size-3.5" /> Jump to latest
              </button>
            )}
            <div className="composer">
              <textarea
                ref={composerRef}
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
                placeholder={
                  appMode === 'forge'
                    ? 'Refine the topic, ask why a video went viral, or request titles & tags…'
                    : 'Ask Hermione to inspect, browse, or execute local tasks…'
                }
                rows={1}
                spellCheck={false}
              />
              {isStreaming ? (
                <button className="send-button is-stop" onClick={stopRun} aria-label="Stop" title="Stop Hermione">
                  <Square />
                </button>
              ) : (
                <button className="send-button" onClick={() => handleSendMessage()} disabled={!input.trim()} aria-label="Send">
                  <ArrowUp />
                </button>
              )}
            </div>
            {permMode === 'off' && (
              <div className="perm-off-banner" role="status">
                Permissions are off: Hermione runs writes, commands and website actions without asking. Hard limits still apply.
              </div>
            )}
            <div className="composer-meta flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Model Selector Dropdown */}
                <div className="relative flex items-center">
                  <select
                    value={modelGroups.some((g) => g.models.length) ? `${activeProviderId}::${activeModel}` : activeModel}
                    onChange={(e) => {
                      const value = e.target.value
                      if (value === '__manage__') {
                        setIsProviderModalOpen(true)
                        return
                      }
                      const split = value.indexOf('::')
                      if (split > 0) selectModel(value.slice(0, split), value.slice(split + 2))
                      else setActiveModel(value)
                    }}
                    title="Models from every provider — local runtimes and APIs"
                    className="bg-[#18161a] hover:bg-[#201d24] text-[#dedbd7] text-[11px] font-mono pl-2 pr-6 py-1 rounded border border-[#2e2a33] focus:outline-none cursor-pointer appearance-none max-w-56 truncate"
                  >
                    {modelGroups.some((g) => g.models.length) ? (
                      <>
                        {/* Keep the current pick selectable even if its provider is momentarily offline. */}
                        {!modelGroups.some(
                          (g) => g.providerId === activeProviderId && g.models.some((m) => m.id === activeModel),
                        ) && <option value={`${activeProviderId}::${activeModel}`}>{activeModel}</option>}
                        {modelGroups.map((g) => (
                          <optgroup
                            key={g.providerId}
                            label={`${g.scope === 'local' ? '⌂' : '☁'} ${g.label}${g.online ? '' : ' — offline'}`}
                          >
                            {g.models.map((m) => (
                              <option key={`${g.providerId}::${m.id}`} value={`${g.providerId}::${m.id}`}>
                                {m.id}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                        <option value="__manage__">+ Add model / provider…</option>
                      </>
                    ) : availableModels.length > 0 ? (
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

                <PermissionMode onMode={setPermMode} />

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

              <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                <button
                  type="button"
                  onClick={voice.toggle}
                  className={`voice-toggle ${voice.enabled ? 'is-on' : ''}`}
                  aria-pressed={voice.enabled}
                  title={voice.enabled ? 'Voice on: Hermione speaks while long tasks run and sums up each answer. Click to mute.' : 'Voice off. Click to let Hermione speak.'}
                >
                  {voice.enabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                  Voice
                </button>
                <HelperModels groups={modelGroups} />
                <TokenCounter chat={chatUsage} today={todayUsage} />
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
            {liveAvailable ? (
              /* A real Chrome tab you and Hermione share (falls back to the proxied preview below). */
              <LivePreview
                sessionId={sessionId}
                onUrlChange={(url, title) => {
                  setPreviewUrl(url)
                  setPreviewTitle(title || url)
                }}
              />
            ) : (
            <>
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
                  // Opaque origin: the page's scripts can't reach Hermione's window, storage or API.
                  // Must never include allow-same-origin (with allow-scripts that undoes the sandbox).
                  sandbox="allow-scripts allow-forms allow-popups"
                  referrerPolicy="no-referrer"
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
            </>
            )}
          </aside>
        )}
      </div>
      )}
      </div>

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

      {/* Chrome profile used for web searches */}
      <BrowserSettings isOpen={isBrowserModalOpen} onClose={() => setIsBrowserModalOpen(false)} />

      {/* Clip studio: FFmpeg / voice status and the free keys */}
      <ClipSetup open={clipSetupOpen} onClose={() => setClipSetupOpen(false)} />

      {/* Provider settings (custom endpoint + token) */}
      <ProviderSettings
        isOpen={isProviderModalOpen}
        onClose={() => {
          setIsProviderModalOpen(false)
          loadModelGroups(true)
        }}
        activeProviderId={activeProviderId}
        onProvidersChange={({ activeId, providers: next }) => {
          setActiveProviderId(activeId)
          setProviders(next)
          loadModelGroups()
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
