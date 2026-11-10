import fs from 'fs'
import os from 'os'
import path from 'path'
import type { BrowserContext } from 'playwright-core'
import { configDir } from '@/lib/agent/providers'

/**
 * Hermione's Chrome profile.
 *
 * Searches can run through the operator's installed Chrome with a persistent
 * profile (cookies, Google sign-in, consent already given), which gets far
 * fewer bot walls than bare HTTP requests.
 *
 * Default is a DEDICATED profile under .hermione/chrome-profile — the operator
 * opens it once via "Set up" (visible window), signs in / accepts consent, and
 * from then on it runs headless. Chrome 136+ refuses automation on the
 * operator's everyday default profile, and a profile can only be open in one
 * Chrome at a time, so pointing at the real profile is allowed but warned.
 *
 * Hermione never solves captchas: a bot wall is reported back, and the
 * operator can clear it themselves in the setup window.
 */

export interface BrowserConfig {
  enabled: boolean
  chromePath: string
  /** Chrome "User Data" directory. */
  userDataDir: string
  /** Profile folder inside userDataDir: "Default", "Profile 1", … */
  profileDirectory: string
  headless: boolean
  /** When the operator last closed a setup window (signed in / accepted consent). */
  setupCompletedAt?: number
}

export interface BrowserStatus extends BrowserConfig {
  chromeFound: boolean
  detectedChromePath: string
  profileExists: boolean
  /** The operator's everyday Chrome data dir — automation is blocked there by Chrome 136+. */
  isEverydayProfile: boolean
  running: 'idle' | 'headless' | 'setup'
  lastError?: string
  lastSearchAt?: number
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean) as string[]

export function detectChrome(): string {
  return CHROME_CANDIDATES.find((p) => {
    try {
      return fs.statSync(p).isFile()
    } catch {
      return false
    }
  }) ?? ''
}

function everydayChromeDir(): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data')
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  return path.join(os.homedir(), '.config', 'google-chrome')
}

function configPath(): string {
  return path.join(configDir(), 'browser.json')
}

export function defaultProfileDir(): string {
  return path.join(configDir(), 'chrome-profile')
}

export function getBrowserConfig(): BrowserConfig {
  let saved: Partial<BrowserConfig> = {}
  try {
    saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'))
  } catch {
    /* defaults */
  }
  return {
    enabled: saved.enabled ?? false,
    chromePath: saved.chromePath || detectChrome(),
    userDataDir: saved.userDataDir || defaultProfileDir(),
    profileDirectory: saved.profileDirectory || 'Default',
    headless: saved.headless ?? true,
    setupCompletedAt: saved.setupCompletedAt,
  }
}

function writeConfig(cfg: BrowserConfig) {
  fs.mkdirSync(configDir(), { recursive: true })
  fs.writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8')
}

export function saveBrowserConfig(patch: Partial<BrowserConfig>): BrowserConfig {
  const next = { ...getBrowserConfig(), ...patch }
  if (typeof patch.profileDirectory === 'string') {
    next.profileDirectory = patch.profileDirectory.replace(/[\\/]/g, '').trim() || 'Default'
  }
  // A different profile hasn't been set up yet.
  const current = getBrowserConfig()
  if (next.userDataDir !== current.userDataDir || next.profileDirectory !== current.profileDirectory) {
    next.setupCompletedAt = undefined
  }
  writeConfig(next)
  // A changed profile/binary takes effect on the next launch.
  void closeBrowser()
  return next
}

/* ------------------------------------------------------------------ */
/* Context lifecycle                                                   */
/* ------------------------------------------------------------------ */

let context: BrowserContext | null = null
let mode: 'idle' | 'headless' | 'setup' = 'idle'
let launching: Promise<BrowserContext> | null = null
let idleTimer: NodeJS.Timeout | null = null
let lastError: string | undefined
let lastSearchAt: number | undefined

const IDLE_CLOSE_MS = 5 * 60 * 1000

function armIdleClose() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (mode === 'headless') void closeBrowser()
  }, IDLE_CLOSE_MS)
}

/** Contexts Hermione is closing itself (vs. the operator closing the window). */
const closingByUs = new WeakSet<BrowserContext>()

export async function closeBrowser() {
  const ctx = context
  context = null
  mode = 'idle'
  if (ctx) {
    closingByUs.add(ctx)
    await ctx.close().catch(() => {})
  }
}

async function launch(headless: boolean): Promise<BrowserContext> {
  const cfg = getBrowserConfig()
  if (!cfg.chromePath) throw new Error('Chrome was not found. Set its path in Browser settings.')
  fs.mkdirSync(cfg.userDataDir, { recursive: true })
  const { chromium } = await import('playwright-core')
  try {
    const ctx = await chromium.launchPersistentContext(cfg.userDataDir, {
      executablePath: cfg.chromePath,
      headless,
      args: [`--profile-directory=${cfg.profileDirectory}`, '--no-first-run', '--no-default-browser-check'],
      viewport: headless ? { width: 1280, height: 900 } : null,
    })
    ctx.on('close', () => {
      if (context === ctx) {
        context = null
        mode = 'idle'
      }
    })
    lastError = undefined
    return ctx
  } catch (err: any) {
    const msg = String(err?.message ?? err)
    lastError = /in use|lock|SingletonLock|already running|exitCode=21/i.test(msg)
      ? 'That Chrome profile is already open in another Chrome window. Close it (or use the dedicated Hermione profile) and try again.'
      : msg.split('\n')[0].slice(0, 300)
    throw new Error(lastError)
  }
}

/** Headless context for searches; reused, closed after 5 idle minutes. */
async function headlessContext(): Promise<BrowserContext> {
  if (mode === 'setup') {
    throw new Error('The Chrome profile is open in setup mode — finish there and close that window first.')
  }
  if (context && mode === 'headless') return context
  if (!launching) {
    launching = launch(getBrowserConfig().headless)
      .then((ctx) => {
        context = ctx
        mode = 'headless'
        return ctx
      })
      .finally(() => {
        launching = null
      })
  }
  return launching
}

/**
 * Open the profile in a VISIBLE window so the operator can sign in to Google,
 * accept the consent screen, or clear a captcha themselves.
 */
export async function openSetupWindow(url = 'https://www.google.com/'): Promise<void> {
  await closeBrowser()
  const ctx = await launch(false)
  context = ctx
  mode = 'setup'
  // The operator closing the window = setup done (signed in / consent accepted).
  ctx.on('close', () => {
    if (closingByUs.has(ctx)) return
    try {
      writeConfig({ ...getBrowserConfig(), setupCompletedAt: Date.now() })
      lastError = undefined
    } catch {
      /* status only */
    }
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(url).catch(() => {})
}

export function browserStatus(): BrowserStatus {
  const cfg = getBrowserConfig()
  const norm = (p: string) => path.resolve(p).toLowerCase()
  let profileExists = false
  try {
    profileExists = fs.existsSync(path.join(cfg.userDataDir, cfg.profileDirectory))
  } catch {
    /* no */
  }
  return {
    ...cfg,
    chromeFound: !!cfg.chromePath && fs.existsSync(cfg.chromePath),
    detectedChromePath: detectChrome(),
    profileExists,
    isEverydayProfile: norm(cfg.userDataDir) === norm(everydayChromeDir()),
    running: mode,
    lastError,
    lastSearchAt,
  }
}

/* ------------------------------------------------------------------ */
/* Search through the profile                                          */
/* ------------------------------------------------------------------ */

export interface BrowserSearchResult {
  title: string
  url: string
  snippet: string
}

export class BotWallError extends Error {}

const TIME_RANGE: Record<string, string> = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' }

export async function chromeSearch(
  query: string,
  maxResults: number,
  timeRange?: string,
): Promise<BrowserSearchResult[]> {
  const ctx = await headlessContext()
  const page = await ctx.newPage()
  try {
    const url = new URL('https://www.google.com/search')
    url.searchParams.set('q', query)
    url.searchParams.set('num', String(Math.min(20, maxResults + 3)))
    if (timeRange && TIME_RANGE[timeRange]) url.searchParams.set('tbs', TIME_RANGE[timeRange])
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 25_000 })
    lastSearchAt = Date.now()

    const landed = page.url()
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? '')
    if (/\/sorry\/|consent\.google\./.test(landed) || /unusual traffic|not a robot/i.test(bodyText)) {
      lastError = 'Google showed a bot check or consent screen. Open Browser settings → "Set up profile" and clear it once.'
      throw new BotWallError(lastError)
    }

    const results = await page.evaluate((limit: number) => {
      const out: { title: string; url: string; snippet: string }[] = []
      const seen = new Set<string>()
      for (const h3 of Array.from(document.querySelectorAll('a h3'))) {
        const a = h3.closest('a') as HTMLAnchorElement | null
        const href = a?.href ?? ''
        if (!href.startsWith('http') || /google\.[a-z.]+\/(search|url|aclk)|webcache|accounts\.google/.test(href)) continue
        if (seen.has(href)) continue
        seen.add(href)
        // Walk up to the result block and take its longest text line that is not the title.
        let block: HTMLElement | null = a
        for (let i = 0; i < 6 && block && block.parentElement; i++) {
          block = block.parentElement
          if ((block.innerText || '').length > 160) break
        }
        const title = (h3.textContent || '').trim()
        const snippet = (block?.innerText || '')
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s && s !== title && !s.startsWith('http') && s.length > 40)
          .sort((x, y) => y.length - x.length)[0] ?? ''
        out.push({ title, url: href, snippet: snippet.slice(0, 300) })
        if (out.length >= limit) break
      }
      return out
    }, maxResults)

    if (!results.length) throw new Error('Chrome search returned no parsable results')
    return results
  } finally {
    await page.close().catch(() => {})
    armIdleClose()
  }
}
