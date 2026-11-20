'use client'

import { Download, Film, TriangleAlert } from 'lucide-react'

export interface ClipData {
  jobId: string
  title: string
  duration: number
  video: string
  cover: string
  warnings: string[]
}

/** A rendered clip in the chat: a 9:16 player, its length, a download link and any notes. */
export function ClipCard({ clip }: { clip: ClipData }) {
  return (
    <div className="clip-card">
      <video className="clip-video" src={clip.video} poster={clip.cover} controls playsInline preload="metadata" />
      <div className="clip-side">
        <div className="clip-title">
          <Film className="size-4" />
          <strong>{clip.title}</strong>
        </div>
        <span className="clip-meta">
          1080×1920 · {clip.duration.toFixed(1)} s · MP4
        </span>
        <a className="clip-download" href={`${clip.video}?download=1`} download>
          <Download className="size-3.5" /> Download
        </a>
        <a className="clip-link" href={`${clip.cover}?download=1`} download>
          Cover image
        </a>
        {clip.warnings.length > 0 && (
          <ul className="clip-warnings">
            {clip.warnings.map((w) => (
              <li key={w}>
                <TriangleAlert className="size-3 flex-none" /> {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
