import { describe, expect, it } from 'vitest'
import { parseToolArgs } from '@/lib/agent/json'
import { splitThinking, ThinkTagSplitter } from '@/lib/agent/thinkSplit'
import { inputProblem, toolArgs } from '@/lib/agent/loop'
import { TOOL_MAP } from '@/lib/tools'

describe('parseToolArgs', () => {
  it('accepts JSON text, objects and double-encoded strings', () => {
    expect(parseToolArgs('{"path":"lib"}').args).toEqual({ path: 'lib' })
    expect(parseToolArgs({ path: 'lib' }).args).toEqual({ path: 'lib' })
    expect(parseToolArgs(JSON.stringify(JSON.stringify({ path: 'lib' }))).args).toEqual({ path: 'lib' })
  })

  it('treats nothing as no arguments', () => {
    for (const raw of [undefined, null, '', '   ']) expect(parseToolArgs(raw)).toEqual({ args: {} })
  })

  it('repairs small slips (trailing comma, smart quotes)', () => {
    expect(parseToolArgs('{"query":"next.js",}').args).toEqual({ query: 'next.js' })
    expect(parseToolArgs('{“query”:“x”}').args).toEqual({ query: 'x' })
  })

  it('reports — never hides — input it cannot understand', () => {
    const broken = parseToolArgs('{"path": "lib", "max": ')
    expect(broken.args).toEqual({})
    expect(broken.error).toBe('arguments were not valid JSON')
    expect(broken.raw).toContain('"path": "lib"')
    expect(parseToolArgs('[1,2]').error).toBe('arguments must be a JSON object')
    expect(parseToolArgs(['a']).error).toMatch(/array/)
  })
})

describe('ThinkTagSplitter', () => {
  const stream = (chunks: string[]) => {
    const s = new ThinkTagSplitter()
    let content = ''
    let thinking = ''
    for (const c of [...chunks.map((x) => s.push(x)), s.flush()]) {
      content += c.content
      thinking += c.thinking
    }
    return { content, thinking }
  }

  it('moves a leading <thinking> block out of the answer', () => {
    expect(splitThinking('<thinking>\nUser wants OK.\n</thinking>\n\nOK')).toEqual({ content: 'OK', thinking: '\nUser wants OK.\n' })
  })

  it('handles tags cut across stream chunks', () => {
    expect(stream(['<thi', 'nk>plan', ' this</th', 'ink>', '\nAnswer.'])).toEqual({ content: 'Answer.', thinking: 'plan this' })
  })

  it('handles several leading blocks', () => {
    expect(splitThinking('<think>a</think> <thinking>b</thinking>Done')).toEqual({ content: 'Done', thinking: 'ab' })
  })

  it('leaves tags later in the answer alone (e.g. inside code)', () => {
    const text = 'Use the tag like this: <think>x</think>'
    expect(splitThinking(text)).toEqual({ content: text, thinking: '' })
  })

  it('does not swallow text that only looks like a tag start', () => {
    expect(stream(['<', 'div>hi</div>'])).toEqual({ content: '<div>hi</div>', thinking: '' })
    expect(stream(['<th'])).toEqual({ content: '<th', thinking: '' })
  })

  it('passes ordinary answers through untouched, including leading whitespace', () => {
    expect(stream(['  Hello', ' world'])).toEqual({ content: '  Hello world', thinking: '' })
  })

  it('keeps an unclosed thinking block as thinking', () => {
    expect(stream(['<thinking>still going'])).toEqual({ content: '', thinking: 'still going' })
  })
})

describe('tool input checks', () => {
  const call = (tool: string, args: Record<string, unknown>, extra: object = {}) => ({ callId: 'c1', tool, args, ...extra })

  it('refuses to run on unparseable arguments and explains why', () => {
    const msg = inputProblem(TOOL_MAP.fs_read, call('fs_read', {}, { argsError: 'arguments were not valid JSON', argsRaw: '{"path":' }))
    expect(msg).toMatch(/fs_read was not run/)
    expect(msg).toContain('{"path":')
  })

  it('names missing required arguments and lists the parameters', () => {
    const msg = inputProblem(TOOL_MAP.web_fetch, call('web_fetch', { reason: 'x' }))
    expect(msg).toMatch(/missing required argument url/)
    expect(msg).toMatch(/parameters are: .*url/)
    expect(inputProblem(TOOL_MAP.web_fetch, call('web_fetch', { url: '  ' }))).toMatch(/missing/)
  })

  it('lets valid calls through', () => {
    expect(inputProblem(TOOL_MAP.web_fetch, call('web_fetch', { url: 'https://example.com' }))).toBeUndefined()
    expect(inputProblem(TOOL_MAP.get_time, call('get_time', {}))).toBeUndefined()
  })

  it('strips the compat "reason" unless the tool defines it', () => {
    expect(toolArgs(TOOL_MAP.get_time, { reason: 'user asked' })).toEqual({})
    expect(toolArgs(TOOL_MAP.fs_list, { path: 'lib', reason: 'count files' })).toEqual({ path: 'lib' })
    expect(toolArgs(TOOL_MAP.terminal_interrupt, { reason: 'stuck build' })).toEqual({ reason: 'stuck build' })
  })
})
