# Doc staleness: docs/reference/claude-quality-levers.md — Reasoning-effort defaults (#3126) Implementation Plan

**Goal:** Time-scope the "Current defaults are `xhigh` for Opus 4.7 and `high` for other models" sentence to the April 2026 postmortem it summarizes, since newer model generations have since shipped and this doc's own thesis is that these defaults change without warning.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T183021-record-3126/work/3126-spec.md` (materialized from GitHub issue #3126)

---

### Task 1: Time-scope the reasoning-effort defaults sentence

**Files:**
- Modify: `docs/reference/claude-quality-levers.md`

- [ ] **Step 1: Verify current text** — confirm the sentence at line 17-18 still reads "Current defaults are `xhigh` for Opus 4.7 and `high` for other models."
- [ ] **Step 2: Implement** — replace the sentence with the spec's `## Deliverables` Proposed text: "As of that postmortem's publication (April 2026), defaults were `xhigh` for Opus 4.7 and `high` for other models -- check the current platform defaults before relying on this, since newer model generations have since shipped and reasoning-effort defaults are exactly the kind of thing this doc warns can silently change."
- [ ] **Step 3: Run** `grep -n "Current defaults are" docs/reference/claude-quality-levers.md` — expect no match (confirms replacement landed).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3126`.

---

## Self-review

- **Spec coverage:** the single `## Deliverables` replacement and the `## Acceptance Criteria` time-scoping requirement are both covered by Task 1's Files/Steps above.
- **Placeholders:** none.
