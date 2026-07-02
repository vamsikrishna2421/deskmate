/** DESIGN §7 violet `Quick questions` block. Question type is inferred from the text:
 *  timing questions get date chips (+ inline month grid), "A or B" questions get choice
 *  pills, the rest a free-text input. Batch mode exposes data-loop-* hooks that TaskList's
 *  rapid-fire keys (1–3 · T · S) drive on the focused card. */

import { useEffect, useRef, useState } from 'react'
import { localDateKey } from '@shared/dates/dayMath'
import type { OpenQuestion, OpenQuestionsProps } from './props'

const DATE_RE = /\b(when|due|deadline|what day|what date|by what|how soon|which day)\b/i
const CHOICE_RE = /([^?,;:]{2,32})\s+or\s+([^?.,;:]{2,32})\s*\?*\s*$/i

type Affordance =
  | { kind: 'date' }
  | { kind: 'choice'; options: string[] }
  | { kind: 'text' }

function inferAffordance(question: string): Affordance {
  const choice = CHOICE_RE.exec(question)
  if (choice) {
    const clean = (s: string): string => {
      const t = s.trim().replace(/^(a|an|the|be|it|is it|should it be)\s+/i, '').trim()
      return t.charAt(0).toUpperCase() + t.slice(1)
    }
    const options = [clean(choice[1]), clean(choice[2])].filter((o) => o.length > 1 && o.length <= 32)
    if (options.length === 2) return { kind: 'choice', options }
  }
  if (DATE_RE.test(question)) return { kind: 'date' }
  return { kind: 'text' }
}

function MonthGrid({ onPick }: { onPick: (dateKey: string) => void }): React.JSX.Element {
  const [offset, setOffset] = useState(0)
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const todayKey = localDateKey(now)
  const cells: Array<number | null> = [...Array<null>(lead).fill(null)]
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return (
    <div className="monthgrid" role="group" aria-label={`Pick a date, ${monthLabel}`}>
      <div className="monthgrid__head">
        <button type="button" aria-label="Previous month" onClick={() => setOffset((o) => o - 1)}>‹</button>
        <span>{monthLabel}</span>
        <button type="button" aria-label="Next month" onClick={() => setOffset((o) => o + 1)}>›</button>
      </div>
      <div className="monthgrid__days">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="monthgrid__dow" aria-hidden="true">{d}</span>
        ))}
        {cells.map((d, i) =>
          d === null ? (
            <span key={`pad${i}`} />
          ) : (
            <button
              key={d}
              type="button"
              className={
                localDateKey(new Date(first.getFullYear(), first.getMonth(), d)) === todayKey
                  ? 'monthgrid__day monthgrid__day--today'
                  : 'monthgrid__day'
              }
              onClick={() => onPick(localDateKey(new Date(first.getFullYear(), first.getMonth(), d)))}
            >
              {d}
            </button>
          )
        )}
      </div>
    </div>
  )
}

function QuestionRow(props: {
  q: OpenQuestion
  first: boolean
  onAnswer(answer: string): void
  onDismiss(): void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const affordance = inferAffordance(props.q.question)
  const keyAttr = (n: number): { 'data-loop-key'?: string } =>
    props.first ? { 'data-loop-key': String(n) } : {}

  return (
    <li className="loops__row">
      <span className="loops__q">{props.q.question}</span>
      <div className="loops__affordance">
        {affordance.kind === 'choice' &&
          affordance.options.map((opt, i) => (
            <button key={opt} type="button" className="loops__pill" {...keyAttr(i + 1)} onClick={() => props.onAnswer(opt)}>
              {opt}
            </button>
          ))}
        {affordance.kind === 'date' && (
          <>
            <button type="button" className="loops__pill" {...keyAttr(1)} onClick={() => props.onAnswer('today')}>
              Today
            </button>
            <button type="button" className="loops__pill" {...keyAttr(2)} onClick={() => props.onAnswer('tomorrow')}>
              Tomorrow
            </button>
            <button type="button" className="loops__pill" {...keyAttr(3)} onClick={() => props.onAnswer('Friday')}>
              Friday
            </button>
            <button type="button" className="loops__pill" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
              Pick…
            </button>
          </>
        )}
        {affordance.kind === 'text' && (
          <input
            type="text"
            className="loops__input"
            placeholder="Answer briefly…"
            aria-label={props.q.question}
            value={text}
            {...(props.first ? { 'data-loop-input': 'true' } : {})}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && text.trim()) {
                e.preventDefault()
                props.onAnswer(text.trim())
              }
            }}
          />
        )}
        <button
          type="button"
          className="loops__dismiss"
          {...(props.first ? { 'data-loop-dismiss': 'true' } : {})}
          onClick={props.onDismiss}
        >
          Not important
        </button>
      </div>
      {picking && affordance.kind === 'date' && <MonthGrid onPick={(key) => props.onAnswer(key)} />}
    </li>
  )
}

export function OpenQuestions(props: OpenQuestionsProps): React.JSX.Element | null {
  const [unfolded, setUnfolded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [updating, setUpdating] = useState(false)
  const openCount = props.questions.filter((q) => q.status === 'open').length
  const prevOpen = useRef(openCount)

  useEffect(() => {
    const was = prevOpen.current
    prevOpen.current = openCount
    if (openCount > 0) {
      // Re-enrichment added a new question — 'Thanks — updating…' must yield to it, not stick
      // (the old timer's cleanup would otherwise cancel the reset forever).
      setUpdating(false)
      return undefined
    }
    if (was > 0) {
      setUpdating(true)
      const t = window.setTimeout(() => setUpdating(false), 2500)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [openCount])

  const open = props.questions.filter((q) => q.status === 'open')
  const answered = props.questions.filter((q) => q.status === 'answered')
  if (open.length === 0 && answered.length === 0 && !updating) return null

  if (props.folded && !unfolded && !props.batchMode && open.length > 0) {
    return (
      <button type="button" className="loops loops--folded" onClick={() => setUnfolded(true)}>
        {open.length} unanswered {open.length === 1 ? 'question' : 'questions'}
      </button>
    )
  }

  const cap = props.batchMode || showAll ? open.length : 2
  const visible = open.slice(0, cap)
  const hidden = open.length - visible.length

  return (
    <div className="loops" role="group" aria-label="Quick questions">
      <div className="loops__head">Quick questions</div>
      <ul className="loops__list" role="list">
        {visible.map((q, i) => (
          <QuestionRow
            key={q.id}
            q={q}
            first={i === 0}
            onAnswer={(answer) => props.onAnswer(q.id, answer)}
            onDismiss={() => props.onDismiss(q.id)}
          />
        ))}
        {answered.map((q) => (
          <li key={q.id} className="loops__row loops__row--answered">
            <span aria-hidden="true">✓</span> <span className="loops__done">{q.question}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="loops__more" onClick={() => setShowAll(true)}>
          +{hidden} more
        </button>
      )}
      {updating && (
        <div className="loops__updating shimmer" role="status" aria-live="polite">
          Thanks — updating…
        </div>
      )}
    </div>
  )
}
