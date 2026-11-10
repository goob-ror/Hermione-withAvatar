import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { isPrivateIp, publicFetch, PrivateAddressError } from '@/lib/http/publicFetch'
import { proxy } from '@/proxy'
import { TOOL_MAP } from '@/lib/tools'

describe('isPrivateIp', () => {
  it.each([
    ['127.0.0.1', true], ['10.1.2.3', true], ['192.168.1.1', true], ['172.20.0.1', true],
    ['169.254.169.254', true], ['100.64.0.1', true], ['0.0.0.0', true], ['::1', true],
    ['fd00::1', true], ['fe80::1', true], ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false], ['93.184.215.14', false], ['2606:4700::1111', false],
  ])('%s → private=%s', (ip, want) => {
    expect(isPrivateIp(ip)).toBe(want)
  })
})

describe('publicFetch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses localhost and LAN targets before any request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://192.168.1.1/', 'http://[::1]/']) {
      await expect(publicFetch(url)).rejects.toBeInstanceOf(PrivateAddressError)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a public page that redirects into localhost', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3000/api/terminal' } }))
    vi.stubGlobal('fetch', fetchSpy)
    await expect(publicFetch('https://93.184.215.14/start')).rejects.toBeInstanceOf(PrivateAddressError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe('proxy (API request guard)', () => {
  const call = (init: { method?: string; headers?: Record<string, string>; url?: string }) =>
    proxy(new NextRequest(init.url ?? 'http://localhost:3000/api/terminal', { method: init.method ?? 'GET', headers: { host: 'localhost:3000', ...init.headers } }))
  const status = (r: Response) => r.status

  it('lets the app itself and scripts through', () => {
    expect(status(call({ headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' } }))).toBe(200)
    expect(status(call({ method: 'POST', headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } }))).toBe(200)
    expect(status(call({ method: 'POST' }))).toBe(200) // curl / server-to-server: no browser headers
  })

  it('allows the cross-site OAuth callback navigation', () => {
    expect(status(call({ url: 'http://localhost:3000/api/google/callback', headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }))).toBe(200)
  })

  it.each([
    ['sandboxed page (Origin: null)', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } }],
    ['other website POST', { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } }],
    ['other localhost port', { method: 'POST', headers: { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'cors' } }],
    ['cross-site background GET', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' } }],
    ['old browser, foreign Origin', { method: 'POST', headers: { origin: 'https://evil.example' } }],
  ])('refuses %s', (_name, init) => {
    expect(status(call(init as any))).toBe(403)
  })

  it('refuses DNS-rebinding hosts', () => {
    const r = proxy(new NextRequest('http://evil.example:3000/api/providers', { headers: { host: 'evil.example:3000', origin: 'http://evil.example:3000' } }))
    expect(r.status).toBe(403)
  })
})

describe('approval routing', () => {
  const tier = (tool: string, args: Record<string, unknown> = {}) => {
    const def = TOOL_MAP[tool]
    return def.needsApproval ? (def.needsApproval(args) ? 'confirm' : 'auto') : def.tier
  }

  it('keeps everything that changes the machine behind approval', () => {
    for (const tool of ['shell_run', 'terminal_run', 'fs_write', 'fs_delete']) expect(tier(tool)).toBe('confirm')
  })

  it('runs research tools automatically', () => {
    for (const tool of ['web_search', 'web_fetch', 'site_inspect', 'page_open', 'page_read']) expect(tier(tool)).toBe('auto')
  })

  it('splits page_act: reads free, actions (and unknown commands) ask', () => {
    for (const command of ['text', 'query', 'count', 'title', 'links', 'url']) expect(tier('page_act', { command })).toBe('auto')
    for (const command of ['click', 'fill', 'submit', 'scroll', 'bogus', '']) expect(tier('page_act', { command })).toBe('confirm')
  })
})
