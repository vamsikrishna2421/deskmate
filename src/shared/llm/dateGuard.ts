/** Deterministic impossible-date guard. A 3B model cannot be prompt-taught calendar
 *  validity — probed live 2026-07-06: "Feb 30" (famous) followed the few-shot, but
 *  "June 31st" still laundered into a confident wrong token. Same philosophy as
 *  resolveDeadline: the model never does date math, and it never gets to vouch for a
 *  calendar date either. Pure — no Electron/Node imports. */

import type { LlmTaskRaw } from '../types/enrichment'
import { QUESTIONS_MAX } from '../constants'

const MONTHS: ReadonlyArray<[names: string[], maxDay: number]> = [
  [['jan', 'january'], 31],
  [['feb', 'february'], 29], // Feb 29 allowed (leap years) — only 30/31 are always impossible
  [['mar', 'march'], 31],
  [['apr', 'april'], 30],
  [['may'], 31],
  [['jun', 'june'], 30],
  [['jul', 'july'], 31],
  [['aug', 'august'], 31],
  [['sep', 'sept', 'september'], 30],
  [['oct', 'october'], 31],
  [['nov', 'november'], 30],
  [['dec', 'december'], 31]
]

function maxDayOf(monthWord: string): number | null {
  const m = monthWord.toLowerCase()
  for (const [names, maxDay] of MONTHS) if (names.includes(m)) return maxDay
  return null
}

const MONTH_WORD =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
/** "Feb 30", "June 31st" */
const MONTH_DAY_RE = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi')
/** "31st of June", "30 February" */
const DAY_MONTH_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_WORD})\\b`, 'gi')
/** "6/31" — flagged only when BOTH m/d and d/m readings are impossible. */
const NUMERIC_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g
/** "the 32nd" — a day of month that exists in no month. */
const ORDINAL_RE = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/gi

function numericImpossible(a: number, b: number): boolean {
  const asMonthDay = (m: number, d: number): boolean =>
    m >= 1 && m <= 12 && d >= 1 && d <= (MONTHS[m - 1]?.[1] ?? 31)
  return !asMonthDay(a, b) && !asMonthDay(b, a)
}

/** Explicit date phrases in the text that cannot exist on any calendar. */
export function findImpossibleDatePhrases(text: string): string[] {
  const found: string[] = []
  const add = (phrase: string): void => {
    if (!found.some((p) => p.toLowerCase() === phrase.toLowerCase())) found.push(phrase)
  }
  for (const m of text.matchAll(MONTH_DAY_RE)) {
    const max = maxDayOf(m[1])
    if (max !== null && Number(m[2]) > max) add(m[0].trim())
  }
  for (const m of text.matchAll(DAY_MONTH_RE)) {
    const max = maxDayOf(m[2])
    if (max !== null && Number(m[1]) > max) add(m[0].trim())
  }
  for (const m of text.matchAll(NUMERIC_RE)) {
    if (numericImpossible(Number(m[1]), Number(m[2]))) add(m[0].trim())
  }
  for (const m of text.matchAll(ORDINAL_RE)) {
    if (Number(m[1]) > 31) add(m[0].trim())
  }
  return found
}

/** Post-extraction guard: when the source names an impossible date, never ship a confident
 *  deadline built on it. Single deadline-bearing task → deadline cleared + a question asking
 *  for the real date. Several deadline-bearing tasks → attribution is ambiguous, so only the
 *  question is added (to the first), and the violet ◌ invites the user to settle it. */
export function guardImpossibleDates(tasks: LlmTaskRaw[], phrases: string[]): LlmTaskRaw[] {
  if (phrases.length === 0 || tasks.length === 0) return tasks
  const question = `"${phrases[0]}" isn't a real calendar date — when is this actually due?`
  const withDeadline = tasks.filter((t) => t.deadline !== 'none')
  const target = withDeadline[0] ?? tasks[0]
  const clearDeadline = withDeadline.length <= 1
  return tasks.map((t) => {
    if (t !== target) return t
    const questions = t.clarifying_questions.some((q) => q === question)
      ? t.clarifying_questions
      : [question, ...t.clarifying_questions].slice(0, QUESTIONS_MAX)
    return {
      ...t,
      ...(clearDeadline && t.deadline !== 'none' ? { deadline: 'none', deadline_type: 'none' as const } : {}),
      clarifying_questions: questions
    }
  })
}
