import { NextRequest, NextResponse } from 'next/server'
import { listRecentSessions, type SessionData } from '@/lib/storage/sessions'

/**
 * GET /api/sessions — list recent saved sessions for the sidebar
 * Query: ?limit=20 (optional, default 20)
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') || 20), 100)

  try {
    const sessions = listRecentSessions(limit)
    return NextResponse.json({
      sessions: sessions.map((s) => ({
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
