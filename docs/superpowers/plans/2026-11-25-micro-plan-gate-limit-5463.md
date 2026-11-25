# Micro-plan gate limit 1 → 3 (#5463) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fast-lane, low-size record naming up to three implementation files in `### Key Files` passes `/build`'s micro-plan gate and composes a one-task plan instead of the full planning path.

**Architecture:** One constant change in `plugin/bin/lib/issues/micro-plan-gate.js` (`MAX_IMPLEMENTATION_FILES` 1 → 3) plus its header comment; the tests that pin the old limit move with it; `plugin/skills/build/micro-plan.md`'s title and opening sentence stop saying "one file", and `_shared/ceremony-profile.md`'s exemption row follows the new title phrase. `plan-lane.js` reads the gate through `evaluateMicroPlanGate`, so it needs no change.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T095255-record-5463/spec-5463/work/5463-spec.md`

## Global Constraints

- `MAX_IMPLEMENTATION_FILES` stays its own constant; never import `EXPRESS_MAX_KEY_FILES` (it counts every Key File, tests included).
- `countImplementationFiles`'s counting rule and the other three gate conditions are unchanged.
- `micro-plan.md` must not restate the limit as a number or phrase (`tests/build-micro-plan-code-twin.test.js`'s BANNED list); conditions 3 and 4 keep citing the code.
- Commit messages: `{Verb} {what} — {detail}`, `refs #5463`, never `closes`/`fixes`.

## Review Focus

- Exactly 3 implementation files passes and exactly 4 fails (the boundary) — Task 1 tests both.
- Test files and read-only entries mixed with 3 implementation files still pass (they are not counted) — Task 1's three-pass case includes a test entry.
- The #5396 shape (a static config file plus the generator module that writes it) passes — Task 1 pins it.
- `plan-lane.js` follows the new limit with no code change — Task 1's plan-lane cases (3 → micro-plan, 4 → outside-every-lane).
- Every changed or added assertion goes red with the constant reverted to 1 — Task 1 Step 5.

---

### Task 1: Raise the gate limit and move its pinning tests

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/micro-plan-gate.js` (constant line `const MAX_IMPLEMENTATION_FILES = 1;` and header comment line 23)
- Test: `tests/bin-lib/issues/micro-plan-gate.test.js`
- Test: `tests/bin-lib/driver/plan-lane.test.js`
- Waived `plugin/bin/lib/driver/plan-lane.js`: read only, no change

**Interfaces:**
- Consumes: `evaluateMicroPlanGate({ ceremony, size, keyFileEntries, body }) -> { passes, failed, unreadable }`, test helpers `entry(path, note)`, `keyFiles(...entries)`, `PASSING()` (micro-plan-gate.test.js); `verdictFor({ labels, keyFiles, opts, pol })`, `backendFiles(n)`, `policy({...})`, `EXPRESS_LABELS` (plan-lane.test.js).
- Produces: `MAX_IMPLEMENTATION_FILES === 3`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/micro-plan-gate.test.js`:
- Rename the frozen-conditions test to `'MICRO_PLAN_CONDITIONS is frozen and MAX_IMPLEMENTATION_FILES is 3'` and assert `MAX_IMPLEMENTATION_FILES === 3`.
- Add `'evaluateMicroPlanGate passes three implementation entries'`: keyFileEntries `plugin/bin/x.js`, `plugin/bin/y.js`, `plugin/skills/z/SKILL.md`, `tests/x.test.js` → `{ passes: true, failed: [], unreadable: null }`.
- Change the two-entry failure case to `'evaluateMicroPlanGate fails implementation-file-limit for four implementation entries'` (`plugin/bin/w.js`, `x.js`, `y.js`, `z.js`) → `{ passes: false, failed: ['implementation-file-limit'], unreadable: null }`.
- Add `'evaluateMicroPlanGate passes the #5396 shape: a static config file plus its generator'`: `config/app.plist — add one key` and `plugin/bin/gen-plist.js — write the key` → passes.
- In `'failed lists every failing condition in MICRO_PLAN_CONDITIONS order'`, use four implementation entries so `implementation-file-limit` still fails.

In `tests/bin-lib/driver/plan-lane.test.js`:
- Replace `'AC2.1: two implementation Key Files fail the micro-plan gate'` with `'AC2.1: three implementation Key Files read micro-plan'` (`backendFiles(3)` → `{ lane: 'micro-plan', reason: 'passes-micro-plan-gate' }`) and `'AC2.1: four implementation Key Files fail the micro-plan gate'` (`backendFiles(4)` → `{ lane: null, reason: 'outside-every-lane' }`), both with `policy({ 'express-lane': false, 'express-driver': 'off' })`. Check `backendFiles(n)` yields `n` implementation paths (and no test entries counted) before relying on it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js`
Expected: FAIL — the constant assertion, the three-pass case, the #5396 case and the three-file plan-lane case.

- [ ] **Step 3: Implement**

Set `MAX_IMPLEMENTATION_FILES = 3`. In the header comment, replace `the gate is "at most one", not "exactly one".` with a sentence naming the constant (e.g. `the gate is "at most MAX_IMPLEMENTATION_FILES", not "exactly that many".`), and add one sentence: the express lane builds up to `EXPRESS_MAX_KEY_FILES` Key Files with no plan at all, and the micro-plan path keeps the task review and the review lenses, so it needs no stricter bound; it stays a separate constant because the express lane counts every Key File while this gate counts implementation files only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Revert proof**

Temporarily set the constant back to 1, run the Step 4 command, and quote the failing test names (every changed or added assertion must be red: the constant assertion, three-pass, #5396 shape, plan-lane three-file). Restore 3 and re-run to green.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/micro-plan-gate.js tests/bin-lib/issues/micro-plan-gate.test.js tests/bin-lib/driver/plan-lane.test.js
git commit -m "Raise the micro-plan gate limit to three implementation files — refs #5463"
```

### Task 2: Reword micro-plan.md and the roster exemption row

**Role:** transcription

**Files:**
- Modify: `plugin/skills/build/micro-plan.md` (line 1 title, lines 3-4 opening sentence, line 83 `one-task, one-file plan`)
- Modify: `plugin/skills/_shared/ceremony-profile.md` (line 70 exemption row)

**Interfaces:**
- Consumes: Task 1's `MAX_IMPLEMENTATION_FILES` (cited by name only).
- Produces: new title phrase `small fast-lane records skip`.

- [ ] **Step 1: Edit the prose**

- Title: `# Micro-Plan — small fast-lane records skip \`/superpowers:writing-plans\` (#1911)`.
- Opening sentence: `A one-task record whose implementation files fit the gate below has no cross-task structure for a full plan to capture — …` (rest of the sentence unchanged).
- Line 83: `one-task, one-file plan` → `one-task plan`.
- `ceremony-profile.md` line 70: the quoted phrase becomes `` `small fast-lane records skip` ``.

No number or "one/single implementation file" phrasing anywhere in `micro-plan.md`.

- [ ] **Step 2: Run the pinning tests**

Run: `node --test tests/build-micro-plan-code-twin.test.js tests/ceremony-profile-roster.test.js tests/build-micro-plan-conformance.test.js`
Expected: PASS, 0 failures. Then `grep -n -i -e "one-file" -e "single-file" plugin/skills/build/micro-plan.md` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/build/micro-plan.md plugin/skills/_shared/ceremony-profile.md
git commit -m "Reword micro-plan.md so the gate no longer reads as single-file — refs #5463"
```

---

## Self-review

- Spec coverage: Deliverable 1 → Task 1 Step 3; Deliverable 2 → Task 2; Deliverable 3 → Task 2; Deliverable 4 → Task 1 Step 1. AC1-AC3 → Task 1 tests; AC4 → Task 2 Step 2; AC5 → Task 1 Step 5; AC6 (`npm test -- --full`) → `/build` Common Step 5 / `/test`.
- Placeholders: none.
