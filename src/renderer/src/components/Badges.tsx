/** Badges suite (DESIGN §6/§10): DeadlineChip, EffortChip, TagRow, PriorityMark, LoopBadge,
 *  AssistantMark, LockMark, FocusStar, EnrichShimmer, CheckCircle. Color never stands alone —
 *  every semantic color pairs with a shape or word. */

import { deadlineChip, formatEffort } from '../lib/format'
import '../styles/cards.css'
import type {
  AssistantMarkProps,
  CheckCircleProps,
  DeadlineChipProps,
  EffortChipProps,
  EnrichShimmerProps,
  FocusStarProps,
  LockMarkProps,
  LoopBadgeProps,
  PriorityMarkProps,
  TagRowProps
} from './props'

export function DeadlineChip(props: DeadlineChipProps): React.JSX.Element | null {
  const chip = deadlineChip(props.deadline, props.now, { needsReview: props.needsReview })
  if (!chip) return null
  const tooltip = chip.sourcePhrase ? `From the message: "${chip.sourcePhrase}"` : undefined
  const cls = `chip chip--deadline${props.large ? ' chip--lg' : ''}`
  const aria =
    chip.variant === 'hard'
      ? `Hard deadline: ${chip.text}`
      : chip.variant === 'soft'
        ? `Soft target: ${chip.text}`
        : chip.variant === 'overdue'
          ? `Carried over: was due ${chip.text}`
          : 'The assistant needs a date — when is this due?'
  if (chip.variant === 'question') {
    return (
      <button
        type="button"
        className={`${cls} chip--question`}
        data-variant="question"
        aria-label={aria}
        title="When is this due?"
        onClick={props.onWhenClick}
      >
        <span className="chip__icon" aria-hidden="true">
          {chip.icon}
        </span>
        {chip.text}
      </button>
    )
  }
  return (
    <span className={cls} data-variant={chip.variant} aria-label={aria} title={tooltip}>
      <span className="chip__icon" aria-hidden="true">
        {chip.icon}
      </span>
      {chip.text}
    </span>
  )
}

export function EffortChip(props: EffortChipProps): React.JSX.Element {
  return (
    <span
      className={`chip chip--effort${props.large ? ' chip--lg' : ''}`}
      aria-label={`Estimated effort ${formatEffort(props.effort)}`}
    >
      {formatEffort(props.effort)}
    </span>
  )
}

export function TagRow(props: TagRowProps): React.JSX.Element | null {
  const max = props.max ?? 2
  if (props.tags.length === 0) return null
  const shown = props.tags.slice(0, max)
  const rest = props.tags.length - shown.length
  return (
    <span className="tagrow" aria-label={`Tags: ${props.tags.join(', ')}`}>
      {shown.map((tag) => (
        <span key={tag} className="tagrow__pill">
          {tag}
        </span>
      ))}
      {rest > 0 && <span className="tagrow__more">+{rest}</span>}
    </span>
  )
}

export function PriorityMark(props: PriorityMarkProps): React.JSX.Element | null {
  if (props.priority !== 'urgent' && props.priority !== 'high') return null
  const urgent = props.priority === 'urgent'
  return (
    <span
      className="prioritymark"
      aria-label={urgent ? 'Urgent priority' : 'High priority'}
      title={urgent ? 'Urgent' : 'High priority'}
    >
      {urgent ? '▲' : '△'}
    </span>
  )
}

export function LoopBadge(props: LoopBadgeProps): React.JSX.Element | null {
  if (props.count <= 0) return null
  return (
    <span
      className="loopbadge"
      aria-label={`${props.count} open ${props.count === 1 ? 'question' : 'questions'} from the assistant`}
      title="The assistant has a question"
    >
      <span aria-hidden="true">◌</span> {props.count}
    </span>
  )
}

export function AssistantMark(props: AssistantMarkProps): React.JSX.Element {
  return (
    <span
      className={`assistantmark${props.guessed ? ' assistantmark--guessed' : ''}`}
      aria-label={
        props.guessed ? 'Assistant guessed — tap to confirm' : 'Organized by the local assistant'
      }
      title={props.provenance ?? (props.guessed ? 'Assistant guessed — tap to confirm' : 'Organized by the assistant')}
    >
      ✦
    </span>
  )
}

export function LockMark(props: LockMarkProps): React.JSX.Element | null {
  if (!props.visible) return null
  return (
    <span
      className="lockmark"
      aria-label="You edited this — the assistant won't change it"
      title="You edited this — the assistant won't change it"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1.5" y="4.5" width="7" height="4.5" rx="1" fill="currentColor" />
        <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </span>
  )
}

export function FocusStar(props: FocusStarProps): React.JSX.Element {
  const label = props.active
    ? 'Focus — click to let go of the star'
    : props.disabled
      ? 'Three focus stars are alive — let one go first'
      : 'Mark as focus (max 3)'
  return (
    <button
      type="button"
      className={`focusstar${props.active ? ' focusstar--active' : ''}${
        props.proposed ? ' focusstar--proposed' : ''
      }`}
      aria-pressed={props.active}
      aria-label={label}
      title={props.proposed ? 'The assistant proposed this focus — click to confirm' : label}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      ★
    </button>
  )
}

export function EnrichShimmer(props: EnrichShimmerProps): React.JSX.Element {
  if (props.state === 'queued') {
    return (
      <span className="enrich enrich--queued" role="status" aria-live="polite">
        <span className="dot dot--hollow" aria-hidden="true" />
        Waiting…
      </span>
    )
  }
  return (
    <span className="enrich enrich--running" role="status" aria-live="polite">
      <span className="dot dot--pulse pulse" aria-hidden="true" />
      {props.slow ? (
        'Assistant is waking up…'
      ) : (
        <>
          <span className="visually-hidden">Reading…</span>
          <span className="enrich__lines" aria-hidden="true">
            <span className="enrich__line shimmer" />
            <span className="enrich__line enrich__line--short shimmer" />
          </span>
        </>
      )}
    </span>
  )
}

export function CheckCircle(props: CheckCircleProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`check${props.done ? ' check--done' : ''}`}
      aria-label={props.ariaLabel}
      aria-pressed={props.done}
      onClick={(e) => {
        e.stopPropagation()
        props.onToggle()
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="check__ring" cx="9" cy="9" r="8" fill="none" strokeWidth="1.5" />
        <path
          className="check__tick"
          d="M5.2 9.4l2.4 2.5 5-5.6"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
