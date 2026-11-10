import { NextResponse } from 'next/server'
import { usageToday } from '@/lib/agent/usage'
import { listProviders } from '@/lib/agent/providers'

/** GET /api/usage — today's token totals, overall and per provider. */
export async function GET() {
  const { day, total, byProvider } = usageToday()
  const labels = Object.fromEntries(listProviders().map((p) => [p.id, p.label]))
  return NextResponse.json({
    day,
    total,
    providers: Object.entries(byProvider).map(([id, totals]) => ({ id, label: labels[id] ?? id, ...totals })),
  })
}
