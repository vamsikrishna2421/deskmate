/** LLM output validation + repair (src/shared/llm/coerceParse.ts, docs/LLM_PIPELINE.md §7). */

import { describe, expect, it } from 'vitest'
import type { LlmTaskRaw } from '@shared/types/enrichment'
import {
  coerceBriefing,
  coerceExtraction,
  coerceSingleTask,
  extractJson
} from '@shared/llm/coerceParse'

function raw(over: Partial<Record<keyof LlmTaskRaw, unknown>> = {}): Record<string, unknown> {
  return {
    title: 'Rebuild churn numbers for VP readout',
    summary: 'Rebuild the churn numbers by Tuesday.',
    deadline: 'tuesday',
    deadline_type: 'hard',
    priority: 'high',
    effort: 'half-day',
    subtasks: [],
    tags: ['churn'],
    clarifying_questions: [],
    ...over
  }
}

const extraction = (...tasks: unknown[]): string => JSON.stringify({ tasks })

describe('coerceExtraction — valid input', () => {
  it('passes a fully valid extraction with no repairs', () => {
    const res = coerceExtraction(extraction(raw()))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.repairs).toEqual([])
    expect(res.value.tasks).toHaveLength(1)
    expect(res.value.tasks[0]).toEqual({
      title: 'Rebuild churn numbers for VP readout',
      summary: 'Rebuild the churn numbers by Tuesday.',
      deadline: 'tuesday',
      deadline_type: 'hard',
      priority: 'high',
      effort: 'half-day',
      subtasks: [],
      tags: ['churn'],
      clarifying_questions: []
    })
  })

  it('empty tasks array is OK (junk-input policy is the pipeline’s call)', () => {
    const res = coerceExtraction('{"tasks": []}')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.tasks).toEqual([])
  })

  it('normalizes deadline case/whitespace', () => {
    const res = coerceExtraction(extraction(raw({ deadline: '  FRIDAY ' })))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.tasks[0].deadline).toBe('friday')
  })
})

describe('coerceExtraction — silent auto-repairs', () => {
  it('deadline "none" with a non-none type → type reset to none', () => {
    const res = coerceExtraction(extraction(raw({ deadline: 'none', deadline_type: 'hard' })))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks[0].deadline_type).toBe('none')
    expect(res.repairs.some((r) => r.includes('type reset to none'))).toBe(true)
  })

  it('dated deadline with type "none" → type reset to soft (the most common model slip)', () => {
    const res = coerceExtraction(extraction(raw({ deadline: 'friday', deadline_type: 'none' })))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks[0].deadline_type).toBe('soft')
    expect(res.repairs.some((r) => r.includes('type reset to soft'))).toBe(true)
  })

  it('junk effort → defaulted to 1hour', () => {
    const res = coerceExtraction(extraction(raw({ effort: 'three weeks' })))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks[0].effort).toBe('1hour')
    expect(res.repairs.some((r) => r.includes('effort'))).toBe(true)
  })

  it('empty summary → defaulted to title', () => {
    const res = coerceExtraction(extraction(raw({ summary: '   ' })))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.tasks[0].summary).toBe(res.value.tasks[0].title)
  })

  it('oversized arrays clamp: subtasks→5, tags→3 (lowercased), questions→3', () => {
    const res = coerceExtraction(
      extraction(
        raw({
          subtasks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          tags: ['Alpha', 'BETA', 'gamma', 'delta'],
          clarifying_questions: ['q1', 'q2', 'q3', 'q4']
        })
      )
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const t = res.value.tasks[0]
    expect(t.subtasks).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(t.tags).toEqual(['alpha', 'beta', 'gamma'])
    expect(t.clarifying_questions).toEqual(['q1', 'q2', 'q3'])
  })

  it('long strings clamp: title→120, subtask→140', () => {
    const res = coerceExtraction(extraction(raw({ title: 'T'.repeat(200), subtasks: ['s'.repeat(200)] })))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks[0].title).toHaveLength(120)
    expect(res.value.tasks[0].subtasks[0]).toHaveLength(140)
  })

  it('non-array subtasks/tags reset to [] with a repair note', () => {
    const res = coerceExtraction(extraction(raw({ subtasks: 'investigate', tags: 42 })))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks[0].subtasks).toEqual([])
    expect(res.value.tasks[0].tags).toEqual([])
  })

  it('more than 6 tasks → clamped to 6', () => {
    const res = coerceExtraction(extraction(...Array.from({ length: 8 }, () => raw())))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.tasks).toHaveLength(6)
    expect(res.repairs.some((r) => r.includes('clamped 8'))).toBe(true)
  })
})

describe('coerceExtraction — hard failures', () => {
  it('invalid deadline token → structured error naming the field', () => {
    const res = coerceExtraction(extraction(raw({ deadline: 'No specific deadline mentioned' })))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.some((e) => e.includes('deadline'))).toBe(true)
  })

  it('missing / empty / non-string title → hard error', () => {
    for (const title of [undefined, '', '   ', 42]) {
      const res = coerceExtraction(extraction(raw({ title })))
      expect(res.ok, JSON.stringify(title)).toBe(false)
      if (!res.ok) expect(res.errors.some((e) => e.includes('title'))).toBe(true)
    }
  })

  it('invalid priority ("urgent" is manual-only) and invalid deadline_type → hard errors', () => {
    expect(coerceExtraction(extraction(raw({ priority: 'urgent' }))).ok).toBe(false)
    expect(coerceExtraction(extraction(raw({ deadline_type: 'firm' }))).ok).toBe(false)
  })

  it('one bad task fails the whole extraction (partial results would drop asks)', () => {
    const res = coerceExtraction(extraction(raw(), raw({ title: '' })))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.some((e) => e.includes('tasks[1]'))).toBe(true)
  })

  it('garbage text → structured error for the repair pass', () => {
    const res = coerceExtraction('sorry, I cannot help with that')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors).toEqual(['response is not parseable JSON'])
  })

  it('JSON without a tasks array → structured error', () => {
    for (const body of ['{"result": []}', '{"tasks": {}}', '"just a string"', '[1,2]']) {
      const res = coerceExtraction(body)
      expect(res.ok, body).toBe(false)
    }
  })
})

describe('extractJson — prose-wrapped output', () => {
  it('extracts the outermost JSON object from prose and code fences', () => {
    const wrapped = 'Sure! Here is the JSON you asked for:\n```json\n{"tasks": []}\n```\nHope that helps.'
    expect(extractJson(wrapped)).toEqual({ tasks: [] })
    const res = coerceExtraction(`Here you go: ${extraction(raw())} — done!`)
    expect(res.ok).toBe(true)
  })

  it('returns undefined when nothing parses', () => {
    expect(extractJson('no braces here')).toBeUndefined()
    expect(extractJson('{ definitely not json }')).toBeUndefined()
  })
})

describe('coerceSingleTask (re-enrichment shape)', () => {
  it('accepts a bare task object', () => {
    const res = coerceSingleTask(JSON.stringify(raw({ deadline: 'monday', deadline_type: 'soft' })))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.deadline).toBe('monday')
  })

  it('repairs apply the same as in extraction', () => {
    const res = coerceSingleTask(JSON.stringify(raw({ deadline: 'none', deadline_type: 'soft' })))
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.deadline_type).toBe('none')
  })

  it('hard failures propagate', () => {
    expect(coerceSingleTask(JSON.stringify(raw({ title: '' }))).ok).toBe(false)
    expect(coerceSingleTask('not json').ok).toBe(false)
    expect(coerceSingleTask('[]').ok).toBe(false) // array is not a task object
  })
})

describe('coerceBriefing', () => {
  it('returns the trimmed sentence', () => {
    expect(coerceBriefing('{"briefing": "  A calm day ahead.  "}')).toBe('A calm day ahead.')
  })

  it('null on empty / missing / malformed', () => {
    expect(coerceBriefing('{"briefing": ""}')).toBeNull()
    expect(coerceBriefing('{"briefing": 42}')).toBeNull()
    expect(coerceBriefing('{"text": "hi"}')).toBeNull()
    expect(coerceBriefing('plain prose')).toBeNull()
  })

  it('tolerates prose-wrapped JSON', () => {
    expect(coerceBriefing('Output: {"briefing": "Two things due today."}')).toBe('Two things due today.')
  })
})
