/** Coarse 60s scheduler (ARCHITECTURE.md §2.9, DESIGN.md §8/§13): morning-briefing gating with
 *  'Later' deferral, hard-deadline due-soon + overdue-moment toasts with persisted dedupe.
 *  Injectable clock; soft deadlines never notify. */

import type { Briefing } from '../shared/types/enrichment'
import type { Deadline } from '../shared/types/task'
import type { AppStateRepo } from './store/appStateRepo'
import type { TasksRepo } from './store/tasksRepo'
import { buildBriefing } from './briefing'
import { BRIEFING_HOUR_GATE, EOD_HOUR, EOD_MINUTE, SCHEDULER_TICK_MS } from '../shared/constants'
import { isSameLocalDay, localDateKey, parseDateKey } from '../shared/dates/dayMath'

export interface SchedulerDeps {
  tasksRepo: TasksRepo
  appStateRepo: AppStateRepo
  onBriefing: (b: Briefing) => void
  notify: (n: { title: string; body: string; taskId?: string }) => void
  /** Focused or visible. */
  isWindowActive: () => boolean
  now?: () => Date
}

const MAX_BRIEFING_OFFERS_PER_DAY = 2

/** Date-only hard deadlines are due "end of day" at EOD_HOUR:EOD_MINUTE local. */
function dueMoment(deadline: Deadline): Date | null {
  if (!deadline.dueDate) return null
  const day = parseDateKey(deadline.dueDate)
  if (!day) return null
  const m = deadline.dueTime ? /^(\d{2}):(\d{2})$/.exec(deadline.dueTime) : null
  const hours = m ? Number(m[1]) : EOD_HOUR
  const minutes = m ? Number(m[2]) : EOD_MINUTE
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes)
}

function formatTime(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`
}

export class Scheduler {
  private readonly deps: SchedulerDeps
  private readonly now: () => Date
  private timer: ReturnType<typeof setInterval> | undefined
  private pendingOfferDate: string | undefined

  constructor(deps: SchedulerDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => new Date())
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick('tick'), SCHEDULER_TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  onAppEvent(_evt: 'ready' | 'resume' | 'unlock' | 'focus'): void {
    this.tick('event')
  }

  ackBriefing(dateKey: string): void {
    this.deps.appStateRepo.update({ lastBriefingDate: dateKey })
    if (this.pendingOfferDate === dateKey) this.pendingOfferDate = undefined
  }

  /** 'Later' — re-offers once, riding the next user-activity trigger; max 2 offers per day. */
  deferBriefing(dateKey: string): void {
    const prev = this.deps.appStateRepo.get().briefingDeferred
    const count = prev?.dateKey === dateKey ? prev.count + 1 : 1
    this.deps.appStateRepo.update({ briefingDeferred: { dateKey, count } })
    if (this.pendingOfferDate === dateKey) this.pendingOfferDate = undefined
  }

  /** Manual briefing (tray menu / `···`) — no gating, no state changes. */
  buildNow(now?: Date): Briefing {
    return buildBriefing(this.deps.tasksRepo.list(), now ?? this.now())
  }

  private tick(kind: 'tick' | 'event'): void {
    const now = this.now()
    try {
      this.checkBriefing(now, kind)
    } catch (err) {
      console.error('[scheduler] briefing check failed', err)
    }
    try {
      this.checkReminders(now)
    } catch (err) {
      console.error('[scheduler] reminder check failed', err)
    }
  }

  private checkBriefing(now: Date, kind: 'tick' | 'event'): void {
    if (now.getHours() < BRIEFING_HOUR_GATE) return
    const state = this.deps.appStateRepo.get()
    const dateKey = localDateKey(now)
    if (state.lastBriefingDate === dateKey) return
    if (this.pendingOfferDate === dateKey) return
    const defers = state.briefingDeferred?.dateKey === dateKey ? state.briefingDeferred.count : 0
    if (defers >= MAX_BRIEFING_OFFERS_PER_DAY) return

    if (!this.deps.isWindowActive()) {
      // Hidden launch: one quiet "ready" toast per day (persisted — restarts never re-toast).
      // An explicit in-window 'Later' suppresses it: the user already saw the briefing today.
      if (state.lastBriefingToastDate !== dateKey && defers === 0) {
        this.deps.appStateRepo.update({ lastBriefingToastDate: dateKey })
        this.deps.notify({ title: 'DeskMate', body: 'Your morning briefing is ready.' })
      }
      return
    }

    if (defers >= 1 && kind !== 'event') return // re-offer rides user activity, not the 60s tick
    this.pendingOfferDate = dateKey
    this.deps.onBriefing(buildBriefing(this.deps.tasksRepo.list(), now))
  }

  private checkReminders(now: Date): void {
    const state = this.deps.appStateRepo.get()
    if (!state.remindersEnabled) return
    // Read-only store can't persist dedupe stamps — notifying would re-nag on every launch.
    if (this.deps.tasksRepo.readOnly) return
    const leadMs = Math.max(0, state.dueSoonLeadMinutes) * 60_000

    for (const task of this.deps.tasksRepo.list()) {
      if (task.status === 'done' || task.status === 'archived') continue
      if (task.deadline.kind !== 'hard') continue // soft deadlines never notify
      const dueAt = dueMoment(task.deadline)
      if (!dueAt) continue
      const hasTime = task.deadline.dueTime !== undefined

      if (now.getTime() >= dueAt.getTime()) {
        if (!task.reminders.overdueNotifiedAt) {
          // Same local day, or just missed across midnight (last tick 11:59 → this tick 12:00).
          const justMissed = now.getTime() - dueAt.getTime() <= 2 * SCHEDULER_TICK_MS
          if (isSameLocalDay(dueAt, now) || justMissed) {
            this.deps.notify({
              title: 'DeskMate',
              body: hasTime
                ? `${task.title} was due at ${formatTime(dueAt)} — it's on Today.`
                : `${task.title} was due today — it's on Today.`,
              taskId: task.id
            })
          }
          // Older misses are marked silently — the briefing owns carried-over work.
          this.deps.tasksRepo.setReminder(task.id, 'overdueNotifiedAt', now.toISOString())
        }
        continue
      }

      if (!task.reminders.dueSoonNotifiedAt && dueAt.getTime() - now.getTime() <= leadMs) {
        this.deps.notify({
          title: 'DeskMate',
          body: hasTime
            ? `${task.title} is due at ${formatTime(dueAt)}.`
            : `${task.title} is due by end of day.`,
          taskId: task.id
        })
        this.deps.tasksRepo.setReminder(task.id, 'dueSoonNotifiedAt', now.toISOString())
      }
    }
  }
}
