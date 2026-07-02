/** Spawn helper for the Electron launch smoke test (ARCHITECTURE.md §7): starts the built app
 *  with SILL_E2E=1 and an isolated --user-data-dir, then reads the JSON-line handshake
 *  ({"evt":"store-loaded"...}, {"evt":"window-created","id":"main"}, {"evt":"ready"}) off stdout. */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** Absolute path to this repo's Electron binary. */
export function electronBinary() {
  return require('electron')
}

const REQUIRED_EVENTS = ['store-loaded', 'window-created', 'ready']

/**
 * Launch the app (package root `root`) against a throwaway `userDataDir`.
 * Returns the child plus a handshake promise that resolves with all parsed JSON-line events
 * once every required event has arrived, and rejects on timeout or premature exit.
 */
export function launchApp({ root, userDataDir, handshakeTimeoutMs = 15_000 }) {
  const child = spawn(electronBinary(), [root, `--user-data-dir=${userDataDir}`], {
    env: { ...process.env, SILL_E2E: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })

  const events = []
  const stderrChunks = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk))

  const handshake = new Promise((resolve, reject) => {
    const missing = new Set(REQUIRED_EVENTS)
    const fail = (message) =>
      reject(
        new Error(
          `${message}; events=${JSON.stringify(events)}; missing=${[...missing].join(',')}; stderr=${stderrChunks.join('').slice(0, 2000)}`
        )
      )
    const timer = setTimeout(() => fail(`handshake timed out after ${handshakeTimeoutMs}ms`), handshakeTimeoutMs)

    let buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let nl
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line.startsWith('{')) continue // Electron/Chromium noise is not part of the protocol
        let parsed
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        if (typeof parsed?.evt !== 'string') continue
        events.push(parsed)
        missing.delete(parsed.evt)
        if (missing.size === 0) {
          clearTimeout(timer)
          resolve(events)
        }
      }
    })
    child.once('exit', (code, signal) => {
      if (missing.size > 0) {
        clearTimeout(timer)
        fail(`app exited before completing the handshake (code=${code}, signal=${signal})`)
      }
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })

  return { child, events, handshake }
}

/** Resolve with {code, signal} when the child exits; reject after timeoutMs. */
export function waitForExit(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    const timer = setTimeout(() => reject(new Error(`process did not exit within ${timeoutMs}ms`)), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}
