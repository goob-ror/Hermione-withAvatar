import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest, NextResponse } from 'next/server'
import { jobDir } from '@/lib/media/render'

/**
 * GET /api/media/clip/<jobId>/<file> — a rendered clip's files for the chat
 * player (with Range support so the video can seek). Only known file names.
 */
const FILES: Record<string, string> = {
  'clip.mp4': 'video/mp4',
  'cover.jpg': 'image/jpeg',
  'voice.wav': 'audio/wav',
  'captions.ass': 'text/plain; charset=utf-8',
  'credits.txt': 'text/plain; charset=utf-8',
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ jobId: string; file: string }> }) {
  const { jobId, file } = await ctx.params
  if (!/^[a-z0-9-]{1,80}$/.test(jobId) || !FILES[file]) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const full = path.join(jobDir(jobId), file)
  let size: number
  try {
    size = fs.statSync(full).size
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const download = req.nextUrl.searchParams.get('download') === '1'
  const headers: Record<string, string> = {
    'Content-Type': FILES[file],
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(download ? { 'Content-Disposition': `attachment; filename="${jobId}-${file}"` } : {}),
  }
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
    if (start >= size || start > end) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const stream = Readable.toWeb(fs.createReadStream(full, { start, end })) as ReadableStream
    return new NextResponse(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    })
  }
  return new NextResponse(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, { headers: { ...headers, 'Content-Length': String(size) } })
}
