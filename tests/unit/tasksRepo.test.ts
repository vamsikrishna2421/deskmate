/** TasksRepo behavior against a REAL tmp data dir: capture defaults + hints, provenance flips,
 *  FOCUS_STARS_MAX, provenance-aware enrichment merge, Q&A flows, read-only mode. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmTaskRaw } from '../../src/shared/types/enrichment'
import { FOCUS_STARS_MAX, SOURCE_TEXT_MAX } from '../../src/shared/constants'
import { TasksRepo, type TasksChange } from '../../src/main/store/tasksRepo'

const T0 = new Date(2026, 6, 2, 9, 0) // Thursday 2026-07-02
const T1 = new Date(2026, 6, 2, 10, 0)
const T2 = new Date(2026, 6, 2, 11, 0)

function llm(over: Partial<LlmTaskRaw> = {}): LlmTaskRaw {
  return {
    title: 'Rebuild churn numbers for VP readout',
    summary: 'Rebuild the churn numbers; they feed the VP readout.',
    deadline: 'friday',
    deadline_type: 'hard',
    priority: 'medium',
    effort: 'half-day',
    subtasks: [],
    tags: ['churn', 'reporting'],
    clarifying_questions: [],
    ...over
  }
}

let dir: string
let repo: TasksRepo

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sill-repo-'))
  repo = await TasksRepo.load(dir)
})

afterEach(async () => {
  await repo.flush().catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

const capture = (text = 'need the churn numbers rebuilt by friday'): ReturnType<TasksRepo['createFromCapture']> =>
  repo.createFromCapture({ sourceText: text, sourceKind: 'paste' }, T0)

describe('createFromCapture', () => {
  it('creates a raw inbox card with LLM-owned provenance and pending enrichment', () => {
    const t = capture('line one of the paste\nline two')
    expect(t.title).toBe('line one of the paste')
    expect(t.status).toBe('inbox')
    expect(t.summary).toBeUndefined()
    expect(t.deadline).toEqual({ kind: 'none', source: 'llm' })
    expect(t.priority).toBe('normal')
    expect(t.tags).toEqual([])
    expect(t.provenance).toEqual({ title: 'llm', summary: 'llm', priority: 'llm', effort: 'llm', tags: 'llm' })
    expect(t.enrichment).toEqual({ status: 'pending', attempts: 0 })
    expect(t.focus).toBe(false)
    expect(t.pinned).toBe(false)
    expect(t.createdAt).toBe(T0.toISOString())
    expect(t.activityAt).toBe(T0.toISOString())
  })

  it('clamps the provisional title to 80 chars and the stored source to SOURCE_TEXT_MAX', () => {
    const long = 'x'.repeat(SOURCE_TEXT_MAX + 500)
    const t = capture(long)
    expect(t.title).toHaveLength(80)
    expect(t.sourceText).toHaveLength(SOURCE_TEXT_MAX)
  })

  it('rejects empty capture text', () => {
    expect(() => capture('   \n  ')).toThrow()
  })

  it('hint today → user-owned soft deadline today', () => {
    const t = repo.createFromCapture(
      { sourceText: 'ship it', sourceKind: 'typed', hints: { deadline: 'today' } },
      T0
    )
    expect(t.deadline).toEqual({ kind: 'soft', dueDate: '2026-07-02', source: 'user' })
  })

  it('hint week → the coming Friday; hard kind hint respected', () => {
    const t = repo.createFromCapture(
      { sourceText: 'ship it', sourceKind: 'typed', hints: { deadline: 'week', kind: 'hard' } },
      T0
    )
    expect(t.deadline).toEqual({ kind: 'hard', dueDate: '2026-07-03', source: 'user' })
  })

  it('hint later → user-owned "none" (locks the deadline against the LLM)', () => {
    const t = repo.createFromCapture(
      { sourceText: 'ship it', sourceKind: 'typed', hints: { deadline: 'later' } },
      T0
    )
    expect(t.deadline).toEqual({ kind: 'none', source: 'user' })
  })

  it('tag hints lock tags as user-owned (normalized + deduped)', () => {
    const t = repo.createFromCapture(
      { sourceText: 'ship it', sourceKind: 'typed', hints: { tags: ['Finance', ' finance ', 'q3'] } },
      T0
    )
    expect(t.tags).toEqual(['finance', 'q3'])
    expect(t.provenance.tags).toBe('user')
  })
})

describe('updateFromUser', () => {
  it('flips provenance only for the fields provided', () => {
    const t = capture()
    const next = repo.updateFromUser(t.id, { title: 'My own title', priority: 'urgent' }, T1)
    expect(next.title).toBe('My own title')
    expect(next.priority).toBe('urgent')
    expect(next.provenance.title).toBe('user')
    expect(next.provenance.priority).toBe('user')
    expect(next.provenance.summary).toBe('llm')
    expect(next.provenance.effort).toBe('llm')
    expect(next.provenance.tags).toBe('llm')
    expect(next.updatedAt).toBe(T1.toISOString())
    expect(next.activityAt).toBe(T1.toISOString())
  })

  it('user deadline patch becomes user-owned; kind none clears date fields', () => {
    const t = capture()
    const dated = repo.updateFromUser(t.id, { deadline: { kind: 'hard', dueDate: '2026-07-09', dueTime: '17:00' } }, T1)
    expect(dated.deadline).toMatchObject({ kind: 'hard', dueDate: '2026-07-09', dueTime: '17:00', source: 'user' })
    const cleared = repo.updateFromUser(t.id, { deadline: { kind: 'none' } }, T2)
    expect(cleared.deadline.dueDate).toBeUndefined()
    expect(cleared.deadline.dueTime).toBeUndefined()
    expect(cleared.deadline.kind).toBe('none')
    expect(cleared.deadline.source).toBe('user')
  })

  it('rejects unreal dates and malformed times', () => {
    const t = capture()
    expect(() => repo.updateFromUser(t.id, { deadline: { dueDate: '2026-02-30' } }, T1)).toThrow(/dueDate/)
    expect(() => repo.updateFromUser(t.id, { deadline: { dueTime: '25:00' } }, T1)).toThrow(/dueTime/)
  })

  it('enforces FOCUS_STARS_MAX across live tasks; done tasks free a slot', () => {
    const tasks = Array.from({ length: FOCUS_STARS_MAX + 1 }, (_, i) => capture(`task ${i}`))
    for (let i = 0; i < FOCUS_STARS_MAX; i++) {
      repo.updateFromUser(tasks[i].id, { focus: true }, T1)
    }
    expect(() => repo.updateFromUser(tasks[FOCUS_STARS_MAX].id, { focus: true }, T1)).toThrow(/focus limit/)
    repo.setStatus(tasks[0].id, 'done', T1)
    expect(() => repo.updateFromUser(tasks[FOCUS_STARS_MAX].id, { focus: true }, T2)).not.toThrow()
  })

  it('status done stamps completedAt; reopening clears it', () => {
    const t = capture()
    const done = repo.setStatus(t.id, 'done', T1)
    expect(done.completedAt).toBe(T1.toISOString())
    const reopened = repo.setStatus(t.id, 'open', T2)
    expect(reopened.completedAt).toBeUndefined()
  })
})

describe('applyEnrichment — provenance-aware merge', () => {
  it('writes LLM-owned fields, maps vocabularies, resolves the deadline from capture time', () => {
    const t = capture()
    const merged = repo.applyEnrichment(t.id, llm(), T0, T1)
    expect(merged).toBeDefined()
    if (!merged) return
    expect(merged.title).toBe('Rebuild churn numbers for VP readout')
    expect(merged.summary).toBe('Rebuild the churn numbers; they feed the VP readout.')
    expect(merged.priority).toBe('normal') // medium → normal
    expect(merged.effort).toBe('half_day')
    expect(merged.tags).toEqual(['churn', 'reporting'])
    expect(merged.deadline).toMatchObject({ kind: 'hard', dueDate: '2026-07-03', source: 'llm', rawToken: 'friday' })
    expect(merged.status).toBe('open') // inbox → open
    expect(merged.enrichment.status).toBe('done')
    expect(merged.enrichment.needsReview).toBeUndefined()
    expect(merged.updatedAt).toBe(T1.toISOString())
    expect(merged.activityAt).toBe(T0.toISOString()) // enrichment is not a user touch
  })

  it('never clobbers user-owned fields or a user-set deadline', () => {
    const t = capture()
    repo.updateFromUser(t.id, { title: 'User title', tags: ['mine'] }, T1)
    repo.updateFromUser(t.id, { deadline: { kind: 'soft', dueDate: '2026-07-20' } }, T1)
    const merged = repo.applyEnrichment(t.id, llm({ deadline: 'tomorrow', deadline_type: 'hard' }), T0, T2)
    if (!merged) throw new Error('task missing')
    expect(merged.title).toBe('User title')
    expect(merged.tags).toEqual(['mine'])
    expect(merged.deadline).toMatchObject({ kind: 'soft', dueDate: '2026-07-20', source: 'user' })
    expect(merged.summary).toBe(llm().summary) // still LLM-owned → written
  })

  it('appends subtasks deduped by normalized text and caps at 5', () => {
    const t = capture()
    repo.applyEnrichment(t.id, llm({ subtasks: ['Pull FX table', 'Rerun numbers'] }), T0, T1)
    const merged = repo.applyEnrichment(
      t.id,
      llm({ subtasks: ['pull fx table!!', 'Re-validate output', 'Ship report', 'Extra one', 'Extra two'] }),
      T0,
      T2
    )
    if (!merged) throw new Error('task missing')
    expect(merged.subtasks.map((s) => s.title)).toEqual([
      'Pull FX table',
      'Rerun numbers',
      'Re-validate output',
      'Ship report',
      'Extra one'
    ])
    expect(merged.subtasks).toHaveLength(5)
    expect(merged.subtasks.every((s) => s.source === 'llm' && !s.done)).toBe(true)
  })

  it('appends questions deduped by normalized text', () => {
    const t = capture()
    repo.applyEnrichment(t.id, llm({ clarifying_questions: ['Which quarter?'] }), T0, T1)
    const merged = repo.applyEnrichment(
      t.id,
      llm({ clarifying_questions: ['which quarter', 'Send to whom?'] }),
      T0,
      T2
    )
    if (!merged) throw new Error('task missing')
    expect(merged.questions.map((q) => q.question)).toEqual(['Which quarter?', 'Send to whom?'])
  })

  it('unresolvable-but-dated deadline → kind none + needsReview', () => {
    const t = capture()
    const merged = repo.applyEnrichment(t.id, llm({ deadline: '2026-02-30', deadline_type: 'hard' }), T0, T1)
    if (!merged) throw new Error('task missing')
    expect(merged.deadline.kind).toBe('none')
    expect(merged.deadline.dueDate).toBeUndefined()
    expect(merged.enrichment.needsReview).toBe(true)
  })

  it('returns undefined for unknown ids', () => {
    expect(repo.applyEnrichment('nope', llm(), T0, T1)).toBeUndefined()
  })
})

describe('question flows', () => {
  it('answerQuestion → answered + qaHistory record', () => {
    const t = capture()
    const enriched = repo.applyEnrichment(t.id, llm({ clarifying_questions: ['By when?'] }), T0, T1)
    const qid = enriched?.questions[0].id as string
    const answered = repo.answerQuestion(t.id, qid, 'Friday please', T2)
    expect(answered.questions[0]).toMatchObject({ status: 'answered', answer: 'Friday please' })
    expect(answered.qaHistory).toEqual([{ question: 'By when?', answer: 'Friday please', at: T2.toISOString() }])
    expect(() => repo.answerQuestion(t.id, 'missing-q', 'x', T2)).toThrow()
    expect(() => repo.answerQuestion(t.id, qid, '   ', T2)).toThrow()
  })

  it('dismissQuestion remembers the text and re-enrichment never re-asks it', () => {
    const t = capture()
    const enriched = repo.applyEnrichment(t.id, llm({ clarifying_questions: ['Which report?'] }), T0, T1)
    const qid = enriched?.questions[0].id as string
    const dismissed = repo.dismissQuestion(t.id, qid, T1)
    expect(dismissed.questions[0].status).toBe('dismissed')
    expect(dismissed.dismissedQuestionTexts).toEqual(['Which report?'])
    // Same question back from the model, different casing/punctuation → never re-added.
    const merged = repo.applyEnrichment(t.id, llm({ clarifying_questions: ['which report'] }), T0, T2)
    if (!merged) throw new Error('task missing')
    expect(merged.questions).toHaveLength(1)
    expect(merged.questions[0].status).toBe('dismissed')
  })

  it('toggleSubtask flips done and errors on unknown ids', () => {
    const t = capture()
    repo.applyEnrichment(t.id, llm({ subtasks: ['step one'] }), T0, T1)
    const sid = repo.get(t.id)?.subtasks[0].id as string
    expect(repo.toggleSubtask(t.id, sid, T2).subtasks[0].done).toBe(true)
    expect(repo.toggleSubtask(t.id, sid, T2).subtasks[0].done).toBe(false)
    expect(() => repo.toggleSubtask(t.id, 'nope', T2)).toThrow()
  })
})

describe('change events, deletion, persistence', () => {
  it('emits upserted deltas and delete emits deletedIds; unsubscribe works', () => {
    const changes: TasksChange[] = []
    const off = repo.onChange((c) => changes.push(c))
    const t = capture()
    expect(changes.at(-1)).toEqual({ upserted: [t], deletedIds: [] })
    repo.delete(t.id, T1)
    expect(changes.at(-1)).toEqual({ upserted: [], deletedIds: [t.id] })
    expect(repo.get(t.id)).toBeUndefined()
    off()
    capture('another')
    expect(changes).toHaveLength(2)
  })

  it('round-trips through disk: flush + reload preserves tasks', async () => {
    const t = capture()
    repo.updateFromUser(t.id, { title: 'Persisted title', focus: true }, T1)
    await repo.flush()
    const reloaded = await TasksRepo.load(dir)
    const back = reloaded.get(t.id)
    expect(back).toBeDefined()
    expect(back?.title).toBe('Persisted title')
    expect(back?.focus).toBe(true)
    expect(back?.provenance.title).toBe('user')
  })
})

describe('read-only mode (future on-disk schema)', () => {
  it('refuses user mutations, allows in-memory system merges, never persists', async () => {
    const roDir = await mkdtemp(join(tmpdir(), 'sill-repo-ro-'))
    try {
      await mkdir(roDir, { recursive: true })
      const seed = capture('seed task for readonly test')
      const fileBody = JSON.stringify({ schemaVersion: 99, tasks: [seed] })
      await writeFile(join(roDir, 'tasks.json'), fileBody, 'utf8')

      const ro = await TasksRepo.load(roDir)
      expect(ro.readOnly).toBe(true)
      expect(ro.list()).toHaveLength(1)
      expect(() => ro.createFromCapture({ sourceText: 'nope', sourceKind: 'typed' }, T0)).toThrow(/read-only/)
      expect(() => ro.updateFromUser(seed.id, { title: 'x' }, T0)).toThrow(/read-only/)
      expect(() => ro.delete(seed.id, T0)).toThrow(/read-only/)

      // System merge works in memory…
      const merged = ro.applyEnrichment(seed.id, llm(), T0, T1)
      expect(merged?.enrichment.status).toBe('done')
      // …but nothing is written back.
      await ro.flush()
      expect(await readFile(join(roDir, 'tasks.json'), 'utf8')).toBe(fileBody)
    } finally {
      await rm(roDir, { recursive: true, force: true })
    }
  })
})
