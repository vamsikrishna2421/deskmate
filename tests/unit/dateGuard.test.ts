/** Impossible-date guard (src/shared/llm/dateGuard.ts): detection patterns and the
 *  post-extraction deadline-clearing / question-injection behavior. */

import { describe, expect, it } from 'vitest'
import { findImpossibleDatePhrases, guardImpossibleDates } from '../../src/shared/llm/dateGuard'
import type { LlmTaskRaw } from '../../src/shared/types/enrichment'

function task(over: Partial<LlmTaskRaw> = {}): LlmTaskRaw {
  return {
    title: 'Do the thing',
    summary: 'Do the thing.',
    deadline: 'friday',
    deadline_type: 'hard',
    priority: 'medium',
    effort: '1hour',
    subtasks: [],
    tags: [],
    clarifying_questions: [],
    ...over
  }
}

describe('findImpossibleDatePhrases', () => {
  it('flags impossible month-day phrases in both orders', () => {
    expect(findImpossibleDatePhrases('due by Feb 30, firm')).toEqual(['Feb 30'])
    expect(findImpossibleDatePhrases('needs to ship June 31st')).toEqual(['June 31st'])
    expect(findImpossibleDatePhrases('the 31st of September works')).toEqual(['31st of September'])
    expect(findImpossibleDatePhrases('November 31 deadline')).toEqual(['November 31'])
  })

  it('flags numeric dates only when no reading is a real date', () => {
    expect(findImpossibleDatePhrases('by 6/31 please')).toEqual(['6/31'])
    expect(findImpossibleDatePhrases('by 12/31 please')).toEqual([])
    expect(findImpossibleDatePhrases('by 31/12/2026')).toEqual([])
  })

  it('flags day ordinals that exist in no month', () => {
    expect(findImpossibleDatePhrases('due the 32nd')).toEqual(['the 32nd'])
    expect(findImpossibleDatePhrases('due the 21st')).toEqual([])
  })

  it('accepts real dates, Feb 29, and month names without days', () => {
    expect(findImpossibleDatePhrases('due March 15, or Feb 29 next year')).toEqual([])
    expect(findImpossibleDatePhrases('sometime in June, maybe July 31')).toEqual([])
  })

  it('dedupes repeated phrases', () => {
    expect(findImpossibleDatePhrases('Feb 30! I said Feb 30!')).toEqual(['Feb 30'])
  })
})

describe('guardImpossibleDates', () => {
  it('clears the deadline and injects a question when one task carries the date', () => {
    const [out] = guardImpossibleDates([task()], ['June 31st'])
    expect(out.deadline).toBe('none')
    expect(out.deadline_type).toBe('none')
    expect(out.clarifying_questions[0]).toContain('June 31st')
    expect(out.clarifying_questions[0]).toContain("isn't a real calendar date")
  })

  it('keeps deadlines but asks when several tasks carry deadlines (ambiguous attribution)', () => {
    const tasks = [task({ title: 'A' }), task({ title: 'B', deadline: 'monday' })]
    const out = guardImpossibleDates(tasks, ['Feb 30'])
    expect(out[0].deadline).toBe('friday')
    expect(out[0].clarifying_questions).toHaveLength(1)
    expect(out[1].deadline).toBe('monday')
    expect(out[1].clarifying_questions).toHaveLength(0)
  })

  it('targets the deadline-bearing task, not the first task', () => {
    const tasks = [task({ title: 'A', deadline: 'none', deadline_type: 'none' }), task({ title: 'B' })]
    const out = guardImpossibleDates(tasks, ['Feb 30'])
    expect(out[0].clarifying_questions).toHaveLength(0)
    expect(out[1].deadline).toBe('none')
    expect(out[1].clarifying_questions).toHaveLength(1)
  })

  it('never duplicates the question and respects the 3-question cap', () => {
    const t = task({ clarifying_questions: ['q1', 'q2', 'q3'] })
    const [out] = guardImpossibleDates([t], ['Feb 30'])
    expect(out.clarifying_questions).toHaveLength(3)
    expect(out.clarifying_questions[0]).toContain('Feb 30')
    const again = guardImpossibleDates([out], ['Feb 30'])
    expect(again[0].clarifying_questions).toHaveLength(3)
  })

  it('is a no-op with no phrases or no tasks', () => {
    const t = task()
    expect(guardImpossibleDates([t], [])[0]).toBe(t)
    expect(guardImpossibleDates([], ['Feb 30'])).toEqual([])
  })
})
