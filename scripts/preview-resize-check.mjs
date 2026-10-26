// Checks the two UI changes that are easy to regress:
//
// 1. No duplicated controls — one way to hide the preview panel, one way to
//    clear the loaded page, one model-manager entry point in the topbar.
// 2. The preview panel resizes by dragging its left edge, the width survives a
//    reload (localStorage), a double-click resets it, and hiding the panel
//    collapses the grid instead of leaving an empty column behind.
//
// Usage: node scripts/preview-resize-check.mjs [url] [--shot=file.png]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const URL_ = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3123'
const SHOT = (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1]
const PORT = 9337
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-resize-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDir}`,
      '--window-size=1600,950',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let ws
  let msgId = 0
  const pending = new Map()
  const events = []
  const failures = []

  try {
    let target
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
        target = list.find((t) => t.type === 'page')
        if (target) break
      } catch {}
      await sleep(250)
    }
    if (!target) throw new Error('devtools never came up')

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = () => rej(new Error('ws failed'))
    })
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      } else if (m.method) events.push(m)
    }
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++msgId
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })

    const js = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
      return r.result.value
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: URL_ })
    await sleep(2500)

    const check = (name, ok, detail) => {
      if (!ok) failures.push(`${name} — ${JSON.stringify(detail)}`)
      return ok
    }

    /* ------------------------------------------------ redundancy audit */
    const controls = await js(`(() => {
      const txt = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()
      const buttons = [...document.querySelectorAll('button')]
      const inventory = buttons.map((b) => ({
        text: txt(b).slice(0, 32),
        aria: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        cls: b.className.slice(0, 28),
      }))
      return {
        previewHeaderButtons: document.querySelectorAll('.preview-header button').length,
        closeButtons: buttons.filter((b) => /close/i.test(txt(b))).map(txt),
        hideShowButtons: buttons.filter((b) => /(hide|show) preview/i.test(txt(b))).map(txt),
        topActionButtons: [...document.querySelectorAll('.top-actions button')].map(txt),
        removedControls: buttons.filter((b) => /select local model/i.test(txt(b)) || /^settings$/i.test(txt(b)) || /^settings$/i.test(b.getAttribute('aria-label') || '')).map(txt),
        legendNote: document.querySelectorAll('.legend-note').length,
        sessionRows: [...document.querySelectorAll('.session')].map(txt),
        resizeHandles: document.querySelectorAll('.preview-resizer').length,
        inventory,
      }
    })()`)

    check('exactly one Close-page control', controls.closeButtons.length === 1, controls.closeButtons)
    check('exactly one hide/show-preview control', controls.hideShowButtons.length === 1, controls.hideShowButtons)
    check('no close button in the preview header', controls.previewHeaderButtons === 0, controls.previewHeaderButtons)
    check('topbar has a single action button (avatar toggle)', controls.topActionButtons.length === 1, controls.topActionButtons)
    check('the removed duplicate controls are gone', controls.removedControls.length === 0, controls.removedControls)
    check('footer duplicate status note removed', controls.legendNote === 0, controls.legendNote)
    check('one session row', controls.sessionRows.length === 1, controls.sessionRows)
    check('one resize handle', controls.resizeHandles === 1, controls.resizeHandles)

    /* ------------------------------------------------------ drag resize */
    const widthOf = () => js(`Math.round(document.querySelector('.preview-panel').getBoundingClientRect().width)`)

    const before = await widthOf()
    const handle = await js(`(() => {
      const r = document.querySelector('.preview-resizer').getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)

    // Drag the handle 150px to the left → the panel should grow by ~150px.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let step = 1; step <= 6; step++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: handle.x - (150 / 6) * step,
        y: handle.y,
        button: 'left',
        buttons: 1,
      })
      await sleep(40)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x - 150, y: handle.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
    const dragged = await widthOf()
    check('drag left grows the preview', dragged - before >= 130, { before, dragged })

    // Drag far right → clamped at the 300px floor, chat keeps its minimum.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x - 150, y: handle.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let step = 1; step <= 6; step++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x - 150 + 60 * step, y: handle.y, button: 'left', buttons: 1 })
      await sleep(30)
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 210, y: handle.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(300)
    const floored = await widthOf()
    check('drag right clamps at the 300px floor', floored === 300, { floored })

    // Reload → the clamped width was saved and comes back.
    await send('Page.reload')
    await sleep(2500)
    const afterReload = await widthOf()
    check('width survives a reload', afterReload === floored, { floored, afterReload })

    // Double-click resets to 370.
    const handle2 = await js(`(() => {
      const r = document.querySelector('.preview-resizer').getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })()`)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle2.x, y: handle2.y, button: 'left', buttons: 1, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle2.x, y: handle2.y, button: 'left', buttons: 0, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle2.x, y: handle2.y, button: 'left', buttons: 1, clickCount: 2 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle2.x, y: handle2.y, button: 'left', buttons: 0, clickCount: 2 })
    await sleep(400)
    const reset = await widthOf()
    check('double-click resets to 370', reset === 370, { reset })

    /* --------------------------------------------- collapse the panel */
    const collapsed = await js(`(() => {
      [...document.querySelectorAll('button')].find((b) => /hide preview/i.test(b.textContent))?.click()
      return true
    })()`)
    await sleep(500)
    const collapsedLayout = await js(`(() => {
      const layout = document.querySelector('.workspace-layout')
      const chat = document.querySelector('.chat-column').getBoundingClientRect()
      return {
        noPreviewClass: layout.classList.contains('no-preview'),
        columns: getComputedStyle(layout).gridTemplateColumns,
        panelGone: !document.querySelector('.preview-panel'),
        chatRight: Math.round(chat.right),
        viewport: window.innerWidth,
        leftoverGap: Math.round(window.innerWidth - chat.right),
      }
    })()`)
    check('hiding the panel collapses the grid', collapsedLayout.noPreviewClass && collapsedLayout.panelGone, collapsedLayout)
    check('chat column takes the freed width', collapsedLayout.leftoverGap <= 2, collapsedLayout)

    // Bring it back for the screenshot.
    await js(`[...document.querySelectorAll('button')].find((b) => /show preview/i.test(b.textContent))?.click()`)
    await sleep(600)

    if (SHOT) {
      const full = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(SHOT, Buffer.from(full.data, 'base64'))
    }

    const consoleErrors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => e.params.args.map((a) => a.value || a.description).join(' '))

    console.log(
      JSON.stringify(
        {
          url: URL_,
          controls,
          resize: { before, dragged, floored, afterReload, reset },
          collapsedLayout,
          consoleErrors,
          failures,
          result: failures.length ? 'FAIL' : 'PASS',
          shot: SHOT || null,
        },
        null,
        2,
      ),
    )
    if (failures.length) process.exitCode = 1
  } finally {
    try {
      ws?.close()
    } catch {}
    chrome.kill()
    await sleep(300)
    try {
      fs.rmSync(userDir, { recursive: true, force: true })
    } catch {}
  }
}

main().catch((e) => {
  console.error('preview-resize-check failed:', e.message)
  process.exit(1)
})
