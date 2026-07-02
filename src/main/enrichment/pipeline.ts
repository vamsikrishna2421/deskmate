/** Enrichment orchestration: capture → LLM extraction → provenance-aware merge, plus Q&A
 *  re-enrichment and briefing synthesis (docs/LLM_PIPELINE.md §7, ARCHITECTURE.md §2.8).
 *  The LLM is assistive, never blocking: the raw card already exists; failure leaves it usable. */

import type { Task } from '@shared/types/task'
import type { LlmTaskRaw } from '@shared/types/enrichment'
import {
  LLM_OPTIONS,
  PASTE_CAP_HEAD,
  PASTE_CAP_TAIL,
  PASTE_CAP_TOTAL,
  PASTE_TRIM_MARKER
} from '@shared/constants'
import { coerceBriefing, coerceExtraction, coerceSingleTask } from '@shared/llm/coerceParse'
import { deadlineNeedsReview } from '@shared/llm/mapLlm'
import type { TasksRepo } from '../store/tasksRepo'
import type { AppStateRepo } from '../store/appStateRepo'
import { OllamaError, type OllamaClient } from '../llm/ollamaClient'
import type { JobLane, RequestQueue } from '../llm/requestQueue'
import {
  BRIEFING_FORMAT,
  EXTRACTION_FORMAT,
  SINGLE_TASK_FORMAT,
  briefingSystemPrompt,
  buildReenrichUserMessage,
  deriveLockedFields,
  extractionSystemPrompt,
  reenrichSystemPrompt,
  strictRetryLine,
  taskToLlmVocab
} from '../llm/prompts'

export interface PipelineDeps {
  tasksRepo: TasksRepo
  appStateRepo: AppStateRepo
  client: OllamaClient
  queue: RequestQueue
  pushEnrichment: (p: {
    taskId: string
    status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'
    error?: string
  }) => void
  now?: () => Date
}

interface ChatCallOptions {
  temperature: number
  num_predict: number
  timeoutMs: number
}

type Attempt<T> = { ok: true; value: T } | { ok: false; errors: string[]; offline?: boolean }

const NO_MODEL_ERROR = 'no-model'
const NOTHING_ACTIONABLE = 'nothing actionable found'
const EMPTY_TASKS_ERROR = 'the tasks array was empty for a message that contains an ask'
/** Empty tasks[] on input longer than this is a hard failure worth a strict retry. */
const JUNK_INPUT_MAX_CHARS = 40
const WARMUP_TIMEOUT_MS = 60_000
const BRIEFING_JOB_KEY = 'briefing:synthesis'
const WARMUP_JOB_KEY = 'warmup'

/** Deterministic paste cap — Ollama silently keeps only the trailing ~num_ctx/2 tokens of an
 *  oversized request, eating the system prompt itself (LLM_PIPELINE.md §9). */
export function capPaste(text: string): string {
  if (text.length <= PASTE_CAP_TOTAL) return text
  return text.slice(0, PASTE_CAP_HEAD) + PASTE_TRIM_MARKER + text.slice(text.length - PASTE_CAP_TAIL)
}

function errorText(err: unknown): string {
  if (err instanceof OllamaError) return `${err.kind}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

/** Mandatory post-step: locked-field prompt compliance is ~50% at 3B — enforce in code
 *  (LLM_PIPELINE.md §0.3) before the provenance-aware merge double-checks it again. */
function copyLockedFields(out: LlmTaskRaw, task: Task): LlmTaskRaw {
  const locked = new Set(deriveLockedFields(task))
  if (locked.size === 0) return out
  const vocab = taskToLlmVocab(task)
  const merged: LlmTaskRaw = { ...out }
  if (locked.has('title')) merged.title = vocab.title
  if (locked.has('summary')) merged.summary = vocab.summary
  if (locked.has('priority')) merged.priority = vocab.priority
  if (locked.has('effort')) merged.effort = vocab.effort
  if (locked.has('tags')) merged.tags = [...vocab.tags]
  if (locked.has('deadline')) {
    merged.deadline = vocab.deadline
    merged.deadline_type = vocab.deadline_type
  }
  return merged
}

export class EnrichmentPipeline {
  private readonly deps: PipelineDeps
  private paused: boolean
  private prevReachable: boolean
  private lastQueueSize = 0
  /** Job thunks held while the assistant is paused, keyed by taskId (latest wins). */
  private readonly held = new Map<string, () => void>()

  constructor(deps: PipelineDeps) {
    this.deps = deps
    this.paused = deps.appStateRepo.get().ollama.paused
    this.prevReachable = deps.client.status().reachable
    deps.queue.onChange((size) => {
      const wasIdle = this.lastQueueSize === 0
      this.lastQueueSize = size
      if (wasIdle && size > 0) void this.deps.client.health()
    })
    deps.client.onStatusChange((s) => {
      const flippedReachable = s.reachable && !this.prevReachable
      this.prevReachable = s.reachable
      if (flippedReachable) this.retryAllFailed()
    })
    deps.tasksRepo.onChange((c) => {
      for (const id of c.deletedIds) {
        this.held.delete(id)
        this.deps.queue.abort(id)
      }
    })
  }

  enqueueExtraction(task: Task): void {
    this.submitTaskJob(task.id, 'interactive', (signal) => this.runExtraction(task.id, signal))
  }

  enqueueReenrich(taskId: string): void {
    // Latest context wins (ARCHITECTURE §2.7): a running job for this task is stale the moment
    // the user adds an answer — abort it so the fresh job doesn't double-run behind it.
    if (this.deps.queue.isActive(taskId)) this.deps.queue.abort(taskId)
    this.submitReenrich(taskId, 'interactive')
  }

  requestBriefingSynthesis(digest: string, onText: (text: string | null) => void): void {
    if (this.paused) {
      onText(null)
      return
    }
    this.deps.queue.enqueue({
      key: BRIEFING_JOB_KEY,
      lane: 'background',
      run: async (signal) => {
        try {
          if (this.paused) {
            onText(null)
            return
          }
          const model = await this.deps.client.pickModel()
          if (!model || signal.aborted) {
            onText(null)
            return
          }
          const raw = await this.deps.client.chat({
            model,
            system: briefingSystemPrompt(this.now()),
            user: digest,
            format: BRIEFING_FORMAT,
            temperature: LLM_OPTIONS.briefing.temperature,
            numPredict: LLM_OPTIONS.briefing.num_predict,
            timeoutMs: LLM_OPTIONS.briefing.timeoutMs,
            signal
          })
          onText(coerceBriefing(raw))
        } catch {
          onText(null)
        }
      }
    })
  }

  retryAllFailed(): void {
    for (const task of this.deps.tasksRepo.list()) {
      if (task.enrichment.status !== 'failed' && task.enrichment.status !== 'skipped') continue
      // Bulk retry brings no new context — never double-run a task whose job is active or held.
      if (this.deps.queue.isActive(task.id) || this.held.has(task.id)) continue
      this.submitReenrich(task.id, 'background')
    }
  }

  /** Startup recovery: tasks persisted mid-enrichment ('pending'/'running' on disk) would
   *  otherwise show an infinite "Reading…" pulse with no job behind it. */
  recoverInterrupted(): void {
    for (const task of this.deps.tasksRepo.list()) {
      if (task.status === 'done' || task.status === 'archived') continue
      if (task.enrichment.status !== 'pending' && task.enrichment.status !== 'running') continue
      if (this.deps.queue.isActive(task.id) || this.held.has(task.id)) continue
      this.submitReenrich(task.id, 'background')
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return
    this.paused = paused
    if (paused) return
    const thunks = [...this.held.values()]
    this.held.clear()
    for (const enqueue of thunks) enqueue()
  }

  /** One-token chat to load the model into memory at app start (~2.5 s saved per later call).
   *  Background lane; all errors swallowed. */
  warmUp(): void {
    this.deps.queue.enqueue({
      key: WARMUP_JOB_KEY,
      lane: 'background',
      run: async (signal) => {
        try {
          if (this.paused) return
          const reachable = await this.deps.client.health()
          if (!reachable || signal.aborted) return
          const model = await this.deps.client.pickModel()
          if (!model || signal.aborted) return
          await this.deps.client.chat({
            model,
            system: 'Reply with the single word ok.',
            user: 'ok',
            temperature: 0,
            numPredict: 1,
            timeoutMs: WARMUP_TIMEOUT_MS,
            signal
          })
        } catch {
          /* warm-up is best-effort */
        }
      }
    })
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date()
  }

  /** Retry with answered Q&A when it exists; a plain failed extraction retries as extraction. */
  private submitReenrich(taskId: string, lane: JobLane): void {
    const task = this.deps.tasksRepo.get(taskId)
    if (!task) return
    if (task.qaHistory.length === 0) {
      this.submitTaskJob(taskId, lane, (signal) => this.runExtraction(taskId, signal))
      return
    }
    this.submitTaskJob(taskId, lane, (signal) => this.runReenrich(taskId, signal))
  }

  private submitTaskJob(taskId: string, lane: JobLane, run: (signal: AbortSignal) => Promise<void>): void {
    const wrapped = async (signal: AbortSignal): Promise<void> => {
      if (this.paused) {
        this.held.set(taskId, enqueue)
        return
      }
      await run(signal)
    }
    const enqueue = (): void => this.deps.queue.enqueue({ key: taskId, lane, run: wrapped })
    this.deps.pushEnrichment({ taskId, status: 'queued' })
    if (this.paused) this.held.set(taskId, enqueue)
    else enqueue()
  }

  private async runExtraction(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.deps.tasksRepo.get(taskId)
    if (!task) return
    const baseAttempts = task.enrichment.attempts
    const model = await this.deps.client.pickModel()
    if (signal.aborted || !this.deps.tasksRepo.get(taskId)) return
    if (!model) {
      this.markSkipped(taskId, NO_MODEL_ERROR)
      return
    }
    this.markRunning(taskId, model)

    const system = extractionSystemPrompt(this.now())
    const user = capPaste(task.sourceText)
    const substantiveInput = task.sourceText.trim().length > JUNK_INPUT_MAX_CHARS

    try {
      let attemptsUsed = 1
      let result = await this.attemptExtraction(model, system, user, LLM_OPTIONS.extraction, signal)
      if (!result.ok && result.offline) {
        // Server unreachable — DESIGN §12 offline state, not a parse failure. Auto-resumes.
        this.markSkipped(taskId, result.errors.join('; '))
        return
      }
      const hardFailure = !result.ok || (result.value.length === 0 && substantiveInput)
      if (hardFailure) {
        const errors = result.ok ? [EMPTY_TASKS_ERROR] : result.errors
        attemptsUsed = 2
        result = await this.attemptExtraction(
          model,
          `${system}\n${strictRetryLine(errors)}`,
          user,
          LLM_OPTIONS.extractionRetry,
          signal
        )
      }
      if (!result.ok) {
        if (result.offline) {
          this.markSkipped(taskId, result.errors.join('; '))
          return
        }
        // Degrade to raw: the card already exists as captured — never overwrite its fields.
        this.markFailed(taskId, result.errors.join('; '), attemptsUsed, model, true)
        return
      }
      if (result.value.length === 0) {
        if (substantiveInput) {
          // A real ask the model twice returned nothing for — keep the retry affordance alive.
          this.markFailed(taskId, NOTHING_ACTIONABLE, attemptsUsed, model, true)
          return
        }
        // Junk input ("lol ok thanks") — nothing actionable is the correct, final answer.
        const now = this.now()
        this.deps.tasksRepo.setEnrichment(taskId, {
          status: 'done',
          model,
          attempts: baseAttempts + attemptsUsed,
          lastRunAt: now.toISOString(),
          error: NOTHING_ACTIONABLE,
          needsReview: true
        }, now)
        this.deps.pushEnrichment({ taskId, status: 'done' })
        return
      }
      this.applyExtraction(taskId, task, result.value, model, baseAttempts + attemptsUsed)
    } catch (err) {
      if (signal.aborted) return
      if (err instanceof OllamaError && err.kind === 'network') this.markSkipped(taskId, errorText(err))
      else this.markFailed(taskId, errorText(err), 1, model, true)
    }
  }

  /** First task enriches the original card; each additional task becomes a new card. */
  private applyExtraction(taskId: string, original: Task, tasks: LlmTaskRaw[], model: string, attempts: number): void {
    const now = this.now()
    const capturedAt = new Date(original.createdAt)
    const doneAt = now.toISOString()
    const [first, ...rest] = tasks

    const updated = this.deps.tasksRepo.applyEnrichment(taskId, first, capturedAt, now)
    if (updated) {
      this.deps.tasksRepo.setEnrichment(taskId, {
        status: 'done',
        model,
        attempts,
        lastRunAt: doneAt,
        error: undefined,
        needsReview: deadlineNeedsReview(first, capturedAt) || undefined
      }, now)
      this.deps.pushEnrichment({ taskId, status: 'done' })
    }

    for (const extra of rest) {
      const created = this.deps.tasksRepo.createFromCapture(
        { sourceText: original.sourceText, sourceKind: original.sourceKind },
        now
      )
      this.deps.tasksRepo.applyEnrichment(created.id, extra, capturedAt, now)
      this.deps.tasksRepo.setEnrichment(created.id, {
        status: 'done',
        model,
        attempts: 1,
        lastRunAt: doneAt,
        needsReview: deadlineNeedsReview(extra, capturedAt) || undefined
      }, now)
      this.deps.pushEnrichment({ taskId: created.id, status: 'done' })
    }
  }

  private async runReenrich(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.deps.tasksRepo.get(taskId)
    if (!task) return
    const baseAttempts = task.enrichment.attempts
    const model = await this.deps.client.pickModel()
    if (signal.aborted || !this.deps.tasksRepo.get(taskId)) return
    if (!model) {
      this.markSkipped(taskId, NO_MODEL_ERROR)
      return
    }
    this.markRunning(taskId, model)

    const system = reenrichSystemPrompt(this.now())
    const user = buildReenrichUserMessage(task)

    try {
      let attemptsUsed = 1
      let result = await this.attemptSingle(model, system, user, LLM_OPTIONS.reenrich, signal)
      if (!result.ok) {
        attemptsUsed = 2
        result = await this.attemptSingle(
          model,
          `${system}\n${strictRetryLine(result.errors)}`,
          user,
          { ...LLM_OPTIONS.reenrich, temperature: 0 },
          signal
        )
      }
      if (!result.ok) {
        if (result.offline) this.markSkipped(taskId, result.errors.join('; '))
        else this.markFailed(taskId, result.errors.join('; '), attemptsUsed, model, true)
        return
      }
      const fresh = this.deps.tasksRepo.get(taskId)
      if (!fresh) return
      const output = copyLockedFields(result.value, fresh)
      // Answers were just given — resolve any new deadline token against now, not capture time.
      const now = this.now()
      const updated = this.deps.tasksRepo.applyEnrichment(taskId, output, now, now)
      if (!updated) return
      this.deps.tasksRepo.setEnrichment(taskId, {
        status: 'done',
        model,
        attempts: baseAttempts + attemptsUsed,
        lastRunAt: now.toISOString(),
        error: undefined,
        needsReview: deadlineNeedsReview(output, now) || undefined
      }, now)
      this.deps.pushEnrichment({ taskId, status: 'done' })
    } catch (err) {
      if (signal.aborted) return
      this.markFailed(taskId, errorText(err), 1, model, true)
    }
  }

  private async attemptExtraction(
    model: string,
    system: string,
    user: string,
    opts: ChatCallOptions,
    signal: AbortSignal
  ): Promise<Attempt<LlmTaskRaw[]>> {
    let raw: string
    try {
      raw = await this.chat(model, system, user, EXTRACTION_FORMAT, opts, signal)
    } catch (err) {
      if (signal.aborted) throw err
      return { ok: false, errors: [errorText(err)], offline: err instanceof OllamaError && err.kind === 'network' }
    }
    const res = coerceExtraction(raw)
    return res.ok ? { ok: true, value: res.value.tasks } : { ok: false, errors: res.errors }
  }

  private async attemptSingle(
    model: string,
    system: string,
    user: string,
    opts: ChatCallOptions,
    signal: AbortSignal
  ): Promise<Attempt<LlmTaskRaw>> {
    let raw: string
    try {
      raw = await this.chat(model, system, user, SINGLE_TASK_FORMAT, opts, signal)
    } catch (err) {
      if (signal.aborted) throw err
      return { ok: false, errors: [errorText(err)], offline: err instanceof OllamaError && err.kind === 'network' }
    }
    const res = coerceSingleTask(raw)
    return res.ok ? { ok: true, value: res.value } : { ok: false, errors: res.errors }
  }

  private chat(
    model: string,
    system: string,
    user: string,
    format: object,
    opts: ChatCallOptions,
    signal: AbortSignal
  ): Promise<string> {
    return this.deps.client.chat({
      model,
      system,
      user,
      format,
      temperature: opts.temperature,
      numPredict: opts.num_predict,
      timeoutMs: opts.timeoutMs,
      signal
    })
  }

  private markRunning(taskId: string, model: string): void {
    this.deps.tasksRepo.setEnrichment(taskId, { status: 'running', model }, this.now())
    this.deps.pushEnrichment({ taskId, status: 'running' })
  }

  /** Offline / no model: DESIGN §12 "saved as written" — retries automatically when health flips. */
  private markSkipped(taskId: string, error: string): void {
    const task = this.deps.tasksRepo.get(taskId)
    if (!task) return
    const now = this.now()
    this.deps.tasksRepo.setEnrichment(
      taskId,
      { status: 'skipped', error, lastRunAt: now.toISOString() },
      now
    )
    this.deps.pushEnrichment({ taskId, status: 'skipped', error })
  }

  private markFailed(taskId: string, error: string, attemptsUsed: number, model?: string, needsReview?: boolean): void {
    const task = this.deps.tasksRepo.get(taskId)
    if (!task) return
    const now = this.now()
    this.deps.tasksRepo.setEnrichment(taskId, {
      status: 'failed',
      error,
      attempts: task.enrichment.attempts + attemptsUsed,
      lastRunAt: now.toISOString(),
      ...(model ? { model } : {}),
      ...(needsReview ? { needsReview: true } : {})
    }, now)
    this.deps.pushEnrichment({ taskId, status: 'failed', error })
  }
}
