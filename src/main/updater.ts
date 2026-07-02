/** Silent background updates from GitHub Releases (electron-updater). Calm contract:
 *  downloads happen quietly, install happens on quit; exactly one toast when an update is
 *  ready, and a tray item to restart now. Update checks are the app's only non-loopback
 *  network traffic — task data never leaves the machine. */

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const FIRST_CHECK_DELAY_MS = 60_000 // never compete with launch + model warm-up
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface UpdaterDeps {
  /** Fired when the downloaded update becomes ready (or state changes) — refresh the tray. */
  onReadyChange: (version: string | undefined) => void
  notify: (n: { title: string; body: string }) => void
}

export class Updater {
  private readyVersionValue: string | undefined
  private notified = false
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly deps: UpdaterDeps) {}

  start(): void {
    if (!app.isPackaged) return // dev builds have no app-update.yml
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-downloaded', (info) => {
      this.readyVersionValue = info.version
      this.deps.onReadyChange(info.version)
      if (!this.notified) {
        this.notified = true
        this.deps.notify({
          title: 'DeskMate',
          body: `DeskMate ${info.version} is ready — it installs when you quit.`
        })
      }
    })
    autoUpdater.on('error', (err) => {
      console.error('[updater]', err?.message ?? err) // offline is normal; never surface
    })
    setTimeout(() => this.check(), FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(() => this.check(), RECHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Manual check from the tray. */
  check(): void {
    if (!app.isPackaged) return
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }

  readyVersion(): string | undefined {
    return this.readyVersionValue
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }
}
