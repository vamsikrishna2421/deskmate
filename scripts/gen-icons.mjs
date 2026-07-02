#!/usr/bin/env node
/** Generates Sill's icon set with zero dependencies: hand-built PNG chunks over node:zlib,
 *  plus an ICO container embedding the 256px PNG (ICO supports PNG entries since Vista). */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

// ── PNG encoding ──────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function encodePng(canvas) {
  const { width, height, data } = canvas
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1)
    raw[row] = 0 // filter: None
    Buffer.from(data.buffer, y * stride, stride).copy(raw, row + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ── ICO container (single PNG entry) ─────────────────────────────────────────
function encodeIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // count
  const entry = Buffer.alloc(16)
  entry[0] = size >= 256 ? 0 : size // width (0 = 256)
  entry[1] = size >= 256 ? 0 : size // height
  entry[2] = 0 // palette
  entry[3] = 0 // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12) // data offset: 6 + 16
  return Buffer.concat([header, entry, png])
}

// ── Rasterizer: alpha-composited fills with 4×4 supersampled edges ────────────
function makeCanvas(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0) return
  const i = (y * canvas.width + x) * 4
  const d = canvas.data
  const srcA = Math.min(1, alpha)
  const dstA = d[i + 3] / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  d[i] = Math.round((r * srcA + d[i] * dstA * (1 - srcA)) / outA)
  d[i + 1] = Math.round((g * srcA + d[i + 1] * dstA * (1 - srcA)) / outA)
  d[i + 2] = Math.round((b * srcA + d[i + 2] * dstA * (1 - srcA)) / outA)
  d[i + 3] = Math.round(outA * 255)
}

function fillShape(canvas, x0, y0, x1, y1, inside, color, alpha = 1) {
  const minX = Math.max(0, Math.floor(x0))
  const maxX = Math.min(canvas.width - 1, Math.ceil(x1))
  const minY = Math.max(0, Math.floor(y0))
  const maxY = Math.min(canvas.height - 1, Math.ceil(y1))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let hit = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++
        }
      }
      blend(canvas, x, y, color, (hit / 16) * alpha)
    }
  }
}

function fillRoundedRect(canvas, x, y, w, h, r, color, alpha = 1) {
  fillShape(
    canvas, x, y, x + w, y + h,
    (px, py) => {
      if (px < x || px > x + w || py < y || py > y + h) return false
      const dx = Math.max(x + r - px, px - (x + w - r), 0)
      const dy = Math.max(y + r - py, py - (y + h - r), 0)
      return dx * dx + dy * dy <= r * r
    },
    color, alpha
  )
}

function fillCircle(canvas, cx, cy, radius, color, alpha = 1) {
  fillShape(
    canvas, cx - radius, cy - radius, cx + radius, cy + radius,
    (px, py) => {
      const dx = px - cx
      const dy = py - cy
      return dx * dx + dy * dy <= radius * radius
    },
    color, alpha
  )
}

// ── The Sill mark: dark-spruce rounded square, pale window pane, lighter ledge ─
const SPRUCE = [0x2f, 0x6d, 0x5f]
const LEDGE = [0xe4, 0xef, 0xea]
const OCHRE = [0xd9, 0xa8, 0x5c]

function drawAppIcon() {
  const c = makeCanvas(256, 256)
  fillRoundedRect(c, 16, 16, 224, 224, 52, SPRUCE)
  fillRoundedRect(c, 72, 76, 112, 56, 10, LEDGE, 0.28) // window pane, faint
  fillRoundedRect(c, 56, 148, 144, 22, 11, LEDGE) // the sill ledge
  return c
}

function drawTray(scale, attention) {
  const s = scale // 1 → 16px, 2 → 32px (@2x)
  const c = makeCanvas(16 * s, 16 * s)
  fillRoundedRect(c, 1 * s, 1 * s, 14 * s, 14 * s, 4 * s, SPRUCE)
  fillRoundedRect(c, 4.5 * s, 4 * s, 7 * s, 4 * s, 1 * s, LEDGE, 0.28)
  fillRoundedRect(c, 4 * s, 9.5 * s, 8 * s, 2 * s, 1 * s, LEDGE)
  if (attention) fillCircle(c, 12.5 * s, 3.5 * s, 3 * s, OCHRE) // 6px dot (design §13)
  return c
}

// ── Emit + verify ─────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })

const iconPng = encodePng(drawAppIcon())
const files = {
  'icon.png': iconPng,
  'icon.ico': encodeIco(iconPng, 256),
  'tray.png': encodePng(drawTray(1, false)),
  'tray@2x.png': encodePng(drawTray(2, false)),
  'tray-attention.png': encodePng(drawTray(1, true)),
  'tray-attention@2x.png': encodePng(drawTray(2, true))
}

for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, name), buf)
}
for (const name of Object.keys(files)) {
  const size = statSync(join(OUT_DIR, name)).size
  if (size === 0) throw new Error(`${name} is empty`)
  console.log(`${name}  ${size} bytes`)
}
