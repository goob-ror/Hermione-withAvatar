import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { configDir } from '@/lib/agent/providers'
import { getSession, persistSession } from '@/lib/agent/session'
import { defaultRoot, rememberWorkspace, suggestFolders, workspaceProblem } from '@/lib/agent/workspace'
import { id, parseBody } from '@/lib/http/validate'

/**
 * A session's project folder (picked with @ in a message).
 *   GET ?sessionId=…  → { workspace: string | null, defaultRoot }
 *   GET ?q=…          → { suggestions: [{ path, name, recent }] } for the composer's @ menu
 *   POST { sessionId, path: string | null } → set it, or go back to Hermione's own folder
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  if (p.has('q')) return NextResponse.json({ suggestions: suggestFolders(p.get('q') ?? '', configDir()) })
  const sessionId = p.get('sessionId') ?? ''
  return NextResponse.json({ workspace: (sessionId && getSession(sessionId)?.workspace) || null, defaultRoot: defaultRoot() })
}

const Body = z.object({ sessionId: id(), path: z.string().trim().min(1).max(1000).nullable() })

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, Body)
  if (!parsed.ok) return parsed.response
  const session = getSession(parsed.data.sessionId)
  if (!session) return NextResponse.json({ error: 'unknown session' }, { status: 404 })
  if (parsed.data.path === null) {
    session.workspace = undefined
  } else {
    const problem = workspaceProblem(parsed.data.path, configDir())
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })
    session.workspace = parsed.data.path
    rememberWorkspace(configDir(), parsed.data.path)
  }
  persistSession(session)
  return NextResponse.json({ workspace: session.workspace ?? null, defaultRoot: defaultRoot() })
}
