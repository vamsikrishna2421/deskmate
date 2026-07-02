/** DESIGN §6 subtasks: mini check circles, collapsed beyond 3 with `2/5` progress,
 *  hover-delete per row. */

import { useState } from 'react'
import { CheckCircle } from './Badges'
import type { SubtaskChecklistProps } from './props'

export function SubtaskChecklist(props: SubtaskChecklistProps): React.JSX.Element | null {
  const [showAll, setShowAll] = useState(false)
  const total = props.subtasks.length
  if (total === 0) return null
  const done = props.subtasks.filter((s) => s.done).length
  const collapsed = total > 3 && !showAll
  const rows = collapsed ? props.subtasks.slice(0, 3) : props.subtasks

  return (
    <div className="subtasks">
      <div className="subtasks__head">
        <span className="subtasks__progress" aria-label={`${done} of ${total} steps done`}>
          {done}/{total}
        </span>
      </div>
      <ul className="subtasks__list" role="list">
        {rows.map((s) => (
          <li key={s.id} className={`subtasks__row${s.done ? ' subtasks__row--done' : ''}`}>
            <CheckCircle
              done={s.done}
              ariaLabel={s.done ? `Mark "${s.title}" not done` : `Mark "${s.title}" done`}
              onToggle={() => props.onToggle(s.id)}
            />
            <span className="subtasks__title">{s.title}</span>
            <button
              type="button"
              className="subtasks__delete"
              aria-label={`Remove step "${s.title}"`}
              onClick={() => props.onDelete(s.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {collapsed && (
        <button type="button" className="subtasks__more" onClick={() => setShowAll(true)}>
          +{total - 3} more
        </button>
      )}
    </div>
  )
}
