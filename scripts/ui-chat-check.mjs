// Drives the real chat UI in headless Chrome: types a prompt, clicks send,
// waits for the agent to finish, then reports what the transcript actually
// rendered (tool cards, permission cards, final text).
// Usage: node scripts/ui-chat-check.mjs "your prompt" [url]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROMPT = process.argv[2] || 'Use the fs_list tool on lib/tools and tell me how many files are there.'
const URL_ = process.argv[3] || 'http://localhost:3123/'
const PORT = 9334
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = path.join(os.tmpdir(), `hermione-chat-${Date.now()}`)
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
  await send('Page.navigate', { url: URL_ })
  await sleep(7000)

  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

  const typed = await evalJs(`(() => {
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
  console.log('prompt:', JSON.stringify(PROMPT))
  console.log('dispatch:', typed)

  // Wait until the transcript stops growing (max ~3 min).
  let last = ''
  let stable = 0
  for (let i = 0; i < 90; i++) {
    await sleep(2000)
    const snapshot = await evalJs(`(() => {
      const t = document.querySelector('.transcript');
      return t ? t.innerText : '';
    })()`)
    const busy = await evalJs(`!!document.querySelector('.send-button[disabled]')`)
    if (snapshot === last && !busy) {
      stable++
      if (stable >= 2) break
    } else {
      stable = 0
    }
    last = snapshot
  }

  // Optional: click Approve on the first permission card, then wait again.
  if (process.argv.includes('--approve')) {
    const clicked = await evalJs(`(() => {
      const btn = [...document.querySelectorAll('.permission-card .button')].find((b) => /Approve/i.test(b.innerText));
      if (!btn) return 'no approve button';
      btn.click();
      return 'clicked: ' + btn.innerText.trim();
    })()`)
    console.log('approval click:', clicked)

    let last2 = ''
    let stable2 = 0
    for (let i = 0; i < 90; i++) {
      await sleep(2000)
      const snapshot = await evalJs(`(() => {
        const t = document.querySelector('.transcript');
        return t ? t.innerText : '';
      })()`)
      const busy = await evalJs(`!!document.querySelector('.send-button[disabled]')`)
      if (snapshot === last2 && !busy) {
        stable2++
        if (stable2 >= 2) break
      } else {
        stable2 = 0
      }
      last2 = snapshot
    }
  }

  const result = await evalJs(`(() => {
    const transcript = document.querySelector('.transcript');
    const cards = [...document.querySelectorAll('.action-card')].map((c) => ({
      tool: (c.querySelector('.action-copy strong')?.innerText || '').trim(),
      args: (c.querySelector('.action-copy span')?.innerText || '').trim(),
      status: (c.querySelector('.status-pill')?.innerText || '').trim(),
      classes: c.className,
    }));
    const approvals = [...document.querySelectorAll('.permission-card')].map((c) => ({
      title: (c.querySelector('strong')?.innerText || '').trim(),
      code: (c.querySelector('.permission-code span')?.innerText || '').trim(),
    }));
    const resolved = [...document.querySelectorAll('.permission-resolved')].map((c) => c.innerText.trim());
    const answers = [...document.querySelectorAll('.agent-message .message-body > p')].map((p) => p.innerText.trim()).filter(Boolean);
    return { transcript: transcript ? transcript.innerText.slice(0, 1400) : '', cards, approvals, resolved, answers };
  })()`)

  console.log('\n--- rendered tool cards ---')
  for (const c of result.cards) console.log(` ${c.status.padEnd(14)} ${c.tool}  ${c.args}`)
  if (!result.cards.length) console.log(' (none)')

  console.log('\n--- permission cards ---')
  for (const a of result.approvals) console.log(` ${a.title} :: ${a.code}`)
  for (const r of result.resolved) console.log(` resolved: ${r.replace(/\n/g, ' ')}`)
  if (!result.approvals.length && !result.resolved.length) console.log(' (none)')

  console.log('\n--- agent answers ---')
  for (const a of result.answers) console.log(` ${a}`)

  console.log('\n--- page errors ---')
  for (const e of errors) console.log(' ' + String(e).split('\n')[0])
  if (!errors.length) console.log(' (none)')
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
