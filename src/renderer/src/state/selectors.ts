/** Memoized view selectors (DESIGN §9). All bucketing works from resolved local dates —
 *  memo key is (tasks identity, view, todayKey), so results refresh at local midnight. */

import type { Task, Effort, Priority } from '@shared/types/task'
import {
  DAY_BUDGET_MINUTES,
  DONE_ARCHIVE_DAYS,
  EFFORT_MINUTES,
  EOD_HOUR,
  EOD_MINUTE,
  STALLED_WORKDAYS
} from '@shared/constants'
import {
  addDays,
  businessDaysBetween,
  localDateKey,
  startOfLocalDay,
  weekBounds
} from '@shared/dates/dayMath'
import type { LegendFilterId, TaskViewId as ViewId } from './uiReducer'
import { doneGroupLabel } from '../lib/format'

export interface TaskGroup {
  key: string
  /** Empty label = render tasks without a section header. */
  label: string
  tasks: Task[]
  /** Week view only: summed effort minutes for the day's load gauge. */
  effortMinutes?: number
  /** Week view only: gauge budget (DAY_BUDGET_MINUTES). */
  budgetMinutes?: number
}

export interface ViewModel {
  view: ViewId
  groups: TaskGroup[]
  /** Today footer whisper: 'About 3h of focused work today.' */
  effortTodayMinutes?: number
  emptyText: string
}

export type EffortBucket = 'quick' | 'medium' | 'big'

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3, optional: 4 }

const EMPTY_TEXT: Record<ViewId, string> = {
  today: 'Nothing due today. Enjoy the space.',
  week: 'A clear week so far.',
  later: 'Nothing waiting.',
  done: 'Nothing yet today.'
}

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

// ── date/bucket predicates ────────────────────────────────────────────────────

export function isOpen(t: Task): boolean {
  return t.status !== 'done' && t.status !== 'archived'
}

/** Concrete resolved due date key — approx ranges don't count as dated (they live in Later). */
function dueKey(t: Task): string | null {
  if (t.deadline.kind === 'none' || !t.deadline.dueDate || t.deadline.approx) return null
  return t.deadline.dueDate
}

export function isOverdue(t: Task, todayKey: string): boolean {
  const due = dueKey(t)
  return isOpen(t) && due !== null && due < todayKey
}

export function isDueToday(t: Task, todayKey: string): boolean {
  const due = dueKey(t)
  return isOpen(t) && due === todayKey
}

function isDueThisWeekAfterToday(t: Task, todayKey: string, sundayKey: string): boolean {
  const due = dueKey(t)
  return isOpen(t) && due !== null && due > todayKey && due <= sundayKey
}

function inTodayBucket(t: Task, todayKey: string): boolean {
  return (
    isOpen(t) &&
    (t.status === 'inbox' ||
      t.status === 'in_progress' ||
      t.pinned ||
      isOverdue(t, todayKey) ||
      isDueToday(t, todayKey))
  )
}

function inLaterBucket(t: Task, todayKey: string, sundayKey: string): boolean {
  return isOpen(t) && !inTodayBucket(t, todayKey) && !isDueThisWeekAfterToday(t, todayKey, sundayKey)
}

/** Later filter-row mapping (DESIGN §9): minutes→≤30m · hour→≤2h · half_day/day/multi_day→Big rocks. */
export function effortBucket(effort: Effort | undefined): EffortBucket | null {
  if (!effort) return null
  if (effort === 'minutes') return 'quick'
  if (effort === 'hour') return 'medium'
  return 'big'
}

export function effortMinutesOf(t: Task): number {
  return t.effort ? (EFFORT_MINUTES[t.effort] ?? 0) : 0
}

/** Which view a task naturally lives in (nav:focusTask routing). */
export function viewForTask(t: Task, now: Date): ViewId {
  if (!isOpen(t)) return 'done'
  const todayKey = localDateKey(now)
  if (inTodayBucket(t, todayKey)) return 'today'
  const sundayKey = localDateKey(weekBounds(now).sunday)
  if (isDueThisWeekAfterToday(t, todayKey, sundayKey)) return 'week'
  return 'later'
}

// ── sorting ───────────────────────────────────────────────────────────────────

function dueSortKey(t: Task): string {
  const due = dueKey(t)
  if (due === null) return '9999-99-99'
  return `${due}T${t.deadline.dueTime ?? '99:99'}`
}

/** Urgency → deadline time → priority → age (DESIGN §9 Today sort). */
function compareUrgency(todayKey: string) {
  const rank = (t: Task): number => (isOverdue(t, todayKey) ? 0 : isDueToday(t, todayKey) ? 1 : 2)
  return (a: Task, b: Task): number =>
    rank(a) - rank(b) ||
    dueSortKey(a).localeCompare(dueSortKey(b)) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.createdAt.localeCompare(b.createdAt)
}

// ── view models ───────────────────────────────────────────────────────────────

function buildToday(tasks: Task[], todayKey: string): ViewModel {
  const cmp = compareUrgency(todayKey)
  const fresh = tasks.filter((t) => t.status === 'inbox').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const inFresh = new Set(fresh.map((t) => t.id))
  const carried = tasks.filter((t) => !inFresh.has(t.id) && isOverdue(t, todayKey)).sort(cmp)
  const dueToday = tasks.filter((t) => !inFresh.has(t.id) && isDueToday(t, todayKey)).sort(cmp)
  const placed = new Set([...inFresh, ...carried.map((t) => t.id), ...dueToday.map((t) => t.id)])
  const picked = tasks
    .filter((t) => !placed.has(t.id) && isOpen(t) && (t.pinned || t.status === 'in_progress'))
    .sort(cmp)

  const all = [...fresh, ...carried, ...dueToday, ...picked]
  const groups: TaskGroup[] = []
  if (fresh.length) groups.push({ key: 'new', label: '', tasks: fresh })
  if (carried.length) groups.push({ key: 'carried', label: 'Carried over', tasks: carried })
  if (dueToday.length) groups.push({ key: 'due-today', label: 'Due today', tasks: dueToday })
  if (picked.length) groups.push({ key: 'picked', label: 'Picked for today', tasks: picked })

  const effortTodayMinutes = all.reduce((sum, t) => sum + effortMinutesOf(t), 0)
  return { view: 'today', groups, effortTodayMinutes, emptyText: EMPTY_TEXT.today }
}

function buildWeek(tasks: Task[], now: Date): ViewModel {
  const todayKey = localDateKey(now)
  const { monday, sunday } = weekBounds(now)
  const sundayKey = localDateKey(sunday)
  const inWeek = tasks.filter((t) => isDueThisWeekAfterToday(t, todayKey, sundayKey))

  const groups: TaskGroup[] = []
  const start = startOfLocalDay(now)
  for (let i = 0; i < 5; i++) {
    const day = addDays(monday, i)
    if (day <= start) continue
    const key = localDateKey(day)
    const dayTasks = inWeek
      .filter((t) => dueKey(t) === key)
      .sort((a, b) => dueSortKey(a).localeCompare(dueSortKey(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    if (dayTasks.length === 0) continue
    groups.push({
      key,
      label: WEEKDAY_LABELS[i],
      tasks: dayTasks,
      effortMinutes: dayTasks.reduce((s, t) => s + effortMinutesOf(t), 0),
      budgetMinutes: DAY_BUDGET_MINUTES
    })
  }
  const satKey = localDateKey(addDays(monday, 5))
  const weekend = inWeek
    .filter((t) => (dueKey(t) ?? '') >= satKey)
    .sort((a, b) => dueSortKey(a).localeCompare(dueSortKey(b)))
  if (weekend.length) {
    groups.push({
      key: 'weekend',
      label: 'Weekend',
      tasks: weekend,
      effortMinutes: weekend.reduce((s, t) => s + effortMinutesOf(t), 0),
      budgetMinutes: DAY_BUDGET_MINUTES
    })
  }
  return { view: 'week', groups, emptyText: EMPTY_TEXT.week }
}

function buildLater(tasks: Task[], now: Date): ViewModel {
  const todayKey = localDateKey(now)
  const sundayKey = localDateKey(weekBounds(now).sunday)
  // Free-time shelf: oldest first (DESIGN §9).
  const later = tasks
    .filter((t) => inLaterBucket(t, todayKey, sundayKey))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const groups: TaskGroup[] = later.length ? [{ key: 'later', label: '', tasks: later }] : []
  return { view: 'later', groups, emptyText: EMPTY_TEXT.later }
}

function buildDone(tasks: Task[], now: Date): ViewModel {
  const cutoff = localDateKey(addDays(startOfLocalDay(now), -DONE_ARCHIVE_DAYS))
  const done = tasks
    .filter((t) => t.status === 'done' && t.completedAt !== undefined)
    .filter((t) => localDateKey(new Date(t.completedAt as string)) >= cutoff)
    .sort((a, b) => (b.completedAt as string).localeCompare(a.completedAt as string))

  const groups: TaskGroup[] = []
  for (const t of done) {
    const key = localDateKey(new Date(t.completedAt as string))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.tasks.push(t)
    else groups.push({ key, label: doneGroupLabel(key, now), tasks: [t] })
  }
  return { view: 'done', groups, emptyText: EMPTY_TEXT.done }
}

// ── memoization: one slot per view, keyed by (tasks identity, todayKey) ───────

interface VmCacheEntry {
  tasks: Task[]
  todayKey: string
  vm: ViewModel
}
const vmCache = new Map<ViewId, VmCacheEntry>()

export function selectViewModel(tasks: Task[], view: ViewId, now: Date): ViewModel {
  const todayKey = localDateKey(now)
  const hit = vmCache.get(view)
  if (hit && hit.tasks === tasks && hit.todayKey === todayKey) return hit.vm
  let vm: ViewModel
  switch (view) {
    case 'today':
      vm = buildToday(tasks, todayKey)
      break
    case 'week':
      vm = buildWeek(tasks, now)
      break
    case 'later':
      vm = buildLater(tasks, now)
      break
    case 'done':
      vm = buildDone(tasks, now)
      break
  }
  vmCache.set(view, { tasks, todayKey, vm })
  return vm
}

let countsCache: { tasks: Task[]; todayKey: string; counts: Record<ViewId, number> } | null = null

/** Tab superscript counts. Done counts today's completions (empty state: 'Nothing yet today.'). */
export function selectCounts(tasks: Task[], now: Date): Record<ViewId, number> {
  const todayKey = localDateKey(now)
  if (countsCache && countsCache.tasks === tasks && countsCache.todayKey === todayKey) {
    return countsCache.counts
  }
  const sundayKey = localDateKey(weekBounds(now).sunday)
  const counts: Record<ViewId, number> = { today: 0, week: 0, later: 0, done: 0 }
  for (const t of tasks) {
    if (inTodayBucket(t, todayKey)) counts.today++
    if (isDueThisWeekAfterToday(t, todayKey, sundayKey)) counts.week++
    if (inLaterBucket(t, todayKey, sundayKey)) counts.later++
    if (t.status === 'done' && t.completedAt && localDateKey(new Date(t.completedAt)) === todayKey) {
      counts.done++
    }
  }
  countsCache = { tasks, todayKey, counts }
  return counts
}

let loopsCache: { tasks: Task[]; count: number } | null = null

/** Open questions across live tasks — the ◌ n chip and 'A' batch mode. */
export function selectOpenLoopsCount(tasks: Task[]): number {
  if (loopsCache && loopsCache.tasks === tasks) return loopsCache.count
  let count = 0
  for (const t of tasks) {
    if (!isOpen(t)) continue
    count += t.questions.filter((q) => q.status === 'open').length
  }
  loopsCache = { tasks, count }
  return count
}

export function hasOpenLoops(t: Task): boolean {
  return isOpen(t) && t.questions.some((q) => q.status === 'open')
}

let stalledCache: { tasks: Task[]; todayKey: string; ids: Set<string> } | null = null

/** 'Quiet for a while' — untouched ≥ STALLED_WORKDAYS business days (moon glyph). */
export function selectStalledIds(tasks: Task[], now: Date): ReadonlySet<string> {
  const todayKey = localDateKey(now)
  if (stalledCache && stalledCache.tasks === tasks && stalledCache.todayKey === todayKey) {
    return stalledCache.ids
  }
  const ids = new Set<string>()
  for (const t of tasks) {
    if (!isOpen(t)) continue
    const touched = new Date(t.activityAt)
    if (!Number.isNaN(touched.getTime()) && businessDaysBetween(touched, now) >= STALLED_WORKDAYS) {
      ids.add(t.id)
    }
  }
  stalledCache = { tasks, todayKey, ids }
  return ids
}

/** Next hard deadline today still ahead of `now` (shade ticker '● 5pm board deck'). */
export function selectNextHardToday(tasks: Task[], now: Date): Task | null {
  const todayKey = localDateKey(now)
  let best: Task | null = null
  let bestDue = Number.POSITIVE_INFINITY
  for (const t of tasks) {
    if (!isOpen(t) || t.deadline.kind !== 'hard' || dueKey(t) !== todayKey) continue
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const m = t.deadline.dueTime ? /^(\d{1,2}):(\d{2})$/.exec(t.deadline.dueTime) : null
    if (m) due.setHours(Number(m[1]), Number(m[2]))
    else due.setHours(EOD_HOUR, EOD_MINUTE)
    const ts = due.getTime()
    if (ts >= now.getTime() && ts < bestDue) {
      best = t
      bestDue = ts
    }
  }
  return best
}

// ── search (fuzzy title + raw source + #tag; Done searchable forever) ─────────

function isSubsequence(query: string, target: string): boolean {
  let i = 0
  for (const ch of target) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return i === query.length
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase()
  if (!q) return tasks
  if (q.startsWith('#')) {
    const tag = q.slice(1)
    if (!tag) return tasks
    return tasks.filter((t) => t.tags.some((x) => x.startsWith(tag)))
  }
  return tasks.filter((t) => {
    const title = t.title.toLowerCase()
    if (title.includes(q) || isSubsequence(q, title)) return true
    if (t.sourceText.toLowerCase().includes(q)) return true
    return t.tags.some((x) => x.includes(q))
  })
}

// ── legend live filters (DESIGN §10 — closed vocabulary) ──────────────────────

export interface LegendContext {
  now: Date
  stalledIds: ReadonlySet<string>
  enrichment: Readonly<Record<string, 'queued' | 'running'>>
}

export function legendPredicate(filter: LegendFilterId, ctx: LegendContext): (t: Task) => boolean {
  const todayKey = localDateKey(ctx.now)
  const sundayKey = localDateKey(weekBounds(ctx.now).sunday)
  switch (filter) {
    case 'overdue':
      return (t) => isOverdue(t, todayKey)
    case 'dueToday':
      return (t) => isDueToday(t, todayKey)
    case 'thisWeek':
      return (t) => isDueThisWeekAfterToday(t, todayKey, sundayKey)
    case 'later':
      return (t) => inLaterBucket(t, todayKey, sundayKey)
    case 'hardDeadline':
      return (t) => t.deadline.kind === 'hard'
    case 'softDeadline':
      return (t) => t.deadline.kind === 'soft'
    case 'question':
      return (t) => hasOpenLoops(t)
    case 'assistant':
      return (t) => t.enrichment.status === 'done'
    case 'guessed':
      return (t) => t.enrichment.needsReview === true
    case 'locked':
      return (t) =>
        t.deadline.source === 'user' ||
        Object.values(t.provenance).some((source) => source === 'user')
    case 'done':
      return (t) => t.status === 'done'
    case 'urgent':
      return (t) => t.priority === 'urgent'
    case 'high':
      return (t) => t.priority === 'high'
    case 'stalled':
      return (t) => ctx.stalledIds.has(t.id)
    case 'offline':
      return (t) => t.enrichment.status === 'failed' || t.enrichment.status === 'pending'
    case 'working':
      return (t) => t.id in ctx.enrichment
    case 'focus':
      return (t) => t.focus
  }
}

/** Filter a view model's groups, dropping emptied groups (legend filter / search / loops mode). */
export function filterViewModel(vm: ViewModel, keep: (t: Task) => boolean): ViewModel {
  const groups = vm.groups
    .map((g) => ({ ...g, tasks: g.tasks.filter(keep) }))
    .filter((g) => g.tasks.length > 0)
  return { ...vm, groups }
}
