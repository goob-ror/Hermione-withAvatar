import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMarkdown } from '@/components/ChatMarkdown'

const render = (text: string) => renderToStaticMarkup(<ChatMarkdown text={text} />)

describe('ChatMarkdown', () => {
  it('renders headings, bold, italics and lists instead of showing the symbols', () => {
    const html = render('## Why it works\n\n**Bold** and *italic*\n\n- one\n- two\n\n1. first\n2. second')
    expect(html).toContain('<h2>Why it works</h2>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toMatch(/<ul>\s*<li>one<\/li>/)
    expect(html).toMatch(/<ol>\s*<li>first<\/li>/)
    expect(html).not.toContain('**')
    expect(html).not.toContain('##')
  })

  it('wraps tables so they scroll sideways', () => {
    const html = render('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(html).toMatch(/<div class="md-table-wrap"><table>/)
    expect(html).toContain('<th>A</th>')
  })

  it('puts fenced code in its own box with a language label and copy button', () => {
    const html = render('```bash\nls -la\n```')
    expect(html).toContain('class="md-code"')
    expect(html).toContain('>Bash<')
    expect(html).toContain('Copy')
    expect(html).toMatch(/<pre><code class="hljs language-bash">/) // syntax-highlighted
  })

  it('offers "Run" only for shell code, and only when a handler is given', () => {
    expect(renderToStaticMarkup(<ChatMarkdown text={'```bash\nls\n```'} onRunInTerminal={() => {}} />)).toContain('Run')
    expect(renderToStaticMarkup(<ChatMarkdown text={'```python\nprint(1)\n```'} onRunInTerminal={() => {}} />)).not.toMatch(/>\s*Run/)
    expect(render('```bash\nls\n```')).not.toMatch(/>\s*Run/)
  })

  it('keeps inline code as a chip, not a code box', () => {
    const html = render('Use `npm test` here')
    expect(html).toContain('<code>npm test</code>')
    expect(html).not.toContain('md-code')
  })

  it('never renders raw HTML from the model', () => {
    const html = render('<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>bold?</b>')
    // No real elements — the markup is shown as escaped, inert text.
    expect(html).not.toMatch(/<img|<script|<b>/)
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;')
  })

  it('drops javascript: links and opens real links in a new tab', () => {
    expect(render('[click](javascript:alert(1))')).not.toContain('javascript:')
    expect(render('[site](https://example.com)')).toMatch(/href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer"/)
  })

  it('shows hex colours as swatches, in code and in text', () => {
    const html = render('Brand gold `#c5a871` and text #1a2b3c here.')
    expect(html).toMatch(/class="md-swatch is-code"[^>]*>.*background:#c5a871.*#c5a871<\/button>/)
    expect(html).toContain('background:#1a2b3c')
  })

  it('leaves issue numbers, links and code blocks alone', () => {
    const html = render('Fixed in #123 and #abc. [see](https://x.y/#ffffff)\n\n```css\na { color: #ffffff; }\n```')
    expect(html).not.toContain('md-swatch')
  })

  it('groups two or more images into a grid that opens each full size', () => {
    const html = render('![a](https://img.test/a.png)\n![b](https://img.test/b.png)\n\n![c](https://img.test/c.png)')
    expect(html).toMatch(/<div class="md-gallery">/)
    expect((html.match(/<a href="https:\/\/img\.test\//g) ?? []).length).toBe(3)
  })

  it('turns list items that start with a picture into thumbnail rows', () => {
    const html = render(
      '1. ![Samoyed](https://img.test/s.jpg) **Samoyed** — a cloud with legs\n2. ![Corgi](https://img.test/c.jpg)\n   **Corgi** — short legs\n3. **Pug** — no picture',
    )
    expect(html).toContain('<ol class="md-thumb-list">')
    expect((html.match(/class="md-thumb-item"/g) ?? []).length).toBe(2)
    expect(html).toMatch(/<div class="md-thumb"><img src="https:\/\/img\.test\/s\.jpg"[^>]*><\/div>\s*<div class="md-thumb-body"><p><strong>Samoyed<\/strong> — a cloud/)
    expect(html).toMatch(/<div class="md-thumb-body"><p><strong>Corgi<\/strong>/) // line break after the picture dropped
    expect(html).toMatch(/<li><strong>Pug<\/strong>/) // ordinary item untouched
  })

  it('renders [[Tag]] as a small pill, but not inside code or links', () => {
    const html = render('1. ![Samoyed](https://img.test/s.jpg) **Samoyed** [[Best smile]] — fluffy\n\n`[[not a tag]]` and [see [[x]]](https://x.y) and [[]]')
    expect(html).toContain('<span class="md-badge">Best smile</span>')
    expect(html).toContain('<code>[[not a tag]]</code>')
    expect((html.match(/md-badge/g) ?? []).length).toBe(1)
  })

  it('captions gallery pictures from their alt text or title', () => {
    const html = render('![1st: Samoyed](https://img.test/a.png "1st: Samoyed — cloud mode")\n![Pomeranian](https://img.test/b.png)\n![image](https://img.test/c.png)')
    expect(html).toContain('<span class="md-gallery-cap">1st: Samoyed — cloud mode</span>')
    expect(html).toContain('<span class="md-gallery-cap">Pomeranian</span>')
    expect((html.match(/md-gallery-cap/g) ?? []).length).toBe(2) // "image" is not a caption
  })

  it('keeps a single image as a plain image', () => {
    const html = render('![a](https://img.test/a.png)')
    expect(html).not.toContain('md-gallery')
    expect(html).toContain('<img src="https://img.test/a.png"')
  })

  it('turns [!NOTE]-style and **Warning:** quotes into callouts', () => {
    const note = render('> [!TIP]\n> Press **Stop** to halt her.')
    expect(note).toContain('class="md-callout md-callout-tip"')
    expect(note).toMatch(/md-callout-title"><svg[^]*?<\/svg>Tip<\/div>/)
    expect(note).not.toContain('[!TIP]')
    expect(note).toContain('<strong>Stop</strong>')

    const warn = render('> **Warning:** this deletes files.')
    expect(warn).toContain('md-callout-warning')
    expect(warn).toContain('this deletes files.')
    expect(warn).not.toContain('<strong>Warning')

    expect(render('> just a quote')).toContain('<blockquote>')
  })

  it('renders GitHub-style task lists and strikethrough', () => {
    const html = render('- [x] done\n- [ ] todo\n\n~~old~~')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<del>old</del>')
  })
})
