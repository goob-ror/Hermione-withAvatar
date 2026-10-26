'use client'

/**
 * Client-side cache store — persistent state for providers, models, UI preferences.
 * Uses localStorage with optional TTL for automatic expiration.
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttlMs?: number
}

export interface ProviderCacheData {
  activeProviderId: string
  providers: Array<{
    id: string
    label: string
    kind: 'ollama' | 'openai'
    baseUrl: string
    hasKey: boolean
    keyHint: string
    defaultModel?: string
    isActive: boolean
    isDefault?: boolean
  }>
}

export interface ModelsCacheData {
  models: Array<{ name: string; id?: string }>
  providerId: string
}

export interface UIStateCacheData {
  previewWidth: number
  thinkingEffort: 'off' | 'low' | 'medium' | 'high'
  isTerminalOpen: boolean
  preview: boolean
  activeModel: string
  companionState: 'idle' | 'focused' | 'alert'
}

export interface PreferencesCacheData {
  agentName: string
  rtkEnabled: boolean
  rtkLevel: 'low' | 'medium' | 'high'
  lazyDevMode: 'auto' | 'always' | 'never'
}

const CACHE_PREFIX = 'hermione.'
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Generate cache key with prefix
 */
function cacheKey(name: string): string {
  return `${CACHE_PREFIX}${name}`
}

/**
 * Check if cached entry is still valid
 */
function isValid<T>(entry: CacheEntry<T> | null): boolean {
  if (!entry) return false
  if (!entry.ttlMs) return true
  return Date.now() - entry.timestamp < entry.ttlMs
}

/**
 * Get from cache with TTL validation
 */
export function getCache<T>(name: string): T | null {
  try {
    const stored = localStorage.getItem(cacheKey(name))
    if (!stored) return null
    const entry = JSON.parse(stored) as CacheEntry<T>
    return isValid(entry) ? entry.data : null
  } catch {
    return null
  }
}

/**
 * Set cache with optional TTL
 */
export function setCache<T>(name: string, data: T, ttlMs?: number): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs: ttlMs || DEFAULT_TTL_MS,
    }
    localStorage.setItem(cacheKey(name), JSON.stringify(entry))
  } catch (err) {
    console.warn(`Failed to cache ${name}:`, err)
  }
}

/**
 * Clear specific cache entry
 */
export function clearCache(name: string): void {
  try {
    localStorage.removeItem(cacheKey(name))
  } catch (err) {
    console.warn(`Failed to clear cache ${name}:`, err)
  }
}

/**
 * Clear all hermione caches
 */
export function clearAllCache(): void {
  try {
    const keys = Object.keys(localStorage)
    keys.forEach((key) => {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  } catch (err) {
    console.warn('Failed to clear all cache:', err)
  }
}

/* ================================================================ */
/* Provider cache — activeProviderId + provider list                */
/* ================================================================ */

export function getCachedProviders(): ProviderCacheData | null {
  return getCache<ProviderCacheData>('providers')
}

export function setCachedProviders(data: ProviderCacheData): void {
  setCache('providers', data, 24 * 60 * 60 * 1000) // 24 hours
}

export function getCachedActiveProviderId(): string | null {
  return getCache<string>('activeProviderId')
}

export function setCachedActiveProviderId(id: string): void {
  setCache('activeProviderId', id, 30 * 24 * 60 * 60 * 1000) // 30 days
}

/* ================================================================ */
/* Model list cache per provider — expires after 1 hour             */
/* ================================================================ */

export function getCachedModels(providerId: string): ModelsCacheData | null {
  const data = getCache<ModelsCacheData>(`models.${providerId}`)
  // Validate provider match
  return data && data.providerId === providerId ? data : null
}

export function setCachedModels(providerId: string, models: Array<{ name: string; id?: string }>): void {
  const data: ModelsCacheData = { models, providerId }
  setCache(`models.${providerId}`, data, 60 * 60 * 1000) // 1 hour
}

export function clearModelCache(providerId: string): void {
  clearCache(`models.${providerId}`)
}

/* ================================================================ */
/* UI State — immediate, short TTL (5 min)                         */
/* ================================================================ */

export function getCachedUIState(): UIStateCacheData | null {
  return getCache<UIStateCacheData>('uiState')
}

export function setCachedUIState(data: Partial<UIStateCacheData>): void {
  const current = getCachedUIState() || getDefaultUIState()
  const next = { ...current, ...data }
  setCache('uiState', next, 5 * 60 * 1000) // 5 minutes
}

export function getDefaultUIState(): UIStateCacheData {
  return {
    previewWidth: 370,
    thinkingEffort: 'low',
    isTerminalOpen: false,
    preview: true,
    activeModel: 'qwen3.5-9b:latest',
    companionState: 'idle',
  }
}

/* ================================================================ */
/* User Preferences — longer TTL (7 days)                          */
/* ================================================================ */

export function getCachedPreferences(): PreferencesCacheData | null {
  return getCache<PreferencesCacheData>('preferences')
}

export function setCachedPreferences(data: Partial<PreferencesCacheData>): void {
  const current = getCachedPreferences() || getDefaultPreferences()
  const next = { ...current, ...data }
  setCache('preferences', next, 7 * 24 * 60 * 60 * 1000) // 7 days
}

export function getDefaultPreferences(): PreferencesCacheData {
  return {
    agentName: 'Hermione',
    rtkEnabled: true,
    rtkLevel: 'medium',
    lazyDevMode: 'auto',
  }
}

/* ================================================================ */
/* Last active session — quick resume (1 day)                      */
/* ================================================================ */

export function getCachedLastSession(): string | null {
  return getCache<string>('lastSessionId')
}

export function setCachedLastSession(sessionId: string): void {
  setCache('lastSessionId', sessionId, 24 * 60 * 60 * 1000) // 1 day
}

/* ================================================================ */
/* Recent sessions list — quick access (24 hours)                  */
/* ================================================================ */

export interface RecentSessionItem {
  id: string
  title: string
  lastActivity: number
  messageCount: number
}

export function getCachedRecentSessions(): RecentSessionItem[] {
  return getCache<RecentSessionItem[]>('recentSessions') || []
}

export function setCachedRecentSessions(sessions: RecentSessionItem[]): void {
  setCache('recentSessions', sessions, 24 * 60 * 60 * 1000) // 24 hours
}

export function addToRecentSessions(session: RecentSessionItem): void {
  const current = getCachedRecentSessions()
  const filtered = current.filter((s) => s.id !== session.id)
  const next = [session, ...filtered].slice(0, 20) // Keep 20 most recent
  setCachedRecentSessions(next)
}

/* ================================================================ */
/* Startup config — long TTL (30 days)                             */
/* ================================================================ */

export interface StartupConfigCache {
  aiProvider: {
    kind: 'ollama' | 'openai' | 'cloudflare'
    label: string
    baseUrl?: string
    model?: string
  }
  ttsProvider: {
    kind: 'local' | 'cloudflare' | 'skip'
    label: string
  }
  agentName: string
  initialized: boolean
}

export function getCachedStartupConfig(): StartupConfigCache | null {
  return getCache<StartupConfigCache>('startupConfig')
}

export function setCachedStartupConfig(config: StartupConfigCache): void {
  setCache('startupConfig', config, 30 * 24 * 60 * 60 * 1000) // 30 days
}

/* ================================================================ */
/* Preview state — immediate, short TTL (session)                  */
/* ================================================================ */

export interface PreviewStateCache {
  url: string
  title: string
  timestamp: number
}

export function getCachedPreviewState(): PreviewStateCache | null {
  const data = getCache<PreviewStateCache>('previewState')
  // Only valid within same session (1 hour)
  return data && Date.now() - data.timestamp < 60 * 60 * 1000 ? data : null
}

export function setCachedPreviewState(url: string, title: string): void {
  setCache('previewState', { url, title, timestamp: Date.now() }, 60 * 60 * 1000) // 1 hour
}

export function clearPreviewState(): void {
  clearCache('previewState')
}

/* ================================================================ */
/* Cache stats and diagnostics                                     */
/* ================================================================ */

export function getCacheStats(): { entries: number; size: number; keys: string[] } {
  const keys: string[] = []
  let size = 0

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        keys.push(key)
        const item = localStorage.getItem(key)
        if (item) size += item.length
      }
    }
  } catch {
    // ignore quota errors
  }

  return { entries: keys.length, size, keys }
}
