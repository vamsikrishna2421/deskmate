/** App state + settings types. Pure — no Electron/Node imports. */

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OllamaSettings {
  /** Validated loopback-only. */
  baseUrl: string
  /** Preference order; first installed model wins unless selectedModel is set. */
  preferredModels: string[]
  /** Explicit user pick from Settings → Assistant; overrides preference order. */
  selectedModel?: string
  /** "Pause assistant" — capture still works, enrichment queue holds. */
  paused: boolean
}

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  launchAtLogin: boolean
  startHidden: boolean
  hotkeyCapture: string
  hotkeyToggle: string
  remindersEnabled: boolean
  dueSoonLeadMinutes: number
  /** Floating chat-head bubble over all apps: click toggles the companion. */
  bubbleEnabled: boolean
  /** Exclude every DeskMate window from screen capture (Teams/Zoom) — personal, not shareable. */
  privateToScreenShare: boolean
  ollama: OllamaSettings
}

export interface BriefingDeferral {
  dateKey: string
  count: number
}

export interface AppState extends Settings {
  schemaVersion: number
  /** 'YYYY-MM-DD' local — briefing fires once per local day. */
  lastBriefingDate?: string
  /** 'YYYY-MM-DD' local — hidden-launch "briefing ready" toast fires once per day, persisted. */
  lastBriefingToastDate?: string
  /** "Later" on the briefing re-offers once; tracked per day. */
  briefingDeferred?: BriefingDeferral
  windowBounds?: WindowBounds
  /** Bubble position (size is fixed); off-screen-guarded on restore. */
  bubblePosition?: { x: number; y: number }
  alwaysOnTop: boolean
  /** Coach marks shown once per glyph — progressive legend teaching. */
  coachMarksSeen: string[]
}

export interface OllamaStatus {
  reachable: boolean
  models: string[]
  activeModel?: string
  queued: number
  paused: boolean
}
