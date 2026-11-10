import { NextRequest, NextResponse } from 'next/server'
import { listRecentSessions, type SessionData } from '@/lib/storage/sessions'

/**
 * GET /api/sessions — list recent saved sessions for the sidebar
 * Query: ?limit=20 (optional, default 20)
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const limit = Math.min(Number(params.get('limit') || 20), 100)
  // ?mode=chat|forge — each flow keeps its own history. Old files without a mode are chat.
  const mode = params.get('mode')

  try {
    const all = listRecentSessions(mode ? 200 : limit)
    const sessions = (mode ? all.filter((s) => (s.mode ?? 'chat') === mode) : all).slice(0, limit)
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        mode: s.mode ?? 'chat',
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.metadata.messageCount,
        lastActivity: s.metadata.lastActivity,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 },
    )
  }
}
