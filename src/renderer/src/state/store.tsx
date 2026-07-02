/** TasksProvider + UIProvider (two contexts so UI chatter never re-renders the task list —
 *  ARCHITECTURE §4.1). Hydrates once from main, then applies push deltas. */

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode
} from 'react'
import { api, type Api } from '../lib/api'
import {
  initialTasksState,
  tasksReducer,
  type TasksAction,
  type TasksState
} from './tasksReducer'
import { initialUIState, makeToast, uiReducer, type UIAction, type UIState } from './uiReducer'

const TasksStateCtx = createContext<TasksState | null>(null)
const TasksDispatchCtx = createContext<Dispatch<TasksAction> | null>(null)
const UIStateCtx = createContext<UIState | null>(null)
const UIDispatchCtx = createContext<Dispatch<UIAction> | null>(null)

function useRequired<T>(ctx: React.Context<T | null>, name: string): T {
  const value = useContext(ctx)
  if (value === null) throw new Error(`${name} must be used inside <AppProviders>`)
  return value
}

export function useTasks(): TasksState {
  return useRequired(TasksStateCtx, 'useTasks')
}
export function useTasksDispatch(): Dispatch<TasksAction> {
  return useRequired(TasksDispatchCtx, 'useTasksDispatch')
}
export function useUI(): UIState {
  return useRequired(UIStateCtx, 'useUI')
}
export function useUIDispatch(): Dispatch<UIAction> {
  return useRequired(UIDispatchCtx, 'useUIDispatch')
}
/** The single sanctioned door to window.loops for components. */
export function useApi(): Api {
  return api
}

export function TasksProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(tasksReducer, initialTasksState)
  return (
    <TasksStateCtx.Provider value={state}>
      <TasksDispatchCtx.Provider value={dispatch}>{children}</TasksDispatchCtx.Provider>
    </TasksStateCtx.Provider>
  )
}

export function UIProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, dispatch] = useReducer(uiReducer, initialUIState)
  return (
    <UIStateCtx.Provider value={state}>
      <UIDispatchCtx.Provider value={dispatch}>{children}</UIDispatchCtx.Provider>
    </UIStateCtx.Provider>
  )
}

/** Hydration + subscription to every PushSchema channel. Cleanup-safe under StrictMode. */
function Bootstrap({ children }: { children: ReactNode }): ReactNode {
  const tasksDispatch = useTasksDispatch()
  const uiDispatch = useUIDispatch()

  useEffect(() => {
    let disposed = false
    const unsubs: Array<() => void> = []
    try {
      unsubs.push(
        api.on('tasks:changed', (p) =>
          tasksDispatch({ type: 'applyChange', upserted: p.upserted, deletedIds: p.deletedIds })
        ),
        api.on('enrichment:status', (p) =>
          tasksDispatch({ type: 'enrichmentStatus', taskId: p.taskId, status: p.status })
        ),
        api.on('ollama:statusChanged', (s) => tasksDispatch({ type: 'ollamaStatus', status: s })),
        api.on('settings:changed', (s) => {
          tasksDispatch({ type: 'settings', settings: s })
          uiDispatch({ type: 'seedCoachmarks', seen: s.coachMarksSeen })
        }),
        api.on('briefing:show', (b) => uiDispatch({ type: 'showBriefing', briefing: b })),
        api.on('briefing:synthesis', (p) =>
          uiDispatch({ type: 'briefingSynthesis', dateKey: p.dateKey, text: p.text })
        ),
        api.on('settings:hotkeyFailed', (p) =>
          uiDispatch({
            type: 'pushToast',
            toast: makeToast({
              text: p.fallback
                ? `That shortcut is taken — using ${p.fallback} instead.`
                : `That shortcut is taken — pick another in Settings. (${p.hotkey})`,
              durationMs: 8000
            })
          })
        ),
        api.on('nav:focusTask', (p) => uiDispatch({ type: 'focusTask', id: p.taskId, expand: true })),
        api.on('capture:submitted', (p) => uiDispatch({ type: 'captureSubmitted', taskId: p.taskId })),
        api.on('window:shaded', (p) => uiDispatch({ type: 'setShaded', on: p.on }))
      )

      void Promise.all([
        api.invoke('tasks:list', undefined),
        api.invoke('settings:get', undefined),
        api.invoke('ollama:status', undefined)
      ])
        .then(([tasks, settings, ollama]) => {
          if (disposed) return
          tasksDispatch({ type: 'hydrate', tasks, settings, ollama })
          uiDispatch({ type: 'seedCoachmarks', seen: settings.coachMarksSeen })
        })
        .catch((err: unknown) => {
          if (disposed) return
          uiDispatch({
            type: 'pushToast',
            toast: makeToast({
              text: "DeskMate couldn't load its data — restart the app.",
              durationMs: 0
            })
          })
          console.error('hydration failed', err)
        })
    } catch (err) {
      // Bridge missing (opened outside Electron) — the app renders empty; nothing to wire.
      console.error(err)
    }
    return () => {
      disposed = true
      for (const u of unsubs) u()
    }
  }, [tasksDispatch, uiDispatch])

  return children
}

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <TasksProvider>
      <UIProvider>
        <Bootstrap>{children}</Bootstrap>
      </UIProvider>
    </TasksProvider>
  )
}
