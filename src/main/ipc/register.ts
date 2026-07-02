/** Binds every IpcSchema channel via ipcMain.handle. Every payload is validated and clamped at
 *  this boundary, and every request's sender frame is verified against our two known pages. */
import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcChannel, IpcSchema } from '@shared/types/ipc'
import type { Deadline, Effort, Priority, Subtask, TaskPatch, TaskStatus } from '@shared/types/task'
import type { AppState, OllamaSettings, OllamaStatus, Settings } from '@shared/types/appState'
import type { CaptureHints } from '@shared/types/enrichment'
import { CAPTURE_WINDOW, SOURCE_TEXT_MAX, TAGS_MAX } from '@shared/constants'
import { localDateKey } from '@shared/dates/dayMath'
import type { TasksRepo } from '../store/tasksRepo'
import type { AppStateRepo } from '../store/appStateRepo'
import type { SnippetsRepo } from '../store/snippetsRepo'
import type { SnippetKind, SnippetPatch } from '@shared/types/snippet'
import type { OllamaClient } from '../llm/ollamaClient'
import type { RequestQueue } from '../llm/requestQueue'
import type { EnrichmentPipeline } from '../enrichment/pipeline'
import type { Scheduler } from '../scheduler'
import type { MainWindowManager } from '../windows/mainWindow'
import type { CaptureWindowManager } from '../windows/captureWindow'
import type { BubbleWindowManager } from '../windows/bubbleWindow'
import type { ShortcutManager } from '../shortcuts'
import { syncAutoLaunch } from '../autoLaunch'
import { push } from './push'

export interface IpcDeps {
  tasksRepo: TasksRepo
  appStateRepo: AppStateRepo
  snippetsRepo: SnippetsRepo
  client: OllamaClient
  queue: RequestQueue
  pipeline: EnrichmentPipeline
  scheduler: Scheduler
  mainWindow: MainWindowManager
  captureWindow: CaptureWindowManager
  bubbleWindow: BubbleWindowManager
  shortcuts: ShortcutManager
  dataDir: string
}

// ── Validation primitives ─────────────────────────────────────────────────────

function fail(msg: string): never {
  throw new Error(`deskmate ipc: ${msg}`)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function obj(v: unknown, label: string): Record<string, unknown> {
  if (!isObj(v)) fail(`${label} must be an object`)
  return v
}

function str(v: unknown, max: number, label: string): string {
  if (typeof v !== 'string') fail(`${label} must be a string`)
  const t = v.trim()
  if (!t) fail(`${label} must not be empty`)
  return t.length > max ? t.slice(0, max) : t
}

function bool(v: unknown, label: string): boolean {
  if (typeof v !== 'boolean') fail(`${label} must be a boolean`)
  return v
}

function clampInt(v: unknown, min: number, max: number, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${label} must be a finite number`)
  return Math.max(min, Math.min(max, Math.round(v)))
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(`${label} must be one of ${allowed.join('|')}`)
  }
  return v as T
}

function strArray(v: unknown, maxItems: number, maxLen: number, label: string): string[] {
  if (!Array.isArray(v)) fail(`${label} must be an array`)
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen) : s))
}

function id(v: unknown, label = 'id'): string {
  return str(v, 128, label)
}

function dateKey(v: unknown, label = 'dateKey'): string {
  const k = str(v, 10, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) fail(`${label} must be YYYY-MM-DD`)
  return k
}

const ACCEL_MODIFIERS = new Set([
  'CommandOrControl',
  'CmdOrCtrl',
  'Command',
  'Cmd',
  'Control',
  'Ctrl',
  'Alt',
  'AltGr',
  'Option',
  'Shift',
  'Super',
  'Meta'
])

/** A modifier-less accelerator would register a system-wide grab on a plain key. */
function accelerator(v: unknown, label: string): string {
  const s = str(v, 64, label)
  const parts = s.split('+').map((p) => p.trim())
  const mods = parts.filter((p) => ACCEL_MODIFIERS.has(p))
  const keys = parts.filter((p) => p && !ACCEL_MODIFIERS.has(p))
  if (mods.length === 0 || keys.length !== 1) {
    fail(`${label} must be modifier(s)+key, e.g. Control+Shift+Space`)
  }
  return parts.join('+')
}

// ── Payload sanitizers ────────────────────────────────────────────────────────

const STATUSES: readonly TaskStatus[] = ['inbox', 'open', 'in_progress', 'blocked', 'done', 'archived']
const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'normal', 'low', 'optional']
const EFFORTS: readonly Effort[] = ['minutes', 'hour', 'half_day', 'day', 'multi_day']

function sanitizeHints(raw: unknown): CaptureHints | undefined {
  if (raw === undefined || raw === null) return undefined
  const r = obj(raw, 'hints')
  const hints: CaptureHints = {}
  if (r.deadline !== undefined) hints.deadline = oneOf(r.deadline, ['today', 'week', 'later'] as const, 'hints.deadline')
  if (r.kind !== undefined) hints.kind = oneOf(r.kind, ['hard', 'soft'] as const, 'hints.kind')
  if (r.tags !== undefined) hints.tags = strArray(r.tags, TAGS_MAX, 40, 'hints.tags').map((t) => t.toLowerCase())
  return hints
}

function sanitizeDeadline(raw: unknown): Partial<Deadline> {
  const r = obj(raw, 'patch.deadline')
  const d: Partial<Deadline> = { source: 'user' }
  if (r.kind !== undefined) d.kind = oneOf(r.kind, ['hard', 'soft', 'none'] as const, 'deadline.kind')
  if (r.dueDate !== undefined) d.dueDate = dateKey(r.dueDate, 'deadline.dueDate')
  if (r.dueTime !== undefined) {
    const t = str(r.dueTime, 5, 'deadline.dueTime')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) fail('deadline.dueTime must be HH:mm')
    d.dueTime = t
  }
  return d
}

function sanitizeSubtasks(raw: unknown): Subtask[] {
  if (!Array.isArray(raw)) fail('patch.subtasks must be an array')
  return raw.slice(0, 50).map((s, i) => {
    const r = obj(s, `subtasks[${i}]`)
    return {
      id: id(r.id, `subtasks[${i}].id`),
      title: str(r.title, 140, `subtasks[${i}].title`),
      done: r.done === true,
      source: oneOf(r.source, ['llm', 'user'] as const, `subtasks[${i}].source`)
    }
  })
}

function sanitizePatch(raw: unknown): TaskPatch {
  const r = obj(raw, 'patch')
  const p: TaskPatch = {}
  if (r.title !== undefined) p.title = str(r.title, 200, 'patch.title')
  if (r.summary !== undefined) p.summary = typeof r.summary === 'string' ? r.summary.slice(0, 2000) : fail('patch.summary must be a string')
  if (r.status !== undefined) p.status = oneOf(r.status, STATUSES, 'patch.status')
  if (r.deadline !== undefined) p.deadline = sanitizeDeadline(r.deadline)
  if (r.priority !== undefined) p.priority = oneOf(r.priority, PRIORITIES, 'patch.priority')
  if (r.effort !== undefined) p.effort = oneOf(r.effort, EFFORTS, 'patch.effort')
  if (r.tags !== undefined) p.tags = strArray(r.tags, 10, 40, 'patch.tags')
  if (r.subtasks !== undefined) p.subtasks = sanitizeSubtasks(r.subtasks)
  if (r.focus !== undefined) p.focus = bool(r.focus, 'patch.focus')
  if (r.pinned !== undefined) p.pinned = bool(r.pinned, 'patch.pinned')
  return p
}

function loopbackBaseUrl(v: string): string {
  let url: URL
  try {
    url = new URL(v)
  } catch {
    fail('ollama.baseUrl is not a valid URL')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]']
  if (url.protocol !== 'http:' || !loopback.includes(url.hostname)) {
    fail('ollama.baseUrl must be a loopback http URL')
  }
  return url.origin
}

function sanitizeSettings(
  raw: unknown,
  current: AppState
): Partial<Settings> & { coachMarksSeen?: string[] } {
  const r = obj(raw, 'settings')
  const patch: Partial<Settings> & { coachMarksSeen?: string[] } = {}
  if (r.coachMarksSeen !== undefined) {
    patch.coachMarksSeen = strArray(r.coachMarksSeen, 64, 64, 'coachMarksSeen')
  }
  if (r.theme !== undefined) patch.theme = oneOf(r.theme, ['system', 'light', 'dark'] as const, 'theme')
  if (r.launchAtLogin !== undefined) patch.launchAtLogin = bool(r.launchAtLogin, 'launchAtLogin')
  if (r.startHidden !== undefined) patch.startHidden = bool(r.startHidden, 'startHidden')
  if (r.hotkeyCapture !== undefined) patch.hotkeyCapture = accelerator(r.hotkeyCapture, 'hotkeyCapture')
  if (r.hotkeyToggle !== undefined) patch.hotkeyToggle = accelerator(r.hotkeyToggle, 'hotkeyToggle')
  if (r.remindersEnabled !== undefined) patch.remindersEnabled = bool(r.remindersEnabled, 'remindersEnabled')
  if (r.bubbleEnabled !== undefined) patch.bubbleEnabled = bool(r.bubbleEnabled, 'bubbleEnabled')
  if (r.privateToScreenShare !== undefined) {
    patch.privateToScreenShare = bool(r.privateToScreenShare, 'privateToScreenShare')
  }
  if (r.dueSoonLeadMinutes !== undefined) {
    patch.dueSoonLeadMinutes = clampInt(r.dueSoonLeadMinutes, 1, 24 * 60, 'dueSoonLeadMinutes')
  }
  if (r.ollama !== undefined) {
    const o = obj(r.ollama, 'ollama')
    const merged: OllamaSettings = { ...current.ollama }
    if (o.baseUrl !== undefined) merged.baseUrl = loopbackBaseUrl(str(o.baseUrl, 200, 'ollama.baseUrl'))
    if (o.preferredModels !== undefined) merged.preferredModels = strArray(o.preferredModels, 10, 80, 'ollama.preferredModels')
    if (o.selectedModel !== undefined) {
      merged.selectedModel = o.selectedModel === null ? undefined : str(o.selectedModel, 80, 'ollama.selectedModel')
    }
    if (o.paused !== undefined) merged.paused = bool(o.paused, 'ollama.paused')
    patch.ollama = merged
  }
  return patch
}

// ── Sender-frame trust ────────────────────────────────────────────────────────

function buildSenderTrust(): (url: string) => boolean {
  // Trailing '/' enforces a path boundary — '.../renderer' must not trust '.../rendererEvil'.
  const withBoundary = (base: string): string => (base.endsWith('/') ? base : `${base}/`)
  const prodBase = withBoundary(pathToFileURL(join(__dirname, '../renderer')).href)
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const devBase = devUrl ? withBoundary(devUrl) : undefined
  return (url) => {
    if (url.startsWith(prodBase)) return true
    if (devBase && url.startsWith(devBase)) return true
    if (!app.isPackaged && url.startsWith('http://localhost:5173/')) return true
    return false
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerIpc(deps: IpcDeps): void {
  const trusted = buildSenderTrust()
  const bind = <C extends IpcChannel>(
    channel: C,
    fn: (req: unknown, event: IpcMainInvokeEvent) => Promise<IpcSchema[C]['res']> | IpcSchema[C]['res']
  ): void => {
    ipcMain.handle(channel, (event, payload: unknown) => {
      if (!trusted(event.senderFrame?.url ?? '')) fail('request from untrusted frame')
      return fn(payload, event)
    })
  }

  const now = (): Date => new Date()
  const ollamaStatus = (): OllamaStatus => ({
    ...deps.client.status(),
    queued: deps.queue.size(),
    paused: deps.appStateRepo.get().ollama.paused
  })
  const captureTask = (sourceText: string, sourceKind: 'paste' | 'typed', hints?: CaptureHints) => {
    const task = deps.tasksRepo.createFromCapture({ sourceText, sourceKind, hints }, now())
    deps.pipeline.enqueueExtraction(task)
    return task
  }

  bind('tasks:list', () => deps.tasksRepo.list())
  bind('tasks:create', (raw) => {
    const r = obj(raw, 'tasks:create')
    return captureTask(
      str(r.sourceText, SOURCE_TEXT_MAX, 'sourceText'),
      oneOf(r.sourceKind, ['paste', 'typed'] as const, 'sourceKind'),
      sanitizeHints(r.hints)
    )
  })
  bind('tasks:update', (raw) => {
    const r = obj(raw, 'tasks:update')
    return deps.tasksRepo.updateFromUser(id(r.id), sanitizePatch(r.patch), now())
  })
  bind('tasks:setStatus', (raw) => {
    const r = obj(raw, 'tasks:setStatus')
    return deps.tasksRepo.setStatus(id(r.id), oneOf(r.status, STATUSES, 'status'), now())
  })
  bind('tasks:toggleSubtask', (raw) => {
    const r = obj(raw, 'tasks:toggleSubtask')
    return deps.tasksRepo.toggleSubtask(id(r.taskId, 'taskId'), id(r.subtaskId, 'subtaskId'), now())
  })
  bind('tasks:answerQuestion', (raw) => {
    const r = obj(raw, 'tasks:answerQuestion')
    const task = deps.tasksRepo.answerQuestion(
      id(r.taskId, 'taskId'),
      id(r.questionId, 'questionId'),
      str(r.answer, 2000, 'answer'),
      now()
    )
    deps.pipeline.enqueueReenrich(task.id)
    return task
  })
  bind('tasks:dismissQuestion', (raw) => {
    const r = obj(raw, 'tasks:dismissQuestion')
    return deps.tasksRepo.dismissQuestion(id(r.taskId, 'taskId'), id(r.questionId, 'questionId'), now())
  })
  bind('tasks:reenrich', (raw) => {
    deps.pipeline.enqueueReenrich(id(obj(raw, 'tasks:reenrich').id))
  })
  bind('tasks:delete', (raw) => {
    deps.tasksRepo.delete(id(obj(raw, 'tasks:delete').id), now())
  })

  bind('briefing:get', () => deps.scheduler.buildNow())
  bind('briefing:ack', (raw) => {
    deps.scheduler.ackBriefing(dateKey(obj(raw, 'briefing:ack').dateKey))
  })
  bind('briefing:defer', (raw) => {
    deps.scheduler.deferBriefing(dateKey(obj(raw, 'briefing:defer').dateKey))
  })

  bind('ollama:status', () => ollamaStatus())
  bind('ollama:retry', async () => {
    await deps.client.health()
    deps.pipeline.retryAllFailed()
    return ollamaStatus()
  })

  bind('settings:get', () => deps.appStateRepo.get())
  bind('settings:update', (raw) => applySettingsUpdate(deps, raw))

  bind('window:pin', (raw) => {
    const onTop = bool(obj(raw, 'window:pin').onTop, 'onTop')
    deps.mainWindow.setPinned(onTop)
    deps.appStateRepo.update({ alwaysOnTop: onTop })
  })
  bind('window:shade', (raw) => {
    deps.mainWindow.setShaded(bool(obj(raw, 'window:shade').on, 'on'))
  })
  bind('window:minimize', () => {
    deps.mainWindow.get()?.minimize()
  })
  bind('window:hide', () => deps.mainWindow.hide())
  bind('window:moveBy', (raw) => {
    const r = obj(raw, 'window:moveBy')
    deps.mainWindow.moveBy(clampInt(r.dx, -4000, 4000, 'dx'), clampInt(r.dy, -4000, 4000, 'dy'))
  })

  bind('capture:submit', (raw) => {
    const r = obj(raw, 'capture:submit')
    const task = captureTask(
      str(r.text, SOURCE_TEXT_MAX, 'text'),
      oneOf(r.sourceKind, ['paste', 'typed'] as const, 'sourceKind'),
      sanitizeHints(r.hints)
    )
    push('capture:submitted', { taskId: task.id })
    if (r.keepOpen !== true) deps.captureWindow.hide()
    return { taskId: task.id }
  })
  bind('capture:dismiss', () => deps.captureWindow.hide())
  bind('capture:resize', (raw) => {
    if (bool(obj(raw, 'capture:resize').grown, 'grown')) {
      deps.captureWindow.growTo(CAPTURE_WINDOW.grownHeight)
    }
  })

  bind('bubble:click', () => deps.mainWindow.toggle())
  bind('bubble:moveTo', (raw) => {
    const r = obj(raw, 'bubble:moveTo')
    deps.bubbleWindow.moveTo(
      clampInt(r.x, -20000, 20000, 'x'),
      clampInt(r.y, -20000, 20000, 'y'),
      r.persist === true
    )
  })

  const SNIPPET_KINDS: readonly SnippetKind[] = ['command', 'url', 'note', 'secret']
  bind('snippets:list', () => deps.snippetsRepo.list())
  bind('snippets:create', (raw) => {
    const r = obj(raw, 'snippets:create')
    return deps.snippetsRepo.create(
      oneOf(r.kind, SNIPPET_KINDS, 'kind'),
      str(r.label, 80, 'label'),
      str(r.value, 8000, 'value'),
      now()
    )
  })
  bind('snippets:update', (raw) => {
    const r = obj(raw, 'snippets:update')
    const p = obj(r.patch, 'patch')
    const patch: SnippetPatch = {}
    if (p.label !== undefined) patch.label = str(p.label, 80, 'patch.label')
    if (p.value !== undefined) patch.value = str(p.value, 8000, 'patch.value')
    if (p.kind !== undefined) patch.kind = oneOf(p.kind, SNIPPET_KINDS, 'patch.kind')
    if (p.pinned !== undefined) patch.pinned = bool(p.pinned, 'patch.pinned')
    return deps.snippetsRepo.update(id(r.id), patch, now())
  })
  bind('snippets:delete', (raw) => {
    deps.snippetsRepo.delete(id(obj(raw, 'snippets:delete').id))
  })
  bind('snippets:copy', (raw) => deps.snippetsRepo.copy(id(obj(raw, 'snippets:copy').id), now()))
  bind('snippets:open', (raw) => {
    // urlOf re-validates http(s) — never openExternal on arbitrary stored text.
    void shell.openExternal(deps.snippetsRepo.urlOf(id(obj(raw, 'snippets:open').id)))
  })

  bind('data:openFolder', async () => {
    await shell.openPath(deps.dataDir)
  })
  bind('data:exportAll', () => exportAll(deps))

  bind('app:getVersion', () => app.getVersion())
}

function applySettingsUpdate(deps: IpcDeps, raw: unknown): AppState {
  const current = deps.appStateRepo.get()
  const patch = sanitizeSettings(raw, current)
  const next = deps.appStateRepo.update(patch)
  if (patch.theme !== undefined) nativeTheme.themeSource = next.theme
  if (patch.hotkeyCapture !== undefined || patch.hotkeyToggle !== undefined) {
    deps.shortcuts.apply({ capture: next.hotkeyCapture, toggle: next.hotkeyToggle })
  }
  if (patch.launchAtLogin !== undefined) syncAutoLaunch(next.launchAtLogin)
  if (patch.bubbleEnabled !== undefined) deps.bubbleWindow.sync()
  if (patch.privateToScreenShare !== undefined) {
    deps.mainWindow.setContentProtection(next.privateToScreenShare)
    deps.captureWindow.setContentProtection(next.privateToScreenShare)
    deps.bubbleWindow.setContentProtection(next.privateToScreenShare)
  }
  if (patch.ollama !== undefined && patch.ollama.paused !== current.ollama.paused) {
    deps.pipeline.setPaused(patch.ollama.paused)
  }
  return next
}

async function exportAll(deps: IpcDeps): Promise<{ path: string } | { canceled: true }> {
  const options = {
    title: 'Export DeskMate data',
    defaultPath: `deskmate-export-${localDateKey(new Date())}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const owner = deps.mainWindow.get()
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true }
  const doc = {
    app: 'DeskMate',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    tasks: deps.tasksRepo.list(),
    settings: deps.appStateRepo.get()
  }
  await fs.writeFile(result.filePath, JSON.stringify(doc, null, 2), 'utf8')
  return { path: result.filePath }
}
