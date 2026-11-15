# Queue pull prints one fetch failure twice (claim fetch AUTO line, foreign-states Warning) (#5304) Implementation Plan

**Goal:** One failed claim fetch, and one missing or malformed `DISPATCH_FOREIGN_STATES` file, each print exactly one line per queue pull, in both the queue-pull module and the retained fence script.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5304/work/5304-spec.md` (materialized from GitHub issue #5304)

---

### Task 1: Print each fetch failure once per pull (F-claim AUTO line, files foreign-states Warning)

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — the retained fence (#5231 has not removed it); the record's Current State requires fixing both and keeping the parity row. Size headroom: the file is 52,104 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`); keep it at or under 52,500 by trimming fence prose (comments, never behavior) to offset any bytes the fix adds.
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`

- [ ] **Step 1: Failing test** — flip the `F-claim` row of `FAULT_EXPECT` and the `files-foreignStates-missing`/`files-foreignStates-malformed` rows of `FILES_EXPECT` so each failure's line is expected exactly once (assert the count, not just presence), and update the module header comment that documents the duplicate lines. Run them before Step 2: they must go red on the current code.
- [ ] **Step 2: Implement** — in both the module and the fence, print the claim-read failure's AUTO line once per pull (not once per pass that consults the failed read), and the fail-closed foreign-states Warning once per pull. Keep script and module behavior byte-identical so the parity suite stays green.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js` — PASS; `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.
- [ ] **Step 4: Commit** — one commit, `Print one line per queue-pull fetch failure — claim fetch AUTO line, foreign-states Warning`, body `refs #5304`.

---

## Self-review

- **Spec coverage:** Deliverable (each fetch failure prints exactly one line per pull) → Step 2; AC 1 (F-claim AUTO line once) and AC 2 (foreign-states Warning once) → Step 1's flipped rows.
- **Placeholders:** none.
