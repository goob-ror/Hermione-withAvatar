import { NextRequest, NextResponse } from 'next/server'
import { getRecommendations } from '@/lib/forge/recommendations'

/**
 * GET /api/forge/recommendations?country=ID&today=YYYY-MM-DD[&providerId=&model=&refresh=1]
 *
 * Viral topic recommendations for today and tomorrow, grounded in live Google
 * Trends signals. Cached for 48 h per country — the LLM runs at most once
 * every two days unless `refresh=1` is passed.
 */
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams
  const country = (params.get('country') || 'US').slice(0, 2)
  const todayParam = params.get('today') || ''
  // The client sends its local date so "today" matches the operator's calendar.
  const today = /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? todayParam : new Date().toISOString().slice(0, 10)

  const result = await getRecommendations({
    country,
    today,
    lang: (params.get('lang') || 'en').slice(0, 2).toLowerCase(),
    providerId: params.get('providerId') || undefined,
    model: params.get('model') || undefined,
    refresh: params.get('refresh') === '1',
  })
  return NextResponse.json(result)
}
