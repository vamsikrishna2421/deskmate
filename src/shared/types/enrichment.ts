/** LLM pipeline + briefing types. Pure — no Electron/Node imports. */

import type { Priority } from './task'

/** Exactly the JSON shape the extraction prompt asks the model for (docs/LLM_PIPELINE.md §1–2). */
export interface LlmTaskRaw {
  title: string
  summary: string
  /** Relative token: today|tomorrow|monday..sunday|next-monday..next-sunday|next-week|next-month|none|YYYY-MM-DD */
  deadline: string
  deadline_type: 'hard' | 'soft' | 'none'
  priority: 'high' | 'medium' | 'low' | 'optional'
  effort: '15min' | '1hour' | 'half-day' | 'multi-day'
  subtasks: string[]
  tags: string[]
  clarifying_questions: string[]
}

export interface LlmExtraction {
  tasks: LlmTaskRaw[]
}

export type CoerceResult<T> =
  | { ok: true; value: T; repairs: string[] }
  | { ok: false; errors: string[] }

/** Pre-hints captured locally (regex / Tab chip in the capture window) — lock fields as user-owned. */
export interface CaptureHints {
  deadline?: 'today' | 'week' | 'later'
  kind?: 'hard' | 'soft'
  tags?: string[]
}

export interface BriefTaskRef {
  id: string
  title: string
  daysOverdue?: number
  daysStalled?: number
  priority: Priority
  effortMinutes?: number
}

export interface BriefingQuestionRef {
  taskId: string
  questionId: string
  question: string
}

export interface Briefing {
  dateKey: string
  overdue: BriefTaskRef[]
  dueToday: BriefTaskRef[]
  dueThisWeek: BriefTaskRef[]
  stalled: BriefTaskRef[]
  /** ≤2 open loops surfaced inline in the briefing. */
  questions: BriefingQuestionRef[]
  /** One LLM sentence, arrives async via 'briefing:synthesis' push; deterministic fallback rendered instantly. */
  synthesis?: string
  effortTodayMinutes?: number
}
