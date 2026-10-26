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
  emit: Emit
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
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult>
}

/** A tool call as returned by the model (native or text-protocol). */
export interface ToolCall {
  callId: string
  tool: string
  args: Record<string, any>
  /** Native id minted by a hosted provider — echoed back on the tool message. */
  providerCallId?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
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
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export type Emit = (event: AgentEvent) => void
