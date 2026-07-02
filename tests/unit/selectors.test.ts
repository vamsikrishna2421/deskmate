/** View selectors (src/renderer/src/state/selectors.ts, DESIGN.md §9/§10): bucketing, grouping,
 *  memoization, search, legend filters, loops count, shade ticker. Anchor: Thu 2026-07-02. */

import { describe, expect, it } from 'vitest'
import type { Task } from '@shared/types/task'
import { DAY_BUDGET_MINUTES } from '@shared/constants'
import {
  effortBucket,
  filterViewModel,
  hasOpenLoops,
  legendPredicate,
  searchTasks,
  selectCounts,
  selectNextHardToday,
  selectOpenLoopsCount,
  selectStalledIds,
  selectViewModel,
  viewForTask
} from '@/state/selectors'

const NOW = new Date(2026, 6, 2, 10, 0) // Thursday 2026-07-02

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
    createdAt: `2026-06-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
    updatedAt: '2026-06-20T09:00:00.000Z',
    activityAt: new Date(2026, 6, 1, 9).toISOString(),
    ...over
  }
}

const hard = (dueDate: string, dueTime?: string): Task['deadline'] => ({
  kind: 'hard',
  dueDate,
  ...(dueTime ? { dueTime } : {}),
  source: 'llm'
})
const soft = (dueDate: string): Task['deadline'] => ({ kind: 'soft', dueDate, source: 'llm' })

describe('Today view (DESIGN §9)', () => {
  it('groups fresh (unlabeled) → Carried over → Due today → Picked for today', () => {
    const fresh = makeTask({ status: 'inbox' })
    const carried = makeTask({ deadline: hard('2026-06-30') })
    const dueToday = makeTask({ deadline: soft('2026-07-02') })
    const pinned = makeTask({ pinned: true })
    const inProgress = makeTask({ status: 'in_progress' })
    const later = makeTask() // open, undated → not in Today
    const tasks = [later, pinned, dueToday, carried, fresh, inProgress]

    const vm = selectViewModel(tasks, 'today', NOW)
    expect(vm.groups.map((g) => [g.key, g.label])).toEqual([
      ['new', ''],
      ['carried', 'Carried over'],
      ['due-today', 'Due today'],
      ['picked', 'Picked for today']
    ])
    expect(vm.groups[0].tasks.map((t) => t.id)).toEqual([fresh.id])
    expect(vm.groups[1].tasks.map((t) => t.id)).toEqual([carried.id])
    expect(vm.groups[2].tasks.map((t) => t.id)).toEqual([dueToday.id])
    expect(vm.groups[3].tasks.map((t) => t.id)).toEqual([pinned.id, inProgress.id])
    expect(vm.emptyText).toBe('Nothing due today. Enjoy the space.')
  })

  it('sums the footer effort across every card in the view', () => {
    const a = makeTask({ status: 'inbox', effort: 'hour' }) // 60
    const b = makeTask({ deadline: hard('2026-07-02'), effort: 'half_day' }) // 240
    const vm = selectViewModel([a, b], 'today', NOW)
    expect(vm.effortTodayMinutes).toBe(300)
  })

  it('approximate range deadlines never count as dated — they live in Later', () => {
    const approx = makeTask({ deadline: { kind: 'soft', dueDate: '2026-07-02', source: 'llm', approx: true, rawToken: 'next-week' } })
    expect(selectViewModel([approx], 'today', NOW).groups).toEqual([])
    const laterVm = selectViewModel([approx], 'later', NOW)
    expect(laterVm.groups[0]?.tasks.map((t) => t.id)).toEqual([approx.id])
  })
})

describe('Week view', () => {
  it('groups remaining weekdays plus Weekend, with load-gauge sums', () => {
    const friA = makeTask({ deadline: hard('2026-07-03', '09:00'), effort: 'half_day' }) // 240
    const friB = makeTask({ deadline: soft('2026-07-03'), effort: 'hour' }) // 60
    const sat = makeTask({ deadline: soft('2026-07-04'), effort: 'minutes' })
    const sun = makeTask({ deadline: soft('2026-07-05') })
    const dueToday = makeTask({ deadline: hard('2026-07-02') }) // today ≠ week
    const nextMonday = makeTask({ deadline: hard('2026-07-06') }) // next week

    const vm = selectViewModel([sun, sat, friB, friA, dueToday, nextMonday], 'week', NOW)
    expect(vm.groups.map((g) => g.label)).toEqual(['Friday', 'Weekend'])
    const friday = vm.groups[0]
    expect(friday.tasks.map((t) => t.id)).toEqual([friA.id, friB.id]) // timed first
    expect(friday.effortMinutes).toBe(300)
    expect(friday.budgetMinutes).toBe(DAY_BUDGET_MINUTES)
    expect(vm.groups[1].tasks.map((t) => t.id)).toEqual([sat.id, sun.id])
    expect(vm.emptyText).toBe('A clear week so far.')
  })
})

describe('Later view (free-time shelf)', () => {
  it('collects undated, approx, and beyond-this-week tasks, oldest first', () => {
    const undated = makeTask()
    const beyondWeek = makeTask({ deadline: soft('2026-07-08') })
    const approx = makeTask({ deadline: { kind: 'soft', dueDate: '2026-07-10', source: 'llm', approx: true } })
    const vm = selectViewModel([approx, beyondWeek, undated], 'later', NOW)
    expect(vm.groups).toHaveLength(1)
    expect(vm.groups[0].label).toBe('')
    expect(vm.groups[0].tasks.map((t) => t.id)).toEqual([undated.id, beyondWeek.id, approx.id]) // createdAt asc
    expect(vm.emptyText).toBe('Nothing waiting.')
  })

  it('effortBucket maps to the filter pills: ≤30m / ≤2h / Big rocks', () => {
    expect(effortBucket('minutes')).toBe('quick')
    expect(effortBucket('hour')).toBe('medium')
    expect(effortBucket('half_day')).toBe('big')
    expect(effortBucket('day')).toBe('big')
    expect(effortBucket('multi_day')).toBe('big')
    expect(effortBucket(undefined)).toBeNull()
  })
})

describe('Done view', () => {
  it('groups by completion day, newest first, 30-day archive window', () => {
    const today = makeTask({ status: 'done', completedAt: new Date(2026, 6, 2, 8).toISOString() })
    const yesterday = makeTask({ status: 'done', completedAt: new Date(2026, 6, 1, 18).toISOString() })
    const ancient = makeTask({ status: 'done', completedAt: new Date(2026, 4, 20, 12).toISOString() })
    const vm = selectViewModel([ancient, yesterday, today], 'done', NOW)
    expect(vm.groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(vm.groups[0].tasks.map((t) => t.id)).toEqual([today.id])
    expect(vm.groups[1].tasks.map((t) => t.id)).toEqual([yesterday.id])
    expect(vm.emptyText).toBe('Nothing yet today.')
  })
})

describe('memoization and counts', () => {
  it('same tasks identity + same day → same view-model object', () => {
    const tasks = [makeTask({ status: 'inbox' })]
    const a = selectViewModel(tasks, 'today', NOW)
    const b = selectViewModel(tasks, 'today', new Date(2026, 6, 2, 23, 0))
    expect(b).toBe(a)
    expect(selectViewModel([...tasks], 'today', NOW)).not.toBe(a) // new identity → rebuild
  })

  it('selectCounts buckets every view; Done counts only today’s completions', () => {
    const tasks = [
      makeTask({ status: 'inbox' }), // today
      makeTask({ deadline: hard('2026-06-30') }), // today (carried)
      makeTask({ pinned: true }), // today
      makeTask({ deadline: soft('2026-07-03') }), // week
      makeTask(), // later
      makeTask({ deadline: soft('2026-07-09') }), // later (beyond week)
      makeTask({ status: 'done', completedAt: new Date(2026, 6, 2, 9).toISOString() }), // done today
      makeTask({ status: 'done', completedAt: new Date(2026, 6, 1, 9).toISOString() }), // done yesterday
      makeTask({ status: 'archived' })
    ]
    expect(selectCounts(tasks, NOW)).toEqual({ today: 3, week: 1, later: 2, done: 1 })
  })

  it('viewForTask routes to the task’s natural view', () => {
    expect(viewForTask(makeTask({ status: 'inbox' }), NOW)).toBe('today')
    expect(viewForTask(makeTask({ deadline: soft('2026-07-03') }), NOW)).toBe('week')
    expect(viewForTask(makeTask(), NOW)).toBe('later')
    expect(viewForTask(makeTask({ status: 'done', completedAt: NOW.toISOString() }), NOW)).toBe('done')
  })
})

describe('open loops', () => {
  const openQ = (id: string): Task['questions'][number] => ({ id, question: 'why?', status: 'open' })

  it('counts open questions on live tasks only', () => {
    const two = makeTask({ questions: [openQ('a'), openQ('b')] })
    const answered = makeTask({ questions: [{ id: 'c', question: 'x', status: 'answered', answer: 'y' }] })
    const doneTask = makeTask({ status: 'done', completedAt: NOW.toISOString(), questions: [openQ('d')] })
    const tasks = [two, answered, doneTask]
    expect(selectOpenLoopsCount(tasks)).toBe(2)
    expect(hasOpenLoops(two)).toBe(true)
    expect(hasOpenLoops(answered)).toBe(false)
    expect(hasOpenLoops(doneTask)).toBe(false)
  })
})

describe('stalled ids (moon glyph — 5 workdays)', () => {
  it('flags tasks untouched ≥5 business days', () => {
    const stalled = makeTask({ activityAt: new Date(2026, 5, 24, 9).toISOString() }) // Wed Jun 24 → 5
    const active = makeTask({ activityAt: new Date(2026, 5, 25, 9).toISOString() }) // Thu Jun 25 → 4
    const doneOld = makeTask({
      status: 'done',
      completedAt: NOW.toISOString(),
      activityAt: new Date(2026, 5, 1, 9).toISOString()
    })
    const ids = selectStalledIds([stalled, active, doneOld], NOW)
    expect([...ids]).toEqual([stalled.id])
  })
})

describe('shade ticker — next hard deadline today', () => {
  it('picks the earliest hard deadline still ahead of now', () => {
    const at3 = makeTask({ deadline: hard('2026-07-02', '15:00') })
    const at5 = makeTask({ deadline: hard('2026-07-02', '17:00') })
    const softToday = makeTask({ deadline: soft('2026-07-02') })
    const tasks = [at5, at3, softToday]
    expect(selectNextHardToday(tasks, new Date(2026, 6, 2, 14, 0))?.id).toBe(at3.id)
    expect(selectNextHardToday(tasks, new Date(2026, 6, 2, 16, 0))?.id).toBe(at5.id)
    expect(selectNextHardToday(tasks, new Date(2026, 6, 2, 18, 0))).toBeNull()
  })

  it('date-only hard deadlines tick at 17:30 EOD', () => {
    const eod = makeTask({ deadline: hard('2026-07-02') })
    expect(selectNextHardToday([eod], new Date(2026, 6, 2, 17, 0))?.id).toBe(eod.id)
    expect(selectNextHardToday([eod], new Date(2026, 6, 2, 17, 45))).toBeNull()
  })
})

describe('search — fuzzy title + raw source + #tag, archived stays searchable', () => {
  it('matches substring, subsequence, source text, and tags', () => {
    const budget = makeTask({ title: 'Budget review for Q3' })
    const vendor = makeTask({ title: 'Vendor spend', sourceText: 'rebuild the vendor spend numbers' })
    const tagged = makeTask({ title: 'Dash', tags: ['finance', 'dashboard'] })
    const archived = makeTask({ title: 'Ancient budget task', status: 'archived' })
    const tasks = [budget, vendor, tagged, archived]

    expect(searchTasks(tasks, 'budget').map((t) => t.id)).toEqual([budget.id, archived.id])
    expect(searchTasks(tasks, 'bgt').map((t) => t.id)).toContain(budget.id) // subsequence
    expect(searchTasks(tasks, 'numbers').map((t) => t.id)).toEqual([vendor.id]) // raw source
    expect(searchTasks(tasks, '#fin').map((t) => t.id)).toEqual([tagged.id]) // tag prefix
    expect(searchTasks(tasks, '')).toBe(tasks) // empty query → untouched
  })
})

describe('legend live filters (closed vocabulary)', () => {
  const ctx = { now: NOW, stalledIds: new Set<string>(), enrichment: {} as Record<string, 'queued' | 'running'> }

  it('urgency, deadline-kind, question, locked, focus, working predicates', () => {
    const overdue = makeTask({ deadline: hard('2026-06-30') })
    const locked = makeTask({ provenance: { title: 'user', summary: 'llm', priority: 'llm', effort: 'llm', tags: 'llm' } })
    const userDeadline = makeTask({ deadline: { kind: 'soft', dueDate: '2026-07-20', source: 'user' } })
    const question = makeTask({ questions: [{ id: 'q', question: 'x', status: 'open' }] })
    const focus = makeTask({ focus: true })
    const working = makeTask()
    const plain = makeTask()

    expect(legendPredicate('overdue', ctx)(overdue)).toBe(true)
    expect(legendPredicate('overdue', ctx)(plain)).toBe(false)
    expect(legendPredicate('hardDeadline', ctx)(overdue)).toBe(true)
    expect(legendPredicate('softDeadline', ctx)(userDeadline)).toBe(true)
    expect(legendPredicate('question', ctx)(question)).toBe(true)
    expect(legendPredicate('locked', ctx)(locked)).toBe(true)
    expect(legendPredicate('locked', ctx)(userDeadline)).toBe(true)
    expect(legendPredicate('locked', ctx)(plain)).toBe(false)
    expect(legendPredicate('focus', ctx)(focus)).toBe(true)
    const workingCtx = { ...ctx, enrichment: { [working.id]: 'running' as const } }
    expect(legendPredicate('working', workingCtx)(working)).toBe(true)
    expect(legendPredicate('working', workingCtx)(plain)).toBe(false)
  })

  it('filterViewModel drops emptied groups', () => {
    const fresh = makeTask({ status: 'inbox' })
    const carried = makeTask({ deadline: hard('2026-06-30'), focus: true })
    const vm = selectViewModel([fresh, carried], 'today', NOW)
    expect(vm.groups).toHaveLength(2)
    const filtered = filterViewModel(vm, (t) => t.focus)
    expect(filtered.groups).toHaveLength(1)
    expect(filtered.groups[0].tasks.map((t) => t.id)).toEqual([carried.id])
  })
})
