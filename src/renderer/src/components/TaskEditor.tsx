/** Manual edit bottom sheet — every field. Only CHANGED fields go into the patch
 *  (patching a guarded field flips its provenance to 'user' permanently). */

import { useEffect, useRef, useState } from 'react'
import { FOCUS_STARS_MAX, TAGS_MAX } from '@shared/constants'
import type { Deadline, Effort, Priority, TaskEditorProps, TaskPatch } from './props'

const PRIORITIES: ReadonlyArray<{ id: Priority; label: string }> = [
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High' },
  { id: 'normal', label: 'Normal' },
  { id: 'low', label: 'Low' },
  { id: 'optional', label: 'Optional' }
]

const EFFORTS: ReadonlyArray<{ id: Effort; label: string }> = [
  { id: 'minutes', label: '~30 minutes' },
  { id: 'hour', label: '~1 hour' },
  { id: 'half_day', label: 'Half a day' },
  { id: 'day', label: 'A day' },
  { id: 'multi_day', label: 'Several days' }
]

function trapTab(e: React.KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return
  const focusables = root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input, textarea, select, [tabindex]:not([tabindex="-1"])'
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

export function TaskEditor(props: TaskEditorProps): React.JSX.Element {
  const { task } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState(task.title)
  const [summary, setSummary] = useState(task.summary ?? '')
  const [kind, setKind] = useState<Deadline['kind']>(task.deadline.kind)
  const [dueDate, setDueDate] = useState(task.deadline.dueDate ?? '')
  const [dueTime, setDueTime] = useState(task.deadline.dueTime ?? '')
  const [priority, setPriority] = useState<Priority>(task.priority)
  const [effort, setEffort] = useState<Effort | ''>(task.effort ?? '')
  const [tags, setTags] = useState(task.tags.join(', '))
  const [focus, setFocus] = useState(task.focus)
  const [pinned, setPinned] = useState(task.pinned)

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input')?.focus()
  }, [])

  const starDisabled = !task.focus && !focus && props.focusCount >= FOCUS_STARS_MAX

  const save = (): void => {
    const patch: TaskPatch = {}
    const t = title.trim()
    if (t && t !== task.title) patch.title = t
    if (summary.trim() !== (task.summary ?? '')) patch.summary = summary.trim()
    const deadlinePatch: Partial<Deadline> = {}
    if (kind !== task.deadline.kind) deadlinePatch.kind = kind
    if (kind !== 'none') {
      if (dueDate && dueDate !== (task.deadline.dueDate ?? '')) deadlinePatch.dueDate = dueDate
      if (dueTime !== (task.deadline.dueTime ?? '') && dueTime) deadlinePatch.dueTime = dueTime
    }
    if (Object.keys(deadlinePatch).length > 0) patch.deadline = deadlinePatch
    if (priority !== task.priority) patch.priority = priority
    if (effort && effort !== task.effort) patch.effort = effort
    const tagList = tags
      .split(/[,\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, TAGS_MAX)
    if (tagList.join(',') !== task.tags.join(',')) patch.tags = tagList
    if (focus !== task.focus) patch.focus = focus
    if (pinned !== task.pinned) patch.pinned = pinned
    props.onSave(patch)
  }

  return (
    <div
      className="editor sheetbody"
      ref={rootRef}
      onKeyDown={(e) => trapTab(e, rootRef.current)}
      aria-label="Edit task"
    >
      <header className="sheetbody__head">
        <h2>Edit task</h2>
        <button type="button" className="sheetbody__close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>

      <label className="editor__field">
        <span className="editor__label">Title</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      <label className="editor__field">
        <span className="editor__label">Summary</span>
        <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>

      <div className="editor__field" role="group" aria-label="Deadline">
        <span className="editor__label">Deadline</span>
        <div className="editor__segments">
          {(['none', 'soft', 'hard'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`editor__segment${kind === k ? ' editor__segment--active' : ''}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === 'none' ? 'None' : k === 'soft' ? '○ Soft' : '● Hard'}
            </button>
          ))}
        </div>
        {kind !== 'none' && (
          <div className="editor__row">
            <input
              type="date"
              aria-label="Due date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <input
              type="time"
              aria-label="Due time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="editor__field" role="group" aria-label="Priority">
        <span className="editor__label">Priority</span>
        <div className="editor__segments">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`editor__segment${priority === p.id ? ' editor__segment--active' : ''}`}
              aria-pressed={priority === p.id}
              onClick={() => setPriority(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="editor__field">
        <span className="editor__label">Effort</span>
        <select value={effort} onChange={(e) => setEffort(e.target.value as Effort | '')}>
          <option value="">Not set</option>
          {EFFORTS.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </label>

      <label className="editor__field">
        <span className="editor__label">Tags</span>
        <input
          type="text"
          placeholder="up to three, comma-separated"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
      </label>

      <div className="editor__toggles">
        <label className="editor__toggle">
          <input
            type="checkbox"
            checked={focus}
            disabled={starDisabled}
            onChange={(e) => setFocus(e.target.checked)}
          />
          <span>★ Focus{starDisabled ? ' — three are alive, let one go first' : ' (max 3)'}</span>
        </label>
        <label className="editor__toggle">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
          <span>Picked for today</span>
        </label>
      </div>

      <footer className="editor__footer">
        <button type="button" className="ghost ghost--letgo" onClick={() => props.onLetGo(task.id)}>
          Let go
        </button>
        <span className="editor__spring" />
        <button type="button" className="primary" onClick={save}>
          Save
        </button>
      </footer>
    </div>
  )
}
