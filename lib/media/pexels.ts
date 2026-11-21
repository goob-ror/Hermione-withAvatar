/**
 * Free stock B-roll from Pexels (free key: 200 requests/hour, 20,000/month).
 * Footage is free to use, including commercially; we still keep the credit.
 */

export interface StockClip {
  id: number
  url: string
  width: number
  height: number
  duration: number
  author: string
  page: string
}

/** The best file for a 1080×1920 vertical frame: portrait first, then closest to 1080 wide, mp4 only. */
export function pickVideoFile(video: any): { link: string; width: number; height: number } | null {
  const files: any[] = (video?.video_files ?? []).filter((f: any) => f?.link && /mp4/i.test(f.file_type ?? 'video/mp4') && f.width && f.height)
  if (!files.length) return null
  const score = (f: any) => {
    const portrait = f.height >= f.width ? 0 : 1000
    const size = Math.abs((f.height >= f.width ? f.width : f.height) - 1080) / 10
    const tooBig = f.width * f.height > 2200 * 2200 ? 500 : 0 // skip 4K: slow to download and encode
    return portrait + size + tooBig
  }
  const best = [...files].sort((a, b) => score(a) - score(b))[0]
  return { link: best.link, width: best.width, height: best.height }
}

export async function searchStock(query: string, key: string, minSeconds: number, used: Set<number>): Promise<StockClip | null> {
  for (const orientation of ['portrait', '']) {
    const url = new URL('https://api.pexels.com/videos/search')
    url.searchParams.set('query', query)
    url.searchParams.set('per_page', '15')
    url.searchParams.set('size', 'medium')
    if (orientation) url.searchParams.set('orientation', orientation)
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) })
    if (res.status === 401 || res.status === 403) throw new Error('the Pexels key was refused — check it in Clip setup')
    if (res.status === 429) throw new Error('Pexels rate limit reached (200 searches/hour) — try again later')
    if (!res.ok) throw new Error(`Pexels ${res.status}`)
    const data = await res.json()
    const videos: any[] = (data?.videos ?? []).filter((v: any) => !used.has(v.id))
    // Prefer clips long enough for the beat, then the longest.
    const sorted = [...videos].sort((a, b) => Number(b.duration >= minSeconds) - Number(a.duration >= minSeconds) || b.duration - a.duration)
    for (const v of sorted) {
      const file = pickVideoFile(v)
      if (!file) continue
      used.add(v.id)
      return { id: v.id, url: file.link, width: file.width, height: file.height, duration: v.duration, author: v.user?.name ?? 'Pexels', page: v.url }
    }
  }
  return null
}
