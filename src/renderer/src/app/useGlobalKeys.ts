/** Global keyboard map + Esc cascade (DESIGN §9), extracted from App.tsx.
 *  Esc: sheet → editor → capture → collapse → search → filter → loops → shade.
 *  Keyboard window-move mode (`···` → Move window) lives here too. */

import { useEffect, type Dispatch, type MutableRefObject } from 'react'
import type { Api } from '../lib/api'
import type { UIAction, UIState, ViewId } from '../state/uiReducer'

const VIEW_KEYS: Record<string, ViewId> = {
  '1': 'today',
  '2': 'week',
  '3': 'later',
  '4': 'done',
  '5': 'snippets'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export interface GlobalKeysDeps {
  api: Api
  uiRef: MutableRefObject<UIState>
  uiDispatch: Dispatch<UIAction>
  moveModeRef: MutableRefObject<boolean>
  setMoveMode: (on: boolean) => void
}

export function useGlobalKeys(deps: GlobalKeysDeps): void {
  const { api, uiRef, uiDispatch, moveModeRef, setMoveMode } = deps

  useEffect(() => {
    const handleEscape = (): void => {
      const u = uiRef.current
      if (u.activeSheet === 'briefing' && u.briefing) {
        void api.invoke('briefing:defer', { dateKey: u.briefing.dateKey })
        uiDispatch({ type: 'closeBriefing' })
        return
      }
      if (u.activeSheet) {
        uiDispatch({ type: 'openSheet', sheet: null })
        return
      }
      if (u.editorTaskId) {
        uiDispatch({ type: 'openEditor', id: null })
        return
      }
      if (u.captureOpen) {
        uiDispatch({ type: 'setCaptureOpen', open: false })
        return
      }
      if (u.expandedTaskId) {
        uiDispatch({ type: 'expandTask', id: null })
        return
      }
      if (u.searchOpen || u.searchQuery) {
        uiDispatch({ type: 'setSearchOpen', open: false })
        return
      }
      if (u.legendFilter) {
        uiDispatch({ type: 'setLegendFilter', filter: null })
        return
      }
      if (u.loopsBatchMode) {
        uiDispatch({ type: 'setLoopsBatchMode', on: false })
        return
      }
      void api.invoke('window:shade', { on: true })
    }

    const onKey = (e: KeyboardEvent): void => {
      if (moveModeRef.current) {
        const step = e.shiftKey ? 64 : 16
        const moves: Record<string, [number, number]> = {
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0]
        }
        if (e.key in moves) {
          e.preventDefault()
          const [dx, dy] = moves[e.key]
          void api.invoke('window:moveBy', { dx, dy })
          return
        }
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          setMoveMode(false)
        }
        return
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault()
        void api.invoke('window:shade', { on: !uiRef.current.shaded })
        return
      }
      if (e.key === 'Escape') {
        handleEscape()
        return
      }
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (uiRef.current.shaded) return
      // Batch mode owns 1–3 as answer-chip keys (handled per-card in TaskList).
      if (uiRef.current.loopsBatchMode && (e.key === '1' || e.key === '2' || e.key === '3')) return
      if (e.key in VIEW_KEYS) {
        uiDispatch({ type: 'setView', view: VIEW_KEYS[e.key] })
        return
      }
      switch (e.key) {
        case '/':
          e.preventDefault()
          uiDispatch({ type: 'setSearchOpen', open: true })
          break
        case '?':
          uiDispatch({
            type: 'openSheet',
            sheet: uiRef.current.activeSheet === 'legend' ? null : 'legend'
          })
          break
        case 'n':
        case 'N':
          e.preventDefault()
          uiDispatch({ type: 'setCaptureOpen', open: true })
          break
        case 'a':
        case 'A':
          uiDispatch({ type: 'setLoopsBatchMode', on: !uiRef.current.loopsBatchMode })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
