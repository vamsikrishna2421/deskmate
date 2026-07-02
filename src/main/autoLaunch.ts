/** Launch-at-login. Windows: registry Run key with '--hidden' (tray only). macOS: openAsHidden.
 *  Skipped in dev — registering the bare electron.exe binary would be wrong. */
import { app } from 'electron'

export function syncAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  }
}
