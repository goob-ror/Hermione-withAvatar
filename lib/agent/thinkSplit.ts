/**
 * Some models (e.g. "-thinking" variants behind routers) put their reasoning
 * in the normal text as <thinking>…</thinking> or <think>…</think> instead of a
 * separate reasoning field. This splits it out of the visible answer while
 * streaming, even when a tag is cut across chunks.
 *
 * Conservative on purpose: only blocks at the START of the reply (optionally
 * several in a row) count as thinking. A tag later in the answer — say, inside
 * a code sample — stays as normal text.
 */

const OPEN = ['<thinking>', '<think>']
const CLOSE = ['</thinking>', '</think>']
const LONGEST_CLOSE = Math.max(...CLOSE.map((t) => t.length))

export interface SplitOut {
  content: string
  thinking: string
}

export class ThinkTagSplitter {
  private mode: 'start' | 'thinking' | 'content' = 'start'
  private buffer = ''
  private sawBlock = false

  push(text: string): SplitOut {
    this.buffer += text
    const out: SplitOut = { content: '', thinking: '' }

    for (;;) {
      if (this.mode === 'content') {
        out.content += this.buffer
        this.buffer = ''
        return out
      }

      if (this.mode === 'start') {
        const lead = this.buffer.length - this.buffer.trimStart().length
        const rest = this.buffer.slice(lead)
        const open = OPEN.find((t) => rest.startsWith(t))
        if (open) {
          this.buffer = rest.slice(open.length)
          this.mode = 'thinking'
          this.sawBlock = true
          continue
        }
        // Could still become an opening tag ("<thi") — wait for more text.
        if (rest === '' || OPEN.some((t) => t.startsWith(rest))) return out
        this.mode = 'content'
        // Drop the whitespace that separated a thinking block from the answer.
        if (this.sawBlock) this.buffer = rest
        continue
      }

      // thinking
      let at = -1
      let tag = ''
      for (const t of CLOSE) {
        const i = this.buffer.indexOf(t)
        if (i >= 0 && (at < 0 || i < at)) {
          at = i
          tag = t
        }
      }
      if (at >= 0) {
        out.thinking += this.buffer.slice(0, at)
        this.buffer = this.buffer.slice(at + tag.length)
        this.mode = 'start'
        continue
      }
      // Keep a tail that might be the start of a closing tag.
      const keep = Math.min(this.buffer.length, LONGEST_CLOSE - 1)
      out.thinking += this.buffer.slice(0, this.buffer.length - keep)
      this.buffer = this.buffer.slice(this.buffer.length - keep)
      return out
    }
  }

  /** End of stream: whatever is held back goes where it belongs. */
  flush(): SplitOut {
    const rest = this.buffer
    this.buffer = ''
    if (this.mode === 'thinking') return { content: '', thinking: rest }
    return { content: this.mode === 'start' && this.sawBlock ? rest.trimStart() : rest, thinking: '' }
  }
}

/** One-shot version for non-streamed replies. */
export function splitThinking(text: string): SplitOut {
  const s = new ThinkTagSplitter()
  const a = s.push(text)
  const b = s.flush()
  return { content: a.content + b.content, thinking: a.thinking + b.thinking }
}
