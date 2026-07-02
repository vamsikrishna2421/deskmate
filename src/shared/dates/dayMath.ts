/** Pure local-date helpers. All functions operate in LOCAL time — tasks live in the user's day,
 *  never UTC. No Date.now() inside any function: callers inject `now`. No Electron/Node imports. */

const pad = (n: number): string => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' from a Date's LOCAL components (never toISOString — UTC shifts the day). */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse 'YYYY-MM-DD' into a Date at local midnight. Invalid input → null. */
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const [, y, mo, da] = m
  const d = new Date(Number(y), Number(mo) - 1, Number(da))
  if (d.getFullYear() !== Number(y) || d.getMonth() !== Number(mo) - 1 || d.getDate() !== Number(da)) {
    return null // e.g. 2026-02-30 rolled over
  }
  return d
}

/** True if 'YYYY-MM-DD' is a real calendar date. */
export function isRealDate(key: string): boolean {
  return parseDateKey(key) !== null
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())
  return r
}

/** ISO day of week: Mon=1 … Sun=7. */
export function isoDow(d: Date): number {
  const dow = d.getDay()
  return dow === 0 ? 7 : dow
}

export function isWeekend(d: Date): boolean {
  return isoDow(d) >= 6
}

/** Add n business days (skipping Sat/Sun). n may be 0 (returns same date). */
export function addBusinessDays(d: Date, n: number): Date {
  let cur = startOfLocalDay(d)
  let remaining = n
  while (remaining > 0) {
    cur = addDays(cur, 1)
    if (!isWeekend(cur)) remaining--
  }
  return cur
}

/** Count of business days strictly between a and b (a < b). Same/adjacent-day → 0. */
export function businessDaysBetween(a: Date, b: Date): number {
  let from = startOfLocalDay(a)
  const to = startOfLocalDay(b)
  if (from >= to) return 0
  let count = 0
  from = addDays(from, 1)
  while (from < to) {
    if (!isWeekend(from)) count++
    from = addDays(from, 1)
  }
  return count
}

/** The Monday of the week containing d (local). */
export function weekMonday(d: Date): Date {
  return addDays(startOfLocalDay(d), 1 - isoDow(d))
}

/** [monday, sunday] bounds of the week containing d. */
export function weekBounds(d: Date): { monday: Date; sunday: Date } {
  const monday = weekMonday(d)
  return { monday, sunday: addDays(monday, 6) }
}

/** Last calendar day of the month AFTER the month containing d. */
export function lastDayOfNextMonth(d: Date): Date {
  // Day 0 of month+2 = last day of month+1
  return new Date(d.getFullYear(), d.getMonth() + 2, 0)
}

/** Days from a (date key) to b (date key); positive when b is after a. */
export function daysBetweenKeys(aKey: string, bKey: string): number | null {
  const a = parseDateKey(aKey)
  const b = parseDateKey(bKey)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
