// End-to-end proof that the agent can drive the preview panel:
//   prompt → page_open (approve) → page_act click (approve) → answer
// then reads the iframe's own DOM (same-origin) to confirm the click landed.
//
// Usage: node scripts/ui-preview-check.mjs "<prompt>" [url] [--max-approvals N]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROMPT = process.argv[2] || 'Open http://localhost:3123/fixture/ then click the Greet button.'
const APP_URL = process.argv[3] || 'http://localhost:3123/'
const MAX_APPROVALS = Number((process.argv.find((a) => a.startsWith('--max-approvals=')) || '').split('=')[1] || 6)
const PORT = 9335
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = path.join(os.tmpdir(), `hermione-preview-${Date.now()}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1680,1050',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let id = 0
const pending = new Map()
const errors = []

function send(method, params = {}) {
  const msgId = ++id
  ws.send(JSON.stringify({ id: msgId, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject })
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId)
        reject(new Error(`timeout: ${method}`))
      }
    }, 60000)
  })
}

try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch {}
    await sleep(250)
  }

  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args || []).map((a) => a.value ?? a.description).join(' '))
    }
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: APP_URL })
  await sleep(7000)

  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

  // --urlbar=URL drives the panel's own URL bar instead of the agent.
  const urlBarArg = process.argv.find((a) => a.startsWith('--urlbar='))
  let dispatched = 'skipped (urlbar mode)'

  if (urlBarArg) {
    const target = urlBarArg.slice('--urlbar='.length)
    const typed = await evalJs(`(() => {
      const input = document.querySelector('.url-input');
      if (!input) return 'no url input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(target)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = document.querySelector('.url-bar');
      if (form && form.requestSubmit) { form.requestSubmit(); return 'submitted'; }
      return 'no form';
    })()`)
    console.log('urlbar:', JSON.stringify(target), '→', typed)
    await sleep(6000)
  } else {
    dispatched = await evalJs(`(() => {
      const input = document.querySelector('.composer input');
      if (!input) return 'no input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(PROMPT)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector('.send-button');
      if (!btn) return 'no send button';
      btn.click();
      return 'sent';
    })()`)
  }
  console.log('prompt:', JSON.stringify(PROMPT))
  console.log('dispatch:', dispatched)

  // Approve whatever the gate asks for, up to MAX_APPROVALS times.
  let approvals = 0
  let idleChecks = 0
  for (let tick = 0; tick < 160; tick++) {
    if (urlBarArg) break
    await sleep(1500)
    const state = JSON.parse(
      await evalJs(`(() => {
        const card = document.querySelector('.permission-card');
        const busy = !!document.querySelector('.send-button[disabled]');
        const t = document.querySelector('.transcript');
        return JSON.stringify({ card: !!card, busy, len: t ? t.innerText.length : 0 });
      })()`),
    )

    if (state.card && approvals < MAX_APPROVALS) {
      const clicked = await evalJs(`(() => {
        const btn = [...document.querySelectorAll('.permission-card .button')].find((b) => /Approve/i.test(b.innerText));
        if (!btn) return 'no approve button';
        btn.click();
        return 'clicked';
      })()`)
      approvals += 1
      console.log(`approval ${approvals}: ${clicked}`)
      idleChecks = 0
      continue
    }

    if (!state.busy && !state.card) {
      idleChecks += 1
      if (idleChecks >= 3) break
    } else {
      idleChecks = 0
    }
  }

  const result = await evalJs(`(() => {
    const frame = document.querySelector('.site-frame');
    let frameInfo = null;
    try {
      const doc = frame && frame.contentDocument;
      frameInfo = doc
        ? {
            url: doc.location ? doc.location.href : '',
            title: doc.title,
            h1: (doc.querySelector('h1') || {}).innerText || '',
            out: (doc.getElementById('out') || {}).textContent || '',
            bridge: !!doc.querySelector('script[data-hermione-bridge]'),
            inputValue: (doc.getElementById('name') || {}).value || '',
          }
        : null;
    } catch (err) {
      frameInfo = { error: String(err && err.message) };
    }

    const cards = [...document.querySelectorAll('.action-card')].map((c) => ({
      tool: (c.querySelector('.action-copy strong')?.innerText || '').trim(),
      args: (c.querySelector('.action-copy span')?.innerText || '').trim(),
      status: (c.querySelector('.status-pill')?.innerText || '').trim(),
    }));
    const answers = [...document.querySelectorAll('.agent-message .message-body > p')]
      .map((p) => p.innerText.trim())
      .filter(Boolean);
    const title = (document.querySelector('.preview-header strong') || {}).innerText || '';
    const urlBar = (document.querySelector('.url-input') || {}).value || '';

    return { frameInfo, cards, answers, title, urlBar };
  })()`)

  console.log('\n--- tool cards ---')
  for (const c of result.cards) console.log(` ${c.status.padEnd(10)} ${c.tool}  ${c.args}`)
  if (!result.cards.length) console.log(' (none)')

  console.log('\n--- preview panel ---')
  console.log(' header title:', result.title)
  console.log(' url bar    :', result.urlBar)
  console.log(' frame      :', JSON.stringify(result.frameInfo))

  console.log('\n--- agent answers ---')
  for (const a of result.answers) console.log(` ${a}`)
  if (!result.answers.length) console.log(' (none)')

  console.log('\n--- page errors ---')
  for (const e of errors) console.log(' ' + String(e).split('\n')[0])
  if (!errors.length) console.log(' (none)')

  const shotArg = process.argv.find((a) => a.startsWith('--shot='))
  if (shotArg) {
    const shotPath = shotArg.slice('--shot='.length)
    await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false })
    await sleep(600)

    const rect = await evalJs(`(() => {
      const el = document.querySelector('.site-frame');
      const panel = document.querySelector('.preview-panel');
      const r = el ? el.getBoundingClientRect() : null;
      const p = panel ? panel.getBoundingClientRect() : null;
      return JSON.stringify({ frame: r && { x: r.x, y: r.y, w: r.width, h: r.height }, panel: p && { x: p.x, y: p.y, w: p.width, h: p.height } });
    })()`)
    console.log('\nrects:', rect)

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))
    console.log('screenshot:', shotPath, `${fs.statSync(shotPath).size} bytes`)

    // A crop of just the previewed page — proof the iframe painted.
    const parsed = JSON.parse(rect || '{}')
    if (parsed.frame && parsed.frame.w > 0) {
      const cropPath = shotPath.replace(/\.png$/, '-frame.png')
      const cropped = await send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: Math.round(parsed.frame.x),
          y: Math.round(parsed.frame.y),
          width: Math.round(parsed.frame.w),
          height: Math.round(parsed.frame.h),
          scale: 1,
        },
      })
      fs.writeFileSync(cropPath, Buffer.from(cropped.data, 'base64'))
      console.log('frame crop:', cropPath, `${fs.statSync(cropPath).size} bytes`)
    }
  }
} finally {
  try {
    ws?.close()
  } catch {}
  child.kill()
  await sleep(400)
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {}
}
