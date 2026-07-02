/** Companion shell (DESIGN §2/§3/§9): layout, global keyboard map, sheet orchestration,
 *  shade state, toasts. Roving list focus lives in TaskList; App owns view keys 1–4,
 *  '/', '?', 'N', 'A' and the Esc cascade (sheet → editor → capture → collapse → clear → shade). */

import { useEffect, useRef, useState } from 'react'
import type { Task, TaskPatch } from '@shared/types/task'
import type { Settings } from '@shared/types/appState'
import { localDateKey } from '@shared/dates/dayMath'
import { useApi, useTasks, useTasksDispatch, useUI, useUIDispatch } from '../state/store'
import { makeToast, type TaskViewId, type ViewId } from '../state/uiReducer'
import {
  filterViewModel,
  hasOpenLoops,
  isOpen,
  legendPredicate,
  searchTasks,
  selectCounts,
  selectNextHardToday,
  selectOpenLoopsCount,
  selectStalledIds,
  selectViewModel,
  viewForTask,
  type ViewModel
} from '../state/selectors'
import type { LegendFilterId } from '../state/uiReducer'

/** Human label for the active legend filter banner. */
const FILTER_LABELS: Record<LegendFilterId, string> = {
  overdue: 'carried over',
  dueToday: 'due today',
  thisWeek: 'this week',
  later: 'later',
  hardDeadline: 'hard deadlines',
  softDeadline: 'soft targets',
  question: 'open questions',
  assistant: 'organized by the assistant',
  guessed: 'assistant guesses',
  locked: 'your edits',
  done: 'done',
  urgent: 'urgent',
  high: 'high priority',
  stalled: 'quiet for a while',
  offline: 'assistant offline',
  working: 'being organized',
  focus: 'focus'
}
import { briefingFallback, focusedWorkSentence, formatTime, truncate } from '../lib/format'
import { useTaskActions } from './useTaskActions'
import { useGlobalKeys } from './useGlobalKeys'
import type { ShadeTicker, TitleBarMenuAction } from '../components/props'
import { TitleBar } from '../components/TitleBar'
import { OllamaBanner } from '../components/OllamaBanner'
import { CaptureBar } from '../components/CaptureBar'
import { ViewTabs } from '../components/ViewTabs'
import { TaskList } from '../components/TaskList'
import { SnippetsView } from '../components/SnippetsView'
import { WelcomeTour } from '../components/WelcomeTour'
import { GuideSheet } from '../components/GuideSheet'
import { TaskEditor } from '../components/TaskEditor'
import { SheetContainer } from '../components/SheetContainer'
import { BriefingSheet } from '../components/BriefingSheet'
import { LegendPopover } from '../components/LegendPopover'
import { SettingsSheet } from '../components/SettingsSheet'
import { Toasts } from '../components/Toasts'

const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Today',
  week: 'Week',
  later: 'Later',
  done: 'Done',
  snippets: 'Desk'
}

export default function App(): React.JSX.Element {
  const tasksState = useTasks()
  const tasksDispatch = useTasksDispatch()
  const ui = useUI()
  const uiDispatch = useUIDispatch()
  const api = useApi()

  // Renderer clock for date-sensitive rendering. State only changes when the MINUTE changes
  // (a fresh Date identity every tick would defeat TaskCard's memo list-wide), and the tick
  // is a no-op while hidden — visibilitychange catches the clock up on return.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const maybeTick = (): void => {
      if (document.hidden) return
      const d = new Date()
      setNow((prev) =>
        prev.getMinutes() === d.getMinutes() && prev.getHours() === d.getHours() && prev.getDate() === d.getDate()
          ? prev
          : d
      )
    }
    const id = window.setInterval(maybeTick, 30_000)
    document.addEventListener('visibilitychange', maybeTick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', maybeTick)
    }
  }, [])

  const [version, setVersion] = useState('')
  useEffect(() => {
    api.invoke('app:getVersion', undefined).then(setVersion).catch(() => setVersion(''))
  }, [api])

  // Very first launch → the welcome tour teaches by doing (README is where instructions die).
  const welcomeShownRef = useRef(false)
  useEffect(() => {
    if (!tasksState.hydrated || welcomeShownRef.current || !tasksState.settings) return
    if (!tasksState.settings.onboardingDone) {
      welcomeShownRef.current = true
      uiDispatch({ type: 'openSheet', sheet: 'welcome' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksState.hydrated, tasksState.settings])

  const finishTour = (withSample: boolean): void => {
    void api.invoke('settings:update', { onboardingDone: true })
    uiDispatch({ type: 'openSheet', sheet: null })
    if (withSample) {
      const SAMPLE =
        'Hey! Before EOD Friday can you pull the Q2 vendor spend from Snowflake and reconcile it ' +
        'against the AP ledger? Send the summary deck to Priya when done. Also, if you find some ' +
        'spare time this week, the team wiki could use a cleanup.'
      void api
        .invoke('tasks:create', { sourceText: SAMPLE, sourceKind: 'paste' })
        .then((t) => uiDispatch({ type: 'focusTask', id: t.id }))
    }
  }

  // First meaningful render → ui:ready → main reveals the window. Fonts + a painted frame
  // (double RAF) are part of "ready": the user must never watch the app assemble itself.
  const readySentRef = useRef(false)
  useEffect(() => {
    if (!tasksState.hydrated || readySentRef.current) return
    readySentRef.current = true
    void document.fonts.ready.then(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => void api.invoke('ui:ready', undefined).catch(() => undefined))
      )
    })
  }, [tasksState.hydrated, api])

  const [bannerDismissed, setBannerDismissed] = useState(false)
  const reachable = tasksState.ollama?.reachable ?? true
  useEffect(() => setBannerDismissed(false), [reachable])

  const [moveMode, setMoveMode] = useState(false)

  const tasksRef = useRef<Task[]>(tasksState.tasks)
  tasksRef.current = tasksState.tasks
  const uiRef = useRef(ui)
  uiRef.current = ui

  const actions = useTaskActions(api, tasksRef, uiDispatch)

  const moveModeRef = useRef(moveMode)
  moveModeRef.current = moveMode
  useGlobalKeys({ api, uiRef, uiDispatch, moveModeRef, setMoveMode })

  // ── nav:focusTask / fresh capture: make sure the target's view is showing.
  // One-shot per focus id — enrichment re-routing a task later must never yank the view
  // out from under the user (tasks stays in deps only so a not-yet-arrived card can land).
  // TaskList clears focusTaskId once it has scrolled+focused, so a repeat notification
  // for the same task navigates again.
  const handledFocusRef = useRef<string | null>(null)
  useEffect(() => {
    const id = ui.focusTaskId
    if (!id) {
      handledFocusRef.current = null
      return
    }
    if (handledFocusRef.current === id) return
    const t = tasksState.tasks.find((x) => x.id === id)
    if (!t) return
    handledFocusRef.current = id
    const v = viewForTask(t, new Date())
    if (v !== ui.view) {
      const wasExpanded = ui.expandedTaskId === id
      uiDispatch({ type: 'setView', view: v })
      if (wasExpanded) uiDispatch({ type: 'expandTask', id })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.focusTaskId, tasksState.tasks])

  // ── focus restoration: sheets return focus to their invoker. The invoker is tracked via
  // focusin (sheets autofocus themselves on mount, so sampling activeElement at open time
  // would capture the sheet's own element and Esc would drop focus to <body>). ─────────────
  const sheetInvokerRef = useRef<HTMLElement | null>(null)
  const anySheetOpen = ui.activeSheet !== null || ui.editorTaskId !== null
  useEffect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && !el.closest('.sheet, .sheet-scrim, .briefing')) sheetInvokerRef.current = el
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])
  useEffect(() => {
    if (!anySheetOpen && sheetInvokerRef.current) {
      if (sheetInvokerRef.current.isConnected) sheetInvokerRef.current.focus()
      sheetInvokerRef.current = null
    }
  }, [anySheetOpen])

  // ── derived view data ────────────────────────────────────────────────────────
  const counts = selectCounts(tasksState.tasks, now)
  const loopsCount = selectOpenLoopsCount(tasksState.tasks)
  const stalledIds = selectStalledIds(tasksState.tasks, now)

  const searchActive = ui.searchOpen && ui.searchQuery.trim().length > 0
  const snippetsView = ui.view === 'snippets'
  const taskView: TaskViewId = ui.view === 'snippets' ? 'today' : ui.view
  let vm: ViewModel = selectViewModel(tasksState.tasks, taskView, now)
  let filtered = false
  if (searchActive) {
    const results = searchTasks(tasksState.tasks, ui.searchQuery)
    vm = {
      view: taskView,
      groups: results.length ? [{ key: 'search', label: '', tasks: results }] : [],
      emptyText: 'Nothing matches.'
    }
    filtered = true
  }
  if (ui.legendFilter) {
    vm = filterViewModel(
      vm,
      legendPredicate(ui.legendFilter, { now, stalledIds, enrichment: tasksState.enrichment })
    )
    filtered = true
  }
  if (ui.loopsBatchMode) {
    vm = filterViewModel(vm, hasOpenLoops)
    filtered = true
  }

  const nextHard = selectNextHardToday(tasksState.tasks, now)
  const ticker: ShadeTicker = {
    todayCount: counts.today,
    loopsCount,
    nextHard: nextHard
      ? {
          taskId: nextHard.id,
          timeLabel: nextHard.deadline.dueTime ? formatTime(nextHard.deadline.dueTime) : 'today',
          title: truncate(nextHard.title, 18)
        }
      : undefined
  }

  const settings = tasksState.settings
  const paused = settings?.ollama.paused ?? false
  const assistantWorkingCount = Object.keys(tasksState.enrichment).length

  // ── chrome handlers ──────────────────────────────────────────────────────────
  const updateSettings = (patch: Partial<Settings>): void => {
    void api.invoke('settings:update', patch)
  }

  const handleMenu = (action: TitleBarMenuAction): void => {
    switch (action) {
      case 'legend':
        uiDispatch({ type: 'openSheet', sheet: 'legend' })
        break
      case 'guide':
        uiDispatch({ type: 'openSheet', sheet: 'guide' })
        break
      case 'settings':
        uiDispatch({ type: 'openSheet', sheet: 'settings' })
        break
      case 'briefing':
        void api
          .invoke('briefing:get', undefined)
          .then((b) => uiDispatch({ type: 'showBriefing', briefing: b }))
        break
      case 'pauseAssistant':
        if (settings) updateSettings({ ollama: { ...settings.ollama, paused: true } })
        break
      case 'resumeAssistant':
        if (settings) updateSettings({ ollama: { ...settings.ollama, paused: false } })
        break
      case 'moveWindow':
        setMoveMode(true)
        uiDispatch({
          type: 'pushToast',
          toast: makeToast({
            text: 'Move with arrow keys · Enter to finish',
            durationMs: 6000
          })
        })
        break
      case 'quit':
        void api.invoke('window:hide', undefined) // real quit lives in the tray menu
        break
    }
  }

  const titleBar = (
    <TitleBar
      viewTitle={ui.shaded ? 'DeskMate' : VIEW_TITLES[ui.view]}
      pinned={settings?.alwaysOnTop ?? false}
      shaded={ui.shaded}
      assistantWorkingCount={assistantWorkingCount}
      assistantPaused={paused}
      ticker={ui.shaded ? ticker : null}
      onCapture={() => uiDispatch({ type: 'setCaptureOpen', open: true })}
      onTogglePin={() => void api.invoke('window:pin', { onTop: !(settings?.alwaysOnTop ?? false) })}
      onToggleShade={() => void api.invoke('window:shade', { on: !ui.shaded })}
      onMinimize={() => void api.invoke('window:minimize', undefined)}
      onHide={() => void api.invoke('window:hide', undefined)}
      onMenu={handleMenu}
    />
  )

  // Shaded: header-only ticker strip (window is 48px tall).
  if (ui.shaded) return <div className="app-shell">{titleBar}</div>

  const editorTask = ui.editorTaskId
    ? tasksState.tasks.find((t) => t.id === ui.editorTaskId)
    : undefined
  const focusCount = tasksState.tasks.filter((t) => t.focus && isOpen(t)).length
  const briefingOpen = ui.activeSheet === 'briefing' && ui.briefing !== null

  return (
    <div className="app-shell">
      {titleBar}
      {tasksState.ollama && (!reachable || paused) && !bannerDismissed && (
        <OllamaBanner
          reachable={reachable}
          paused={paused}
          onRetry={() =>
            void api
              .invoke('ollama:retry', undefined)
              .then((s) => tasksDispatch({ type: 'ollamaStatus', status: s }))
          }
          onResume={() => handleMenu('resumeAssistant')}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      {ui.activeSheet === 'welcome' ? (
        <div className="app-scroll">
          <WelcomeTour
            captureHotkey={settings?.hotkeyCapture ?? 'Control+Shift+Space'}
            toggleHotkey={settings?.hotkeyToggle ?? 'Control+Shift+L'}
            onFinish={finishTour}
          />
        </div>
      ) : briefingOpen && ui.briefing ? (
        <div className="app-scroll">
          <BriefingSheet
            briefing={ui.briefing}
            fallbackSynthesis={briefingFallback(ui.briefing)}
            synthesisPending={!ui.briefing.synthesis}
            onAck={() => {
              void api.invoke('briefing:ack', { dateKey: ui.briefing!.dateKey })
              uiDispatch({ type: 'closeBriefing' })
            }}
            onDefer={() => {
              void api.invoke('briefing:defer', { dateKey: ui.briefing!.dateKey })
              uiDispatch({ type: 'closeBriefing' })
            }}
            onMore={(view) => {
              void api.invoke('briefing:ack', { dateKey: ui.briefing!.dateKey })
              uiDispatch({ type: 'closeBriefing' })
              uiDispatch({ type: 'setView', view })
            }}
            onFocusTask={(taskId) => {
              uiDispatch({ type: 'closeBriefing' })
              uiDispatch({ type: 'focusTask', id: taskId, expand: true })
            }}
            onTaskAction={(taskId, action) => {
              if (action === 'moveToToday') {
                void api.invoke('tasks:update', {
                  id: taskId,
                  patch: { deadline: { dueDate: localDateKey(now) }, pinned: true }
                })
              } else if (action === 'reschedule') {
                uiDispatch({ type: 'closeBriefing' })
                uiDispatch({ type: 'openEditor', id: taskId })
              } else if (action === 'letGo') {
                void api.invoke('tasks:delete', { id: taskId })
              } else {
                void api.invoke('tasks:update', { id: taskId, patch: {} }) // 'Keep' — refresh activity
              }
            }}
            onAnswerQuestion={(taskId, questionId, answer) =>
              actions.onAnswerQuestion(taskId, questionId, answer)
            }
            onDismissQuestion={(taskId, questionId) =>
              actions.onDismissQuestion(taskId, questionId)
            }
          />
        </div>
      ) : (
        <>
          <ViewTabs
            view={ui.view}
            counts={counts}
            loopsCount={loopsCount}
            loopsActive={ui.loopsBatchMode}
            searchOpen={ui.searchOpen}
            searchQuery={ui.searchQuery}
            onSelectView={(view) => uiDispatch({ type: 'setView', view })}
            onToggleLoops={() => uiDispatch({ type: 'setLoopsBatchMode', on: !ui.loopsBatchMode })}
            onSearchOpen={() => uiDispatch({ type: 'setSearchOpen', open: true })}
            onSearchChange={(query) => uiDispatch({ type: 'setSearchQuery', query })}
            onSearchClose={() => uiDispatch({ type: 'setSearchOpen', open: false })}
          />
          {ui.legendFilter && (
            <div className="filterbar" role="status">
              <span>
                Showing <strong>{FILTER_LABELS[ui.legendFilter]}</strong> only
              </span>
              <button
                type="button"
                className="filterbar__clear"
                onClick={() => uiDispatch({ type: 'setLegendFilter', filter: null })}
              >
                Show everything
              </button>
            </div>
          )}
          <CaptureBar
            open={ui.captureOpen}
            onSubmit={(req) => {
              void api
                .invoke('tasks:create', {
                  sourceText: req.sourceText,
                  sourceKind: req.sourceKind,
                  hints: req.hints
                })
                .then((t) => uiDispatch({ type: 'focusTask', id: t.id }))
              if (!req.keepOpen) uiDispatch({ type: 'setCaptureOpen', open: false })
            }}
            onClose={() => uiDispatch({ type: 'setCaptureOpen', open: false })}
          />
          <div className="app-scroll">
            {snippetsView ? (
              <SnippetsView />
            ) : (
              <TaskList
                viewModel={vm}
                now={now}
                expandedTaskId={ui.expandedTaskId}
                focusTaskId={ui.focusTaskId}
                onFocusHandled={() => uiDispatch({ type: 'focusTask', id: null })}
                enrichment={tasksState.enrichment}
                stalledIds={stalledIds}
                loopsBatchMode={ui.loopsBatchMode}
                legendHover={ui.legendHover}
                filtered={filtered}
                effortFooter={
                  ui.view === 'today' && !filtered && (vm.effortTodayMinutes ?? 0) > 0
                    ? focusedWorkSentence(vm.effortTodayMinutes ?? 0)
                    : undefined
                }
                actions={actions}
              />
            )}
          </div>
        </>
      )}

      {ui.activeSheet === 'guide' && (
        <SheetContainer label="How to use DeskMate" onScrimClick={() => uiDispatch({ type: 'openSheet', sheet: null })}>
          <GuideSheet
            captureHotkey={settings?.hotkeyCapture ?? 'Control+Shift+Space'}
            toggleHotkey={settings?.hotkeyToggle ?? 'Control+Shift+L'}
            onReplayTour={() => uiDispatch({ type: 'openSheet', sheet: 'welcome' })}
            onClose={() => uiDispatch({ type: 'openSheet', sheet: null })}
          />
        </SheetContainer>
      )}

      {ui.activeSheet === 'legend' && (
        <SheetContainer label="Legend" onScrimClick={() => uiDispatch({ type: 'openSheet', sheet: null })}>
          <LegendPopover
            activeFilter={ui.legendFilter}
            onHover={(filter) => uiDispatch({ type: 'legendHover', filter })}
            onApplyFilter={(filter) => {
              uiDispatch({ type: 'setLegendFilter', filter })
              uiDispatch({ type: 'openSheet', sheet: null })
            }}
            onClose={() => uiDispatch({ type: 'openSheet', sheet: null })}
          />
        </SheetContainer>
      )}

      {ui.activeSheet === 'settings' && settings && tasksState.ollama && (
        <SheetContainer label="Settings" onScrimClick={() => uiDispatch({ type: 'openSheet', sheet: null })}>
            <SettingsSheet
              settings={settings}
              ollama={tasksState.ollama}
              version={version}
              onUpdate={updateSettings}
              onRetryOllama={() =>
                void api
                  .invoke('ollama:retry', undefined)
                  .then((s) => tasksDispatch({ type: 'ollamaStatus', status: s }))
              }
              onOpenDataFolder={() => void api.invoke('data:openFolder', undefined)}
              onExportAll={() =>
                void api.invoke('data:exportAll', undefined).then((r) => {
                  if ('path' in r) {
                    uiDispatch({
                      type: 'pushToast',
                      toast: makeToast({ text: `Exported to ${r.path}` })
                    })
                  }
                })
              }
              onClose={() => uiDispatch({ type: 'openSheet', sheet: null })}
            />
        </SheetContainer>
      )}

      {editorTask && (
        <SheetContainer label="Edit task" onScrimClick={() => uiDispatch({ type: 'openEditor', id: null })}>
          <TaskEditor
            task={editorTask}
            focusCount={focusCount}
            onSave={(patch: TaskPatch) => {
              void api.invoke('tasks:update', { id: editorTask.id, patch })
              uiDispatch({ type: 'openEditor', id: null })
            }}
            onLetGo={(id) => {
              void api.invoke('tasks:delete', { id })
              uiDispatch({ type: 'openEditor', id: null })
            }}
            onClose={() => uiDispatch({ type: 'openEditor', id: null })}
          />
        </SheetContainer>
      )}

      <Toasts
        toasts={ui.toasts}
        onAction={(id) => {
          ui.toasts.find((t) => t.id === id)?.onAction?.()
          uiDispatch({ type: 'dismissToast', id })
        }}
        onDismiss={(id) => uiDispatch({ type: 'dismissToast', id })}
      />
    </div>
  )
}
