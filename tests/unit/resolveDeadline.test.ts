/** Table-driven deadline-token resolution (ARCHITECTURE.md §7, docs/LLM_PIPELINE.md §3).
 *  Every anchor date is frozen and weekday-verified — zero Date.now() dependence. */

import { describe, expect, it } from 'vitest'
import { isoDow } from '@shared/dates/dayMath'
import { DEADLINE_TOKEN_RE, isValidDeadlineToken, resolveDeadline } from '@shared/dates/resolveDeadline'

const THU = new Date(2026, 6, 2, 9, 30) // Thursday 2026-07-02
const FRI = new Date(2026, 6, 3, 17, 45) // Friday 2026-07-03
const SAT = new Date(2026, 6, 4, 8, 0) // Saturday 2026-07-04
const SUN = new Date(2026, 6, 5, 8, 0) // Sunday 2026-07-05
const MON_LATE_DEC = new Date(2026, 11, 28) // Monday 2026-12-28
const THU_NYE = new Date(2026, 11, 31) // Thursday 2026-12-31
const FRI_JUL31 = new Date(2026, 6, 31) // Friday 2026-07-31 (month boundary)
const JAN15 = new Date(2026, 0, 15) // mid-January (next month = February)

it('anchor dates have the intended weekdays', () => {
  expect(isoDow(THU)).toBe(4)
  expect(isoDow(FRI)).toBe(5)
  expect(isoDow(SAT)).toBe(6)
  expect(isoDow(SUN)).toBe(7)
  expect(isoDow(MON_LATE_DEC)).toBe(1)
  expect(isoDow(THU_NYE)).toBe(4)
  expect(isoDow(FRI_JUL31)).toBe(5)
})

interface Case {
  name: string
  anchor: Date
  token: string
  date: string | null
  approx?: boolean
}

const RESOLVES: Case[] = [
  // ── simple tokens ──────────────────────────────────────────────────────────
  { name: 'none → no date (Thu)', anchor: THU, token: 'none', date: null },
  { name: 'today (Thu)', anchor: THU, token: 'today', date: '2026-07-02' },
  { name: 'tomorrow (Thu)', anchor: THU, token: 'tomorrow', date: '2026-07-03' },
  // ── weekday tokens: coming occurrence; same weekday → today ────────────────
  { name: 'thursday on a Thursday → today', anchor: THU, token: 'thursday', date: '2026-07-02' },
  { name: 'friday on a Thursday → next day', anchor: THU, token: 'friday', date: '2026-07-03' },
  { name: 'saturday (Thu)', anchor: THU, token: 'saturday', date: '2026-07-04' },
  { name: 'sunday (Thu)', anchor: THU, token: 'sunday', date: '2026-07-05' },
  { name: 'monday (Thu) → next Monday', anchor: THU, token: 'monday', date: '2026-07-06' },
  { name: 'wednesday (Thu) → next week Wed', anchor: THU, token: 'wednesday', date: '2026-07-08' },
  { name: 'friday on a Friday → same day', anchor: FRI, token: 'friday', date: '2026-07-03' },
  { name: 'friday on a Saturday → next Friday', anchor: SAT, token: 'friday', date: '2026-07-10' },
  { name: 'saturday on a Saturday → same day', anchor: SAT, token: 'saturday', date: '2026-07-04' },
  { name: 'sunday on a Saturday', anchor: SAT, token: 'sunday', date: '2026-07-05' },
  // ── next-* tokens (Monday-based next week) ─────────────────────────────────
  { name: 'next-monday (Thu)', anchor: THU, token: 'next-monday', date: '2026-07-06' },
  { name: 'next-thursday (Thu)', anchor: THU, token: 'next-thursday', date: '2026-07-09' },
  { name: 'next-sunday (Thu)', anchor: THU, token: 'next-sunday', date: '2026-07-12' },
  { name: 'next-friday (Fri)', anchor: FRI, token: 'next-friday', date: '2026-07-10' },
  { name: 'next-monday (Sat) → Monday in 2 days', anchor: SAT, token: 'next-monday', date: '2026-07-06' },
  { name: 'next-monday (Sun) → tomorrow', anchor: SUN, token: 'next-monday', date: '2026-07-06' },
  { name: 'next-week (Thu) → Friday next week', anchor: THU, token: 'next-week', date: '2026-07-10', approx: true },
  { name: 'next-week (Fri)', anchor: FRI, token: 'next-week', date: '2026-07-10', approx: true },
  { name: 'next-week (Sat)', anchor: SAT, token: 'next-week', date: '2026-07-10', approx: true },
  { name: 'next-month (Thu) → last day of August', anchor: THU, token: 'next-month', date: '2026-08-31', approx: true },
  { name: 'next-month (mid-Jan, non-leap) → Feb 28', anchor: JAN15, token: 'next-month', date: '2026-02-28', approx: true },
  // ── explicit ISO dates ─────────────────────────────────────────────────────
  { name: 'explicit real ISO date passes through', anchor: THU, token: '2026-07-15', date: '2026-07-15' },
  // ── month/year boundaries ──────────────────────────────────────────────────
  { name: 'tomorrow across a month boundary', anchor: FRI_JUL31, token: 'tomorrow', date: '2026-08-01' },
  { name: 'saturday across a month boundary', anchor: FRI_JUL31, token: 'saturday', date: '2026-08-01' },
  { name: 'friday from late December → Jan 1 next year', anchor: MON_LATE_DEC, token: 'friday', date: '2027-01-01' },
  { name: 'tomorrow on Dec 31 → New Year', anchor: THU_NYE, token: 'tomorrow', date: '2027-01-01' },
  { name: 'next-week from late December → next year', anchor: MON_LATE_DEC, token: 'next-week', date: '2027-01-08', approx: true },
  { name: 'next-month in December → Jan 31 next year', anchor: MON_LATE_DEC, token: 'next-month', date: '2027-01-31', approx: true }
]

describe('resolveDeadline — valid tokens', () => {
  it.each(RESOLVES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const r = resolveDeadline(c.token, c.anchor)
    expect(r.valid).toBe(true)
    expect(r.date).toBe(c.date)
    expect(r.approx).toBe(c.approx ?? false)
  })

  it('is insensitive to the anchor time of day', () => {
    const lateNight = new Date(2026, 6, 2, 23, 59, 59)
    expect(resolveDeadline('today', lateNight).date).toBe('2026-07-02')
    expect(resolveDeadline('friday', lateNight).date).toBe('2026-07-03')
    expect(resolveDeadline('next-week', lateNight).date).toBe('2026-07-10')
  })
})

describe('resolveDeadline — invalid input', () => {
  it.each([['eod'], ['next-year'], ['someday'], [''], ['Friday'], ['NEXT-WEEK'], ['2 days']])(
    'unknown token %j → invalid, no date',
    (token) => {
      expect(resolveDeadline(token, THU)).toEqual({ date: null, approx: false, valid: false })
    }
  )

  it.each([['2026-02-30'], ['2026-13-01'], ['2026-00-10'], ['2027-04-31']])(
    'syntactically valid but unreal ISO date %s → invalid',
    (token) => {
      const r = resolveDeadline(token, THU)
      expect(r).toEqual({ date: null, approx: false, valid: false })
      // The coercion layer accepts these by regex — the resolver is the unreal-date gate.
      expect(isValidDeadlineToken(token)).toBe(true)
    }
  )
})

describe('deadline token vocabulary', () => {
  it('accepts the full closed vocabulary', () => {
    const tokens = [
      'today',
      'tomorrow',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'next-monday',
      'next-tuesday',
      'next-wednesday',
      'next-thursday',
      'next-friday',
      'next-saturday',
      'next-sunday',
      'next-week',
      'next-month',
      'none',
      '2026-07-15'
    ]
    for (const t of tokens) expect(isValidDeadlineToken(t), t).toBe(true)
  })

  it('rejects free text and prose deadlines', () => {
    for (const t of ['no specific deadline mentioned', 'eow', 'eod', 'asap', 'friday 5pm', '']) {
      expect(isValidDeadlineToken(t), t).toBe(false)
      expect(DEADLINE_TOKEN_RE.test(t), t).toBe(false)
    }
  })
})
