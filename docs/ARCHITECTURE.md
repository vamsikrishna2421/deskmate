# Loops — Technical Architecture

> Proposed product name: **Loops** — "close your open loops." (Alternates: Sidekick, Daybook.)
> Offline-first Electron sidekick for capturing, enriching, and monitoring workday tasks.
> Windows 11 first, macOS later. Date basis for examples: 2026-07-02.

## 0. Guiding Principles

1. **Main process owns all state and I/O.** Renderer is a dumb, push-updated cache. No network, fs, or clock authority in the renderer.
2. **LLM is assistive, never blocking.** Every capture is saved and visible in <50 ms as a raw card; Ollama enrichment (~5 s warm) streams in asynchronously and *never overwrites a user edit* (field-level provenance).
3. **Deterministic where determinism matters.** The LLM classifies and extracts phrases; a pure-TS date resolver turns "EOD Friday" into an ISO timestamp. No LLM date arithmetic.
4. **Tiny footprint.** No polling loops, `backgroundThrottling` on, coarse 60 s scheduler tick, hidden pre-created windows, zero heavy deps (no UI lib, no ORM, no native modules).
5. **Every source file < 500 lines.** Enforced by the module split below.

---

## 1. Process Model & File Tree

Three Electron contexts + one shared type layer:

- **Main** (Node): windows, tray, shortcuts, JSON store, Ollama client, enrichment pipeline, scheduler, notifications, all IPC handlers.
- **Preload** (sandboxed, `contextBridge`): exposes one frozen, typed `window.loops` API. No logic.
- **Renderer** (Chromium, no Node): two entry pages — `index.html` (sidekick window) and `capture.html` (quick-capture popup). React + context/reducer.
- **Shared**: pure TS types + pure functions (date resolver, LLM output coercion) compiled into all three; no Node imports.

```
todo_intelligence/
├─ package.json                      # scripts: dev, build, test, dist; pure-JS deps only
├─ electron.vite.config.ts           # 3 builds: main, preload, renderer (2 HTML entries)
├─ electron-builder.yml              # packaging (Section 6)
├─ tsconfig.json / .node.json / .web.json   # project refs: shared→(main|preload) / shared→renderer
├─ resources/
│  ├─ icon.ico / icon.icns / trayTemplate.png   # app + tray icons (16/32px, dark/light)
├─ src/
│  ├─ shared/                        # NO Electron/Node imports anywhere in here
│  │  ├─ constants.ts                # limits, defaults, model preference order, tick intervals
│  │  ├─ types/task.ts               # Task, Subtask, OpenQuestion, Deadline, Priority, Effort, TaskStatus
│  │  ├─ types/appState.ts           # AppState, Settings, WindowBounds
│  │  ├─ types/enrichment.ts         # LlmParseRaw, EnrichmentPatch, EnrichmentJob, Briefing
│  │  ├─ types/ipc.ts                # IpcSchema map (channel → {req,res}), PushSchema, LoopsApi
│  │  ├─ dates/resolveDeadline.ts    # pure: (phrase, dayPart, capturedAt, weekStart) → Deadline
│  │  ├─ dates/dayMath.ts            # pure: localDateKey, startOfDay, isSameLocalDay, addBusinessDays
│  │  └─ llm/coerceParse.ts          # pure: unknown JSON → validated LlmParseRaw | CoerceError (hand-rolled, no zod)
│  ├─ main/
│  │  ├─ index.ts                    # entry: single-instance lock, app lifecycle, wire modules, '--hidden' flag
│  │  ├─ ipc/register.ts             # binds every IpcSchema channel to a handler fn; input validation
│  │  ├─ ipc/push.ts                 # typed webContents.send wrapper (broadcast to both windows)
│  │  ├─ windows/mainWindow.ts       # frameless sidekick window: create/show/hide, pin, min sizes
│  │  ├─ windows/captureWindow.ts    # pre-created hidden capture popup; show-at-cursor, blur-to-hide
│  │  ├─ windows/windowState.ts      # bounds persistence (debounced), off-screen guard, edge snapping
│  │  ├─ tray.ts                     # tray icon, context menu, click-to-toggle, badge on overdue
│  │  ├─ shortcuts.ts                # globalShortcut register/re-register, conflict fallback
│  │  ├─ autoLaunch.ts               # app.setLoginItemSettings wrapper (win/mac variants)
│  │  ├─ notifications.ts            # Notification API wrapper; click → focus window + deep-link task
│  │  ├─ scheduler.ts                # 60 s tick: morning briefing trigger, due-soon reminders, stalled scan
│  │  ├─ store/jsonStore.ts          # generic atomic JSON file store: tmp+fsync+rename, write queue
│  │  ├─ store/backup.ts             # rolling backups (10 recent + 7 daily), prune, restore-latest-valid
│  │  ├─ store/migrations.ts         # schemaVersion, ordered migration fns, backup-before-migrate
│  │  ├─ store/tasksRepo.ts          # CRUD + query helpers over tasks.json; emits change events
│  │  ├─ store/appStateRepo.ts       # settings + lastBriefingDate + window bounds (app-state.json)
│  │  ├─ llm/ollamaClient.ts         # fetch to localhost:11434; health, tags, chat(format:json), abort, timeout
│  │  ├─ llm/requestQueue.ts         # serial FIFO, priority lanes, per-task dedupe/supersede, abort on delete
│  │  ├─ llm/prompts.ts              # parse + re-enrich prompt templates (few-shot, JSON schema in prompt)
│  │  └─ enrichment/pipeline.ts      # orchestrates capture→enrich→merge; provenance-aware merge policy
│  ├─ preload/index.ts               # contextBridge.exposeInMainWorld('loops', typed api); channel allowlist
│  └─ renderer/
│     ├─ index.html / capture.html   # CSP meta tags; root divs
│     └─ src/
│        ├─ main.tsx / capture.tsx   # entry mounts for the two windows
│        ├─ app/App.tsx              # layout shell, view routing (Today/Week/Later/Done), keyboard map
│        ├─ app/CaptureApp.tsx       # quick-capture UI: textarea, Enter=save, Esc=dismiss, saved-toast
│        ├─ state/store.tsx          # TasksProvider + UIProvider (context + useReducer), IPC push wiring
│        ├─ state/tasksReducer.ts    # pure reducer: hydrate/upsert/remove/enrichmentStatus actions
│        ├─ state/uiReducer.ts       # pure reducer: view, theme, briefing visibility, editor target, toasts
│        ├─ state/selectors.ts       # memoized: byView(today/week/later/done), overdue, stalled, counts
│        ├─ lib/api.ts               # thin typed wrapper over window.loops (single import point)
│        ├─ lib/format.ts            # date/effort/relative-time display helpers (uses shared/dayMath)
│        ├─ components/TitleBar.tsx        # drag region, pin toggle, minimize, close-to-tray
│        ├─ components/OllamaBanner.tsx    # degraded-mode strip when Ollama unreachable
│        ├─ components/CaptureBar.tsx      # inline quick-add at top of main window
│        ├─ components/ViewTabs.tsx        # Today | Week | Later | Done (+ counts)
│        ├─ components/TaskList.tsx        # sorted/grouped list per view
│        ├─ components/TaskCard.tsx        # compact card: status, title, badges; expand toggle
│        ├─ components/TaskCardDetail.tsx  # expanded: summary, subtasks, questions, source text
│        ├─ components/SubtaskChecklist.tsx
│        ├─ components/OpenQuestions.tsx   # inline Q&A inputs → answerQuestion IPC → re-enrich
│        ├─ components/Badges.tsx          # PriorityDot, DeadlineBadge, EffortChip, TagRow, EnrichShimmer
│        ├─ components/TaskEditor.tsx      # full manual edit drawer (title/deadline/priority/tags/…)
│        ├─ components/BriefingSheet.tsx   # morning digest panel (overdue/today/week/stalled)
│        ├─ components/LegendPopover.tsx   # the element legend ("?" shortcut)
│        ├─ components/Toasts.tsx
│        └─ styles/
│           ├─ tokens.css             # all CSS variables: light :root + [data-theme=dark] overrides
│           ├─ base.css              # reset, typography, focus rings, scrollbars, reduced-motion
│           ├─ components.css        # card/badge/list/tabs styles (split further if nearing 500 lines)
│           └─ capture.css           # capture popup styles
├─ tests/
│  ├─ unit/resolveDeadline.test.ts   # table-driven date resolution (Section 7)
│  ├─ unit/dayMath.test.ts
│  ├─ unit/coerceParse.test.ts       # malformed/partial LLM JSON handling
│  ├─ unit/jsonStore.test.ts         # atomicity, corruption recovery, backups (real tmp dir)
│  ├─ unit/migrations.test.ts
│  ├─ unit/requestQueue.test.ts      # serial order, priority, supersede, abort (fake timers)
│  ├─ unit/tasksReducer.test.ts / uiReducer.test.ts / selectors.test.ts
│  ├─ unit/scheduler.test.ts         # briefing-once-per-day, reminder dedupe (injected clock)
│  └─ smoke/launch.smoke.test.ts     # spawns Electron, asserts readiness handshake (Section 7)
└─ scripts/smoke-launch.mjs          # helper used by the smoke test (spawn + JSON-line handshake)
```

Every file has a single responsibility and comfortably fits < 500 lines; `components.css` and `TaskCard*` are the watch-list and pre-split.

---

## 2. Main-Process Modules

### 2.1 Window manager (`windows/*`)

- **Main window**: `frame:false`, `width:380 (min 320, max 560)`, `height:560`, `show:false` until `ready-to-show`, `backgroundThrottling:true`, `skipTaskbar:false`. Drag via CSS `-webkit-app-region: drag` on TitleBar (interactive children marked `no-drag`).
- **Pin**: `setAlwaysOnTop(flag, 'floating')`; state persisted in AppState, restored on launch, reflected in TitleBar + tray menu.
- **Position persistence** (`windowState.ts`): debounce 400 ms on `moved`/`resized` → `appStateRepo`. On restore, validate bounds intersect a current display (`screen.getAllDisplays()`); if off-screen (undocked monitor), reset to bottom-right of primary work area.
- **Edge snapping**: on `moved`, if any edge within 12 px of `display.workArea` edge, snap flush. Pure geometry helper exported for unit tests.
- **Capture window**: pre-created at startup (`show:false`, ~460×180, frameless, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`). Hotkey shows it centered on the display containing the cursor; `blur` or Esc hides it (never destroyed → instant subsequent opens). Submitting flashes "Saved ✓" for 600 ms then hides.
- **Close semantics**: main-window close → hide to tray (real quit only via tray menu or `app.quit`). `window-all-closed` does not quit.

### 2.2 Tray (`tray.ts`)

- Icon variants for light/dark taskbar; overlay badge (red dot) when overdue count > 0 (re-rendered from a small offscreen canvas is avoided — ship 2 pre-baked icons: normal, attention).
- Left-click: toggle main window. Context menu: Quick capture, Show Loops, Morning briefing, Pin on top ✓, Launch at login ✓, Quit.
- Tooltip: `Loops — 3 due today, 1 overdue`.

### 2.3 Global shortcut (`shortcuts.ts`)

- Default `Ctrl+Shift+Space` → show capture window. Secondary `Ctrl+Shift+L` → toggle main window. Configurable in Settings.
- `globalShortcut.register` return value checked; on conflict, try fallback list, else push `settings:hotkeyFailed` to renderer for a toast. Re-register on settings change; `unregisterAll` on quit.

### 2.4 Single instance & auto-launch

- `app.requestSingleInstanceLock()`; if not held, `app.quit()` immediately. `second-instance` → show + focus main window (this is also the "reopen" path from a second taskbar launch).
- `autoLaunch.ts`: `app.setLoginItemSettings({ openAtLogin, args:['--hidden'] })` (Windows registry Run key under the hood; mac uses `openAsHidden`). `--hidden` at startup → create windows but show none; tray only. Toggle surfaced in Settings + tray.

### 2.5 JSON store (`store/*`)

**Files** in `app.getPath('userData')/data/`:

| File | Contents |
|---|---|
| `tasks.json` | `{ schemaVersion, tasks: Task[] }` |
| `app-state.json` | `{ schemaVersion, ...AppState }` |
| `backups/tasks-<ISO>.json` | rolling backups |

**Entities** (`shared/types/task.ts`):

```ts
type TaskStatus = 'inbox'|'open'|'in_progress'|'blocked'|'done'|'archived';
type Priority   = 'urgent'|'high'|'normal'|'low';
type Effort     = 'minutes'|'hour'|'half_day'|'day'|'multi_day';
interface Deadline { kind:'hard'|'soft'|'none'; due?:string /*ISO*/; allDay:boolean;
                     source:'llm'|'user'; rawPhrase?:string }
interface Subtask      { id:string; title:string; done:boolean; source:'llm'|'user' }
interface OpenQuestion { id:string; question:string; answer?:string;
                         status:'open'|'answered'|'dismissed'; answeredAt?:string }
interface Task {
  id:string;                       // crypto.randomUUID()
  title:string; summary?:string;
  sourceText:string; sourceKind:'paste'|'typed';
  status:TaskStatus;
  deadline:Deadline;
  priority:Priority;  effort?:Effort;  tags:string[];
  subtasks:Subtask[]; questions:OpenQuestion[];
  provenance:{ title:'llm'|'user'; summary:'llm'|'user'; priority:'llm'|'user';
               effort:'llm'|'user'; tags:'llm'|'user' };     // merge guard (2.8)
  enrichment:{ status:'pending'|'running'|'done'|'failed'|'skipped';
               model?:string; attempts:number; error?:string; lastRunAt?:string };
  reminders:{ dueSoonNotifiedAt?:string; overdueNotifiedAt?:string };
  createdAt:string; updatedAt:string; completedAt?:string;
  activityAt:string;               // any user touch; drives "stalled" detection
  pinned:boolean;
}
interface AppState {
  schemaVersion:number;
  lastBriefingDate?:string;        // 'YYYY-MM-DD' local
  windowBounds?:Rect; alwaysOnTop:boolean; theme:'system'|'light'|'dark';
  hotkeyCapture:string; hotkeyToggle:string;
  launchAtLogin:boolean; remindersEnabled:boolean; dueSoonLeadMinutes:number; // default 30
  ollama:{ baseUrl:string; preferredModels:string[] };  // ['qwen2.5:3b','qwen2.5:1.5b','gemma2:2b']
}
```

**Atomic writes** (`jsonStore.ts`): serialize → write `file.json.tmp` → `fsync` → `fs.rename` over target (atomic replace on NTFS/APFS). All writes funneled through a per-file promise chain (no interleaving); saves debounced 300 ms with `flush()` forced on `before-quit`. Reads at startup: parse `tasks.json`; on parse failure, quarantine corrupt file as `tasks.corrupt-<ts>.json` and restore newest valid backup (walk backups until one parses).

**Backups** (`backup.ts`): before every migration and on first successful write of each day; keep 10 most recent + newest per day for 7 days; prune the rest.

**Migrations** (`migrations.ts`): `const migrations: ((doc:any)=>any)[]` indexed by version; on load, if `doc.schemaVersion < CURRENT`, back up, run sequentially, write back. Unknown (future) version → refuse to write, open read-only with a renderer banner (protects against downgrade data loss).

### 2.6 Ollama client (`llm/ollamaClient.ts`)

- Base `http://localhost:11434`, global `fetch` (Node 22). Renderer never touches the network.
- `health()`: `GET /api/version`, 2 s timeout. `models()`: `GET /api/tags`; pick first installed model from `preferredModels` → `activeModel`; none installed → degraded mode.
- `chat(messages, {signal})`: `POST /api/chat` with `stream:false`, `format:'json'`, `options:{ temperature:0.2, num_ctx:4096 }`. Per-request `AbortController`; timeout 45 s cold / 20 s warm (first success flips a `warm` flag).
- **Retries**: network error or timeout → 1 retry after 2 s. HTTP 4xx/5xx or JSON-coerce failure → no blind retry; one "repair" attempt re-prompting with the invalid output and coercion errors, then mark `enrichment.failed` (card shows retry affordance; task remains fully usable raw).
- Health is checked lazily: on app start, when queue transitions idle→active, and on explicit user retry — **no periodic ping**. Status changes push `ollama:statusChanged`.

### 2.7 Request queue (`llm/requestQueue.ts`)

- Strict **concurrency 1** (a 3B model on office laptop must never get parallel requests).
- Two priority lanes: `interactive` (fresh capture, question-answer re-enrich) ahead of `background` (manual bulk retry). FIFO within lane.
- Per-task keying: enqueuing a job for a task that already has a queued job **supersedes** it (latest context wins); a *running* job for a deleted task is aborted via its controller.
- Emits `job:start/success/fail` consumed by the pipeline; exposes `size()` for the status strip.

### 2.8 Enrichment pipeline (`enrichment/pipeline.ts`)

```
capture(text) ─→ tasksRepo.create(raw Task, status:'inbox', enrichment:'pending')   // instant
             ─→ push tasks:changed                                                   // card visible now
             ─→ queue.enqueue(parseJob)                                              // async
parseJob: prompts.parse(sourceText, now, weekday) → ollama.chat → coerceParse()
        → resolveDeadline(rawPhrase, dayPart, capturedAt)          // deterministic dates
        → merge into task (see policy) → status 'open' → push tasks:changed + enrichment:status
```

- **Merge policy**: a field is written only if its `provenance` is still `'llm'` (or unset). Any manual edit flips that field's provenance to `'user'` permanently — later enrichments can never clobber it. Subtasks/questions are appended with de-dupe by normalized text, never removed.
- **Open loops**: the parse prompt asks for up to 3 `clarifying_questions` only when genuinely ambiguous. Answering one (`tasks:answerQuestion`) stores the answer and enqueues a re-enrich job whose prompt includes source text + all Q&A pairs + current user-owned fields (marked "do not change").
- **Prompt output contract** (`prompts.ts`): model must return JSON: `{ title, summary, subtasks[], deadline:{ phrase, day_part:'eod'|'morning'|null, kind:'hard'|'soft'|'none' }, priority, effort, tags[], clarifying_questions[] }`. `coerceParse.ts` clamps enums, truncates lengths, drops unknown keys, and fails loudly with reasons (fed to the repair pass).

### 2.9 Scheduler (`scheduler.ts`)

- Single 60 s `setInterval` + event triggers: `app ready`, `powerMonitor` `resume`/`unlock`, main-window `focus`. Clock injected for tests.
- **Morning briefing**: on any trigger, if `localDateKey(now) !== appState.lastBriefingDate` **and** user activity is present (window focused/shown), build `Briefing { overdue[], dueToday[], dueThisWeek[], stalled[] }` (stalled = not done, `activityAt` > 3 days old, has deadline or priority ≥ high) and push `briefing:show`. Renderer displays it as an in-window sheet — gentle, dismissible; `briefing:ack` records the date so it fires once per day. If the app was launched `--hidden` and never focused, a single quiet tray notification "Your morning briefing is ready" is shown instead (click opens it).
- **Due-soon reminders**: each tick, tasks with `deadline.kind==='hard'`, not done, `due - now <= dueSoonLeadMinutes` and `reminders.dueSoonNotifiedAt` unset → one Notification; same pattern once at the moment it becomes overdue. Timestamps persist so restarts never re-nag. Soft deadlines never notify — they only surface in views and the briefing.

---

## 3. Typed IPC Contract

`contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`. Single source of truth `shared/types/ipc.ts`:

```ts
interface IpcSchema {            // renderer → main, ipcRenderer.invoke / ipcMain.handle
  'tasks:list':          { req: void;                                res: Task[] };
  'tasks:create':        { req: { sourceText:string; sourceKind:'paste'|'typed' }; res: Task };
  'tasks:update':        { req: { id:string; patch:TaskPatch };      res: Task };   // flips provenance→user
  'tasks:setStatus':     { req: { id:string; status:TaskStatus };    res: Task };
  'tasks:toggleSubtask': { req: { taskId:string; subtaskId:string }; res: Task };
  'tasks:answerQuestion':{ req: { taskId:string; questionId:string; answer:string }; res: Task };
  'tasks:dismissQuestion':{req: { taskId:string; questionId:string }; res: Task };
  'tasks:reenrich':      { req: { id:string };                       res: void };
  'tasks:delete':        { req: { id:string };                       res: void };
  'briefing:get':        { req: void;                                res: Briefing };
  'briefing:ack':        { req: { dateKey:string };                  res: void };
  'ollama:status':       { req: void; res: { reachable:boolean; models:string[]; activeModel?:string; queued:number } };
  'settings:get':        { req: void;                                res: AppState };
  'settings:update':     { req: Partial<Settings>;                   res: AppState };
  'window:pin':          { req: { onTop:boolean };                   res: void };
  'window:minimize':     { req: void;                                res: void };
  'window:hide':         { req: void;                                res: void };   // close→tray
  'capture:submit':      { req: { text:string };                     res: { taskId:string } };
  'capture:dismiss':     { req: void;                                res: void };
  'app:getVersion':      { req: void;                                res: string };
}
interface PushSchema {           // main → renderer, webContents.send (broadcast both windows)
  'tasks:changed':        { upserted:Task[]; deletedIds:string[] };  // delta, not full list
  'enrichment:status':    { taskId:string; status:Task['enrichment']['status']; error?:string };
  'briefing:show':        Briefing;
  'ollama:statusChanged': { reachable:boolean; activeModel?:string; queued:number };
  'settings:changed':     AppState;                                  // incl. theme / nativeTheme flips
  'settings:hotkeyFailed':{ hotkey:string };
  'nav:focusTask':        { taskId:string };                         // from notification click
}
```

- **Preload** builds `window.loops` mechanically from these maps: `invoke<C>(channel, req)` + `on<C>(channel, cb)` — with a **hard-coded allowlist** of the keys above; arbitrary channel strings from the renderer are rejected at the bridge. API object is `Object.freeze`d.
- **Main** (`ipc/register.ts`) validates every `req` at the boundary (type guards from `shared`), clamps string lengths (e.g. `sourceText` ≤ 8 KB), and verifies `event.senderFrame.url` is one of our two `file://` (dev: `http://localhost:5173`) pages before acting.
- Request/response = `invoke/handle` only (no `send`-based RPC); pushes are fire-and-forget deltas so both windows stay coherent.

---

## 4. Renderer Architecture

### 4.1 State: React context + reducer (vs. zustand)

Chosen: **two contexts, each `useReducer`** — `TasksContext` (task cache) and `UIContext` (view, editor target, briefing, toasts, theme).

Justification: the renderer is a *cache of main-process state*, hydrated once (`tasks:list`) then patched by `tasks:changed` deltas — exactly a reducer's shape; total state is a few hundred tasks, far below any perf threshold; zustand's wins (selector subscriptions outside React, less boilerplate) don't pay for an extra dependency in a zero-dep, offline, auditable app. Re-render blast radius is controlled the boring way: contexts split so UI chatter never re-renders the task list, `selectors.ts` memoized per `(tasks, view, todayKey)`, `TaskCard` under `React.memo` keyed by task object identity (reducer preserves identity of untouched tasks). If the app ever grows multi-window shared editing or 10k tasks, swapping the provider internals for zustand is a contained change behind the same hooks (`useTasks()`, `useUI()`).

### 4.2 Component tree

```
App
├─ TitleBar (drag, pin, minimize, hide)
├─ OllamaBanner (only when degraded: "Intelligence offline — capture still works")
├─ CaptureBar
├─ ViewTabs (Today | Week | Later | Done, with counts)
├─ TaskList → TaskCard[* per view]
│   ├─ Badges (PriorityDot, DeadlineBadge, EffortChip, TagRow, EnrichShimmer)
│   └─ TaskCardDetail (expanded) → SubtaskChecklist, OpenQuestions, source text
├─ TaskEditor (drawer; manual override of every field)
├─ BriefingSheet (morning digest; Enter dismisses = ack)
├─ LegendPopover ("?" key)
└─ Toasts
CaptureApp (capture.html): textarea, char count, Enter=save / Shift+Enter=newline / Esc=dismiss
```

**Views** (pure selector logic): *Today* = overdue + due today + `in_progress` + pinned; *This Week* = due within current business week; *Later/Optional* = soft/no deadline & low priority; *Done* = completed, newest first, 30-day window then archived.

**Keyboard-first**: `Ctrl+N` capture, `↑/↓` move, `Enter` expand, `E` edit, `Space` done, `1–4` switch view, `P` cycle priority, `?` legend. Focus outline always visible; roving tabindex in the list.

### 4.3 Theming & element legend

- `tokens.css`: all color/space/type/radius/shadow as CSS variables on `:root` (light) + `[data-theme="dark"]` overrides; `data-theme` on `<html>` from settings (`'system'` follows `nativeTheme` via `settings:changed` push).
- **Legend (never color alone — always color + icon/shape + text):** priority = left card border + dot (urgent ⛔ red, high ▲ amber, normal ● blue, low ○ gray); deadline = badge (hard: filled + "Fri 5pm"; soft: outlined + "~this week"; overdue: red + ⚠ + "2d overdue"); status = checkbox states (empty/half/✓) + blocked 🚫; enriching = shimmer bar + spark icon; stalled = 🕓 "quiet 4d"; open questions = ❓ count chip. `LegendPopover` renders this exact table in-app.
- `prefers-reduced-motion` disables shimmer/slide animations.

---

## 5. Security Hardening

1. `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`, `webviewTag:false` on every `BrowserWindow`.
2. Preload exposes only the frozen allowlisted API (Section 3); no `ipcRenderer` leak, no dynamic channels.
3. Main validates and clamps every IPC payload; checks `senderFrame.url` against the two known pages.
4. CSP meta in both HTML files: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'` — renderer cannot reach the network at all (Ollama is main-only).
5. `webContents.setWindowOpenHandler(() => ({action:'deny'}))` and `will-navigate` → `preventDefault()` on both windows.
6. `session.setPermissionRequestHandler((_, __, cb) => cb(false))` — deny geolocation/camera/etc.
7. Electron Fuses (via `@electron/fuses` at package time): `runAsNode:false`, `enableNodeCliInspectArguments:false`, `enableEmbeddedAsarIntegrityValidation:true`, `onlyLoadAppFromAsar:true`.
8. DevTools disabled in production (`devTools:false` webPreference unless `--debug`).
9. No `shell.openExternal` on task-derived strings (pasted text is untrusted; render as plain text, never HTML — React default escaping, no `dangerouslySetInnerHTML`).
10. Ollama requests pinned to `http://localhost:11434` from config validated as loopback host; response bodies size-capped (256 KB) before JSON.parse.
11. No telemetry, no auto-update endpoints, no remote resources — verifiable by the CSP plus zero non-loopback `fetch` in `main/`.
12. `asar:true`; userData JSON contains no secrets (nothing to encrypt), but written with default user-profile ACLs only.

---

## 6. Packaging (electron-builder.yml essentials)

```yaml
appId: com.vamsy.loops
productName: Loops
directories: { output: dist, buildResources: resources }
files: ["out/**"]                    # electron-vite build output only
asar: true
compression: normal
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: resources/icon.ico
nsis:
  oneClick: true                     # frictionless personal install, per-user
  perMachine: false                  # no admin rights needed on the office laptop
  deleteAppDataOnUninstall: false    # never destroy tasks.json on uninstall
  artifactName: Loops-Setup-${version}.exe
  runAfterFinish: true
mac:                                 # future
  target: [{ target: dmg }, { target: zip }]
  category: public.app-category.productivity
  icon: resources/icon.icns
  hardenedRuntime: true              # + entitlements & notarization when signing set up
publish: null                        # offline product: no update feed, no publish
```

Notes: no `autoUpdater` (100% offline promise); unsigned Win build initially → SmartScreen warning documented in README, code-signing cert is a later purchase; fuses flipped in an `afterPack` hook; `extraResources` unused (models live in Ollama, not the app).

---

## 7. Test Plan (vitest)

**Unit (node env, pure or tmp-dir fs — the bulk of coverage):**

| Suite | What it proves |
|---|---|
| `resolveDeadline` | Table-driven: "EOD"→today 17:30 hard; "eow"/"this week"→Fri EOD; "tomorrow"; "Friday" captured *on* Friday→same day, on Saturday→next Friday; "next week"→next Mon soft; "no rush"/absent→kind:none; month/year boundaries; `weekStart` config. Frozen `capturedAt` injected — zero `Date.now()` in the function. |
| `dayMath` | localDateKey across DST changes, business-day adds. |
| `coerceParse` | Valid JSON passes; wrong enum clamps to default; missing title→CoerceError; oversized arrays truncated; prose-wrapped JSON extracted; garbage→structured error for the repair pass. |
| `jsonStore` | Write→read round-trip in tmp dir; tmp file cleaned; simulated crash (tmp exists, target stale)→target intact; corrupt target→quarantine + newest valid backup restored; concurrent saves serialize (last wins, no interleave). |
| `migrations` | v0→vN chain; backup created before migrate; future version→read-only refusal. |
| `requestQueue` | Fake timers: strict serial execution; interactive preempts queued background; supersede replaces queued job for same task; abort mid-flight resolves job as cancelled; failure doesn't stall the queue. |
| `tasksReducer` / `uiReducer` / `selectors` | Delta upsert preserves object identity of untouched tasks (memo guarantee); view bucketing incl. overdue-in-Today; briefing ack; toast lifecycle. |
| `scheduler` | Injected clock: briefing fires once per local day, again after midnight rollover; resume-from-sleep trigger; due-soon fires once per task (persisted `notifiedAt`), never for soft deadlines. |
| `pipeline` (mock ollama) | Raw task saved before LLM resolves; merge respects `provenance:'user'`; failed enrich leaves usable raw task + `failed` status; answer→re-enrich includes Q&A in prompt. |

**Electron launch smoke test** (`tests/smoke/launch.smoke.test.ts`, gated by `SMOKE=1`, runs in CI-like script `npm run test:smoke`): `scripts/smoke-launch.mjs` spawns `electron .` via `child_process` with env `LOOPS_E2E=1` and a temp `--user-data-dir`; in E2E mode `main/index.ts` prints JSON lines `{"evt":"ready"}`, `{"evt":"window-created","id":"main"}`, `{"evt":"store-loaded","tasks":0}` and exits cleanly on `SIGTERM`. The test asserts the handshake arrives < 15 s, a second spawned instance exits immediately (single-instance lock), and exit code is 0 — proving packaging wiring, preload path, and store bootstrap without a full driver dependency. (If richer E2E is wanted later, Playwright `_electron` slots in without changing the app.)

**Conventions**: `npm test` = unit (fast, no Electron binary); coverage thresholds on `shared/` and `main/store|llm` (the correctness-critical core); no tests mock the filesystem for the store — real tmp dirs catch Windows rename semantics.
