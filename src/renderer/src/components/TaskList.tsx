/** DESIGN §9 list: grouping, week load gauges, Later `Got 30 minutes?` filter row,
 *  typography-only empty states, roving tabindex + the in-card keyboard map, coach marks,
 *  and the no-reorder rule: order is frozen while the pointer is inside (adopts the fresh
 *  model on pointer exit or 3s idle); task content always renders live. */

import { useEffect, useRef, useState } from 'react'
import { useApi, useTasks, useUI, useUIDispatch } from '../state/store'
import { effortBucket, legendPredicate } from '../state/selectors'
import { formatEffort, formatMinutes } from '../lib/format'
import { TaskCard } from './TaskCard'
import type { EffortBucket, Task, TaskGroup, TaskListProps, ViewModel } from './props'

const IDLE_MS = 3000

const BUCKETS: ReadonlyArray<{ id: EffortBucket; label: string }> = [
  { id: 'quick', label: '≤30m' },
  { id: 'medium', label: '≤2h' },
  { id: 'big', label: 'Big rocks' }
]

const COACH: ReadonlyArray<{ mark: string; text: string; present(t: Task): boolean }> = [
  {
    mark: 'loop',
    text: '◌ means the assistant has a question — expand the card to answer.',
    present: (t) => t.questions.some((q) => q.status === 'open')
  },
  {
    mark: 'assistant',
    text: '✦ means the assistant organized this — hover it to see the source.',
    present: (t) => t.enrichment.status === 'done'
  },
  {
    mark: 'guessed',
    text: 'A dotted underline is a guess — tap to confirm.',
    present: (t) => t.enrichment.needsReview === true
  },
  {
    mark: 'focus',
    text: '★ is a focus star — at most three alive.',
    present: (t) => t.focus
  }
]

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  )
}

export function TaskList(props: TaskListProps): React.JSX.Element {
  const allTasks = useTasks().tasks
  const ui = useUI()
  const uiDispatch = useUIDispatch()
  const api = useApi()

  // ── order freeze while pointer is inside ─────────────────────────────────────
  // The freeze only guards against AMBIENT reordering (enrichment moving a card mid-read).
  // A user-initiated change — view switch, search, legend filter, batch mode — must adopt
  // immediately, so those inputs form a bypass key.
  const bypassKey = `${props.viewModel.view}|${ui.searchQuery}|${ui.legendFilter ?? ''}|${props.loopsBatchMode}`
  const lastBypassKey = useRef(bypassKey)
  const [displayVm, setDisplayVm] = useState<ViewModel>(props.viewModel)
  const pointerInside = useRef(false)
  const pending = useRef<ViewModel | null>(null)
  const idleTimer = useRef<number | undefined>(undefined)

  const adopt = (vm: ViewModel): void => {
    pending.current = null
    window.clearTimeout(idleTimer.current)
    setDisplayVm(vm)
  }
  useEffect(() => {
    const bypass = lastBypassKey.current !== bypassKey
    lastBypassKey.current = bypassKey
    if (bypass || !pointerInside.current) {
      adopt(props.viewModel)
      return
    }
    pending.current = props.viewModel
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      if (pending.current) adopt(pending.current)
    }, IDLE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewModel, bypassKey])
  useEffect(() => () => window.clearTimeout(idleTimer.current), [])

  // Frozen order, live content: map frozen ids through the latest task objects.
  const byId = new Map(allTasks.map((t) => [t.id, t]))
  const groups: TaskGroup[] = displayVm.groups
    .map((g) => ({ ...g, tasks: g.tasks.map((t) => byId.get(t.id)).filter((t): t is Task => !!t) }))
    .filter((g) => g.tasks.length > 0)

  // ── Later effort filter row ──────────────────────────────────────────────────
  // A size pick DIMS non-matching tasks instead of hiding them — nothing ever silently
  // vanishes, and each dimmed card explains itself (ⓘ tooltip).
  const [bucket, setBucket] = useState<EffortBucket | null>(null)
  const laterView = displayVm.view === 'later'
  const shown = groups
  const bucketLabel = bucket ? BUCKETS.find((b) => b.id === bucket)?.label ?? '' : ''
  const dimReason = (t: Task): string | null => {
    if (!laterView || !bucket) return null
    if (effortBucket(t.effort) === bucket) return null
    return t.effort
      ? `Sized ${formatEffort(t.effort)} — outside your ${bucketLabel} pick`
      : `No size estimate yet, so it doesn't match ${bucketLabel}`
  }

  const flatIds = shown.flatMap((g) => g.tasks.map((t) => t.id))
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const effectiveFocus = focusedId && flatIds.includes(focusedId) ? focusedId : (flatIds[0] ?? null)

  useEffect(() => {
    const id = props.focusTaskId
    if (!id) return
    const el = itemRefs.current.get(id)
    if (el) {
      setFocusedId(id)
      el.scrollIntoView({ block: 'nearest' })
      el.focus()
      // Clear the target so later list-membership changes can't steal focus back here,
      // and a repeat notification for the same task navigates again.
      props.onFocusHandled?.()
    }
  }, [props.focusTaskId, flatIds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Keyboard actions that unmount the focused card hand focus to a neighbor first. */
  const withNeighborFocus = (id: string, fn: () => void): void => {
    const i = flatIds.indexOf(id)
    const neighbor = flatIds[i + 1] ?? flatIds[i - 1]
    fn()
    if (neighbor) {
      setFocusedId(neighbor)
      requestAnimationFrame(() => itemRefs.current.get(neighbor)?.focus())
    }
  }

  const moveFocus = (delta: number): void => {
    if (flatIds.length === 0) return
    const i = effectiveFocus ? flatIds.indexOf(effectiveFocus) : -1
    const next = flatIds[Math.min(flatIds.length - 1, Math.max(0, i + delta))]
    setFocusedId(next)
    itemRefs.current.get(next)?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (isEditable(e.target)) return
    const key = e.key
    if (key === 'ArrowDown' || key === 'j') {
      e.preventDefault()
      moveFocus(1)
      return
    }
    if (key === 'ArrowUp' || key === 'k') {
      e.preventDefault()
      moveFocus(-1)
      return
    }
    if (!effectiveFocus) return
    const focusedEl = itemRefs.current.get(effectiveFocus)
    if (props.loopsBatchMode) {
      if (key === '1' || key === '2' || key === '3') {
        e.preventDefault()
        e.stopPropagation() // must never reach the global view-switch map
        focusedEl?.querySelector<HTMLButtonElement>(`[data-loop-key="${key}"]`)?.click()
        return
      }
      if (key === 't' || key === 'T') {
        e.preventDefault()
        focusedEl?.querySelector<HTMLInputElement>('[data-loop-input]')?.focus()
        return
      }
      if (key === 's' || key === 'S') {
        focusedEl?.querySelector<HTMLButtonElement>('[data-loop-dismiss]')?.click()
        return
      }
    }
    if (key === 'Enter' && e.target === focusedEl) {
      e.preventDefault()
      props.actions.onExpand(props.expandedTaskId === effectiveFocus ? null : effectiveFocus)
      return
    }
    if (key === ' ' || key === 'd' || key === 'D') {
      e.preventDefault()
      withNeighborFocus(effectiveFocus, () => props.actions.onToggleDone(effectiveFocus))
    } else if (key === 'e' || key === 'E') {
      props.actions.onEdit(effectiveFocus)
    } else if (key === 's' || key === 'S') {
      withNeighborFocus(effectiveFocus, () => props.actions.onSnooze(effectiveFocus))
    } else if (key === 't' || key === 'T') {
      withNeighborFocus(effectiveFocus, () => props.actions.onMoveToToday(effectiveFocus))
    } else if (key === 'p' || key === 'P') {
      props.actions.onCyclePriority(effectiveFocus)
    }
  }

  const highlight = props.legendHover
    ? legendPredicate(props.legendHover, {
        now: props.now,
        stalledIds: props.stalledIds,
        enrichment: props.enrichment
      })
    : null

  const visibleTasks = shown.flatMap((g) => g.tasks)
  const coach = COACH.find(
    (c) => !ui.coachmarksSeen.includes(c.mark) && visibleTasks.some(c.present)
  )

  const empty = visibleTasks.length === 0

  return (
    <div
      className="list"
      role="list"
      aria-label={`${displayVm.view} tasks`}
      onKeyDown={onKeyDown}
      onPointerEnter={() => {
        pointerInside.current = true
      }}
      onPointerLeave={() => {
        pointerInside.current = false
        if (pending.current) adopt(pending.current)
      }}
      onPointerMove={() => {
        if (pending.current) {
          window.clearTimeout(idleTimer.current)
          idleTimer.current = window.setTimeout(() => {
            if (pending.current) adopt(pending.current)
          }, IDLE_MS)
        }
      }}
    >
      {laterView && !empty && (
        <div className="list__filterrow" role="group" aria-label="Filter by effort">
          <span className="list__filterlabel">Got 30 minutes?</span>
          {BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`list__pill${bucket === b.id ? ' list__pill--active' : ''}`}
              aria-pressed={bucket === b.id}
              onClick={() => setBucket((cur) => (cur === b.id ? null : b.id))}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {coach && (
        <div className="coachmark" role="note">
          <span>{coach.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              uiDispatch({ type: 'markCoachmarkSeen', mark: coach.mark })
              // Persist — "once" means once ever, not once per launch.
              void api.invoke('settings:update', {
                coachMarksSeen: [...ui.coachmarksSeen, coach.mark]
              })
            }}
          >
            ×
          </button>
        </div>
      )}
      {empty ? (
        laterView && bucket ? (
          // A size pill with no matches must explain itself — items without an effort
          // estimate live outside every size bucket.
          <div className="list__empty">
            <p>Nothing sized {BUCKETS.find((b) => b.id === bucket)?.label} here.</p>
            <button type="button" className="ghost" onClick={() => setBucket(null)}>
              Show everything
            </button>
          </div>
        ) : (
          <p className="list__empty">{props.filtered ? 'Nothing matches.' : displayVm.emptyText}</p>
        )
      ) : (
        shown.map((g) => (
          <section key={g.key} className="list__group">
            {g.label && (
              <header className="list__header">
                <span className="list__headerlabel">{g.label}</span>
                {g.effortMinutes !== undefined && g.budgetMinutes !== undefined && (
                  <span className="gauge" aria-label={`${formatMinutes(g.effortMinutes)} planned of a ${formatMinutes(g.budgetMinutes)} day`}>
                    <span
                      className={`gauge__track${g.effortMinutes > g.budgetMinutes ? ' gauge__track--over' : ''}`}
                    >
                      <span
                        className="gauge__fill"
                        style={{ width: `${Math.min(100, (g.effortMinutes / g.budgetMinutes) * 100)}%` }}
                      />
                    </span>
                    <span className="gauge__label">{formatMinutes(g.effortMinutes)}</span>
                  </span>
                )}
              </header>
            )}
            {g.tasks.map((t) => {
              const why = dimReason(t)
              return (
              <div
                key={t.id}
                role="listitem"
                className={`listitem${why ? ' listitem--dimmed' : ''}`}
                tabIndex={effectiveFocus === t.id ? 0 : -1}
                ref={(el) => {
                  if (el) itemRefs.current.set(t.id, el)
                  else itemRefs.current.delete(t.id)
                }}
                onFocus={(e) => {
                  if (e.target === e.currentTarget) setFocusedId(t.id)
                }}
              >
                {why && (
                  <span className="listitem__why" title={why} aria-label={why}>
                    ⓘ
                  </span>
                )}
                <TaskCard
                  task={t}
                  now={props.now}
                  expanded={props.expandedTaskId === t.id}
                  enrichment={props.enrichment[t.id]}
                  stalled={props.stalledIds.has(t.id)}
                  highlighted={highlight ? highlight(t) : false}
                  effortEmphasis={laterView}
                  batchMode={props.loopsBatchMode}
                  actions={props.actions}
                />
              </div>
              )
            })}
          </section>
        ))
      )}
      {props.effortFooter && !empty && <p className="list__whisper">{props.effortFooter}</p>}
    </div>
  )
}
