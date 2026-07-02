/** Convert resources/logo.png (the DeskMate bubble mark) into all app icons:
 *  icon.png (256), tray.png/@2x (16/32), tray-attention variants (ochre dot), icon.ico
 *  (ICO container with PNG entries: 16/32/48/256). Run with the Electron binary:
 *    node_modules/electron/dist/electron.exe scripts/make-icons.mjs
 *  Uses an offscreen BrowserWindow canvas — no native image deps. */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = join(ROOT, 'resources')
// data: URL — about:blank has an opaque origin and cannot load file:// subresources.
const logoUrl = `data:image/png;base64,${readFileSync(join(RES, 'logo.png')).toString('base64')}`

const DRAW = `
  (async () => {
    const img = new Image()
    img.src = ${JSON.stringify(logoUrl)}
    await img.decode()

    // 1. Key out the baked-in white BACKGROUND only: flood-fill from the image borders across
    //    near-white pixels. The white sticky-note face inside the mark is enclosed by the blue
    //    bubble, so the fill never reaches it.
    const src = document.createElement('canvas')
    src.width = img.width; src.height = img.height
    const sctx = src.getContext('2d', { willReadFrequently: true })
    sctx.drawImage(img, 0, 0)
    const im = sctx.getImageData(0, 0, src.width, src.height)
    const d = im.data
    const W = src.width, H = src.height
    const nearWhite = (i) => d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235
    const seen = new Uint8Array(W * H)
    const stack = []
    for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1) }
    for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y) }
    while (stack.length) {
      const y = stack.pop(), x = stack.pop()
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const p = y * W + x
      if (seen[p]) continue
      seen[p] = 1
      const i = p * 4
      if (!nearWhite(i)) continue
      d[i + 3] = 0
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
    }
    // Soften the keyed edge: near-white pixels adjacent to transparency get partial alpha.
    sctx.putImageData(im, 0, 0)

    // 2. Crop to the mark's true alpha bounding box (+4% margin).
    let minX = W, minY = H, maxX = 0, maxY = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    const margin = Math.round((maxX - minX) * 0.04)
    minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin)
    maxX = Math.min(W - 1, maxX + margin); maxY = Math.min(H - 1, maxY + margin)
    const side = Math.max(maxX - minX, maxY - minY)
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
    const sx = cx - side / 2, sy = cy - side / 2

    const render = (size, dot) => {
      const c = document.createElement('canvas')
      c.width = size; c.height = size
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, sx, sy, side, side, 0, 0, size, size)
      if (dot) {
        const r = Math.max(2.5, size * 0.17)
        const cx = size - r - Math.max(1, size * 0.03)
        const cy = r + Math.max(1, size * 0.03)
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = '#9A6B14'
        ctx.fill()
        ctx.lineWidth = Math.max(1, size * 0.05)
        ctx.strokeStyle = '#FFFFFF'
        ctx.stroke()
      }
      return c.toDataURL('image/png').split(',')[1]
    }
    return {
      icon256: render(256, false),
      icon48: render(48, false),
      icon32: render(32, false),
      icon16: render(16, false),
      tray16: render(16, false),
      tray32: render(32, false),
      att16: render(16, true),
      att32: render(32, true)
    }
  })()
`

/** ICO container with PNG-compressed entries (valid since Vista). */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const dirs = []
  const blobs = []
  let offset = 6 + 16 * count
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16)
    dir.writeUInt8(size >= 256 ? 0 : size, 0)
    dir.writeUInt8(size >= 256 ? 0 : size, 1)
    dir.writeUInt8(0, 2) // palette
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4) // planes
    dir.writeUInt16LE(32, 6) // bpp
    dir.writeUInt32LE(png.length, 8)
    dir.writeUInt32LE(offset, 12)
    dirs.push(dir)
    blobs.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...dirs, ...blobs])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('about:blank')
  const out = await win.webContents.executeJavaScript(DRAW)
  if (!out || typeof out.icon256 !== 'string') throw new Error('canvas render returned nothing')
  const buf = (b64) => Buffer.from(b64, 'base64')

  writeFileSync(join(RES, 'icon.png'), buf(out.icon256))
  writeFileSync(join(RES, 'tray.png'), buf(out.tray16))
  writeFileSync(join(RES, 'tray@2x.png'), buf(out.tray32))
  writeFileSync(join(RES, 'tray-attention.png'), buf(out.att16))
  writeFileSync(join(RES, 'tray-attention@2x.png'), buf(out.att32))
  writeFileSync(
    join(RES, 'icon.ico'),
    buildIco([
      { size: 16, png: buf(out.icon16) },
      { size: 32, png: buf(out.icon32) },
      { size: 48, png: buf(out.icon48) },
      { size: 256, png: buf(out.icon256) }
    ])
  )
  console.log(JSON.stringify({ ok: true, files: ['icon.png', 'icon.ico', 'tray.png', 'tray@2x.png', 'tray-attention.png', 'tray-attention@2x.png'] }))
  app.exit(0)
})
