# DeskMate

**Always on your desk, always a step ahead.**

DeskMate is an offline-first desktop task companion. Paste a raw message from your manager or a
teammate — DeskMate reads it with an on-device LLM, splits it into tasks and subtasks, figures
out the deadline, and quietly keeps you on track. Nothing ever leaves your machine.

![DeskMate](resources/logo.png)

## What it does

- **Paste → task.** `Ctrl+Shift+Space` opens quick capture anywhere. Paste a Teams/email blob or
  jot a line — the card appears instantly, then the local assistant fills in title, summary,
  subtasks, deadline (hard ● vs soft ○), priority, effort, and tags a few seconds later.
- **Asks questions when unsure.** Ambiguous asks get violet ◌ "quick questions" you can answer
  inline (or dismiss). Answers re-enrich the task. Your manual edits are locked — the assistant
  never overwrites them.
- **Morning briefing.** First open of the day: carried-over work, due today, this week, stalled
  items, and open questions — readable in under 30 seconds.
- **Views.** Today · Week (with per-day load gauges) · Later ("Got 30 minutes?" effort shelf) ·
  Done · **Desk** — a snippets vault for frequently used commands, doc links, notes, and
  secrets (encrypted with Windows DPAPI; copied secrets wipe from the clipboard after 30s).
- **Floating bubble.** A small DeskMate dot floats over every app at 50% opacity — click to
  open, drag anywhere. Plus a tray icon, a shade-to-ticker mode (double-click the header), and
  calm, hard-deadline-only reminders.
- **Private by design.** Local JSON storage with atomic writes and daily backups, loopback-only
  LLM traffic, no accounts, no telemetry. Every DeskMate window is **invisible to screen
  sharing** (Teams/Zoom viewers can't see it — you can). The only outbound traffic is a quiet
  update check against this repo's GitHub Releases; updates download in the background and
  install when you quit.

## Requirements

- Windows 10/11 (macOS build planned — the codebase is cross-platform).
- [Ollama](https://ollama.com) running locally with a small model:
  ```
  ollama pull qwen2.5:3b     # primary (recommended)
  ollama pull qwen2.5:1.5b   # faster fallback
  ```
  DeskMate works fully without Ollama — capture, edit, and organize by hand; enrichment resumes
  automatically when the assistant comes back.

## Install

Grab `release/DeskMate-Setup-<version>.exe` and run it (per-user install, no admin rights).
Unsigned build: SmartScreen may warn — choose "More info → Run anyway".

Or run from source:

```bash
npm install
npm run dev        # live-reload development
npm run package    # build the Windows installer into release/
```

## Keyboard map

| Key | Action |
|---|---|
| `Ctrl+Shift+Space` | Quick capture (global) |
| `Ctrl+Shift+L` | Show/hide DeskMate (global) |
| `N` | Inline capture · `1–5` switch views · `/` search |
| `↑/↓` or `j/k` | Move · `Enter` expand · `Space`/`D` done |
| `E` edit · `S` snooze · `T` move to today · `P` priority |
| `A` | Answer open questions rapid-fire (`1–3` pick, `S` dismiss) |
| `?` | Legend — hover highlights matching cards, click filters |
| `Esc` | Close → collapse → clear → shade (48px ticker) |

Capture pre-hints: `!today !week !later !hard !soft #tag` — these lock the field so the
assistant never overrides your call.

## Where your data lives

`%APPDATA%/deskmate/data/` — `tasks.json`, `app-state.json`, `snippets.json` (+ rolling
backups: 10 recent + 7 daily). Export everything anytime from Settings → Data. Secrets in the
Desk vault are encrypted with DPAPI, bound to your Windows account. The vault is a convenience
for wifi codes and internal tool logins — keep real credentials in a password manager.

## Development

```bash
npm test           # 224 unit tests (store, scheduler, LLM pipeline, reducers, date math)
npm run typecheck  # strict TS across main + renderer
npm run build && SMOKE=1 npx vitest run tests/smoke   # Electron launch smoke test
node scripts/e2e-live.mjs shots/    # live E2E against a real Ollama (screenshots included)
```

Design & architecture docs: `docs/DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/LLM_PIPELINE.md`
(prompts were validated against live models — treat them as load-bearing).

## Known limits (v1)

- Idle memory ~280 MB private (Chromium floor for a 3-window Electron app); CPU idles <0.1%.
- Multi-ask messages occasionally merge into one task at 3B model scale — split it with Edit,
  or answer the assistant's question when it asks.
- Drag-to-reorder in Today, per-field re-enrich shimmer, and briefing loop-decay ("asked at
  most twice") are designed but deferred; see `docs/DESIGN.md` §5/§7/§9.
- Unsigned binaries (code-signing cert is a future purchase).
