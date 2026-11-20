import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  compactViews,
  jsonAfter,
  parseYouTubeResults,
  transcriptLines,
  transcriptPanelLines,
  videoCardLine,
  viewsNumber,
  youtubeId,
} from '@/lib/tools/video'
import { normalizeTopics } from '@/lib/forge/recommendations'
import { describeTool } from '@/lib/agent/stepText'
import { ChatMarkdown } from '@/components/ChatMarkdown'

describe('YouTube parsing', () => {
  it('finds the JSON after a marker, even with braces inside strings', () => {
    const html = `<script>var ytInitialData = {"a":"x } y","b":{"c":[1,2]}};</script>`
    expect(jsonAfter(html, 'ytInitialData')).toEqual({ a: 'x } y', b: { c: [1, 2] } })
    expect(jsonAfter('nothing here', 'ytInitialData')).toBeNull()
  })

  it('reads regular results, the Shorts shelf and reels, without duplicates', () => {
    const data = {
      contents: [
        {
          videoRenderer: {
            videoId: 'aaaaaaaaaaa',
            title: { runs: [{ text: 'CPNS 2026 cara daftar' }] },
            viewCountText: { simpleText: '1,234,567 views' },
            ownerText: { runs: [{ text: 'HaloLearn' }] },
            publishedTimeText: { simpleText: '3 days ago' },
            lengthText: { simpleText: '0:58' },
          },
        },
        {
          videoRenderer: {
            videoId: 'bbbbbbbbbbb',
            title: { runs: [{ text: 'Long explainer' }] },
            viewCountText: { simpleText: '9,000 views' },
            lengthText: { simpleText: '25:10' },
          },
        },
        {
          shelf: {
            items: [
              {
                shortsLockupViewModel: {
                  entityId: 'shorts-shelf-item-ccccccccccc',
                  overlayMetadata: { primaryText: { content: 'Jangan gugur CPNS!' }, secondaryText: { content: '2.4M views' } },
                },
              },
              { reelItemRenderer: { videoId: 'aaaaaaaaaaa', headline: { simpleText: 'dupe' } } },
            ],
          },
        },
      ],
    }
    const hits = parseYouTubeResults(data, 10)
    expect(hits.map((h) => h.id)).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'])
    expect(hits[0]).toMatchObject({ creator: 'HaloLearn', viewCount: 1234567, short: true, published: '3 days ago' })
    expect(hits[1].short).toBe(false)
    expect(hits[2]).toMatchObject({ title: 'Jangan gugur CPNS!', viewCount: 2_400_000, url: 'https://www.youtube.com/shorts/ccccccccccc' })
  })

  it('reads view counts and video ids in their usual forms', () => {
    expect(viewsNumber('1.2M views')).toBe(1_200_000)
    expect(viewsNumber('12,345 views')).toBe(12345)
    expect(viewsNumber(undefined)).toBeUndefined()
    expect(compactViews(2_400_000)).toBe('2.4M views')
    expect(compactViews(1000)).toBe('1K views')
    expect(youtubeId('https://www.youtube.com/shorts/ccccccccccc?feature=share')).toBe('ccccccccccc')
    expect(youtubeId('https://youtu.be/aaaaaaaaaaa')).toBe('aaaaaaaaaaa')
    expect(youtubeId('https://www.youtube.com/watch?app=desktop&v=bbbbbbbbbbb')).toBe('bbbbbbbbbbb')
    expect(youtubeId('https://example.com')).toBeNull()
  })

  it('reads localized view counts (titles stay in the region language)', () => {
    expect(viewsNumber('280.783 x ditonton', 'id')).toBe(280783)
    expect(viewsNumber('1,2 jt x ditonton', 'id')).toBe(1_200_000)
    expect(viewsNumber('38 rb x ditonton', 'id')).toBe(38_000)
    expect(viewsNumber('2 M x ditonton', 'id')).toBe(2_000_000_000)
    expect(viewsNumber('2.4M views', 'en')).toBe(2_400_000)
    expect(viewsNumber('1,5 mi de visualizações', 'pt')).toBe(1_500_000)
  })

  it('reads the transcript panel', () => {
    const data = {
      actions: [
        {
          updateEngagementPanelAction: {
            content: {
              transcriptRenderer: {
                body: {
                  initialSegments: [
                    { transcriptSegmentRenderer: { startMs: '0', snippet: { runs: [{ text: 'Stop! Jangan' }, { text: ' gugur' }] } } },
                    { transcriptSegmentRenderer: { startMs: '3200', snippet: { simpleText: 'karena dokumen' } } },
                  ],
                },
              },
            },
          },
        },
      ],
    }
    expect(transcriptPanelLines(data)).toEqual([
      { at: 0, text: 'Stop! Jangan gugur' },
      { at: 3.2, text: 'karena dokumen' },
    ])
  })

  it('turns captions into timed lines', () => {
    const lines = transcriptLines({ events: [{ tStartMs: 0, segs: [{ utf8: 'Stop!' }, { utf8: ' jangan' }] }, { tStartMs: 2500, segs: [{ utf8: '\n' }] }, { tStartMs: 4100, segs: [{ utf8: 'gugur' }] }] })
    expect(lines).toEqual([{ at: 0, text: 'Stop! jangan' }, { at: 4.1, text: 'gugur' }])
  })
})

describe('video cards', () => {
  const hit = {
    platform: 'youtube' as const,
    id: 'ccccccccccc',
    title: 'Jangan [gugur] CPNS! *wajib*',
    url: 'https://www.youtube.com/shorts/ccccccccccc',
    thumb: 'https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg',
    creator: 'cpns.asn',
    views: '2,400,000 views',
    viewCount: 2_400_000,
    published: '2 days ago',
    length: '0:45',
    short: true,
  }

  it('makes a ready-to-paste card line with safe text', () => {
    expect(videoCardLine(hit, 1)).toBe(
      '1. [![Jangan gugur CPNS! wajib](https://i.ytimg.com/vi/ccccccccccc/hqdefault.jpg)](https://www.youtube.com/shorts/ccccccccccc) **Jangan gugur CPNS! wajib** [[2.4M views]] — @cpns.asn · 2 days ago · 0:45',
    )
  })

  it('renders as a clickable thumbnail row with a views pill', () => {
    const html = renderToStaticMarkup(<ChatMarkdown text={videoCardLine(hit, 1)} />)
    expect(html).toContain('class="md-thumb-item"')
    expect(html).toMatch(/<div class="md-thumb"><a href="https:\/\/www\.youtube\.com\/shorts\/ccccccccccc"[^>]*><img/)
    expect(html).toContain('<span class="md-badge">2.4M views</span>')
  })

  it('describes the new tools in plain words', () => {
    expect(describeTool('video_search', { query: 'CPNS 2026' })).toBe('Finding videos about “CPNS 2026”')
    expect(describeTool('video_inspect', { url: 'https://www.tiktok.com/@a/video/1' }, true)).toBe('Broke down a TikTok video')
  })
})

describe('copy-ready packaging blocks', () => {
  const render = (md: string) => renderToStaticMarkup(<ChatMarkdown text={md} />)

  it('labels titles/hashtags blocks by platform and wraps them like prose', () => {
    const html = render('```titles-youtube\nOne\nTwo\n```\n\n```hashtags-tiktok\n#a #b\n```')
    expect(html).toContain('class="md-code is-prose"')
    expect(html).toContain('>Title options · YouTube<')
    expect(html).toContain('>Hashtags · TikTok<')
    expect(html).toContain('Copy')
  })

  it('shows script beat timings', () => {
    expect(render('```hook-0-3s\nVO: Stop!\n```')).toContain('>Hook · 0–3s<')
    expect(render('```script-12-25s\nVO: x\n```')).toContain('>Script · 12–25s<')
  })

  it('leaves real code blocks alone', () => {
    const html = render('```python\nprint(1)\n```')
    expect(html).toContain('>Python<')
    expect(html).not.toContain('is-prose')
  })
})

describe('trend picks', () => {
  it('keep at most 2 per category', () => {
    const topics = normalizeTopics([
      { headline: 'NBA 1', category: 'Sports' },
      { headline: 'NBA 2', category: 'sports' },
      { headline: 'NBA 3', category: 'Sports' },
      { headline: 'New K-drama', category: 'Entertainment' },
      { headline: 'Phone launch', category: 'Tech' },
    ])
    expect(topics.map((t) => t.headline)).toEqual(['NBA 1', 'NBA 2', 'New K-drama', 'Phone launch'])
  })
})
