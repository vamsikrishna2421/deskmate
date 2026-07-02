/** Typed main→renderer push. The companion window receives everything; the capture popup only
 *  the channels it listens to — broadcasting full Task payloads at a window that ignores them
 *  is pure deserialization waste. Destroyed / not-yet-created windows are skipped. */
import type { BrowserWindow } from 'electron'
import type { PushChannel, PushSchema } from '@shared/types/ipc'

interface PushTargets {
  main?: BrowserWindow
  capture?: BrowserWindow
}

const CAPTURE_CHANNELS: ReadonlySet<PushChannel> = new Set(['capture:submitted', 'settings:changed'])

let getTargetsFn: (() => PushTargets) | undefined

export function initPush(getTargets: () => PushTargets): void {
  getTargetsFn = getTargets
}

function sendTo(win: BrowserWindow | undefined, channel: string, payload: unknown): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, payload)
}

export function push<C extends PushChannel>(channel: C, payload: PushSchema[C]): void {
  if (!getTargetsFn) return
  const targets = getTargetsFn()
  sendTo(targets.main, channel, payload)
  if (CAPTURE_CHANNELS.has(channel)) sendTo(targets.capture, channel, payload)
}
