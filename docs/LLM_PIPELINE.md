# LLM Pipeline Spec — Todo Intelligence

Validated against live Ollama 0.30.11 on 2026-07-02 (Windows 11).
Models tested: `qwen2.5:3b` (primary), `gemma2:2b`, `qwen2.5:1.5b`.
Every prompt below was iterated 3-5 times against real API calls; transcripts summarized in §8.

> **2026-07-06 deltas (intelligence review, re-validated live at ~11–15 tok/s hardware; prompts.ts
> is now the source of truth where it differs from §1/§5):**
> 1. Clarifying questions bar softened from "blocks acting" to "would materially change what you
>    do"; a second few-shot example (vague ping → 2 questions, chasing person → `medium`) woke
>    them up — 0/6 probes asked questions before, the target cases ask now.
> 2. Priority edges: a named person waiting/chasing overrides a nice-to-have hedge (min
>    `medium`); a tentatively proposed sync is `soft`.
> 3. Title hygiene: timing words and hedges are banned from titles.
> 4. **Impossible dates cannot be prompt-fixed at 3B.** "Feb 30" obeys the few-shot; "June 31st"
>    still laundered into a confident wrong token in live probes. The real guard is code:
>    `shared/llm/dateGuard.ts` scans the paste for calendar-impossible phrases and clears the
>    deadline + injects the clarifying question deterministically (same philosophy as §3).
> 5. Briefing digest gains a `WORKLOAD:` line (code-computed hours; model may repeat, never compute).
> 6. Timeouts raised 30s→90s (extraction) / 60s / 20s: at real-world ~11–15 tok/s a 3-task
>    extraction takes 25–45s and the old 30s cap silently degraded it to a raw card.
> 7. An opt-in OpenAI `gpt-5-nano` provider now sits behind the same pipeline (strict
>    json_schema, reasoning_effort minimal); local Ollama remains the default.

Proposed product name: **Loopkeeper** (the app's core mechanic is closing open loops).
Alternates: Sidekick, Deskmate.

---

## 0. Architecture rules that fell out of testing

1. **Async enrichment.** Warm extraction latency is 2.2-10.6 s. The card is created instantly
   from raw text (`enrichment_status: "pending"`); the LLM result patches it in later.
2. **The model never does date math.** It emits relative tokens; a deterministic resolver (§3)
   converts them to ISO dates. Tested: the model *will* try date math if allowed (it emitted
   "tomorrow" for "EOD Friday" before this rule was tightened).
3. **Locked fields are enforced in code, not by prompt.** At 3B, prompt-level compliance was
   ~50% in tests (a locked `priority: low` was overridden by an "urgent" answer). After every
   re-enrichment, app code copies `task[f]` over `output[f]` for every `f` in `locked_fields`.
4. **The briefing model never sees raw JSON.** Bucket attribution from raw JSON failed on both
   models (hallucinated overdue items). Code pre-groups tasks into a labeled text digest (§6).
5. **Never let Ollama truncate.** Ollama silently keeps only the *trailing* ~num_ctx/2 tokens
   of an oversized request — it can eat the system prompt itself (measured, §9). The app caps
   pastes deterministically before calling.

---

## 1. Extraction system prompt (FINAL — verbatim)

Render with two variables before each call: `{{TODAY}}` = `Thursday, 2026-07-02` style
(`weekday, YYYY-MM-DD`). Injected fresh on every request.

```
You are the task extractor inside a personal todo app used by a data/BI analyst.
The input is one raw message pasted from Teams, email, or a quick personal note.
Today is {{TODAY}}.

Extract every distinct actionable task assigned to or implied for the user. Output JSON only.

FIELD RULES

title: short imperative phrase, max 60 characters, starting with a verb. Include the key object and recipient if any (e.g. "Send top-20 vendor list to Sarah").

summary: one sentence of context taken ONLY from the message: who asked, why, what "done" looks like. Never add reasons, meetings, dates, or people that the message does not mention. If the message is one short line, the summary just restates it.

deadline: exactly one token —
- "today" or "tomorrow"
- a weekday "monday" ... "sunday" = the COMING occurrence of that day (e.g. "by Friday" -> "friday")
- "next-monday" ... "next-sunday" = that weekday OF NEXT WEEK (e.g. "Wednesday next week" -> "next-wednesday")
- "next-week" = sometime next week, no specific day
- "next-month" = sometime next month
- "none" = no timing stated for THIS task
- a date "YYYY-MM-DD" ONLY if the message states that explicit calendar date
Never compute dates yourself. When the message names a weekday, output the weekday token, never "today"/"tomorrow". "EOD" / "end of day" alone means "today". "EOW" / "end of week" means "friday".
Each task's deadline comes only from timing words attached to THAT ask; never copy a deadline from another task in the same message. "at some point", "when things quiet down", "someday" -> "none".

deadline_type:
- "hard" = firm: "must", "need it by", "due", tied to a meeting/leadership review, or a P1 incident
- "soft" = loose timing: "ideally", "sometime", "when you can", "no rush"
- "none" = only when deadline is "none". If deadline is any other token, deadline_type must be "hard" or "soft".

priority — apply the FIRST rule that matches:
1. "optional" = the ask is hedged as nice-to-have: "if you have time", "spare cycles", "no rush", "when things quiet down", "maybe", "at some point", "much less urgent"
2. "high" = P1/urgent, blocking someone, leadership-visible, or hard deadline today/tomorrow
3. "medium" = any other ask with a stated deadline, or a specific named person is waiting to receive the result
4. "low" = everything else: undated follow-ups, FYI reviews

effort: rough estimate of the user's working time: "15min", "1hour", "half-day", or "multi-day".

subtasks: 2-5 short steps ONLY when the message itself spells out steps or an order to do things in. If the message does not list steps, subtasks MUST be []. A one-line request always gets []. Never invent generic steps like "investigate", "test", "deploy".

tags: 1-3 lowercase topic tags, e.g. ["dashboard","finance"].

clarifying_questions: 0-3 short questions ONLY about missing information that blocks acting (which report? send to whom? which quarter?). If the user can act without asking, use []. Never ask about the deadline when one is stated. Never ask questions the message already answers.

OTHER RULES
- One task per distinct ask. A message with several asks yields several tasks, in the order they appear.
- Keep an optional side ask as its own separate task; never merge it into the main task.
- A pure FYI with no ask becomes ONE task titled "Review impact of ..." (assess what it means for the user's work), priority "low".

EXAMPLE (format calibration only — never copy its content)
Message: "Need the churn numbers rebuilt by Tuesday for the VP readout, that's a must. And whenever you're bored, the team wiki could use a tidy-up."
Output: {"tasks":[{"title":"Rebuild churn numbers for VP readout","summary":"Rebuild the churn numbers by Tuesday; they feed the VP readout.","deadline":"tuesday","deadline_type":"hard","priority":"high","effort":"half-day","subtasks":[],"tags":["churn","reporting"],"clarifying_questions":[]},{"title":"Tidy up the team wiki","summary":"Nice-to-have wiki cleanup for whenever there is spare time.","deadline":"none","deadline_type":"none","priority":"optional","effort":"1hour","subtasks":[],"tags":["wiki"],"clarifying_questions":[]}]}
```

Prompt cost: ~1,050 tokens with a typical message; that is fine (prompt eval is fast; latency
is dominated by output tokens). The few-shot example is load-bearing: it is what finally made
`priority: "optional"` and empty-subtasks behavior stick — do not remove it.

## 2. JSON schema for Ollama's `format` parameter (verbatim)

Passed as the `format` field of `POST /api/chat`. Constrained decoding guarantees syntax; it
does NOT guarantee the deadline token vocabulary (that is the validator's job, §7).

```json
{
  "type": "object",
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title":    { "type": "string" },
          "summary":  { "type": "string" },
          "deadline": { "type": "string" },
          "deadline_type": { "type": "string", "enum": ["hard", "soft", "none"] },
          "priority": { "type": "string", "enum": ["high", "medium", "low", "optional"] },
          "effort":   { "type": "string", "enum": ["15min", "1hour", "half-day", "multi-day"] },
          "subtasks": { "type": "array", "items": { "type": "string" } },
          "tags":     { "type": "array", "items": { "type": "string" } },
          "clarifying_questions": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["title", "summary", "deadline", "deadline_type", "priority",
                     "effort", "subtasks", "tags", "clarifying_questions"]
      }
    }
  },
  "required": ["tasks"]
}
```

Re-enrichment uses the same schema minus the outer `tasks` wrapper (a single task object).
Briefing schema: `{"type":"object","properties":{"briefing":{"type":"string"}},"required":["briefing"]}`.

### Request template

```json
{
  "model": "qwen2.5:3b",
  "stream": false,
  "messages": [
    { "role": "system", "content": "<rendered system prompt>" },
    { "role": "user",   "content": "<pasted message, pre-capped per §9>" }
  ],
  "format": { "...schema above..." },
  "options": { "temperature": 0.15, "num_ctx": 8192, "num_predict": 800 },
  "keep_alive": "30m"
}
```

## 3. Deterministic deadline resolver (code, never LLM)

```ts
// token -> ISO date | null. isoDow: Mon=1..Sun=7.
function resolveDeadline(token: string, today: Date): string | null {
  if (token === "none") return null;
  if (token === "today") return iso(today);
  if (token === "tomorrow") return iso(addDays(today, 1));
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  if (days.includes(token)) {                      // coming occurrence; same day => today
    const d = (days.indexOf(token) + 1 - isoDow(today) + 7) % 7;
    return iso(addDays(today, d));
  }
  const nx = token.match(/^next-(\w+)$/);
  if (nx) {
    const mondayNext = addDays(today, 8 - isoDow(today));
    if (nx[1] === "week")  return iso(addDays(mondayNext, 4));   // due-by => Fri next week
    if (nx[1] === "month") return iso(lastDayOfNextMonth(today));
    if (days.includes(nx[1])) return iso(addDays(mondayNext, days.indexOf(nx[1])));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(token) && isRealDate(token)) return token;
  return null; // invalid token -> treated as validation error (§7)
}
```

Semantics: deadlines are "due by end of that day". `next-week`/`next-month` are soft ranges
rendered in UI as "next week", not a fake precise date; the resolved date is for sorting only.

## 4. Re-enrichment system prompt (FINAL — verbatim)

```
You update ONE existing task in a todo app. The user has just answered the task's open questions, and those answers are NEW FACTS that must change the task.
Today is {{TODAY}}.

Input sections:
CURRENT TASK — the task as stored today.
LOCKED FIELDS — fields the user edited by hand. Copy their values from CURRENT TASK unchanged, even if an answer contradicts them.
ANSWERS — question/answer pairs the user just gave.

Return the complete updated task JSON.

RULES
1. LOCKED FIELDS always win: their values are copied from CURRENT TASK exactly, no matter what the answers say. Apply answers only to unlocked fields.
2. Apply every fact from the answers to the unlocked fields. If an answer gives timing ("Monday morning", "by Friday", "happening next week"), update deadline, deadline_type, and priority to match. Fold ALL scope changes and requirements from the answers into summary (and subtasks only if real steps are stated) — do not drop any.
3. Fields with no new facts keep their exact current values.
4. clarifying_questions in the output: remove every answered question, keep unanswered ones, never put answer text there. Add at most ONE new question and only if an answer reveals new decision-critical missing info — usually add none.
5. deadline tokens: "today", "tomorrow", "monday".."sunday" (coming occurrence), "next-monday".."next-sunday" (that weekday of next week), "next-week", "next-month", "none", or "YYYY-MM-DD" only if stated explicitly. Never compute dates yourself. "Monday morning" -> "monday", but "next Friday" -> "next-friday".

EXAMPLE
ANSWERS: Q: "By when?" A: "Friday please, it blocks the release"
=> deadline "friday", deadline_type "hard", and priority "high" IF priority is not locked; the question is removed from clarifying_questions.
```

User message is rendered as labeled text sections (NOT one JSON blob — a JSON blob made the
model echo the task unchanged in testing):

```
CURRENT TASK:
{ ...task json... }

LOCKED FIELDS (copy unchanged): ["priority","effort"]

ANSWERS:
Q: When does Sarah need the list?
A: she needs it Monday morning
```

**Mandatory post-step in code** (see §0.3): re-copy locked fields, run the §7 validator, then
diff against the stored task and keep the raw Q&A in the task's history so no detail the model
dropped is ever lost (the 3B model occasionally drops one secondary requirement — observed
once in three runs).

## 5. Morning-briefing system prompt (FINAL — verbatim)

```
You write the morning briefing shown when the user opens their personal todo app.
Today is {{TODAY}}.

The input starts with a STATUS line (always true — trust it) followed by the user's open tasks grouped under headings: OVERDUE, DUE TODAY, THIS WEEK, STALLED. Sections that do not appear are empty. The grouping is always correct — repeat it faithfully. A task under THIS WEEK is NOT due today and NOT overdue.

Write 2-3 sentences, 60 words maximum. Plain text only: no lists, no emoji, no headings, no exclamation marks. Natural prose — never write the heading words in capitals.

TONE: calm and matter-of-fact, like a helpful colleague. Never guilt-trip, never say "you failed/forgot", never use "ASAP" or alarm words.

CONTENT RULES
- Order: overdue first, then due today, then one short pointer to the rest (counts are fine).
- Name every overdue and every due-today task (shortened titles are fine). Refer to groups in plain words like "this week", never as capitalized headings.
- Mention a STALLED task at most once, phrased gently ("has been quiet for a while"); if there is no STALLED section, do not mention stalled work at all.
- Shorten titles if you like, but NEVER invent tasks, counts, or deadlines, and NEVER move a task to a different group.
- If the STATUS line says the day is clear, say so and suggest getting ahead on ONE named THIS WEEK task.
```

## 6. Briefing input pre-digest (code — the model never sees raw JSON)

```ts
function renderBuckets(tasks: BriefTask[]): string {
  // group by bucket; omit empty sections entirely (leaked "(0): none" sections caused
  // hallucinated stalled/overdue mentions in testing)
  const line = t => t.title
    + (t.days_overdue ? ` (${t.days_overdue} days overdue)` : "")
    + (t.days_stalled ? ` (no activity for ${t.days_stalled} days)` : "")
    + (t.priority === "high" ? " [high]" : "");
  const sec = (name, arr) => arr.length ? `${name} (${arr.length}): ${arr.map(line).join("; ")}` : null;
  const clear = !overdue.length && !dueToday.length;
  const status = clear
    ? "STATUS: nothing overdue and nothing due today — a clear day."
    : `STATUS: ${overdue.length} overdue, ${dueToday.length} due today.`;
  return [status, sec("OVERDUE", overdue), sec("DUE TODAY", dueToday),
          sec("THIS WEEK", thisWeek), sec("STALLED", stalled)].filter(Boolean).join("\n");
}
```

Buckets, counts, and day-clear logic are computed by the app from resolved ISO dates.
Options: `temperature 0.3, num_predict 160`. Measured output: accurate attribution on both
test days; busy-day briefing ran ~70 words (soft budget overrun ~15%, acceptable).

## 7. Validation + fallback (zod-style)

```ts
const DEADLINE_RE = /^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next-(monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|none|\d{4}-\d{2}-\d{2})$/;

const Task = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).catch(t => t.title),      // default to title
  deadline: z.string().regex(DEADLINE_RE),                    // HARD failure if wrong
  deadline_type: z.enum(["hard","soft","none"]),
  priority: z.enum(["high","medium","low","optional"]),
  effort: z.enum(["15min","1hour","half-day","multi-day"]),
  subtasks: z.array(z.string().max(140)).max(5).catch([]),    // clamp, don't reject
  tags: z.array(z.string().toLowerCase()).max(3).catch([]),
  clarifying_questions: z.array(z.string()).max(3).catch([])
});
const Extraction = z.object({ tasks: z.array(Task).min(1).max(6) });
```

**Auto-repairs (silent, no retry):** deadline `"none"` with type != `"none"` → type `"none"`;
deadline set with type `"none"` → type `"soft"` (this fired on 4 of 36 bench runs — it is the
single most common model slip); array clamps; tag lowercasing; resolved-date `null` from a
syntactically valid ISO date → deadline `"none"` + `needs_review: true`.

**Retry-once-then-degrade:**
1. Attempt 1: `temperature 0.15`. Parse → validate → repair. Success → done.
2. Hard failure (unparseable — possible on timeout/empty; bad deadline token; empty title;
   `tasks` empty on non-trivial input): Attempt 2 with `temperature 0` and one system line
   appended: `STRICT: your previous output was invalid (<error list>). Follow the schema and the deadline token list exactly.`
3. Still failing → **degrade to raw card**: `title` = first 60 chars of the paste, `summary` =
   full paste, `deadline "none"`, `priority "low"`, `effort "1hour"`, empty arrays,
   `enrichment_status: "failed"`, `needs_review: true`. The card shows a subtle "couldn't
   auto-parse — tap to retry" affordance. The LLM is assistive, never a gatekeeper.

**Junk-input behavior (measured):** empty paste and "lol ok thanks" → `tasks: []` (app shows
"nothing actionable found", keeps raw card); pure noise (`xk9 zzt qqq 0x00 ###`) → one garbage
task that passes structural validation — acceptable; user deletes it. A truncated context (§9)
produced free-text deadlines like `"No specific deadline mentioned"` — exactly what
`DEADLINE_RE` + retry catches. 30 s HTTP timeout via AbortController; timeout == hard failure.

## 8. Test transcripts (summarized; full JSON in scratchpad bench_results.json)

Four messages, 3 runs each per model, seeds 7/8/9, warm model, `num_ctx 8192`.

**(a) multi-task, hard EOD-Friday + optional side ask** — qwen2.5:3b: 2 tasks; deck =
`friday/hard/high`, Snowflake tile = `none/none/optional`, no invented subtasks. Correct 3/3.
**(b) vague FYI (cost-center change "sometime next month")** — 1 task "Review impact of new
cost center hierarchy", `next-month/soft(repaired)/low`. Correct 3/3.
**(c) terse "fix the p1 dashboard bug today"** — 1 task, `today/hard/high`, subtasks `[]`,
summary restates only. Correct 3/3. (Pre-fix versions hallucinated a "leadership review" and
padded 4 generic subtasks — fixed by summary/subtask rules; keep them intact.)
**(d) rambling, 3 asks + "send to Sarah"** — 3 tasks: vendor spend redo =
`wednesday|next-wednesday /hard/high` + 2-3 genuine subtasks (fx table → rerun → re-validate);
top-20 list for Sarah = `none/none` (correctly NOT inheriting the meeting deadline), title
carries "for Sarah"; wiki documentation = `none/none/low|optional`. Correct 3/3 except
priority on the two side asks oscillates between low/medium/optional (see Known limits).

**Long realistic thread (6.8k chars, 2 asks buried in 55 FYI lines):** both asks found with
correct tokens, filler ignored, 8.8 s.

**gemma2:2b quality:** (a),(b),(d) surprisingly good — got `next-wednesday`, `optional`, and
no deadline inheritance. **But (c) is disqualifying:** deadline `friday` for a "today" task
(hallucinated), effort `multi-day`, and template placeholder junk in output:
`"[list steps to fix the bug]"`. 3/3 runs.
**qwen2.5:1.5b quality:** all four messages near-3b quality and 2.6x faster; one miss:
inherited `next-wednesday` onto the undated wiki task in (d).

## 9. Latency & quality table (median of 3 warm runs, total_duration)

| Message                  | qwen2.5:3b | gemma2:2b | qwen2.5:1.5b |
|--------------------------|-----------:|----------:|-------------:|
| (a) multi-task EOW       |    5.3 s   |   4.7 s   |     2.8 s    |
| (b) vague FYI            |    2.6 s   |   2.4 s   |     1.4 s    |
| (c) terse one-liner      |    2.5 s   |   2.4 s   |     1.6 s    |
| (d) rambling 3-ask       |    9.7 s   |   6.9 s   |     3.7 s    |
| schema-valid runs        |   12/12    |  12/12    |    12/12     |
| semantic quality         | best; 0 hallucinations post-fix | fails terse: wrong deadline + placeholder junk | 1 inherited deadline; else near-3b |
| re-enrichment            | 2.3-4.5 s  |     —     |      —       |
| briefing                 | 1.7-3.7 s  | 1.4-2.3 s |      —       |
| cold start (terse)       | 4.7 s (2.7 s load) | — |      —       |

Latency scales with OUTPUT tokens (~35 tok/s): 1 task ≈ 100 tok ≈ 2.5 s; 3 tasks ≈ 340 tok ≈
10 s. UI should stream per-card status ("3 tasks found, enriching…" is not possible with
stream:false — acceptable; the raw card is already visible).

**Model recommendation:** `qwen2.5:3b` primary. **Fallback order: qwen2.5:1.5b, not
gemma2:2b** — gemma2 hallucinates deadlines on terse input and emits placeholder junk, plus
its 8k max context is tight. Offer 1.5b as a "fast mode" toggle for low-RAM machines.

## 10. Recommended options (measured)

| Option        | Extraction | Re-enrich | Briefing | Why |
|---------------|-----------|-----------|----------|-----|
| `temperature` | 0.15 (0 on retry) | 0.15 | 0.3 | 0.15 = stable tokens; 0.3 reads naturally |
| `num_ctx`     | **8192**  | 8192      | 8192     | See truncation note below |
| `num_predict` | 800       | 500       | 160      | Caps worst-case latency |
| `keep_alive`  | `"30m"`   | `"30m"`   | `"30m"`  | Warm saves ~2.5 s/call (4.7→2.2 s) |
| HTTP timeout  | 30 s      | 30 s      | 15 s     | Then hard-failure path |

**Truncation (measured, critical):** Ollama 0.30's default context is **2048** and when the
request exceeds `num_ctx` it silently keeps only the trailing ~`num_ctx/2` tokens
(prompt_eval_count observed: 2050 default, 1026 @2048, 4098 @8192 for a 10k-token paste) —
the system prompt itself gets eaten and output degrades to garbage with invalid deadline
strings. Therefore: set `num_ctx: 8192` on every call AND cap the paste in app code at
**8,000 chars (~2k tokens)**: keep first 6,000 + last 2,000 chars with a `[... trimmed ...]`
marker (asks cluster at the edges of threads). 8192 ctx keeps qwen2.5:3b VRAM/RAM modest
(~2.5 GB) — do not raise it "just in case" on an office laptop; gemma2:2b hard-caps at 8192.

## 11. Known limits (accepted, documented for UI design)

- Priority on hedged side-asks wobbles between `low`/`medium`/`optional` run-to-run. Both
  render in the "Later / Optional" view, and priority is a one-click manual edit. Not worth
  more prompt weight at 3B.
- `weekday` vs `next-weekday` tokens can both appear for "Wednesday next week" when today is
  late-week; they resolve to the same date whenever the phrase is unambiguous. When today is
  early-week they differ — the UI shows the resolved date on the card so the user can catch it.
- Clarifying questions are under-asked rather than over-asked (0 questions on all four test
  messages). That matches the product bias (gentle, not naggy); the "add a question" affordance
  in the open-loops panel covers the gap.
- Re-enrichment may drop one secondary detail from a multi-part answer (~1 in 3 runs); the raw
  Q&A history on the card is the safety net.
- 60-word briefing budget overruns ~15% on busy days; clamp in CSS, not in code.
