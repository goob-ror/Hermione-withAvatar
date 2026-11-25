import fs from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import os from 'os'
import { configDir } from '@/lib/agent/providers'

// Each integration file gets its own config dir: files run in parallel and
// would otherwise overwrite each other's providers.json.
process.env.HERMIONE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-it-'))

/**
 * A scripted OpenAI-compatible provider. Each test queues the replies it
 * should send, in order, and inspects the requests Hermione made.
 */
type Reply = { content?: string; toolCall?: { name: string; args: unknown }; toolCalls?: { name: string; args: unknown }[]; empty?: boolean }
let queue: Reply[] = []
let requests: any[] = []
let server: http.Server

function sse(res: http.ServerResponse, reply: Reply) {
  res.setHeader('content-type', 'text/event-stream')
  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
  if (reply.empty) return res.end()
  if (reply.content) {
    // Split into small chunks so tags get cut across them.
    for (let i = 0; i < reply.content.length; i += 5) send({ choices: [{ delta: { content: reply.content.slice(i, i + 5) } }] })
  }
  if (reply.toolCalls) {
    reply.toolCalls.forEach((c, index) =>
      send({ choices: [{ delta: { tool_calls: [{ index, id: `call_${index + 1}`, type: 'function', function: { name: c.name, arguments: c.args } }] } }] }),
    )
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  } else if (reply.toolCall) {
    const args = reply.toolCall.args
    send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: reply.toolCall.name, arguments: args } }] } }] })
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] })
  }
  res.write('data: [DONE]\n\n')
  res.end()
}

async function run(message: string) {
  const { runAgent, systemPromptFor } = await import('@/lib/agent/loop')
  const { ensureSession } = await import('@/lib/agent/session')
  const s = ensureSession(`io-${Math.random()}`, 'scripted', await systemPromptFor('scripted', 'prov-s', 'chat'), 'prov-s', 'chat')
  s.messages.push({ role: 'user', content: message })
  const events: any[] = []
  await runAgent(s, { thinkingEffort: 'off', providerId: 'prov-s' }, (e) => events.push(e))
  return { session: s, events }
}

describe('agent loop tool I/O (integration)', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'scripted' }] }))
        requests.push(JSON.parse(body))
        sse(res, queue.shift() ?? { content: 'done' })
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as AddressInfo).port
    fs.mkdirSync(configDir(), { recursive: true })
    fs.writeFileSync(
      path.join(configDir(), 'providers.json'),
      JSON.stringify({ version: 1, activeId: 'prov-s', providers: [{ id: 'prov-s', label: 'Scripted', kind: 'openai', baseUrl: `http://127.0.0.1:${port}/v1`, defaultModel: 'scripted', createdAt: 1, updatedAt: 1 }] }),
    )
  })
  afterAll(() => {
    server.close()
    fs.rmSync(configDir(), { recursive: true, force: true })
  })

  it('runs several read-only calls from one turn together, and returns results in order', async () => {
    queue = [
      { toolCalls: [{ name: 'get_time', args: '{}' }, { name: 'get_time', args: '{"timezone":"UTC"}' }, { name: 'get_time', args: '{}' }] },
      { content: 'All three done.' },
    ]
    requests = []
    const { events } = await run('what time is it, three ways')
    const kinds = events.filter((e) => e.type === 'tool_call' || e.type === 'tool_result').map((e) => e.type)
    // All three start before any finishes: one parallel batch.
    expect(kinds).toEqual(['tool_call', 'tool_call', 'tool_call', 'tool_result', 'tool_result', 'tool_result'])
    // The model gets the three results back in its own call order.
    const toolMsgs = requests[1].messages.filter((m: any) => m.role === 'tool')
    expect(toolMsgs.map((m: any) => m.tool_call_id)).toEqual(['call_1', 'call_2', 'call_3'])
    expect(events.find((e) => e.type === 'final').text).toBe('All three done.')
  })

  it('keeps <thinking> out of the visible answer', async () => {
    queue = [{ content: '<thinking>\nThe user wants a greeting.\n</thinking>\n\nHello there!' }]
    requests = []
    const { events, session } = await run('greet me')
    const final = events.find((e) => e.type === 'final')
    expect(final.text).toBe('Hello there!')
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.delta).join('')).toContain('The user wants a greeting.')
    expect(session.messages.at(-1)?.content).toBe('Hello there!')
  })

  it('reports malformed tool arguments back to the model instead of running on {}', async () => {
    queue = [{ toolCall: { name: 'fs_read', args: '{"path": "README.md", ' } }, { content: 'Sorry — retried and read it.' }]
    requests = []
    const { events } = await run('read the readme')
    const result = events.find((e) => e.type === 'tool_result')
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/fs_read was not run: its arguments were not valid JSON/)
    // The model's next request carries that explanation as the tool result…
    const toolMsg = requests[1].messages.find((m: any) => m.role === 'tool')
    expect(toolMsg.content).toMatch(/not valid JSON/)
    // …and the broken JSON itself is never sent back as arguments.
    const assistant = requests[1].messages.find((m: any) => m.role === 'assistant' && m.tool_calls)
    expect(() => JSON.parse(assistant.tool_calls[0].function.arguments)).not.toThrow()
    expect(events.find((e) => e.type === 'final')?.text).toBe('Sorry — retried and read it.')
  })

  it('accepts arguments sent as an object and strips the compat "reason"', async () => {
    queue = [{ toolCall: { name: 'get_time', args: { reason: 'user asked' } } }, { content: 'It is late.' }]
    requests = []
    const { events } = await run('what time is it')
    expect(events.find((e) => e.type === 'tool_call').args).toEqual({ reason: 'user asked' }) // shown to the operator
    expect(events.find((e) => e.type === 'tool_result').ok).toBe(true)
    expect(events.find((e) => e.type === 'final').text).toBe('It is late.')
  })

  it('sends every tool with at least one required argument', async () => {
    queue = [{ content: 'ok' }]
    requests = []
    await run('hi')
    for (const t of requests[0].tools) expect(t.function.parameters.required?.length).toBeGreaterThan(0)
  })

  it('retries an empty reply, then falls back to tools-in-prompt, instead of answering blank', async () => {
    queue = [{ empty: true }, { empty: true }, { content: 'Recovered.' }]
    requests = []
    const { events } = await run('hello')
    expect(events.find((e) => e.type === 'final')?.text).toBe('Recovered.')
    expect(requests).toHaveLength(3)
    expect(requests[1].tools).toBeDefined() // plain retry
    expect(requests[2].tools).toBeUndefined() // then tools described in the prompt
  })

  it('gives a clear error after repeated empty replies', async () => {
    queue = [{ empty: true }, { empty: true }, { empty: true }]
    requests = []
    const { events } = await run('hello')
    expect(events.find((e) => e.type === 'error')?.message).toMatch(/returned an empty response 3 times/)
    expect(events.find((e) => e.type === 'final')).toBeUndefined()
  })
it('stops cleanly when the operator presses Stop', async () => {
    queue = []
    requests = []
    const { runAgent, systemPromptFor } = await import('@/lib/agent/loop')
    const { ensureSession } = await import('@/lib/agent/session')
    const s = ensureSession(`stop-${Math.random()}`, 'scripted', await systemPromptFor('scripted', 'prov-s', 'chat'), 'prov-s', 'chat')
    s.messages.push({ role: 'user', content: 'hello' })
    const stop = new AbortController()
    stop.abort()
    const events: any[] = []
    await runAgent(s, { thinkingEffort: 'off', providerId: 'prov-s', signal: stop.signal }, (e) => events.push(e))
    expect(events.map((e) => e.type)).toEqual(['stopped'])
    expect(requests).toHaveLength(0) // no model call after Stop
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', content: expect.stringMatching(/stopped by the operator/) })
  })

  const ASK = {
    name: 'ask_user',
    args: JSON.stringify({ question: 'Which tone?', options: [{ label: 'Formal' }, { label: 'Playful', description: 'jokes ok' }] }),
  }

  it('pauses on ask_user and resumes with the operator’s choice', async () => {
    queue = [{ toolCall: ASK }, { content: 'Playful it is.' }]
    requests = []
    const { resumeAgent } = await import('@/lib/agent/loop')
    const { session, events } = await run('write me a bio')
    const q = events.find((e) => e.type === 'question')
    expect(q).toMatchObject({ question: 'Which tone?', multiple: false, allowOther: true })
    expect(q.options).toEqual([{ label: 'Formal' }, { label: 'Playful', description: 'jokes ok' }])
    expect(events.find((e) => e.type === 'final')).toBeUndefined() // waiting, not answered
    expect(session.pending?.kind).toBe('question')

    // An answer that isn't one of the options is refused and the question stays open.
    const bad: any[] = []
    await resumeAgent(session, q.callId, { kind: 'answer', answer: { choices: ['Rude'] } }, { thinkingEffort: 'off' }, (e) => bad.push(e))
    expect(bad[0]?.type).toBe('error')
    expect(session.pending?.callId).toBe(q.callId)

    // Approve/deny can't resolve a question.
    const wrong: any[] = []
    await resumeAgent(session, q.callId, 'approve', { thinkingEffort: 'off' }, (e) => wrong.push(e))
    expect(wrong[0]?.type).toBe('error')

    const more: any[] = []
    await resumeAgent(session, q.callId, { kind: 'answer', answer: { choices: ['Playful'] } }, { thinkingEffort: 'off', providerId: 'prov-s' }, (e) => more.push(e))
    expect(more.find((e) => e.type === 'final')?.text).toBe('Playful it is.')
    const toolMsg = requests.at(-1).messages.find((m: any) => m.role === 'tool')
    expect(toolMsg.content).toMatch(/answered "Which tone\?" with "Playful"/)
    expect(session.pending).toBeUndefined()
  })

  it('rejects an ask_user call with fewer than 2 options back to the model', async () => {
    queue = [{ toolCall: { name: 'ask_user', args: JSON.stringify({ question: 'Ok?', options: ['Yes'] }) } }, { content: 'Fine.' }]
    requests = []
    const { events } = await run('hi')
    expect(events.find((e) => e.type === 'question')).toBeUndefined()
    expect(events.find((e) => e.type === 'tool_result')?.output).toMatch(/at least 2/)
    expect(events.find((e) => e.type === 'final')?.text).toBe('Fine.')
  })

  it('checklist-only rounds do not use up the tool budget', async () => {
    const plan = (n: number) => ({
      toolCall: { name: 'update_plan', args: JSON.stringify({ items: [{ content: `step ${n}`, status: 'in_progress' }] }) },
    })
    // 10 plan-only rounds (more than MAX_ROUNDS = 8) and then an answer.
    queue = [...Array.from({ length: 10 }, (_, i) => plan(i)), { content: 'All done.' }]
    requests = []
    const { events } = await run('do a long task')
    expect(events.filter((e) => e.type === 'plan')).toHaveLength(10)
    expect(events.find((e) => e.type === 'final')?.text).toBe('All done.')
  })

  it('a new chat message closes an open question so no tool call is left unanswered', async () => {
    queue = [{ toolCall: ASK }]
    requests = []
    const { abandonPending } = await import('@/lib/agent/loop')
    const { session } = await run('write me a bio')
    expect(session.pending?.kind).toBe('question')
    abandonPending(session)
    expect(session.pending).toBeUndefined()
    expect(session.messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringMatching(/did not use the form/) })
  })
})
