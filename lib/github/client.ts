/**
 * GitHub integration for Hermione
 * 
 * Supports:
 * - Create/list/update issues
 * - Search repositories
 * - List pull requests
 * - Check CI status
 * - Get commit info
 * - Snippet library (local storage)
 */

import fs from 'fs'
import path from 'path'
import https from 'https'

export interface GitHubConfig {
  token: string
  owner: string
}

export interface GitHubIssue {
  id: number
  number: number
  title: string
  body?: string
  state: 'open' | 'closed'
  labels: string[]
  assignee?: string
  createdAt: string
  updatedAt: string
  url: string
}

export interface GitHubPullRequest {
  id: number
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  author: string
  createdAt: string
  updatedAt: string
  url: string
  isDraft: boolean
}

export interface GitHubRepository {
  name: string
  owner: string
  description?: string
  url: string
  language?: string
  stars: number
  isPrivate: boolean
}

export interface CodeSnippet {
  id: string
  title: string
  language: string
  code: string
  tags: string[]
  createdAt: number
}

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function snippetsFile(): string {
  return path.join(configDir(), 'snippets.json')
}

function loadSnippets(): CodeSnippet[] {
  try {
    const file = snippetsFile()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load snippets:', err)
  }
  return []
}

function saveSnippets(snippets: CodeSnippet[]): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(snippetsFile(), JSON.stringify(snippets, null, 2), 'utf-8')
}

async function githubRequest(
  token: string,
  path: string,
  method: string = 'GET',
  body?: any
): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'Hermione-AI',
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GitHub API error: ${res.statusCode} ${parsed.message}`))
          } else {
            resolve(parsed)
          }
        } catch (err) {
          reject(err)
        }
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(JSON.stringify(body))
    }

    req.end()
  })
}

export async function createIssue(
  config: GitHubConfig,
  repo: string,
  issue: {
    title: string
    body?: string
    labels?: string[]
    assignees?: string[]
  }
): Promise<GitHubIssue> {
  const result = await githubRequest(
    config.token,
    `/repos/${config.owner}/${repo}/issues`,
    'POST',
    {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      assignees: issue.assignees,
    }
  )

  return {
    id: result.id,
    number: result.number,
    title: result.title,
    body: result.body,
    state: result.state,
    labels: result.labels.map((l: any) => l.name),
    assignee: result.assignee?.login,
    createdAt: result.created_at,
    updatedAt: result.updated_at,
    url: result.html_url,
  }
}

export async function listIssues(
  config: GitHubConfig,
  repo: string,
  options?: {
    state?: 'open' | 'closed' | 'all'
    labels?: string[]
    assignee?: string
    limit?: number
  }
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams({
    state: options?.state || 'open',
    per_page: String(Math.min(options?.limit || 30, 100)),
  })

  if (options?.labels) {
    params.set('labels', options.labels.join(','))
  }

  if (options?.assignee) {
    params.set('assignee', options.assignee)
  }

  const result = await githubRequest(
    config.token,
    `/repos/${config.owner}/${repo}/issues?${params}`
  )

  return result.map((issue: any) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map((l: any) => l.name),
    assignee: issue.assignee?.login,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
  }))
}

export async function listPullRequests(
  config: GitHubConfig,
  repo: string,
  options?: {
    state?: 'open' | 'closed' | 'all'
    limit?: number
  }
): Promise<GitHubPullRequest[]> {
  const params = new URLSearchParams({
    state: options?.state || 'open',
    per_page: String(Math.min(options?.limit || 30, 100)),
  })

  const result = await githubRequest(
    config.token,
    `/repos/${config.owner}/${repo}/pulls?${params}`
  )

  return result.map((pr: any) => ({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.merged ? 'merged' : pr.state,
    author: pr.user.login,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    url: pr.html_url,
    isDraft: pr.draft,
  }))
}

export async function getRepository(
  config: GitHubConfig,
  repo: string
): Promise<GitHubRepository> {
  const result = await githubRequest(config.token, `/repos/${config.owner}/${repo}`)

  return {
    name: result.name,
    owner: result.owner.login,
    description: result.description,
    url: result.html_url,
    language: result.language,
    stars: result.stargazers_count,
    isPrivate: result.private,
  }
}

export async function searchRepositories(
  config: GitHubConfig,
  query: string,
  limit?: number
): Promise<GitHubRepository[]> {
  const params = new URLSearchParams({
    q: `${query} user:${config.owner}`,
    per_page: String(Math.min(limit || 10, 100)),
  })

  const result = await githubRequest(
    config.token,
    `/search/repositories?${params}`
  )

  return result.items.map((repo: any) => ({
    name: repo.name,
    owner: repo.owner.login,
    description: repo.description,
    url: repo.html_url,
    language: repo.language,
    stars: repo.stargazers_count,
    isPrivate: repo.private,
  }))
}

export async function getWorkflowStatus(
  config: GitHubConfig,
  repo: string,
  branch: string = 'main'
): Promise<{ status: string; conclusion: string; url: string } | null> {
  try {
    const result = await githubRequest(
      config.token,
      `/repos/${config.owner}/${repo}/actions/runs?branch=${branch}&per_page=1`
    )

    if (result.workflow_runs?.length === 0) {
      return null
    }

    const run = result.workflow_runs[0]
    return {
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
    }
  } catch (err) {
    console.error('Failed to get workflow status:', err)
    return null
  }
}

// Snippet library operations

export function addSnippet(snippet: Omit<CodeSnippet, 'id' | 'createdAt'>): CodeSnippet {
  const snippets = loadSnippets()

  const newSnippet: CodeSnippet = {
    ...snippet,
    id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  }

  snippets.push(newSnippet)
  saveSnippets(snippets)

  return newSnippet
}

export function listSnippets(filter?: { language?: string; tags?: string[] }): CodeSnippet[] {
  let snippets = loadSnippets()

  if (filter?.language) {
    snippets = snippets.filter(s => s.language === filter.language)
  }

  if (filter?.tags) {
    snippets = snippets.filter(s => filter.tags!.some(t => s.tags.includes(t)))
  }

  return snippets
}

export function getSnippet(id: string): CodeSnippet | null {
  const snippets = loadSnippets()
  return snippets.find(s => s.id === id) || null
}

export function deleteSnippet(id: string): boolean {
  const snippets = loadSnippets()
  const index = snippets.findIndex(s => s.id === id)

  if (index === -1) return false

  snippets.splice(index, 1)
  saveSnippets(snippets)
  return true
}

export function searchSnippets(query: string): CodeSnippet[] {
  const snippets = loadSnippets()
  const lower = query.toLowerCase()

  return snippets.filter(
    s =>
      s.title.toLowerCase().includes(lower) ||
      s.code.toLowerCase().includes(lower) ||
      s.tags.some(t => t.toLowerCase().includes(lower))
  )
}
