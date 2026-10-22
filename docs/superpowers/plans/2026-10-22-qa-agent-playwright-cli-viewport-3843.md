# qa-agent: replace the old backend's `set viewport` call and stale backend prose with playwright-cli forms (#3843) Implementation Plan

**Goal:** `plugin/agents/qa-agent.md` carries three leftovers from the retired browser backend — a `set viewport` command the current CLI does not have, a sentence about the old backend's cross-platform viewport flag, and migration-relative "no longer" phrasing about screenshots — replace each with present-tense playwright-cli prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T164343-record-3843/work/3843-spec.md` (materialized from GitHub issue #3843)

---

### Task 1: Replace the stale backend prose in qa-agent.md with playwright-cli forms

**Files:**
- Modify: `plugin/agents/qa-agent.md`

- [ ] **Step 1: Failing test** — the Acceptance Criteria are grep checks; run them against the current file and confirm each currently fails (finds a hit):
  - `grep -n 'set viewport' plugin/agents/qa-agent.md` — expected now: one hit (line 236).
  - `grep -n 'no longer' plugin/agents/qa-agent.md` — expected now: one hit on the screenshot note (line 142).
  - `grep -n 'cross-platform' plugin/agents/qa-agent.md` — expected now: one hit (line 70).
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` item:
  1. Line 236 (legacy-format Setup step): replace "apply viewport via `set viewport` (the story's value if set, else the `1440x1600` default)" with the `resize <w> <h>` form, keeping the story-value-else-`1440x1600` default.
  2. Line 70 (Set viewport step d): delete the trailing sentence "The flag is cross-platform — no shell-specific env-var workarounds needed."
  3. Line 142 (screenshot note): restate "The report's screenshot column (see "Report" below) no longer visually marks which element a step acted on." as a present-tense fact without "no longer" (the screenshot column carries plain captures with no acted-on-element marking).
- [ ] **Step 3: Run** the Step 1 greps again — each returns no hit; `grep -n 'resize' plugin/agents/qa-agent.md` shows every viewport instruction uses the `resize <w> <h>` form (consistent with `plugin/skills/browse/playwright-cli-reference.md`'s Operation vocabulary row); then run the suites that read `qa-agent.md` (`node --test tests/stories-caption-expand-only.test.js tests/qa-prompts-step-origin.test.js tests/qa-report-writer-conformance.test.js`) — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3843`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (1-3) and every `## Acceptance Criteria` item (no `set viewport`; every viewport instruction uses `resize <w> <h>`; no `no longer` on screenshot/viewport lines; `npm test` passes — run centrally at Common Step 5) is covered by Task 1's Files/Steps above.
- **Placeholders:** none.
