/**
 * Session state management for Phase 1 features (RTK + Lazy Dev Mode)
 * Tracks per-session state that doesn't persist across restarts
 */

export interface SessionPhase1State {
  lazyDev: {
    asked: boolean // Have we asked about enabling it this session?
    enabled: boolean // Is it currently enabled for this session?
  }
  rtkStats: {
    totalCompressions: number
    totalTokensSaved: number
    lastCompressionPercent: number
  }
}

const sessionStates = new Map<string, SessionPhase1State>()

function getDefaultState(): SessionPhase1State {
  return {
    lazyDev: {
      asked: false,
      enabled: false,
    },
    rtkStats: {
      totalCompressions: 0,
      totalTokensSaved: 0,
      lastCompressionPercent: 0,
    },
  }
}

export function getSessionState(sessionId: string): SessionPhase1State {
  if (!sessionStates.has(sessionId)) {
    sessionStates.set(sessionId, getDefaultState())
  }
  return sessionStates.get(sessionId)!
}

export function updateSessionState(sessionId: string, updates: Partial<SessionPhase1State>): void {
  const current = getSessionState(sessionId)
  sessionStates.set(sessionId, {
    ...current,
    ...updates,
    lazyDev: { ...current.lazyDev, ...(updates.lazyDev || {}) },
    rtkStats: { ...current.rtkStats, ...(updates.rtkStats || {}) },
  })
}

export function setLazyDevAsked(sessionId: string, asked: boolean): void {
  const state = getSessionState(sessionId)
  state.lazyDev.asked = asked
}

export function setLazyDevEnabled(sessionId: string, enabled: boolean): void {
  const state = getSessionState(sessionId)
  state.lazyDev.enabled = enabled
}

export function hasAskedLazyDev(sessionId: string): boolean {
  return getSessionState(sessionId).lazyDev.asked
}

export function isLazyDevEnabled(sessionId: string): boolean {
  return getSessionState(sessionId).lazyDev.enabled
}

export function recordRTKCompression(sessionId: string, tokensSaved: number, compressionPercent: number): void {
  const state = getSessionState(sessionId)
  state.rtkStats.totalCompressions++
  state.rtkStats.totalTokensSaved += tokensSaved
  state.rtkStats.lastCompressionPercent = compressionPercent
}

export function getRTKStats(sessionId: string) {
  return getSessionState(sessionId).rtkStats
}

export function clearSessionState(sessionId: string): void {
  sessionStates.delete(sessionId)
}
