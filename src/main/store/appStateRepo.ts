/** App state + settings repository over app-state.json (ARCHITECTURE.md §2.5, DESIGN.md §11). */

import { join } from 'node:path'
import type { AppState, OllamaSettings } from '../../shared/types/appState'
import {
  DUE_SOON_LEAD_MINUTES_DEFAULT,
  HOTKEY_CAPTURE_DEFAULT,
  HOTKEY_TOGGLE_DEFAULT,
  OLLAMA_DEFAULT_BASE_URL,
  PREFERRED_MODELS,
  SCHEMA_VERSION
} from '../../shared/constants'
import { JsonStore } from './jsonStore'
import { backupDirFor } from './backup'
import { migrateDoc, ReadOnlyStoreError } from './migrations'

function makeDefaults(): AppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    theme: 'dark',
    launchAtLogin: false,
    startHidden: false,
    hotkeyCapture: HOTKEY_CAPTURE_DEFAULT,
    hotkeyToggle: HOTKEY_TOGGLE_DEFAULT,
    remindersEnabled: true,
    dueSoonLeadMinutes: DUE_SOON_LEAD_MINUTES_DEFAULT,
    bubbleEnabled: true,
    privateToScreenShare: true,
    captureClipboardPrefill: true,
    ollama: { baseUrl: OLLAMA_DEFAULT_BASE_URL, preferredModels: [...PREFERRED_MODELS], paused: false },
    assistantProvider: 'ollama',
    openaiApiKeyEnc: '',
    alwaysOnTop: false,
    coachMarksSeen: [],
    onboardingDone: false
  }
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return (
      host === 'localhost' || host === '::1' || host === '[::1]' || host === '127.0.0.1' || host.startsWith('127.')
    )
  } catch {
    return false
  }
}

function clampLeadMinutes(n: number): number {
  if (!Number.isFinite(n)) return DUE_SOON_LEAD_MINUTES_DEFAULT
  return Math.min(Math.max(Math.round(n), 0), 720)
}

function bool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt
}

function nonEmptyString(v: unknown, dflt: string): string {
  return typeof v === 'string' && v.length > 0 ? v : dflt
}

/** Merge a loaded (possibly partial/foreign) document over defaults with boundary validation. */
function mergeLoaded(defaults: AppState, doc: Record<string, unknown>): AppState {
  const partial = doc as Partial<AppState>
  const rawOllama =
    typeof doc.ollama === 'object' && doc.ollama !== null ? (doc.ollama as Partial<OllamaSettings>) : {}
  const ollama: OllamaSettings = {
    baseUrl: nonEmptyString(rawOllama.baseUrl, defaults.ollama.baseUrl),
    preferredModels:
      Array.isArray(rawOllama.preferredModels) && rawOllama.preferredModels.every((m) => typeof m === 'string')
        ? rawOllama.preferredModels
        : [...defaults.ollama.preferredModels],
    selectedModel: typeof rawOllama.selectedModel === 'string' ? rawOllama.selectedModel : undefined,
    paused: bool(rawOllama.paused, defaults.ollama.paused)
  }
  if (!isLoopbackUrl(ollama.baseUrl)) ollama.baseUrl = defaults.ollama.baseUrl

  const state: AppState = { ...defaults, ...partial, ollama, schemaVersion: SCHEMA_VERSION }
  // Dark is the default; only an INTENTIONAL light/dark choice survives. A stored 'system'
  // (the old default nobody chose) flips to dark.
  if (state.theme !== 'light' && state.theme !== 'dark') state.theme = 'dark'
  state.launchAtLogin = bool(partial.launchAtLogin, defaults.launchAtLogin)
  state.startHidden = bool(partial.startHidden, defaults.startHidden)
  state.remindersEnabled = bool(partial.remindersEnabled, defaults.remindersEnabled)
  state.bubbleEnabled = bool(partial.bubbleEnabled, defaults.bubbleEnabled)
  state.privateToScreenShare = bool(partial.privateToScreenShare, defaults.privateToScreenShare)
  state.captureClipboardPrefill = bool(partial.captureClipboardPrefill, defaults.captureClipboardPrefill)
  state.alwaysOnTop = bool(partial.alwaysOnTop, defaults.alwaysOnTop)
  state.hotkeyCapture = nonEmptyString(partial.hotkeyCapture, defaults.hotkeyCapture)
  state.hotkeyToggle = nonEmptyString(partial.hotkeyToggle, defaults.hotkeyToggle)
  state.dueSoonLeadMinutes = clampLeadMinutes(
    typeof partial.dueSoonLeadMinutes === 'number' ? partial.dueSoonLeadMinutes : defaults.dueSoonLeadMinutes
  )
  state.coachMarksSeen = Array.isArray(partial.coachMarksSeen)
    ? partial.coachMarksSeen.filter((m): m is string => typeof m === 'string')
    : []
  state.onboardingDone = bool(partial.onboardingDone, defaults.onboardingDone)
  state.assistantProvider = partial.assistantProvider === 'openai' ? 'openai' : 'ollama'
  state.openaiApiKeyEnc = typeof partial.openaiApiKeyEnc === 'string' ? partial.openaiApiKeyEnc : ''
  return state
}

export class AppStateRepo {
  private readonly store: JsonStore<AppState>
  private state: AppState
  private readonly listeners = new Set<(s: AppState) => void>()
  private readonly readOnlyMode: boolean

  private constructor(store: JsonStore<AppState>, state: AppState, readOnly: boolean) {
    this.store = store
    this.state = state
    this.readOnlyMode = readOnly
  }

  static async load(dataDir: string): Promise<AppStateRepo> {
    const filePath = join(dataDir, 'app-state.json')
    const backupDir = backupDirFor(dataDir)
    const defaults = makeDefaults()
    const store = new JsonStore<AppState>(filePath, defaults, { backupDir })
    const loaded = await store.load()
    let doc: Record<string, unknown> =
      typeof loaded === 'object' && loaded !== null ? (loaded as unknown as Record<string, unknown>) : {}
    let readOnly = false
    let migrated = false
    try {
      const result = await migrateDoc(doc, { filePath, backupDir })
      doc = result.doc
      migrated = result.migrated
    } catch (err) {
      if (err instanceof ReadOnlyStoreError) readOnly = true
      else throw err
    }
    const state = mergeLoaded(defaults, doc)
    const repo = new AppStateRepo(store, state, readOnly)
    if (migrated && !readOnly) store.save(state)
    return repo
  }

  /** True when the on-disk schema is newer than this build — changes stay in-memory only. */
  get readOnly(): boolean {
    return this.readOnlyMode
  }

  get(): AppState {
    return this.state
  }

  update(patch: Partial<AppState>): AppState {
    if (patch.ollama !== undefined && !isLoopbackUrl(patch.ollama.baseUrl)) {
      throw new Error('Ollama base URL must point at loopback (localhost / 127.0.0.1)')
    }
    const next: AppState = {
      ...this.state,
      ...patch,
      ollama: patch.ollama ? { ...this.state.ollama, ...patch.ollama } : this.state.ollama,
      schemaVersion: SCHEMA_VERSION
    }
    if (patch.dueSoonLeadMinutes !== undefined) {
      next.dueSoonLeadMinutes = clampLeadMinutes(patch.dueSoonLeadMinutes)
    }
    this.state = next
    if (!this.readOnlyMode) this.store.save(next)
    for (const cb of this.listeners) cb(next)
    return next
  }

  onChange(cb: (s: AppState) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  flush(): Promise<void> {
    return this.store.flush()
  }
}
