/** Pure mapping from validated LLM output to domain fields. Enrichment merge policy lives in
 *  main/enrichment/pipeline.ts — this file only translates vocabularies. No Electron/Node imports. */

import type { LlmTaskRaw } from '../types/enrichment'
import type { Deadline, Effort, Priority } from '../types/task'
import { resolveDeadline } from '../dates/resolveDeadline'

export function mapLlmPriority(p: LlmTaskRaw['priority']): Priority {
  switch (p) {
    case 'high':
      return 'high'
    case 'medium':
      return 'normal'
    case 'low':
      return 'low'
    case 'optional':
      return 'optional'
  }
}

export function mapLlmEffort(e: LlmTaskRaw['effort']): Effort {
  switch (e) {
    case '15min':
      return 'minutes'
    case '1hour':
      return 'hour'
    case 'half-day':
      return 'half_day'
    case 'multi-day':
      return 'multi_day'
  }
}

/** Resolve token + type into a Deadline. `capturedAt` anchors the date math (never "now" at
 *  enrichment time — a task captured Friday enriched after midnight must still mean that Friday). */
export function mapLlmDeadline(task: LlmTaskRaw, capturedAt: Date): Deadline {
  if (task.deadline === 'none' || task.deadline_type === 'none') {
    return { kind: 'none', source: 'llm', rawToken: task.deadline }
  }
  const resolved = resolveDeadline(task.deadline, capturedAt)
  if (!resolved.valid || resolved.date === null) {
    // Syntactically valid but unresolvable (e.g. 2026-02-30): keep the task, flag for review.
    return { kind: 'none', source: 'llm', rawToken: task.deadline }
  }
  return {
    kind: task.deadline_type,
    dueDate: resolved.date,
    source: 'llm',
    rawToken: task.deadline,
    approx: resolved.approx || undefined
  }
}

/** True when the resolved deadline needs user review (unresolvable but the model asserted timing). */
export function deadlineNeedsReview(task: LlmTaskRaw, capturedAt: Date): boolean {
  if (task.deadline === 'none' || task.deadline_type === 'none') return false
  const resolved = resolveDeadline(task.deadline, capturedAt)
  return !resolved.valid || resolved.date === null
}
