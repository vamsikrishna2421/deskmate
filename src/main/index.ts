/** Composition root: single-instance lock, lifecycle, repos, LLM stack, windows, tray,
 *  shortcuts, scheduler, IPC. 'window-all-closed' never quits — DeskMate lives in the tray. */
import { app, dialog, nativeTheme, powerMonitor, session } from 'electron'
import { join } from 'node:path'
import { localDateKey } from '@shared/dates/dayMath'
import type { Briefing } from '@shared/types/enrichment'
import type { OllamaStatus } from '@shared/types/appState'
import { TasksRepo } from './store/tasksRepo'
import { AppStateRepo } from './store/appStateRepo'
import { SnippetsRepo } from './store/snippetsRepo'
import { fallbackSynthesis, renderBriefingDigest } from './briefing'
import { Scheduler } from './scheduler'
import { OllamaClient } from './llm/ollamaClient'
import { RequestQueue } from './llm/requestQueue'
import { EnrichmentPipeline } from './enrichment/pipeline'
import { initPush, push } from './ipc/push'
import { registerIpc } from './ipc/register'
import { MainWindowManager } from './windows/mainWindow'
import { CaptureWindowManager } from './windows/captureWindow'
import { BubbleWindowManager } from './windows/bubbleWindow'
import { TrayManager } from './tray'
import type { TrayState } from './tray'
import { ShortcutManager } from './shortcuts'
import { syncAutoLaunch } from './autoLaunch'
import { Notifier } from './notifications'
import { Updater } from './updater'

const E2E = process.env['SILL_E2E'] === '1'
const HIDDEN_FLAG = process.argv.includes('--hidden')
// Isolation (ARCHITECTURE.md §7 + live E2E): --user-data-dir must take effect before
// requestSingleInstanceLock(), whose lock file lives inside userData.
const USER_DATA_DIR_ARG = process.argv.find((a) => a.startsWith('--user-data-dir='))
if (USER_DATA_DIR_ARG) {
  app.setPath('userData', USER_DATA_DIR_ARG.slice('--user-data-dir='.length))
}
/** Dev-server responses only; packaged file:// pages carry their CSP as meta tags. */
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self' ws:"

let quitting = false
let flushed = false
let tasksRepo: TasksRepo | undefined
let appStateRepo: AppStateRepo | undefined
let snippetsRepo: SnippetsRepo | undefined

function e2eLog(evt: string, extra: Record<string, unknown> = {}): void {
  if (E2E) process.stdout.write(`${JSON.stringify({ evt, ...extra })}\n`)
}

function flushRepos(): Promise<unknown> {
  return Promise.allSettled([
    tasksRepo?.flush() ?? Promise.resolve(),
    appStateRepo?.flush() ?? Promise.resolve(),
    snippetsRepo?.flush() ?? Promise.resolve()
  ])
}

function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('http')) {
      callback({})
      return
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] } })
  })
}

app.setAppUserModelId('com.vamsy.deskmate')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  let mainWindowMgr: MainWindowManager | undefined

  app.on('second-instance', () => mainWindowMgr?.show())
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  })
  app.on('before-quit', (event) => {
    quitting = true
    if (flushed || !tasksRepo) return
    event.preventDefault()
    // Bounds first: the close-time persist lands in a debounce that would otherwise never fire.
    mainWindowMgr?.persistBoundsNow()
    void flushRepos().then(() => {
      flushed = true
      app.quit()
    })
  })
  // Windows shutdown/logoff never emits 'before-quit' — this is the only flush path there.
  app.on('session-end' as 'before-quit', () => {
    quitting = true
    mainWindowMgr?.persistBoundsNow()
    void flushRepos().then(() => app.exit(0))
  })
  process.on('SIGTERM', () => {
    quitting = true
    void flushRepos().then(() => app.exit(0))
  })

  void app
    .whenReady()
    .then(async () => {
    hardenSession()

    const dataDir = join(app.getPath('userData'), 'data')
    const [tRepo, aRepo, sRepo] = await Promise.all([
      TasksRepo.load(dataDir),
      AppStateRepo.load(dataDir),
      SnippetsRepo.load(dataDir)
    ])
    tasksRepo = tRepo
    appStateRepo = aRepo
    snippetsRepo = sRepo
    e2eLog('store-loaded', { tasks: tRepo.list().length })

    const settings = aRepo.get()
    nativeTheme.themeSource = settings.theme

    const client = new OllamaClient(() => aRepo.get().ollama)
    const queue = new RequestQueue()
    const pipeline = new EnrichmentPipeline({
      tasksRepo: tRepo,
      appStateRepo: aRepo,
      client,
      queue,
      pushEnrichment: (p) => push('enrichment:status', p)
    })
    pipeline.setPaused(settings.ollama.paused)
    void client.health() // launch-time warm-up ping (lazy health: start / idle→active / retry)
    pipeline.warmUp()
    // Tasks persisted mid-enrichment (app quit while 'pending'/'running') get their jobs back.
    pipeline.recoverInterrupted()

    const windowMgr = new MainWindowManager({ appStateRepo: aRepo, isQuitting: () => quitting })
    mainWindowMgr = windowMgr
    const captureMgr = new CaptureWindowManager(() => aRepo.get().privateToScreenShare)
    const bubbleMgr = new BubbleWindowManager(aRepo)
    initPush(() => ({ main: windowMgr.get(), capture: captureMgr.get() }))

    const notifier = new Notifier({
      onActivate: (taskId) => {
        windowMgr.show()
        if (taskId) push('nav:focusTask', { taskId })
      }
    })

    const presentBriefing = (briefing: Briefing): void => {
      push('briefing:show', briefing)
      pipeline.requestBriefingSynthesis(renderBriefingDigest(briefing), (text) => {
        push('briefing:synthesis', { dateKey: briefing.dateKey, text: text ?? fallbackSynthesis(briefing) })
      })
    }

    const scheduler = new Scheduler({
      tasksRepo: tRepo,
      appStateRepo: aRepo,
      onBriefing: presentBriefing,
      notify: (n) => notifier.notify(n),
      isWindowActive: () => windowMgr.isActive()
    })

    const shortcuts = new ShortcutManager({
      onCapture: () => captureMgr.show(),
      onToggleWindow: () => windowMgr.toggle(),
      onHotkeyFailed: (payload) => push('settings:hotkeyFailed', payload)
    })

    const updater = new Updater({
      onReadyChange: () => updateTray(),
      notify: (n) => notifier.notify(n)
    })

    const tray = new TrayManager({
      onToggleWindow: () => windowMgr.toggle(),
      onOpen: () => windowMgr.show(),
      onQuickCapture: () => captureMgr.show(),
      onCheckUpdates: () => updater.check(true),
      onInstallUpdate: () => updater.quitAndInstall(),
      onBriefing: () => {
        windowMgr.show()
        presentBriefing(scheduler.buildNow())
      },
      onPinChange: (onTop) => {
        windowMgr.setPinned(onTop)
        aRepo.update({ alwaysOnTop: onTop })
      },
      onLaunchChange: (enabled) => {
        aRepo.update({ launchAtLogin: enabled })
        syncAutoLaunch(enabled)
      },
      onPauseChange: (paused) => {
        aRepo.update({ ollama: { ...aRepo.get().ollama, paused } })
        pipeline.setPaused(paused)
      },
      onPrivacyChange: (on) => {
        aRepo.update({ privateToScreenShare: on })
        windowMgr.setContentProtection(on)
        captureMgr.setContentProtection(on)
        bubbleMgr.setContentProtection(on)
      },
      onQuit: () => app.quit()
    })

    const dueTodayCount = (): number => {
      const todayKey = localDateKey(new Date())
      return tRepo.list().filter(
        (t) =>
          t.status !== 'done' &&
          t.status !== 'archived' &&
          t.deadline.kind !== 'none' &&
          t.deadline.dueDate !== undefined &&
          t.deadline.dueDate <= todayKey
      ).length
    }
    const trayState = (): TrayState => {
      const s = aRepo.get()
      return {
        dueTodayCount: dueTodayCount(),
        pinned: s.alwaysOnTop,
        launchAtLogin: s.launchAtLogin,
        paused: s.ollama.paused,
        privateToScreenShare: s.privateToScreenShare,
        companionVisible: windowMgr.isVisible(),
        updateReady: updater.readyVersion()
      }
    }
    // Tray menus are native — rebuild only when the state actually changed, not on every
    // transient enrichment flip.
    let lastTrayJson = ''
    const updateTray = (): void => {
      const s = trayState()
      const j = JSON.stringify(s)
      if (j === lastTrayJson) return
      lastTrayJson = j
      tray.update(s)
    }

    const showOnReady = !E2E && !HIDDEN_FLAG && !settings.startHidden
    const mainWin = windowMgr.create(showOnReady)
    e2eLog('window-created', { id: 'main' })
    // Launch choreography: the companion reveals on its renderer's ui:ready; the bubble reveals
    // only when ITS content is ready (then stays forever); the capture popup spins up after
    // launch so three renderers never race a cold start.
    if (!E2E) bubbleMgr.sync()
    if (E2E) captureMgr.create()
    else setTimeout(() => {
      if (!captureMgr.get()) captureMgr.create()
    }, 2500)

    mainWin.on('focus', () => scheduler.onAppEvent('focus'))
    mainWin.on('show', updateTray)
    mainWin.on('hide', updateTray)

    tRepo.onChange((change) => {
      push('tasks:changed', change)
      updateTray()
    })
    sRepo.onChange((list) => push('snippets:changed', list))
    aRepo.onChange((state) => {
      push('settings:changed', state)
      updateTray()
    })

    const ollamaStatus = (): OllamaStatus => ({
      ...client.status(),
      queued: queue.size(),
      paused: aRepo.get().ollama.paused
    })
    client.onStatusChange(() => push('ollama:statusChanged', ollamaStatus()))
    queue.onChange(() => push('ollama:statusChanged', ollamaStatus()))

    registerIpc({
      tasksRepo: tRepo,
      appStateRepo: aRepo,
      snippetsRepo: sRepo,
      client,
      queue,
      pipeline,
      scheduler,
      mainWindow: windowMgr,
      captureWindow: captureMgr,
      bubbleWindow: bubbleMgr,
      shortcuts,
      dataDir
    })

    shortcuts.apply({ capture: settings.hotkeyCapture, toggle: settings.hotkeyToggle })
    syncAutoLaunch(settings.launchAtLogin)
    tray.create(trayState())

    scheduler.start()
    scheduler.onAppEvent('ready')
    if (!E2E) updater.start()
    powerMonitor.on('resume', () => scheduler.onAppEvent('resume'))
    powerMonitor.on('unlock-screen', () => scheduler.onAppEvent('unlock'))

    app.on('will-quit', () => {
      shortcuts.unregisterAll()
      scheduler.stop()
      updater.stop()
      tray.destroy()
      bubbleMgr.destroy()
    })

    e2eLog('ready')
    })
    .catch((err: unknown) => {
      // A failed bootstrap must never leave an invisible zombie holding the single-instance lock.
      console.error('[main] bootstrap failed', err)
      if (!E2E) {
        dialog.showErrorBox(
          'DeskMate could not start',
          `Something went wrong while loading your data.\n\n${err instanceof Error ? err.message : String(err)}`
        )
      }
      app.exit(1)
    })
}
