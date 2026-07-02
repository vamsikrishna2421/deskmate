/** Pure tasks-cache reducer. The renderer is a push-updated cache of main-process state:
 *  hydrate once, then apply 'tasks:changed' deltas. Untouched tasks keep object identity
 *  (React.memo guarantee — ARCHITECTURE §4.1). */

import type { Task, TrashEntry } from '@shared/types/task'
import type { AppState, OllamaStatus } from '@shared/types/appState'

/** Transient per-task pipeline activity ('queued'|'running'); persistent state lives on task.enrichment. */
export type ActiveEnrichment = Readonly<Record<string, 'queued' | 'running'>>

export interface TasksState {
  hydrated: boolean
  tasks: Task[]
  /** The Let go bin — restorable for 30 days. */
  trash: TrashEntry[]
  enrichment: ActiveEnrichment
  ollama: OllamaStatus | null
  settings: AppState | null
}

export type TasksAction =
  | { type: 'hydrate'; tasks: Task[]; settings: AppState; ollama: OllamaStatus }
  | { type: 'applyChange'; upserted: Task[]; deletedIds: string[] }
  | { type: 'trash'; entries: TrashEntry[] }
  | { type: 'enrichmentStatus'; taskId: string; status: 'queued' | 'running' | 'done' | 'failed' | 'skipped' }
  | { type: 'ollamaStatus'; status: OllamaStatus }
  | { type: 'settings'; settings: AppState }

export const initialTasksState: TasksState = {
  hydrated: false,
  tasks: [],
  trash: [],
  enrichment: {},
  ollama: null,
  settings: null
}

function applyChange(tasks: Task[], upserted: Task[], deletedIds: string[]): Task[] {
  if (upserted.length === 0 && deletedIds.length === 0) return tasks
  const byId = new Map(upserted.map((t) => [t.id, t]))
  const deleted = new Set(deletedIds)
  const next: Task[] = []
  let changed = false
  for (const t of tasks) {
    if (deleted.has(t.id)) {
      changed = true
      continue
    }
    const up = byId.get(t.id)
    if (up !== undefined) {
      next.push(up)
      byId.delete(t.id)
      if (up !== t) changed = true
    } else {
      next.push(t) // identity preserved
    }
  }
  for (const t of byId.values()) {
    next.push(t)
    changed = true
  }
  return changed ? next : tasks
}

export function tasksReducer(state: TasksState, action: TasksAction): TasksState {
  switch (action.type) {
    case 'hydrate':
      return {
        hydrated: true,
        tasks: action.tasks,
        trash: state.trash,
        enrichment: state.enrichment,
        ollama: action.ollama,
        settings: action.settings
      }

    case 'trash':
      return { ...state, trash: action.entries }

    case 'applyChange': {
      const tasks = applyChange(state.tasks, action.upserted, action.deletedIds)
      if (tasks === state.tasks) return state
      // A deleted task can never leave a dangling transient entry.
      let enrichment = state.enrichment
      if (action.deletedIds.some((id) => id in enrichment)) {
        const next = { ...enrichment }
        for (const id of action.deletedIds) delete next[id]
        enrichment = next
      }
      return { ...state, tasks, enrichment }
    }

    case 'enrichmentStatus': {
      const active = action.status === 'queued' || action.status === 'running'
      const has = action.taskId in state.enrichment
      if (!active && !has) return state
      if (active && state.enrichment[action.taskId] === action.status) return state
      const enrichment = { ...state.enrichment }
      if (active) enrichment[action.taskId] = action.status as 'queued' | 'running'
      else delete enrichment[action.taskId]
      return { ...state, enrichment }
    }

    case 'ollamaStatus':
      return { ...state, ollama: action.status }

    case 'settings':
      return { ...state, settings: action.settings }
  }
}
