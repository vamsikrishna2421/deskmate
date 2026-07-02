/** Pure UI-state reducer: view, expansion, sheets, briefing, search, legend filter,
 *  loops batch mode, shade, toasts, coach marks. No task data lives here. */

import type { Briefing } from '@shared/types/enrichment'

/** Task list views — the selectors only bucket tasks for these. */
export type TaskViewId = 'today' | 'week' | 'later' | 'done'
/** 'snippets' is the Desk vault — a different surface sharing the tab row. */
export type ViewId = TaskViewId | 'snippets'

export type SheetId = 'briefing' | 'legend' | 'settings'

/** Closed legend vocabulary usable as a live list filter (DESIGN §10). */
export type LegendFilterId =
  | 'overdue'
  | 'dueToday'
  | 'thisWeek'
  | 'later'
  | 'hardDeadline'
  | 'softDeadline'
  | 'question'
  | 'assistant'
  | 'guessed'
  | 'locked'
  | 'done'
  | 'urgent'
  | 'high'
  | 'stalled'
  | 'offline'
  | 'working'
  | 'focus'

export interface Toast {
  id: string
  text: string
  actionLabel?: string
  /** Captured at dispatch time (e.g. Undo → tasks:setStatus). Reducer only stores it. */
  onAction?: () => void
  /** Auto-dismiss delay; Toasts component owns the timer. Default 5000. */
  durationMs?: number
}

export interface UIState {
  view: ViewId
  expandedTaskId: string | null
  /** TaskEditor bottom-sheet target; null = closed. */
  editorTaskId: string | null
  activeSheet: SheetId | null
  briefing: Briefing | null
  searchOpen: boolean
  searchQuery: string
  legendFilter: LegendFilterId | null
  /** Legend row hover → highlight matching cards behind the sheet (2s). */
  legendHover: LegendFilterId | null
  loopsBatchMode: boolean
  shaded: boolean
  /** Inline capture field at the top of the list ('N' / header '+'). */
  captureOpen: boolean
  toasts: Toast[]
  /** Scroll/focus target (nav:focusTask push, new-capture landing). */
  focusTaskId: string | null
  /** Coach marks already shown (seeded from AppState.coachMarksSeen; session additions local). */
  coachmarksSeen: readonly string[]
}

export type UIAction =
  | { type: 'setView'; view: ViewId }
  | { type: 'expandTask'; id: string | null }
  | { type: 'openEditor'; id: string | null }
  | { type: 'openSheet'; sheet: SheetId | null }
  | { type: 'showBriefing'; briefing: Briefing }
  | { type: 'briefingSynthesis'; dateKey: string; text: string }
  | { type: 'closeBriefing' }
  | { type: 'setSearchOpen'; open: boolean }
  | { type: 'setSearchQuery'; query: string }
  | { type: 'setLegendFilter'; filter: LegendFilterId | null }
  | { type: 'legendHover'; filter: LegendFilterId | null }
  | { type: 'setLoopsBatchMode'; on: boolean }
  | { type: 'setShaded'; on: boolean }
  | { type: 'setCaptureOpen'; open: boolean }
  | { type: 'pushToast'; toast: Toast }
  | { type: 'dismissToast'; id: string }
  | { type: 'focusTask'; id: string | null; expand?: boolean }
  | { type: 'captureSubmitted'; taskId: string }
  | { type: 'seedCoachmarks'; seen: string[] }
  | { type: 'markCoachmarkSeen'; mark: string }

export const initialUIState: UIState = {
  view: 'today',
  expandedTaskId: null,
  editorTaskId: null,
  activeSheet: null,
  briefing: null,
  searchOpen: false,
  searchQuery: '',
  legendFilter: null,
  legendHover: null,
  loopsBatchMode: false,
  shaded: false,
  captureOpen: false,
  toasts: [],
  focusTaskId: null,
  coachmarksSeen: []
}

/** Impure id helper for dispatch sites — the reducer itself never generates ids. */
export function makeToast(t: Omit<Toast, 'id'>): Toast {
  return { id: crypto.randomUUID(), ...t }
}

export function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'setView':
      if (state.view === action.view) return state
      return { ...state, view: action.view, expandedTaskId: null }

    case 'expandTask':
      if (state.expandedTaskId === action.id) return state
      return { ...state, expandedTaskId: action.id }

    case 'openEditor':
      return { ...state, editorTaskId: action.id }

    case 'openSheet':
      if (state.activeSheet === action.sheet) return state
      return { ...state, activeSheet: action.sheet, legendHover: null }

    case 'showBriefing':
      return { ...state, briefing: action.briefing, activeSheet: 'briefing' }

    case 'briefingSynthesis': {
      const b = state.briefing
      if (!b || b.dateKey !== action.dateKey || b.synthesis === action.text) return state
      return { ...state, briefing: { ...b, synthesis: action.text } }
    }

    case 'closeBriefing':
      return { ...state, activeSheet: state.activeSheet === 'briefing' ? null : state.activeSheet }

    case 'setSearchOpen':
      if (state.searchOpen === action.open) return state
      return { ...state, searchOpen: action.open, searchQuery: action.open ? state.searchQuery : '' }

    case 'setSearchQuery':
      return { ...state, searchQuery: action.query }

    case 'setLegendFilter':
      if (state.legendFilter === action.filter) return state
      return { ...state, legendFilter: action.filter }

    case 'legendHover':
      if (state.legendHover === action.filter) return state
      return { ...state, legendHover: action.filter }

    case 'setLoopsBatchMode':
      if (state.loopsBatchMode === action.on) return state
      return { ...state, loopsBatchMode: action.on }

    case 'setShaded':
      if (state.shaded === action.on) return state
      return { ...state, shaded: action.on }

    case 'setCaptureOpen':
      if (state.captureOpen === action.open) return state
      return { ...state, captureOpen: action.open }

    case 'pushToast':
      return { ...state, toasts: [...state.toasts, action.toast] }

    case 'dismissToast': {
      const toasts = state.toasts.filter((t) => t.id !== action.id)
      if (toasts.length === state.toasts.length) return state
      return { ...state, toasts }
    }

    case 'focusTask':
      if (state.focusTaskId === action.id && !action.expand) return state
      return {
        ...state,
        focusTaskId: action.id,
        // Only explicit navigation (notification click, briefing row) expands the card.
        expandedTaskId: action.expand && action.id ? action.id : state.expandedTaskId
      }

    case 'captureSubmitted':
      // Companion window: land focus on the fresh card once its 'tasks:changed' arrives.
      return { ...state, focusTaskId: action.taskId }

    case 'seedCoachmarks': {
      // Union, not replace: a settings:changed push must never resurrect a mark dismissed
      // in this session but not yet round-tripped through the store.
      const merged = [...new Set([...state.coachmarksSeen, ...action.seen])]
      if (merged.length === state.coachmarksSeen.length) return state
      return { ...state, coachmarksSeen: merged }
    }

    case 'markCoachmarkSeen':
      if (state.coachmarksSeen.includes(action.mark)) return state
      return { ...state, coachmarksSeen: [...state.coachmarksSeen, action.mark] }
  }
}
