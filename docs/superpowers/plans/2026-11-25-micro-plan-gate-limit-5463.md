# Micro-plan gate implementation-file limit 1 → 3 (#5463) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `/build`'s micro-plan gate limit so a fast-lane, low-size record with up to three implementation Key Files builds from a one-task plan instead of the full planning path.

**Architecture:** One constant change in `plugin/bin/lib/issues/micro-plan-gate.js` (`MAX_IMPLEMENTATION_FILES` 1 → 3) plus its header comment; `plan-lane.js` reads the gate through `evaluateMicroPlanGate`, so it follows with no change. Prose in `build/micro-plan.md` and the `_shared/ceremony-profile.md` exemption row that quotes its title stop saying "single-file"/"one-file". Tests pinning the old limit move.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T091622-record-5463/spec-5463/work/5463-spec.md`

## Global Constraints

- `MAX_IMPLEMENTATION_FILES` stays its own constant in `micro-plan-gate.js` — never import `EXPRESS_MAX_KEY_FILES` (that bound counts every Key File, tests included).
- `countImplementationFiles`'s counting rule and the other three gate conditions are unchanged.
- `plugin/bin/lib/driver/plan-lane.js` is read only — no change.
- `plugin/skills/build/micro-plan.md` must not restate the limit as a number or word (`tests/build-micro-plan-code-twin.test.js`'s BANNED patterns: "at most one/1/a single implementation file", "two or more implementation files", "a single implementation file", "<= 1 implementation").
- The composed micro-plan stays one task.
- Commit messages: `{Verb} {what} — {detail}`, `refs #5463`, ending with the `Claude-Session:` trailer the session supplies.

## Review Focus

1. Exactly-at-limit boundary: three implementation files pass, four fail — off-by-one in `<=` would flip one of them (Task 1 tests both).
2. Tests and read-only entries still excluded at the new limit: three implementation files plus test files plus a read-only entry still pass (Task 1 adds this case).
3. The #5396 shape — a non-JS config file (`*.plist`) plus the generator module — counts 2 and passes (Task 1).
4. `needsNoPlan` follows the gate at both sides of the new boundary with express lanes off (Task 1, plan-lane test).
5. Prose drift: a remaining "one-file"/"single-file" phrase in `micro-plan.md` or a design-doc table still claiming "at most one implementation file" would misdescribe the gate (Task 2 sweeps them).

---

### Task 1: Raise the gate limit and move the pinning tests

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/micro-plan-gate.js` (line 42 constant; header comment lines 8-23)
- Test: `tests/bin-lib/issues/micro-plan-gate.test.js`
- Test: `tests/bin-lib/driver/plan-lane.test.js`
- Waived `plugin/bin/lib/driver/plan-lane.js`: read only, no change
- Waived `build/dispatch.md`: named in the spec Gotchas only as a ruled-out fencing lever, no change

**Interfaces:**
- Produces: `MAX_IMPLEMENTATION_FILES === 3` exported from `micro-plan-gate.js` (export list unchanged).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/micro-plan-gate.test.js`:
- Rename the test `'MICRO_PLAN_CONDITIONS is frozen and MAX_IMPLEMENTATION_FILES is 1'` → `... is 3 (#5463 AC1.1)`, asserting `assert.strictEqual(MAX_IMPLEMENTATION_FILES, 3)`.
- Add `test('evaluateMicroPlanGate passes three implementation entries (#5463 AC1.2)')`: `keyFiles(entry('plugin/bin/x.js'), entry('plugin/bin/y.js'), entry('plugin/skills/build/a.md'))` → `deepStrictEqual(r, { passes: true, failed: [], unreadable: null })`.
- Replace `'evaluateMicroPlanGate fails implementation-file-limit for two implementation entries'` with `'... for four implementation entries (#5463 AC1.3)'`: four entries (`plugin/bin/x.js`, `plugin/bin/y.js`, `plugin/bin/z.js`, `plugin/skills/build/a.md`) → `{ passes: false, failed: ['implementation-file-limit'], unreadable: null }`.
- Add `test('three implementation entries plus tests and a read-only entry still pass')`: the three above plus `entry('tests/x.test.js')` and `entry('plugin/bin/w.js', '(read only, no change)')` → `passes: true`.
- Add `test('#5463 AC3.1: the #5396 shape passes: a static config file plus the generator that writes it')`: `keyFiles(entry('app/Info.plist', '— add one key'), entry('plugin/bin/gen-plist.js', '— write the key'))` → `{ passes: true, failed: [], unreadable: null }`, and `countImplementationFiles` of those entries is `2`.

In `tests/bin-lib/driver/plan-lane.test.js`:
- Replace `'AC2.1: two implementation Key Files fail the micro-plan gate'` with two tests using `pol: policy({ 'express-lane': false, 'express-driver': 'off' })` and `labels: EXPRESS_LABELS`:
  - `'AC2.1: three implementation Key Files pass the micro-plan gate (#5463 AC2.1)'` — `keyFiles: backendFiles(3)` → `{ lane: 'micro-plan', reason: 'passes-micro-plan-gate' }`.
  - `'AC2.1: four implementation Key Files fail the micro-plan gate (#5463 AC2.1)'` — `keyFiles: backendFiles(4)` → `{ lane: null, reason: 'outside-every-lane' }`.

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js`
Expected: FAIL — the `is 3`, three-entry pass, three-plus-tests pass, #5396 shape and plan-lane three-files cases fail (limit is still 1); the four-entry/four-files cases pass already.

- [ ] **Step 3: Implement**

In `micro-plan-gate.js`: set `const MAX_IMPLEMENTATION_FILES = 3;`. In the header comment, replace `the gate is "at most one", not "exactly one".` with a sentence naming the constant (e.g. `the gate is "at most MAX_IMPLEMENTATION_FILES", not "exactly"`), and add one sentence of reason: the express lane already builds up to `EXPRESS_MAX_KEY_FILES` Key Files with no plan at all, and the micro-plan path keeps the SDD task review and `/claude-tweaks:review`'s lenses, so it needs no stricter bound; it stays a separate constant because the express bound counts every Key File, tests included, while this gate counts implementation files only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js tests/build-micro-plan-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the tests against a reverted limit (#5463 AC5.1)**

Temporarily set `MAX_IMPLEMENTATION_FILES = 1`, run `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js`, and quote the failing test names: the `is 3`, three-entry, three-plus-tests, #5396-shape and plan-lane three-files tests must each fail. Restore `3` and re-run Step 4's command (PASS). The temporary edit is never committed.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/micro-plan-gate.js tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js
git commit -m "Raise the micro-plan gate's implementation-file limit to 3 — the express lane builds that many with no plan, refs #5463"
```

### Task 2: Reword the micro-plan prose and the roster exemption that quotes it

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/micro-plan.md` (line 1 title, lines 3-6 opening sentence, line 83 "one-task, one-file plan")
- Modify: `plugin/skills/_shared/ceremony-profile.md` (line 68 exemption row)
- Modify: `docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` (lines 484 and 522 table cells)
- Test: `tests/build-micro-plan-code-twin.test.js`, `tests/ceremony-profile-roster.test.js` (run only, no change)

Byte headroom: `micro-plan.md` is 8,125 B and `ceremony-profile.md` 12,776 B at base against `RAIL_BYTES` 52,500 B; both edits are net-neutral wording swaps.

**Interfaces:**
- Consumes: Task 1's `MAX_IMPLEMENTATION_FILES` (cited by name, never by number).

- [ ] **Step 1: Edit `micro-plan.md`**

- Title → `# Micro-Plan — small fast-lane records skip \`/superpowers:writing-plans\` (#1911)`.
- Opening sentence: replace "A one-file, one-task record has no cross-task structure…" with "A one-task record whose `### Key Files` stays within the gate's implementation-file limit has no cross-task structure…" (rest of the paragraph unchanged).
- Line 83: "A one-task, one-file plan has nothing…" → "A one-task plan has nothing…".
- No number or number-word for the limit anywhere in the file.

- [ ] **Step 2: Edit the roster row**

`ceremony-profile.md` line 68: the `contains` cell `single-file fast-lane records skip` → `small fast-lane records skip` (description cell unchanged).

- [ ] **Step 3: Edit the design-doc table cells**

`2026-11-17-standard-lane-run-graph-design.md`: line 484's "`### Key Files` names at most one implementation file" → "`### Key Files` names at most `MAX_IMPLEMENTATION_FILES` implementation files (`micro-plan-gate.js`)"; line 522's "at most one implementation Key File" → "at most `MAX_IMPLEMENTATION_FILES` implementation Key Files".

- [ ] **Step 4: Run the prose tests**

Run (#5463 AC4.2): `node --test tests/build-micro-plan-code-twin.test.js tests/ceremony-profile-roster.test.js tests/build-micro-plan-conformance.test.js`
Expected: PASS, 0 failures.

Then (#5463 AC4.1) `git grep -n -i -E "single-file fast-lane|one-file, one-task|one-task, one-file" -- plugin docs/superpowers/specs` prints nothing. Control, run at plan time against base `b3ed4140f3` (`git grep ... b3ed4140f3 -- plugin docs/superpowers/specs`): matched `ceremony-profile.md:68`, `micro-plan.md:1`, `micro-plan.md:3`, `micro-plan.md:83`. Scoped to named paths outside `.claude-tweaks/` and `docs/superpowers/plans`, so no #4579 exclusion is needed.

And `git grep -n "at most one implementation" -- docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md` prints only lines 264 and 489. Control against base matched 264, 484, 489, 522; 264 and 489 describe `resolve-profile.js --diff-facts`'s whole-branch-review diff ceiling (a different mechanism, `computeDiffFacts` on the diff) and are classified no-change.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/micro-plan.md plugin/skills/_shared/ceremony-profile.md docs/superpowers/specs/2026-11-17-standard-lane-run-graph-design.md
git commit -m "Reword micro-plan prose off the one-file limit — title, opening sentence, roster exemption and design-doc table, refs #5463"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (constant + header) → Task 1 Step 3; Deliverable 2 (title + opening sentence) → Task 2 Step 1; Deliverable 3 (roster row) → Task 2 Step 2; Deliverable 4 (pinning tests) → Task 1 Step 1. AC1 (3 pass / 4 fail) → Task 1 tests; AC2 (`needsNoPlan`) → plan-lane tests; AC3 (#5396 shape) → Task 1; AC4 (prose + twin/roster tests) → Task 2 Step 4; AC5 (revert proof) → Task 1 Step 5; AC6 (`npm test -- --full`) → `/claude-tweaks:build` Common Step 5 / `/claude-tweaks:test`.
- Waived AC6.1: the whole suite is run by `/claude-tweaks:build` Common Step 5 and `/claude-tweaks:test` through `verify.js`, not by a task step.
- **Placeholders:** none.
