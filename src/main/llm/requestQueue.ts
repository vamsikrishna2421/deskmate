/** Serial LLM job queue — strict concurrency 1 (a 3B model on an office laptop must never get
 *  parallel requests). Interactive lane runs before background; FIFO within a lane. Enqueuing a
 *  job whose key matches a QUEUED job supersedes it (latest context wins); a RUNNING job is only
 *  stopped via abort(key). A job failure never stalls the queue (ARCHITECTURE.md §2.7). */

export type JobLane = 'interactive' | 'background'

export interface QueueJob {
  key: string
  lane: JobLane
  run: (signal: AbortSignal) => Promise<void>
}

export class RequestQueue {
  private readonly lanes: Record<JobLane, QueueJob[]> = { interactive: [], background: [] }
  private running: { key: string; controller: AbortController } | null = null
  private readonly listeners = new Set<(size: number) => void>()
  private lastEmitted = 0

  enqueue(job: QueueJob): void {
    this.removeQueued(job.key)
    this.lanes[job.lane].push(job)
    this.emit()
    this.pump()
  }

  /** Aborts the running job with this key (via its AbortSignal) and drops any queued one. */
  abort(key: string): void {
    this.removeQueued(key)
    if (this.running?.key === key) this.running.controller.abort()
    this.emit()
  }

  /** Queued + running job count. */
  size(): number {
    return this.lanes.interactive.length + this.lanes.background.length + (this.running ? 1 : 0)
  }

  /** True when a job with this key is queued or currently running. */
  isActive(key: string): boolean {
    if (this.running?.key === key) return true
    return this.lanes.interactive.some((j) => j.key === key) || this.lanes.background.some((j) => j.key === key)
  }

  onChange(cb: (size: number) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private removeQueued(key: string): void {
    for (const lane of [this.lanes.interactive, this.lanes.background]) {
      const i = lane.findIndex((j) => j.key === key)
      if (i >= 0) lane.splice(i, 1)
    }
  }

  private pump(): void {
    if (this.running) return
    const job = this.lanes.interactive.shift() ?? this.lanes.background.shift()
    if (!job) return
    const controller = new AbortController()
    this.running = { key: job.key, controller }
    void job.run(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.running = null
        this.emit()
        this.pump()
      })
  }

  private emit(): void {
    const size = this.size()
    if (size === this.lastEmitted) return
    this.lastEmitted = size
    for (const cb of this.listeners) cb(size)
  }
}
