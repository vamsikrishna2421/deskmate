/** Live check of the floating bubble: always visible once ready, click toggles the companion,
 *  and the bubble itself never disappears. */
import { _electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const shotDir = resolve(process.argv[2] ?? 'e2e-shots')
const userData = mkdtempSync(join(tmpdir(), 'deskmate-bubble-'))
const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${userData}`],
  cwd: resolve(import.meta.dirname, '..')
})
try {
  await app.firstWindow()
  let pages = app.windows()
  for (let i = 0; i < 40 && pages.length < 2; i++) {
    await new Promise((r) => setTimeout(r, 250))
    pages = app.windows()
  }
  const bubble = pages.find((p) => p.url().includes('bubble'))
  if (!bubble) throw new Error('bubble window missing')
  await bubble.waitForSelector('.bubble', { timeout: 10000 })

  const bubbleVisible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('bubble') && w.isVisible())
    )
  const companionVisible = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible())
    )

  // Wait for the choreographed reveal (bubble shows only after its ui:ready).
  let shown = false
  for (let i = 0; i < 40 && !shown; i++) {
    shown = await bubbleVisible()
    if (!shown) await new Promise((r) => setTimeout(r, 250))
  }
  await bubble.screenshot({ path: join(shotDir, 'bubble.png'), omitBackground: true }).catch(() => {})

  const c0 = await companionVisible()
  await bubble.locator('.bubble').click()
  await new Promise((r) => setTimeout(r, 600))
  const c1 = await companionVisible()
  const b1 = await bubbleVisible()
  await bubble.locator('.bubble').click()
  await new Promise((r) => setTimeout(r, 600))
  const c2 = await companionVisible()
  const b2 = await bubbleVisible()
  console.log(
    JSON.stringify({
      bubbleShownAfterReady: shown,
      toggle: { companionBefore: c0, afterClick1: c1, afterClick2: c2 },
      bubbleAlwaysVisible: b1 && b2,
      ok: shown && c0 !== c1 && c1 !== c2 && b1 && b2
    })
  )
} finally {
  await app.close().catch(() => {})
}
