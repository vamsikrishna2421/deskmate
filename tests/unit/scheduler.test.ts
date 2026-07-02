/** Scheduler gating (src/main/scheduler.ts): briefing once per local day behind the 4am gate,
 *  'Later' deferral, hidden-launch toast, persisted due-soon/overdue dedupe, soft-never-notifies.
 *  Injected clock; real repos in a tmp dir. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Briefing } from '../../src/shared/types/enrichment'
import { localDateKey } from '../../src/shared/dates/dayMath'
import { TasksRepo } from '../../src/main/store/tasksRepo'
import { AppStateRepo } from '../../src/main/store/appStateRepo'
import { Scheduler } from '../../src/main/scheduler'

interface Notice {
  title: string
  body: string
  taskId?: string
}

interface Ctx {
  dir: string
  tasksRepo: TasksRepo
  appStateRepo: AppStateRepo
  scheduler: Scheduler
  briefings: Briefing[]
  notices: Notice[]
  active: boolean
  clock: Date
}

const cleanups: Array<() => Promise<void>> = []

async function makeCtx(clock = new Date(2026, 6, 2, 9, 0)): Promise<Ctx> {
  const dir = await mkdtemp(join(tmpdir(), 'sill-sched-'))
  const tasksRepo = await TasksRepo.load(dir)
  const appStateRepo = await AppStateRepo.load(dir)
  const ctx: Ctx = {
    dir,
    tasksRepo,
    appStateRepo,
    briefings: [],
    notices: [],
    active: true,
    clock,
    scheduler: undefined as unknown as Scheduler
  }
  ctx.scheduler = new Scheduler({
    tasksRepo,
    appStateRepo,
    onBriefing: (b) => ctx.briefings.push(b),
    notify: (n) => ctx.notices.push(n),
    isWindowActive: () => ctx.active,
    now: () => ctx.clock
  })
  cleanups.push(async () => {
    ctx.scheduler.stop()
    await tasksRepo.flush().catch(() => undefined)
    await appStateRepo.flush().catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
  })
  return ctx
}

afterEach(async () => {
  vi.useRealTimers()
  while (cleanups.length) await (cleanups.pop() as () => Promise<void>)()
})

/** Silence the briefing path so reminder tests observe only reminder toasts. */
const ackToday = (ctx: Ctx): void => {
  ctx.appStateRepo.update({ lastBriefingDate: localDateKey(ctx.clock) })
}

function addHardTask(ctx: Ctx, title: string, dueDate: string, dueTime?: string): string {
  const t = ctx.tasksRepo.createFromCapture({ sourceText: title, sourceKind: 'typed' }, ctx.clock)
  ctx.tasksRepo.updateFromUser(
    t.id,
    { title, deadline: { kind: 'hard', dueDate, ...(dueTime ? { dueTime } : {}) } },
    ctx.clock
  )
  return t.id
}

describe('morning briefing', () => {
  it('offers once per local day on a user-activity trigger', async () => {
    const ctx = await makeCtx()
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(1)
    expect(ctx.briefings[0].dateKey).toBe('2026-07-02')
    ctx.scheduler.onAppEvent('focus')
    ctx.scheduler.onAppEvent('resume')
    expect(ctx.briefings).toHaveLength(1) // pending offer — never doubled
    ctx.scheduler.ackBriefing('2026-07-02')
    expect(ctx.appStateRepo.get().lastBriefingDate).toBe('2026-07-02')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(1)
  })

  it('holds before the 4am gate, fires after', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 3, 30))
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(0)
    ctx.clock = new Date(2026, 6, 2, 4, 0)
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(1)
  })

  it('offers again after the local midnight rollover', async () => {
    const ctx = await makeCtx()
    ctx.scheduler.onAppEvent('focus')
    ctx.scheduler.ackBriefing('2026-07-02')
    ctx.clock = new Date(2026, 6, 3, 8, 0)
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(2)
    expect(ctx.briefings[1].dateKey).toBe('2026-07-03')
  })

  it("'Later' re-offers once, riding user activity — never the 60s tick; max 2 offers/day", async () => {
    const ctx = await makeCtx()
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(1)
    ctx.scheduler.deferBriefing('2026-07-02')

    vi.useFakeTimers()
    ctx.scheduler.start()
    vi.advanceTimersByTime(60_000) // tick — deferred offers never ride the tick
    expect(ctx.briefings).toHaveLength(1)
    ctx.scheduler.onAppEvent('focus') // user activity → the single re-offer
    expect(ctx.briefings).toHaveLength(2)
    ctx.scheduler.deferBriefing('2026-07-02')
    ctx.scheduler.onAppEvent('focus')
    vi.advanceTimersByTime(120_000)
    expect(ctx.briefings).toHaveLength(2) // two offers max per day
    ctx.scheduler.stop()
  })

  it('hidden window → one quiet "ready" toast per day instead of the sheet', async () => {
    const ctx = await makeCtx()
    ctx.active = false
    ctx.scheduler.onAppEvent('ready')
    ctx.scheduler.onAppEvent('resume')
    expect(ctx.briefings).toHaveLength(0)
    expect(ctx.notices).toEqual([{ title: 'DeskMate', body: 'Your morning briefing is ready.' }])
    // Next day, still hidden → a fresh single notice.
    ctx.clock = new Date(2026, 6, 3, 9, 0)
    ctx.scheduler.onAppEvent('resume')
    expect(ctx.notices).toHaveLength(2)
  })

  it('buildNow returns a briefing without consuming the daily offer', async () => {
    const ctx = await makeCtx()
    const b = ctx.scheduler.buildNow()
    expect(b.dateKey).toBe('2026-07-02')
    expect(ctx.appStateRepo.get().lastBriefingDate).toBeUndefined()
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.briefings).toHaveLength(1)
  })
})

describe('due-soon reminders (hard deadlines only)', () => {
  it('fires once at lead time, persists the dedupe across scheduler instances', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 16, 35))
    ackToday(ctx)
    const id = addHardTask(ctx, 'Board deck', '2026-07-02', '17:00')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toEqual([{ title: 'DeskMate', body: 'Board deck is due at 5pm.', taskId: id }])
    expect(ctx.tasksRepo.get(id)?.reminders.dueSoonNotifiedAt).toBeDefined()
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(1)

    // A fresh scheduler over the same repo never re-nags — the timestamp is on the task.
    const second = new Scheduler({
      tasksRepo: ctx.tasksRepo,
      appStateRepo: ctx.appStateRepo,
      onBriefing: () => undefined,
      notify: (n) => ctx.notices.push(n),
      isWindowActive: () => true,
      now: () => ctx.clock
    })
    second.onAppEvent('ready')
    expect(ctx.notices).toHaveLength(1)
  })

  it('stays silent outside the lead window', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 16, 0))
    ackToday(ctx)
    addHardTask(ctx, 'Board deck', '2026-07-02', '17:00') // 60m out, lead is 30m
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(0)
  })

  it('date-only hard deadlines are due end-of-day 17:30', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 17, 10))
    ackToday(ctx)
    const id = addHardTask(ctx, 'Vendor list', '2026-07-02')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toEqual([{ title: 'DeskMate', body: 'Vendor list is due by end of day.', taskId: id }])
  })
})

describe('overdue-moment reminders', () => {
  it('fires once the moment a hard deadline passes today', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 15, 1))
    ackToday(ctx)
    const id = addHardTask(ctx, 'Board deck', '2026-07-02', '15:00')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toEqual([
      { title: 'DeskMate', body: "Board deck was due at 3pm — it's on Today.", taskId: id }
    ])
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(1)
    expect(ctx.tasksRepo.get(id)?.reminders.overdueNotifiedAt).toBeDefined()
  })

  it('a stale miss (due a previous day) is marked silently — the briefing owns carried-over work', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 9, 0))
    ackToday(ctx)
    const id = addHardTask(ctx, 'Old thing', '2026-07-01', '17:00')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(0)
    expect(ctx.tasksRepo.get(id)?.reminders.overdueNotifiedAt).toBeDefined()
  })

  it('done tasks never notify', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 15, 1))
    ackToday(ctx)
    const id = addHardTask(ctx, 'Finished', '2026-07-02', '15:00')
    ctx.tasksRepo.setStatus(id, 'done', ctx.clock)
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(0)
  })
})

describe('the calm contract', () => {
  it('soft deadlines never notify — not due-soon, not overdue', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 17, 20))
    ackToday(ctx)
    const t = ctx.tasksRepo.createFromCapture({ sourceText: 'Soft thing', sourceKind: 'typed' }, ctx.clock)
    ctx.tasksRepo.updateFromUser(
      t.id,
      { deadline: { kind: 'soft', dueDate: '2026-07-02', dueTime: '17:00' } },
      ctx.clock
    )
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(0)
    expect(ctx.tasksRepo.get(t.id)?.reminders).toEqual({})
  })

  it('remindersEnabled off silences every reminder', async () => {
    const ctx = await makeCtx(new Date(2026, 6, 2, 16, 45))
    ackToday(ctx)
    ctx.appStateRepo.update({ remindersEnabled: false })
    addHardTask(ctx, 'Board deck', '2026-07-02', '17:00')
    addHardTask(ctx, 'Past thing', '2026-07-02', '12:00')
    ctx.scheduler.onAppEvent('focus')
    expect(ctx.notices).toHaveLength(0)
  })
})
