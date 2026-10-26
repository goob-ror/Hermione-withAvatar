import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'

const execAsync = promisify(exec)
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'

// GET /api/models - List all registered Ollama models + discovered workspace GGUF files
export async function GET() {
  try {
    let installedModels: any[] = []
    let ollamaOnline = false

    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        installedModels = data.models || []
        ollamaOnline = true
      }
    } catch {
      ollamaOnline = false
    }

    // Scan workspace root for .gguf files
    const workspaceRoot = /* turbopackIgnore: true */ process.cwd()
    let workspaceGgufs: { name: string; path: string; size: number }[] = []
    try {
      const files = fs.readdirSync(/* turbopackIgnore: true */ workspaceRoot)
      workspaceGgufs = files
        .filter((file) => file.toLowerCase().endsWith('.gguf'))
        .map((file) => {
          const fullPath = path.join(/* turbopackIgnore: true */ workspaceRoot, file)
          const stats = fs.statSync(/* turbopackIgnore: true */ fullPath)
          return {
            name: file,
            path: fullPath,
            size: stats.size,
          }
        })
    } catch (e) {
      console.error('Error scanning workspace ggufs:', e)
    }

    return NextResponse.json({
      ollamaOnline,
      models: installedModels,
      workspaceGgufs,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to fetch models', detail: err.message }, { status: 500 })
  }
}

// POST /api/models - Register a model from any local file path or workspace GGUF file
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { modelName, filePath, template, systemPrompt } = body

    if (!modelName || !filePath) {
      return NextResponse.json(
        { error: 'Both modelName and filePath (absolute path or workspace relative) are required' },
        { status: 400 }
      )
    }

    // Resolve full path
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(/* turbopackIgnore: true */ process.cwd(), filePath)

    if (!fs.existsSync(/* turbopackIgnore: true */ resolvedPath)) {
      return NextResponse.json(
        { error: `Model file not found at: ${resolvedPath}` },
        { status: 404 }
      )
    }

    // Format safe name for ollama (lowercase, alphanumeric, dashes, dots, underscores, colons)
    const sanitizedName = modelName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]/g, '-')

    // Write a temporary Modelfile
    const tempModelfilePath = path.join(
      os.tmpdir(),
      `Modelfile_${Date.now()}_${Math.random().toString(36).substring(7)}`
    )

    let modelfileContent = `FROM "${resolvedPath.replace(/\\/g, '/')}"\n`
    if (template) {
      modelfileContent += `TEMPLATE """${template}"""\n`
    }
    if (systemPrompt) {
      modelfileContent += `SYSTEM """${systemPrompt}"""\n`
    }

    fs.writeFileSync(tempModelfilePath, modelfileContent, 'utf-8')

    try {
      // Execute ollama create sanitizedName -f tempModelfilePath
      const { stdout, stderr } = await execAsync(
        `ollama create "${sanitizedName}" -f "${tempModelfilePath}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      )

      // Clean up temp Modelfile
      try {
        fs.unlinkSync(tempModelfilePath)
      } catch {}

      return NextResponse.json({
        success: true,
        modelName: sanitizedName,
        filePath: resolvedPath,
        output: stdout || stderr,
      })
    } catch (createErr: any) {
      try {
        fs.unlinkSync(tempModelfilePath)
      } catch {}

      return NextResponse.json(
        {
          error: 'Failed to create Ollama model',
          detail: createErr.stderr || createErr.message,
        },
        { status: 500 }
      )
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Invalid request', detail: err.message },
      { status: 500 }
    )
  }
}
