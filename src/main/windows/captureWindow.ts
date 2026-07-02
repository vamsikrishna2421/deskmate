/** Quick-capture popup (DESIGN.md §3–4): pre-created hidden 520×180, frameless, always on top,
 *  never user-resizable; shown centered horizontally at 22% height of the display under the
 *  cursor; blur or Esc hides it (never destroyed → instant reopen); grows once to 520×300. */
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { CAPTURE_WINDOW } from '@shared/constants'

const GROW_ANIMATION_MS = 140
const GROW_STEP_MS = 20

export class CaptureWindowManager {
  private win: BrowserWindow | undefined
  private growTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly isProtected: () => boolean = () => false) {}

  setContentProtection(on: boolean): void {
    this.get()?.setContentProtection(on)
  }

  create(): BrowserWindow {
    const win = new BrowserWindow({
      width: CAPTURE_WINDOW.width,
      height: CAPTURE_WINDOW.height,
      show: false,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
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

    win.setContentProtection(this.isProtected())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.on('blur', () => this.hide())
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.hide()
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && !app.isPackaged) void win.loadURL(`${devUrl}/capture.html`)
    else void win.loadFile(join(__dirname, '../renderer/capture.html'))

    return win
  }

  get(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  show(): void {
    const w = this.get()
    if (!w) return
    this.stopGrow()
    const cursor = screen.getCursorScreenPoint()
    const workArea = screen.getDisplayNearestPoint(cursor).workArea
    w.setBounds({
      x: Math.round(workArea.x + (workArea.width - CAPTURE_WINDOW.width) / 2),
      y: Math.round(workArea.y + workArea.height * 0.22),
      width: CAPTURE_WINDOW.width,
      height: CAPTURE_WINDOW.height
    })
    w.show()
    w.focus()
  }

  hide(): void {
    this.stopGrow()
    const w = this.get()
    if (w?.isVisible()) w.hide()
  }

  /** One-step grow (main-driven, ~140ms) when the text exceeds four lines. Grows downward. */
  growTo(height: number): void {
    const w = this.get()
    if (!w) return
    this.stopGrow()
    const from = w.getBounds().height
    const to = Math.max(from, Math.min(height, CAPTURE_WINDOW.grownHeight))
    if (to === from) return
    const steps = Math.max(1, Math.round(GROW_ANIMATION_MS / GROW_STEP_MS))
    let step = 0
    this.growTimer = setInterval(() => {
      step++
      const cur = this.get()
      if (!cur) {
        this.stopGrow()
        return
      }
      const b = cur.getBounds()
      const h = Math.round(from + ((to - from) * step) / steps)
      cur.setBounds({ x: b.x, y: b.y, width: b.width, height: h })
      if (step >= steps) this.stopGrow()
    }, GROW_STEP_MS)
  }

  private stopGrow(): void {
    if (this.growTimer) {
      clearInterval(this.growTimer)
      this.growTimer = undefined
    }
  }
}
