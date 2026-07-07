/** "Your week, on one card" — the shareable weekly summary (Spotify-Wrapped lesson: people
 *  share stories about THEMSELVES, co-created from their own data, with zero-friction
 *  sharing). Everything is computed locally from the user's tasks; nothing leaves the
 *  machine until the user copies the rendered image. Pure — no Electron/Node imports. */

import type { Task } from './types/task'
import { EFFORT_MINUTES } from './constants'
import { addDays, localDateKey, startOfLocalDay } from './dates/dayMath'

export interface WeekStats {
  /** Monday of the summarized week, YYYY-MM-DD. */
  weekOf: string
  doneCount: number
  hardDeadlinesHit: number
  questionsAnswered: number
  organizedByAssistant: number
  focusedMinutes: number
  /** Mon..Sun completion counts for the mini bar chart. */
  byDay: number[]
  /** Busiest weekday name, when any work landed. */
  busiestDay?: string
  /** People pulled from "… to Sarah" / "… for Priya" titles of done tasks (max 3, deduped). */
  peopleHelped: string[]
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PERSON_RE = /\b(?:to|for|with)\s+([A-Z][a-z]{2,})\b/g
/** Capitalized-word false positives that PERSON_RE would otherwise "help". */
const NOT_PEOPLE = new Set([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December', 'The', 'This', 'Next', 'Today',
  'Tomorrow', 'Review', 'Leadership', 'Finance', 'Team'
])

/** Monday 00:00 of the week containing `now`. */
export function weekStart(now: Date): Date {
  const day = startOfLocalDay(now)
  const isoDow = (day.getDay() + 6) % 7 // Mon=0..Sun=6
  return addDays(day, -isoDow)
}

export function computeWeekStats(tasks: Task[], now: Date): WeekStats {
  const start = weekStart(now)
  const end = addDays(start, 7)
  const startKey = localDateKey(start)
  const endKey = localDateKey(end)

  const doneThisWeek = tasks.filter((t) => {
    if (!t.completedAt) return false
    const key = localDateKey(new Date(t.completedAt))
    return key >= startKey && key < endKey
  })

  const byDay = [0, 0, 0, 0, 0, 0, 0]
  for (const t of doneThisWeek) {
    const d = new Date(t.completedAt as string)
    byDay[(d.getDay() + 6) % 7] += 1
  }
  const max = Math.max(...byDay)
  const busiest = max > 0 ? DAY_NAMES[byDay.indexOf(max)] : undefined

  const people: string[] = []
  for (const t of doneThisWeek) {
    for (const m of t.title.matchAll(PERSON_RE)) {
      const name = m[1]
      if (!NOT_PEOPLE.has(name) && !people.includes(name)) people.push(name)
    }
  }

  return {
    weekOf: startKey,
    doneCount: doneThisWeek.length,
    hardDeadlinesHit: doneThisWeek.filter((t) => t.deadline.kind === 'hard').length,
    questionsAnswered: doneThisWeek.reduce(
      (n, t) => n + t.questions.filter((q) => q.status === 'answered').length,
      0
    ),
    organizedByAssistant: doneThisWeek.filter((t) => t.enrichment.status === 'done').length,
    focusedMinutes: doneThisWeek.reduce((n, t) => n + (t.effort ? (EFFORT_MINUTES[t.effort] ?? 0) : 0), 0),
    byDay,
    busiestDay: busiest,
    peopleHelped: people.slice(0, 3)
  }
}
