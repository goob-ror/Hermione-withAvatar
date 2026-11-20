import fs from 'fs'
import path from 'path'
import type { ToolDef } from '@/lib/agent/types'
import { jobDir, renderClip, type Beat } from '@/lib/media/render'
import { agentAttachFile, agentOpen, liveAvailable } from '@/lib/browser/live'
import { voiceLangFor } from '@/lib/tts/language'

/**
 * Content Forge production tools.
 *   clip_render — the script's beats → a finished 1080×1920 MP4 (free, local).
 *   clip_upload — assisted upload: opens the platform's upload page in the
 *                 operator's live browser and attaches the clip. The operator
 *                 checks everything and presses Publish themselves.
 */

const MAX_BEATS = 12

export function parseBeats(raw: unknown): Beat[] | null {
  if (!Array.isArray(raw)) return null
  const beats: Beat[] = []
  for (const r of raw.slice(0, MAX_BEATS)) {
    const vo = String((r as any)?.vo ?? (r as any)?.voiceover ?? (r as any)?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!vo) continue
    const onScreen = String((r as any)?.on_screen ?? (r as any)?.onScreen ?? '').replace(/\s+/g, ' ').trim()
    const broll = String((r as any)?.broll ?? (r as any)?.b_roll ?? '').replace(/\s+/g, ' ').trim()
    const seconds = Number((r as any)?.seconds)
    beats.push({
      vo: vo.slice(0, 500),
      ...(onScreen ? { onScreen: onScreen.slice(0, 80) } : {}),
      ...(broll ? { broll: broll.slice(0, 80) } : {}),
      ...(Number.isFinite(seconds) && seconds > 0 ? { seconds: Math.min(20, seconds) } : {}),
    })
  }
  return beats.length ? beats : null
}

export const clipRender: ToolDef = {
  name: 'clip_render',
  description:
    'Render a finished vertical short (1080×1920 MP4, ~15–60 s) from your script: VoxCPM2 voiceover per beat (English, or Indonesian for Indonesian scripts), free Pexels stock footage per beat, ' +
    'word-by-word captions and the ON-SCREEN text, levelled audio, plus a cover frame. The operator sees a player in the chat. ' +
    'Pass the beats in order. Takes about a minute. Runs automatically.',
  group: 'inspect',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Working title of the clip' },
      beats: {
        type: 'array',
        description: `The script, in order (1–${MAX_BEATS} beats)`,
        items: {
          type: 'object',
          properties: {
            vo: { type: 'string', description: 'What the voice says in this beat (in the audience language)' },
            on_screen: { type: 'string', description: 'Short text overlay at the top (optional, a few words)' },
            broll: { type: 'string', description: 'Stock footage to search for, in simple ENGLISH words, e.g. "person typing laptop office"' },
            seconds: { type: 'number', description: 'Minimum length of the beat (optional)' },
          },
          required: ['vo'],
        },
      },
      language: { type: 'string', description: 'Two-letter language of the voiceover, e.g. "id" (helps caption timing)' },
    },
    required: ['title', 'beats'],
  },
  async run(args, ctx) {
    const beats = parseBeats(args.beats)
    if (!beats) return { ok: false, output: 'beats must be a list of {vo, on_screen?, broll?}' }
    const title = String(args.title ?? 'clip').replace(/\s+/g, ' ').trim().slice(0, 100) || 'clip'
    const language = /^[a-z]{2}$/i.test(String(args.language ?? '')) ? String(args.language).toLowerCase() : undefined
    try {
      // English by default; Indonesian only for Content Forge clips whose script is Indonesian.
      const voiceLang = voiceLangFor({ purpose: 'clip', mode: ctx.mode, text: beats.map((b) => b.vo).join(' ') })
      const r = await renderClip({ title, beats, language: language ?? voiceLang, voiceLang, mode: ctx.mode })
      ctx.emit({
        type: 'clip_ready',
        jobId: r.jobId,
        title: r.title,
        duration: r.duration,
        video: `/api/media/clip/${r.jobId}/clip.mp4`,
        cover: `/api/media/clip/${r.jobId}/cover.jpg`,
        warnings: r.warnings,
      })
      return {
        ok: true,
        output: [
          `Rendered "${r.title}" — ${r.duration.toFixed(1)} s, 1080×1920. The operator can watch it in the chat.`,
          `job_id: ${r.jobId} (use it with clip_upload)`,
          `file: ${r.file}`,
          `voice: VoxCPM2 (${r.voiceLang === 'id' ? 'Indonesian' : 'English'})`,
          `captions timed by: ${r.captionTiming === 'whisper' ? 'Groq Whisper' : 'estimate (add a free Groq key in Clip setup for exact timing)'}`,
          r.credits.length ? `Stock footage credits (put them in the description):\n${r.credits.map((c) => `- ${c}`).join('\n')}` : 'No stock footage used.',
          r.warnings.length ? `Notes:\n${r.warnings.map((w) => `- ${w}`).join('\n')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }
    } catch (err: any) {
      return { ok: false, output: `Could not render the clip: ${err?.message ?? err}` }
    }
  },
}

const UPLOAD_PAGES: Record<string, string> = {
  youtube: 'https://www.youtube.com/upload',
  tiktok: 'https://www.tiktok.com/tiktokstudio/upload?from=webapp',
}

export const clipUpload: ToolDef = {
  name: 'clip_upload',
  description:
    'Assisted upload of a rendered clip: opens the platform\'s upload page (YouTube Shorts or TikTok) in the operator\'s live browser, where they are signed in, and attaches the clip file. ' +
    'Then fill the title/description fields with page_act from your package, and STOP — never click Publish/Post; tell the operator to review and publish. ' +
    'For Instagram it opens the site and gives the operator the file location. Needs the operator\'s approval.',
  group: 'browse',
  tier: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The job_id clip_render returned' },
      platform: { type: 'string', enum: ['youtube', 'tiktok', 'instagram'] },
    },
    required: ['job_id', 'platform'],
  },
  async run(args, ctx) {
    const jobId = String(args.job_id ?? '').trim()
    if (!/^[a-z0-9-]{1,80}$/.test(jobId)) return { ok: false, output: 'unknown job_id' }
    const file = path.join(jobDir(jobId), 'clip.mp4')
    if (!fs.existsSync(file)) return { ok: false, output: `no rendered clip for ${jobId} — run clip_render first` }
    if (!liveAvailable()) return { ok: false, output: 'the live browser is not available, so uploads must be done by hand' }
    const platform = String(args.platform ?? '')

    if (platform === 'instagram') {
      const r = await agentOpen(ctx.sessionId, 'https://www.instagram.com/')
      ctx.emit({ type: 'preview_ready', url: 'https://www.instagram.com/', title: 'Instagram', textLength: 0 })
      return {
        ok: r.ok,
        output:
          `Opened Instagram in the preview. Instagram has no direct upload page, so the operator clicks Create → Post and picks the clip:\n${file}\n` +
          '(Reels must be 9:16 — this clip already is.)',
      }
    }
    const url = UPLOAD_PAGES[platform]
    if (!url) return { ok: false, output: 'platform must be youtube, tiktok or instagram' }
    const r = await agentAttachFile(ctx.sessionId, url, file)
    ctx.emit({ type: 'preview_ready', url, title: platform === 'youtube' ? 'YouTube upload' : 'TikTok upload', textLength: 0 })
    return {
      ok: r.ok,
      output: r.ok
        ? `${r.output}\n\nNext: fill the title and description from your package with page_act, then STOP and ask the operator to check and press Publish themselves.`
        : r.output,
    }
  },
}
