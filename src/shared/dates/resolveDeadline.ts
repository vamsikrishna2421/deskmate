/** Deterministic deadline resolution (docs/LLM_PIPELINE.md §3). The LLM emits relative tokens;
 *  this pure function turns them into local 'YYYY-MM-DD' dates. The model NEVER does date math.
 *  No Date.now() — callers inject `today`. No Electron/Node imports. */

import { addDays, isoDow, isRealDate, localDateKey, lastDayOfNextMonth, startOfLocalDay } from './dayMath'

export const DEADLINE_TOKEN_RE =
  /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|none|\d{4}-\d{2}-\d{2})$/

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export interface ResolvedDeadline {
  /** Local 'YYYY-MM-DD', or null for 'none' / unresolvable. */
  date: string | null
  /** True for range tokens ('next-week', 'next-month') — UI shows the phrase; date is for sorting only. */
  approx: boolean
  /** False when the token was syntactically valid but not a real date (e.g. 2026-02-30). */
  valid: boolean
}

/** Resolve an LLM deadline token relative to `today` (any time-of-day; only the local date matters).
 *  Semantics: deadlines are "due by end of that day".
 *  - weekday token → the COMING occurrence (same weekday today → today)
 *  - next-<weekday> → that weekday OF NEXT WEEK (Mon-based)
 *  - next-week → Friday of next week (sortable stand-in for "sometime next week")
 *  - next-month → last day of next month (sortable stand-in)
 */
export function resolveDeadline(token: string, today: Date): ResolvedDeadline {
  const t = startOfLocalDay(today)

  if (token === 'none') return { date: null, approx: false, valid: true }
  if (token === 'today') return { date: localDateKey(t), approx: false, valid: true }
  if (token === 'tomorrow') return { date: localDateKey(addDays(t, 1)), approx: false, valid: true }

  const dayIdx = WEEKDAYS.indexOf(token)
  if (dayIdx >= 0) {
    const delta = (dayIdx + 1 - isoDow(t) + 7) % 7 // same day → 0 → today
    return { date: localDateKey(addDays(t, delta)), approx: false, valid: true }
  }

  const nx = /^next-(\w+)$/.exec(token)
  if (nx) {
    const mondayNext = addDays(t, 8 - isoDow(t))
    if (nx[1] === 'week') return { date: localDateKey(addDays(mondayNext, 4)), approx: true, valid: true }
    if (nx[1] === 'month') return { date: localDateKey(lastDayOfNextMonth(t)), approx: true, valid: true }
    const nxIdx = WEEKDAYS.indexOf(nx[1])
    if (nxIdx >= 0) return { date: localDateKey(addDays(mondayNext, nxIdx)), approx: false, valid: true }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    if (isRealDate(token)) return { date: token, approx: false, valid: true }
    return { date: null, approx: false, valid: false } // syntactically valid, not a real date
  }

  return { date: null, approx: false, valid: false } // unknown token — validation error upstream
}

/** True when the token is in the closed deadline vocabulary. */
export function isValidDeadlineToken(token: string): boolean {
  return DEADLINE_TOKEN_RE.test(token)
}
