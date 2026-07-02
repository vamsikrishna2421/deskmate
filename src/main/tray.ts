/** Tray icon + menu (DESIGN.md §13): attention variant adds a 6px ochre dot — shown only when
 *  something is due today AND the companion is hidden. Never a numeric badge. */
import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export interface TrayState {
  dueTodayCount: number
  pinned: boolean
  launchAtLogin: boolean
  paused: boolean
  privateToScreenShare: boolean
  companionVisible: boolean
  /** Version string when a downloaded update is waiting for a restart. */
  updateReady?: string
}

export interface TrayDeps {
  onToggleWindow: () => void
  onOpen: () => void
  onQuickCapture: () => void
  onBriefing: () => void
  onPinChange: (onTop: boolean) => void
  onLaunchChange: (enabled: boolean) => void
  onPauseChange: (paused: boolean) => void
  onPrivacyChange: (privateToScreenShare: boolean) => void
  onCheckUpdates: () => void
  onInstallUpdate: () => void
  onQuit: () => void
}

export class TrayManager {
  private tray: Tray | undefined
  private normalIcon = nativeImage.createEmpty()
  private attentionIcon = nativeImage.createEmpty()

  constructor(private readonly deps: TrayDeps) {}

  create(initial: TrayState): void {
    const res = join(app.getAppPath(), 'resources')
    this.normalIcon = nativeImage.createFromPath(join(res, 'tray.png'))
    this.attentionIcon = nativeImage.createFromPath(join(res, 'tray-attention.png'))
    if (this.normalIcon.isEmpty()) return // icons missing — run scripts/gen-icons.mjs
    this.tray = new Tray(this.normalIcon)
    this.tray.on('click', () => this.deps.onToggleWindow())
    this.update(initial)
  }

  update(state: TrayState): void {
    if (!this.tray) return
    const attention = state.dueTodayCount > 0 && !state.companionVisible
    this.tray.setImage(attention && !this.attentionIcon.isEmpty() ? this.attentionIcon : this.normalIcon)
    this.tray.setToolTip(`DeskMate — ${state.dueTodayCount} due today`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open DeskMate', click: () => this.deps.onOpen() },
        { label: 'Quick capture', click: () => this.deps.onQuickCapture() },
        { label: 'Morning briefing', click: () => this.deps.onBriefing() },
        { type: 'separator' },
        {
          label: 'Pin on top',
          type: 'checkbox',
          checked: state.pinned,
          click: (item) => this.deps.onPinChange(item.checked)
        },
        {
          label: 'Launch at login',
          type: 'checkbox',
          checked: state.launchAtLogin,
          click: (item) => this.deps.onLaunchChange(item.checked)
        },
        {
          label: 'Pause assistant',
          type: 'checkbox',
          checked: state.paused,
          click: (item) => this.deps.onPauseChange(item.checked)
        },
        {
          // Quick flip for taking a screenshot — the same capture APIs power Teams AND PrtScn.
          label: 'Invisible to screen capture',
          type: 'checkbox',
          checked: state.privateToScreenShare,
          click: (item) => this.deps.onPrivacyChange(item.checked)
        },
        { type: 'separator' },
        ...(state.updateReady
          ? [
              {
                // Only the app blinks — never the laptop. "Restart" reads scarier than it is.
                label: `Update now (${state.updateReady})`,
                click: (): void => this.deps.onInstallUpdate()
              }
            ]
          : [{ label: 'Check for updates', click: (): void => this.deps.onCheckUpdates() }]),
        { type: 'separator' as const },
        { label: 'Quit', click: () => this.deps.onQuit() }
      ])
    )
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}
