import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action')

  if (action === 'clear') {
    try {
      // Cache clearing happens on client-side via IndexedDB
      // This endpoint is just a signal to the frontend to clear
      return NextResponse.json({ success: true, message: 'Cache cleared' })
    } catch (err) {
      return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 })
    }
  }

  // Default: return cache status
  return NextResponse.json({
    status: 'Live2D caching enabled',
    backend: 'IndexedDB',
    preloadOnStartup: true,
  })
}
