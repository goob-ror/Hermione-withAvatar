// Headless Chrome check: loads the console, collects console errors, verifies
// the Live2D canvas actually rendered, and writes a screenshot.
// Usage: node scripts/ui-check.mjs [url] [outPng]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const URL_ = process.argv[2] || 'http://localhost:3123/'
const OUT = process.argv[3] || path.join(os.tmpdir(), 'hermione-ui.png')
const PORT = 9333
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PROFILE = path.join(os.tmpdir(), `hermione-cdp-${Date.now()}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {}
    await sleep(250)
  }
  throw new Error('devtools endpoint never came up')
}

const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1680,1050',
    '--hide-scrollbars',
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

let ws
let id = 0
const pending = new Map()
const logs = []
const exceptions = []

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
    }, 30000)
  })
}

try {
  const version = await waitForDevTools()
  console.log('browser:', version.Browser)

  const target = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json())
  ws = new WebSocket(target.webSocketDebuggerUrl)

  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message}`))
      else resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
      logs.push(`[${msg.params.type}] ${text}`)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      exceptions.push(d.exception?.description || d.text)
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry
      logs.push(`[${e.level}] ${e.text}`)
    }
  }

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_ })

  // Give React + pixi + the Live2D model time to boot.
  await sleep(9000)

  const evalJs = async (expr) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value

  const dom = await evalJs(`(() => {
    const canvas = document.querySelector('canvas');
    let pixels = 'no canvas';
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d') || canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (ctx && ctx.getImageData) {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let opaque = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
          pixels = opaque + '/' + (data.length / 4) + ' opaque px';
        } else {
          pixels = 'webgl context (readback not possible via 2d api)';
        }
      } catch (e) { pixels = 'readback failed: ' + e.message; }
    }
    return {
      title: document.title,
      bodyLen: document.body.innerText.length,
      canvas: canvas ? canvas.width + 'x' + canvas.height : 'none',
      canvasPixels: pixels,
      loadingText: document.body.innerText.includes('Loading Live2D') ? 'still loading' : 'loading text gone',
      composer: !!document.querySelector('.composer input'),
      avatarToggle: document.body.innerText.includes('Avatar: Live2D') ? 'Live2D' : 'other',
      toolPalette: document.body.innerText.includes('Tool palette'),
      emptyState: document.body.innerText.includes('root-locked to the project'),
    };
  })()`)

  console.log('DOM:', JSON.stringify(dom, null, 2))

  const rect = await evalJs(`(() => {
    const el = document.querySelector('.companion-wrap');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`)
  console.log('companion rect:', JSON.stringify(rect))

  const bodyText = await evalJs('document.body.innerText')
  console.log('body text (first 600 chars):', JSON.stringify(String(bodyText).slice(0, 600)))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log('screenshot:', OUT, fs.statSync(OUT).size, 'bytes')

  if (rect && rect.w > 0 && rect.h > 0) {
    const clipShot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 },
    })
    const clipPath = OUT.replace(/\.png$/, '-companion.png')
    fs.writeFileSync(clipPath, Buffer.from(clipShot.data, 'base64'))
    console.log('companion crop:', clipPath, fs.statSync(clipPath).size, 'bytes')
  }

  console.log(`\nconsole (${logs.length} entries):`)
  for (const l of logs.slice(0, 25)) console.log('  ' + l)
  console.log(`\nexceptions (${exceptions.length}):`)
  for (const e of exceptions.slice(0, 10)) console.log('  ' + String(e).split('\n')[0])
} finally {
  try {
    ws?.close()
  } catch {}
  child.kill()
  await sleep(500)
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {}
}
