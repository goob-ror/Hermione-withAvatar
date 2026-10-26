import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { listIssues, createIssue, listPullRequests, searchRepositories, getWorkflowStatus } from '@/lib/github/client'

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function loadGitHubConfig() {
  try {
    const file = path.join(configDir(), 'github.json')
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load GitHub config:', err)
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const config = loadGitHubConfig()
    if (!config) {
      return NextResponse.json({ error: 'GitHub not configured' }, { status: 400 })
    }

    const action = req.nextUrl.searchParams.get('action')
    const repo = req.nextUrl.searchParams.get('repo') || ''

    if (action === 'issues') {
      const state = req.nextUrl.searchParams.get('state') as 'open' | 'closed' | 'all' | undefined
      const issues = await listIssues(config, repo, { state })
      return NextResponse.json({ issues })
    }

    if (action === 'prs') {
      const state = req.nextUrl.searchParams.get('state') as 'open' | 'closed' | 'all' | undefined
      const prs = await listPullRequests(config, repo, { state })
      return NextResponse.json({ prs })
    }

    if (action === 'workflow-status') {
      const branch = req.nextUrl.searchParams.get('branch') || 'main'
      const status = await getWorkflowStatus(config, repo, branch)
      return NextResponse.json({ status })
    }

    if (action === 'search-repos') {
      const query = req.nextUrl.searchParams.get('q') || ''
      const repos = await searchRepositories(config, query)
      return NextResponse.json({ repos })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('GitHub GET error:', err)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const config = loadGitHubConfig()
    if (!config) {
      return NextResponse.json({ error: 'GitHub not configured' }, { status: 400 })
    }

    const action = req.nextUrl.searchParams.get('action')
    const repo = req.nextUrl.searchParams.get('repo') || ''
    const body = await req.json()

    if (action === 'create-issue') {
      const issue = await createIssue(config, repo, {
        title: body.title,
        body: body.body,
        labels: body.labels,
        assignees: body.assignees,
      })
      return NextResponse.json({ success: true, issue })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('GitHub POST error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
