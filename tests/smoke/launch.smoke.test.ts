/** Electron launch smoke test (ARCHITECTURE.md §7). Gated: runs only when SMOKE=1 AND the app
 *  is built (out/main/index.js). Proves packaging wiring, store bootstrap, the single-instance
 *  lock, and clean termination — without a driver dependency. */

import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type HandshakeEvent = { evt: string } & Record<string, unknown>

interface SmokeHelper {
  launchApp(opts: { root: string; userDataDir: string; handshakeTimeoutMs?: number }): {
    child: ChildProcess
    events: HandshakeEvent[]
    handshake: Promise<HandshakeEvent[]>
  }
  waitForExit(child: ChildProcess, timeoutMs?: number): Promise<{ code: number | null; signal: string | null }>
}

const root = fileURLToPath(new URL('../..', import.meta.url))
const builtEntry = join(root, 'out', 'main', 'index.js')
const enabled = process.env['SMOKE'] === '1' && existsSync(builtEntry)

if (!enabled) {
  console.log(
    '[smoke] skipped — requires SMOKE=1 and a built app (`npm run build` must produce out/main/index.js)'
  )
}

describe.skipIf(!enabled)('Electron launch smoke', () => {
  it('handshakes < 15s, rejects a second instance, exits cleanly on SIGTERM', { timeout: 120_000 }, async () => {
    const helperUrl = pathToFileURL(join(root, 'scripts', 'smoke-launch.mjs')).href
    const helper = (await import(helperUrl)) as unknown as SmokeHelper
    const userDataDir = await mkdtemp(join(tmpdir(), 'sill-smoke-'))
    const first = helper.launchApp({ root, userDataDir })
    try {
      // 1. JSON-line handshake within 15 s (launchApp enforces the deadline).
      const events = await first.handshake
      const names = events.map((e) => e.evt)
      expect(names).toContain('store-loaded')
      expect(names).toContain('window-created')
      expect(names).toContain('ready')
      expect(events.find((e) => e.evt === 'window-created')?.['id']).toBe('main')
      expect(events.find((e) => e.evt === 'store-loaded')?.['tasks']).toBe(0) // fresh temp userData

      // 2. A second instance against the same userData exits immediately (single-instance lock).
      const second = helper.launchApp({ root, userDataDir })
      void second.handshake.catch(() => undefined) // it never handshakes — expected
      const secondExit = await helper.waitForExit(second.child, 15_000)
      expect(secondExit.code).toBe(0)

      // 3. SIGTERM → clean shutdown. Windows cannot deliver SIGTERM (kill == TerminateProcess),
      //    so there the assertion is "terminates promptly"; elsewhere it must be a clean exit.
      first.child.kill('SIGTERM')
      const firstExit = await helper.waitForExit(first.child, 15_000)
      if (process.platform !== 'win32') {
        expect(firstExit.code === 0 || firstExit.signal === 'SIGTERM').toBe(true)
      } else {
        expect(first.child.exitCode !== null || first.child.signalCode !== null).toBe(true)
      }
    } finally {
      if (first.child.exitCode === null && first.child.signalCode === null) first.child.kill('SIGKILL')
      await new Promise((r) => setTimeout(r, 500)) // let file handles release before cleanup
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
