/** Perf probe against the DESIGN §3 idle budget (tray-hidden <1% CPU, <200MB RAM).
 *  Usage: node scripts/perf-probe.mjs   (requires npm run build → out/)
 *  Phases: (1) companion hidden 30s ("tray" state), 3 CPU/memory samples;
 *          (2) companion visible idle 30s, 3 samples;
 *          (3) shaded + simulated assistant-working pulse dot 30s, 2 samples
 *              (measures whether the "animations suspended while shaded" rule holds).
 *  CPU note: ProcessMetric.percentCPUUsage is "% since the previous getAppMetrics call",
 *  so each phase primes once, then samples on a fixed cadence.
 *  Caveat: the CDP attach (playwright) can inhibit Chromium's *intensive* timer throttling,
 *  so hidden-state numbers here are, if anything, pessimistic vs. real tray-hidden idle. */
import { _electron } from 'playwright-core'
import electronPath from 'electron'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const userData = mkdtempSync(join(tmpdir(), 'sill-perf-'))

const app = await _electron.launch({
  executablePath: electronPath,
  args: ['.', `--user-data-dir=${userData}`],
  cwd: resolve(import.meta.dirname, '..')
})

function fmt(kb) {
  return Math.round((kb ?? 0) / 1024)
}

async function pidMap() {
  return app.evaluate(({ BrowserWindow }) => {
    const map = {}
    for (const w of BrowserWindow.getAllWindows()) {
      const label = w.webContents.getURL().includes('capture') ? 'capture-renderer' : 'companion-renderer'
      map[w.webContents.getOSProcessId()] = label
    }
    return map
  })
}

async function sample(label) {
  const [metrics, pids] = await Promise.all([
    app.evaluate(({ app: a }) => a.getAppMetrics()),
    pidMap()
  ])
  const rows = metrics.map((m) => ({
    proc: pids[m.pid] ?? `${m.type}${m.serviceName ? `:${m.serviceName}` : ''}`,
    pid: m.pid,
    cpuPct: Number((m.cpu?.percentCPUUsage ?? 0).toFixed(2)),
    wsMB: fmt(m.memory?.workingSetSize),
    privMB: fmt(m.memory?.privateBytes)
  }))
  const total = {
    cpuPct: Number(rows.reduce((s, r) => s + r.cpuPct, 0).toFixed(2)),
    wsMB: rows.reduce((s, r) => s + r.wsMB, 0),
    privMB: rows.reduce((s, r) => s + r.privMB, 0)
  }
  console.log(JSON.stringify({ sample: label, total, rows }))
  return total
}

async function phase(name, settleMs, samples, gapMs) {
  await sleep(settleMs)
  await app.evaluate(({ app: a }) => a.getAppMetrics()) // prime: next call = avg over gap
  const totals = []
  for (let i = 1; i <= samples; i++) {
    await sleep(gapMs)
    totals.push(await sample(`${name}#${i}`))
  }
  const avg = {
    cpuPct: Number((totals.reduce((s, t) => s + t.cpuPct, 0) / totals.length).toFixed(2)),
    wsMB: Math.round(totals.reduce((s, t) => s + t.wsMB, 0) / totals.length),
    privMB: Math.round(totals.reduce((s, t) => s + t.privMB, 0) / totals.length)
  }
  console.log(JSON.stringify({ phase: name, avg }))
  return avg
}

try {
  const companion = await app.firstWindow()
  await companion.waitForSelector('.app-shell', { timeout: 15000 })
  await sleep(1500)
  // First focus fires the morning briefing sheet — ack it so the idle state is the plain list.
  if ((await companion.locator('text=Start the day').count()) > 0) {
    await companion.keyboard.press('Enter')
    await sleep(600)
  }

  // ── Phase 1: tray-hidden idle (BrowserWindow.hide on the companion) ─────────
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide()
  })
  const hidden = await phase('hidden-idle', 30_000, 3, 10_000)

  // ── Phase 2: visible idle ───────────────────────────────────────────────────
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('capture'))
    w?.show()
  })
  const visible = await phase('visible-idle', 30_000, 3, 10_000)

  // ── Phase 3: shaded + assistant-working pulse (DESIGN: "animations suspended
  //    while shaded" — the shaded header still renders the pulsing dot) ────────
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('enrichment:status', { taskId: 'perf-probe-fake', status: 'running' })
    }
  })
  await companion.evaluate(() => window.loops.invoke('window:shade', { on: true }))
  const shadedPulse = await phase('shaded-pulse', 5_000, 2, 10_000)

  // Control: shaded with the pulse cleared (status done removes the transient).
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('enrichment:status', { taskId: 'perf-probe-fake', status: 'done' })
    }
  })
  const shadedCalm = await phase('shaded-calm', 5_000, 2, 10_000)

  console.log(
    JSON.stringify({
      summary: {
        budget: { cpuPct: 1, wsMB: 200 },
        hidden,
        visible,
        shadedPulse,
        shadedCalm,
        hiddenCpuWithinBudget: hidden.cpuPct < 1,
        hiddenWsWithinBudget: hidden.wsMB < 200
      }
    })
  )
} finally {
  await app.close().catch(() => {})
}
