/** UI-state reducer (src/renderer/src/state/uiReducer.ts): view/sheet/briefing/search/toast
 *  transitions with strict no-op identity returns. */

import { describe, expect, it } from 'vitest'
import type { Briefing } from '@shared/types/enrichment'
import { initialUIState, makeToast, uiReducer, type UIState } from '@/state/uiReducer'

const briefing = (dateKey = '2026-07-02'): Briefing => ({
  dateKey,
  overdue: [],
  dueToday: [],
  dueThisWeek: [],
  stalled: [],
  questions: []
})

describe('views and expansion', () => {
  it('setView switches and collapses the expanded card', () => {
    const expanded = uiReducer(initialUIState, { type: 'expandTask', id: 't1' })
    const next = uiReducer(expanded, { type: 'setView', view: 'week' })
    expect(next.view).toBe('week')
    expect(next.expandedTaskId).toBeNull()
  })

  it('same view / same expansion → same state object', () => {
    expect(uiReducer(initialUIState, { type: 'setView', view: 'today' })).toBe(initialUIState)
    expect(uiReducer(initialUIState, { type: 'expandTask', id: null })).toBe(initialUIState)
  })

  it('focusTask expands only on explicit navigation (expand flag)', () => {
    const focused = uiReducer(initialUIState, { type: 'focusTask', id: 't9' })
    expect(focused.focusTaskId).toBe('t9')
    expect(focused.expandedTaskId).toBeNull() // fresh capture never auto-expands
    const nav = uiReducer(initialUIState, { type: 'focusTask', id: 't9', expand: true })
    expect(nav.expandedTaskId).toBe('t9') // notification / briefing row click does
    const cleared = uiReducer(nav, { type: 'focusTask', id: null })
    expect(cleared.focusTaskId).toBeNull()
    expect(cleared.expandedTaskId).toBe('t9')
  })

  it('captureSubmitted lands focus on the fresh card', () => {
    const next = uiReducer(initialUIState, { type: 'captureSubmitted', taskId: 'new1' })
    expect(next.focusTaskId).toBe('new1')
  })
})

describe('sheets and briefing', () => {
  it('showBriefing installs the briefing and opens its sheet', () => {
    const b = briefing()
    const next = uiReducer(initialUIState, { type: 'showBriefing', briefing: b })
    expect(next.briefing).toBe(b)
    expect(next.activeSheet).toBe('briefing')
  })

  it('briefingSynthesis patches only the matching dateKey', () => {
    const shown = uiReducer(initialUIState, { type: 'showBriefing', briefing: briefing() })
    const wrongDay = uiReducer(shown, { type: 'briefingSynthesis', dateKey: '2026-07-01', text: 'stale' })
    expect(wrongDay).toBe(shown)
    const patched = uiReducer(shown, { type: 'briefingSynthesis', dateKey: '2026-07-02', text: 'A calm day.' })
    expect(patched.briefing?.synthesis).toBe('A calm day.')
    // Same text again → no-op.
    expect(uiReducer(patched, { type: 'briefingSynthesis', dateKey: '2026-07-02', text: 'A calm day.' })).toBe(patched)
  })

  it('closeBriefing only closes the briefing sheet', () => {
    const shown = uiReducer(initialUIState, { type: 'showBriefing', briefing: briefing() })
    expect(uiReducer(shown, { type: 'closeBriefing' }).activeSheet).toBeNull()
    const settings = uiReducer(initialUIState, { type: 'openSheet', sheet: 'settings' })
    expect(uiReducer(settings, { type: 'closeBriefing' }).activeSheet).toBe('settings')
  })

  it('openSheet clears any legend hover', () => {
    const hovering = uiReducer(initialUIState, { type: 'legendHover', filter: 'overdue' })
    const next = uiReducer(hovering, { type: 'openSheet', sheet: 'legend' })
    expect(next.activeSheet).toBe('legend')
    expect(next.legendHover).toBeNull()
  })
})

describe('search and legend filter', () => {
  it('closing search clears the query', () => {
    let state: UIState = uiReducer(initialUIState, { type: 'setSearchOpen', open: true })
    state = uiReducer(state, { type: 'setSearchQuery', query: 'vendor' })
    expect(state.searchQuery).toBe('vendor')
    state = uiReducer(state, { type: 'setSearchOpen', open: false })
    expect(state.searchOpen).toBe(false)
    expect(state.searchQuery).toBe('')
  })

  it('legend filter sets, clears, and no-ops on identical values', () => {
    const on = uiReducer(initialUIState, { type: 'setLegendFilter', filter: 'hardDeadline' })
    expect(on.legendFilter).toBe('hardDeadline')
    expect(uiReducer(on, { type: 'setLegendFilter', filter: 'hardDeadline' })).toBe(on)
    expect(uiReducer(on, { type: 'setLegendFilter', filter: null }).legendFilter).toBeNull()
  })

  it('loops batch mode and shade toggle with no-op identity', () => {
    const batch = uiReducer(initialUIState, { type: 'setLoopsBatchMode', on: true })
    expect(batch.loopsBatchMode).toBe(true)
    expect(uiReducer(batch, { type: 'setLoopsBatchMode', on: true })).toBe(batch)
    const shaded = uiReducer(initialUIState, { type: 'setShaded', on: true })
    expect(shaded.shaded).toBe(true)
    expect(uiReducer(shaded, { type: 'setShaded', on: true })).toBe(shaded)
  })
})

describe('toasts', () => {
  it('push appends, dismiss removes by id, unknown dismiss is a no-op', () => {
    const t1 = makeToast({ text: 'Done · Undo', actionLabel: 'Undo' })
    const t2 = makeToast({ text: 'Hotkey conflict' })
    let state = uiReducer(initialUIState, { type: 'pushToast', toast: t1 })
    state = uiReducer(state, { type: 'pushToast', toast: t2 })
    expect(state.toasts).toEqual([t1, t2])
    expect(uiReducer(state, { type: 'dismissToast', id: 'ghost' })).toBe(state)
    const next = uiReducer(state, { type: 'dismissToast', id: t1.id })
    expect(next.toasts).toEqual([t2])
  })

  it('makeToast mints unique ids', () => {
    expect(makeToast({ text: 'a' }).id).not.toBe(makeToast({ text: 'a' }).id)
  })
})

describe('coach marks', () => {
  it('seeds from settings and dedupes session additions', () => {
    const seeded = uiReducer(initialUIState, { type: 'seedCoachmarks', seen: ['hard-dot'] })
    expect(seeded.coachmarksSeen).toEqual(['hard-dot'])
    const marked = uiReducer(seeded, { type: 'markCoachmarkSeen', mark: 'loop-badge' })
    expect(marked.coachmarksSeen).toEqual(['hard-dot', 'loop-badge'])
    expect(uiReducer(marked, { type: 'markCoachmarkSeen', mark: 'loop-badge' })).toBe(marked)
  })
})
