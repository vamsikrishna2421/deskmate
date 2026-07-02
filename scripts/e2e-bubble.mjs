/** Quick live check of the floating bubble: exists, screenshots, click toggles the companion. */
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
  let pages = app.windows()
  for (let i = 0; i < 40 && pages.length < 3; i++) {
    await new Promise((r) => setTimeout(r, 250))
    pages = app.windows()
  }
  const bubble = pages.find((p) => p.url().includes('bubble'))
  const companion = pages.find((p) => p.url().includes('index'))
  console.log(JSON.stringify({ windows: pages.map((p) => p.url().split('/').pop()) }))
  if (!bubble || !companion) throw new Error('bubble or companion window missing')

  await bubble.waitForSelector('.bubble', { timeout: 10000 })
  await new Promise((r) => setTimeout(r, 600))
  await bubble.screenshot({ path: join(shotDir, 'bubble.png'), omitBackground: true })

  // Companion is visible at launch; bubble click should HIDE it, second click shows it again.
  const visibleBefore = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible())
  )
  await bubble.locator('.bubble').click()
  await new Promise((r) => setTimeout(r, 600))
  const visibleAfterClick = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible())
  )
  await bubble.locator('.bubble').click()
  await new Promise((r) => setTimeout(r, 600))
  const visibleAfterSecond = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible())
  )
  console.log(
    JSON.stringify({
      toggle: { visibleBefore, visibleAfterClick, visibleAfterSecond },
      ok: visibleBefore && !visibleAfterClick && visibleAfterSecond
    })
  )
} finally {
  await app.close().catch(() => {})
}
