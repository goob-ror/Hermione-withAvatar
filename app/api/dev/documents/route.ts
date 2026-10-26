import { NextRequest, NextResponse } from 'next/server'
import {
  generateReadme,
  generateApiDocs,
  generateSetupGuide,
  generateArchitectureDiagram,
  generateChangelogEntry,
  analyzeProjectStructure,
} from '@/lib/dev/document-generator'

export async function POST(req: NextRequest) {
  try {
    const action = req.nextUrl.searchParams.get('action')
    const body = await req.json()

    if (action === 'readme') {
      const { metadata, features, sections, options } = body
      const readme = generateReadme(metadata, features || [], sections || {}, options || {})
      return NextResponse.json({ success: true, content: readme })
    }

    if (action === 'api-docs') {
      const { endpoints } = body
      if (!endpoints) {
        return NextResponse.json({ error: 'Missing endpoints' }, { status: 400 })
      }
      const docs = generateApiDocs(endpoints)
      return NextResponse.json({ success: true, content: docs })
    }

    if (action === 'setup-guide') {
      const { projectName, steps, troubleshooting } = body
      if (!projectName || !steps) {
        return NextResponse.json({ error: 'Missing projectName or steps' }, { status: 400 })
      }
      const guide = generateSetupGuide(projectName, steps, troubleshooting)
      return NextResponse.json({ success: true, content: guide })
    }

    if (action === 'architecture') {
      const { layers } = body
      if (!layers) {
        return NextResponse.json({ error: 'Missing layers' }, { status: 400 })
      }
      const diagram = generateArchitectureDiagram(layers)
      return NextResponse.json({ success: true, content: diagram })
    }

    if (action === 'changelog') {
      const { version, date, changes } = body
      if (!version || !date || !changes) {
        return NextResponse.json({ error: 'Missing version, date, or changes' }, { status: 400 })
      }
      const entry = generateChangelogEntry(version, date, changes)
      return NextResponse.json({ success: true, content: entry })
    }

    if (action === 'analyze') {
      const { rootPath } = body
      if (!rootPath) {
        return NextResponse.json({ error: 'Missing rootPath' }, { status: 400 })
      }
      const analysis = analyzeProjectStructure(rootPath)
      return NextResponse.json({ success: true, analysis })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Document generation error:', err)
    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 })
  }
}
