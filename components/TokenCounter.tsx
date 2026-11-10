'use client'

import { Zap } from 'lucide-react'

export interface UsageSum {
  input: number
  output: number
  calls: number
  /** True if any call in the sum was estimated (provider reported nothing). */
  estimated: boolean
}

export const EMPTY_USAGE: UsageSum = { input: 0, output: 0, calls: 0, estimated: false }

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/**
 * Real token usage, as reported by the providers: this chat and today (all
 * chats + background jobs). "~" marks numbers that include estimates.
 */
export function TokenCounter({ chat, today }: { chat: UsageSum; today?: UsageSum | null }) {
  const approx = (u: UsageSum) => (u.estimated ? '~' : '')
  const todayTotal = today ? today.input + today.output : 0
  const title = [
    `This chat: ${chat.input.toLocaleString()} input + ${chat.output.toLocaleString()} output tokens over ${chat.calls} model call${chat.calls === 1 ? '' : 's'}`,
    today
      ? `Today: ${today.input.toLocaleString()} input + ${today.output.toLocaleString()} output over ${today.calls} calls (all chats and background jobs)`
      : '',
    chat.estimated || today?.estimated ? '~ = includes estimates where the provider reported no counts' : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 whitespace-nowrap" title={title}>
      <Zap className="size-3 text-[#d2b278]" />
      {approx(chat)}
      {fmt(chat.input)} in · {fmt(chat.output)} out
      {today && todayTotal > 0 && (
        <span className="text-zinc-600">
          {' '}
          · today {approx(today)}
          {fmt(todayTotal)}
        </span>
      )}
    </span>
  )
}
