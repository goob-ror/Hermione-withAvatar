// Minimal PNG decoder + region stats. Used to prove a canvas actually rendered
// pixels without a vision model: an empty box is one flat colour, a rendered
// Live2D avatar has many distinct colours.
// Usage: node scripts/png-probe.mjs <file.png> [x,y,w,h]
import fs from 'node:fs'
import zlib from 'node:zlib'

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
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    pos += 12 + len
  }

  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported png (depth ${bitDepth}, interlace ${interlace})`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1
  if (channels === -1) throw new Error(`unsupported colour type ${colorType}`)

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
      let value = line[x]

      switch (filter) {
        case 0: break
        case 1: value += a; break
        case 2: value += b; break
        case 3: value += (a + b) >> 1; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          break
        }
        default: throw new Error(`bad filter ${filter}`)
      }
      cur[x] = value & 0xff
    }
  }

  return { width, height, channels, data: out }
}

const [file, region] = process.argv.slice(2)
const img = decodePng(fs.readFileSync(file))

let [rx, ry, rw, rh] = region
  ? region.split(',').map(Number)
  : [0, 0, img.width, img.height]

rx = Math.max(0, Math.min(img.width - 1, rx))
ry = Math.max(0, Math.min(img.height - 1, ry))
rw = Math.min(rw, img.width - rx)
rh = Math.min(rh, img.height - ry)

const colors = new Map()
let total = 0
let opaque = 0

for (let y = ry; y < ry + rh; y++) {
  for (let x = rx; x < rx + rw; x++) {
    const i = (y * img.width + x) * img.channels
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    const a = img.channels === 4 ? img.data[i + 3] : 255
    total++
    if (a > 8) opaque++
    // Bucket on 5 bits per channel so near-identical pixels count as one
    // colour, but keep the real 8-bit RGB of the first pixel in each bucket —
    // reporting the bucket index as a colour is how "247,244,240" used to be
    // printed as "30,30,30".
    const key = `${r >> 3},${g >> 3},${b >> 3}`
    const bucket = colors.get(key)
    if (bucket) bucket.count += 1
    else colors.set(key, { count: 1, rgb: `${r},${g},${b}` })
  }
}

const sorted = [...colors.values()].sort((a, b) => b.count - a.count)
const dominant = sorted[0]
const distinct = colors.size
const nonDominant = total - dominant.count

console.log(
  JSON.stringify(
    {
      file,
      image: `${img.width}x${img.height}`,
      region: `${rx},${ry} ${rw}x${rh}`,
      pixels: total,
      opaquePct: +((opaque / total) * 100).toFixed(1),
      distinctColours: distinct,
      dominantColour: dominant.rgb,
      dominantPct: +((dominant.count / total) * 100).toFixed(1),
      nonDominantPct: +((nonDominant / total) * 100).toFixed(1),
      top5: sorted.slice(0, 5).map((c) => `${c.rgb} (${((c.count / total) * 100).toFixed(1)}%)`),
    },
    null,
    2,
  ),
)
