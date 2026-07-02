/** Enrichment pipeline (src/main/enrichment/pipeline.ts) with a scripted OllamaClient and REAL
 *  repos in a tmp dir: raw-card-first, retry-once-then-degrade, multi-task fan-out, locked-field
 *  re-copy on re-enrich, junk-input policy, pause/hold. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LlmTaskRaw } from '@shared/types/enrichment'
import { TasksRepo } from '../../src/main/store/tasksRepo'
import { AppStateRepo } from '../../src/main/store/appStateRepo'
import { RequestQueue } from '../../src/main/llm/requestQueue'
import type { OllamaClient } from '../../src/main/llm/ollamaClient'
import { EXTRACTION_FORMAT, SINGLE_TASK_FORMAT } from '../../src/main/llm/prompts'
import { capPaste, EnrichmentPipeline } from '../../src/main/enrichment/pipeline'
import { PASTE_CAP_TOTAL, PASTE_TRIM_MARKER } from '@shared/constants'

const T0 = new Date(2026, 6, 2, 9, 0) // Thursday 2026-07-02

interface ChatCall {
  model: string
  system: string
  user: string
  format?: object
  temperature: number
  numPredict: number
}

class FakeOllama {
  calls: ChatCall[] = []
  responses: Array<string | Promise<string>> = []

  async health(): Promise<boolean> {
    return true
  }
  async listModels(): Promise<string[]> {
    return ['qwen2.5:3b']
  }
  async pickModel(): Promise<string | undefined> {
    return 'qwen2.5:3b'
  }
  status(): { reachable: boolean; models: string[]; activeModel?: string } {
    return { reachable: true, models: ['qwen2.5:3b'], activeModel: 'qwen2.5:3b' }
  }
  onStatusChange(): () => void {
    return () => undefined
  }
  async chat(opts: ChatCall & { timeoutMs: number; signal?: AbortSignal }): Promise<string> {
    this.calls.push({
      model: opts.model,
      system: opts.system,
      user: opts.user,
      format: opts.format,
      temperature: opts.temperature,
      numPredict: opts.numPredict
    })
    const next = this.responses.shift()
    if (next === undefined) throw new Error('FakeOllama: no scripted response left')
    return next
  }
}

function llm(over: Partial<LlmTaskRaw> = {}): LlmTaskRaw {
  return {
    title: 'Send top-20 vendor list to Sarah',
    summary: 'Sarah asked for the top-20 vendor list.',
    deadline: 'friday',
    deadline_type: 'hard',
    priority: 'medium',
    effort: '15min',
    subtasks: [],
    tags: ['vendors'],
    clarifying_questions: [],
    ...over
  }
}

const extraction = (...tasks: LlmTaskRaw[]): string => JSON.stringify({ tasks })

interface Push {
  taskId: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error?: string
}

interface Ctx {
  dir: string
  tasksRepo: TasksRepo
  appStateRepo: AppStateRepo
  fake: FakeOllama
  queue: RequestQueue
  pipeline: EnrichmentPipeline
  pushes: Push[]
  waitStatus: (taskId: string, status: Push['status']) => Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

async function makeCtx(): Promise<Ctx> {
  const dir = await mkdtemp(join(tmpdir(), 'sill-pipe-'))
  const tasksRepo = await TasksRepo.load(dir)
  const appStateRepo = await AppStateRepo.load(dir)
  const fake = new FakeOllama()
  const queue = new RequestQueue()
  const pushes: Push[] = []
  const pipeline = new EnrichmentPipeline({
    tasksRepo,
    appStateRepo,
    client: fake as unknown as OllamaClient,
    queue,
    pushEnrichment: (p) => pushes.push(p),
    now: () => T0
  })
  const waitStatus = (taskId: string, status: Push['status']): Promise<void> =>
    vi.waitFor(
      () => {
        if (!pushes.some((p) => p.taskId === taskId && p.status === status)) {
          throw new Error(`no ${status} push for ${taskId} yet`)
        }
      },
      { timeout: 3000, interval: 10 }
    )
  cleanups.push(async () => {
    await tasksRepo.flush().catch(() => undefined)
    await appStateRepo.flush().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, tasksRepo, appStateRepo, fake, queue, pipeline, pushes, waitStatus }
}

afterEach(async () => {
  while (cleanups.length) await (cleanups.pop() as () => Promise<void>)()
})

describe('capPaste', () => {
  it('passes short pastes through and trims oversized ones head+tail with the marker', () => {
    expect(capPaste('short')).toBe('short')
    const big = 'a'.repeat(7000) + 'MIDDLE' + 'b'.repeat(7000)
    const capped = capPaste(big)
    expect(big.length).toBeGreaterThan(PASTE_CAP_TOTAL)
    expect(capped).toContain(PASTE_TRIM_MARKER)
    expect(capped.startsWith('a'.repeat(100))).toBe(true)
    expect(capped.endsWith('b'.repeat(100))).toBe(true)
    expect(capped).not.toContain('MIDDLE')
  })
})

describe('extraction', () => {
  it('the raw card exists and stays fully intact while the LLM is still thinking', async () => {
    const ctx = await makeCtx()
    let release!: (v: string) => void
    ctx.fake.responses.push(new Promise<string>((r) => (release = r)))

    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'need the top-20 vendor list for Sarah by friday', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueExtraction(task)

    await vi.waitFor(() => {
      if (ctx.fake.calls.length !== 1) throw new Error('chat not started')
    })
    const during = ctx.tasksRepo.get(task.id)
    expect(during?.title).toBe('need the top-20 vendor list for Sarah by friday')
    expect(during?.enrichment.status).toBe('running')
    expect(ctx.pushes.filter((p) => p.taskId === task.id).map((p) => p.status)).toEqual(['queued', 'running'])

    release(extraction(llm()))
    await ctx.waitStatus(task.id, 'done')
    const after = ctx.tasksRepo.get(task.id)
    expect(after?.title).toBe('Send top-20 vendor list to Sarah')
    expect(after?.priority).toBe('normal')
    expect(after?.effort).toBe('minutes')
    expect(after?.status).toBe('open')
    // Deadline anchored at CAPTURE time, resolved deterministically: friday → 2026-07-03.
    expect(after?.deadline).toMatchObject({ kind: 'hard', dueDate: '2026-07-03', rawToken: 'friday' })
    expect(ctx.fake.calls[0].format).toBe(EXTRACTION_FORMAT)
    expect(ctx.fake.calls[0].system).toContain('Thursday, 2026-07-02')
    expect(ctx.fake.calls[0].temperature).toBeCloseTo(0.15)
  })

  it('invalid deadline token → one STRICT retry at temperature 0 → degrade to raw, task untouched', async () => {
    const ctx = await makeCtx()
    const bad = extraction(llm({ deadline: 'no deadline mentioned' } as unknown as Partial<LlmTaskRaw>))
    ctx.fake.responses.push(bad, bad)

    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'rebuild the churn dashboard for the leadership readout', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueExtraction(task)
    await ctx.waitStatus(task.id, 'failed')

    expect(ctx.fake.calls).toHaveLength(2)
    expect(ctx.fake.calls[0].system).not.toContain('STRICT:')
    expect(ctx.fake.calls[1].system).toContain('STRICT: your previous output was invalid')
    expect(ctx.fake.calls[1].system).toContain('deadline')
    expect(ctx.fake.calls[1].temperature).toBe(0)

    const after = ctx.tasksRepo.get(task.id)
    expect(after?.title).toBe('rebuild the churn dashboard for the leadership readout') // never overwritten
    expect(after?.status).toBe('inbox')
    expect(after?.enrichment.status).toBe('failed')
    expect(after?.enrichment.attempts).toBe(2)
    expect(after?.enrichment.needsReview).toBe(true)
    expect(after?.enrichment.error).toContain('deadline')
    const statuses = ctx.pushes.filter((p) => p.taskId === task.id).map((p) => p.status)
    expect(statuses).toEqual(['queued', 'running', 'failed'])
  })

  it('multi-task extraction enriches the original and creates one card per extra task', async () => {
    const ctx = await makeCtx()
    const second = llm({
      title: 'Tidy up the team wiki',
      summary: 'Nice-to-have wiki cleanup.',
      deadline: 'none',
      deadline_type: 'none',
      priority: 'optional',
      effort: '1hour',
      tags: ['wiki']
    })
    ctx.fake.responses.push(extraction(llm(), second))

    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'vendor list for Sarah by friday, and tidy the wiki whenever', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueExtraction(task)
    await ctx.waitStatus(task.id, 'done')
    await vi.waitFor(() => {
      if (ctx.tasksRepo.list().length !== 2) throw new Error('extra card not created yet')
    })

    const original = ctx.tasksRepo.get(task.id)
    expect(original?.title).toBe('Send top-20 vendor list to Sarah')
    const extra = ctx.tasksRepo.list().find((t) => t.id !== task.id)
    expect(extra?.title).toBe('Tidy up the team wiki')
    expect(extra?.priority).toBe('optional')
    expect(extra?.sourceText).toBe(task.sourceText) // extras share the raw capture
    expect(extra?.enrichment.status).toBe('done')
    expect(extra?.deadline.kind).toBe('none')
    expect(ctx.pushes.some((p) => p.taskId === extra?.id && p.status === 'done')).toBe(true)
    expect(ctx.fake.calls).toHaveLength(1) // one LLM round produced both cards
  })

  it('junk input (≤40 chars) with empty tasks[] → done + "nothing actionable found", no retry', async () => {
    const ctx = await makeCtx()
    ctx.fake.responses.push('{"tasks": []}')
    const task = ctx.tasksRepo.createFromCapture({ sourceText: 'lol ok thanks', sourceKind: 'paste' }, T0)
    ctx.pipeline.enqueueExtraction(task)
    await ctx.waitStatus(task.id, 'done')

    expect(ctx.fake.calls).toHaveLength(1)
    const after = ctx.tasksRepo.get(task.id)
    expect(after?.enrichment.status).toBe('done')
    expect(after?.enrichment.error).toBe('nothing actionable found')
    expect(after?.enrichment.needsReview).toBe(true)
    expect(after?.title).toBe('lol ok thanks') // raw card kept
    expect(after?.status).toBe('inbox')
  })

  it('substantive input with empty tasks[] is a hard failure → retried once, then degrades to failed (retry affordance stays alive, LLM_PIPELINE §7)', async () => {
    const ctx = await makeCtx()
    ctx.fake.responses.push('{"tasks": []}', '{"tasks": []}')
    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'please rebuild the vendor spend numbers before the QBR on wednesday', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueExtraction(task)
    await ctx.waitStatus(task.id, 'failed')

    expect(ctx.fake.calls).toHaveLength(2)
    expect(ctx.fake.calls[1].system).toContain('STRICT:')
    const after = ctx.tasksRepo.get(task.id)
    expect(after?.enrichment).toMatchObject({ status: 'failed', error: 'nothing actionable found', needsReview: true })
  })
})

describe('re-enrichment', () => {
  it('re-copies locked fields in code over disobedient LLM output; answers ride the user message', async () => {
    const ctx = await makeCtx()
    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'send the vendor list to Sarah', sourceKind: 'paste' },
      T0
    )
    const enriched = ctx.tasksRepo.applyEnrichment(
      task.id,
      llm({ deadline: 'none', deadline_type: 'none', priority: 'medium', clarifying_questions: ['When does Sarah need the list?'] }),
      T0,
      T0
    )
    const qid = enriched?.questions[0].id as string
    // User locks priority and the deadline by hand.
    ctx.tasksRepo.updateFromUser(task.id, { priority: 'low' }, T0)
    ctx.tasksRepo.updateFromUser(task.id, { deadline: { kind: 'hard', dueDate: '2026-07-09' } }, T0)
    ctx.tasksRepo.answerQuestion(task.id, qid, 'she needs it Monday morning', T0)

    // The model disobeys the locks: new priority, new deadline, new title.
    ctx.fake.responses.push(
      JSON.stringify(
        llm({ title: 'Send vendor list to Sarah by Monday', priority: 'high', deadline: 'monday', deadline_type: 'hard' })
      )
    )
    ctx.pipeline.enqueueReenrich(task.id)
    await ctx.waitStatus(task.id, 'done')

    const call = ctx.fake.calls[0]
    expect(call.format).toBe(SINGLE_TASK_FORMAT)
    expect(call.system).toContain('You update ONE existing task')
    expect(call.user).toContain('CURRENT TASK:')
    expect(call.user).toContain('LOCKED FIELDS (copy unchanged): ["priority","deadline"]')
    expect(call.user).toContain('Q: When does Sarah need the list?')
    expect(call.user).toContain('A: she needs it Monday morning')
    // The stored explicit date rides in the CURRENT TASK block — stable round-trip.
    expect(call.user).toContain('2026-07-09')

    const after = ctx.tasksRepo.get(task.id)
    expect(after?.priority).toBe('low') // locked in code, model ignored
    expect(after?.deadline).toMatchObject({ kind: 'hard', dueDate: '2026-07-09', source: 'user' })
    expect(after?.title).toBe('Send vendor list to Sarah by Monday') // unlocked field updated
    expect(after?.enrichment.status).toBe('done')
    expect(after?.qaHistory).toHaveLength(1) // raw Q&A safety net intact
  })

  it('re-enrich on a task with no answered Q&A falls back to plain re-extraction', async () => {
    const ctx = await makeCtx()
    ctx.fake.responses.push(extraction(llm()))
    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'need the vendor list rebuilt for Sarah', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueReenrich(task.id)
    await ctx.waitStatus(task.id, 'done')
    expect(ctx.fake.calls[0].format).toBe(EXTRACTION_FORMAT)
  })
})

describe('pause', () => {
  it('holds task jobs while paused and replays them on unpause', async () => {
    const ctx = await makeCtx()
    ctx.fake.responses.push(extraction(llm()))
    ctx.pipeline.setPaused(true)

    const task = ctx.tasksRepo.createFromCapture(
      { sourceText: 'vendor list for Sarah please', sourceKind: 'paste' },
      T0
    )
    ctx.pipeline.enqueueExtraction(task)
    expect(ctx.pushes.filter((p) => p.taskId === task.id).map((p) => p.status)).toEqual(['queued'])
    await new Promise((r) => setTimeout(r, 50))
    expect(ctx.fake.calls).toHaveLength(0)
    expect(ctx.tasksRepo.get(task.id)?.enrichment.status).toBe('pending')

    ctx.pipeline.setPaused(false)
    await ctx.waitStatus(task.id, 'done')
    expect(ctx.fake.calls).toHaveLength(1)
    expect(ctx.tasksRepo.get(task.id)?.title).toBe('Send top-20 vendor list to Sarah')
  })
})
