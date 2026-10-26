import { NextRequest, NextResponse } from 'next/server'
import { loadSession, type SessionData } from '@/lib/storage/sessions'

/**
 * GET /api/sessions/[id] — load a specific session by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
  }

  try {
    const session = loadSession(sessionId)
    
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    return NextResponse.json({ session })
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to load session' },
      { status: 500 },
    )
  }
}
