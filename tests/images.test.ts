import { describe, expect, it } from 'vitest'
import { parseBingImages, parseCommons } from '@/lib/tools/images'
import { pageImage } from '@/lib/tools/web'

const tileAttr = (o: Record<string, string>) => `m="${JSON.stringify(o).replace(/"/g, '&quot;')}"`

describe('image_search parsers', () => {
  it('reads Bing image tiles: thumbnail, full image, source page; skips duplicates and junk', () => {
    const html = [
      `<a class="iusc" ${tileAttr({ murl: 'https://a.test/full1.jpg', turl: 'https://tse1.mm.bing.net/th?id=1', purl: 'https://a.test/page', t: 'Fluffy <b>Samoyed</b> [puppy]' })}>`,
      `<a class="iusc" ${tileAttr({ murl: 'https://a.test/full1.jpg', turl: 'https://tse1.mm.bing.net/th?id=1b', purl: 'https://a.test/page' })}>`,
      `<a class="iusc" ${tileAttr({ murl: 'javascript:alert(1)', turl: 'https://tse1.mm.bing.net/th?id=2' })}>`,
      `<a class="iusc" m="{not json}">`,
      `<a class="iusc" ${tileAttr({ murl: 'https://b.test/2.png', turl: 'https://tse2.mm.bing.net/th?id=3', t: '' })}>`,
    ].join('\n')
    const r = parseBingImages(html, 5)
    expect(r).toEqual([
      { title: 'Fluffy Samoyed puppy', thumb: 'https://tse1.mm.bing.net/th?id=1', full: 'https://a.test/full1.jpg', source: 'https://a.test/page' },
      { title: 'image', thumb: 'https://tse2.mm.bing.net/th?id=3', full: 'https://b.test/2.png', source: 'https://b.test/2.png' },
    ])
    expect(parseBingImages(html, 1)).toHaveLength(1)
  })

  it('reads Wikimedia Commons results in search order, photos only', () => {
    const data = {
      query: {
        pages: {
          '2': { index: 2, title: 'File:Corgi pup.jpg', imageinfo: [{ thumburl: 'https://upload.test/c.jpg', url: 'https://upload.test/C.jpg', descriptionurl: 'https://commons.test/c', mime: 'image/jpeg' }] },
          '1': { index: 1, title: 'File:Samoyed.png', imageinfo: [{ thumburl: 'https://upload.test/s.png', url: 'https://upload.test/S.png', descriptionurl: 'https://commons.test/s', mime: 'image/png' }] },
          '3': { index: 3, title: 'File:Doc.pdf', imageinfo: [{ thumburl: 'https://upload.test/d.jpg', mime: 'application/pdf' }] },
        },
      },
    }
    expect(parseCommons(data, 5).map((r) => r.title)).toEqual(['Samoyed', 'Corgi pup'])
  })

  it("finds a page's own preview picture for web_fetch", () => {
    expect(pageImage('<meta property="og:image" content="/img/hero.jpg">', 'https://site.test/a/b')).toBe(
      'image: ![page picture](https://site.test/img/hero.jpg)',
    )
    expect(pageImage('<meta content="https://x.test/t.png" name="twitter:image">', 'https://site.test')).toContain('https://x.test/t.png')
    expect(pageImage('<meta property="og:image" content="javascript:alert(1)">', 'https://site.test')).toBeUndefined()
    expect(pageImage('<title>none</title>', 'https://site.test')).toBeUndefined()
  })
})
