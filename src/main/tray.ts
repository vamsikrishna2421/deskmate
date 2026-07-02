/** Tray icon + menu (DESIGN.md §13, enriched per Vamsy's VibeFlow reference): status lines up
 *  top, quick actions, every everyday toggle in place, model/theme pickers, help, updates.
 *  Attention icon = 6px ochre dot when something is due today AND the companion is hidden. */
import { app, Menu, nativeImage, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'

export interface TrayAssistant {
  reachable: boolean
  paused: boolean
  activeModel?: string
  models: string[]
  selectedModel?: string
}

export interface TrayState {
  dueTodayCount: number
  loopsCount: number
  hotkeyCapture: string
  assistant: TrayAssistant
  pinned: boolean
  launchAtLogin: boolean
  startHidden: boolean
  bubbleEnabled: boolean
  privateToScreenShare: boolean
  remindersEnabled: boolean
  theme: string
  companionVisible: boolean
  updateReady?: string
}

export interface TrayDeps {
  onToggleWindow: () => void
  onOpen: () => void
  onQuickCapture: () => void
  onBriefing: () => void
  onOpenDesk: () => void
  onOpenGuide: () => void
  onOpenTour: () => void
  onOpenLegend: () => void
  onPinChange: (onTop: boolean) => void
  onLaunchChange: (enabled: boolean) => void
  onStartHiddenChange: (enabled: boolean) => void
  onBubbleChange: (enabled: boolean) => void
  onPrivacyChange: (privateToScreenShare: boolean) => void
  onRemindersChange: (enabled: boolean) => void
  onPauseChange: (paused: boolean) => void
  onModelSelect: (model: string) => void
  onThemeChange: (theme: 'dark' | 'light') => void
  onOpenDataFolder: () => void
  onReportProblem: () => void
  onCheckUpdates: () => void
  onInstallUpdate: () => void
  onQuit: () => void
}

function prettyHotkey(accel: string): string {
  return accel.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')
}

function statusLine(state: TrayState): string {
  if (state.dueTodayCount === 0 && state.loopsCount === 0) return 'All clear today'
  const parts: string[] = []
  if (state.dueTodayCount > 0) {
    parts.push(`${state.dueTodayCount} due today`)
  }
  if (state.loopsCount > 0) {
    parts.push(`${state.loopsCount} ${state.loopsCount === 1 ? 'question' : 'questions'} open`)
  }
  return parts.join(' · ')
}

function assistantLine(a: TrayAssistant): string {
  if (a.paused) return 'Assistant: paused'
  if (!a.reachable) return 'Assistant: offline — captures stay as written'
  return `Assistant: ${a.activeModel ?? 'no model installed'} · ready`
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
    if (this.normalIcon.isEmpty()) return // icons missing — run scripts/make-icons.mjs
    this.tray = new Tray(this.normalIcon)
    this.tray.on('click', () => this.deps.onToggleWindow())
    this.update(initial)
  }

  update(state: TrayState): void {
    if (!this.tray) return
    const attention = state.dueTodayCount > 0 && !state.companionVisible
    this.tray.setImage(attention && !this.attentionIcon.isEmpty() ? this.attentionIcon : this.normalIcon)
    this.tray.setToolTip(`DeskMate — ${statusLine(state)}`)

    const modelItems: MenuItemConstructorOptions[] =
      state.assistant.models.length === 0
        ? [{ label: 'No models installed — ollama pull qwen2.5:3b', enabled: false }]
        : state.assistant.models.map((m) => ({
            label: m,
            type: 'radio',
            checked: m === (state.assistant.selectedModel ?? state.assistant.activeModel),
            click: (): void => this.deps.onModelSelect(m)
          }))

    const template: MenuItemConstructorOptions[] = [
      // ── status (disabled = informational, VibeFlow-style) ────────────────────
      { label: statusLine(state), enabled: false },
      { label: `${prettyHotkey(state.hotkeyCapture)} to capture from anywhere`, enabled: false },
      { label: assistantLine(state.assistant), enabled: false },
      { type: 'separator' },
      // ── quick actions ─────────────────────────────────────────────────────────
      { label: 'Open DeskMate', click: () => this.deps.onOpen() },
      { label: 'Quick capture', click: () => this.deps.onQuickCapture() },
      { label: 'Morning briefing', click: () => this.deps.onBriefing() },
      { label: 'Desk snippets', click: () => this.deps.onOpenDesk() },
      { type: 'separator' },
      // ── everyday toggles ──────────────────────────────────────────────────────
      { label: 'Pin on top', type: 'checkbox', checked: state.pinned, click: (i) => this.deps.onPinChange(i.checked) },
      {
        label: 'Launch at login',
        type: 'checkbox',
        checked: state.launchAtLogin,
        click: (i) => this.deps.onLaunchChange(i.checked)
      },
      {
        label: 'Start hidden',
        type: 'checkbox',
        checked: state.startHidden,
        click: (i) => this.deps.onStartHiddenChange(i.checked)
      },
      {
        label: 'Floating bubble',
        type: 'checkbox',
        checked: state.bubbleEnabled,
        click: (i) => this.deps.onBubbleChange(i.checked)
      },
      {
        label: 'Invisible to screen capture',
        type: 'checkbox',
        checked: state.privateToScreenShare,
        click: (i) => this.deps.onPrivacyChange(i.checked)
      },
      {
        label: 'Hard-deadline reminders',
        type: 'checkbox',
        checked: state.remindersEnabled,
        click: (i) => this.deps.onRemindersChange(i.checked)
      },
      {
        label: 'Pause assistant',
        type: 'checkbox',
        checked: state.assistant.paused,
        click: (i) => this.deps.onPauseChange(i.checked)
      },
      { label: 'Assistant model', submenu: modelItems },
      {
        label: 'Theme',
        submenu: (['dark', 'light'] as const).map((t) => ({
          label: t === 'dark' ? 'Dark' : 'Light',
          type: 'radio' as const,
          checked: state.theme === t,
          click: (): void => this.deps.onThemeChange(t)
        }))
      },
      { type: 'separator' },
      // ── help & data ───────────────────────────────────────────────────────────
      { label: 'How to use DeskMate', click: () => this.deps.onOpenGuide() },
      { label: 'Welcome tour', click: () => this.deps.onOpenTour() },
      { label: 'Legend', click: () => this.deps.onOpenLegend() },
      { label: 'Open data folder', click: () => this.deps.onOpenDataFolder() },
      { label: 'Report a problem…', click: () => this.deps.onReportProblem() },
      { type: 'separator' },
      // ── updates & about ───────────────────────────────────────────────────────
      ...(state.updateReady
        ? [
            {
              // Vamsy's words: "click to update" — never "restart", which reads like the laptop.
              label: `Click to update (${state.updateReady})`,
              click: (): void => this.deps.onInstallUpdate()
            }
          ]
        : [{ label: 'Check for updates', click: (): void => this.deps.onCheckUpdates() }]),
      { label: `About DeskMate ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit', click: () => this.deps.onQuit() }
    ]

    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}
