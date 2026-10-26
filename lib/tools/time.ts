import type { ToolDef } from '@/lib/agent/types'

export const getTime: ToolDef = {
  name: 'get_time',
  description: 'Get current date, time, and timezone information. No arguments required.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async run() {
    const now = new Date()
    const utc = now.toISOString()
    const locale = new Intl.DateTimeFormat('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
      hour12: false,
    }).format(now)

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const tzOffset = -now.getTimezoneOffset()
    const sign = tzOffset >= 0 ? '+' : '-'
    const hours = String(Math.abs(Math.floor(tzOffset / 60))).padStart(2, '0')
    const mins = String(Math.abs(tzOffset % 60)).padStart(2, '0')

    return {
      ok: true,
      output: [
        `# Current Time`,
        `UTC: ${utc}`,
        `Local: ${locale}`,
        `Timezone: ${tz} (UTC${sign}${hours}:${mins})`,
        `Timestamp: ${now.getTime()}`,
      ].join('\n'),
    }
  },
}

export const getCalendar: ToolDef = {
  name: 'get_calendar',
  description:
    'Get calendar information: current month, week, or a specific date range. Shows day of week, date formatting helpers.',
  group: 'browse',
  tier: 'auto',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['today', 'week', 'month'],
        description: 'today = just today, week = current week (Mon-Sun), month = current month',
      },
      year: { type: 'number', description: 'Year (default: current year)' },
      month: { type: 'number', description: 'Month 1-12 (default: current month)' },
    },
    required: [],
  },
  async run(args) {
    const mode = (args.mode as string) || 'today'
    const now = new Date()

    const year = Number(args.year) || now.getFullYear()
    const month = Number(args.month) || now.getMonth() + 1

    if (month < 1 || month > 12) {
      return { ok: false, output: 'month must be 1-12' }
    }

    const lines: string[] = []
    lines.push(`# Calendar — ${new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`)

    if (mode === 'today') {
      const today = new Date(year, month - 1, now.getDate())
      const dayName = today.toLocaleDateString('en-US', { weekday: 'long' })
      const formatted = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      lines.push(`${dayName}, ${formatted}`)
    } else if (mode === 'week') {
      const startDate = new Date()
      const day = startDate.getDay()
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1)
      const weekStart = new Date(startDate.setDate(diff))

      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
        const dateStr = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })
        const marker = d.toDateString() === now.toDateString() ? ' ← today' : ''
        lines.push(`${dayName} ${dateStr}${marker}`)
      }
    } else if (mode === 'month') {
      const firstDay = new Date(year, month - 1, 1).getDay()
      const daysInMonth = new Date(year, month, 0).getDate()

      const calendar: (number | null)[] = Array(firstDay).fill(null)
      for (let i = 1; i <= daysInMonth; i++) calendar.push(i)

      lines.push('Su Mo Tu We Th Fr Sa')

      for (let i = 0; i < calendar.length; i += 7) {
        const week = calendar.slice(i, i + 7)
        const row = week
          .map((d) => {
            if (d === null) return '   '
            const marker = d === now.getDate() && year === now.getFullYear() && month === now.getMonth() + 1 ? '*' : ' '
            return String(d).padStart(2, ' ') + marker
          })
          .join(' ')
        lines.push(row)
      }
      lines.push('(* = today)')
    }

    return { ok: true, output: lines.join('\n') }
  },
}
