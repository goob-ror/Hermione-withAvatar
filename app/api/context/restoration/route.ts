import { NextRequest, NextResponse } from 'next/server'
import {
  getSessionContext,
  saveSessionContext,
  setActiveEmail,
  setActiveTask,
  setActiveEvent,
  setActiveFile,
  setActiveIssue,
  addTopic,
  setConversationSummary,
  getRecentResources,
  getSuggestions,
  clearSessionContext,
  restorePreviousSession,
} from '@/lib/context/restoration'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const sessionId = req.nextUrl.searchParams.get('sessionId')

    if (action === 'get' && sessionId) {
      const ctx = getSessionContext(sessionId)
      return NextResponse.json({ context: ctx })
    }

    if (action === 'suggestions' && sessionId) {
      const suggestions = getSuggestions(sessionId)
      return NextResponse.json({ suggestions })
    }

    if (action === 'recent' && sessionId) {
      const limit = parseInt(req.nextUrl.searchParams.get('limit') || '5')
      const resources = getRecentResources(sessionId, limit)
      return NextResponse.json({ resources })
    }

    if (action === 'restore') {
      const previous = restorePreviousSession()
      if (previous) {
        return NextResponse.json({ previous })
      }
      return NextResponse.json({ previous: null })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Context restoration GET error:', err)
    return NextResponse.json({ error: 'Failed to get context' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const sessionId = req.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    const body = await req.json()

    if (action === 'set-active-email') {
      setActiveEmail(sessionId, body)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-active-task') {
      setActiveTask(sessionId, body)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-active-event') {
      setActiveEvent(sessionId, body)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-active-file') {
      setActiveFile(sessionId, body)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-active-issue') {
      setActiveIssue(sessionId, body)
      return NextResponse.json({ success: true })
    }

    if (action === 'add-topic') {
      const topic = body.topic
      if (!topic) {
        return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
      }
      addTopic(sessionId, topic)
      return NextResponse.json({ success: true })
    }

    if (action === 'set-summary') {
      const summary = body.summary
      if (!summary) {
        return NextResponse.json({ error: 'Missing summary' }, { status: 400 })
      }
      setConversationSummary(sessionId, summary)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Context restoration POST error:', err)
    return NextResponse.json({ error: 'Failed to update context' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId')

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 })
    }

    clearSessionContext(sessionId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Context restoration DELETE error:', err)
    return NextResponse.json({ error: 'Failed to clear context' }, { status: 500 })
  }
}
