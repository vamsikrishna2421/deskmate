# Sill — Design Specification (v1, final)

> **Product name: Sill.** A quiet ledge for the tasks that land on you — the app is literally a
> small window at the edge of your screen. Short, calm, professional, ownable. Window title
> "Sill", exe `sill.exe`, tray tooltip `Sill — 3 due today`. Trademark fallbacks: Ledge, Margin.
> ARCHITECTURE.md's proposed "Loops" is rejected: it collides with Microsoft Loop (the user's
> Teams-centric office) and names the app after one feature. All user-facing strings say Sill;
> `productName: Sill`, `appId: com.vamsy.sill`. (Internal bridge name may stay `window.loops`.)
>
> **Winning concept: SILL**, with grafts endorsed by the judges:
> Flightstrip → violet "?" deadline chip, shade-state deadline ticker, live legend filtering,
> week load gauges. Sidenote → effort-forward "Got 30 minutes?" Later view, loops batch-answer
> flow, Ctrl+Enter multi-capture. Storage/notification conflicts resolved per ARCHITECTURE.md
> (see §16). This document is the single spec; no options remain open.

---

## 1. Design doctrine (enforceable rules — violations are bugs)

1. **One thing is loud.** At any moment exactly one element uses full-strength color: the most
   urgent item's rail, or the focused control. Everything else sits at tint/secondary strength.
2. **Intelligence whispers.** The LLM annotates, never authors: output visually subordinate,
   always attributed (✦ + provenance quote), reversible in one interaction, never blocking.
   The raw captured text is sacred and always recoverable.
3. **Text before chrome.** Typography and spacing carry hierarchy; borders, fills, icons are
   last resorts. No panels-within-panels, no toolbars, no dashboard widgets.
4. **Motion is breath.** Animation only explains state change; ≤260ms; honors
   `prefers-reduced-motion` by collapsing to 80ms opacity fades.
5. **Never interrupts.** No popups or badges by default. The app speaks when summoned, at one
   daily briefing, and (only exception, per architecture) one quiet native toast per hard
   deadline approaching — never for soft deadlines, never twice for the same task.
6. **Trust through provenance.** Every inferred field can show its source phrase; low-confidence
   guesses get a dotted underline; user-edited fields are locked against re-enrichment.

Emotional target: a paper sticky note that happens to have read the message for you.

## 2. Information architecture

```
Sill (companion window)
├─ Header (drag) ── pin · overflow ··· (Legend, Settings, Pause assistant, Quit)
├─ [OllamaBanner]           only when assistant unreachable
├─ View tabs: Today · Week · Later · Done   (+ ◌n loops chip · / search morph)
├─ Task list (grouped per view) → TaskCard (collapsed ⇄ expanded)
├─ Sheets (in-window, bottom): Briefing · Legend · Settings · TaskEditor
└─ Toasts (undo)
Quick Capture (separate pre-created window, global hotkey)
Tray (dot when due-today & hidden) → Open · Quick capture · Briefing · Pause · Launch at login · Quit
```

Data objects rendered: Task (title, summary, subtasks, deadline hard/soft/none, priority,
effort, tags, questions, provenance, enrichment status), Briefing, OllamaStatus, Settings —
exactly the shared types in ARCHITECTURE.md §2.5.

## 3. Windows & states (all frameless, 12px radius, DPI-aware, light/dark)

| State | Size (px) | Notes |
|---|---|---|
| Companion (default) | **384×560** | min **340×440**; max width **560** (content column caps at 500, left-aligned); height free up to work area. Position/size remembered per monitor; off-screen guard resets to bottom-right of primary work area. |
| Shaded | **384×48** | header only. Double-click header or `Ctrl+Shift+U` (in-app). Shows ticker: `Today 3 · ◌1 · ● 5pm board deck` — count, open loops, **next hard deadline today** (title truncated ~18ch). Animations suspended while shaded. |
| Quick capture | **520×180**, grows once to **520×300** | pre-created hidden, `alwaysOnTop`, non-user-resizable; main resizes it (140ms) when text exceeds 4 lines. Centered horizontally, top edge at 22% of active monitor height. Opens 160ms scale .98→1 + fade; closes 120ms. |
| Hidden (tray) | — | close hides to tray; renderer timers stopped; idle budget <1% CPU, <200MB RAM. |

Edge behavior: magnetic snap within 12px of work-area edges (per architecture). Pin =
`setAlwaysOnTop(flag,'floating')`, icon fills with accent when active, tooltip "Stay on top".
Header (40px): 20px glyph · view title · right: `+` capture, pin, `···`, minimize, close —
all 28×28 hit targets, `-webkit-app-region: no-drag`.
View-tab row: 36px. No footer chrome.

Global hotkeys (rebindable, conflict-detected with fallback + toast): `Ctrl+Shift+Space`
capture · `Ctrl+Shift+L` show/hide companion. In-app only: `Ctrl+Shift+U` shade.

## 4. Quick capture flow (paste → captured in <3s, zero required decisions)

1. `Ctrl+Shift+Space` → capture window, cursor in a multiline field.
   Placeholder: `Paste a message or jot a task…`
   Hint row (12px tertiary): `Enter to capture · Shift+Enter new line · Ctrl+Enter capture & keep open · Esc to cancel`
2. User pastes (app **never** reads the clipboard itself) or types. If content >~140 chars or
   multiline, a hairline chip appears above the field: `message — will be summarized`.
3. **Pre-hints (optional):** `Tab` cycles a deadline chip: none → Today → This week → Later.
   Typed tokens parsed locally (regex, no LLM): `!today !week !later !hard !soft`, `#tag`.
   A pre-hint locks that field (`provenance:'user'`) — the LLM may never override it.
4. `Enter` → `capture:submit`; window hides in 120ms. **Ctrl+Enter** submits and keeps the
   window open, field cleared, for rapid multi-capture (600ms inline `Saved ✓`).
5. The task exists instantly (raw card, top of routed view — Today by default). If the
   companion is visible, card slides in 220ms; if hidden, only the tray dot may appear. No toast.
6. In-app: `N` or header `+` opens the same field inline at the top of the current list.

Capture works with Ollama fully dead — local write first, always.

## 5. Enrichment lifecycle & card states

Serial FIFO queue, concurrency 1, interactive lane first (architecture §2.7). Deterministic
`resolveDeadline()` turns LLM phrases into dates — the model never does date math.

| State | Rail | Meta signal | Details |
|---|---|---|---|
| RAW (t=0) | none | pulsing 6px spruce dot + `Reading…` | first line of capture as provisional title (2-line clamp), "just now" timestamp. Fully interactive. |
| QUEUED | none | hollow dot + `Waiting…` | behind another job. |
| ENRICHING | none | dot + two skeleton shimmer lines (60%/40% width, 8px, r4; opacity 0.5→0.9, 1800ms loop) | header glyph gains pulsing dot; hover `Organizing 1 task…`. |
| SLOW (>8s) | none | `Assistant is waking up…` | tolerates 60s cold start; launch-time warm-up ping. |
| ENRICHED | urgency color | ✦ settles into meta | skeletons cross-fade 180ms into title/summary/chips; one-time 6% accent wash fades 800ms (the only "ta-da"). |
| HAS QUESTIONS | urgency color | `◌ 2` violet badge | see §7. |
| OVERDUE | brick | brick-tinted chip `● yesterday 5pm` | nothing else turns red. |
| DONE | — | `Done · Undo` for 5s | check draws 160ms, title →400/secondary + 60% strikethrough, then slides out 220ms to Done. |
| OFFLINE/FAILED | none | hollow gray dot + `Assistant is offline — saved as written.` + retry glyph | app 100% usable un-enriched; auto-retries when Ollama returns. |

Trust mechanics: field tooltips quote the source phrase (`From the message: "need this by EOD
Thursday"`); low-confidence fields render a **dotted underline** ("guessed — tap to confirm")
and usually spawn a loop; user-edited fields show a small **lock** on hover and are merge-
protected by provenance; re-enrichment shimmers **only affected fields** (1–2s), never the card.
LLM title replacing raw text: raw moves to the expanded card's "From pasted message" block —
never lost. The list never reorders while the pointer is inside it (defer until pointer exit
or 3s idle).

## 6. Task card anatomy

**Collapsed** (list unit): surface bg, 1px hairline border, r10, padding 12×14, 8px gap.
Flat at rest; hover = shadow-sm + border one step darker; focus = 2px accent ring.
- **Urgency rail:** 3px vertical rounded bar, left inset. brick=overdue · ochre=due today ·
  slate=this week · none=later. The single primary urgency signal.
- **Line 1:** 18px check circle (1.5px stroke; hover tint-fills) + title 14px/500, 2-line clamp.
- **Line 2 (meta, 12px):** deadline chip — **● filled dot = hard** (`● today 5pm`),
  **○ hollow = soft** (`○ Friday`), **violet `◌ when?` = unparseable** (clicking focuses the
  "When is this due?" loop — the question sits where the answer will land); effort `~45m`
  tertiary; priority mark (▲ filled = urgent, ▲ outline = high, neutral ink, text tooltip;
  normal/low show nothing); ≤2 tag pills + `+1`; `◌ n` violet loop badge; ✦ enriched mark;
  ★ spruce focus star (user-set, max 3 app-wide; LLM-proposed star renders dotted until confirmed).

**Expanded** (Enter/click; grows in place 200ms): title (inline edit; lock-on-hover if edited) →
summary 13px secondary → subtasks (mini check circles; collapsed beyond 3; `2/5` progress; LLM
capped at 5; hover-delete per row) → Quick questions block (§7) → details: `From pasted message`
→ raw text in sunken monospace block + created/edited timestamps → action row (ghost buttons):
`Edit (E) · Snooze (S) · Move to today (T) · Let go`. Esc collapses.

## 7. Open loops — the cross-question system

Creation: parse prompt returns ≤3 clarifying questions only when genuinely ambiguous; UI shows
max 2 at once per card (rest under `+1 more`). Types: choice / date / free-text.

Card signal: small violet **◌ n** glyph in the meta row. Nothing else changes.

**Answering (in expanded card):** violet-tinted block headed `Quick questions` (12px/600).
Each loop = one 13px line + its affordance: choice → 2–4 hairline pills (`Hard deadline` /
`Flexible`); date → chips `Today · Tomorrow · Friday · Pick…` (inline month grid); free-text →
single-line input, `Answer briefly…`, Enter submits. Every loop has a ghost `Not important`
(dismiss, remembered — the prompt is told not to re-ask). On answer: line collapses to `✓ …`
(180ms); when the last resolves: `Thanks — updating…` + field-level shimmer; badge fades.

**Batch flow (Sidenote graft):** a `◌ n` chip at the right of the tab row appears only when
loops exist. Click (or `A` app-level) filters the list to looped cards with their question
blocks pre-expanded — rapid-fire: `j/k` between questions, `1–3` pick chips, `T` type,
`S` not-important, Esc exits. Clearing loops feels like answering DMs, ~2 minutes.

Decay, no nagging: loops never notify; appear in the briefing at most twice; after 3 workdays
unanswered they fold to one quiet line `3 unanswered questions`. Loops never gate anything.

## 8. Morning briefing

Trigger: first companion focus after 4:00am local, once per day (`lastBriefingDate`); if
launched `--hidden` and never focused, one quiet tray notification `Your morning briefing is
ready`. Manual: tray menu or `···`. Form: in-window sheet replacing list content (tabs hide);
ghost `Later` top-right; slides 280ms, sections stagger 40ms; reading time <30s.

1. Dateline `WEDNESDAY, JULY 2` (12px caps tertiary) → `Good morning.` (20px/500; time-aware).
2. Synthesis: one LLM sentence, async behind one skeleton line, instant deterministic fallback
   `2 due today · 1 carried over · 3 this week.` Never blocks.
3. Sections (max 3 rows each + `+ n more` → filtered view):
   `Carried over` (never "OVERDUE"; one-tap `Move to today · Reschedule · Let go`) →
   `Due today` → `This week` → `Quiet for a while` (stalled = untouched 5+ workdays, max 2:
   `Still relevant?` `Keep · Let go`) → `Quick questions` (≤2 loops, answerable inline).
4. Ambient sum: `About 3h of focused work today.` (13px tertiary, only if efforts exist).
5. Footer: primary `Start the day →` (Enter) · ghost `Later` (re-offers once).
Empty: three lines — `All clear this morning. Three things sometime this week. Start the day →`.
No streaks, scores, confetti, or guilt verbs.

## 9. Views & navigation

Tabs: text-only segmented row — `Today · Week · Later · Done` — 13px/500; active = primary ink
+ 2px accent underline sliding 200ms; inactive = secondary + 11px superscript counts. Keys
`1–4`. `/` morphs the row into inline search (fuzzy title + raw source text + `#tag`; Esc
restores). `◌ n` chip per §7.

- **Today:** groups `Carried over` (if any) → `Due today` → `Picked for today` (`pinned:true`;
  pull with `T`). Sort: urgency → deadline time → age; drag-to-reorder pins manual order.
  Footer whisper: `About 3h of focused work today.`
- **Week:** grouped Mon–Fri + `Weekend` (12px caps tertiary headers). **Load gauge** per day
  header (Flightstrip graft, rendered quietly): 48×4px hairline track, accent-tint fill =
  summed effort vs a 6h/day budget, `3.5h` in 11px tabular tertiary; fill switches to
  ochre-tint past 100% — no other alarm. Hard=●, soft=○ on every chip.
- **Later (free-time shelf — Sidenote graft):** filter row pinned on top: `Got 30 minutes?`
  `[≤30m] [≤2h] [Big rocks]` — hairline pills in Sill style (effort mapping: minutes→≤30m;
  hour→≤2h; half_day/day/multi_day→Big rocks). Default sort oldest-first; effort chips render
  one step larger here. Items untouched 5+ workdays gain a small moon glyph (only aging signal).
- **Done:** grouped by completion day; auto-archive from view after 30 days; searchable forever.

Empty states (typography only, centered, 13px tertiary): Today `Nothing due today. Enjoy the
space.` · Week `A clear week so far.` · Later `Nothing waiting.` · Done `Nothing yet today.`

**Keyboard map (in-app):** `↑/↓ j/k` focus · `Enter` expand · `Space/D` done · `E` edit ·
`S` snooze · `T` move to today · `A` loops · `N` capture · `1–4` views · `/` search ·
`?` legend · `P` cycle priority · `Esc` collapse → clear filter → shade. Roving tabindex.

## 10. Element legend (live)

Principle: **color never carries meaning alone** — every semantic color pairs with a shape or
word; survives grayscale and color-blindness.

Vocabulary (closed; new features must reuse it or use shape/text only):
| Mark | Meaning |
|---|---|
| 3px left rail: brick / ochre / slate / none | overdue / due today / this week / later |
| ● filled dot in chip | hard deadline — a real one |
| ○ hollow dot in chip | soft target |
| ◌ violet (chip `when?` or badge `◌ n`) | the assistant has a question (violet is reserved for questions) |
| ✦ | organized by the local assistant (hover = provenance) |
| dotted underline | assistant guessed — tap to confirm |
| small lock | you edited this — the assistant won't change it |
| check circle open / filled sage | to do / done |
| ▲ filled / ▲ outline (neutral ink) | urgent / high priority |
| moon glyph | quiet for a while (5+ workdays) |
| hollow gray dot | assistant offline |
| pulsing spruce dot | assistant working |
| ★ spruce (dotted = unconfirmed proposal) | focus — max 3 alive |

Surface: `?` or `···` → Legend — in-window bottom sheet (260ms, r12, shadow-lg, Esc closes)
rendering **live components at true size**, grouped Urgency · Deadlines · Questions · Assistant
· Status, each with a ≤6-word label (`Filled dot — a real deadline`). **Live behavior
(Flightstrip graft): hovering a legend row highlights every matching card behind the sheet for
2s; clicking applies it as a list filter** (second click clears) — the legend doubles as the
query surface. Footer: `Color never stands alone — every meaning has a shape.`
Progressive teaching: first real appearance of each mark shows a one-line coach mark (13px,
tint bg, dismiss ×, never modal), once. Every glyph keeps a plain-language tooltip forever.

## 11. Settings (in-window sheet via `···`)

- **General:** theme System/Light/Dark · Launch at login · Start hidden · hotkey fields for
  capture + show/hide (live conflict check: `That shortcut is taken — try Ctrl+Alt+Space`).
- **Assistant:** health row — status dot (spruce pulsing = working, spruce = ready, hollow
  gray = offline) + `qwen2.5:3b · ready` or `Ollama isn't reachable at localhost:11434 ·
  Retry`; **model picker** — radio list of installed models from `/api/tags`, preferred order
  qwen2.5:3b → qwen2.5:1.5b → gemma2:2b, uninstalled preferred models shown grayed with
  `not installed — ollama pull qwen2.5:3b` (copyable); `Pause assistant` toggle; base URL
  (validated loopback-only).
- **Reminders:** `Remind me before hard deadlines` toggle (default on) + lead minutes (30) ·
  `Morning briefing` (always on; time gate 4:00am, read-only in v1).
- **Data:** storage path (userData — outside OneDrive-synced Documents) · `Open data folder` ·
  `Export everything (JSON)` · backups note (`10 recent + 7 daily, automatic`).
- Footer: version · `100% offline. No accounts, no telemetry.`

## 12. Degraded mode (Ollama offline)

Quiet hairline strip under the header (not a modal, not red):
`Assistant is offline — everything still works. Retry` — dismissible; state also visible in
Settings. New captures stay RAW and fully editable; enrichment auto-resumes when health flips
(lazy checks: app start, queue idle→active, explicit retry — no polling). Failures are owned:
`couldn't organize this one — it's all yours ↻` after repair-pass failure. Sill without Ollama
is a complete manual todo tool; enrichment is strictly progressive enhancement.

## 13. Notifications & tray (the calm contract)

- Tray icon: minimal sill glyph; **attention variant adds a 6px dot** (never a number) when
  something is due today AND the window is hidden. No red numeric badges anywhere.
- Native toasts, exactly three kinds, each once per task/day, dedupe persisted:
  (1) hard-deadline due-soon (lead 30m, default on): `Board deck is due at 5pm.`
  (2) the moment a hard deadline passes: `Board deck was due at 5pm — it's on Today.`
  (3) `--hidden` briefing: `Your morning briefing is ready.`
  Soft deadlines never notify. Clicking focuses the task (`nav:focusTask`).

## 14. Visual token system (tokens.css — authoritative)

```css
:root {
  /* type — Inter Variable bundled locally (offline; consistent on future macOS) */
  --font-ui: "Inter Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", Consolas, monospace;
  /* scale px/lh: 11/16 micro · 12/18 meta · 13/19 secondary · 14/20 body/titles ·
     16/22 section · 20/26 greeting; weights 400/500/600 only; tnum everywhere numeric */
  --fs-micro: 11px; --lh-micro: 16px;  --fs-meta: 12px;  --lh-meta: 18px;
  --fs-sec: 13px;   --lh-sec: 19px;    --fs-body: 14px;  --lh-body: 20px;
  --fs-title: 16px; --lh-title: 22px;  --fs-greet: 20px; --lh-greet: 26px;
  --ls-caps: 0.04em;                    /* 11–12px caps labels */
  /* spacing (4px base) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px; --sp-8: 32px; --sp-10: 40px;
  /* radii */
  --r-chip: 6px; --r-card: 10px; --r-window: 12px; --r-pill: 999px;
  /* light palette — "paper" */
  --canvas: #F6F4F0; --surface: #FFFFFF; --sunken: #EFEDE8; --hairline: #E7E4DD;
  --ink-1: #262320; --ink-2: #6B665E; --ink-3: #A39D92;
  --accent: #2F6D5F; --accent-hover: #285D51; --accent-press: #214E44;
  --accent-tint: #E4EFEA; --on-accent: #FFFFFF;
  --overdue: #A8402F; --overdue-tint: #F6E7E3;
  --today: #9A6B14;   --today-tint: #F6EDDA;
  --week: #4A6C8C;    --week-tint: #E7EDF3;
  --done: #4E7A58;    --done-tint: #E6EFE7;
  --loop: #6E5AA0;    --loop-tint: #EDE9F5;      /* violet = questions only */
  --focus-ring: 0 0 0 2px var(--canvas), 0 0 0 4px var(--accent);
  /* shadows */
  --shadow-sm: 0 1px 2px rgba(38,35,32,.06);
  --shadow-md: 0 4px 12px rgba(38,35,32,.10);
  --shadow-lg: 0 12px 40px rgba(38,35,32,.20);
  /* motion */
  --dur-fast: 120ms; --dur-base: 180ms; --dur-expand: 200ms; --dur-enter: 220ms;
  --dur-sheet: 260ms; --dur-briefing: 280ms; --dur-check: 160ms;
  --ease-standard: cubic-bezier(.2,0,0,1); --ease-enter: cubic-bezier(0,0,.2,1);
  --ease-exit: cubic-bezier(.3,0,1,1);
  --shimmer-loop: 1800ms; --pulse-loop: 1200ms;  /* suspended when hidden/shaded */
}
[data-theme="dark"] {                    /* "charcoal" — warm, not blue */
  --canvas: #161514; --surface: #1F1E1C; --sunken: #131211; --hairline: #32302C;
  --raised: #262523;
  --ink-1: #EDEAE4; --ink-2: #A5A099; --ink-3: #6E6A64;
  --accent: #7FB8A8; --accent-hover: #8FC4B5; --accent-press: #6FA898;
  --accent-tint: #223B34; --on-accent: #10201B;
  --overdue: #E08B7B; --overdue-tint: #3A2521;
  --today: #D9A85C;   --today-tint: #38301F;
  --week: #86A9C4;    --week-tint: #22303C;
  --done: #8CB694;    --done-tint: #24332A;
  --loop: #AC98D8;    --loop-tint: #2C2739;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.35);
  --shadow-md: 0 6px 16px rgba(0,0,0,.45);
  --shadow-lg: 0 16px 48px rgba(0,0,0,.55);   /* raised surfaces also get
     inset 0 1px 0 rgba(255,255,255,.04) top highlight */
}
```

All body ink/surface pairs verified ≥4.5:1; `--ink-3` is decorative/redundant text only. Reduced motion: every duration token →
80ms, transforms removed (opacity-only), shimmer/pulse become static at 70% opacity.
Card padding 12×14 · list gap 8 · section gap 20 (briefing 24) · window gutter 16.

## 15. Component inventory (mapped to ARCHITECTURE.md §4.2)

| Architecture component | Design responsibility (this spec) |
|---|---|
| `TitleBar.tsx` | §3 header: drag, glyph, view title, `+`, pin, `···`, min/close; double-click → shade; shade ticker content |
| `OllamaBanner.tsx` | §12 degraded strip |
| `CaptureBar.tsx` | §4.6 inline capture (`N` / header `+`) |
| `ViewTabs.tsx` | §9 tabs, counts, sliding underline, `◌ n` chip, `/` search morph |
| `TaskList.tsx` | §9 grouping, sort, drag-reorder, no-reorder-under-pointer, virtualization, week load gauges, Later filter row, empty states |
| `TaskCard.tsx` | §5 state matrix + §6 collapsed anatomy (rail, check, title, meta) |
| `TaskCardDetail.tsx` | §6 expanded: summary, source block, timestamps, action row |
| `SubtaskChecklist.tsx` | §6 subtasks (cap 5, collapse >3, hover-delete) |
| `OpenQuestions.tsx` | §7 quick-questions block + batch loops flow |
| `Badges.tsx` | DeadlineChip (●/○/violet `?`), EffortChip, TagRow, PriorityMark ▲, LoopBadge ◌, AssistantMark ✦ (+dotted/lock), FocusStar ★, EnrichShimmer |
| `TaskEditor.tsx` | manual edit drawer — every field, flips provenance→user |
| `BriefingSheet.tsx` | §8 |
| `LegendPopover.tsx` | §10 — implement as bottom sheet with live hover-highlight + click-filter |
| `SettingsSheet.tsx` *(new)* | §11 (add to tree beside LegendPopover) |
| `Toasts.tsx` | `Done · Undo`, hotkey-conflict, hard-deadline info |
| `CaptureApp.tsx` | §4 capture window (pre-hints, Ctrl+Enter keep-open) |

## 16. Deltas to ARCHITECTURE.md (design decisions that update it)

1. `productName: Sill`, `appId: com.vamsy.sill`, artifact `Sill-Setup-*.exe`.
2. Main window default 384×560, **min 340×440** (was 320); capture window 520×180→300
   (was ~460×180) with main-driven one-step resize.
3. Stalled threshold = **5 workdays** via `addBusinessDays` (was 3 days), any not-done task.
4. `Briefing` gains `questions: {taskId, question}[]` (≤2) and `synthesis?: string` (async).
5. New IPC: `'window:shade': {req:{on:boolean}; res:void}`; push `'capture:submitted'`
   (for Ctrl+Enter inline confirmation). Task gains nothing — ★ focus uses `pinned` +
   a `focus:boolean` patch field if needed (max-3 enforced in main).
6. Legend table in architecture §4.3 is superseded by §10 here (single closed vocabulary;
   priority = neutral ▲ marks, never red; no ⛔/🚫 emoji glyphs).
7. Tray attention icon = 6px dot variant, never a numeric badge. Secondary hotkey stays
   `Ctrl+Shift+L` (architecture) — SILL's proposed Ctrl+Shift+K dropped.
8. Notifications resolved: SILL's "zero notifications" relaxed to architecture's
   hard-deadline-only reminders (§13) — this patches SILL's acknowledged risk #5.
9. Storage stays in `userData` (outside OneDrive-redirected Documents), atomic writes,
   backups — adopt verbatim; surface path read-only in Settings → Data.
10. Bundle Inter Variable in `resources/fonts/` (one file, self-hosted, CSP-safe).

## 17. Microcopy guide (canonical strings — sentence case, ≤9-word status lines, verbs first, no exclamation marks, no guilt/hustle vocabulary, "the assistant" never "AI", failures owned by the app)

- Capture: `Paste a message or jot a task…` · `Enter to capture · Esc to cancel` · `Saved ✓`
- Enrichment: `Reading…` → `Waiting…` → `Assistant is waking up…` → ✦ `Organized`
- Offline: `Assistant is offline — saved as written.` · strip: `Assistant is offline —
  everything still works. Retry` · failure: `couldn't organize this one — it's all yours ↻`
- Provenance: `From the message: "need this by EOD Thursday"` · guess: `Assistant guessed —
  tap to confirm` · lock: `You edited this — the assistant won't change it`
- Loops: `Quick questions` · `Not important` · `Thanks — updating…` · folded:
  `3 unanswered questions` · missing deadline chip: `◌ when?`
- Overdue: `Carried over` · `Move to today · Reschedule · Let go` (delete is always `Let go`)
- Stalled: `Quiet for a while. Still relevant?` → `Keep · Let go`
- Briefing: `Good morning.` · `A light day — two things due.` · `All clear this morning.` ·
  `Start the day →` · `Later` · sum: `About 3h of focused work today.`
- Empty: `Nothing due today. Enjoy the space.` · `A clear week so far.` · `Nothing waiting.` ·
  `Nothing yet today.` · Later filter: `Got 30 minutes?`
- Done: `Done · Undo` · Reminders: `Board deck is due at 5pm.` · `Board deck was due at 5pm —
  it's on Today.` · Briefing toast: `Your morning briefing is ready.`
- Times humanized: `by 5pm`, `Friday`, `sometime this week`; absolute past 7 days (`Jul 11`).

## 18. Accessibility

- **Contrast:** all body text ≥4.5:1 on its surface in both themes; semantic glyphs ≥3:1;
  `--ink-3` only for redundant/decorative text; tint backgrounds verified with their ink.
- **Color independence:** §10 — every color paired with shape/word; app fully legible in
  grayscale and under deuteranopia/protanopia; Windows High Contrast (`forced-colors`) maps
  rails to system borders, keeps glyphs/text.
- **Keyboard:** everything in §9's map; focus ring always visible (`--focus-ring`, 2px offset);
  roving tabindex in lists; focus order: header controls → tabs → list → expanded-card contents
  (title → summary → subtasks → questions → actions) → sheets trap focus, Esc returns to the
  invoking element. Explicit keyboard window-move mode (`···` → `Move window`, arrows + Enter)
  since frameless breaks Alt+Space.
- **Semantics:** custom titlebar buttons get `role="button"` + `aria-label` (`Stay on top`,
  `Minimize`, `Hide to tray`); list = `role="list"`; cards `role="article"` with
  `aria-expanded`; every glyph has an `aria-label` mirroring its legend entry; legend sheet is
  a plain semantic list; live enrichment status uses `aria-live="polite"` (never assertive).
- **Motion:** `prefers-reduced-motion` per §14; ambient loops also suspended when hidden/shaded.
- **Scaling:** usable at 200% Windows text scale — cards grow, layout holds, no horizontal scroll.
