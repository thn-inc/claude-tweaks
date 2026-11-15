# Queue pull prints one fetch failure twice (claim fetch AUTO line, foreign-states Warning) (#5304) Implementation Plan

**Goal:** One failed claim fetch, and one missing or malformed `DISPATCH_FOREIGN_STATES` file, each print exactly one line per queue pull, in both the queue-pull module and the retained fence script.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5304/work/5304-spec.md` (materialized from GitHub issue #5304)

---

### Task 1: Print each fetch failure once per pull (F-claim AUTO line, files foreign-states Warning)

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `plugin/skills/dispatch/queue-pull-script.md` — the retained fence (#5231 has not removed it); the record's Current State requires fixing both and keeping the parity row. Size headroom: the file is 52,104 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`); keep it at or under 52,500 by trimming fence prose (comments, never behavior) to offset any bytes the fix adds.
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` — only if its foreign-lookup Warning-count wording no longer matches
- Test: `tests/bin-lib/dispatch/queue-pull.test.js`

- [ ] **Step 1: Failing test** — flip the `F-claim` row of `FAULT_EXPECT` and the `files-foreignStates-missing`/`files-foreignStates-malformed` rows of `FILES_EXPECT` so each failure's line is expected exactly once (assert the count, not just presence): `F-claim` expects one combined AUTO line naming #9010, #9016 and #7001 with both consequences (spec's Plan Review Clarifications, Reading A); the files foreign-states rows expect only the `ignored (...)` Warning. Add a D1-style assertion that a second pull in the same session (one session id, one TMPDIR — queue-pull.test.js D1) still prints its own combined line, so "once per pull" never degrades to "once per session". Update the header comment that documents the duplicate lines — it is in `tests/bin-lib/dispatch/queue-pull.test.js` (lines 32-36), not in queue-pull.js — and check `plugin/skills/dispatch/queue-pull-notes.md`'s "one `Warning:` line" wording. Leave the gh-transport library test "Brief deviation, pinned to the library" (queue-pull.test.js ~901-909) unchanged. Run them before Step 2: they must go red on the current code.
- [ ] **Step 2: Implement** — in both the module and the fence: (a) read claims for the shipped pass and the neighbour pass through one shared claim reader and print one combined AUTO line per pull naming every unreadable claim and both consequences; (b) on the files transport, print the `ignored (...)` foreign-states Warning and not the CLI lookup's second Warning — in the dispatch layer only, `plugin/bin/lib/issues/cross-repo-states.js` unchanged. The fence runs the shipped and neighbour passes as separate `node` processes (queue-pull-script.md ~483 and ~604), so name the per-pull state carrier explicitly (e.g. the shipped pass's unreadable-claim list captured into a shell variable or env var handed to the neighbour process) — it must reset at the start of every pull and must not add a new session-tmp file unless the parity suite's SESSION_FILES comparison is updated to match. Keep script and module behavior byte-identical so the parity suite stays green.
- [ ] **Step 3: Run** `node --test tests/bin-lib/dispatch/queue-pull.test.js` — PASS; `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.
- [ ] **Step 4: Commit** — one commit, `Print one line per queue-pull fetch failure — claim fetch AUTO line, foreign-states Warning`, body `refs #5304`.

---

## Self-review

- **Spec coverage:** Deliverable (each fetch failure prints exactly one line per pull) → Step 2; AC 1 (F-claim AUTO line once) and AC 2 (foreign-states Warning once) → Step 1's flipped rows.
- **Placeholders:** none.
