import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright-core'
import { bridgeScript } from '@/lib/preview/bridge'
import { detectChrome } from '@/lib/browser/chrome'

/**
 * Runs the real preview bridge in the installed Chrome (headless) against a
 * fixture page, driving it exactly like the console does (postMessage).
 * Skipped when Chrome isn't installed.
 */
const chromePath = detectChrome()

const FIXTURE = `<!doctype html><html><head><title>Fixture travel</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 12px }
  .hide { position: absolute; opacity: 0; width: 1px; height: 1px }
  #spacer { height: 2600px }
  #modal { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: none }
  #modal.open { display: block }
</style></head><body>
<h1>Find a flight</h1>
<form id="search" action="https://example.com/search" method="get">
  <label for="from">From</label><input id="from" name="from" value="Zurich">
  <input id="to" name="to" aria-label="Where to?" role="combobox" aria-autocomplete="list" aria-expanded="false">
  <ul id="suggest" role="listbox" hidden></ul>
  <select id="cabin" name="cabin"><option>Economy</option><option>Business</option><option>First</option></select>
  <label><input type="checkbox" class="hide" id="flex" name="flex"> Flexible dates</label>
  <input type="password" id="pw" placeholder="Password" value="secret123">
  <button type="submit">Search</button>
  <button type="button" disabled>Disabled thing</button>
</form>
<form id="login" action="https://example.com/login" method="post"><input name="user" placeholder="User"><button>Log in</button></form>
<a href="https://example.com/deals">Deals</a>
<a href="#top">Back to top</a>
<button id="open-modal" onclick="document.getElementById('modal').classList.add('open')">Open modal</button>
<button id="behind">Behind button</button>
<button id="remove-me" onclick="this.remove()">Remove me</button>
<div id="spacer"></div>
<button id="footer">Footer button</button>
<div id="modal" role="dialog" aria-label="Cookie consent">
  <button onclick="document.getElementById('modal').classList.remove('open')" style="position:absolute;top:40%;left:40%">Accept cookies</button>
</div>
<script>
  var to = document.getElementById('to'), sug = document.getElementById('suggest')
  to.addEventListener('input', function () {
    setTimeout(function () {
      sug.innerHTML = to.value ? '<li role="option">London Heathrow</li><li role="option">London City</li>' : ''
      sug.hidden = !to.value
      to.setAttribute('aria-expanded', String(!!to.value))
    }, 150)
  })
  window.__fromInputs = []
  document.getElementById('from').addEventListener('input', function (e) { window.__fromInputs.push(e.target.value) })
</script>
${bridgeScript()}
</body></html>`

let browser: Browser
let page: Page

/** Same protocol as the console: post a command, wait for the matching reply. */
async function ask(command: string, args: Record<string, unknown> = {}) {
  return page.evaluate(
    ([command, args]) =>
      new Promise<{ ok: boolean; output: string; navigate?: string }>((resolve) => {
        const id = 'c' + Math.random().toString(36).slice(2)
        const on = (e: MessageEvent) => {
          if (e.data?.__hermione === 'res' && e.data.id === id) {
            removeEventListener('message', on)
            resolve(e.data)
          }
        }
        addEventListener('message', on)
        postMessage({ __hermione: 'cmd', id, command, args }, '*')
      }),
    [command, args] as const,
  )
}

/** Element number for a name in a snapshot listing. */
function num(listing: string, name: string): number {
  const m = listing.match(new RegExp('\\[(\\d+)\\] \\S+ "' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  if (!m) throw new Error(`"${name}" not in listing:\n${listing}`)
  return Number(m[1])
}

describe.skipIf(!chromePath)('preview bridge in a real browser', () => {
  beforeAll(async () => {
    const { chromium } = await import('playwright-core')
    browser = await chromium.launch({ executablePath: chromePath, headless: true })
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })
  beforeEach(async () => {
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await page.setContent(FIXTURE, { waitUntil: 'load' })
  })

  it('lists visible controls with roles, names and states', async () => {
    const { ok, output } = await ask('snapshot')
    expect(ok).toBe(true)
    expect(output).toMatch(/page: Fixture travel/)
    expect(output).toMatch(/headings in view: Find a flight/)
    expect(output).toMatch(/\] textbox "From" · "Zurich"/)
    expect(output).toMatch(/\] combobox "Where to\?" · empty, collapsed/)
    expect(output).toMatch(/\] select "[^"]*" · "Economy", options: Economy \| Business \| First/)
    expect(output).toMatch(/\] checkbox "Flexible dates" · unchecked/) // hidden input offered via its label
    expect(output).toMatch(/\] link "Deals" · → example\.com\/deals/)
    expect(output).toMatch(/\] button "Footer button" \(below\)/)
  })

  it('never exposes password values and skips disabled controls', async () => {
    const { output } = await ask('snapshot')
    expect(output).toMatch(/\] password "Password" · filled/)
    expect(output).not.toContain('secret123')
    expect(output).not.toContain('Disabled thing')
  })

  it('keeps the same number for the same element across snapshots', async () => {
    const a = (await ask('snapshot')).output
    const b = (await ask('snapshot')).output
    expect(num(b, 'Deals')).toBe(num(a, 'Deals'))
    expect(num(b, 'From')).toBe(num(a, 'From'))
  })

  it('types by number the way frameworks expect, and reports what changed', async () => {
    const list = (await ask('snapshot')).output
    const res = await ask('fill', { target: num(list, 'From'), value: 'Geneva' })
    expect(res.ok).toBe(true)
    expect(res.output).toMatch(/typed "Geneva" into \[\d+\] textbox "From"/)
    expect(res.output).toMatch(/changes: .*now: "Geneva"/)
    expect(res.output).toMatch(/\] textbox "From" · "Geneva"/) // fresh list included
    expect(await page.evaluate(() => (window as any).__fromInputs)).toContain('Geneva')
  })

  it('waits for autocomplete suggestions after typing into a combobox', async () => {
    const list = (await ask('snapshot')).output
    const res = await ask('fill', { target: num(list, 'Where to?'), value: 'London' })
    expect(res.output).toMatch(/\] option "London Heathrow"/)
    expect(res.output).toMatch(/combobox "Where to\?" · "London", expanded/)
  })

  it('chooses dropdown options and toggles a label-drawn checkbox', async () => {
    const list = (await ask('snapshot')).output
    const sel = await ask('select', { target: num(list, 'cabin'), value: 'business' })
    expect(sel.output).toMatch(/chose "Business"/)
    expect(await page.$eval('#cabin', (e: any) => e.value)).toBe('Business')

    const chk = await ask('check', { target: num(list, 'Flexible dates') })
    expect(chk.output).toMatch(/checked \[\d+\] checkbox "Flexible dates"/)
    expect(await page.$eval('#flex', (e: any) => e.checked)).toBe(true)
    const again = await ask('check', { target: num(list, 'Flexible dates') })
    expect(again.output).toMatch(/already checked/)
  })

  it('refuses to click something covered by a dialog, and returns a fresh list', async () => {
    const list = (await ask('snapshot')).output
    const open = await ask('click', { target: num(list, 'Open modal') })
    expect(open.output).toMatch(/a dialog opened/)
    expect(open.output).toMatch(/open dialog: "Cookie consent"/)

    const blocked = await ask('click', { target: num(list, 'Behind button') })
    expect(blocked.ok).toBe(false)
    expect(blocked.output).toMatch(/is covered by div#modal/)
    expect(blocked.output).toMatch(/\] button "Accept cookies"/) // fresh list to pick from

    const accept = await ask('click', { target: num(blocked.output, 'Accept cookies') })
    expect(accept.output).toMatch(/a dialog closed/)
  })

  it('reports a vanished element instead of acting on it', async () => {
    const list = (await ask('snapshot')).output
    const n = num(list, 'Remove me')
    await ask('click', { target: n })
    const res = await ask('click', { target: n })
    expect(res.ok).toBe(false)
    expect(res.output).toMatch(new RegExp(`element \\[${n}\\] is gone`))
    expect(res.output).toMatch(/elements \(/) // with a fresh list
  })

  it('hands real navigations back instead of leaving the page', async () => {
    const list = (await ask('snapshot')).output
    const link = await ask('click', { target: num(list, 'Deals') })
    expect(link.navigate).toBe('https://example.com/deals')
    expect(page.url()).toBe('about:blank') // still on the fixture, bridge alive

    const search = await ask('fill', { target: num(list, 'Where to?'), value: 'London', submit: true })
    // Only named fields are sent, exactly as a browser would (the password field has no name).
    expect(search.navigate).toBe('https://example.com/search?from=Zurich&to=London&cabin=Economy')
  })

  it('refuses to post forms and keeps same-page anchors local', async () => {
    const list = (await ask('snapshot')).output
    const login = await ask('click', { target: num(list, 'Log in') })
    expect(login.ok).toBe(false)
    expect(login.output).toMatch(/sends data with POST/)
    const anchor = await ask('click', { target: num(list, 'Back to top') })
    expect(anchor.navigate).toBeUndefined()
  })

  it('scrolls by viewport and brings far elements into view', async () => {
    const down = await ask('scroll', { direction: 'down' })
    expect(down.output).toMatch(/view: [1-9]\d*–/)
    const list = (await ask('scroll', { direction: 'bottom' })).output
    expect(list).toMatch(/\] button "Footer button"(?! \(below\))/)
  })

  it('explains unknown numbers', async () => {
    const res = await ask('click', { target: 9999 })
    expect(res.ok).toBe(false)
    expect(res.output).toMatch(/there is no element \[9999\]/)
  })
})
