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
          body: `DeskMate ${info.version} is ready — "Update now" in the tray, or it installs itself when you quit.`
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

  /** Check for updates. A MANUAL check (tray) always answers — silence reads as broken. */
  check(manual = false): void {
    if (!app.isPackaged) {
      if (manual) this.deps.notify({ title: 'DeskMate', body: 'Update checks only work in the installed app.' })
      return
    }
    void autoUpdater
      .checkForUpdates()
      .then((result) => {
        if (!manual) return
        if (this.readyVersionValue) {
          this.deps.notify({
            title: 'DeskMate',
            body: `DeskMate ${this.readyVersionValue} is ready — use "Update now" in the tray.`
          })
          return
        }
        const latest = result?.updateInfo?.version
        if (latest && latest !== app.getVersion()) {
          this.deps.notify({ title: 'DeskMate', body: `Downloading DeskMate ${latest} in the background…` })
        } else {
          this.deps.notify({ title: 'DeskMate', body: `You're on the latest version (${app.getVersion()}).` })
        }
      })
      .catch(() => {
        if (manual) {
          this.deps.notify({ title: 'DeskMate', body: "Couldn't reach GitHub to check for updates." })
        }
      })
  }

  readyVersion(): string | undefined {
    return this.readyVersionValue
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }
}
