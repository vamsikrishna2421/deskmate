/** Week-card stats (src/shared/weekCard.ts): week windowing, day buckets, people extraction. */

import { describe, expect, it } from 'vitest'
import { computeWeekStats, weekStart } from '../../src/shared/weekCard'
import type { Task } from '../../src/shared/types/task'

/** Wednesday 2026-07-08 — week runs Mon Jul 6 .. Sun Jul 12. */
const NOW = new Date('2026-07-08T15:00:00')

function done(title: string, completedAt: string, over: Partial<Task> = {}): Task {
  return {
    id: title,
    title,
    summary: title,
    sourceText: title,
    sourceKind: 'typed',
    status: 'done',
    deadline: { kind: 'none', source: 'user' },
    priority: 'normal',
    effort: 'hour',
    subtasks: [],
    tags: [],
    questions: [],
    qaHistory: [],
    provenance: {},
    enrichment: { status: 'done', attempts: 1 },
    pinned: false,
    focus: false,
    createdAt: '2026-07-06T09:00:00.000Z',
    updatedAt: completedAt,
    activityAt: completedAt,
    completedAt,
    ...over
  } as Task
}

describe('weekStart', () => {
  it('returns Monday for any weekday including Sunday', () => {
    expect(weekStart(new Date('2026-07-08T12:00:00')).getDay()).toBe(1)
    expect(weekStart(new Date('2026-07-12T23:00:00')).getDate()).toBe(6)
    expect(weekStart(new Date('2026-07-06T00:30:00')).getDate()).toBe(6)
  })
})

describe('computeWeekStats', () => {
  it('counts only this week and buckets by day', () => {
    const s = computeWeekStats(
      [
        done('Ship deck', '2026-07-06T10:00:00'),
        done('Fix bug', '2026-07-07T10:00:00'),
        done('Old thing', '2026-06-30T10:00:00'), // last week — excluded
        done('Second Tuesday', '2026-07-07T18:00:00')
      ],
      NOW
    )
    expect(s.doneCount).toBe(3)
    expect(s.byDay[0]).toBe(1) // Monday
    expect(s.byDay[1]).toBe(2) // Tuesday
    expect(s.busiestDay).toBe('Tuesday')
    expect(s.focusedMinutes).toBe(180)
  })

  it('extracts people from titles and skips weekday/month false positives', () => {
    const s = computeWeekStats(
      [
        done('Send top-20 vendor list to Priya', '2026-07-06T10:00:00'),
        done('Prepare notes for Sarah', '2026-07-07T10:00:00'),
        done('Move review to Friday', '2026-07-07T11:00:00')
      ],
      NOW
    )
    expect(s.peopleHelped).toEqual(['Priya', 'Sarah'])
  })

  it('counts hard deadlines hit and handles an empty week', () => {
    const hard = done('Board deck', '2026-07-06T10:00:00', {
      deadline: { kind: 'hard', dueDate: '2026-07-06', source: 'llm' } as Task['deadline']
    })
    expect(computeWeekStats([hard], NOW).hardDeadlinesHit).toBe(1)
    const empty = computeWeekStats([], NOW)
    expect(empty.doneCount).toBe(0)
    expect(empty.busiestDay).toBeUndefined()
  })
})
