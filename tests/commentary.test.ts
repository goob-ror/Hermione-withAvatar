import { describe, expect, it } from 'vitest'
import { cleanCommentary, commentaryLine, ruleCommentary } from '@/lib/tts/commentary'
import { detailFor } from '@/lib/voice/detail'

const helper = (text: string | Error, seen: any[] = []) => ({
  candidates: [{ providerId: 'gem', model: 'flash-lite', source: 'default' as const }],
  complete: (async (opts: any) => {
    seen.push(opts)
    if (text instanceof Error) throw text
    return { text, model: 'flash-lite', providerId: 'gem' }
  }) as any,
})

describe('thinking commentary', () => {
  it('details are short and safe: hostnames, never full URLs', () => {
    expect(detailFor('web_fetch', { url: 'https://www.tokopedia.com/laptop/zenbook?ref=abc&token=SECRET' })).toBe('tokopedia.com')
    expect(detailFor('web_search', { query: 'best quiet laptop under 15 million rupiah for students in 2026' })).toMatch(/^best quiet laptop.*…$/)
    expect(detailFor('fs_read', { path: 'src/lib/app.ts' })).toBe('app.ts')
    expect(detailFor('terminal_run', { command: 'npm run build --verbose' })).toBe('npm run')
    expect(detailFor('ask_user', {})).toBeUndefined()
  })

  it('rule lines fit the activity, use the detail, and never repeat in a run', () => {
    const first = ruleCommentary({ activity: 'web_fetch', detail: 'tokopedia.com', elapsedS: 8, said: [] })
    expect(first).toMatch(/tokopedia\.com/)
    const said = [first]
    for (let i = 0; i < 5; i++) said.push(ruleCommentary({ activity: 'web_fetch', detail: 'tokopedia.com', elapsedS: 20, said }))
    expect(new Set(said).size).toBe(said.length)
    expect(ruleCommentary({ activity: 'delegate', detail: 'laptop prices', elapsedS: 9, said: [], workers: 3 })).toMatch(/3 workers/)
  })

  it('uses the voice model, cleans its line, and falls back to the rules', async () => {
    const seen: any[] = []
    const a = await commentaryLine({ activity: 'web_search', detail: 'zenbook price', elapsedS: 7, said: [] }, helper('"Hunting down Zenbook prices for you, Serpto."', seen))
    expect(a).toEqual({ text: 'Hunting down Zenbook prices for you, sir.', by: 'model' })
    expect(seen[0].prompt).toMatch(/web_search \(zenbook price\)/)
    // A repeat, a URL-only line or a failure → the rules.
    expect((await commentaryLine({ activity: 'web_search', elapsedS: 7, said: ['Searching, sir.'] }, helper('Searching, sir.'))).by).toBe('rules')
    expect((await commentaryLine({ activity: 'web_search', elapsedS: 7, said: [] }, helper(new Error('timeout')))).by).toBe('rules')
  })

  it('rejects lines that are too long, empty, or repeats', () => {
    expect(cleanCommentary('x'.repeat(200), [])).toBeNull()
    expect(cleanCommentary('🎉', [])).toBeNull()
    expect(cleanCommentary('Nearly there, sir!', ['nearly there sir'])).toBeNull()
    expect(cleanCommentary('Reading https://a.example/page now.', [])).toBe('Reading now.')
  })
})
