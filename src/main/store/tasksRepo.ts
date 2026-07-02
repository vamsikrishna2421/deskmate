/** Tasks repository over tasks.json: CRUD, provenance-aware enrichment merge, change events
 *  (ARCHITECTURE.md §2.5/§2.8, DESIGN.md §5–§7). */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { CaptureHints, LlmTaskRaw } from '../../shared/types/enrichment'
import type {
  Deadline,
  EnrichmentInfo,
  FieldProvenance,
  OpenQuestion,
  Subtask,
  Task,
  TaskPatch,
  TaskStatus,
  TrashEntry
} from '../../shared/types/task'
import {
  FOCUS_STARS_MAX,
  SCHEMA_VERSION,
  SOURCE_TEXT_MAX,
  SUBTASKS_MAX,
  SUBTASK_TITLE_MAX,
  TITLE_MAX
} from '../../shared/constants'
import { isRealDate } from '../../shared/dates/dayMath'
import { resolveDeadline } from '../../shared/dates/resolveDeadline'
import { deadlineNeedsReview, mapLlmDeadline, mapLlmEffort, mapLlmPriority } from '../../shared/llm/mapLlm'
import { JsonStore } from './jsonStore'
import { backupDirFor } from './backup'
import { migrateDoc, ReadOnlyStoreError } from './migrations'

const CAPTURE_TITLE_MAX = 80
/** Let go bin retention: restorable this long, then pruned on load. */
const TRASH_KEEP_DAYS = 30
const TRASH_MAX = 200

interface TasksDoc {
  schemaVersion: number
  tasks: Task[]
  trash?: TrashEntry[]
}

export interface TasksChange {
  upserted: Task[]
  deletedIds: string[]
}

function iso(d: Date): string {
  return d.toISOString()
}

/** Dedupe key: lowercase, punctuation stripped, whitespace collapsed. */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const t of tags) {
    const tag = t.trim().toLowerCase()
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** One malformed task on disk must never poison the scheduler/briefing: coerce every
 *  structural field to a safe shape; drop only entries with no usable identity. */
function sanitizeTasks(doc: unknown): Task[] {
  if (typeof doc !== 'object' || doc === null) return []
  const tasks = (doc as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return []
  const out: Task[] = []
  for (const raw of tasks) {
    if (typeof raw !== 'object' || raw === null) continue
    const t = raw as Partial<Task> & Record<string, unknown>
    if (typeof t.id !== 'string' || t.id.length === 0) continue
    const sourceText = typeof t.sourceText === 'string' ? t.sourceText : ''
    const title =
      typeof t.title === 'string' && t.title.trim()
        ? t.title
        : sourceText.split(/\r?\n/, 1)[0]?.slice(0, CAPTURE_TITLE_MAX) || 'Untitled task'
    const deadline: Deadline =
      typeof t.deadline === 'object' && t.deadline !== null && typeof (t.deadline as Deadline).kind === 'string'
        ? {
            ...(t.deadline as Deadline),
            dueDate:
              typeof (t.deadline as Deadline).dueDate === 'string' && isRealDate((t.deadline as Deadline).dueDate!)
                ? (t.deadline as Deadline).dueDate
                : undefined
          }
        : { kind: 'none', source: 'user' }
    if (deadline.kind !== 'hard' && deadline.kind !== 'soft' && deadline.kind !== 'none') deadline.kind = 'none'
    const nowIso = typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString()
    out.push({
      ...t,
      id: t.id,
      title,
      sourceText,
      sourceKind: t.sourceKind === 'typed' ? 'typed' : 'paste',
      status: (['inbox', 'open', 'in_progress', 'blocked', 'done', 'archived'] as const).includes(
        t.status as TaskStatus
      )
        ? (t.status as TaskStatus)
        : 'open',
      deadline,
      priority: (['urgent', 'high', 'normal', 'low', 'optional'] as const).includes(t.priority as never)
        ? (t.priority as Task['priority'])
        : 'normal',
      tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string') : [],
      subtasks: Array.isArray(t.subtasks) ? (t.subtasks as Subtask[]).filter((s) => s && typeof s.id === 'string') : [],
      questions: Array.isArray(t.questions)
        ? (t.questions as OpenQuestion[]).filter((q) => q && typeof q.id === 'string')
        : [],
      qaHistory: Array.isArray(t.qaHistory) ? t.qaHistory : [],
      dismissedQuestionTexts: Array.isArray(t.dismissedQuestionTexts) ? t.dismissedQuestionTexts : [],
      provenance:
        typeof t.provenance === 'object' && t.provenance !== null
          ? (t.provenance as FieldProvenance)
          : { title: 'llm', summary: 'llm', priority: 'llm', effort: 'llm', tags: 'llm' },
      enrichment:
        typeof t.enrichment === 'object' && t.enrichment !== null
          ? (t.enrichment as EnrichmentInfo)
          : { status: 'done', attempts: 0 },
      reminders: typeof t.reminders === 'object' && t.reminders !== null ? (t.reminders as Task['reminders']) : {},
      focus: t.focus === true,
      pinned: t.pinned === true,
      createdAt: nowIso,
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : nowIso,
      activityAt: typeof t.activityAt === 'string' ? t.activityAt : nowIso
    })
  }
  return out
}

function deadlineFromHints(hints: CaptureHints | undefined, now: Date): Deadline {
  if (!hints?.deadline) return { kind: 'none', source: 'llm' }
  if (hints.deadline === 'later') return { kind: 'none', source: 'user' }
  const token = hints.deadline === 'today' ? 'today' : 'friday' // 'week' → the coming Friday
  const resolved = resolveDeadline(token, now)
  return { kind: hints.kind ?? 'soft', dueDate: resolved.date ?? undefined, source: 'user' }
}

function mergeUserDeadline(cur: Deadline, patch: Partial<Deadline>): Deadline {
  const next: Deadline = { ...cur, ...patch, source: 'user' }
  // A user setting a concrete date/kind is no longer an approximate range (snooze, editor).
  if (patch.dueDate !== undefined || patch.kind !== undefined) {
    if (patch.approx === undefined) delete next.approx
    if (patch.rawToken === undefined) delete next.rawToken
  }
  if (next.dueDate !== undefined && !isRealDate(next.dueDate)) {
    throw new Error(`invalid dueDate "${next.dueDate}" — expected a real YYYY-MM-DD`)
  }
  if (next.dueTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.dueTime)) {
    throw new Error(`invalid dueTime "${next.dueTime}" — expected HH:mm`)
  }
  if (next.kind === 'none') {
    delete next.dueDate
    delete next.dueTime
    delete next.rawToken
    delete next.approx
  }
  return next
}

/** A changed due moment means old reminder dedupe stamps no longer apply. */
function reminderResetIfMoved(cur: Deadline, next: Deadline, reminders: Task['reminders']): Task['reminders'] {
  const moved = cur.dueDate !== next.dueDate || cur.dueTime !== next.dueTime || cur.kind !== next.kind
  return moved ? {} : reminders
}

function applyStatusChange(next: Task, status: TaskStatus, nowIso: string): void {
  next.status = status
  if (status === 'done') next.completedAt = next.completedAt ?? nowIso
  else if (status !== 'archived') next.completedAt = undefined
}

export class TasksRepo {
  private readonly store: JsonStore<TasksDoc>
  private readonly tasks = new Map<string, Task>()
  private trash: TrashEntry[] = []
  private readonly listeners = new Set<(c: TasksChange) => void>()
  private readonly trashListeners = new Set<(t: TrashEntry[]) => void>()
  private readonly readOnlyMode: boolean

  private constructor(store: JsonStore<TasksDoc>, tasks: Task[], trash: TrashEntry[], readOnly: boolean) {
    this.store = store
    this.readOnlyMode = readOnly
    for (const t of tasks) this.tasks.set(t.id, t)
    this.trash = trash
  }

  static async load(dataDir: string): Promise<TasksRepo> {
    const filePath = join(dataDir, 'tasks.json')
    const backupDir = backupDirFor(dataDir)
    const store = new JsonStore<TasksDoc>(filePath, { schemaVersion: SCHEMA_VERSION, tasks: [] }, { backupDir })
    const loaded = await store.load()
    let doc: Record<string, unknown> =
      typeof loaded === 'object' && loaded !== null ? (loaded as unknown as Record<string, unknown>) : {}
    let readOnly = false
    let migrated = false
    try {
      const result = await migrateDoc(doc, { filePath, backupDir })
      doc = result.doc
      migrated = result.migrated
    } catch (err) {
      if (err instanceof ReadOnlyStoreError) readOnly = true
      else throw err
    }
    // Let go bin: sanitize entries and prune anything past retention.
    const cutoff = Date.now() - TRASH_KEEP_DAYS * 86_400_000
    const rawTrash = Array.isArray((doc as { trash?: unknown }).trash)
      ? ((doc as { trash: unknown[] }).trash as Array<{ task?: unknown; letGoAt?: unknown }>)
      : []
    const trash: TrashEntry[] = []
    for (const e of rawTrash) {
      if (typeof e !== 'object' || e === null || typeof e.letGoAt !== 'string') continue
      const at = Date.parse(e.letGoAt)
      if (Number.isNaN(at) || at < cutoff) continue
      const [task] = sanitizeTasks({ tasks: [e.task] })
      if (task) trash.push({ task, letGoAt: e.letGoAt })
    }
    const repo = new TasksRepo(store, sanitizeTasks(doc), trash, readOnly)
    if (migrated && !readOnly) repo.persist()
    return repo
  }

  /** True when the on-disk schema is newer than this build — user mutations are refused. */
  get readOnly(): boolean {
    return this.readOnlyMode
  }

  onChange(cb: (c: TasksChange) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  list(): Task[] {
    return [...this.tasks.values()]
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  createFromCapture(
    req: { sourceText: string; sourceKind: 'paste' | 'typed'; hints?: CaptureHints },
    now: Date
  ): Task {
    this.assertWritable()
    const sourceText = req.sourceText.slice(0, SOURCE_TEXT_MAX)
    const trimmed = sourceText.trim()
    if (!trimmed) throw new Error('sourceText cannot be empty')
    const nowIso = iso(now)
    const hints = req.hints
    const hasUserTags = (hints?.tags?.length ?? 0) > 0
    const task: Task = {
      id: randomUUID(),
      title: (trimmed.split(/\r?\n/, 1)[0] ?? trimmed).trim().slice(0, CAPTURE_TITLE_MAX),
      summary: undefined,
      sourceText,
      sourceKind: req.sourceKind,
      status: 'inbox',
      deadline: deadlineFromHints(hints, now),
      priority: 'normal',
      effort: undefined,
      tags: hasUserTags ? normalizeTags(hints?.tags ?? []) : [],
      subtasks: [],
      questions: [],
      qaHistory: [],
      dismissedQuestionTexts: [],
      provenance: {
        title: 'llm',
        summary: 'llm',
        priority: 'llm',
        effort: 'llm',
        tags: hasUserTags ? 'user' : 'llm'
      },
      enrichment: { status: 'pending', attempts: 0 },
      reminders: {},
      focus: false,
      pinned: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      activityAt: nowIso
    }
    this.tasks.set(task.id, task)
    this.commit([task])
    return task
  }

  /** Flips provenance→'user' for every provided guarded field; enforces FOCUS_STARS_MAX. */
  updateFromUser(id: string, patch: TaskPatch, now: Date): Task {
    this.assertWritable()
    const cur = this.mustGet(id)
    const nowIso = iso(now)
    const provenance: FieldProvenance = { ...cur.provenance }
    const next: Task = { ...cur, provenance }

    if (patch.title !== undefined) {
      const title = patch.title.trim()
      if (!title) throw new Error('title cannot be empty')
      next.title = title.slice(0, TITLE_MAX)
      provenance.title = 'user'
    }
    if (patch.summary !== undefined) {
      next.summary = patch.summary.trim() || undefined
      provenance.summary = 'user'
    }
    if (patch.priority !== undefined) {
      next.priority = patch.priority
      provenance.priority = 'user'
    }
    if (patch.effort !== undefined) {
      next.effort = patch.effort
      provenance.effort = 'user'
    }
    if (patch.tags !== undefined) {
      next.tags = normalizeTags(patch.tags)
      provenance.tags = 'user'
    }
    if (patch.deadline !== undefined) {
      next.deadline = mergeUserDeadline(cur.deadline, patch.deadline)
      next.reminders = reminderResetIfMoved(cur.deadline, next.deadline, cur.reminders)
    }
    if (patch.subtasks !== undefined) {
      next.subtasks = patch.subtasks.map(
        (s): Subtask => ({ ...s, id: s.id || randomUUID(), title: s.title.slice(0, SUBTASK_TITLE_MAX) })
      )
    }
    if (patch.status !== undefined) applyStatusChange(next, patch.status, nowIso)
    if (patch.pinned !== undefined) next.pinned = patch.pinned
    if (patch.focus !== undefined) {
      if (patch.focus && !cur.focus) this.assertFocusCapacity(id)
      next.focus = patch.focus
    }
    next.updatedAt = nowIso
    next.activityAt = nowIso
    this.tasks.set(id, next)
    this.commit([next])
    return next
  }

  setStatus(id: string, status: TaskStatus, now: Date): Task {
    this.assertWritable()
    const cur = this.mustGet(id)
    const nowIso = iso(now)
    const next: Task = { ...cur }
    applyStatusChange(next, status, nowIso)
    next.updatedAt = nowIso
    next.activityAt = nowIso
    this.tasks.set(id, next)
    this.commit([next])
    return next
  }

  toggleSubtask(taskId: string, subtaskId: string, now: Date): Task {
    this.assertWritable()
    const cur = this.mustGet(taskId)
    let found = false
    const subtasks: Subtask[] = cur.subtasks.map((s) => {
      if (s.id !== subtaskId) return s
      found = true
      return { ...s, done: !s.done }
    })
    if (!found) throw new Error(`subtask ${subtaskId} not found on task ${taskId}`)
    const nowIso = iso(now)
    const next: Task = { ...cur, subtasks, updatedAt: nowIso, activityAt: nowIso }
    this.tasks.set(taskId, next)
    this.commit([next])
    return next
  }

  answerQuestion(taskId: string, questionId: string, answer: string, now: Date): Task {
    this.assertWritable()
    const answerText = answer.trim()
    if (!answerText) throw new Error('answer cannot be empty')
    const cur = this.mustGet(taskId)
    const nowIso = iso(now)
    let target: OpenQuestion | undefined
    const questions = cur.questions.map((q) => {
      if (q.id !== questionId) return q
      const updated: OpenQuestion = { ...q, answer: answerText, status: 'answered', answeredAt: nowIso }
      target = updated
      return updated
    })
    if (!target) throw new Error(`question ${questionId} not found on task ${taskId}`)
    const next: Task = {
      ...cur,
      questions,
      qaHistory: [...cur.qaHistory, { question: target.question, answer: answerText, at: nowIso }],
      updatedAt: nowIso,
      activityAt: nowIso
    }
    this.tasks.set(taskId, next)
    this.commit([next])
    return next
  }

  /** Free-form context note → qaHistory, so re-enrichment treats it as a fresh fact. */
  addContext(id: string, note: string, now: Date): Task {
    this.assertWritable()
    const text = note.trim()
    if (!text) throw new Error('context note cannot be empty')
    const cur = this.mustGet(id)
    const nowIso = iso(now)
    const next: Task = {
      ...cur,
      qaHistory: [...cur.qaHistory, { question: 'Additional context', answer: text, at: nowIso }],
      updatedAt: nowIso,
      activityAt: nowIso
    }
    this.tasks.set(id, next)
    this.commit([next])
    return next
  }

  dismissQuestion(taskId: string, questionId: string, now: Date): Task {
    this.assertWritable()
    const cur = this.mustGet(taskId)
    let target: OpenQuestion | undefined
    const questions = cur.questions.map((q) => {
      if (q.id !== questionId) return q
      const updated: OpenQuestion = { ...q, status: 'dismissed' }
      target = updated
      return updated
    })
    if (!target) throw new Error(`question ${questionId} not found on task ${taskId}`)
    const nowIso = iso(now)
    const key = normalizeText(target.question)
    const dismissedQuestionTexts = cur.dismissedQuestionTexts.some((t) => normalizeText(t) === key)
      ? cur.dismissedQuestionTexts
      : [...cur.dismissedQuestionTexts, target.question]
    const next: Task = { ...cur, questions, dismissedQuestionTexts, updatedAt: nowIso, activityAt: nowIso }
    this.tasks.set(taskId, next)
    this.commit([next])
    return next
  }

  /** Provenance-aware merge: only 'llm'-owned fields are written; user-set deadline wins;
   *  subtasks/questions append-dedupe by normalized text; dismissed questions never return. */
  applyEnrichment(id: string, fromLlm: LlmTaskRaw, capturedAt: Date, now: Date): Task | undefined {
    const cur = this.tasks.get(id)
    if (!cur) return undefined
    const nowIso = iso(now)
    const provenance = cur.provenance
    const next: Task = { ...cur }

    if (provenance.title === 'llm') next.title = fromLlm.title.slice(0, TITLE_MAX)
    if (provenance.summary === 'llm') next.summary = fromLlm.summary
    if (provenance.priority === 'llm') next.priority = mapLlmPriority(fromLlm.priority)
    if (provenance.effort === 'llm') next.effort = mapLlmEffort(fromLlm.effort)
    if (provenance.tags === 'llm') next.tags = normalizeTags(fromLlm.tags)

    let needsReview: boolean | undefined
    if (cur.deadline.source !== 'user') {
      const mapped = mapLlmDeadline(fromLlm, capturedAt)
      // Re-enrich round-trips send the stored ISO date; the model echoing it back must not
      // silently harden an approximate range ('next-week') into a fake precise date.
      if (cur.deadline.approx && !mapped.approx && mapped.dueDate === cur.deadline.dueDate) {
        next.deadline = { ...mapped, approx: true, rawToken: cur.deadline.rawToken }
      } else {
        next.deadline = mapped
      }
      next.reminders = reminderResetIfMoved(cur.deadline, next.deadline, cur.reminders)
      needsReview = deadlineNeedsReview(fromLlm, capturedAt) || undefined
    }

    const subtasks = [...cur.subtasks]
    const seenSubtasks = new Set(subtasks.map((s) => normalizeText(s.title)))
    for (const title of fromLlm.subtasks) {
      if (subtasks.length >= SUBTASKS_MAX) break
      const key = normalizeText(title)
      if (!key || seenSubtasks.has(key)) continue
      seenSubtasks.add(key)
      subtasks.push({ id: randomUUID(), title, done: false, source: 'llm' })
    }
    next.subtasks = subtasks

    const seenQuestions = new Set(cur.questions.map((q) => normalizeText(q.question)))
    const dismissed = new Set(cur.dismissedQuestionTexts.map(normalizeText))
    const questions = [...cur.questions]
    for (const question of fromLlm.clarifying_questions) {
      const key = normalizeText(question)
      if (!key || seenQuestions.has(key) || dismissed.has(key)) continue
      seenQuestions.add(key)
      questions.push({ id: randomUUID(), question, status: 'open' })
    }
    next.questions = questions

    next.enrichment = { ...cur.enrichment, status: 'done', lastRunAt: nowIso, error: undefined, needsReview }
    if (cur.status === 'inbox') next.status = 'open'
    next.updatedAt = nowIso
    this.tasks.set(id, next)
    this.commit([next])
    return next
  }

  setEnrichment(id: string, info: Partial<EnrichmentInfo>, now: Date): Task | undefined {
    const cur = this.tasks.get(id)
    if (!cur) return undefined
    const next: Task = { ...cur, enrichment: { ...cur.enrichment, ...info }, updatedAt: iso(now) }
    this.tasks.set(id, next)
    this.commit([next])
    return next
  }

  setReminder(id: string, field: 'dueSoonNotifiedAt' | 'overdueNotifiedAt', at: string): void {
    const cur = this.tasks.get(id)
    if (!cur) return
    const next: Task = { ...cur, reminders: { ...cur.reminders, [field]: at } }
    this.tasks.set(id, next)
    this.commit([next])
  }

  /** 'Let go' is a soft delete: the task moves to the bin, restorable for 30 days. */
  delete(id: string, now: Date): void {
    this.assertWritable()
    const task = this.tasks.get(id)
    if (!task || !this.tasks.delete(id)) return
    this.trash = [{ task, letGoAt: iso(now) }, ...this.trash].slice(0, TRASH_MAX)
    this.persist()
    this.emit({ upserted: [], deletedIds: [id] })
    this.emitTrash()
  }

  trashList(): TrashEntry[] {
    return [...this.trash]
  }

  onTrashChange(cb: (t: TrashEntry[]) => void): () => void {
    this.trashListeners.add(cb)
    return () => {
      this.trashListeners.delete(cb)
    }
  }

  /** Restore from the Let go bin — the task returns exactly as it was. */
  restoreTrashed(id: string, now: Date): Task {
    this.assertWritable()
    const entry = this.trash.find((e) => e.task.id === id)
    if (!entry) throw new Error(`task ${id} is not in the Let go bin`)
    this.trash = this.trash.filter((e) => e.task.id !== id)
    const next: Task = { ...entry.task, updatedAt: iso(now), activityAt: iso(now) }
    this.tasks.set(next.id, next)
    this.commit([next])
    this.emitTrash()
    return next
  }

  flush(): Promise<void> {
    return this.store.flush()
  }

  private mustGet(id: string): Task {
    const t = this.tasks.get(id)
    if (!t) throw new Error(`task ${id} not found`)
    return t
  }

  private assertWritable(): void {
    if (this.readOnlyMode) {
      throw new Error('store is read-only — its data was written by a newer version of DeskMate')
    }
  }

  private assertFocusCapacity(exceptId: string): void {
    let alive = 0
    for (const t of this.tasks.values()) {
      if (t.id !== exceptId && t.focus && t.status !== 'done' && t.status !== 'archived') alive++
    }
    if (alive >= FOCUS_STARS_MAX) {
      throw new Error(`focus limit reached — max ${FOCUS_STARS_MAX} starred tasks`)
    }
  }

  private commit(upserted: Task[]): void {
    this.persist()
    this.emit({ upserted, deletedIds: [] })
  }

  private emit(change: TasksChange): void {
    for (const cb of this.listeners) cb(change)
  }

  private emitTrash(): void {
    const list = this.trashList()
    for (const cb of this.trashListeners) cb(list)
  }

  private persist(): void {
    if (this.readOnlyMode) return
    this.store.save({ schemaVersion: SCHEMA_VERSION, tasks: [...this.tasks.values()], trash: this.trash })
  }
}
