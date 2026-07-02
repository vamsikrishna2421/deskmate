/** Single source of truth for the typed IPC contract (ARCHITECTURE.md §3 + DESIGN.md §16 deltas).
 *  Pure — no Electron/Node imports. */

import type { Task, TaskPatch, TaskStatus } from './task'
import type { AppState, OllamaStatus, Settings } from './appState'
import type { Briefing, CaptureHints } from './enrichment'
import type { Snippet, SnippetKind, SnippetPatch } from './snippet'

/** renderer → main via ipcRenderer.invoke / ipcMain.handle */
export interface IpcSchema {
  'tasks:list': { req: void; res: Task[] }
  'tasks:create': {
    req: { sourceText: string; sourceKind: 'paste' | 'typed'; hints?: CaptureHints }
    res: Task
  }
  'tasks:update': { req: { id: string; patch: TaskPatch }; res: Task }
  'tasks:setStatus': { req: { id: string; status: TaskStatus }; res: Task }
  'tasks:toggleSubtask': { req: { taskId: string; subtaskId: string }; res: Task }
  'tasks:answerQuestion': { req: { taskId: string; questionId: string; answer: string }; res: Task }
  'tasks:dismissQuestion': { req: { taskId: string; questionId: string }; res: Task }
  'tasks:reenrich': { req: { id: string }; res: void }
  'tasks:delete': { req: { id: string }; res: void }
  'briefing:get': { req: void; res: Briefing }
  'briefing:ack': { req: { dateKey: string }; res: void }
  'briefing:defer': { req: { dateKey: string }; res: void }
  'ollama:status': { req: void; res: OllamaStatus }
  'ollama:retry': { req: void; res: OllamaStatus }
  'settings:get': { req: void; res: AppState }
  /** coachMarksSeen / onboardingDone ride along so one-time teaching persists across launches. */
  'settings:update': {
    req: Partial<Settings> & { coachMarksSeen?: string[]; onboardingDone?: boolean }
    res: AppState
  }
  'window:pin': { req: { onTop: boolean }; res: void }
  'window:shade': { req: { on: boolean }; res: void }
  'window:minimize': { req: void; res: void }
  'window:hide': { req: void; res: void }
  'window:moveBy': { req: { dx: number; dy: number }; res: void }
  'capture:submit': {
    req: { text: string; sourceKind: 'paste' | 'typed'; hints?: CaptureHints; keepOpen?: boolean }
    res: { taskId: string }
  }
  'capture:dismiss': { req: void; res: void }
  /** Text exceeded ~4 lines — main grows the popup 180→300 (DESIGN §3). One-way per summon. */
  'capture:resize': { req: { grown: boolean }; res: void }
  /** Bubble tap → toggle the companion window. */
  'bubble:click': { req: void; res: void }
  /** Manual drag: absolute top-left screen position; main clamps to a display and persists. */
  'bubble:moveTo': { req: { x: number; y: number; persist?: boolean }; res: void }
  'snippets:list': { req: void; res: Snippet[] }
  'snippets:create': { req: { kind: SnippetKind; label: string; value: string }; res: Snippet }
  'snippets:update': { req: { id: string; patch: SnippetPatch }; res: Snippet }
  'snippets:delete': { req: { id: string }; res: void }
  /** Copies via main (decrypts secrets there). Secrets auto-clear from the clipboard. */
  'snippets:copy': { req: { id: string }; res: { clearAfterSeconds: number | null } }
  /** kind 'url' only — validated http(s), opened in the default browser. */
  'snippets:open': { req: { id: string }; res: void }
  'data:openFolder': { req: void; res: void }
  'data:exportAll': { req: void; res: { path: string } | { canceled: true } }
  'app:getVersion': { req: void; res: string }
  /** Renderer signals "first meaningful render done" (hydrated + fonts + painted) —
   *  main reveals the window only then, so the app appears whole, never piece by piece. */
  'ui:ready': { req: void; res: void }
}

/** main → renderer via webContents.send (broadcast to both windows) */
export interface PushSchema {
  /** Delta, not full list — reducer preserves identity of untouched tasks. */
  'tasks:changed': { upserted: Task[]; deletedIds: string[] }
  'enrichment:status': {
    taskId: string
    status: 'queued' | 'running' | 'done' | 'failed' | 'skipped'
    error?: string
  }
  'briefing:show': Briefing
  'briefing:synthesis': { dateKey: string; text: string }
  'ollama:statusChanged': OllamaStatus
  'settings:changed': AppState
  'settings:hotkeyFailed': { hotkey: string; fallback?: string }
  'nav:focusTask': { taskId: string }
  /** Ctrl+Enter multi-capture inline confirmation in the capture window. */
  'capture:submitted': { taskId: string }
  /** Companion shade state changed from main (double-click header / hotkey). */
  'window:shaded': { on: boolean }
  /** Full snippet list (small) after any vault mutation; secret values are always ''. */
  'snippets:changed': Snippet[]
  /** Tray navigation: switch the companion to a view / open a sheet. */
  'nav:view': { view: 'today' | 'week' | 'later' | 'done' | 'snippets' }
  'nav:sheet': { sheet: 'guide' | 'legend' | 'welcome' }
  /** Hotkey summon read the clipboard (that moment only) — prefill the capture field. */
  'capture:prefill': { text: string }
}

export type IpcChannel = keyof IpcSchema
export type PushChannel = keyof PushSchema

/** The frozen bridge exposed by preload as `window.loops`. */
export interface LoopsApi {
  invoke<C extends IpcChannel>(channel: C, req: IpcSchema[C]['req']): Promise<IpcSchema[C]['res']>
  /** Returns an unsubscribe function. */
  on<C extends PushChannel>(channel: C, cb: (payload: PushSchema[C]) => void): () => void
  platform: 'win32' | 'darwin' | 'linux'
}

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'tasks:list',
  'tasks:create',
  'tasks:update',
  'tasks:setStatus',
  'tasks:toggleSubtask',
  'tasks:answerQuestion',
  'tasks:dismissQuestion',
  'tasks:reenrich',
  'tasks:delete',
  'briefing:get',
  'briefing:ack',
  'briefing:defer',
  'ollama:status',
  'ollama:retry',
  'settings:get',
  'settings:update',
  'window:pin',
  'window:shade',
  'window:minimize',
  'window:hide',
  'window:moveBy',
  'capture:submit',
  'capture:dismiss',
  'capture:resize',
  'bubble:click',
  'bubble:moveTo',
  'snippets:list',
  'snippets:create',
  'snippets:update',
  'snippets:delete',
  'snippets:copy',
  'snippets:open',
  'data:openFolder',
  'data:exportAll',
  'app:getVersion',
  'ui:ready'
] as const

export const PUSH_CHANNELS: readonly PushChannel[] = [
  'tasks:changed',
  'enrichment:status',
  'briefing:show',
  'briefing:synthesis',
  'ollama:statusChanged',
  'settings:changed',
  'settings:hotkeyFailed',
  'nav:focusTask',
  'capture:submitted',
  'window:shaded',
  'snippets:changed',
  'nav:view',
  'nav:sheet',
  'capture:prefill'
] as const
