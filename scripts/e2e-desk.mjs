/** Live check of the Desk snippets vault: add command + secret, copy both, screenshot. */
import { _electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const shotDir = resolve(process.argv[2] ?? 'e2e-shots')
const userData = mkdtempSync(join(tmpdir(), 'deskmate-desk-'))
const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${userData}`],
  cwd: resolve(import.meta.dirname, '..')
})
try {
  await app.firstWindow()
  let pages = app.windows()
  for (let i = 0; i < 40 && !pages.some((p) => p.url().includes('index.html')); i++) {
    await new Promise((r) => setTimeout(r, 250))
    pages = app.windows()
  }
  const page = pages.find((p) => p.url().includes('index.html'))
  if (!page) throw new Error('companion window not found')
  await page.waitForSelector('.app-shell', { timeout: 15000 })
  await new Promise((r) => setTimeout(r, 600))
  if ((await page.locator('text=Skip the tour').count()) > 0) {
    await page.locator('text=Skip the tour').click()
    await new Promise((r) => setTimeout(r, 400))
  }
  if ((await page.locator('text=Start the day').count()) > 0) {
    await page.keyboard.press('Enter')
    await new Promise((r) => setTimeout(r, 500))
  }
  await page.keyboard.press('5')
  await page.waitForSelector('.snips', { timeout: 5000 })

  // Command snippet.
  await page.locator('.snips__add').click()
  await page.locator('.snips__label').fill('Prod DB tunnel')
  await page.locator('.snips__value').fill('ssh -L 5432:db.internal:5432 jump.staples.com')
  await page.locator('.snips__form button[type="submit"]').click()
  await page.waitForSelector('.snips__row', { timeout: 5000 })

  // Secret snippet (DPAPI path).
  await page.locator('.snips__add').click()
  await page.locator('.snips__kind').selectOption('secret')
  await page.locator('.snips__label').fill('Wifi guest code')
  await page.locator('input[type="password"].snips__value').fill('hunter2-not-really')
  await page.locator('.snips__form button[type="submit"]').click()
  await new Promise((r) => setTimeout(r, 500))

  const rows = await page.locator('.snips__row').count()
  // Copy the secret and verify the clipboard note + main-side clipboard content.
  await page.locator('.snips__row', { hasText: 'Wifi guest code' }).locator('.snips__copy').click()
  await new Promise((r) => setTimeout(r, 400))
  const note = await page.locator('.snips__copied').textContent().catch(() => null)
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  await page.screenshot({ path: join(shotDir, 'desk.png') })
  console.log(
    JSON.stringify({
      rows,
      copiedNote: note,
      clipboardHoldsSecret: clip === 'hunter2-not-really',
      ok: rows === 2 && clip === 'hunter2-not-really' && !!note && note.includes('30')
    })
  )
  await app.evaluate(({ clipboard }) => clipboard.clear())
} finally {
  await app.close().catch(() => {})
}
