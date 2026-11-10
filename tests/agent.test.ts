import { describe, expect, it } from 'vitest'
import { classifyExhaustion, parseRetryMs } from '@/lib/agent/failover'
import { compactHistory, approxTokens } from '@/lib/agent/history'
import { extractJson } from '@/lib/agent/complete'
import { hiddenReason, isNotChatCapableError } from '@/lib/agent/modelFilter'
import type { ChatMessage } from '@/lib/agent/types'

describe('classifyExhaustion', () => {
  it.each([
    ['failed (429): RESOURCE_EXHAUSTED You exceeded your current quota', 'quota'],
    ['failed (429): {"code":"insufficient_quota","message":"check your plan and billing details"}', 'billing'],
    ['failed (402): Your credit balance is too low', 'billing'],
    ['failed (429): Rate limit reached on tokens per minute. Please try again in 1m30s.', 'rate'],
    ['failed (401) — check the API token', undefined],
    ['failed (400): Invalid argument', undefined],
    ['failed (503): model overloaded', undefined],
  ])('%s → %s', (message, want) => {
    expect(classifyExhaustion(message)).toBe(want)
  })

  it('reads provider retry hints', () => {
    expect(parseRetryMs('"retryDelay": "34s"')).toBe(34_000)
    expect(parseRetryMs('Please try again in 1m30s.')).toBe(90_000)
    expect(parseRetryMs('try again in 20s')).toBe(20_000)
    expect(parseRetryMs('no hint here')).toBeUndefined()
  })
})

describe('compactHistory', () => {
  const build = (exchanges: number): ChatMessage[] => {
    const msgs: ChatMessage[] = [{ role: 'system', content: 'SYSTEM' }]
    for (let i = 1; i <= exchanges; i++) {
      msgs.push({ role: 'user', content: `Question ${i}` })
      msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${i}`, function: { name: 'web_fetch', arguments: {} } }] })
      msgs.push({ role: 'tool', tool_call_id: `c${i}`, content: `PAGE ${i} `.repeat(1200) })
      msgs.push({ role: 'assistant', content: `Answer ${i}` })
    }
    return msgs
  }

  it('keeps the last 6 exchanges, full tool output only for the last 2, and summarises the rest', () => {
    const msgs = build(12)
    const out = compactHistory(msgs)
    expect(out.filter((m) => m.role === 'user')).toHaveLength(6)
    expect(out.filter((m) => m.role === 'tool' && !m.content.includes('[trimmed'))).toHaveLength(2)
    expect(out[0].content).toContain('Earlier in this conversation')
    expect(out[1].content).toBe('Question 7')
    expect(approxTokens(out)).toBeLessThan(approxTokens(msgs) * 0.4)
  })

  it('never orphans a tool result from its call', () => {
    const out = compactHistory(build(12))
    out.forEach((m, i) => {
      if (m.role !== 'tool') return
      const owner = out.slice(0, i).reverse().find((p) => p.role === 'assistant' && p.tool_calls?.length)
      expect(owner?.tool_calls?.some((c) => c.id === m.tool_call_id)).toBe(true)
    })
  })

  it('does not mutate the session history', () => {
    const msgs = build(12)
    const before = JSON.stringify(msgs)
    compactHistory(msgs)
    expect(JSON.stringify(msgs)).toBe(before)
  })

  it('leaves short conversations alone', () => {
    const msgs = build(2)
    expect(compactHistory(msgs)).toHaveLength(msgs.length)
  })
})

describe('extractJson (with repair)', () => {
  it.each([
    ['```json\n{"today":[{"signal":"gibran mundur" (1000+ searches)}]}\n```', 'gibran mundur (1000+ searches)'],
    ['{"today":[{"signal":"x · 500+",},]}', 'x · 500+'],
    ['Sure! {"today":[{"signal":"y"}]} hope it helps', 'y'],
    ['{"today":[{"signal":“z”}]}', 'z'],
  ])('%s', (input, want) => {
    expect(extractJson<any>(input)?.today?.[0]?.signal).toBe(want)
  })

  it('returns null for prose', () => {
    expect(extractJson('no json here')).toBeNull()
  })
})

describe('model filter', () => {
  it.each([
    'gpt-4o', 'o3', 'gemini-2.5-pro', 'gemini-2.5-flash', 'claude-sonnet-4-5', 'deepseek-chat',
    'llama-3.3-70b-versatile', 'qwen2.5-7b-instruct', 'qwq:32b', 'llava:13b', 'olive-7b',
  ])('keeps chat model %s', (id) => {
    expect(hiddenReason({ id }, id)).toBeUndefined()
  })

  it.each([
    'text-embedding-3-small', 'nomic-embed-text:latest', 'whisper-1', 'tts-1-hd', 'gpt-4o-realtime-preview',
    'dall-e-3', 'omni-moderation-latest', 'davinci-002', 'o3-pro', 'aqa', 'imagen-4.0-generate-001',
    'gemini-2.5-flash-preview-tts', 'antigravity-preview-05-2026', 'lyria-3.5', 'meta-llama/llama-guard-4-12b',
  ])('hides non-chat model %s', (id) => {
    expect(hiddenReason({ id }, id)).toBeDefined()
  })

  it('trusts provider metadata only to hide', () => {
    expect(hiddenReason({ capabilities: ['embedding'] }, 'some-model')).toBeDefined()
    expect(hiddenReason({ supportedGenerationMethods: ['generateContent'] }, 'gemini-2.5-flash-preview-tts')).toBeDefined()
  })

  it('recognises "cannot chat" errors but not ordinary failures', () => {
    expect(isNotChatCapableError('Multiturn chat is not enabled for models/x')).toBe(true)
    expect(isNotChatCapableError('"nomic-embed-text" does not support chat')).toBe(true)
    expect(isNotChatCapableError('Incorrect API key provided')).toBe(false)
    expect(isNotChatCapableError('tools are not supported for this model')).toBe(false)
  })
})
