'use client'

import type { SVGProps } from 'react'

export type AppMode = 'chat' | 'forge'

/**
 * Content Forge mark: a vertical (9:16) video frame with a play button and a
 * spark beside it — short-form content, being made.
 */
export function ForgeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* 9:16 frame */}
      <rect x="3.5" y="4" width="11.5" height="17.5" rx="2.5" />
      {/* play */}
      <path d="M8 10.2 12 12.75 8 15.3Z" fill="currentColor" stroke="none" />
      {/* spark */}
      <path
        d="M19 1.9 19.85 4.15 22.1 5 19.85 5.85 19 8.1 18.15 5.85 15.9 5 18.15 4.15Z"
        fill="currentColor"
        stroke="none"
      />
      {/* engagement tick marks (like / share rail) */}
      <path d="M19 11v.01M19 14.5v.01M19 18v.01" strokeWidth={2.4} />
    </svg>
  )
}

/** Chat mark: a speech bubble, drawn to match the Forge icon's weight. */
export function ChatIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M20.5 12a8 8 0 0 1-11.6 7.15L4 20.5l1.35-4.9A8 8 0 1 1 20.5 12Z" />
      <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth={2.4} />
    </svg>
  )
}

const MODES: { id: AppMode; label: string; hint: string; Icon: typeof ForgeIcon }[] = [
  { id: 'chat', label: 'Chat', hint: 'General assistant — files, shell, research', Icon: ChatIcon },
  { id: 'forge', label: 'Content Forge', hint: 'Find viral topics and turn them into clips', Icon: ForgeIcon },
]

/** Segmented Chat / Content Forge switch. Each mode keeps its own sessions. */
export function ModeSwitcher({
  mode,
  onChange,
  disabled,
}: {
  mode: AppMode
  onChange: (mode: AppMode) => void
  disabled?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Workspace mode"
      className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#131214] border border-[#29272b]"
    >
      {MODES.map(({ id, label, hint, Icon }) => {
        const active = mode === id
        const accent = id === 'forge' ? 'text-[#f0956f]' : 'text-[#d2b278]'
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            title={hint}
            disabled={disabled && !active}
            onClick={() => !active && onChange(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? 'bg-[#232126] text-white shadow-[inset_0_0_0_1px_#35323a]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1b1a1d]'
            }`}
          >
            <Icon className={`size-3.5 ${active ? accent : ''}`} />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
