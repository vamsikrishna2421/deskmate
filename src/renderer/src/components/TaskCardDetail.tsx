/** DESIGN §6 expanded card: inline-editable title (lock-on-hover when user-owned), summary,
 *  subtasks, quick questions, `From pasted message` sunken mono block, timestamps, ghost
 *  action row. The raw captured text is sacred — always shown here, never lost. */

import { useEffect, useRef, useState } from 'react'
import { LOOPS_FOLD_WORKDAYS } from '@shared/constants'
import { businessDaysBetween } from '@shared/dates/dayMath'
import { relativeTime } from '../lib/format'
import '../styles/sheets.css'
import { LockMark } from './Badges'
import { SubtaskChecklist } from './SubtaskChecklist'
import { OpenQuestions } from './OpenQuestions'
import type { TaskCardDetailProps } from './props'

export function InlineTitle(props: {
  title: string
  userOwned: boolean
  onCommit(title: string): void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Seed the draft only when editing BEGINS — a background task.title change (re-enrich)
    // must never wipe the user's in-progress edit.
    if (editing) {
      setDraft(props.title)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== props.title) props.onCommit(next)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="detail__titleinput"
        type="text"
        aria-label="Task title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
      />
    )
  }
  return (
    <button
      type="button"
      className="detail__title"
      title="Click to edit the title"
      onClick={() => setEditing(true)}
    >
      {props.title}
      <LockMark visible={props.userOwned} />
    </button>
  )
}

export function TaskCardDetail(props: TaskCardDetailProps): React.JSX.Element {
  const { task, now, actions } = props
  const touched = new Date(task.activityAt)
  const folded =
    !Number.isNaN(touched.getTime()) &&
    businessDaysBetween(touched, now) >= LOOPS_FOLD_WORKDAYS

  const edited = task.updatedAt !== task.createdAt

  return (
    <div className="detail">
      {/* Title lives in the card's line 1, swapped to InlineTitle while expanded — not here. */}
      {task.summary && (
        <p className="detail__summary">
          {task.summary}
          <LockMark visible={task.provenance.summary === 'user'} />
        </p>
      )}
      <SubtaskChecklist
        taskId={task.id}
        subtasks={task.subtasks}
        onToggle={(subtaskId) => actions.onToggleSubtask(task.id, subtaskId)}
        onDelete={(subtaskId) => actions.onDeleteSubtask(task.id, subtaskId)}
      />
      <OpenQuestions
        taskId={task.id}
        questions={task.questions}
        folded={folded}
        batchMode={props.batchMode}
        onAnswer={(questionId, answer) => actions.onAnswerQuestion(task.id, questionId, answer)}
        onDismiss={(questionId) => actions.onDismissQuestion(task.id, questionId)}
      />
      <div className="detail__source">
        <div className="detail__sourcelabel">From pasted message</div>
        <pre className="source-block selectable detail__sourcetext">{task.sourceText}</pre>
        <div className="detail__stamps">
          Added {relativeTime(task.createdAt, now)}
          {edited && <> · edited {relativeTime(task.updatedAt, now)}</>}
        </div>
      </div>
      <div className="detail__actions">
        <button type="button" className="ghost" onClick={() => actions.onEdit(task.id)}>
          Edit <kbd>E</kbd>
        </button>
        <button type="button" className="ghost" onClick={() => actions.onSnooze(task.id)}>
          Snooze <kbd>S</kbd>
        </button>
        <button type="button" className="ghost" onClick={() => actions.onMoveToToday(task.id)}>
          Move to today <kbd>T</kbd>
        </button>
        <button type="button" className="ghost ghost--letgo" onClick={() => actions.onLetGo(task.id)}>
          Let go
        </button>
      </div>
    </div>
  )
}
