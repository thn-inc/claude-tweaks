# Classify the agent-noun isolation refusal as a guard-refusal turn in the timing classifier (#4521) Implementation Plan

**Goal:** Make the timing turn classifier's `GUARD_REFUSAL_RE` (`plugin/bin/lib/timing/turn-class.js`) match the agent-noun worktree-isolation refusal ("This agent is isolated in the worktree ...") as well as the session one, deriving the noun alternation from the shared constants.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T100536-record-4521/work/4521-spec.md` (materialized from GitHub issue #4521)

---

### Task 1: Derive the guard-refusal noun alternation from the shared constants and test the agent-noun case

**Files:**
- Modify: `plugin/bin/lib/timing/turn-class.js`
- Test: `tests/bin-lib/timing/turn-class.test.js`
- Waived `plugin/bin/lib/hooks/harness-refusal.js`: source of SESSION_NOUN/AGENT_NOUN (read only)

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. Add a case to `tests/bin-lib/timing/turn-class.test.js`'s classification table (next to the existing `'worktree isolation refusal'` row) feeding an error tool result beginning "This agent is isolated in the worktree" and expecting `guard-refusal`. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can.
  Run: `node --test tests/bin-lib/timing/turn-class.test.js`
  Expected: FAIL (the new agent-noun case is classified by its tool, not `guard-refusal`)
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above: build `GUARD_REFUSAL_RE` so its isolation-refusal alternative is composed from `SESSION_NOUN`/`AGENT_NOUN` (and, where it fits, `ISOLATION_CLAUSE`) imported from `plugin/bin/lib/hooks/harness-refusal.js`, regex-escaped, rather than adding a second literal. Keep the other two alternatives (`PreToolUse:` hook error, `Permission to use ... has been denied`) and the module's no-cycle constraint (never require `transcript.js`).
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS. Also confirm the new test goes red when the `AGENT_NOUN` alternative is removed from the pattern (revert check), then restore.
  Run: `node --test tests/bin-lib/timing/turn-class.test.js`
  Expected: PASS
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4521`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above.
- **Placeholders:** none.
