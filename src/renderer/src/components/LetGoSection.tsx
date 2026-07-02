/** The Let go bin — lives at the bottom of the Done view. Every let-go task stays restorable
 *  for 30 days: one click and it returns exactly as it was. Typing it again is hard. */

import type { TrashEntry } from '@shared/types/task'
import { relativeTime } from '../lib/format'
import { useApi } from '../state/store'

export function LetGoSection({ entries }: { entries: TrashEntry[] }): React.JSX.Element | null {
  const api = useApi()
  if (entries.length === 0) return null
  const now = new Date()
  return (
    <section className="list__group letgo" aria-label="Let go — restorable">
      <header className="list__header">
        <span className="list__headerlabel">Let go</span>
      </header>
      <ul className="letgo__list" role="list">
        {entries.map((e) => (
          <li key={e.task.id} className="letgo__row">
            <span className="letgo__title">{e.task.title}</span>
            <span className="letgo__stamp">{relativeTime(e.letGoAt, now)}</span>
            <button
              type="button"
              className="ghost"
              onClick={() => void api.invoke('tasks:restoreTrashed', { id: e.task.id })}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
      <p className="letgo__whisper">Kept for 30 days, then let go for good.</p>
    </section>
  )
}
