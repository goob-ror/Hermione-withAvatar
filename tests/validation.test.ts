import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as approve } from '@/app/api/agent/approve/route'
import { POST as agent } from '@/app/api/agent/route'
import { POST as terminal } from '@/app/api/terminal/route'
import { POST as saveSettings } from '@/app/api/settings/phase1/route'

const post = (url: string, body: unknown) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('API body validation', () => {
  it('rejects malformed JSON', async () => {
    const res = await agent(post('/api/agent', '{not json'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid JSON body')
  })

  it('reports which fields are wrong', async () => {
    const res = await agent(post('/api/agent', { sessionId: 's1', model: '', message: '   ' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.issues.join(' ')).toMatch(/model/)
    expect(body.issues.join(' ')).toMatch(/message/)
  })

  it('never treats a missing or misspelled decision as approval', async () => {
    for (const decision of [undefined, 'yes', 'APPROVE', '']) {
      const res = await approve(post('/api/agent/approve', { sessionId: 's1', callId: 'c1', decision }))
      expect(res.status).toBe(400)
    }
  })

  it('accepts an explicit decision (then fails only because the session is unknown)', async () => {
    const res = await approve(post('/api/agent/approve', { sessionId: 'no-such-session', callId: 'c1', decision: 'deny' }))
    expect(res.status).toBe(404)
  })

  it('rejects empty terminal input', async () => {
    const res = await terminal(post('/api/terminal', { sessionId: 's1', input: '' }))
    expect(res.status).toBe(400)
  })

  it('validates settings values and drops unknown keys', async () => {
    const bad = await saveSettings(post('/api/settings/phase1', { rtkEnabled: 'yes', rtkLevel: 'max', lazyDevMode: 'auto', showTokenCounter: true }))
    expect(bad.status).toBe(400)
    const ok = await saveSettings(post('/api/settings/phase1', { rtkEnabled: true, rtkLevel: 'low', lazyDevMode: 'never', showTokenCounter: false, injected: 'x' }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).settings).not.toHaveProperty('injected')
  })
})
