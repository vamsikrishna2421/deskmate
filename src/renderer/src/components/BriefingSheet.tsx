/** DESIGN §8 morning briefing: dateline, greeting, async synthesis, sections (max 3 rows
 *  + `+n more`), effort whisper, `Start the day →` / ghost `Later`. Sections stagger 40ms. */

import { useEffect, useRef, useState } from 'react'
import { briefingDateline, focusedWorkSentence, formatMinutes, greeting } from '../lib/format'
import '../styles/briefing.css'
import type { BriefTaskRef } from '@shared/types/enrichment'
import type { BriefingSheetProps } from './props'

const NUM_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const word = (n: number): string => NUM_WORDS[n] ?? String(n)

/** "All clear this morning." reads wrong at 3pm — match the greeting's time of day. */
function allClearLine(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'All clear this morning.'
  if (h < 17) return 'All clear this afternoon.'
  return 'All clear this evening.'
}

function Row(props: {
  t: BriefTaskRef
  onFocus(): void
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="briefing__row">
      <button type="button" className="briefing__rowtitle" onClick={props.onFocus}>
        {props.t.title}
      </button>
      {props.t.effortMinutes !== undefined && props.t.effortMinutes > 0 && (
        <span className="briefing__effort">{formatMinutes(props.t.effortMinutes)}</span>
      )}
      {props.children}
    </li>
  )
}

function Section(props: {
  index: number
  label: string
  rows: BriefTaskRef[]
  onFocus(id: string): void
  onMore(): void
  rowExtras?(t: BriefTaskRef): React.ReactNode
}): React.JSX.Element | null {
  if (props.rows.length === 0) return null
  const shown = props.rows.slice(0, 3)
  const rest = props.rows.length - shown.length
  return (
    <section className="briefing__section" style={{ animationDelay: `${props.index * 40}ms` }}>
      <h3 className="briefing__label">{props.label}</h3>
      <ul role="list">
        {shown.map((t) => (
          <Row key={t.id} t={t} onFocus={() => props.onFocus(t.id)}>
            {props.rowExtras?.(t)}
          </Row>
        ))}
      </ul>
      {rest > 0 && (
        <button type="button" className="briefing__more" onClick={props.onMore}>
          + {rest} more
        </button>
      )}
    </section>
  )
}

export function BriefingSheet(props: BriefingSheetProps): React.JSX.Element {
  const { briefing } = props
  const now = new Date()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  // The sheet owns the keyboard while open (DESIGN §18) — without this, Enter/Esc land on <body>.
  useEffect(() => {
    rootRef.current?.focus()
  }, [])
  const stalled = briefing.stalled.slice(0, 2)
  const questions = briefing.questions.slice(0, 2)
  const clear =
    briefing.overdue.length === 0 &&
    briefing.dueToday.length === 0 &&
    stalled.length === 0 &&
    questions.length === 0

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return
    if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return
    e.preventDefault()
    props.onAck()
  }

  let sectionIndex = 0

  return (
    <div
      ref={rootRef}
      className="briefing"
      role="region"
      aria-label="Morning briefing"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="briefing__dateline">{briefingDateline(now)}</div>
      <h2 className="briefing__greeting">{greeting(now)}</h2>
      <span className="briefing__rule" aria-hidden="true" />

      {/* Deterministic fallback renders instantly; the LLM sentence cross-fades in when it lands.
          The all-clear layout carries its own copy — a synthesis line would duplicate it. */}
      {!clear && (
        <div className="briefing__synthesis" aria-live="polite">
          <p key={briefing.synthesis ? 'llm' : 'fallback'} className="briefing__synthtext">
            {briefing.synthesis ?? props.fallbackSynthesis}
          </p>
        </div>
      )}

      {clear ? (
        <div className="briefing__clear">
          <p>{allClearLine(now)}</p>
          {briefing.dueThisWeek.length > 0 && (
            <p>
              {briefing.dueThisWeek.length === 1
                ? 'One thing sometime this week.'
                : `${word(briefing.dueThisWeek.length)} things sometime this week.`}
            </p>
          )}
        </div>
      ) : (
        <>
          <Section
            index={sectionIndex++}
            label="Carried over"
            rows={briefing.overdue}
            onFocus={props.onFocusTask}
            onMore={() => props.onMore('today')}
            rowExtras={(t) => (
              <span className="briefing__rowactions">
                <button type="button" className="ghost" onClick={() => props.onTaskAction(t.id, 'moveToToday')}>
                  Move to today
                </button>
                <button type="button" className="ghost" onClick={() => props.onTaskAction(t.id, 'reschedule')}>
                  Reschedule
                </button>
                <button type="button" className="ghost ghost--letgo" onClick={() => props.onTaskAction(t.id, 'letGo')}>
                  Let go
                </button>
              </span>
            )}
          />
          <Section
            index={sectionIndex++}
            label="Due today"
            rows={briefing.dueToday}
            onFocus={props.onFocusTask}
            onMore={() => props.onMore('today')}
          />
          <Section
            index={sectionIndex++}
            label="This week"
            rows={briefing.dueThisWeek}
            onFocus={props.onFocusTask}
            onMore={() => props.onMore('week')}
          />
          {stalled.length > 0 && (
            <section className="briefing__section" style={{ animationDelay: `${sectionIndex++ * 40}ms` }}>
              <h3 className="briefing__label">Quiet for a while</h3>
              <p className="briefing__hint">Still relevant?</p>
              <ul role="list">
                {stalled.map((t) => (
                  <Row key={t.id} t={t} onFocus={() => props.onFocusTask(t.id)}>
                    <span className="briefing__rowactions">
                      <button type="button" className="ghost" onClick={() => props.onTaskAction(t.id, 'keep')}>
                        Keep
                      </button>
                      <button type="button" className="ghost ghost--letgo" onClick={() => props.onTaskAction(t.id, 'letGo')}>
                        Let go
                      </button>
                    </span>
                  </Row>
                ))}
              </ul>
            </section>
          )}
          {questions.length > 0 && (
            <section className="briefing__section briefing__section--loops" style={{ animationDelay: `${sectionIndex++ * 40}ms` }}>
              <h3 className="briefing__label briefing__label--loop">Quick questions</h3>
              <ul role="list">
                {questions.map((q) => (
                  <li key={q.questionId} className="briefing__row briefing__row--question">
                    <span className="briefing__q">{q.question}</span>
                    <input
                      type="text"
                      className="loops__input"
                      placeholder="Answer briefly…"
                      aria-label={q.question}
                      value={answers[q.questionId] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.questionId]: e.target.value }))}
                      onKeyDown={(e) => {
                        const text = (answers[q.questionId] ?? '').trim()
                        if (e.key === 'Enter' && text) {
                          e.preventDefault()
                          props.onAnswerQuestion(q.taskId, q.questionId, text)
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="loops__dismiss"
                      onClick={() => props.onDismissQuestion(q.taskId, q.questionId)}
                    >
                      Not important
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {briefing.effortTodayMinutes !== undefined && briefing.effortTodayMinutes > 0 && (
        <p className="briefing__whisper">{focusedWorkSentence(briefing.effortTodayMinutes)}</p>
      )}

      <footer className="briefing__footer">
        {/* The greeting is time-aware, so the CTA must be too — "Good evening" ending in
            "Start the day →" reads like a bug (the briefing fires on first focus, any hour). */}
        <button type="button" className="primary" onClick={props.onAck}>
          {new Date().getHours() < 12
            ? 'Start the day →'
            : new Date().getHours() < 17
              ? 'Back to it →'
              : 'Plan tomorrow →'}
        </button>
        <button type="button" className="ghost" onClick={props.onDefer}>
          Later
        </button>
      </footer>
    </div>
  )
}
