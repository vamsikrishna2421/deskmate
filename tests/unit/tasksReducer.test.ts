/** Tasks-cache reducer (src/renderer/src/state/tasksReducer.ts): delta application with object
 *  identity preservation (React.memo guarantee), transient enrichment map hygiene. */

import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types/task'
import type { AppState, OllamaStatus } from '@shared/types/appState'
import {
  initialTasksState,
  tasksReducer,
  type TasksState
} from '@/state/tasksReducer'

let seq = 0
function makeTask(over: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    summary: undefined,
    sourceText: 'src',
    sourceKind: 'typed',
    status: 'open',
    deadline: { kind: 'none', source: 'llm' },
    priority: 'normal',
    effort: undefined,
    tags: [],
    subtasks: [],
    questions: [],
    qaHistory: [],
    dismissedQuestionTexts: [],
    provenance: { title: 'llm', summary: 'llm', priority: 'llm', effort: 'llm', tags: 'llm' },
    enrichment: { status: 'done', attempts: 1 },
    reminders: {},
    focus: false,
    pinned: false,
    createdAt: '2026-07-01T09:00:00.000Z',
    updatedAt: '2026-07-01T09:00:00.000Z',
    activityAt: '2026-07-01T09:00:00.000Z',
    ...over
  }
}

const fakeSettings = { theme: 'system' } as AppState
const fakeOllama = { reachable: true, models: [], queued: 0, paused: false } as OllamaStatus

function hydrated(tasks: Task[]): TasksState {
  return tasksReducer(initialTasksState, {
    type: 'hydrate',
    tasks,
    settings: fakeSettings,
    ollama: fakeOllama
  })
}

describe('hydrate', () => {
  it('installs the full snapshot and flips hydrated', () => {
    const t = makeTask()
    const state = hydrated([t])
    expect(state.hydrated).toBe(true)
    expect(state.tasks).toEqual([t])
    expect(state.settings).toBe(fakeSettings)
    expect(state.ollama).toBe(fakeOllama)
  })
})

describe('applyChange — identity preservation', () => {
  it('untouched tasks keep object identity; the upserted one is replaced', () => {
    const a = makeTask()
    const b = makeTask()
    const c = makeTask()
    const state = hydrated([a, b, c])
    const b2 = { ...b, title: 'Updated' }
    const next = tasksReducer(state, { type: 'applyChange', upserted: [b2], deletedIds: [] })
    expect(next.tasks[0]).toBe(a) // identity — memo guarantee
    expect(next.tasks[1]).toBe(b2)
    expect(next.tasks[2]).toBe(c)
    expect(next.tasks).not.toBe(state.tasks)
  })

  it('unknown ids append at the end', () => {
    const a = makeTask()
    const state = hydrated([a])
    const fresh = makeTask()
    const next = tasksReducer(state, { type: 'applyChange', upserted: [fresh], deletedIds: [] })
    expect(next.tasks.map((t) => t.id)).toEqual([a.id, fresh.id])
  })

  it('deleted ids are removed', () => {
    const a = makeTask()
    const b = makeTask()
    const state = hydrated([a, b])
    const next = tasksReducer(state, { type: 'applyChange', upserted: [], deletedIds: [a.id] })
    expect(next.tasks).toEqual([b])
    expect(next.tasks[0]).toBe(b)
  })

  it('a no-op delta returns the exact same state object', () => {
    const a = makeTask()
    const state = hydrated([a])
    expect(tasksReducer(state, { type: 'applyChange', upserted: [], deletedIds: [] })).toBe(state)
    // Upserting the identical object reference is also a no-op.
    expect(tasksReducer(state, { type: 'applyChange', upserted: [a], deletedIds: [] })).toBe(state)
    expect(tasksReducer(state, { type: 'applyChange', upserted: [], deletedIds: ['ghost'] })).toBe(state)
  })

  it('deleting a task clears its transient enrichment entry', () => {
    const a = makeTask()
    const state = tasksReducer(hydrated([a]), { type: 'enrichmentStatus', taskId: a.id, status: 'running' })
    expect(state.enrichment[a.id]).toBe('running')
    const next = tasksReducer(state, { type: 'applyChange', upserted: [], deletedIds: [a.id] })
    expect(next.enrichment[a.id]).toBeUndefined()
  })
})

describe('enrichmentStatus — transient map', () => {
  it('queued/running are tracked; done/failed clear the entry', () => {
    const a = makeTask()
    let state = hydrated([a])
    state = tasksReducer(state, { type: 'enrichmentStatus', taskId: a.id, status: 'queued' })
    expect(state.enrichment[a.id]).toBe('queued')
    state = tasksReducer(state, { type: 'enrichmentStatus', taskId: a.id, status: 'running' })
    expect(state.enrichment[a.id]).toBe('running')
    state = tasksReducer(state, { type: 'enrichmentStatus', taskId: a.id, status: 'done' })
    expect(a.id in state.enrichment).toBe(false)
  })

  it('no-op transitions return the same state object', () => {
    const a = makeTask()
    const state = hydrated([a])
    expect(tasksReducer(state, { type: 'enrichmentStatus', taskId: a.id, status: 'done' })).toBe(state)
    const queued = tasksReducer(state, { type: 'enrichmentStatus', taskId: a.id, status: 'queued' })
    expect(tasksReducer(queued, { type: 'enrichmentStatus', taskId: a.id, status: 'queued' })).toBe(queued)
  })
})

describe('status pushes', () => {
  it('ollamaStatus and settings replace their slices without touching tasks', () => {
    const a = makeTask()
    const state = hydrated([a])
    const status: OllamaStatus = { reachable: false, models: [], queued: 2, paused: false }
    const next = tasksReducer(state, { type: 'ollamaStatus', status })
    expect(next.ollama).toBe(status)
    expect(next.tasks).toBe(state.tasks)
    const settings2 = { theme: 'dark' } as AppState
    const next2 = tasksReducer(next, { type: 'settings', settings: settings2 })
    expect(next2.settings).toBe(settings2)
    expect(next2.tasks).toBe(state.tasks)
  })
})
