/** DESIGN §10 live legend: real components at true size, grouped; hovering a row highlights
 *  matching cards behind the sheet for 2s; clicking applies (or clears) the list filter.
 *  Color never stands alone — every meaning has a shape. */

import { useEffect, useRef } from 'react'
import '../styles/briefing.css'
import { localDateKey } from '@shared/dates/dayMath'
import {
  AssistantMark,
  CheckCircle,
  DeadlineChip,
  FocusStar,
  LockMark,
  LoopBadge,
  PriorityMark
} from './Badges'
import type { Deadline, LegendFilterId, LegendPopoverProps } from './props'

const HOVER_MS = 2000
const noop = (): void => undefined

interface RowDef {
  filter: LegendFilterId
  label: string
  sample: React.ReactNode
}
interface GroupDef {
  name: string
  rows: RowDef[]
}

function buildGroups(now: Date): GroupDef[] {
  const todayKey = localDateKey(now)
  const hard: Deadline = { kind: 'hard', dueDate: todayKey, dueTime: '17:00', source: 'user' }
  const soft: Deadline = { kind: 'soft', dueDate: todayKey, source: 'user' }
  const unknown: Deadline = { kind: 'none', source: 'llm' }
  const rail = (kind: string): React.ReactNode => (
    <span className="legend__rail" data-rail={kind} aria-hidden="true" />
  )
  return [
    {
      name: 'Urgency',
      rows: [
        { filter: 'overdue', label: 'Brick rail — carried over', sample: rail('overdue') },
        { filter: 'dueToday', label: 'Ochre rail — due today', sample: rail('today') },
        { filter: 'thisWeek', label: 'Slate rail — this week', sample: rail('week') },
        { filter: 'later', label: 'No rail — later', sample: rail('none') }
      ]
    },
    {
      name: 'Deadlines',
      rows: [
        {
          filter: 'hardDeadline',
          label: 'Filled dot — a real deadline',
          sample: <DeadlineChip deadline={hard} now={now} />
        },
        {
          filter: 'softDeadline',
          label: 'Hollow dot — a soft target',
          sample: <DeadlineChip deadline={soft} now={now} />
        }
      ]
    },
    {
      name: 'Questions',
      rows: [
        {
          filter: 'question',
          label: 'Violet — the assistant has a question',
          sample: (
            <span className="legend__pair">
              <DeadlineChip deadline={unknown} now={now} needsReview />
              <LoopBadge count={2} />
            </span>
          )
        }
      ]
    },
    {
      name: 'Assistant',
      rows: [
        { filter: 'assistant', label: 'Organized by the assistant', sample: <AssistantMark /> },
        {
          filter: 'guessed',
          label: 'Dotted — a guess, tap to confirm',
          sample: <span className="guessed legend__text">Friday</span>
        },
        {
          filter: 'locked',
          label: "Locked — you edited this",
          sample: <LockMark visible />
        },
        {
          filter: 'working',
          label: 'Pulsing dot — assistant working',
          sample: <span className="dot dot--pulse pulse" aria-hidden="true" />
        },
        {
          filter: 'offline',
          label: 'Hollow gray dot — assistant offline',
          sample: <span className="dot dot--hollow" aria-hidden="true" />
        }
      ]
    },
    {
      name: 'Status',
      rows: [
        {
          filter: 'done',
          label: 'Filled check — done',
          sample: <CheckCircle done ariaLabel="Done sample" onToggle={noop} />
        },
        { filter: 'urgent', label: 'Filled mark — urgent', sample: <PriorityMark priority="urgent" /> },
        { filter: 'high', label: 'Outlined mark — high priority', sample: <PriorityMark priority="high" /> },
        {
          filter: 'stalled',
          label: 'Moon — quiet for a while',
          sample: <span className="moon" aria-hidden="true">☾</span>
        },
        {
          filter: 'focus',
          label: 'Star — focus, max three',
          sample: <FocusStar active onToggle={noop} />
        }
      ]
    }
  ]
}

export function LegendPopover(props: LegendPopoverProps): React.JSX.Element {
  const hoverTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  const hover = (filter: LegendFilterId | null): void => {
    window.clearTimeout(hoverTimer.current)
    props.onHover(filter)
    if (filter !== null) {
      hoverTimer.current = window.setTimeout(() => props.onHover(null), HOVER_MS)
    }
  }

  const groups = buildGroups(new Date())

  return (
    <div className="legend sheetbody" aria-label="Legend">
      <header className="sheetbody__head">
        <h2>Legend</h2>
        <button type="button" className="sheetbody__close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      {groups.map((g) => (
        <section key={g.name} className="legend__group">
          <h3 className="legend__groupname">{g.name}</h3>
          <ul role="list">
            {g.rows.map((row) => (
              <li key={row.filter}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`legend__row${props.activeFilter === row.filter ? ' legend__row--active' : ''}`}
                  aria-pressed={props.activeFilter === row.filter}
                  onMouseEnter={() => hover(row.filter)}
                  onMouseLeave={() => hover(null)}
                  onFocus={() => hover(row.filter)}
                  onBlur={() => hover(null)}
                  onClick={() =>
                    props.onApplyFilter(props.activeFilter === row.filter ? null : row.filter)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      props.onApplyFilter(props.activeFilter === row.filter ? null : row.filter)
                    }
                  }}
                >
                  <span className="legend__sample" aria-hidden="true" inert>
                    {row.sample}
                  </span>
                  <span className="legend__label">{row.label}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <footer className="legend__footer">Color never stands alone — every meaning has a shape.</footer>
    </div>
  )
}
