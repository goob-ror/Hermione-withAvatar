import { NextRequest, NextResponse } from 'next/server'
import { addSnippet, listSnippets, deleteSnippet, getSnippet, searchSnippets } from '@/lib/github/client'

export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'list') {
      const language = req.nextUrl.searchParams.get('language') || undefined
      const snippets = listSnippets({ language })
      return NextResponse.json({ snippets })
    }

    if (action === 'get') {
      const id = req.nextUrl.searchParams.get('id')
      if (!id) {
        return NextResponse.json({ error: 'Missing id' }, { status: 400 })
      }
      const snippet = getSnippet(id)
      if (!snippet) {
        return NextResponse.json({ error: 'Snippet not found' }, { status: 404 })
      }
      return NextResponse.json({ snippet })
    }

    if (action === 'search') {
      const q = req.nextUrl.searchParams.get('q') || ''
      const snippets = searchSnippets(q)
      return NextResponse.json({ snippets })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Snippets GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch snippets' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')

    if (action === 'create') {
      const { title, language, code, tags } = await req.json()

      if (!title || !language || !code) {
        return NextResponse.json(
          { error: 'Missing required fields: title, language, code' },
          { status: 400 }
        )
      }

      const snippet = addSnippet({
        title,
        language,
        code,
        tags: tags || [],
      })

      return NextResponse.json({ success: true, snippet })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Snippets POST error:', err)
    return NextResponse.json({ error: 'Failed to create snippet' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const success = deleteSnippet(id)

    if (!success) {
      return NextResponse.json({ error: 'Snippet not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Snippets DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete snippet' }, { status: 500 })
  }
}
