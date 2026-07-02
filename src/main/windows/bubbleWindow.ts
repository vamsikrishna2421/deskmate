/** Floating chat-head bubble: a 56px transparent always-on-top dot over all apps.
 *  Click toggles the companion; drag is renderer-driven (manual, so click vs drag can be
 *  told apart) via 'bubble:moveTo'; position persists and is off-screen-guarded on restore. */
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { BUBBLE_SIZE } from '@shared/constants'
import type { AppStateRepo } from '../store/appStateRepo'

export class BubbleWindowManager {
  private win: BrowserWindow | undefined
  private companionVisible = false

  constructor(private readonly appStateRepo: AppStateRepo) {}

  /** Create or show per the current setting; safe to call repeatedly. */
  sync(): void {
    const enabled = this.appStateRepo.get().bubbleEnabled
    if (!enabled) {
      this.destroy()
      return
    }
    if (this.get()) {
      this.applyVisibility()
      return
    }
    this.create()
  }

  /** Chat-head contract: the bubble exists to summon DeskMate — while the companion window
   *  is visible it hides, so it can never sit on top of the app's own controls. */
  setCompanionVisible(visible: boolean): void {
    this.companionVisible = visible
    this.applyVisibility()
  }

  private applyVisibility(): void {
    const w = this.get()
    if (!w) return
    if (this.companionVisible) {
      if (w.isVisible()) w.hide()
    } else if (!w.isVisible()) {
      w.showInactive()
    }
  }

  get(): BrowserWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  moveTo(x: number, y: number, persist: boolean): void {
    const w = this.get()
    if (!w) return
    const clamped = this.clamp(x, y)
    w.setBounds({ ...clamped, width: BUBBLE_SIZE, height: BUBBLE_SIZE })
    if (persist) this.appStateRepo.update({ bubblePosition: clamped })
  }

  destroy(): void {
    const w = this.get()
    this.win = undefined
    w?.destroy()
  }

  setContentProtection(on: boolean): void {
    this.get()?.setContentProtection(on)
  }

  private clamp(x: number, y: number): { x: number; y: number } {
    const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) })
    const a = display.workArea
    return {
      x: Math.round(Math.min(Math.max(x, a.x), a.x + a.width - BUBBLE_SIZE)),
      y: Math.round(Math.min(Math.max(y, a.y), a.y + a.height - BUBBLE_SIZE))
    }
  }

  private create(): void {
    const saved = this.appStateRepo.get().bubblePosition
    const primary = screen.getPrimaryDisplay().workArea
    const fallback = {
      x: primary.x + primary.width - BUBBLE_SIZE - 24,
      y: primary.y + Math.round(primary.height * 0.35)
    }
    const pos = saved ? this.clamp(saved.x, saved.y) : fallback

    const win = new BrowserWindow({
      x: pos.x,
      y: pos.y,
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: true,
      show: false,
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
    win.setContentProtection(this.appStateRepo.get().privateToScreenShare)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: false })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => {
      if (!this.companionVisible) win.showInactive()
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && !app.isPackaged) void win.loadURL(`${devUrl}/bubble.html`)
    else void win.loadFile(join(__dirname, '../renderer/bubble.html'))
  }
}
