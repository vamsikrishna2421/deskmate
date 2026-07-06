---
name: token-budget-awareness
description: HARD CONSTRAINT — Vamsy is on a $200 Claude subscription with a 5-hour rolling limit; large agent fan-outs burned it once. Budget all multi-agent work.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 807ed764-822c-4241-a302-1caa1037b88f
---

On 2026-07-02 a review workflow spawned ~135 subagents (6 reviewers + 2 adversarial verifiers × 64 findings + fixer, ~1.7M tokens) and exhausted Vamsy's entire 5-hour usage limit ($200 Max plan, resets on a rolling window). He was blocked mid-day.

**Why:** "Ultracode"/exhaustiveness defaults do NOT override his real plan limits. He is fine with "good capacity" but the session must never be drained by one operation.

**How to apply:**
- Default to inline work and single background agents. Workflows only for genuinely parallel work, capped at ~6–10 agents TOTAL per workflow, no nested per-item fan-outs.
- NEVER spawn one agent per finding/item. Batch: one verifier/fixer handles a LIST of items.
- Before launching anything estimated >~300k subagent tokens, tell him the estimate and ask.
- Prefer `effort: 'low'` for mechanical subagent stages; reserve high effort for a few judgment-heavy agents.
- Triage/review passes: do them myself inline (read code directly) instead of agent panels, unless he explicitly asks for a big sweep.

Related: [[project-todo-intelligence]]
