'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Flame, RefreshCw } from 'lucide-react'
import { COUNTRIES, countryByCode, guessCountry, type Country } from '@/lib/forge/countries'

interface TopicRec {
  headline: string
  angle: string
  category: string
  signal: string
}

interface RecResponse {
  country: string
  countryName: string
  todayTopics: TopicRec[]
  tomorrowTopics: TopicRec[]
  source: 'llm' | 'trends' | 'none'
  model?: string
  generatedAt: number
  expiresAt: number
  cached: boolean
  error?: string
}

const COUNTRY_KEY = 'hermione.forge.country'

/** Local calendar date, YYYY-MM-DD (en-CA formats that way). */
function localToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function readSavedCountry(): Country {
  try {
    const saved = countryByCode(localStorage.getItem(COUNTRY_KEY))
    if (saved) return saved
  } catch {
    /* storage blocked */
  }
  return guessCountry()
}

/**
 * Viral topic recommendations for the operator's country — today and
 * tomorrow, from one cached AI call every two days (see /api/forge/recommendations).
 */
export function TrendRecommendations({
  model,
  providerId,
  onPick,
}: {
  model?: string
  providerId?: string
  onPick: (topic: TopicRec, country: string) => void
}) {
  const [country, setCountry] = useState<Country | null>(null)
  const [data, setData] = useState<RecResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState('')
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')

  // The model only matters when the server has to generate; changing it must not refetch.
  const modelRef = useRef({ model, providerId })
  modelRef.current = { model, providerId }

  useEffect(() => {
    setCountry(readSavedCountry())
  }, [])

  const load = useCallback(async (code: string, refresh = false) => {
    setLoading(true)
    setFailed('')
    try {
      const params = new URLSearchParams({ country: code, today: localToday() })
      try {
        params.set('lang', (navigator.language || 'en').slice(0, 2).toLowerCase())
      } catch {
        /* default en */
      }
      if (modelRef.current.model) params.set('model', modelRef.current.model)
      if (modelRef.current.providerId) params.set('providerId', modelRef.current.providerId)
      if (refresh) params.set('refresh', '1')
      const res = await fetch(`/api/forge/recommendations?${params}`, { cache: 'no-store' })
      const json: RecResponse = await res.json()
      setData(json)
      if (!json.tomorrowTopics?.length) setDay('today')
    } catch (err: any) {
      setFailed(err?.message || 'could not load trends')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (country) load(country.code)
  }, [country, load])

  const changeCountry = (code: string) => {
    const next = countryByCode(code)
    if (!next) return
    try {
      localStorage.setItem(COUNTRY_KEY, next.code)
    } catch {
      /* per-session only */
    }
    setData(null)
    setCountry(next)
  }

  const topics = (day === 'today' ? data?.todayTopics : data?.tomorrowTopics) ?? []
  const hasTomorrow = !!data?.tomorrowTopics?.length

  return (
    <div className="w-full max-w-[640px] flex flex-col gap-2">
      {/* Header: country · day tabs · freshness */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Flame className="size-3.5 text-[#f0956f]" />
          <span>Trending in</span>
          <select
            aria-label="Country"
            value={country?.code ?? ''}
            onChange={(e) => changeCountry(e.target.value)}
            className="bg-[#151416] border border-[#2b292e] rounded-md px-1.5 py-0.5 text-[11px] text-zinc-200 focus:outline-none focus:border-[#6b4a3c] cursor-pointer"
          >
            {/* Names only: Windows renders flag emoji as bare letters ("ID"). */}
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <div role="tablist" className="flex p-0.5 rounded-md bg-[#131214] border border-[#29272b]">
            {(['today', 'tomorrow'] as const).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={day === d}
                disabled={d === 'tomorrow' && !hasTomorrow}
                onClick={() => setDay(d)}
                title={d === 'tomorrow' && !hasTomorrow ? 'Tomorrow’s picks arrive with the next refresh' : undefined}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  day === d ? 'bg-[#2a1d18] text-[#f3c1aa]' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {d === 'today' ? 'Today' : 'Tomorrow'}
              </button>
            ))}
          </div>
          {data && (
            <span
              className="text-[10px] font-mono text-zinc-600"
              title={`Refreshes automatically every 2 days${data.model ? ` · written by ${data.model}` : ''}`}
            >
              {ago(data.generatedAt)}
            </span>
          )}
          <button
            onClick={() => country && load(country.code, true)}
            disabled={loading || !country}
            title="Regenerate now (one AI call). Otherwise this refreshes by itself every 2 days."
            className="p-1 rounded text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Topic cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {loading && !topics.length
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[52px] rounded-lg border border-[#232126] bg-[#141316] animate-pulse" />
            ))
          : topics.map((t) => (
              <button
                key={t.headline}
                onClick={() => country && onPick(t, country.name)}
                title={`${t.angle}${t.signal ? `\n\nSignal: ${t.signal}` : ''}`}
                className="text-left px-3 py-2 rounded-lg border border-[#2b292e] bg-[#151416]/90 hover:border-[#6b4a3c] hover:bg-[#1c1715] transition-colors group"
              >
                <span className="block text-[12px] text-zinc-100 leading-snug group-hover:text-white line-clamp-2">
                  {t.headline}
                </span>
                <span className="block mt-0.5 text-[10px] font-mono text-zinc-500 truncate">
                  {t.category}
                  {t.signal ? ` · ${t.signal}` : ''}
                </span>
              </button>
            ))}
      </div>

      {/* Status line */}
      {!loading && data?.source === 'trends' && (
        <p className="text-[10px] font-mono text-zinc-600 text-center">
          Showing raw search trends — the AI summary is unavailable right now and will retry soon.
        </p>
      )}
      {!loading && (failed || (data && !topics.length)) && (
        <p className="text-[10px] font-mono text-zinc-600 text-center">
          {failed ? `Couldn’t load trends: ${failed}` : 'No trending topics found for this country right now.'}
        </p>
      )}
    </div>
  )
}
