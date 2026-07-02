/** Hand-rolled validation of LLM output (docs/LLM_PIPELINE.md §7 — zod-style rules, no zod dep).
 *  Silent auto-repairs are recorded; hard failures return structured errors that feed the
 *  strict retry pass. Pure — no Electron/Node imports. */

import type { CoerceResult, LlmExtraction, LlmTaskRaw } from '../types/enrichment'
import {
  QUESTIONS_MAX,
  SUBTASKS_MAX,
  SUBTASK_TITLE_MAX,
  TAGS_MAX,
  TASKS_PER_EXTRACTION_MAX,
  TITLE_MAX
} from '../constants'
import { isValidDeadlineToken } from '../dates/resolveDeadline'

const DEADLINE_TYPES = ['hard', 'soft', 'none'] as const
const PRIORITIES = ['high', 'medium', 'low', 'optional'] as const
const EFFORTS = ['15min', '1hour', 'half-day', 'multi-day'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanStringArray(v: unknown, maxItems: number, maxLen: number, repairs: string[], label: string): string[] {
  if (!Array.isArray(v)) {
    if (v !== undefined && v !== null) repairs.push(`${label}: not an array — reset to []`)
    return []
  }
  const strings = v.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean)
  if (strings.length !== v.length) repairs.push(`${label}: dropped non-string/empty entries`)
  const clamped = strings.map((s) => (s.length > maxLen ? s.slice(0, maxLen) : s))
  if (clamped.length > maxItems) {
    repairs.push(`${label}: clamped ${clamped.length} → ${maxItems}`)
    return clamped.slice(0, maxItems)
  }
  return clamped
}

/** Some models wrap JSON in prose or code fences — extract the outermost JSON object. */
export function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return undefined
      }
    }
    return undefined
  }
}

/** Validate + repair one task object. Pushes hard errors / silent repairs; returns null on hard failure. */
export function coerceTask(v: unknown, errors: string[], repairs: string[], ctx = 'task'): LlmTaskRaw | null {
  if (!isRecord(v)) {
    errors.push(`${ctx}: not an object`)
    return null
  }

  const title = typeof v.title === 'string' ? v.title.trim() : ''
  if (!title) {
    errors.push(`${ctx}: missing/empty title`)
    return null
  }

  let summary = typeof v.summary === 'string' ? v.summary.trim() : ''
  if (!summary) {
    summary = title
    repairs.push(`${ctx}: empty summary — defaulted to title`)
  }

  const deadline = typeof v.deadline === 'string' ? v.deadline.trim().toLowerCase() : ''
  if (!isValidDeadlineToken(deadline)) {
    errors.push(`${ctx}: deadline "${String(v.deadline)}" is not a valid token (use today/tomorrow/monday..sunday/next-*/none/YYYY-MM-DD)`)
    return null
  }

  let deadline_type = v.deadline_type as LlmTaskRaw['deadline_type']
  if (!DEADLINE_TYPES.includes(deadline_type)) {
    errors.push(`${ctx}: deadline_type "${String(v.deadline_type)}" invalid (hard|soft|none)`)
    return null
  }
  // The single most common model slip (4/36 bench runs): kind/token inconsistency — repair silently.
  if (deadline === 'none' && deadline_type !== 'none') {
    deadline_type = 'none'
    repairs.push(`${ctx}: deadline "none" with type "${String(v.deadline_type)}" — type reset to none`)
  } else if (deadline !== 'none' && deadline_type === 'none') {
    deadline_type = 'soft'
    repairs.push(`${ctx}: dated deadline with type "none" — type reset to soft`)
  }

  const priority = v.priority as LlmTaskRaw['priority']
  if (!PRIORITIES.includes(priority)) {
    errors.push(`${ctx}: priority "${String(v.priority)}" invalid (high|medium|low|optional)`)
    return null
  }

  let effort = v.effort as LlmTaskRaw['effort']
  if (!EFFORTS.includes(effort)) {
    effort = '1hour'
    repairs.push(`${ctx}: effort "${String(v.effort)}" invalid — defaulted to 1hour`)
  }

  const subtasks = cleanStringArray(v.subtasks, SUBTASKS_MAX, SUBTASK_TITLE_MAX, repairs, `${ctx}.subtasks`)
  const tags = cleanStringArray(v.tags, TAGS_MAX, 40, repairs, `${ctx}.tags`).map((t) => t.toLowerCase())
  const clarifying_questions = cleanStringArray(v.clarifying_questions, QUESTIONS_MAX, 200, repairs, `${ctx}.questions`)

  return {
    title: title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title,
    summary,
    deadline,
    deadline_type,
    priority,
    effort,
    subtasks,
    tags,
    clarifying_questions
  }
}

/** Validate a full extraction response ({"tasks": [...]}) from raw response text.
 *  An empty tasks array is OK (junk input → "nothing actionable") — the pipeline decides policy. */
export function coerceExtraction(raw: string): CoerceResult<LlmExtraction> {
  const json = extractJson(raw)
  if (json === undefined) return { ok: false, errors: ['response is not parseable JSON'] }
  if (!isRecord(json) || !Array.isArray(json.tasks)) {
    return { ok: false, errors: ['response missing "tasks" array'] }
  }

  const errors: string[] = []
  const repairs: string[] = []
  const tasks: LlmTaskRaw[] = []
  json.tasks.slice(0, TASKS_PER_EXTRACTION_MAX).forEach((t, i) => {
    const task = coerceTask(t, errors, repairs, `tasks[${i}]`)
    if (task) tasks.push(task)
  })
  if (json.tasks.length > TASKS_PER_EXTRACTION_MAX) {
    repairs.push(`tasks: clamped ${json.tasks.length} → ${TASKS_PER_EXTRACTION_MAX}`)
  }

  // Any per-task hard error fails the whole extraction — partial results would silently drop asks.
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { tasks }, repairs }
}

/** Validate a single-task response (re-enrichment — same schema minus the outer wrapper). */
export function coerceSingleTask(raw: string): CoerceResult<LlmTaskRaw> {
  const json = extractJson(raw)
  if (json === undefined) return { ok: false, errors: ['response is not parseable JSON'] }
  const errors: string[] = []
  const repairs: string[] = []
  const task = coerceTask(json, errors, repairs)
  if (!task) return { ok: false, errors }
  return { ok: true, value: task, repairs }
}

/** Validate the briefing response ({"briefing": "..."}) — returns the sentence or null. */
export function coerceBriefing(raw: string): string | null {
  const json = extractJson(raw)
  if (!isRecord(json)) return null
  const text = typeof json.briefing === 'string' ? json.briefing.trim() : ''
  return text.length > 0 ? text : null
}
