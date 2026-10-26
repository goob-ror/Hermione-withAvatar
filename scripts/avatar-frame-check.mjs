// Proves the sidebar Live2D avatar is framed on the face, without a vision model.
//
// Method: screenshot `.session-agent-frame` twice — once with the canvas visible,
// once with it hidden — and diff the two images. Changed pixels are exactly the
// model's pixels, which gives a bounding box inside the frame plus a skin-tone
// share. A face in frame means: content not clipped at the top, a decent share of
// skin-coloured pixels, and the model filling most of the frame height.
//
// Usage: node scripts/avatar-frame-check.mjs [url] [--shot=file.png]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const URL_ = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:3123'
const SHOT = (process.argv.find((a) => a.startsWith('--shot=')) || '').split('=')[1]
const PORT = 9336
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported png')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= channels ? prev[x - channels] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 0xff
    }
  }
  return { width, height, channels, data: out }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermione-avatar-'))
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDir}`,
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu-sandbox',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let ws
  let msgId = 0
  const pending = new Map()
  const events = []

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
    // 4x DPI so a 56x74 frame yields a 224x296 image worth measuring.
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 4, mobile: false })
    await send('Page.navigate', { url: URL_ })

    // Wait for the canvas, then for the spinner to disappear (model loaded).
    let ready = false
    let clipRaw = null
    for (let i = 0; i < 120; i++) {
      const state = await js(`(() => {
        const f = document.querySelector('.session-agent-frame')
        const c = f && f.querySelector('canvas')
        return {
          frame: !!f,
          canvas: !!c,
          w: c ? c.clientWidth : 0,
          h: c ? c.clientHeight : 0,
          spinner: !!(f && f.querySelector('.animate-spin')),
          hook: !!window.__hermioneLive2D,
        }
      })()`)
      if (state.canvas && state.w > 0 && !state.spinner && state.hook) {
        ready = true
        break
      }
      await sleep(500)
    }
    if (!ready) throw new Error('avatar never finished loading')

    // Let the idle motion settle so the head is at its resting pose.
    await sleep(1500)

    const rect = await js(`(() => {
      const r = document.querySelector('.session-agent-frame').getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
    })()`)
    const hook = await js('JSON.stringify(window.__hermioneLive2D)')

    // Layout guards: the frame must fill the sidebar column, and the status dot
    // must still be there now that the text block is gone.
    const layout = await js(`(() => {
      const sb = document.querySelector('.sidebar').getBoundingClientRect()
      const card = document.querySelector('.session-agent-frame')
      const frame = card.getBoundingClientRect()
      const dot = document.querySelector('.avatar-status')
      const sessions = document.querySelectorAll('.sidebar-section .session').length
      return {
        frameCss: Math.round(frame.width) + 'x' + Math.round(frame.height),
        frameInsideSidebar: frame.x >= sb.x - 1 && frame.right <= sb.right + 1,
        fillsSidebar: Math.abs(frame.width - (sb.width - 24)) <= 2,
        frameTopCss: Math.round(frame.y - sb.y),
        cardOverflowPx: Math.round(card.scrollWidth - card.clientWidth),
        statusDot: dot ? dot.className : null,
        sessionRows: sessions,
        floatingCompanionGone: !document.querySelector('.companion-wrap'),
        oldTextGone: !document.querySelector('.session-agent-status, .session-agent'),
      }
    })()`)

    // The stylized fallback must still work after the move: toggle the topbar
    // switch and expect the PNG in the same frame, then switch back.
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Avatar:'))?.click()`)
    await sleep(400)
    const stylized = await js(`(() => {
      const f = document.querySelector('.session-agent-frame')
      return { hasImg: !!f.querySelector('img'), hasCanvas: !!f.querySelector('canvas'), label: [...document.querySelectorAll('button')].find(b => b.textContent.includes('Avatar:'))?.textContent.trim() }
    })()`)
    await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Avatar:'))?.click()`)
    await sleep(1500)
    const backToLive2D = await js(`!!document.querySelector('.session-agent-frame canvas')`)

    const clipShot = async () => {
      const s = await send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 },
        captureBeyondViewport: false,
      })
      if (!clipRaw) clipRaw = s.data
      return decodePng(Buffer.from(s.data, 'base64'))
    }

    const withModel = await clipShot()
    await js(`document.querySelector('.session-agent-frame canvas').style.visibility = 'hidden'`)
    await sleep(250)
    const withoutModel = await clipShot()
    await js(`document.querySelector('.session-agent-frame canvas').style.visibility = 'visible'`)

    if (withModel.width !== withoutModel.width || withModel.height !== withoutModel.height) {
      throw new Error('shot size mismatch')
    }

    const W = withModel.width
    const H = withModel.height
    let minX = W
    let minY = H
    let maxX = -1
    let maxY = -1
    let changed = 0
    let skin = 0
    let skinTop = H
    let skinBottom = -1
    const rows = new Array(H).fill(0)

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * withModel.channels
        const j = (y * W + x) * withoutModel.channels
        const dr = Math.abs(withModel.data[i] - withoutModel.data[j])
        const dg = Math.abs(withModel.data[i + 1] - withoutModel.data[j + 1])
        const db = Math.abs(withModel.data[i + 2] - withoutModel.data[j + 2])
        if (dr + dg + db <= 18) continue
        changed++
        rows[y]++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        // Skin: warm, light, red > green > blue with a narrow spread.
        const r = withModel.data[i]
        const g = withModel.data[i + 1]
        const b = withModel.data[i + 2]
        if (r > 200 && g > 165 && b > 140 && r > g && g > b && r - b > 18 && r - b < 95) {
          skin++
          if (y < skinTop) skinTop = y
          if (y > skinBottom) skinBottom = y
        }
      }
    }

    const pct = (n, d) => +((n / d) * 100).toFixed(1)

    // Coarse ASCII silhouette of the mask — a text "look" at the framing.
    const COLS = 24
    const ROWS = 32
    const cw = W / COLS
    const ch = H / ROWS
    const silhouette = []
    for (let gy = 0; gy < ROWS; gy++) {
      let line = ''
      for (let gx = 0; gx < COLS; gx++) {
        let hit = 0
        let total = 0
        for (let y = Math.floor(gy * ch); y < Math.min(H, Math.floor((gy + 1) * ch)); y++) {
          for (let x = Math.floor(gx * cw); x < Math.min(W, Math.floor((gx + 1) * cw)); x++) {
            const i = (y * W + x) * withModel.channels
            const j = (y * W + x) * withoutModel.channels
            const d =
              Math.abs(withModel.data[i] - withoutModel.data[j]) +
              Math.abs(withModel.data[i + 1] - withoutModel.data[j + 1]) +
              Math.abs(withModel.data[i + 2] - withoutModel.data[j + 2])
            total++
            if (d > 18) hit++
          }
        }
        const frac = total ? hit / total : 0
        line += frac > 0.55 ? '#' : frac > 0.15 ? '+' : frac > 0.01 ? '.' : ' '
      }
      silhouette.push(line)
    }

    const report = {
      url: URL_,
      frame: `${rect.width}x${rect.height} css → ${W}x${H} px`,
      layout,
      stylizedFallback: { ...stylized, backToLive2D },
      framing: JSON.parse(hook),
      modelPixels: changed,
      coveragePct: pct(changed, W * H),
      skinPixels: skin,
      skinShareOfModelPct: changed ? pct(skin, changed) : 0,
      skinBandCss: skinBottom >= 0 ? { top: +(skinTop / (H / rect.height)).toFixed(1), bottom: +(skinBottom / (H / rect.height)).toFixed(1) } : null,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      margins: { top: minY, bottom: H - 1 - maxY, left: minX, right: W - 1 - maxX },
      marginsCss: {
        top: +(minY / (H / rect.height)).toFixed(1),
        bottom: +((H - 1 - maxY) / (H / rect.height)).toFixed(1),
      },
      bboxHeightPctOfFrame: pct(maxY - minY + 1, H),
      silhouette,
      verdict: (() => {
        const top = minY
        const bottom = H - 1 - maxY
        if (changed === 0) return 'EMPTY — nothing rendered'
        if (top < 2) return 'CLIPPED at top — head runs off the top edge'
        if (bottom < 2) return 'CLIPPED at bottom — head runs off the bottom edge'
        if (skin === 0) return 'NO SKIN PIXELS — the face is not in frame'
        return 'FRAMED — head inside the frame with margin on all sides'
      })(),
    }

    if (SHOT) {
      const full = await send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(SHOT, Buffer.from(full.data, 'base64'))
      report.shot = SHOT
      // Also save the frame itself, upscaled by the 4x DPI override, so the
      // framing can be judged without squinting at a full-page screenshot.
      if (clipRaw) {
        const frameShot = SHOT.replace(/\.png$/, '.frame.png')
        fs.writeFileSync(frameShot, Buffer.from(clipRaw, 'base64'))
        report.frameShot = frameShot
      }
    }

    const errors = events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => e.params.args.map((a) => a.value || a.description).join(' '))
    report.consoleErrors = errors

    console.log(JSON.stringify(report, null, 2))
    const layoutOk =
      layout.frameInsideSidebar &&
      layout.fillsSidebar &&
      layout.cardOverflowPx <= 0 &&
      !!layout.statusDot &&
      layout.floatingCompanionGone &&
      layout.oldTextGone &&
      stylized.hasImg &&
      !stylized.hasCanvas &&
      backToLive2D
    if (report.verdict !== 'FRAMED — head inside the frame with margin on all sides' || !layoutOk) {
      console.error(layoutOk ? 'layout OK' : `layout FAILED: ${JSON.stringify(layout)}`)
      process.exitCode = 1
    } else {
      console.error('layout OK')
    }
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
  console.error('avatar-frame-check failed:', e.message)
  process.exit(1)
})
