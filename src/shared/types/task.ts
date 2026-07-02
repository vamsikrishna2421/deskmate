/** Core task domain types. Pure — no Electron/Node imports (shared across main/preload/renderer). */

export type TaskStatus = 'inbox' | 'open' | 'in_progress' | 'blocked' | 'done' | 'archived'

/** 'urgent' is manual-only; the LLM maps high→high, medium→normal, low→low, optional→optional. */
export type Priority = 'urgent' | 'high' | 'normal' | 'low' | 'optional'

export type Effort = 'minutes' | 'hour' | 'half_day' | 'day' | 'multi_day'

export type FieldSource = 'llm' | 'user'

export interface Deadline {
  kind: 'hard' | 'soft' | 'none'
  /** 'YYYY-MM-DD' local date, resolved deterministically — never by the LLM. */
  dueDate?: string
  /** 'HH:mm' — user-set only in v1. Absent means "by end of that day". */
  dueTime?: string
  source: FieldSource
  /** The LLM's relative token ('friday', 'next-week', …) kept for provenance tooltips. */
  rawToken?: string
  /** True when the token was approximate ('next-week'/'next-month') — UI renders the phrase, date is for sorting only. */
  approx?: boolean
}

export interface Subtask {
  id: string
  title: string
  done: boolean
  source: FieldSource
}

export interface OpenQuestion {
  id: string
  question: string
  answer?: string
  status: 'open' | 'answered' | 'dismissed'
  answeredAt?: string
}

/** Per-field merge guard: enrichment may only write fields still owned by 'llm'. */
export interface FieldProvenance {
  title: FieldSource
  summary: FieldSource
  priority: FieldSource
  effort: FieldSource
  tags: FieldSource
}

export type EnrichmentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface EnrichmentInfo {
  status: EnrichmentStatus
  model?: string
  attempts: number
  error?: string
  lastRunAt?: string
  /** Set when the parse degraded or a resolved date needed review. */
  needsReview?: boolean
}

export interface ReminderState {
  dueSoonNotifiedAt?: string
  overdueNotifiedAt?: string
}

export interface QaRecord {
  question: string
  answer: string
  at: string
}

export interface Task {
  id: string
  title: string
  summary?: string
  /** The raw captured text — sacred, always recoverable. */
  sourceText: string
  sourceKind: 'paste' | 'typed'
  status: TaskStatus
  deadline: Deadline
  priority: Priority
  effort?: Effort
  tags: string[]
  subtasks: Subtask[]
  questions: OpenQuestion[]
  /** Raw Q&A history — safety net; re-enrichment may drop a detail, this never does. */
  qaHistory: QaRecord[]
  /** Dismissed question texts, remembered so re-enrichment never re-asks. */
  dismissedQuestionTexts: string[]
  provenance: FieldProvenance
  enrichment: EnrichmentInfo
  reminders: ReminderState
  /** ★ focus star — max 3 alive app-wide, enforced in main. */
  focus: boolean
  /** "Picked for today" — pulled into the Today view by the user. */
  pinned: boolean
  createdAt: string
  updatedAt: string
  completedAt?: string
  /** Any user touch. Drives "quiet for a while" (stalled = 5+ workdays untouched). */
  activityAt: string
}

/** Fields a user (or main-process action) may patch directly. Patching a provenance-guarded
 *  field flips its provenance to 'user' permanently. */
export interface TaskPatch {
  title?: string
  summary?: string
  status?: TaskStatus
  deadline?: Partial<Deadline>
  priority?: Priority
  effort?: Effort
  tags?: string[]
  subtasks?: Subtask[]
  focus?: boolean
  pinned?: boolean
}
