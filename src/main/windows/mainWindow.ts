/** The frameless companion window (DESIGN.md §3): 384×560 content default, min 340×440, max
 *  width 560, close hides to tray, shade collapses to the header, pin = alwaysOnTop 'floating'.
 *  The window is TRANSPARENT and inflated by FLOAT_GUTTER on each side — the renderer draws
 *  the app as a rounded card whose shadow falls on the desktop (the floating look). Known
 *  Windows tradeoff: transparent frameless windows lose native edge-resize. */
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { FLOAT_GUTTER, MAIN_WINDOW, SHADED_HEIGHT } from '@shared/constants'
import type { AppStateRepo } from '../store/appStateRepo'
import { push } from '../ipc/push'
import { attachWindowStateTracking, restoreCompanionBounds, type WindowStateHandle } from './windowState'

export interface MainWindowDeps {
  appStateRepo: AppStateRepo
  isQuitting: () => boolean
}

/** Content size + the transparent shadow gutter on both sides. */
const G2 = FLOAT_GUTTER * 2

/** If the renderer never signals ui:ready (wedged page), reveal anyway after this. */
const REVEAL_FALLBACK_MS = 4000

export class MainWindowManager {
  private win: BrowserWindow | undefined
  private shaded = false
  private restoreHeight: number = MAIN_WINDOW.height
  private stateHandle: WindowStateHandle | undefined
  private pendingReveal = false
  private revealed = false
  private revealFallback: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly deps: MainWindowDeps) {}

  create(showOnReady: boolean): BrowserWindow {
    const bounds = restoreCompanionBounds(this.deps.appStateRepo, {
      width: MAIN_WINDOW.width + G2,
      height: MAIN_WINDOW.height + G2
    })
    const win = new BrowserWindow({
      ...bounds,
      minWidth: MAIN_WINDOW.minWidth + G2,
      minHeight: MAIN_WINDOW.minHeight + G2,
      maxWidth: MAIN_WINDOW.maxWidth + G2,
      frame: false,
      show: false,
      transparent: true,
      skipTaskbar: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      icon: join(app.getAppPath(), 'resources', 'icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        backgroundThrottling: true,
        spellcheck: false,
        devTools: !app.isPackaged
      }
    })
    this.win = win

    if (this.deps.appStateRepo.get().alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
    // Personal, not shareable: excluded from Teams/Zoom capture (WDA_EXCLUDEFROMCAPTURE).
    win.setContentProtection(this.deps.appStateRepo.get().privateToScreenShare)

    // The window reveals on the renderer's ui:ready signal (first meaningful render), never
    // on first paint — the app must appear whole, not piece by piece. Fallback keeps a wedged
    // renderer from leaving the app invisible.
    this.pendingReveal = showOnReady
    if (showOnReady) {
      this.revealFallback = setTimeout(() => this.revealNow(), REVEAL_FALLBACK_MS)
    }
    win.on('close', (event) => {
      if (!this.deps.isQuitting()) {
        event.preventDefault()
        win.hide()
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())

    this.stateHandle = attachWindowStateTracking(
      win,
      this.deps.appStateRepo,
      () => this.shaded,
      () => this.restoreHeight
    )

    // Dev-server URL must never be honored in a packaged build — it would load an arbitrary
    // page with the preload bridge and full IPC trust.
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && !app.isPackaged) void win.loadURL(devUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))

    return win
  }

  get(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  isVisible(): boolean {
    const w = this.get()
    return !!w && w.isVisible() && !w.isMinimized()
  }

  /** Focused or visible — the scheduler's "user is around" signal. */
  isActive(): boolean {
    const w = this.get()
    return !!w && (w.isFocused() || w.isVisible())
  }

  show(): void {
    const w = this.get()
    if (!w) return
    this.revealed = true
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }

  /** ui:ready from the companion renderer — perform the (single) deferred reveal. */
  revealNow(): void {
    if (this.revealed || !this.pendingReveal) return
    if (this.revealFallback) {
      clearTimeout(this.revealFallback)
      this.revealFallback = undefined
    }
    this.pendingReveal = false
    this.show()
  }

  hide(): void {
    this.get()?.hide()
  }

  toggle(): void {
    if (this.isVisible()) this.hide()
    else this.show()
  }

  setPinned(onTop: boolean): void {
    this.get()?.setAlwaysOnTop(onTop, 'floating')
  }

  setShaded(on: boolean): void {
    const w = this.get()
    if (!w || on === this.shaded) return
    const b = w.getBounds()
    if (on) {
      this.restoreHeight = b.height
      w.setMinimumSize(MAIN_WINDOW.minWidth + G2, SHADED_HEIGHT + G2)
      w.setBounds({ x: b.x, y: b.y, width: b.width, height: SHADED_HEIGHT + G2 })
    } else {
      w.setMinimumSize(MAIN_WINDOW.minWidth + G2, MAIN_WINDOW.minHeight + G2)
      // Unshading grows downward — clamp so a shade strip parked at the bottom edge doesn't
      // push the restored body below the work area.
      const workArea = screen.getDisplayMatching(b).workArea
      const y = Math.max(workArea.y, Math.min(b.y, workArea.y + workArea.height - this.restoreHeight))
      w.setBounds({ x: b.x, y, width: b.width, height: this.restoreHeight })
    }
    this.shaded = on
    push('window:shaded', { on })
  }

  /** Persist current bounds immediately (used by before-quit, ahead of the repo flush). */
  persistBoundsNow(): void {
    this.stateHandle?.persistNow()
  }

  setContentProtection(on: boolean): void {
    this.get()?.setContentProtection(on)
  }

  isShaded(): boolean {
    return this.shaded
  }

  moveBy(dx: number, dy: number): void {
    const w = this.get()
    if (!w) return
    const b = w.getBounds()
    w.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height })
  }
}
