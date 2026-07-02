/** Global hotkeys: register from settings, walk the constant fallback lists on conflict, and
 *  report through onHotkeyFailed (index wires it to the 'settings:hotkeyFailed' push). */
import { globalShortcut } from 'electron'
import {
  HOTKEY_CAPTURE_DEFAULT,
  HOTKEY_CAPTURE_FALLBACKS,
  HOTKEY_TOGGLE_DEFAULT,
  HOTKEY_TOGGLE_FALLBACKS
} from '@shared/constants'

export interface ShortcutDeps {
  onCapture: () => void
  onToggleWindow: () => void
  onHotkeyFailed: (payload: { hotkey: string; fallback?: string }) => void
}

export class ShortcutManager {
  constructor(private readonly deps: ShortcutDeps) {}

  /** (Re-)register both hotkeys. Called at startup and whenever settings change. */
  apply(hotkeys: { capture: string; toggle: string }): void {
    globalShortcut.unregisterAll()
    this.registerAction(hotkeys.capture, HOTKEY_CAPTURE_DEFAULT, HOTKEY_CAPTURE_FALLBACKS, this.deps.onCapture)
    this.registerAction(hotkeys.toggle, HOTKEY_TOGGLE_DEFAULT, HOTKEY_TOGGLE_FALLBACKS, this.deps.onToggleWindow)
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll()
  }

  private registerAction(
    requested: string,
    fallbackDefault: string,
    fallbacks: readonly string[],
    handler: () => void
  ): void {
    const candidates = [...new Set([requested, fallbackDefault, ...fallbacks])]
    for (const accelerator of candidates) {
      if (this.tryRegister(accelerator, handler)) {
        if (accelerator !== requested) {
          this.deps.onHotkeyFailed({ hotkey: requested, fallback: accelerator })
        }
        return
      }
    }
    this.deps.onHotkeyFailed({ hotkey: requested })
  }

  private tryRegister(accelerator: string, handler: () => void): boolean {
    try {
      if (globalShortcut.isRegistered(accelerator)) return false // taken by our other action
      return globalShortcut.register(accelerator, handler)
    } catch {
      return false // malformed accelerator string
    }
  }
}
