import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * POST /api/tts — convert text to speech using PiperTTS.
 * Body: { text: string }
 * Returns: audio/mpeg blob
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const text = String(body.text ?? '').trim()
  if (!text) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 })
  }

  // Cap at 300 chars to avoid TTS abuse
  const capped = text.slice(0, 300)

  try {
    // Look for PiperTTS in the project root
    const piperDir = join(process.cwd(), 'PiperTTS')
    const piperExe = join(piperDir, 'piper.exe')
    const modelPath = join(piperDir, 'en_US-lessac-medium.onnx')

    // Check if PiperTTS is available
    if (!existsSync(piperExe) || !existsSync(modelPath)) {
      console.warn('PiperTTS not found. TTS disabled. Install from: https://github.com/rhasspy/piper')
      
      // Return silent audio (empty WAV buffer) as graceful fallback
      const silentWav = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x00, 0x00, 0x00, // chunk size
        0x57, 0x41, 0x56, 0x45, // WAVE
        0x66, 0x6d, 0x74, 0x20, // fmt
        0x10, 0x00, 0x00, 0x00, // subchunk1 size
        0x01, 0x00, 0x01, 0x00, // audio format, channels
        0x80, 0xbb, 0x00, 0x00, // sample rate (48000)
        0x00, 0xee, 0x02, 0x00, // byte rate
        0x02, 0x00, 0x10, 0x00, // block align, bits per sample
        0x64, 0x61, 0x74, 0x61, // data
        0x00, 0x00, 0x00, 0x00, // data size
      ])
      
      return new NextResponse(silentWav, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(silentWav.length),
        },
      })
    }

    // Generate audio
    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      const piper = spawn(piperExe, ['--model', modelPath, '--output-raw'], {
        cwd: piperDir,
      })

      piper.stdout.on('data', (chunk) => chunks.push(chunk))
      piper.stderr.on('data', () => {}) // ignore stderr
      piper.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          reject(new Error(`piper exited with code ${code}`))
        }
      })

      piper.stdin.write(capped)
      piper.stdin.end()
    })

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(audioBuffer.length),
      },
    })
  } catch (err: any) {
    console.error('TTS error:', err)
    return NextResponse.json({ error: 'TTS generation failed', detail: err?.message }, { status: 500 })
  }
}
