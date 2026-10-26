import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export interface GitHubConfig {
  token: string
  owner: string
}

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function githubConfigFile(): string {
  return path.join(configDir(), 'github.json')
}

function loadConfig(): GitHubConfig | null {
  try {
    const file = githubConfigFile()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    console.error('Failed to load GitHub config:', err)
  }
  return null
}

function saveConfig(config: GitHubConfig): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(githubConfigFile(), JSON.stringify(config, null, 2), 'utf-8')
}

export async function GET() {
  try {
    const config = loadConfig()
    
    if (!config) {
      return NextResponse.json({ configured: false })
    }

    return NextResponse.json({
      configured: true,
      owner: config.owner,
      hasToken: !!config.token,
    })
  } catch (err) {
    console.error('GitHub config error:', err)
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token, owner } = await req.json()

    if (!token || !owner) {
      return NextResponse.json({ error: 'Missing token or owner' }, { status: 400 })
    }

    saveConfig({ token, owner })

    return NextResponse.json({
      success: true,
      owner,
    })
  } catch (err) {
    console.error('GitHub config POST error:', err)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const file = githubConfigFile()
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('GitHub config DELETE error:', err)
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 })
  }
}
