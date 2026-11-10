import fs from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configDir } from '@/lib/agent/providers'

/**
 * Two fake OpenAI-compatible providers: A answers every chat with a real-shaped
 * Gemini quota error, B answers normally (and reports usage).
 */
const hits = { A: 0, B: 0 }
let servers: http.Server[] = []

function fake(name: 'A' | 'B'): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: `model-${name.toLowerCase()}` }] }))
    if (req.url === '/v1/chat/completions') {
      hits[name]++
      if (name === 'A') {
        res.statusCode = 429
        return res.end(JSON.stringify([{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.', details: [{ retryDelay: '3600s' }] } }]))
      }
      return res.end(JSON.stringify({ choices: [{ message: { content: 'Hello from B.' } }], usage: { prompt_tokens: 100, completion_tokens: 5 } }))
    }
    res.statusCode = 404
    res.end('{}')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port })))
}

async function runTurn(sessionId: string) {
  const { runAgent, systemPromptFor } = await import('@/lib/agent/loop')
  const { ensureSession } = await import('@/lib/agent/session')
  const s = ensureSession(sessionId, 'model-a', await systemPromptFor('model-a', 'prov-a', 'chat'), 'prov-a', 'chat')
  s.messages.push({ role: 'user', content: 'hi' })
  const events: any[] = []
  await runAgent(s, { thinkingEffort: 'off', providerId: 'prov-a' }, (e) => events.push(e))
  return { session: s, events }
}

describe('provider failover (integration)', () => {
  beforeAll(async () => {
    const [a, b] = await Promise.all([fake('A'), fake('B')])
    servers = [a.server, b.server]
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(
      path.join(configDir(), 'providers.json'),
      JSON.stringify({
        version: 1,
        activeId: 'prov-a',
        providers: [
          { id: 'prov-a', label: 'Provider A', kind: 'openai', baseUrl: `http://127.0.0.1:${a.port}/v1`, defaultModel: 'model-a', createdAt: 1, updatedAt: 1 },
          { id: 'prov-b', label: 'Provider B', kind: 'openai', baseUrl: `http://127.0.0.1:${b.port}/v1`, defaultModel: 'model-b', createdAt: 1, updatedAt: 1 },
        ],
      }),
    )
  })

  afterAll(() => {
    servers.forEach((s) => s.close())
    fs.rmSync(configDir(), { recursive: true, force: true })
  })

  it('continues the same turn on another provider after a quota error', async () => {
    const { session, events } = await runTurn('failover-1')
    const failover = events.find((e) => e.type === 'failover')
    expect(failover).toMatchObject({ toProviderId: 'prov-b', toModel: 'model-b' })
    expect(events.find((e) => e.type === 'final')?.text).toBe('Hello from B.')
    expect(events.find((e) => e.type === 'usage')).toMatchObject({ input: 100, output: 5, estimated: false })
    expect(session.model).toBe('model-b')
    expect(hits.A).toBe(1)

    const marks = JSON.parse(fs.readFileSync(path.join(configDir(), 'exhausted.json'), 'utf-8'))
    expect(marks['prov-a::model-a'].kind).toBe('quota')
    expect(marks['prov-a::model-a'].until - Date.now()).toBeGreaterThan(50 * 60 * 1000) // honours retryDelay 3600s
  })

  it('skips the exhausted provider on the next turn without sending it a request', async () => {
    const before = hits.A
    const { events } = await runTurn('failover-2')
    expect(hits.A).toBe(before)
    expect(events.find((e) => e.type === 'final')?.text).toBe('Hello from B.')
  })
})
