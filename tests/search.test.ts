import { describe, expect, it } from 'vitest'
import { parseBing, parseDuckDuckGo } from '@/lib/tools/search'

// Trimmed copies of the real markup (Nov 2026).
const DDG = `
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FHermione_Granger&amp;rut=abc">Hermione Granger - Wikipedia</a></h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">A fictional <b>character</b> in the Harry Potter series.</a>
</div>
<div class="result result--ad">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored</a>
</div>
<div class="result results_links web-result ">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.harrypotter.com%2Fhermione&amp;rut=def">Official &amp; Encyclopedia</a>
  <a class="result__snippet" href="#">Bookish best friend.</a>
</div>`

const realUrl = 'https://forums.example.com/discussion/1767356'
const BING = `
<li class="b_algo" data-id iid=SERP.1><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=a1${Buffer.from(realUrl).toString('base64url')}&amp;ntb=1">Example thread &#8211; forum</a></h2>
<div class="b_caption"><p class="b_lineclamp2"><span class="news_dt">1 day ago</span>&nbsp;&#0183;&#32;Snippet text here.</p></div></li>
<li class="b_algo"><h2><a href="https://direct.example.org/page">Direct link</a></h2><p>Plain snippet.</p></li>`

describe('DuckDuckGo parser', () => {
  it('unwraps redirect links, decodes entities, skips ads', () => {
    const r = parseDuckDuckGo(DDG, 10)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({
      title: 'Hermione Granger - Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Hermione_Granger',
      snippet: 'A fictional character in the Harry Potter series.',
    })
    expect(r[1].title).toBe('Official & Encyclopedia')
    expect(r[1].url).toBe('https://www.harrypotter.com/hermione')
  })

  it('respects the result limit', () => {
    expect(parseDuckDuckGo(DDG, 1)).toHaveLength(1)
  })
})

describe('Bing parser', () => {
  it('decodes the base64 u=a1… redirect and keeps direct links', () => {
    const r = parseBing(BING, 10)
    expect(r.map((x) => x.url)).toEqual([realUrl, 'https://direct.example.org/page'])
    expect(r[0].title).toBe('Example thread – forum')
    expect(r[0].snippet).toContain('Snippet text here.')
  })
})
