/** Companion-window bounds: debounced persistence, off-screen guard, magnetic edge snapping.
 *  The geometry helpers are pure and exported for unit tests. */
import type { BrowserWindow } from 'electron'
import { screen } from 'electron'
import type { WindowBounds } from '@shared/types/appState'
import { BOUNDS_DEBOUNCE_MS, EDGE_SNAP_PX } from '@shared/constants'
import type { AppStateRepo } from '../store/appStateRepo'

/** Minimum overlap with a display work area for saved bounds to count as recoverable. */
const MIN_VISIBLE_PX = 32
const RESET_MARGIN_PX = 16

export function isUsablyVisible(rect: WindowBounds, displays: WindowBounds[]): boolean {
  return displays.some((d) => {
    const w = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x)
    const h = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y)
    return w >= MIN_VISIBLE_PX && h >= MIN_VISIBLE_PX
  })
}

export function bottomRightOf(workArea: WindowBounds, size: { width: number; height: number }): WindowBounds {
  return {
    x: workArea.x + workArea.width - size.width - RESET_MARGIN_PX,
    y: workArea.y + workArea.height - size.height - RESET_MARGIN_PX,
    width: size.width,
    height: size.height
  }
}

/** Saved bounds if still meaningfully on a display; otherwise bottom-right of the primary work area. */
export function ensureVisibleBounds(
  saved: WindowBounds | undefined,
  displays: WindowBounds[],
  primaryWorkArea: WindowBounds,
  fallbackSize: { width: number; height: number }
): WindowBounds {
  if (saved && isUsablyVisible(saved, displays)) return saved
  return bottomRightOf(primaryWorkArea, {
    width: saved?.width ?? fallbackSize.width,
    height: saved?.height ?? fallbackSize.height
  })
}

/** Snap any edge within `threshold` px of the work-area edge flush against it. */
export function snapToWorkAreaEdges(
  rect: WindowBounds,
  workArea: WindowBounds,
  threshold: number = EDGE_SNAP_PX
): WindowBounds {
  let { x, y } = rect
  if (Math.abs(rect.x - workArea.x) <= threshold) {
    x = workArea.x
  } else if (Math.abs(rect.x + rect.width - (workArea.x + workArea.width)) <= threshold) {
    x = workArea.x + workArea.width - rect.width
  }
  if (Math.abs(rect.y - workArea.y) <= threshold) {
    y = workArea.y
  } else if (Math.abs(rect.y + rect.height - (workArea.y + workArea.height)) <= threshold) {
    y = workArea.y + workArea.height - rect.height
  }
  return { x, y, width: rect.width, height: rect.height }
}

/** Resolve the restore bounds for the companion window from persisted state + current displays. */
export function restoreCompanionBounds(
  appStateRepo: AppStateRepo,
  fallbackSize: { width: number; height: number }
): WindowBounds {
  return ensureVisibleBounds(
    appStateRepo.get().windowBounds,
    screen.getAllDisplays().map((d) => d.workArea),
    screen.getPrimaryDisplay().workArea,
    fallbackSize
  )
}

export interface WindowStateHandle {
  /** Immediate persist — call before the quit-time repo flush so the last position lands. */
  persistNow: () => void
}

/** Wire edge snapping + debounced bounds persistence. While shaded only x/y are persisted —
 *  the 48px shade height must never overwrite the real window size, but moves still count. */
export function attachWindowStateTracking(
  win: BrowserWindow,
  appStateRepo: AppStateRepo,
  isShaded: () => boolean,
  restoreHeight: () => number
): WindowStateHandle {
  let timer: ReturnType<typeof setTimeout> | undefined

  const persistNow = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return
    const b = win.getBounds()
    if (isShaded()) {
      const saved = appStateRepo.get().windowBounds
      appStateRepo.update({
        windowBounds: { x: b.x, y: b.y, width: b.width, height: saved?.height ?? restoreHeight() }
      })
      return
    }
    appStateRepo.update({ windowBounds: b })
  }

  const schedulePersist = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      persistNow()
    }, BOUNDS_DEBOUNCE_MS)
  }

  win.on('moved', () => {
    if (win.isDestroyed() || win.isMinimized()) return
    const bounds = win.getBounds()
    const workArea = screen.getDisplayMatching(bounds).workArea
    const snapped = snapToWorkAreaEdges(bounds, workArea)
    if (snapped.x !== bounds.x || snapped.y !== bounds.y) win.setBounds(snapped)
    schedulePersist()
  })
  win.on('resized', schedulePersist)
  win.on('close', () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
      persistNow()
    }
  })
  return { persistNow }
}
