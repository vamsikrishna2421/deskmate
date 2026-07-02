/** Humanized display formatting per DESIGN §17. Pure — all functions take `now` explicitly. */

import type { Briefing } from '@shared/types/enrichment'
import type { Deadline, Effort } from '@shared/types/task'
import { EOD_HOUR, EOD_MINUTE } from '@shared/constants'
import { daysBetweenKeys, localDateKey, parseDateKey } from '@shared/dates/dayMath'

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'long' })
const MONTH_DAY_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const DATELINE_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

/** '17:00' → '5pm', '17:30' → '5:30pm', '09:05' → '9:05am'. Invalid → ''. */
export function formatTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return ''
  const h24 = Number(m[1])
  const min = Number(m[2])
  if (h24 > 23 || min > 59) return ''
  const suffix = h24 >= 12 ? 'pm' : 'am'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return min === 0 ? `${h12}${suffix}` : `${h12}:${String(min).padStart(2, '0')}${suffix}`
}

/** Humanized day: today/tomorrow/yesterday, weekday within ±6 days, absolute 'Jul 11' beyond. */
export function humanDay(dateKey: string, now: Date): string {
  const d = parseDateKey(dateKey)
  if (!d) return dateKey
  const diff = daysBetweenKeys(localDateKey(now), dateKey)
  if (diff === null) return dateKey
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  if (diff > 1 && diff <= 6) return WEEKDAY_FMT.format(d)
  if (diff < -1 && diff >= -6) return `last ${WEEKDAY_FMT.format(d)}`
  return MONTH_DAY_FMT.format(d)
}

export type DeadlineChipVariant = 'hard' | 'soft' | 'overdue' | 'question'

export interface DeadlineChipText {
  /** ● hard · ○ soft · ◌ question — color never stands alone (DESIGN §10). */
  icon: '●' | '○' | '◌'
  text: string
  variant: DeadlineChipVariant
  /** Tooltip provenance quote when the LLM inferred it. */
  sourcePhrase?: string
}

/** Deadline chip content, or null when no chip should render (kind none, nothing to ask). */
export function deadlineChip(
  deadline: Deadline,
  now: Date,
  opts?: { needsReview?: boolean }
): DeadlineChipText | null {
  const sourcePhrase = deadline.source === 'llm' ? deadline.rawToken : undefined
  if (deadline.kind === 'none' || !deadline.dueDate) {
    if (opts?.needsReview) return { icon: '◌', text: 'when?', variant: 'question', sourcePhrase }
    return null
  }
  // Approx range tokens render the phrase; the resolved date is for sorting only.
  if (deadline.approx) {
    const phrase = deadline.rawToken === 'next-month' ? 'next month' : 'next week'
    return { icon: '○', text: phrase, variant: 'soft', sourcePhrase }
  }
  const todayKey = localDateKey(now)
  const day = humanDay(deadline.dueDate, now)
  const time = deadline.dueTime ? formatTime(deadline.dueTime) : ''
  const text = time ? `${day} ${time}` : day

  if (deadline.dueDate < todayKey) {
    return { icon: '●', text, variant: 'overdue', sourcePhrase }
  }
  if (deadline.dueDate === todayKey && deadline.kind === 'hard') {
    const due = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    if (deadline.dueTime) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(deadline.dueTime)
      if (m) due.setHours(Number(m[1]), Number(m[2]))
    } else {
      due.setHours(EOD_HOUR, EOD_MINUTE)
    }
    if (now > due) return { icon: '●', text, variant: 'overdue', sourcePhrase }
  }
  return deadline.kind === 'hard'
    ? { icon: '●', text, variant: 'hard', sourcePhrase }
    : { icon: '○', text, variant: 'soft', sourcePhrase }
}

/** 'by 5pm' style phrase for prose contexts (notifications, ticker). */
export function byPhrase(deadline: Deadline, now: Date): string {
  if (deadline.kind === 'none' || !deadline.dueDate) return ''
  if (deadline.approx) return deadline.rawToken === 'next-month' ? 'sometime next month' : 'sometime next week'
  const day = humanDay(deadline.dueDate, now)
  if (deadline.dueTime) {
    const t = formatTime(deadline.dueTime)
    return day === 'today' ? `by ${t}` : `${day} by ${t}`
  }
  if (deadline.kind === 'soft' && day !== 'today' && day !== 'tomorrow') return `sometime ${day}`
  return day
}

const EFFORT_LABEL: Record<Effort, string> = {
  minutes: '~30m',
  hour: '~1h',
  half_day: '~half day',
  day: '~1 day',
  multi_day: '~days'
}

export function formatEffort(effort: Effort): string {
  return EFFORT_LABEL[effort]
}

/** Week-view load gauge label: 90 → '1.5h', 45 → '45m'. */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = minutes / 60
  return Number.isInteger(h) ? `${h}h` : `${(Math.round(h * 10) / 10).toFixed(1)}h`
}

/** Briefing ambient sum: 'About 3h of focused work today.' Rounds to half hours. */
export function focusedWorkSentence(minutes: number): string {
  if (minutes < 30) return 'A few minutes of focused work today.'
  if (minutes < 60) return 'About 30 minutes of focused work today.'
  const half = Math.round(minutes / 30) / 2
  return `About ${half}h of focused work today.`
}

/** 'just now' · '5m ago' · '2h ago' · 'yesterday' · 'Jun 30'. */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const sec = Math.max(0, (now.getTime() - then.getTime()) / 1000)
  if (sec < 90) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400 && localDateKey(then) === localDateKey(now)) return `${Math.floor(sec / 3600)}h ago`
  const day = humanDay(localDateKey(then), now)
  return day === 'today' ? `${Math.floor(sec / 3600)}h ago` : day
}

/** Briefing dateline: 'WEDNESDAY, JULY 2' (DESIGN §8). */
export function briefingDateline(now: Date): string {
  return DATELINE_FMT.format(now).toUpperCase()
}

/** Time-aware greeting for the briefing header. */
export function greeting(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning.'
  if (h < 17) return 'Good afternoon.'
  return 'Good evening.'
}

/** Deterministic synthesis fallback: '2 due today · 1 carried over · 3 this week.' */
export function briefingFallback(b: Briefing): string {
  const parts: string[] = []
  if (b.dueToday.length > 0) parts.push(`${b.dueToday.length} due today`)
  if (b.overdue.length > 0) parts.push(`${b.overdue.length} carried over`)
  if (b.dueThisWeek.length > 0) parts.push(`${b.dueThisWeek.length} this week`)
  if (parts.length === 0) return 'All clear this morning.'
  return `${parts.join(' · ')}.`
}

/** Done-view group label for a completion day. */
export function doneGroupLabel(dateKey: string, now: Date): string {
  const label = humanDay(dateKey, now)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Truncate with ellipsis (shade ticker titles ~18ch). */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}
