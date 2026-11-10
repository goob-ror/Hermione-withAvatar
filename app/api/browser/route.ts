import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import {
  browserStatus,
  chromeSearch,
  closeBrowser,
  defaultProfileDir,
  openSetupWindow,
  saveBrowserConfig,
  type BrowserConfig,
} from '@/lib/browser/chrome'
import { isCrossSite } from '@/lib/http/origin'
import { z } from 'zod'
import { parseBody } from '@/lib/http/validate'

const SettingsBody = z.object({
  enabled: z.boolean().optional(),
  headless: z.boolean().optional(),
  profileDirectory: z.string().max(100).optional(),
  chromePath: z.string().max(1000).optional(),
  userDataDir: z.string().max(1000).optional(),
})

const forbidden = () => NextResponse.json({ error: 'cross-site request refused' }, { status: 403 })

/** GET /api/browser — Chrome profile status for searches. */
export async function GET() {
  return NextResponse.json(browserStatus())
}

/**
 * POST /api/browser — update settings.
 * Body: { enabled?, chromePath?, userDataDir?, profileDirectory?, headless? }
 */
export async function POST(req: NextRequest) {
  if (isCrossSite(req)) return forbidden()
  const parsed = await parseBody(req, SettingsBody)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const patch: Partial<BrowserConfig> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.headless === 'boolean') patch.headless = body.headless
  if (typeof body.profileDirectory === 'string') patch.profileDirectory = body.profileDirectory

  if (typeof body.chromePath === 'string' && body.chromePath.trim()) {
    const p = body.chromePath.trim()
    // Only a Chrome/Chromium binary that exists — this path gets executed.
    if (!/(chrome|chromium)(\.exe)?$|Google Chrome$/i.test(path.basename(p)) || !fs.existsSync(p)) {
      return NextResponse.json({ error: 'chromePath must be an existing chrome / chromium executable' }, { status: 400 })
    }
    patch.chromePath = p
  }
  if (typeof body.userDataDir === 'string') {
    const dir = body.userDataDir.trim() || defaultProfileDir() // empty = back to Hermione's own profile
    if (!path.isAbsolute(dir)) {
      return NextResponse.json({ error: 'userDataDir must be an absolute path' }, { status: 400 })
    }
    patch.userDataDir = dir
  }

  saveBrowserConfig(patch)
  return NextResponse.json(browserStatus())
}

/**
 * PUT /api/browser — actions.
 * Body: { action: 'setup' | 'close' | 'test' }
 *   setup → open the profile in a visible Chrome window (sign in, accept consent, clear a captcha yourself)
 *   close → close Hermione's Chrome
 *   test  → one real search through the profile
 */
export async function PUT(req: NextRequest) {
  if (isCrossSite(req)) return forbidden()
  const parsed = await parseBody(req, z.object({ action: z.enum(['setup', 'close', 'test']) }))
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  try {
    if (body.action === 'setup') {
      await openSetupWindow()
      return NextResponse.json({ ok: true, ...browserStatus() })
    }
    if (body.action === 'close') {
      await closeBrowser()
      return NextResponse.json({ ok: true, ...browserStatus() })
    }
    if (body.action === 'test') {
      const started = Date.now()
      const results = await chromeSearch('weather today', 3)
      return NextResponse.json({
        ok: true,
        latencyMs: Date.now() - started,
        results: results.map((r) => ({ title: r.title, url: r.url })),
        ...browserStatus(),
      })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err), ...browserStatus() }, { status: 200 })
  }
}
