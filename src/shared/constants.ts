/** Limits, defaults, and tuning constants (docs/LLM_PIPELINE.md §10, ARCHITECTURE.md, DESIGN.md §16).
 *  Pure — no Electron/Node imports. */

// ── Capture limits ────────────────────────────────────────────────────────────
/** Cap pastes before the LLM call: keep first 6000 + last 2000 chars with a marker
 *  (Ollama silently keeps only trailing tokens of oversized requests). */
export const PASTE_CAP_TOTAL = 8000
export const PASTE_CAP_HEAD = 6000
export const PASTE_CAP_TAIL = 2000
export const PASTE_TRIM_MARKER = '\n[... trimmed ...]\n'
/** Max stored source text (storage guard; capture UI allows more than the LLM sees). */
export const SOURCE_TEXT_MAX = 16000

// ── LLM extraction contract ───────────────────────────────────────────────────
export const SUBTASKS_MAX = 5
export const SUBTASK_TITLE_MAX = 140
export const TAGS_MAX = 3
export const QUESTIONS_MAX = 3
export const TASKS_PER_EXTRACTION_MAX = 6
export const TITLE_MAX = 120

// ── Ollama ────────────────────────────────────────────────────────────────────
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'
/** gemma2:2b is deliberately last: it hallucinated deadlines on terse input in validation. */
export const PREFERRED_MODELS = ['qwen2.5:3b', 'qwen2.5:1.5b', 'gemma2:2b'] as const
export const OLLAMA_KEEP_ALIVE = '30m'
export const OLLAMA_NUM_CTX = 8192
/** Timeouts sized for slow hardware: a laptop running qwen2.5:3b at ~15 tok/s needs ~25–45s
 *  for a multi-task extraction — the original 30s cap timed out mid-answer on such machines. */
export const LLM_OPTIONS = {
  extraction: { temperature: 0.15, num_predict: 800, timeoutMs: 90_000 },
  extractionRetry: { temperature: 0, num_predict: 800, timeoutMs: 90_000 },
  reenrich: { temperature: 0.15, num_predict: 500, timeoutMs: 60_000 },
  briefing: { temperature: 0.3, num_predict: 160, timeoutMs: 20_000 }
} as const
export const OLLAMA_HEALTH_TIMEOUT_MS = 2_000
export const OLLAMA_RESPONSE_MAX_BYTES = 256 * 1024

// ── OpenAI (optional remote assistant) ───────────────────────────────────────
export const OPENAI_BASE_URL = 'https://api.openai.com'
/** Pinned to the cheapest model by owner's rule — never expose a pricier pick in the UI. */
export const OPENAI_MODEL = 'gpt-5-nano'
export const OPENAI_HEALTH_TIMEOUT_MS = 5_000

// ── Scheduler / reminders ─────────────────────────────────────────────────────
export const SCHEDULER_TICK_MS = 60_000
/** Briefing fires on first focus after this local hour, once per day. */
export const BRIEFING_HOUR_GATE = 4
export const DUE_SOON_LEAD_MINUTES_DEFAULT = 30
/** Date-only hard deadlines are treated as due "end of day" at this local time. */
export const EOD_HOUR = 17
export const EOD_MINUTE = 30
/** "Quiet for a while" — untouched this many workdays. */
export const STALLED_WORKDAYS = 5
/** Done cards auto-archive out of the Done view after this many days (still searchable). */
export const DONE_ARCHIVE_DAYS = 30
/** Loops fold to one quiet line after this many workdays unanswered. */
export const LOOPS_FOLD_WORKDAYS = 3

// ── Store ─────────────────────────────────────────────────────────────────────
export const SCHEMA_VERSION = 1
export const STORE_DEBOUNCE_MS = 300
export const BACKUPS_RECENT_KEEP = 10
export const BACKUPS_DAILY_KEEP = 7

// ── Windows / UI ─────────────────────────────────────────────────────────────
export const MAIN_WINDOW = { width: 384, height: 560, minWidth: 340, minHeight: 440, maxWidth: 560 }
export const SHADED_HEIGHT = 48
export const CAPTURE_WINDOW = { width: 520, height: 180, grownHeight: 300 }
export const BUBBLE_SIZE = 56
/** Un-hovered bubble opacity (hover = 1); the window itself stays clickable. */
export const BUBBLE_IDLE_OPACITY = 0.5
export const EDGE_SNAP_PX = 12
export const BOUNDS_DEBOUNCE_MS = 400
export const FOCUS_STARS_MAX = 3

// ── Hotkeys ───────────────────────────────────────────────────────────────────
export const HOTKEY_CAPTURE_DEFAULT = 'Control+Shift+Space'
export const HOTKEY_TOGGLE_DEFAULT = 'Control+Shift+L'
export const HOTKEY_CAPTURE_FALLBACKS = ['Control+Alt+Space', 'Control+Shift+Insert']
export const HOTKEY_TOGGLE_FALLBACKS = ['Control+Alt+L', 'Control+Shift+O']

// ── Effort ────────────────────────────────────────────────────────────────────
export const EFFORT_MINUTES: Record<string, number> = {
  minutes: 30,
  hour: 60,
  half_day: 240,
  day: 480,
  multi_day: 960
}
/** Week view per-day load budget (DESIGN.md §9). */
export const DAY_BUDGET_MINUTES = 360
