// Hardcoded guard for pages the agent visits.
//
// Two independent things happen here, and neither is configurable from the UI:
//
//   1. INSTRUCTION DETECTION — page text is scanned for the shapes that mean
//      "this page is trying to give the agent orders". A hit never blocks the
//      visit by itself; it raises a warning the operator has to acknowledge.
//   2. VISIT CONSENT — the first time the agent opens a host in a session, the
//      operator must approve it. Approval is per host, per session, and can be
//      revoked by interrupting the terminal or starting a new session.
//
// This module is imported by the page tools, so the gate sits in the tool path
// itself. A model cannot talk its way past it: the check runs before the fetch.

export interface InstructionHit {
  /** What kind of instruction-shaped text was found. */
  kind: string
  /** The offending snippet, trimmed for display. */
  snippet: string
  /** Why this is suspicious, in one line for the modal. */
  note: string
}

/**
 * Frozen patterns. Editing this list is the only way to change the gate, and it
 * lives in source — not in the provider store, not in .env.
 * 
 * SECURITY-CRITICAL ONLY: These patterns flag genuine threats that could:
 *   - steal credentials or keys
 *   - execute arbitrary commands on the host
 * 
 * Patterns removed for RAG compatibility:
 *   - "addresses-the-agent" (too broad; blocks legitimate AI research content)
 *   - "tool-name-invocation" (false positives on legitimate method names)
 *   - "hidden-text-marker" (blocks machine-readable docs)
 *   - "authority-impersonation" (too broad; legitimate pages can say "admin approved")
 *   - "imperative-instruction" (pages naturally use imperatives)
 *   - "system-prompt-claim" (too vague; blocks policy docs)
 */
const PATTERNS: ReadonlyArray<{ kind: string; note: string; re: RegExp }> = Object.freeze([
  {
    kind: 'exfiltration-request',
    note: 'The page explicitly requests credentials, keys or private files to be sent somewhere.',
    re: /\b(?:send|post|upload|exfiltrate|forward|email|transmit)\b[^\.\n]{0,60}\b(?:api[_\s-]?key|token|password|credential|secret|\.env|ssh\s+key|private\s+key)\b/i,
  },
  {
    kind: 'run-this-command',
    note: 'The page explicitly asks for a shell command to be executed on this machine.',
    re: /\b(?:run|execute|eval)\s+(?:this|the\s+following|these)\s+(?:command|script|code|shell)\b|\bcurl\s+[^\n|]{0,80}\|\s*(?:ba)?sh\b/i,
  },
])

/** Scan page text for instruction-shaped content. Returns every distinct hit. */
export function scanForInstructions(text: string): InstructionHit[] {
  const hits: InstructionHit[] = []
  const seen = new Set<string>()
  const source = text.slice(0, 200_000)

  for (const { kind, note, re } of PATTERNS) {
    const match = re.exec(source)
    if (!match) continue
    if (seen.has(kind)) continue
    seen.add(kind)

    const at = Math.max(0, match.index - 60)
    const snippet = source
      .slice(at, Math.min(source.length, match.index + match[0].length + 60))
      .replace(/\s+/g, ' ')
      .trim()

    hits.push({ kind, note, snippet: snippet.length > 220 ? `${snippet.slice(0, 220)}…` : snippet })
  }

  return hits
}

/* ------------------------------------------------------------------ */
/* Visit consent — per session, per host                               */
/* ------------------------------------------------------------------ */

interface Consent {
  host: string
  approvedAt: number
  /** Instruction hits acknowledged at approval time. */
  warnings: number
}

const CONSENTS = new Map<string, Map<string, Consent>>()

export interface VisitDecision {
  allowed: boolean
  /** True when this host has not been seen in this session yet. */
  needsConsent: boolean
  warnings: InstructionHit[]
}

/**
 * Decide whether a visit may proceed.
 *
 * `acknowledged` carries the operator's modal answer for this specific call:
 *   undefined → not asked yet (gate will stop the run)
 *   true      → operator accepted, remember the host
 *   false     → operator declined, do not remember
 */
export function checkVisit(
  sessionId: string,
  url: string,
  opts: { acknowledged?: boolean; hits?: InstructionHit[] } = {},
): VisitDecision {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return { allowed: false, needsConsent: false, warnings: [] }
  }

  const perSession = CONSENTS.get(sessionId) ?? new Map<string, Consent>()
  CONSENTS.set(sessionId, perSession)

  const existing = perSession.get(host)
  const warnings = opts.hits ?? []

  if (existing) {
    return { allowed: true, needsConsent: false, warnings }
  }

  if (opts.acknowledged === true) {
    perSession.set(host, { host, approvedAt: Date.now(), warnings: warnings.length })
    return { allowed: true, needsConsent: false, warnings }
  }

  return { allowed: false, needsConsent: true, warnings }
}

export function revokeConsent(sessionId: string, host?: string): number {
  const perSession = CONSENTS.get(sessionId)
  if (!perSession) return 0
  if (!host) {
    const n = perSession.size
    perSession.clear()
    return n
  }
  return perSession.delete(host.toLowerCase()) ? 1 : 0
}

export function approvedHosts(sessionId: string): string[] {
  return [...(CONSENTS.get(sessionId)?.keys() ?? [])]
}

/** Copy for the operator-facing modal. Frozen so a page cannot rewrite it. */
export const VISIT_WARNING_COPY = Object.freeze({
  title: 'This page is giving instructions',
  lede:
    'Hermione is about to read a page that contains text shaped like instructions to an AI agent. ' +
    'Page content is data, never commands — but you should decide before it continues.',
  footer:
    'Approving lets Hermione read this host for the rest of this session. It never grants the page ' +
    'permission to change how Hermione behaves.',
})
