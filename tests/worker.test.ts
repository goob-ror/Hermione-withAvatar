import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent/providers', async (orig) => ({
  ...(await orig<typeof import('@/lib/agent/providers')>()),
  getProvider: (id: string) => ({ id, kind: 'openai', label: id, baseUrl: `https://${id}.example/v1`, createdAt: 0, updatedAt: 0 }),
  resolvedKey: () => 'test-key',
}))
vi.mock('@/lib/agent/usage', () => ({ recordUsage: () => {}, estimateTokens: () => ({ input: 1, output: 1 }) }))

import { MAX_STEPS, runWorker } from '@/lib/agent/worker'
import { inBatches, MAX_PARALLEL, PARALLEL_SAFE } from '@/lib/agent/loop'

const models = [
  { providerId: 'router', model: 'kr/claude-haiku-4.5', source: 'default' as const },
  { providerId: 'gem', model: 'gemini-3.1-flash-lite', source: 'fallback' as const },
]

/** Fake read-only tools that record how many ran at once. */
function fakeTools() {
  let running = 0
  const seen = { peak: 0, calls: [] as string[] }
  const tool = (name: string) => ({
    name,
    description: name,
    group: 'browse',
    tier: 'auto',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    async run(args: any) {
      running++
      seen.peak = Math.max(seen.peak, running)
      seen.calls.push(`${name}:${args.query ?? args.url ?? ''}`)
      await new Promise((r) => setTimeout(r, 20))
      running--
      return { ok: true, output: `${name} result for ${args.query ?? args.url}` }
    },
  })
  const tools: Record<string, any> = {
    web_search: tool('web_search'),
    web_fetch: tool('web_fetch'),
    shell_run: { ...tool('shell_run'), tier: 'confirm' },
    fs_write: tool('fs_write'),
  }
  return { tools, seen }
}

const call = (name: string, args: object, id?: string) => ({ id, function: { name, arguments: JSON.stringify(args) } })

describe('worker sub-agent', () => {
  it('searches in parallel, refuses non-read-only tools, and returns a short report', async () => {
    const { tools, seen } = fakeTools()
    const sent: any[] = []
    let turn = 0
    const chat = async (opts: any) => {
      sent.push(opts)
      turn++
      if (turn === 1)
        return {
          content: '',
          thinking: '',
          toolCalls: [call('web_search', { query: 'zenbook 14 price' }, 'a'), call('web_search', { query: 'macbook air price' }, 'b'), call('shell_run', { command: 'rm -rf /' }, 'c')],
        }
      return { content: 'Zenbook 14: Rp 13.999.000. MacBook Air: Rp 18.999.000.\nSources: https://shop.example', thinking: '', toolCalls: [] }
    }
    const events: any[] = []
    const r = await runWorker('Compare the two laptop prices', { deps: { chat: chat as any, candidates: models, tools }, emit: (e) => events.push(e), parentCallId: 'c1' })

    expect(r.ok).toBe(true)
    expect(r.report).toContain('Rp 13.999.000')
    expect(r.model).toBe('router::kr/claude-haiku-4.5')
    expect(seen.peak).toBe(2) // both searches at once
    expect(seen.calls.some((c) => c.startsWith('shell_run'))).toBe(false) // never run
    const toolMsgs = sent[1].messages.filter((m: any) => m.role === 'tool')
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(['a', 'b', 'c'])
    expect(toolMsgs[2].content).toMatch(/not available to a worker/)
    // Only read-only tools are even offered to the worker model.
    expect(sent[0].tools.map((t: any) => t.function.name)).toEqual(['web_search', 'web_fetch'])
    // It never sees the chat — only its task.
    expect(sent[0].messages.filter((m: any) => m.role === 'user')).toHaveLength(1)
    // Live progress is tagged under the parent delegate call.
    expect(events.filter((e) => e.type === 'tool_call').map((e) => e.callId)).toEqual(['c1.1.0', 'c1.1.1'])
  })

  it(`stops after ${MAX_STEPS} tool rounds and asks for the report`, async () => {
    const { tools } = fakeTools()
    let turns = 0
    const chat = async (opts: any) => {
      turns++
      if (!opts.tools) return { content: 'Report from what I have.', thinking: '', toolCalls: [] }
      return { content: '', thinking: '', toolCalls: [call('web_search', { query: `q${turns}` })] }
    }
    const r = await runWorker('Keep searching forever', { deps: { chat: chat as any, candidates: models, tools } })
    expect(r).toMatchObject({ ok: true, steps: MAX_STEPS, report: 'Report from what I have.' })
    expect(turns).toBe(MAX_STEPS + 1)
  })

  it('falls back to the next worker model when one fails, and caps the report length', async () => {
    const { tools } = fakeTools()
    const chat = async (opts: any) => {
      if (opts.model === 'kr/claude-haiku-4.5') throw new Error('503 overloaded')
      return { content: 'x'.repeat(5000), thinking: '', toolCalls: [] }
    }
    const r = await runWorker('Anything', { deps: { chat: chat as any, candidates: models, tools } })
    expect(r.model).toBe('gem::gemini-3.1-flash-lite')
    expect(r.report.length).toBeLessThan(1600)
  })

  it('reports clearly when workers are turned off', async () => {
    const r = await runWorker('Anything', { deps: { candidates: [], tools: fakeTools().tools } })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/turned off/) })
  })
})

describe('parallel tool calls', () => {
  it(`runs at most ${MAX_PARALLEL} at once and keeps the order`, async () => {
    let running = 0
    let peak = 0
    const fns = Array.from({ length: 10 }, (_, i) => async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5 + (10 - i)))
      running--
      return i
    })
    expect(await inBatches(fns)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(peak).toBe(MAX_PARALLEL)
  })

  it('only read-only tools are parallel-safe', () => {
    for (const t of ['web_search', 'web_fetch', 'fs_read', 'delegate']) expect(PARALLEL_SAFE.has(t)).toBe(true)
    for (const t of ['fs_write', 'fs_delete', 'shell_run', 'terminal_run', 'page_act', 'page_open', 'ask_user', 'update_plan', 'memory_save'])
      expect(PARALLEL_SAFE.has(t)).toBe(false)
  })
})
