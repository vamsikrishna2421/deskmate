/** DESIGN §5 state matrix + §6 collapsed anatomy: 3px urgency rail, 18px check circle,
 *  2-line title, meta row. Cross-fades into enriched content with a one-time 6% accent
 *  wash — the only "ta-da" in the app. */

import { memo, useEffect, useRef, useState } from 'react'
import { localDateKey, weekBounds } from '@shared/dates/dayMath'
import { isDueToday, isOverdue } from '../state/selectors'
import { relativeTime } from '../lib/format'
import {
  AssistantMark,
  CheckCircle,
  DeadlineChip,
  EffortChip,
  EnrichShimmer,
  FocusStar,
  LoopBadge,
  PriorityMark,
  TagRow
} from './Badges'
import { InlineTitle, TaskCardDetail } from './TaskCardDetail'
import { OpenQuestions } from './OpenQuestions'
import type { Task, TaskCardProps } from './props'

const SLOW_AFTER_MS = 8000
const VERY_SLOW_AFTER_MS = 25000

type Rail = 'overdue' | 'today' | 'week' | 'none'

function railOf(task: Task, now: Date): Rail {
  const todayKey = localDateKey(now)
  if (isOverdue(task, todayKey)) return 'overdue'
  if (isDueToday(task, todayKey)) return 'today'
  const due = task.deadline.dueDate
  if (
    task.deadline.kind !== 'none' &&
    due !== undefined &&
    !task.deadline.approx &&
    due > todayKey &&
    due <= localDateKey(weekBounds(now).sunday)
  ) {
    return 'week'
  }
  return 'none'
}

function TaskCardImpl(props: TaskCardProps): React.JSX.Element {
  const { task, now, actions } = props
  const done = task.status === 'done'
  const running = props.enrichment === 'running'

  // The wait must never freeze: shimmer → (8s) "waking up" → (25s) "a slow one" — the copy
  // keeps moving so a long read on slow hardware never looks stuck.
  const [slowStage, setSlowStage] = useState<0 | 1 | 2>(0)
  useEffect(() => {
    if (!running) {
      setSlowStage(0)
      return
    }
    const t1 = window.setTimeout(() => setSlowStage(1), SLOW_AFTER_MS)
    const t2 = window.setTimeout(() => setSlowStage(2), VERY_SLOW_AFTER_MS)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [running])

  // One-time 6% accent wash when enrichment settles (DESIGN §5 ENRICHED).
  const [washed, setWashed] = useState(false)
  const prevTransient = useRef(props.enrichment)
  useEffect(() => {
    if (prevTransient.current && !props.enrichment && task.enrichment.status === 'done') {
      setWashed(true)
      const t = window.setTimeout(() => setWashed(false), 900)
      prevTransient.current = props.enrichment
      return () => window.clearTimeout(t)
    }
    prevTransient.current = props.enrichment
    return undefined
  }, [props.enrichment, task.enrichment.status])

  const rail = done ? 'none' : railOf(task, now)
  const openLoops = task.questions.filter((q) => q.status === 'open').length
  const enriched = task.enrichment.status === 'done'
  const guessed = task.enrichment.needsReview === true
  const provenance =
    task.deadline.source === 'llm' && task.deadline.rawToken
      ? `From the message: "${task.deadline.rawToken}"`
      : undefined

  const onCardClick = (e: React.MouseEvent): void => {
    if (
      e.target instanceof HTMLElement &&
      e.target.closest('button, input, textarea, a, .source-block')
    ) {
      return
    }
    // Text is copyable — a drag-to-select must never toggle the card.
    if ((window.getSelection()?.toString().length ?? 0) > 0) return
    actions.onExpand(props.expanded ? null : task.id)
  }

  const status = task.enrichment.status
  const showRaw = !props.enrichment && status === 'pending'
  const showFailed = !props.enrichment && status === 'failed'
  const showSkipped = !props.enrichment && status === 'skipped'

  const classes = [
    'card',
    props.expanded ? 'card--expanded' : '',
    done ? 'card--done' : '',
    washed ? 'card--washed' : '',
    props.highlighted ? 'card--highlight' : '',
    rail !== 'none' ? `card--rail-${rail}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      className={classes}
      data-task-id={task.id}
      aria-expanded={props.expanded}
      aria-label={task.title}
      onClick={onCardClick}
    >
      <span className="card__rail" data-rail={rail} aria-hidden="true" />
      <div className="card__line1">
        <CheckCircle
          done={done}
          ariaLabel={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
          onToggle={() => actions.onToggleDone(task.id)}
        />
        {props.expanded && !done ? (
          <InlineTitle
            title={task.title}
            userOwned={task.provenance.title === 'user'}
            onCommit={(title) => actions.onUpdate(task.id, { title })}
          />
        ) : (
          <span className={`card__title${guessed && task.provenance.title === 'llm' ? ' guessed' : ''}`}>
            {task.title}
          </span>
        )}
      </div>
      <div className="card__meta">
        {done ? (
          <span className="card__status">
            Done{task.completedAt ? ` · ${relativeTime(task.completedAt, now)}` : ''}
          </span>
        ) : props.enrichment ? (
          <EnrichShimmer state={props.enrichment} slow={slowStage >= 1} verySlow={slowStage === 2} />
        ) : showRaw ? (
          <span className="card__status" role="status" aria-live="polite">
            <span className="dot dot--pulse pulse" aria-hidden="true" />
            Reading… · {relativeTime(task.createdAt, now)}
          </span>
        ) : (
          <>
            {showFailed && (
              <span className="card__status" role="status">
                <span className="dot dot--hollow" aria-hidden="true" />
                couldn&apos;t organize this one — it&apos;s all yours
                <button
                  type="button"
                  className="card__retry"
                  aria-label="Ask the assistant to try again"
                  title="Try again"
                  onClick={() => actions.onRetryEnrich(task.id)}
                >
                  ↻
                </button>
              </span>
            )}
            {showSkipped && (
              <span className="card__status" role="status">
                <span className="dot dot--hollow" aria-hidden="true" />
                Assistant is offline — saved as written.
                <button
                  type="button"
                  className="card__retry"
                  aria-label="Ask the assistant to try again"
                  title="Try again"
                  onClick={() => actions.onRetryEnrich(task.id)}
                >
                  ↻
                </button>
              </span>
            )}
            <DeadlineChip
              deadline={task.deadline}
              now={now}
              needsReview={guessed}
              large={props.effortEmphasis}
              onWhenClick={() => {
                // The question sits where the answer lands (DESIGN §6): expand, then put the
                // caret straight into the deadline loop's input.
                actions.onExpand(task.id)
                requestAnimationFrame(() => {
                  document
                    .querySelector<HTMLElement>(`[data-task-id="${task.id}"] .loops__input`)
                    ?.focus()
                })
              }}
            />
            {task.effort && <EffortChip effort={task.effort} large={props.effortEmphasis} />}
            <PriorityMark priority={task.priority} />
            <TagRow tags={task.tags} max={2} />
            <LoopBadge count={openLoops} />
            {props.stalled && (
              <span className="moon" aria-label="Quiet for a while" title="Quiet for a while">
                ☾
              </span>
            )}
            {enriched && <AssistantMark provenance={provenance} guessed={guessed} />}
            {task.focus && (
              <FocusStar active onToggle={() => actions.onToggleFocus(task.id)} />
            )}
          </>
        )}
      </div>
      {props.expanded && !done && (
        <TaskCardDetail task={task} now={now} batchMode={props.batchMode} actions={actions} />
      )}
      {props.batchMode && !props.expanded && !done && openLoops > 0 && (
        <OpenQuestions
          taskId={task.id}
          questions={task.questions}
          folded={false}
          batchMode
          onAnswer={(questionId, answer) => actions.onAnswerQuestion(task.id, questionId, answer)}
          onDismiss={(questionId) => actions.onDismissQuestion(task.id, questionId)}
        />
      )}
    </article>
  )
}

export const TaskCard = memo(TaskCardImpl)
