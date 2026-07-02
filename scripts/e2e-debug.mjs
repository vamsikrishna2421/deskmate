/** Debug probe: why doesn't 'N' open the capture bar? */
import { _electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'sill-dbg-'))
const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${userData}`],
  cwd: resolve(import.meta.dirname, '..')
})
const page = await app.firstWindow()
const logs = []
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 300)}`))
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${String(e).slice(0, 400)}`))
await page.waitForSelector('[class*="app"]', { timeout: 15000 })
await new Promise((r) => setTimeout(r, 800))
if ((await page.locator('text=Start the day').count()) > 0) {
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 600))
}
const probe1 = await page.evaluate(() => {
  const hits = []
  window.addEventListener('keydown', (e) => hits.push(`win:${e.key}`), { capture: true })
  document.body.dataset['probe'] = 'yes'
  return {
    activeElement: document.activeElement?.tagName,
    capbar: document.querySelector('.capbar') !== null,
    capbarHtml: document.querySelector('.capbar')?.outerHTML.slice(0, 300) ?? null,
    shellClasses: document.querySelector('#root > *')?.className ?? null,
    bodyText: document.body.innerText.slice(0, 200)
  }
})
console.log(JSON.stringify(probe1, null, 2))
await page.keyboard.press('N')
await new Promise((r) => setTimeout(r, 500))
const probe2 = await page.evaluate(() => ({
  capbarField: document.querySelector('.capbar__field') !== null,
  capbar: document.querySelector('.capbar')?.outerHTML.slice(0, 400) ?? null
}))
console.log(JSON.stringify(probe2, null, 2))
console.log('CONSOLE LOGS:', JSON.stringify(logs.slice(0, 20), null, 2))
await app.close()
