/** Pure local-date helpers (src/shared/dates/dayMath.ts). Frozen anchors, local-time semantics. */

import { describe, expect, it } from 'vitest'
import {
  addBusinessDays,
  addDays,
  businessDaysBetween,
  daysBetweenKeys,
  isRealDate,
  isSameLocalDay,
  isoDow,
  isWeekend,
  lastDayOfNextMonth,
  localDateKey,
  parseDateKey,
  startOfLocalDay,
  weekBounds,
  weekMonday
} from '@shared/dates/dayMath'

const THU = new Date(2026, 6, 2, 9, 30) // Thursday 2026-07-02
const FRI = new Date(2026, 6, 3, 12, 0) // Friday
const SAT = new Date(2026, 6, 4) // Saturday
const SUN = new Date(2026, 6, 5) // Sunday
const MON = new Date(2026, 6, 6) // Monday

describe('localDateKey / parseDateKey', () => {
  it('formats local components with zero padding', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('round-trips key → Date → key', () => {
    for (const key of ['2026-07-02', '2026-01-01', '2026-12-31', '2028-02-29']) {
      const d = parseDateKey(key)
      expect(d).not.toBeNull()
      expect(localDateKey(d as Date)).toBe(key)
      // parsed at local midnight
      expect((d as Date).getHours()).toBe(0)
      expect((d as Date).getMinutes()).toBe(0)
    }
  })

  it('rejects malformed and rolled-over dates', () => {
    expect(parseDateKey('2026-02-30')).toBeNull() // would roll to March
    expect(parseDateKey('2027-02-29')).toBeNull() // not a leap year
    expect(parseDateKey('2026-13-01')).toBeNull()
    expect(parseDateKey('2026-00-01')).toBeNull()
    expect(parseDateKey('2026-1-5')).toBeNull() // no padding
    expect(parseDateKey('garbage')).toBeNull()
    expect(parseDateKey('')).toBeNull()
  })

  it('isRealDate mirrors parseDateKey', () => {
    expect(isRealDate('2026-07-02')).toBe(true)
    expect(isRealDate('2028-02-29')).toBe(true)
    expect(isRealDate('2026-02-30')).toBe(false)
    expect(isRealDate('not-a-date')).toBe(false)
  })
})

describe('day helpers', () => {
  it('startOfLocalDay zeroes the time', () => {
    const s = startOfLocalDay(new Date(2026, 6, 2, 18, 45, 12))
    expect(localDateKey(s)).toBe('2026-07-02')
    expect(s.getHours()).toBe(0)
  })

  it('isSameLocalDay compares local calendar days', () => {
    expect(isSameLocalDay(new Date(2026, 6, 2, 0, 1), new Date(2026, 6, 2, 23, 59))).toBe(true)
    expect(isSameLocalDay(new Date(2026, 6, 2, 23, 59), new Date(2026, 6, 3, 0, 0))).toBe(false)
  })

  it('addDays crosses month and year boundaries', () => {
    expect(localDateKey(addDays(new Date(2026, 6, 31), 1))).toBe('2026-08-01')
    expect(localDateKey(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01')
    expect(localDateKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31')
  })

  it('isoDow: Monday=1 … Sunday=7; isWeekend on Sat/Sun only', () => {
    expect(isoDow(MON)).toBe(1)
    expect(isoDow(THU)).toBe(4)
    expect(isoDow(SAT)).toBe(6)
    expect(isoDow(SUN)).toBe(7)
    expect(isWeekend(SAT)).toBe(true)
    expect(isWeekend(SUN)).toBe(true)
    expect(isWeekend(FRI)).toBe(false)
    expect(isWeekend(MON)).toBe(false)
  })
})

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    expect(localDateKey(addBusinessDays(FRI, 1))).toBe('2026-07-06') // Fri +1 → Mon
    expect(localDateKey(addBusinessDays(THU, 1))).toBe('2026-07-03') // Thu +1 → Fri
    expect(localDateKey(addBusinessDays(THU, 5))).toBe('2026-07-09') // full business week
    expect(localDateKey(addBusinessDays(FRI, 5))).toBe('2026-07-10')
  })

  it('n=0 returns the same local date at midnight', () => {
    const r = addBusinessDays(new Date(2026, 6, 2, 15, 30), 0)
    expect(localDateKey(r)).toBe('2026-07-02')
    expect(r.getHours()).toBe(0)
  })

  it('starting on a weekend lands on the next workday', () => {
    expect(localDateKey(addBusinessDays(SAT, 1))).toBe('2026-07-06')
    expect(localDateKey(addBusinessDays(SUN, 1))).toBe('2026-07-06')
  })
})

describe('businessDaysBetween (strictly between)', () => {
  it('same or adjacent day → 0', () => {
    expect(businessDaysBetween(THU, THU)).toBe(0)
    expect(businessDaysBetween(THU, FRI)).toBe(0)
    expect(businessDaysBetween(FRI, THU)).toBe(0) // reversed → 0
  })

  it('weekends do not count', () => {
    expect(businessDaysBetween(FRI, MON)).toBe(0) // only Sat+Sun between
    expect(businessDaysBetween(FRI, new Date(2026, 6, 10))).toBe(4) // Fri → next Fri: Mon–Thu
    expect(businessDaysBetween(new Date(2026, 5, 29), FRI)).toBe(3) // Mon → Fri: Tue,Wed,Thu
  })

  it('ignores time of day', () => {
    expect(businessDaysBetween(new Date(2026, 6, 2, 23, 0), new Date(2026, 6, 3, 1, 0))).toBe(0)
  })
})

describe('weekMonday / weekBounds', () => {
  it('Monday-based week for every weekday', () => {
    const monSameWeek = new Date(2026, 5, 29) // Monday of THU's week
    for (const d of [monSameWeek, THU, FRI, SAT, SUN]) {
      expect(localDateKey(weekMonday(d))).toBe('2026-06-29')
    }
    expect(localDateKey(weekMonday(MON))).toBe('2026-07-06') // Jul 6 starts the NEXT week
    const { monday, sunday } = weekBounds(THU)
    expect(localDateKey(monday)).toBe('2026-06-29')
    expect(localDateKey(sunday)).toBe('2026-07-05')
  })

  it('Sunday belongs to the week that started the previous Monday', () => {
    const { monday, sunday } = weekBounds(SUN)
    expect(localDateKey(monday)).toBe('2026-06-29')
    expect(localDateKey(sunday)).toBe('2026-07-05')
  })

  it('week spanning a year boundary', () => {
    const { monday, sunday } = weekBounds(new Date(2026, 11, 31)) // Thu Dec 31
    expect(localDateKey(monday)).toBe('2026-12-28')
    expect(localDateKey(sunday)).toBe('2027-01-03')
  })
})

describe('lastDayOfNextMonth', () => {
  it('handles ordinary, short, leap, and year-rollover months', () => {
    expect(localDateKey(lastDayOfNextMonth(new Date(2026, 6, 2)))).toBe('2026-08-31')
    expect(localDateKey(lastDayOfNextMonth(new Date(2026, 0, 15)))).toBe('2026-02-28')
    expect(localDateKey(lastDayOfNextMonth(new Date(2028, 0, 15)))).toBe('2028-02-29') // leap
    expect(localDateKey(lastDayOfNextMonth(new Date(2026, 11, 15)))).toBe('2027-01-31') // year rollover
    expect(localDateKey(lastDayOfNextMonth(new Date(2026, 11, 31)))).toBe('2027-01-31')
  })
})

describe('daysBetweenKeys', () => {
  it('signed day distance', () => {
    expect(daysBetweenKeys('2026-07-02', '2026-07-05')).toBe(3)
    expect(daysBetweenKeys('2026-07-05', '2026-07-02')).toBe(-3)
    expect(daysBetweenKeys('2026-07-02', '2026-07-02')).toBe(0)
    expect(daysBetweenKeys('2026-12-30', '2027-01-02')).toBe(3) // year boundary
  })

  it('invalid keys → null', () => {
    expect(daysBetweenKeys('2026-02-30', '2026-07-02')).toBeNull()
    expect(daysBetweenKeys('2026-07-02', 'nope')).toBeNull()
  })
})
