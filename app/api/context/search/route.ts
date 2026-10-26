import { NextRequest, NextResponse } from 'next/server'
import { unifiedSearch, suggestContext } from '@/lib/context/search'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const query = req.nextUrl.searchParams.get('q') || ''
    const sources = req.nextUrl.searchParams.get('sources')?.split(',') as any[] | undefined
    const maxResults = parseInt(req.nextUrl.searchParams.get('maxResults') || '20')

    if (action === 'search') {
      if (!query) {
        return NextResponse.json({ error: 'Missing query' }, { status: 400 })
      }

      const results = await unifiedSearch(query, {
        sources,
        maxResults,
      })

      return NextResponse.json({ results })
    }

    if (action === 'suggest') {
      if (!query) {
        return NextResponse.json({ error: 'Missing conversation text' }, { status: 400 })
      }

      const suggestions = await suggestContext(query)

      return NextResponse.json({ suggestions })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Context search error:', err)
    return NextResponse.json({ error: 'Failed to search context' }, { status: 500 })
  }
}
