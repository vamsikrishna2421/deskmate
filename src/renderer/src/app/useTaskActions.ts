/** Builds the per-task action bundle threaded through TaskList/TaskCard (props.ts TaskActions).
 *  Stable identity — handlers read the live task array through a ref. */

import { useMemo, type Dispatch } from 'react'
import type { Deadline, Priority, Task } from '@shared/types/task'
import { addDays, localDateKey, startOfLocalDay } from '@shared/dates/dayMath'
import type { Api } from '../lib/api'
import { makeToast, type UIAction } from '../state/uiReducer'
import type { TaskActions } from '../components/props'

const PRIORITY_CYCLE: Priority[] = ['urgent', 'high', 'normal', 'low', 'optional']
const PRIORITY_WORDS: Record<Priority, string> = {
  urgent: 'urgent',
  high: 'high',
  normal: 'normal',
  low: 'low',
  optional: 'optional'
}

/** Restorable shape of a deadline for undo — mirrors sanitizeDeadline's accepted fields. */
function deadlinePatchOf(d: Deadline): { kind: Deadline['kind']; dueDate?: string; dueTime?: string } {
  return {
    kind: d.kind,
    ...(d.dueDate ? { dueDate: d.dueDate } : {}),
    ...(d.dueTime ? { dueTime: d.dueTime } : {})
  }
}

export function useTaskActions(
  api: Api,
  tasksRef: { readonly current: Task[] },
  uiDispatch: Dispatch<UIAction>
): TaskActions {
  return useMemo(() => {
    const find = (id: string): Task | undefined => tasksRef.current.find((t) => t.id === id)
    return {
      onToggleDone(id) {
        const t = find(id)
        if (!t) return
        if (t.status === 'done') {
          void api.invoke('tasks:setStatus', { id, status: 'open' })
          return
        }
        void api.invoke('tasks:setStatus', { id, status: 'done' })
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({
            text: 'Done — moved to the Done tab',
            actionLabel: 'Undo',
            onAction: () => void api.invoke('tasks:setStatus', { id, status: 'open' })
          })
        })
      },
      onAddContext(id, note) {
        void api.invoke('tasks:addContext', { id, note })
      },
      onExpand(id) {
        uiDispatch({ type: 'expandTask', id })
      },
      onEdit(id) {
        uiDispatch({ type: 'openEditor', id })
      },
      onSnooze(id) {
        const t = find(id)
        if (!t) return
        const wasDeadline = deadlinePatchOf(t.deadline)
        // Next WORKday — snoozing onto a Saturday helps nobody. Weekend-deadline tasks are
        // rare enough that the skip is always the right default; Edit covers the rest.
        let next = addDays(startOfLocalDay(new Date()), 1)
        while (next.getDay() === 0 || next.getDay() === 6) next = addDays(next, 1)
        const dueDate = localDateKey(next)
        const kind = t.deadline.kind === 'none' ? 'soft' : t.deadline.kind
        void api.invoke('tasks:update', { id, patch: { deadline: { dueDate, kind } } })
        const tomorrowKey = localDateKey(addDays(startOfLocalDay(new Date()), 1))
        const dayWord =
          dueDate === tomorrowKey ? 'tomorrow' : next.toLocaleDateString('en-US', { weekday: 'long' })
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({
            text: `Snoozed to ${dayWord}`,
            actionLabel: 'Undo',
            onAction: () => void api.invoke('tasks:update', { id, patch: { deadline: wasDeadline } })
          })
        })
      },
      onMoveToToday(id) {
        void api.invoke('tasks:update', { id, patch: { pinned: true } })
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({
            text: 'Moved to Today',
            actionLabel: 'Undo',
            onAction: () => void api.invoke('tasks:update', { id, patch: { pinned: false } })
          })
        })
      },
      onLetGo(id) {
        const t = find(id)
        void api.invoke('tasks:delete', { id })
        if (!t) return
        const title = t.title.length > 32 ? `${t.title.slice(0, 32)}…` : t.title
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({
            text: `Let go of “${title}” — it's in the Done tab's Let go bin for 30 days`,
            actionLabel: 'Undo',
            onAction: () => void api.invoke('tasks:restoreTrashed', { id }),
            durationMs: 6000
          })
        })
      },
      onCyclePriority(id) {
        const t = find(id)
        if (!t) return
        const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(t.priority) + 1) % PRIORITY_CYCLE.length]
        void api.invoke('tasks:update', { id, patch: { priority: next } })
        // Three of five levels render no mark — without this echo, P looks like a no-op.
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({ text: `Priority: ${PRIORITY_WORDS[next]}`, durationMs: 2000 })
        })
      },
      onToggleFocus(id) {
        const t = find(id)
        if (!t) return
        void api.invoke('tasks:update', { id, patch: { focus: !t.focus } })
      },
      onToggleSubtask(taskId, subtaskId) {
        void api.invoke('tasks:toggleSubtask', { taskId, subtaskId })
      },
      onDeleteSubtask(taskId, subtaskId) {
        const t = find(taskId)
        if (!t) return
        const subtasks = t.subtasks.filter((s) => s.id !== subtaskId)
        void api.invoke('tasks:update', { id: taskId, patch: { subtasks } })
      },
      onAnswerQuestion(taskId, questionId, answer) {
        void api.invoke('tasks:answerQuestion', { taskId, questionId, answer })
      },
      onDismissQuestion(taskId, questionId) {
        void api.invoke('tasks:dismissQuestion', { taskId, questionId })
      },
      onRetryEnrich(id) {
        void api.invoke('tasks:reenrich', { id })
      },
      onUpdate(id, patch) {
        void api.invoke('tasks:update', { id, patch })
      }
    } satisfies TaskActions
  }, [api, tasksRef, uiDispatch])
}
