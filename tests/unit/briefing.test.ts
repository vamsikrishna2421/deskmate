/** Pure briefing construction + digest rendering (src/main/briefing.ts, LLM_PIPELINE.md §5–6,
 *  DESIGN.md §8). Injected 'now' — Thursday 2026-07-02 unless stated. */

import { describe, expect, it } from 'vitest'
import type { Briefing } from '../../src/shared/types/enrichment'
import type { Deadline, Task } from '../../src/shared/types/task'
import { buildBriefing, fallbackSynthesis, renderBriefingDigest } from '../../src/main/briefing'

const NOW = new Date(2026, 6, 2, 9, 0) // Thursday 2026-07-02

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
    createdAt: new Date(2026, 5, 20, 9).toISOString(),
    updatedAt: new Date(2026, 5, 20, 9).toISOString(),
    activityAt: new Date(2026, 6, 1, 9).toISOString(), // touched yesterday — never stalled by accident
    ...over
  }
}

const hard = (dueDate: string, dueTime?: string): Deadline => ({
  kind: 'hard',
  dueDate,
  ...(dueTime ? { dueTime } : {}),
  source: 'llm',
  rawToken: 'friday'
})
const soft = (dueDate: string): Deadline => ({ kind: 'soft', dueDate, source: 'llm' })

describe('buildBriefing — bucketing', () => {
  it('splits overdue / due today / this week from resolved dates; week ends Sunday', () => {
    const overdue = makeTask({ deadline: hard('2026-07-01') })
    const today = makeTask({ deadline: soft('2026-07-02') })
    const friday = makeTask({ deadline: hard('2026-07-03') })
    const saturday = makeTask({ deadline: soft('2026-07-04') })
    const sunday = makeTask({ deadline: soft('2026-07-05') })
    const nextMonday = makeTask({ deadline: hard('2026-07-06') }) // outside this week
    const undated = makeTask()

    const b = buildBriefing([overdue, today, friday, saturday, sunday, nextMonday, undated], NOW)
    expect(b.dateKey).toBe('2026-07-02')
    expect(b.overdue.map((r) => r.id)).toEqual([overdue.id])
    expect(b.dueToday.map((r) => r.id)).toEqual([today.id])
    expect(b.dueThisWeek.map((r) => r.id)).toEqual([friday.id, saturday.id, sunday.id])
    expect(b.stalled).toEqual([])
  })

  it('excludes done and archived tasks entirely', () => {
    const done = makeTask({ deadline: hard('2026-07-01'), status: 'done', completedAt: NOW.toISOString() })
    const archived = makeTask({ deadline: hard('2026-07-02'), status: 'archived' })
    const b = buildBriefing([done, archived], NOW)
    expect(b.overdue).toEqual([])
    expect(b.dueToday).toEqual([])
  })

  it('computes daysOverdue and sorts most-overdue first', () => {
    const one = makeTask({ deadline: hard('2026-07-01') })
    const three = makeTask({ deadline: hard('2026-06-29') })
    const b = buildBriefing([one, three], NOW)
    expect(b.overdue.map((r) => [r.id, r.daysOverdue])).toEqual([
      [three.id, 3],
      [one.id, 1]
    ])
  })

  it('weekend anchor: the week still ends that Sunday', () => {
    const saturdayNow = new Date(2026, 6, 4, 10, 0)
    const sunday = makeTask({ deadline: soft('2026-07-05') })
    const monday = makeTask({ deadline: soft('2026-07-06') })
    const b = buildBriefing([sunday, monday], saturdayNow)
    expect(b.dueThisWeek.map((r) => r.id)).toEqual([sunday.id])
  })
})

describe('buildBriefing — stalled (5 workdays, max 2, deadline/priority preferred)', () => {
  it('a task untouched 5 workdays is stalled; 4 workdays is not', () => {
    const stalled = makeTask({ activityAt: new Date(2026, 5, 25, 9).toISOString() }) // Thu Jun 25 → 5 workdays
    const fresh = makeTask({ activityAt: new Date(2026, 5, 26, 9).toISOString() }) // Fri Jun 26 → 4 workdays
    const b = buildBriefing([stalled, fresh], NOW)
    expect(b.stalled.map((r) => [r.id, r.daysStalled])).toEqual([[stalled.id, 5]])
  })

  it('caps at 2, preferring tasks with a deadline or high priority', () => {
    const quiet = new Date(2026, 5, 22, 9).toISOString() // Mon Jun 22 — long quiet
    const withDeadline = makeTask({ activityAt: quiet, deadline: soft('2026-08-01') }) // beyond this week → unbucketed
    const highPrio = makeTask({ activityAt: quiet, priority: 'high' })
    const plain = makeTask({ activityAt: quiet })
    const b = buildBriefing([plain, highPrio, withDeadline], NOW)
    expect(b.stalled).toHaveLength(2)
    expect(b.stalled.map((r) => r.id)).toEqual([withDeadline.id, highPrio.id])
  })

  it('bucketed tasks never double as stalled', () => {
    const overdueQuiet = makeTask({
      deadline: hard('2026-06-20'),
      activityAt: new Date(2026, 5, 1, 9).toISOString()
    })
    const b = buildBriefing([overdueQuiet], NOW)
    expect(b.overdue.map((r) => r.id)).toEqual([overdueQuiet.id])
    expect(b.stalled).toEqual([])
  })
})

describe('buildBriefing — questions and effort', () => {
  it('collects at most 2 open questions, most urgent tasks first', () => {
    const q = (id: string, question: string): Task['questions'][number] => ({ id, question, status: 'open' })
    const weekTask = makeTask({ deadline: soft('2026-07-03'), questions: [q('q3', 'Third?')] })
    const overdueTask = makeTask({ deadline: hard('2026-07-01'), questions: [q('q1', 'First?'), q('q2', 'Second?')] })
    const b = buildBriefing([weekTask, overdueTask], NOW)
    expect(b.questions).toEqual([
      { taskId: overdueTask.id, questionId: 'q1', question: 'First?' },
      { taskId: overdueTask.id, questionId: 'q2', question: 'Second?' }
    ])
  })

  it('answered and dismissed questions are skipped', () => {
    const t = makeTask({
      questions: [
        { id: 'a', question: 'Answered?', status: 'answered', answer: 'yes' },
        { id: 'd', question: 'Dismissed?', status: 'dismissed' },
        { id: 'o', question: 'Open?', status: 'open' }
      ]
    })
    const b = buildBriefing([t], NOW)
    expect(b.questions.map((x) => x.questionId)).toEqual(['o'])
  })

  it('effortTodayMinutes sums overdue + due-today efforts; undefined when nothing has effort', () => {
    const overdue = makeTask({ deadline: hard('2026-07-01'), effort: 'hour' }) // 60
    const today = makeTask({ deadline: soft('2026-07-02'), effort: 'half_day' }) // 240
    const week = makeTask({ deadline: soft('2026-07-03'), effort: 'multi_day' }) // not counted
    expect(buildBriefing([overdue, today, week], NOW).effortTodayMinutes).toBe(300)
    expect(buildBriefing([makeTask({ deadline: soft('2026-07-02') })], NOW).effortTodayMinutes).toBeUndefined()
  })
})

describe('renderBriefingDigest (LLM_PIPELINE §6 — labeled text, never raw JSON)', () => {
  it('busy day: STATUS line + only non-empty sections, with annotations and [high] markers', () => {
    const overdue = makeTask({ title: 'Fix revenue dashboard', deadline: hard('2026-06-30'), priority: 'high' })
    const today = makeTask({ title: 'Send vendor list to Sarah', deadline: hard('2026-07-02') })
    const week = makeTask({ title: 'Prep QBR deck', deadline: soft('2026-07-03'), priority: 'urgent' })
    const digest = renderBriefingDigest(buildBriefing([overdue, today, week], NOW))

    const lines = digest.split('\n')
    expect(lines[0]).toBe('STATUS: 1 overdue, 1 due today.')
    expect(lines[1]).toBe('OVERDUE (1): Fix revenue dashboard (2 days overdue) [high]')
    expect(lines[2]).toBe('DUE TODAY (1): Send vendor list to Sarah')
    expect(lines[3]).toBe('THIS WEEK (1): Prep QBR deck [high]') // urgent also marks [high]
    expect(digest).not.toContain('STALLED')
    expect(digest).not.toContain('(0)')
  })

  it('clear day: clear STATUS line, empty sections omitted entirely', () => {
    const week = makeTask({ title: 'Tidy the wiki', deadline: soft('2026-07-03') })
    const digest = renderBriefingDigest(buildBriefing([week], NOW))
    expect(digest.split('\n')).toEqual([
      'STATUS: nothing overdue and nothing due today — a clear day.',
      'THIS WEEK (1): Tidy the wiki'
    ])
  })

  it('stalled section carries the no-activity annotation', () => {
    const stalled = makeTask({ title: 'Refresh cost model', activityAt: new Date(2026, 5, 22, 9).toISOString() })
    const digest = renderBriefingDigest(buildBriefing([stalled], NOW))
    expect(digest).toContain('STALLED (1): Refresh cost model (no activity for 8 days)')
  })

  it('multiple tasks in a section join with semicolons', () => {
    const a = makeTask({ title: 'Alpha', deadline: hard('2026-07-02') })
    const b = makeTask({ title: 'Beta', deadline: soft('2026-07-02') })
    const digest = renderBriefingDigest(buildBriefing([a, b], NOW))
    expect(digest).toContain('DUE TODAY (2): Alpha; Beta')
  })
})

describe('fallbackSynthesis (deterministic, DESIGN §8)', () => {
  const briefing = (counts: { dueToday?: number; overdue?: number; week?: number }): Briefing => ({
    dateKey: '2026-07-02',
    overdue: Array.from({ length: counts.overdue ?? 0 }, (_, i) => ({ id: `o${i}`, title: 'x', priority: 'normal' as const })),
    dueToday: Array.from({ length: counts.dueToday ?? 0 }, (_, i) => ({ id: `d${i}`, title: 'x', priority: 'normal' as const })),
    dueThisWeek: Array.from({ length: counts.week ?? 0 }, (_, i) => ({ id: `w${i}`, title: 'x', priority: 'normal' as const })),
    stalled: [],
    questions: []
  })

  it('renders the canonical busy-day string', () => {
    expect(fallbackSynthesis(briefing({ dueToday: 2, overdue: 1, week: 3 }))).toBe(
      '2 due today · 1 carried over · 3 this week.'
    )
  })

  it('omits empty parts', () => {
    expect(fallbackSynthesis(briefing({ overdue: 1 }))).toBe('1 carried over.')
    expect(fallbackSynthesis(briefing({ dueToday: 1, week: 2 }))).toBe('1 due today · 2 this week.')
  })

  it('all clear', () => {
    expect(fallbackSynthesis(briefing({}))).toBe('All clear this morning.')
  })
})
