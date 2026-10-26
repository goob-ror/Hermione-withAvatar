import { NextRequest, NextResponse } from 'next/server'
import { approvedHosts, checkVisit, revokeConsent, scanForInstructions, VISIT_WARNING_COPY } from '@/lib/preview/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The visit gate's operator-facing API.
 *
 *   GET  ?sessionId=            → which hosts this session has approved
 *   POST { sessionId, url }     → scan a URL and record approval
 *   DELETE ?sessionId=&host=    → revoke (all hosts when host is omitted)
 */

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  return NextResponse.json({
    sessionId,
    approvedHosts: approvedHosts(sessionId),
    copy: VISIT_WARNING_COPY,
  })
}

/**
 * Scan a URL without fetching it into the run: the operator should see what a
 * page says BEFORE deciding. Fetch is capped and never stored as the session's
 * page, so a denied visit leaves no trace.
 */
export async function PUT(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const url = String(body.url ?? '').trim()
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Hermione/0.6; +local-agent-console)' },
      cache: 'no-store',
    })
    const text = await res.text()
    const warnings = scanForInstructions(text.slice(0, 200000))
    return NextResponse.json({ ok: true, status: res.status, warnings, copy: VISIT_WARNING_COPY })
  } catch (err: any) {
    return NextResponse.json({ ok: false, warnings: [], detail: err?.message ?? String(err) })
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const sessionId = String(body.sessionId ?? '').trim()
  const url = String(body.url ?? '').trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  // Record the operator's decision. The scan itself happens during the fetch;
  // this endpoint exists so the client can approve a host before the retry.
  const decision = checkVisit(sessionId, url, { acknowledged: true })
  return NextResponse.json({
    ...decision,
    approvedHosts: approvedHosts(sessionId),
  })
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  const host = req.nextUrl.searchParams.get('host') ?? undefined
  return NextResponse.json({
    revoked: revokeConsent(sessionId, host),
    approvedHosts: approvedHosts(sessionId),
  })
}