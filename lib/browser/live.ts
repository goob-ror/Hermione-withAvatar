import fs from 'fs'
import net from 'net'
import path from 'path'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'
import { configDir } from '@/lib/agent/providers'
import { detectChrome } from './chrome'
import { bridgeSource } from '@/lib/preview/bridge'
import { assertPublicUrl, isPrivateIp } from '@/lib/http/publicFetch'

/**
 * Live preview: a real (headless) Chrome tab per chat session.
 *
 * The operator watches it as a stream of frames (CDP screencast) and drives it
 * with mouse/keyboard events; Hermione drives the SAME tab through the bridge
 * (numbered elements, act-by-number). Every site works — scripts, cookies,
 * logins — because it's a real browser, not a proxied copy.
 *
 * Isolation: its own profile (.hermione/preview-profile), separate from the
 * operator's Chrome and from the search profile. Pages can't reach localhost
 * or the LAN unless the tab itself is showing a local site the operator opened;
 * agent navigation is public-internet only.
 */

export interface LiveMeta {
  url: string
  title: string
  loading: boolean
  muted: boolean
  audible: boolean
  width: number
  height: number
}

type FrameListener = (event: { type: 'frame'; data: string } | ({ type: 'meta' } & LiveMeta)) => void

interface Tab {
  sessionId: string
  page: Page
  cdp: CDPSession
  listeners: Set<FrameListener>
  screencasting: boolean
  lastFrame?: string
  title: string
  muted: boolean
  audible: boolean
  loading: boolean
  /** The operator deliberately opened a local site (localhost, LAN) in this tab. */
  allowLocal: boolean
  lastUsed: number
}

const VIEWPORT = { width: 1100, height: 760 }
const IDLE_CLOSE_MS = 20 * 60 * 1000

let context: BrowserContext | null = null
let launching: Promise<BrowserContext> | null = null
const tabs = new Map<string, Tab>()
let idleTimer: NodeJS.Timeout | null = null

export function liveAvailable(): boolean {
  return process.env.HERMIONE_LIVE_PREVIEW !== '0' && !!detectChrome()
}

/* ---------------------------------------------------------------- */
/* Audio: mute switch injected into every document                   */
/* ---------------------------------------------------------------- */

const MUTE_SOURCE = `(function () {
  if (window.__hermioneSetMuted) return
  var muted = false, contexts = []
  function apply() { try { document.querySelectorAll('video,audio').forEach(function (m) { m.muted = muted }) } catch (e) {} }
  var AC = window.AudioContext || window.webkitAudioContext
  if (AC) {
    var Wrapped = function () { var c = new (Function.prototype.bind.apply(AC, [null].concat([].slice.call(arguments))))(); contexts.push(c); if (muted) { c.__wasRunning = true; c.suspend() } return c }
    Wrapped.prototype = AC.prototype
    window.AudioContext = Wrapped
    if (window.webkitAudioContext) window.webkitAudioContext = Wrapped
  }
  var play = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function () { if (muted) this.muted = true; return play.apply(this, arguments) }
  new MutationObserver(function () { if (muted) apply() }).observe(document, { childList: true, subtree: true })
  window.__hermioneSetMuted = function (v) { muted = !!v; apply(); contexts.forEach(function (c) { try { if (muted) { c.__wasRunning = c.__wasRunning || c.state === 'running'; c.suspend() } else if (c.__wasRunning) { c.__wasRunning = false; c.resume() } } catch (e) {} }) }
  window.__hermioneAudible = function () {
    var media = [].slice.call(document.querySelectorAll('video,audio'))
    return media.some(function (m) { return !m.paused && !m.muted && m.volume > 0 && m.readyState > 2 }) ||
      contexts.some(function (c) { return c.state === 'running' })
  }
})();`

/* ---------------------------------------------------------------- */
/* Browser + tabs                                                    */
/* ---------------------------------------------------------------- */

function isLocalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  return net.isIP(h) ? isPrivateIp(h) : false
}

async function getContext(): Promise<BrowserContext> {
  if (context) return context
  if (launching) return launching
  launching = (async () => {
    const chromePath = detectChrome()
    if (!chromePath) throw new Error('Chrome was not found — the live preview needs Google Chrome installed')
    const dir = path.join(configDir(), 'preview-profile')
    fs.mkdirSync(dir, { recursive: true })
    // A hot reload (dev) drops this module's state but not the browser it started,
    // which keeps the profile locked. Close that one before launching again.
    const held = globalThis as { __hermioneLiveCtx?: BrowserContext }
    if (held.__hermioneLiveCtx) {
      await held.__hermioneLiveCtx.close().catch(() => {})
      held.__hermioneLiveCtx = undefined
    }
    const { chromium } = await import('playwright-core')
    const ctx = await chromium.launchPersistentContext(dir, {
      executablePath: chromePath,
      headless: true,
      viewport: VIEWPORT,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    await ctx.addInitScript({ content: MUTE_SOURCE })
    await ctx.addInitScript({ content: bridgeSource('', { live: true }) })

    // Pages may not reach localhost / the LAN — unless the tab itself is a local site the operator opened.
    await ctx.route('**/*', (route) => {
      let host = ''
      try {
        host = new URL(route.request().url()).hostname
      } catch {
        return route.continue()
      }
      if (!isLocalHost(host)) return route.continue()
      const page = route.request().frame()?.page()
      const tab = page ? [...tabs.values()].find((t) => t.page === page) : undefined
      return tab?.allowLocal ? route.continue() : route.abort('blockedbyclient')
    })

    ctx.on('close', () => {
      if (held.__hermioneLiveCtx === ctx) held.__hermioneLiveCtx = undefined
      if (context === ctx) {
        context = null
        tabs.clear()
      }
    })
    held.__hermioneLiveCtx = ctx
    context = ctx
    return ctx
  })().finally(() => {
    launching = null
  })
  return launching
}

function emitMeta(tab: Tab) {
  const meta = metaOf(tab)
  tab.listeners.forEach((l) => l({ type: 'meta', ...meta }))
}

function metaOf(tab: Tab): LiveMeta {
  const vp = tab.page.viewportSize() ?? VIEWPORT
  const title = tab.page.url() === 'about:blank' ? '' : tab.title
  return {
    url: tab.page.url() === 'about:blank' ? '' : tab.page.url(),
    title,
    loading: tab.loading,
    muted: tab.muted,
    audible: tab.audible,
    width: vp.width,
    height: vp.height,
  }
}

export async function getTab(sessionId: string): Promise<Tab> {
  const existing = tabs.get(sessionId)
  if (existing && !existing.page.isClosed()) {
    existing.lastUsed = Date.now()
    return existing
  }
  const ctx = await getContext()
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  const tab: Tab = {
    sessionId,
    page,
    cdp,
    listeners: new Set(),
    screencasting: false,
    title: '',
    muted: false,
    audible: false,
    loading: false,
    allowLocal: false,
    lastUsed: Date.now(),
  }
  tabs.set(sessionId, tab)

  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    tab.lastFrame = f.data
    tab.listeners.forEach((l) => l({ type: 'frame', data: f.data }))
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })

  const refreshTitle = async () => {
    try {
      tab.title = await page.title()
    } catch {
      /* navigating */
    }
    emitMeta(tab)
  }
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      tab.loading = true
      emitMeta(tab)
    }
  })
  page.on('domcontentloaded', refreshTitle)
  page.on('load', async () => {
    tab.loading = false
    // New document: re-apply the mute setting.
    if (tab.muted) await page.evaluate(() => (window as any).__hermioneSetMuted?.(true)).catch(() => {})
    refreshTitle()
  })
  // Links that open a new window just navigate this tab instead.
  page.on('popup', async (popup) => {
    try {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
      const url = popup.url()
      await popup.close().catch(() => {})
      if (/^https?:/i.test(url)) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {})
    } catch {
      /* ignore */
    }
  })
  page.on('close', () => {
    if (tabs.get(sessionId) === tab) tabs.delete(sessionId)
  })

  armIdle()
  return tab
}

function armIdle() {
  if (idleTimer) return
  idleTimer = setInterval(async () => {
    const now = Date.now()
    for (const tab of [...tabs.values()]) {
      if (!tab.listeners.size && now - tab.lastUsed > IDLE_CLOSE_MS) await tab.page.close().catch(() => {})
    }
    if (!tabs.size && context) {
      await context.close().catch(() => {})
      context = null
    }
    if (!context && idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
  }, 60_000)
}

/* ---------------------------------------------------------------- */
/* Viewing (operator)                                                */
/* ---------------------------------------------------------------- */

/** Subscribe to frames + meta. Screencast runs only while someone is watching. */
export async function watch(sessionId: string, listener: FrameListener): Promise<() => void> {
  const tab = await getTab(sessionId)
  tab.listeners.add(listener)
  if (tab.lastFrame) listener({ type: 'frame', data: tab.lastFrame })
  listener({ type: 'meta', ...metaOf(tab) })
  if (!tab.screencasting) {
    tab.screencasting = true
    await tab.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 }).catch(() => {
      tab.screencasting = false
    })
  }
  // Poll for audible media so the mute button can light up.
  const poll = setInterval(async () => {
    const audible = await tab.page.evaluate(() => !!(window as any).__hermioneAudible?.()).catch(() => false)
    if (audible !== tab.audible) {
      tab.audible = audible
      emitMeta(tab)
    }
  }, 2000)
  return () => {
    clearInterval(poll)
    tab.listeners.delete(listener)
    tab.lastUsed = Date.now()
    if (!tab.listeners.size && tab.screencasting) {
      tab.screencasting = false
      tab.cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}

/** Normalise what the operator typed into the URL bar. */
export function normaliseUrl(raw: string): string {
  const t = raw.trim()
  if (!t) throw new Error('empty address')
  if (/^https?:\/\//i.test(t)) return t
  if (/^(localhost|127\.|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$)/i.test(t)) return `http://${t}`
  if (/^[^\s/]+\.[^\s/]+/.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}` // plain words: search
}

/** Operator navigation: anything goes, including local dev servers. */
export async function navigate(sessionId: string, raw: string): Promise<{ ok: boolean; url: string; error?: string }> {
  const tab = await getTab(sessionId)
  const url = normaliseUrl(raw)
  try {
    tab.allowLocal = isLocalHost(new URL(url).hostname)
  } catch {
    tab.allowLocal = false
  }
  try {
    await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    return { ok: true, url: tab.page.url() }
  } catch (err: any) {
    return { ok: false, url, error: String(err?.message ?? err).split('\n')[0] }
  }
}

export async function history(sessionId: string, action: 'back' | 'forward' | 'reload') {
  const tab = await getTab(sessionId)
  const opts = { waitUntil: 'domcontentloaded' as const, timeout: 20_000 }
  if (action === 'back') await tab.page.goBack(opts).catch(() => null)
  else if (action === 'forward') await tab.page.goForward(opts).catch(() => null)
  else await tab.page.reload(opts).catch(() => null)
}

export async function setMuted(sessionId: string, muted: boolean) {
  const tab = await getTab(sessionId)
  tab.muted = muted
  await tab.page.evaluate((m) => (window as any).__hermioneSetMuted?.(m), muted).catch(() => {})
  emitMeta(tab)
}

export async function setViewport(sessionId: string, width: number, height: number) {
  const tab = await getTab(sessionId)
  const w = Math.round(Math.min(1920, Math.max(360, width)))
  const h = Math.round(Math.min(1400, Math.max(300, height)))
  const cur = tab.page.viewportSize()
  if (cur && Math.abs(cur.width - w) < 8 && Math.abs(cur.height - h) < 8) return
  await tab.page.setViewportSize({ width: w, height: h }).catch(() => {})
  emitMeta(tab)
}

export type LiveInput =
  | { type: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle'; count?: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }

/** Operator input. x/y are 0..1 of the viewport (the client doesn't need to know its size). */
export async function input(sessionId: string, ev: LiveInput) {
  const tab = await getTab(sessionId)
  const vp = tab.page.viewportSize() ?? VIEWPORT
  const px = (v: number, max: number) => Math.round(Math.min(1, Math.max(0, v)) * max)
  const m = tab.page.mouse
  switch (ev.type) {
    case 'move':
      return m.move(px(ev.x, vp.width), px(ev.y, vp.height))
    case 'down':
      await m.move(px(ev.x, vp.width), px(ev.y, vp.height))
      return m.down({ button: ev.button ?? 'left' })
    case 'up':
      await m.move(px(ev.x, vp.width), px(ev.y, vp.height))
      return m.up({ button: ev.button ?? 'left' })
    case 'click':
      return m.click(px(ev.x, vp.width), px(ev.y, vp.height), { button: ev.button ?? 'left', clickCount: ev.count ?? 1 })
    case 'wheel':
      await m.move(px(ev.x, vp.width), px(ev.y, vp.height))
      return m.wheel(ev.dx, ev.dy)
    case 'key':
      return tab.page.keyboard.press(ev.key)
    case 'text':
      return tab.page.keyboard.insertText(ev.text)
  }
}

export function liveUrl(sessionId: string): string {
  const tab = tabs.get(sessionId)
  return tab && !tab.page.isClosed() && tab.page.url() !== 'about:blank' ? tab.page.url() : ''
}

/* ---------------------------------------------------------------- */
/* Hermione (agent) — same tab, through the bridge                   */
/* ---------------------------------------------------------------- */

async function bridge(tab: Tab, command: string, args: Record<string, unknown>) {
  return tab.page.evaluate(
    ([c, a]) => {
      const run = (window as any).__hermioneRun
      return run ? run(c, a) : { ok: false, output: 'the page is still loading — try again in a moment' }
    },
    [command, args] as const,
  ) as Promise<{ ok: boolean; output: string }>
}

async function settled(tab: Tab) {
  await tab.page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {})
  await tab.page.waitForLoadState('load', { timeout: 4_000 }).catch(() => {})
}

/** Agent navigation: public internet only. Returns the opened page's element list. */
export async function agentOpen(sessionId: string, url: string): Promise<{ ok: boolean; output: string }> {
  let target: URL
  try {
    target = new URL(url)
    await assertPublicUrl(target)
  } catch (err: any) {
    return { ok: false, output: `refused: ${err?.message ?? err}` }
  }
  const tab = await getTab(sessionId)
  tab.allowLocal = false
  try {
    const res = await tab.page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await settled(tab)
    const status = res ? `${res.status()} ` : ''
    const snap = await bridge(tab, 'snapshot', {})
    return { ok: true, output: `opened ${tab.page.url()} (${status}live browser)\n\n${snap.output}` }
  } catch (err: any) {
    return { ok: false, output: `could not open ${url}: ${String(err?.message ?? err).split('\n')[0]}` }
  }
}

/** Agent action by number. A click that navigates is followed and the new page listed. */
export async function agentAct(sessionId: string, command: string, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const tab = tabs.get(sessionId)
  if (!tab || tab.page.isClosed() || tab.page.url() === 'about:blank') {
    return { ok: false, output: 'no page is open in the preview — call page_open first' }
  }
  tab.lastUsed = Date.now()
  const before = tab.page.url()
  let result: { ok: boolean; output: string } | null = null
  try {
    result = await bridge(tab, command, args)
  } catch (err: any) {
    // The action navigated away mid-call (the old page's context is gone).
    if (!/context was destroyed|navigat|Target closed/i.test(String(err?.message))) {
      return { ok: false, output: `page_act failed: ${String(err?.message ?? err).split('\n')[0]}` }
    }
  }
  // A real navigation (link, form, script): wait for the new page, then list it.
  if (!result || tab.page.url() !== before) {
    await settled(tab)
    if (!result || tab.page.url().split('#')[0] !== before.split('#')[0]) {
      const snap = await bridge(tab, 'snapshot', {}).catch(() => ({ ok: false, output: '(could not read the new page yet)' }))
      const first = result?.output.split('\n')[0] ?? `${command} done`
      return { ok: true, output: `${first}\n→ navigated to ${tab.page.url()}\n\n${snap.output}` }
    }
  }
  return result
}

/**
 * Assisted upload: open a platform's upload page in the live tab and attach a
 * local file to its file picker. Never clicks Publish — the operator does.
 * Returns the page's element list so the caption fields can be filled next.
 */
export async function agentAttachFile(
  sessionId: string,
  url: string,
  filePath: string,
): Promise<{ ok: boolean; output: string; signIn?: boolean }> {
  let target: URL
  try {
    target = new URL(url)
    await assertPublicUrl(target)
  } catch (err: any) {
    return { ok: false, output: `refused: ${err?.message ?? err}` }
  }
  const tab = await getTab(sessionId)
  tab.allowLocal = false
  try {
    await tab.page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await settled(tab)
  } catch (err: any) {
    return { ok: false, output: `could not open ${url}: ${String(err?.message ?? err).split('\n')[0]}` }
  }
  // The picker can sit inside a dialog or an iframe; look through every frame.
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const frame of tab.page.frames()) {
      const input = await frame.$('input[type="file"]').catch(() => null)
      if (input) {
        await input.setInputFiles(filePath)
        await tab.page.waitForTimeout(2500)
        const snap = await bridge(tab, 'snapshot', {}).catch(() => ({ ok: false, output: '' }))
        return { ok: true, output: `attached the clip on ${tab.page.url()}\n\n${snap.output}` }
      }
    }
    await tab.page.waitForTimeout(800)
  }
  const signIn = /sign ?in|log ?in|accounts\.google|login/i.test(`${tab.page.url()} ${await tab.page.title().catch(() => '')}`)
  return {
    ok: false,
    signIn,
    output: signIn
      ? `the upload page asked to sign in (${tab.page.url()}). The operator should sign in in the preview panel, then ask again.`
      : `no file picker appeared on ${tab.page.url()} — the page layout may have changed; the operator can drag the clip in by hand.`,
  }
}

/** Live page text for page_read. */
export async function agentRead(sessionId: string, maxChars: number): Promise<{ ok: boolean; output: string } | null> {
  const tab = tabs.get(sessionId)
  if (!tab || tab.page.isClosed() || tab.page.url() === 'about:blank') return null
  const text = await tab.page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
  const title = await tab.page.title().catch(() => '')
  const body = text.length > maxChars ? `${text.slice(0, maxChars)}\n… truncated (${text.length} chars total)` : text
  return { ok: true, output: `url: ${tab.page.url()}\ntitle: ${title || '(none)'}\n\n${body}` }
}

export async function closeTab(sessionId: string) {
  const tab = tabs.get(sessionId)
  if (tab) await tab.page.close().catch(() => {})
}
