/** Pure briefing construction + digest rendering (docs/LLM_PIPELINE.md §5–6, DESIGN.md §8).
 *  No I/O, no Date.now() — callers inject `now`. */

import type { Briefing, BriefingQuestionRef, BriefTaskRef } from '../shared/types/enrichment'
import type { Priority, Task } from '../shared/types/task'
import { EFFORT_MINUTES, STALLED_WORKDAYS } from '../shared/constants'
import { addDays, businessDaysBetween, daysBetweenKeys, localDateKey, weekBounds } from '../shared/dates/dayMath'

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3, optional: 4 }
const STALLED_MAX = 2
const BRIEFING_QUESTIONS_MAX = 2

function effortMinutesOf(t: Task): number | undefined {
  return t.effort !== undefined ? EFFORT_MINUTES[t.effort] : undefined
}

function toRef(t: Task, days?: { daysOverdue?: number; daysStalled?: number }): BriefTaskRef {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    effortMinutes: effortMinutesOf(t),
    daysOverdue: days?.daysOverdue,
    daysStalled: days?.daysStalled
  }
}

/** Business days elapsed since the last touch, counting today when it is a workday. */
function workdaysQuiet(t: Task, now: Date): number {
  const touched = new Date(t.activityAt)
  if (Number.isNaN(touched.getTime())) return 0
  return businessDaysBetween(touched, addDays(now, 1))
}

function stalledPreference(t: Task): number {
  return (t.deadline.kind !== 'none' ? 2 : 0) + (t.priority === 'urgent' || t.priority === 'high' ? 1 : 0)
}

export function buildBriefing(tasks: Task[], now: Date): Briefing {
  const todayKey = localDateKey(now)
  const sundayKey = localDateKey(weekBounds(now).sunday)
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived')

  const overdue: { t: Task; days: number }[] = []
  const dueToday: Task[] = []
  const thisWeek: Task[] = []
  const bucketed = new Set<string>()

  for (const t of active) {
    const due = t.deadline.kind === 'none' ? undefined : t.deadline.dueDate
    if (!due) continue
    if (due < todayKey) {
      overdue.push({ t, days: daysBetweenKeys(due, todayKey) ?? 1 })
      bucketed.add(t.id)
    } else if (due === todayKey) {
      dueToday.push(t)
      bucketed.add(t.id)
    } else if (due <= sundayKey) {
      thisWeek.push(t)
      bucketed.add(t.id)
    }
  }

  overdue.sort((a, b) => b.days - a.days || PRIORITY_RANK[a.t.priority] - PRIORITY_RANK[b.t.priority])
  dueToday.sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.deadline.dueTime ?? '24:00').localeCompare(b.deadline.dueTime ?? '24:00')
  )
  thisWeek.sort(
    (a, b) =>
      (a.deadline.dueDate ?? '').localeCompare(b.deadline.dueDate ?? '') ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  )

  const stalled = active
    .filter((t) => !bucketed.has(t.id))
    .map((t) => ({ t, days: workdaysQuiet(t, now) }))
    .filter((x) => x.days >= STALLED_WORKDAYS)
    .sort((a, b) => stalledPreference(b.t) - stalledPreference(a.t) || b.days - a.days)
    .slice(0, STALLED_MAX)

  const rest = active
    .filter((t) => !bucketed.has(t.id))
    .sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.activityAt.localeCompare(b.activityAt)
    )

  const questions: BriefingQuestionRef[] = []
  const byUrgency = [...overdue.map((x) => x.t), ...dueToday, ...thisWeek, ...rest]
  outer: for (const t of byUrgency) {
    for (const q of t.questions) {
      if (q.status !== 'open') continue
      questions.push({ taskId: t.id, questionId: q.id, question: q.question })
      if (questions.length >= BRIEFING_QUESTIONS_MAX) break outer
    }
  }

  let effortTodayMinutes = 0
  for (const t of [...overdue.map((x) => x.t), ...dueToday]) effortTodayMinutes += effortMinutesOf(t) ?? 0

  return {
    dateKey: todayKey,
    overdue: overdue.map((x) => toRef(x.t, { daysOverdue: x.days })),
    dueToday: dueToday.map((t) => toRef(t)),
    dueThisWeek: thisWeek.map((t) => toRef(t)),
    stalled: stalled.map((x) => toRef(x.t, { daysStalled: x.days })),
    questions,
    effortTodayMinutes: effortTodayMinutes > 0 ? effortTodayMinutes : undefined
  }
}

/** Labeled text digest fed to the briefing model — it never sees raw JSON (LLM_PIPELINE.md §6).
 *  Empty sections are omitted entirely; leaked "(0)" sections caused hallucinations in testing. */
export function renderBriefingDigest(b: Briefing): string {
  const line = (t: BriefTaskRef): string =>
    t.title +
    (t.daysOverdue ? ` (${t.daysOverdue} days overdue)` : '') +
    (t.daysStalled ? ` (no activity for ${t.daysStalled} days)` : '') +
    (t.priority === 'high' || t.priority === 'urgent' ? ' [high]' : '')
  const section = (name: string, refs: BriefTaskRef[]): string | null =>
    refs.length ? `${name} (${refs.length}): ${refs.map(line).join('; ')}` : null
  const clear = b.overdue.length === 0 && b.dueToday.length === 0
  const status = clear
    ? 'STATUS: nothing overdue and nothing due today — a clear day.'
    : `STATUS: ${b.overdue.length} overdue, ${b.dueToday.length} due today.`
  return [
    status,
    section('OVERDUE', b.overdue),
    section('DUE TODAY', b.dueToday),
    section('THIS WEEK', b.dueThisWeek),
    section('STALLED', b.stalled)
  ]
    .filter((s): s is string => s !== null)
    .join('\n')
}

/** Instant deterministic synthesis shown while (or instead of) the LLM sentence (DESIGN.md §8). */
export function fallbackSynthesis(b: Briefing): string {
  const parts: string[] = []
  if (b.dueToday.length) parts.push(`${b.dueToday.length} due today`)
  if (b.overdue.length) parts.push(`${b.overdue.length} carried over`)
  if (b.dueThisWeek.length) parts.push(`${b.dueThisWeek.length} this week`)
  return parts.length ? `${parts.join(' · ')}.` : 'All clear this morning.'
}
