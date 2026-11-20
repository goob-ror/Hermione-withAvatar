import { describe, expect, it } from 'vitest'
import { speakable } from '@/components/ReplyActions'

describe('speakable (read aloud)', () => {
  it('turns Markdown into plain sentences and skips code', () => {
    const md = ['## Tips', '', '- **Bold** point', '- See [docs](https://x.y)', '', '```bash', 'ls -la', '```', '', 'Use `npm`.'].join('\n')
    const out = speakable(md)
    expect(out).not.toMatch(/[#*[\]`]/)
    expect(out).not.toContain('ls -la')
    expect(out).toContain('Bold point')
    expect(out).toContain('See docs')
    expect(out).toContain('(code block)')
    expect(out).toContain('Use npm')
  })
})
