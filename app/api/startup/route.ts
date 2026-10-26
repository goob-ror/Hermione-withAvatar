import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { loadAgentProfile, saveAgentProfile } from '@/lib/storage/sessions'

function configDir(): string {
  return path.resolve(
    process.env.HERMIONE_CONFIG_DIR || path.join(process.cwd(), '.hermione'),
  )
}

function configFile(): string {
  return path.join(configDir(), 'startup.json')
}

interface StartupConfig {
  initialized: boolean
  aiProvider: {
    kind: 'ollama' | 'openai' | 'cloudflare'
    label: string
    baseUrl?: string
    apiKey?: string
    model?: string
  }
  ttsProvider: {
    kind: 'local' | 'cloudflare' | 'skip'
    label: string
    apiKey?: string
    accountId?: string
  }
  agentName: string
}

export async function GET() {
  try {
    const file = configFile()
    
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
      // Don't return API keys to frontend
      const safe = {
        ...data,
        aiProvider: {
          ...data.aiProvider,
          apiKey: data.aiProvider.apiKey ? '••••••••' : undefined,
        },
        ttsProvider: {
          ...data.ttsProvider,
          apiKey: data.ttsProvider.apiKey ? '••••••••' : undefined,
        },
      }
      return NextResponse.json(safe)
    }

    return NextResponse.json({ initialized: false })
  } catch (err) {
    console.error('Failed to load startup config:', err)
    return NextResponse.json({ initialized: false })
  }
}

export async function POST(req: NextRequest) {
  try {
    const config: StartupConfig = await req.json()
    
    // Validate
    if (!config.agentName || !config.aiProvider || !config.ttsProvider) {
      return NextResponse.json({ error: 'Invalid config' }, { status: 400 })
    }

    // Save config
    const dir = configDir()
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    config.initialized = true
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2), 'utf-8')

    // Initialize agent profile
    const profile = loadAgentProfile()
    profile.name = config.agentName
    saveAgentProfile(profile)

    // Add provider to providers.json if OpenAI-compatible
    if (config.aiProvider.kind === 'openai' && config.aiProvider.baseUrl && config.aiProvider.apiKey) {
      const providersFile = path.join(dir, 'providers.json')
      let providers: any = { version: 1, activeId: '', providers: [] }
      
      if (fs.existsSync(providersFile)) {
        providers = JSON.parse(fs.readFileSync(providersFile, 'utf-8'))
      }

      const newProvider = {
        id: `openai-startup-${Date.now()}`,
        label: config.aiProvider.label,
        kind: 'openai',
        baseUrl: config.aiProvider.baseUrl,
        apiKey: config.aiProvider.apiKey,
        defaultModel: config.aiProvider.model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      providers.providers.push(newProvider)
      providers.activeId = newProvider.id
      fs.writeFileSync(providersFile, JSON.stringify(providers, null, 2), 'utf-8')
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to save startup config:', err)
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const file = configFile()
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Failed to delete startup config:', err)
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 })
  }
}
