/** Serial LLM job queue (src/main/llm/requestQueue.ts): strict concurrency 1, interactive lane
 *  first, FIFO within lane, queued same-key supersede, abort, failure never stalls. */

import { describe, expect, it } from 'vitest'
import { RequestQueue, type JobLane } from '../../src/main/llm/requestQueue'

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Drain microtasks + one macrotask so .finally chains and the next pump settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

interface Harness {
  queue: RequestQueue
  started: string[]
  finished: string[]
  add: (key: string, lane: JobLane, gate?: { promise: Promise<void> }) => void
}

function harness(): Harness {
  const queue = new RequestQueue()
  const started: string[] = []
  const finished: string[] = []
  const add = (key: string, lane: JobLane, gate?: { promise: Promise<void> }): void => {
    queue.enqueue({
      key,
      lane,
      run: async () => {
        started.push(key)
        if (gate) await gate.promise
        finished.push(key)
      }
    })
  }
  return { queue, started, finished, add }
}

describe('RequestQueue', () => {
  it('runs strictly one job at a time', async () => {
    const h = harness()
    const gate = deferred()
    h.add('j1', 'interactive', gate)
    h.add('j2', 'interactive')
    await settle()
    expect(h.started).toEqual(['j1']) // j2 must wait
    gate.resolve()
    await settle()
    expect(h.started).toEqual(['j1', 'j2'])
    expect(h.finished).toEqual(['j1', 'j2'])
  })

  it('interactive lane preempts queued background jobs; FIFO within each lane', async () => {
    const h = harness()
    const gate = deferred()
    h.add('blocker', 'interactive', gate)
    h.add('bg1', 'background')
    h.add('bg2', 'background')
    h.add('int1', 'interactive')
    h.add('int2', 'interactive')
    gate.resolve()
    await settle()
    await settle()
    expect(h.started).toEqual(['blocker', 'int1', 'int2', 'bg1', 'bg2'])
  })

  it('enqueuing the same key supersedes the QUEUED job (latest context wins)', async () => {
    const h = harness()
    const gate = deferred()
    const ran: string[] = []
    h.add('blocker', 'interactive', gate)
    h.queue.enqueue({ key: 'x', lane: 'interactive', run: async () => void ran.push('v1') })
    h.queue.enqueue({ key: 'x', lane: 'interactive', run: async () => void ran.push('v2') })
    gate.resolve()
    await settle()
    expect(ran).toEqual(['v2'])
  })

  it('supersede works across lanes (queued background replaced by interactive)', async () => {
    const h = harness()
    const gate = deferred()
    const ran: string[] = []
    h.add('blocker', 'interactive', gate)
    h.queue.enqueue({ key: 'x', lane: 'background', run: async () => void ran.push('bg') })
    h.queue.enqueue({ key: 'x', lane: 'interactive', run: async () => void ran.push('int') })
    gate.resolve()
    await settle()
    expect(ran).toEqual(['int'])
  })

  it('a RUNNING job is not superseded — both runs execute', async () => {
    const h = harness()
    const gate = deferred()
    h.add('x', 'interactive', gate)
    await settle()
    h.add('x', 'interactive')
    gate.resolve()
    await settle()
    expect(h.started).toEqual(['x', 'x'])
  })

  it('abort(key) signals the running job and the queue moves on', async () => {
    const queue = new RequestQueue()
    let sawAbort = false
    const order: string[] = []
    queue.enqueue({
      key: 'running',
      lane: 'interactive',
      run: (signal) =>
        new Promise<void>((resolve) => {
          order.push('running')
          signal.addEventListener('abort', () => {
            sawAbort = signal.aborted
            resolve()
          })
        })
    })
    queue.enqueue({ key: 'next', lane: 'interactive', run: async () => void order.push('next') })
    await settle()
    queue.abort('running')
    await settle()
    expect(sawAbort).toBe(true)
    expect(order).toEqual(['running', 'next'])
  })

  it('abort(key) drops a queued job before it ever runs', async () => {
    const h = harness()
    const gate = deferred()
    h.add('blocker', 'interactive', gate)
    h.add('doomed', 'interactive')
    h.queue.abort('doomed')
    gate.resolve()
    await settle()
    expect(h.started).toEqual(['blocker'])
  })

  it('a failing job never stalls the queue', async () => {
    const queue = new RequestQueue()
    const order: string[] = []
    queue.enqueue({
      key: 'boom',
      lane: 'interactive',
      run: async () => {
        order.push('boom')
        throw new Error('LLM exploded')
      }
    })
    queue.enqueue({ key: 'after', lane: 'interactive', run: async () => void order.push('after') })
    await settle()
    expect(order).toEqual(['boom', 'after'])
    expect(queue.size()).toBe(0)
  })

  it('size() counts queued + running; onChange fires only when the size changes', async () => {
    const queue = new RequestQueue()
    const sizes: number[] = []
    const off = queue.onChange((s) => sizes.push(s))
    const gate = deferred()
    queue.enqueue({ key: 'a', lane: 'interactive', run: () => gate.promise })
    expect(queue.size()).toBe(1) // running
    queue.enqueue({ key: 'b', lane: 'background', run: async () => undefined })
    expect(queue.size()).toBe(2)
    gate.resolve()
    await settle()
    expect(queue.size()).toBe(0)
    expect(sizes).toEqual([1, 2, 1, 0])
    off()
    queue.enqueue({ key: 'c', lane: 'background', run: async () => undefined })
    await settle()
    expect(sizes).toEqual([1, 2, 1, 0]) // unsubscribed
  })
})
