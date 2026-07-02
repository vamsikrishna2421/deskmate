/** THE PROPS CONTRACT for every component in DESIGN.md §15's inventory.
 *
 *  Component files implement these interfaces as NAMED exports matching the file name
 *  (e.g. `export function TitleBar(props: TitleBarProps)` in components/TitleBar.tsx;
 *  the Badges suite lives together in components/Badges.tsx). Components import ONLY from
 *  this file, the store hooks (state/store), lib/api, lib/format, and the token/base CSS.
 *  All data + callbacks arrive via props — no context reach-ins except the documented hooks. */

import type { Task, TaskPatch, Deadline, Effort, Priority, Subtask, OpenQuestion } from '@shared/types/task'
import type { AppState, OllamaStatus, Settings } from '@shared/types/appState'
import type { Briefing } from '@shared/types/enrichment'
import type { LegendFilterId, SheetId, Toast, ViewId } from '../state/uiReducer'
import type { EffortBucket, TaskGroup, ViewModel } from '../state/selectors'

export type { LegendFilterId, SheetId, Toast, ViewId, EffortBucket, TaskGroup, ViewModel }
export type { Task, TaskPatch, Deadline, Effort, Priority, Subtask, OpenQuestion }
export type { AppState, OllamaStatus, Settings, Briefing }

/** Transient pipeline activity per task id ('queued'|'running'); enrichment history lives on task.enrichment. */
export type ActiveEnrichmentMap = Readonly<Record<string, 'queued' | 'running'>>

/** Every per-task interaction, built once in App.tsx and threaded down.
 *  All handlers are fire-and-forget — state comes back via pushes. */
export interface TaskActions {
  /** Check circle / Space / D. App shows the 'Done · Undo' toast (DESIGN §5 DONE row). */
  onToggleDone(id: string): void
  /** Enter/click grows the card in place (DESIGN §6); null collapses. */
  onExpand(id: string | null): void
  /** 'E' / action row → TaskEditor sheet. */
  onEdit(id: string): void
  /** 'S' — pushes the deadline to tomorrow (soft if none). */
  onSnooze(id: string): void
  /** 'T' — pins the task into Today ('Picked for today'). */
  onMoveToToday(id: string): void
  /** 'Let go' — removes the task; an Undo toast (6s) can restore it exactly as it was. */
  onLetGo(id: string): void
  /** Free-form extra details → the assistant re-enriches the task with the new facts. */
  onAddContext(id: string, note: string): void
  /** 'P' cycles urgent→high→normal→low→optional. */
  onCyclePriority(id: string): void
  /** ★ focus star toggle (max 3 alive — main enforces; UI disables at 3). */
  onToggleFocus(id: string): void
  onToggleSubtask(taskId: string, subtaskId: string): void
  onDeleteSubtask(taskId: string, subtaskId: string): void
  /** Loop answered → main re-enriches; affected fields shimmer (DESIGN §7). */
  onAnswerQuestion(taskId: string, questionId: string, answer: string): void
  /** 'Not important' — dismissed questions are never re-asked. */
  onDismissQuestion(taskId: string, questionId: string): void
  /** Retry glyph on OFFLINE/FAILED cards (DESIGN §5). */
  onRetryEnrich(id: string): void
  /** Inline title edit and other direct field writes (flips provenance→user in main). */
  onUpdate(id: string, patch: TaskPatch): void
}

/** Shade-state ticker content: `Today 3 · ◌1 · ● 5pm board deck` (DESIGN §3). */
export interface ShadeTicker {
  todayCount: number
  loopsCount: number
  /** Next hard deadline today, if one is still ahead. Title pre-truncated ~18ch by App. */
  nextHard?: { taskId: string; timeLabel: string; title: string }
}

export type TitleBarMenuAction =
  | 'legend'
  | 'settings'
  | 'briefing'
  | 'guide'
  | 'tour'
  | 'pauseAssistant'
  | 'resumeAssistant'
  | 'moveWindow'
  | 'quit'

/** First-launch interactive tour (App shows it while !onboardingDone). */
export interface WelcomeTourProps {
  captureHotkey: string
  toggleHotkey: string
  /** Finish or skip; withSample captures a canned manager message so enrichment runs live. */
  onFinish(withSample: boolean): void
}

/** Always-available how-to (··· menu / F1). */
export interface GuideSheetProps {
  captureHotkey: string
  toggleHotkey: string
  onReplayTour(): void
  onClose(): void
}

/** DESIGN §3 header (40px, drag region): glyph · view title · `+` capture, pin, `···`,
 *  minimize, close — 28×28 hit targets marked .no-drag. Double-click background → shade.
 *  When `shaded`, render ONLY the ticker beside the glyph (window is 48px tall). */
export interface TitleBarProps {
  viewTitle: string
  pinned: boolean
  shaded: boolean
  /** Pulsing spruce dot on the glyph while the assistant works (hover: 'Organizing n task(s)…').
   *  Count of tasks currently queued/running; 0 = idle. Pulse suspends while shaded. */
  assistantWorkingCount: number
  assistantPaused: boolean
  ticker: ShadeTicker | null
  onCapture(): void
  onTogglePin(): void
  onToggleShade(): void
  onMinimize(): void
  onHide(): void
  onMenu(action: TitleBarMenuAction): void
}

/** DESIGN §12 degraded strip: `Assistant is offline — everything still works. Retry`.
 *  Render nothing when reachable; paused renders `Assistant is paused. Resume`. */
export interface OllamaBannerProps {
  reachable: boolean
  paused: boolean
  onRetry(): void
  onResume(): void
  /** Dismiss hides the strip until the next reachability flip (App owns that memory). */
  onDismiss(): void
}

/** DESIGN §4.6 inline capture at the top of the current list ('N' / header '+').
 *  Same behaviors as the capture window: pre-hint tokens, Tab deadline chip,
 *  Enter submit / Shift+Enter newline / Ctrl+Enter submit-and-keep-open / Esc close. */
export interface CaptureBarProps {
  open: boolean
  onSubmit(req: {
    sourceText: string
    sourceKind: 'paste' | 'typed'
    hints?: import('@shared/types/enrichment').CaptureHints
    keepOpen: boolean
  }): void
  onClose(): void
}

/** DESIGN §9 tabs: `Today · Week · Later · Done`, superscript counts, sliding underline,
 *  `◌ n` loops chip (only when loops exist), '/' morphs the row into inline search. */
export interface ViewTabsProps {
  view: ViewId
  /** Task-view counts only — the Desk tab intentionally has no superscript. */
  counts: Partial<Record<ViewId, number>>
  loopsCount: number
  loopsActive: boolean
  searchOpen: boolean
  searchQuery: string
  onSelectView(view: ViewId): void
  onToggleLoops(): void
  onSearchOpen(): void
  onSearchChange(query: string): void
  onSearchClose(): void
}

/** DESIGN §9 list: grouping, sort, week load gauges, Later `Got 30 minutes?` filter row
 *  (local pill state; use `effortBucket` from state/selectors), typography-only empty states,
 *  no reorder while pointer inside (defer until exit or 3s idle). Roving tabindex lives HERE:
 *  ↑/↓ j/k move focus, Enter expands, Space/D done, E edit, S snooze, T today, P priority —
 *  delegated to `actions`. `focusTaskId` change → scroll to + focus that card. */
export interface TaskListProps {
  viewModel: ViewModel
  now: Date
  expandedTaskId: string | null
  focusTaskId: string | null
  /** Called once the focus target has been scrolled to + focused — App clears focusTaskId. */
  onFocusHandled?: () => void
  enrichment: ActiveEnrichmentMap
  stalledIds: ReadonlySet<string>
  /** Loops batch mode ('A'): only looped cards, question blocks pre-expanded (DESIGN §7). */
  loopsBatchMode: boolean
  /** Legend hover → 2s highlight of matching cards behind the sheet (DESIGN §10). */
  legendHover: LegendFilterId | null
  /** True while a search query or legend filter narrows the list (affects empty text). */
  filtered: boolean
  /** Today footer whisper when present: 'About 3h of focused work today.' */
  effortFooter?: string
  actions: TaskActions
}

/** DESIGN §5 state matrix + §6 collapsed anatomy: urgency rail, check circle, 2-line title,
 *  meta row (DeadlineChip, EffortChip, PriorityMark, TagRow, LoopBadge, AssistantMark,
 *  FocusStar, EnrichShimmer while queued/running). Renders TaskCardDetail when expanded. */
export interface TaskCardProps {
  task: Task
  now: Date
  expanded: boolean
  /** Transient pipeline state; undefined when idle (task.enrichment has history). */
  enrichment?: 'queued' | 'running'
  /** Moon glyph 'quiet for a while' (DESIGN §9/§10). */
  stalled: boolean
  /** Legend-hover match: brief emphasis outline. */
  highlighted?: boolean
  /** Later view renders effort chips one step larger (DESIGN §9). */
  effortEmphasis?: boolean
  /** Batch loops flow: question block pre-expanded, j/k · 1–3 · T · S keys (DESIGN §7). */
  batchMode?: boolean
  actions: TaskActions
}

/** DESIGN §6 expanded card: inline-editable title (lock-on-hover when user-owned), summary,
 *  SubtaskChecklist, OpenQuestions, `From pasted message` sunken mono block (class
 *  `source-block selectable`), created/edited timestamps, ghost action row
 *  `Edit (E) · Snooze (S) · Move to today (T) · Let go`. Esc collapses (App cascade). */
export interface TaskCardDetailProps {
  task: Task
  now: Date
  batchMode?: boolean
  actions: TaskActions
}

/** DESIGN §6 subtasks: mini check circles, collapsed beyond 3 with `2/5` progress,
 *  hover-delete per row. LLM rows capped at 5 upstream. */
export interface SubtaskChecklistProps {
  taskId: string
  subtasks: Subtask[]
  onToggle(subtaskId: string): void
  onDelete(subtaskId: string): void
}

/** DESIGN §7 violet `Quick questions` block: ≤2 visible (rest `+n more`), free-text input
 *  `Answer briefly…` Enter submits, ghost `Not important` per loop. Answered → `✓ …` collapse;
 *  last one → `Thanks — updating…`. After LOOPS_FOLD_WORKDAYS unanswered, folded to
 *  `n unanswered questions` (one quiet line, click unfolds). */
export interface OpenQuestionsProps {
  taskId: string
  questions: OpenQuestion[]
  /** Render folded single-line summary (App computes from activity age). */
  folded: boolean
  /** Batch flow: all questions expanded, rapid-fire keys active. */
  batchMode?: boolean
  onAnswer(questionId: string, answer: string): void
  onDismiss(questionId: string): void
}

// ── Badges suite (all in components/Badges.tsx — DESIGN §6/§10) ────────────────

/** ● filled = hard · ○ hollow = soft · violet `◌ when?` = the assistant needs a date.
 *  Compute content with `deadlineChip(deadline, now, { needsReview })` from lib/format.
 *  Tooltip quotes the source phrase when LLM-inferred. */
export interface DeadlineChipProps {
  deadline: Deadline
  now: Date
  /** task.enrichment.needsReview — drives the violet `◌ when?` variant. */
  needsReview?: boolean
  /** Later view: one step larger. */
  large?: boolean
  /** Clicking `◌ when?` focuses the "When is this due?" loop (DESIGN §6). */
  onWhenClick?(): void
}

export interface EffortChipProps {
  effort: Effort
  large?: boolean
}

/** ≤2 pills + `+n` overflow. */
export interface TagRowProps {
  tags: string[]
  max?: number
}

/** ▲ filled = urgent · ▲ outline = high — neutral ink, never red; normal/low render nothing. */
export interface PriorityMarkProps {
  priority: Priority
}

/** Violet `◌ n` — open questions count; renders nothing at 0. */
export interface LoopBadgeProps {
  count: number
}

/** ✦ organized-by-assistant mark; hover = provenance. `guessed` adds the dotted underline
 *  ('Assistant guessed — tap to confirm'). */
export interface AssistantMarkProps {
  /** e.g. 'From the message: "need this by EOD Thursday"'. */
  provenance?: string
  guessed?: boolean
}

/** Small lock on hover for user-edited fields: 'You edited this — the assistant won't change it'. */
export interface LockMarkProps {
  visible: boolean
}

/** ★ spruce, max 3 app-wide; dotted when an unconfirmed LLM proposal. */
export interface FocusStarProps {
  active: boolean
  proposed?: boolean
  /** Disabled (with tooltip) when 3 stars are alive and this one is off. */
  disabled?: boolean
  onToggle(): void
}

/** Two skeleton lines 60%/40% width, 8px, r4, opacity 0.5→0.9 over var(--shimmer-loop).
 *  Class `shimmer` (base.css freezes it at 70% under reduced motion). */
export interface EnrichShimmerProps {
  /** 'queued' shows hollow dot + 'Waiting…'; 'running' shows pulsing dot + shimmer. */
  state: 'queued' | 'running'
  /** After 8s running: 'Assistant is waking up…' (App/TaskCard owns the timer). */
  slow?: boolean
}

/** 18px check circle, 1.5px stroke, hover tint-fill; done draws the check in var(--dur-check). */
export interface CheckCircleProps {
  done: boolean
  ariaLabel: string
  onToggle(): void
}

// ── Sheets & chrome ────────────────────────────────────────────────────────────

/** Manual edit bottom sheet — every field, saving flips provenance→user in main (tasks:update). */
export interface TaskEditorProps {
  task: Task
  /** ★ alive count app-wide, to disable the 4th star. */
  focusCount: number
  onSave(patch: TaskPatch): void
  onLetGo(id: string): void
  onClose(): void
}

/** DESIGN §8 morning briefing sheet (replaces list content; tabs hidden while open).
 *  Dateline + greeting via lib/format; synthesis line shows `briefing.synthesis` or the
 *  skeleton + `fallbackSynthesis`. Sections max 3 rows + `+n more`; footer
 *  `Start the day →` (Enter) / ghost `Later`. */
export interface BriefingSheetProps {
  briefing: Briefing
  /** Deterministic instant line (lib/format briefingFallback) while synthesis is pending. */
  fallbackSynthesis: string
  /** True until briefing.synthesis arrives — render one skeleton shimmer line. */
  synthesisPending: boolean
  onAck(): void
  onDefer(): void
  /** '+ n more' on a section → close the briefing into that section's view. */
  onMore(view: 'today' | 'week'): void
  /** Row click → focus that task in its view. */
  onFocusTask(taskId: string): void
  /** Carried over: 'moveToToday' | 'reschedule' | 'letGo' · Stalled: 'keep' | 'letGo'. */
  onTaskAction(taskId: string, action: 'moveToToday' | 'reschedule' | 'letGo' | 'keep'): void
  onAnswerQuestion(taskId: string, questionId: string, answer: string): void
  onDismissQuestion(taskId: string, questionId: string): void
}

/** One legend row: live component sample + ≤6-word label. */
export interface LegendEntry {
  filter: LegendFilterId
  label: string
  group: 'Urgency' | 'Deadlines' | 'Questions' | 'Assistant' | 'Status'
}

/** DESIGN §10 live legend bottom sheet: rows render REAL components at true size; hovering a
 *  row highlights matching cards for 2s (onHover), clicking applies/clears the list filter.
 *  Footer: 'Color never stands alone — every meaning has a shape.' */
export interface LegendPopoverProps {
  activeFilter: LegendFilterId | null
  onHover(filter: LegendFilterId | null): void
  onApplyFilter(filter: LegendFilterId | null): void
  onClose(): void
}

/** DESIGN §11 settings sheet. All writes go through onUpdate (Partial<Settings>);
 *  AppState-only fields are read-only here. Base URL edits must keep loopback-only
 *  (validation also enforced in main). */
export interface SettingsSheetProps {
  settings: AppState
  ollama: OllamaStatus
  version: string
  onUpdate(patch: Partial<Settings>): void
  onRetryOllama(): void
  onOpenDataFolder(): void
  onExportAll(): void
  onClose(): void
}

/** Bottom-stacked quiet toasts: `Done · Undo`, hotkey conflicts, load errors.
 *  Component owns auto-dismiss timers (toast.durationMs, default 5000; 0 = sticky). */
export interface ToastsProps {
  toasts: Toast[]
  onAction(id: string): void
  onDismiss(id: string): void
}
