// Shared types for the agent loop, tool registry and event stream.

export type ToolTier = 'auto' | 'confirm'
export type ToolGroup = 'shell' | 'browse' | 'inspect'

export interface ToolResult {
  ok: boolean
  output: string
}

/** Everything a tool needs to reach back into the run it belongs to. */
export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high'

export interface ToolContext {
  sessionId: string
  /** 'chat' or 'forge' (Content Forge) — the workspace this run belongs to. */
  mode?: 'chat' | 'forge'
  emit: Emit
  /** The call being run (lets a tool tag its own sub-steps, e.g. a worker's). */
  callId?: string
  rtkEnabled?: boolean
  rtkLevel?: 'low' | 'medium' | 'high'
  lazyDevMode?: 'auto' | 'always' | 'never'
}

export interface ToolDef {
  name: string
  description: string
  group: ToolGroup
  tier: ToolTier
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
  /**
   * Per-call override of `tier`: return true when THIS call needs the
   * operator's approval (e.g. page_act: reads run freely, clicks/typing ask).
   */
  needsApproval?(args: Record<string, any>): boolean
  /** Where it comes from (built-in, or a connector's MCP server). */
  source?: 'builtin' | 'connector'
  /** Policy when the operator hasn't set one (connector tools that change things: 'judge'). */
  defaultPolicy?: 'default' | 'off' | 'ask' | 'judge'
  /** Shown in Capabilities: the connector this tool belongs to. */
  connectorId?: string
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult>
}

/** A tool call as returned by the model (native or text-protocol). */
export interface ToolCall {
  callId: string
  tool: string
  args: Record<string, any>
  /** Native id minted by a hosted provider — echoed back on the tool message. */
  providerCallId?: string
  /** The model's arguments couldn't be parsed — the tool is not run; this is reported back instead. */
  argsError?: string
  /** What the model sent, for that report. */
  argsRaw?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** When the message was first recorded (ms). Set on first save, never rewritten. */
  at?: number
  /** Model that wrote this assistant message (sessions can switch models / fail over). */
  model?: string
  tool_name?: string
  tool_call_id?: string
  tool_calls?: OllamaToolCall[]
}

export interface OllamaToolCall {
  id?: string
  function: {
    name: string
    arguments: Record<string, any> | string
  }
}

export type AgentEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'token'; delta: string }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, any>; tier: ToolTier; group: ToolGroup }
  | { type: 'tool_result'; callId: string; tool: string; ok: boolean; output: string }
  /** The session's project folder (chosen with @); null = Hermione's own folder. */
  | { type: 'workspace'; path: string | null; defaultRoot: string; problems: string[] }
  /** An approval-gated call decided without the operator (Auto judge, permissions Off, or a hard limit). */
  | { type: 'auto_decision'; callId: string; tool: string; decision: 'allowed' | 'blocked'; by: 'judge' | 'off' | 'hard-limit'; reason: string }
  | { type: 'approval_required'; callId: string; tool: string; args: Record<string, any>; reason: string; group: ToolGroup }
  /** A page finished loading into the preview panel. */
  | { type: 'preview_ready'; url: string; title: string; textLength: number }
  /** The loop is waiting on the browser: execute this in the iframe, POST the result back. */
  | { type: 'preview_command'; commandId: string; command: string; args: Record<string, any> }
  /** The agent is about to write into the shared terminal. */
  | { type: 'terminal_command'; command: string; cwd?: string }
  /** Someone interrupted the shared terminal. */
  | { type: 'terminal_interrupt'; by: 'user' | 'agent'; reason?: string }
  /** The agent is about to open a page — the client must clear the visit first. */
  | { type: 'visit_request'; url: string; host: string; approved: boolean; reason?: string }
  /** Idle chatter from the subagent — brief remark + pose/mood for avatar sync. */
  | { type: 'remark'; text: string; pose: string; mood: string; durationMs: number }
  /** Tokens used by one model call (estimated when the provider reports none). */
  | { type: 'usage'; input: number; output: number; model: string; providerId: string; estimated: boolean }
  /** The provider ran out of quota/credit or hit a rate limit; the turn continues elsewhere. */
  | { type: 'failover'; from: string; toProviderId: string; toProviderLabel: string; toModel: string; reason: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  /** Hermione asked a multiple-choice question; the run waits for the operator's answer. */
  | {
      type: 'question'
      callId: string
      question: string
      options: { label: string; description?: string }[]
      multiple: boolean
      allowOther: boolean
    }
  /** Her task checklist changed (update_plan) — the whole list, in order. */
  | { type: 'plan'; items: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] }
  /** A clip finished rendering (clip_render) — the chat shows a player. */
  | { type: 'clip_ready'; jobId: string; title: string; duration: number; video: string; cover: string; warnings: string[] }
  /** Hermione saved (or updated) a memory — the chat shows it with an Undo. */
  | { type: 'memory_saved'; id: string; text: string; created: boolean }
  /** The operator pressed Stop; the run ended without an answer. */
  | { type: 'stopped' }

export type Emit = (event: AgentEvent) => void
