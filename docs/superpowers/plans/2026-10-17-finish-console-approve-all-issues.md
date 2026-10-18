# finish-console Approve-all `issues` (#3394) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Review Console's Approve-all path (`wrap-up-engine.js finish-console --approve-all`) record the run's `issues` in `verify-expectations.json`, so `carrier-commit` resolves the record after pr-first teardown instead of reporting `skip`.

**Architecture:** `finish-console` gains an optional `issues` key in its stdin payload. It is validated by the existing `validateFields` (which already knows `issues`: an array of positive safe integers) and written through the existing `writeExpectations`, and only when the key is present. An absent key leaves any stored `issues` alone, because `mergeExpectations` writes `issues` only when `fields.issues` is provided. `review-console.md` step 11's Approve-all payload then carries `issues`, sourced the same way the non-Approve-all `--issues` call is.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T213246-record-3394/work/3394-spec.md`

## Global Constraints

- `issues` entries must be positive integers. Anything else is rejected with exit 1 and nothing written. This is AC2, enforced by `validateFields`'s `issues[i] must be a positive integer`.
- Every other `verify-expectations.json` field is preserved (AC1).
- The non-Approve-all `set-verify-expectations.js --issues {n}[,{m}]` form must stay named in `review-console.md` (`tests/verify-expectations-writer-conformance.test.js` pins it).
- Commit messages use `{Verb} {what} — {detail}` with `refs #3394`, never `closes`/`fixes`.

## Review Focus

- A payload with no `issues` key over an existing file that already has `issues: [N]`: the stored array must survive, not be clobbered to `[]`. Task 1 adds a test.
- `issues: []` (explicit empty): accepted, and writes `issues: []`. This matches `mergeExpectations`'s existing semantics, so no special case is needed.
- `issues` not an array (e.g. `"issues": 900`): exit 1 via `validateFields`'s `"issues" must be an array`. Covered by the same rejection path as AC2.
- Duplicate numbers `[900, 900]`: deduped by `mergeExpectations`. That is existing behavior, so no new test.
- An `issues` value that validation accepts must reach `carrier-commit` as resolved, not `skip`. That is AC3, and Task 1 runs a real `runVerify`.

---

### Task 1: `finish-console` accepts and writes `issues`

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js`. Touch the USAGE line (~66), the payload-shape comment above `validateFinishConsolePayload` (~541-545), `validateFinishConsolePayload` (~559) and `runFinishConsole` step 1 (~592-598).
- Test: `tests/bin-lib/wrap-up/finish-console-cli.test.js`

**Interfaces:**
- Produces: stdin payload key `issues?: number[]`. Validated via `validateFields({ memory, upstream, issues })` (key included only when `payload.issues !== undefined`) and written via `writeExpectations({ runDir, fields: { memory, upstream, ...(issues present ? { issues } : {}) } })`.

- [ ] **Step 1: Write the failing tests** (in `finish-console-cli.test.js`, next to the existing oversightExempt-preservation test)
  - `AC1.1: finish-console writes an issues array into verify-expectations.json, preserving every other field`: pre-write `{version:1, memory:[], upstream:[], oversightExempt:[42], deferred:['worktree']}`, then pipe `{"issues":[3394]}`. Expect exit 0, `issues` deep-equal to `[3394]`, `oversightExempt` `[42]` and `deferred` `['worktree']` unchanged.
  - `finish-console without an issues key leaves a stored issues array untouched`: pre-write `{version:1, memory:[], upstream:[], issues:[77]}`, then pipe `{}`. Expect `issues` deep-equal to `[77]`.
  - `AC2.1: finish-console rejects a non-integer issues entry before any write`: pipe `{"issues":[1,"2"]}`. Expect exit 1, stderr matching `/issues\[1\] must be a positive integer/`, and no `verify-expectations.json`.
  - `AC3.1: finish-console issues reach carrier-commit on a header-less run dir (never skip)`: run finish-console with `{"issues":[900]}` on a fresh run dir with no `work/`. Then `require('../../../plugin/bin/lib/wrap-up/engine-verify').runVerify({ runDir, base: 'main', deps: { git: fakeGit, gh: () => '' } })`. With `fakeGit = (args) => (args[0] === 'log' ? 'x\n\nFixes #900\n' : '')`, the `carrier-commit` row's `result` is `'pass'`. With `fakeGit = () => ''`, it is `'fail'` and `detail` matches `/900/`.

- [ ] **Step 2: Run to verify they fail**
  Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js`
  Expected: FAIL. The issues-written test gets `undefined`, and the rejection test gets exit 0 (`issues` is currently ignored). The carrier-commit test gets `'skip'`. The untouched-key test passes already, as a preservation guard.

- [ ] **Step 3: Implement** in `plugin/bin/wrap-up-engine.js`
  - Change `validateFinishConsolePayload` to pass `issues` into `validateFields` when `payload.issues !== undefined`, and update its error text to name `"issues"` as an optional array field.
  - Change `runFinishConsole` step 1 to forward `issues` the same way.
  - Add `"issues": [3394, ...]` to the payload-shape comment, and append `issues?` to the USAGE line: `(JSON {memory?,upstream?,issues?,ledger?} on stdin)`.

- [ ] **Step 4: Run to verify they pass**
  Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
  Expected: PASS (all).

- [ ] **Step 5: Commit**
  `git add plugin/bin/wrap-up-engine.js tests/bin-lib/wrap-up/finish-console-cli.test.js`
  `git commit -m "Accept issues in finish-console payload — Approve-all now records verify-expectations issues, refs #3394"`

---

### Task 2: Review Console step 11 Approve-all payload carries `issues`

**Files:**
- Modify: `plugin/skills/wrap-up/review-console.md:120` (step 11's Approve-all sentence only)
- Test: `tests/wrap-up-record-resolution-conformance.test.js` (the `Review Console step 11 always records issues from inputs.records (Ruling R3)` test)

**Interfaces:**
- Consumes: Task 1's `issues` payload key.

- [ ] **Step 1: Extend the conformance test.** Inside the existing step-11 test, also assert:
  - The Approve-all payload literal carries the key: `assert.match(step11, /Under Approve all: `printf '%s' '\{"memory":\[\.\.\.\],"upstream":\[\.\.\.\],"issues":\[\.\.\.\],"ledger":\[\.\.\.\]\}'/)`.
  - The Approve-all sentence names the shared sourcing rule. Take the text between `Under Approve all:` and `On any other resolution path` and assert it matches `/`issues` .*sourced exactly as/`. It must also match `/omitted when no record resolves/`.
  - The existing `--issues` sourcing assertion stays unchanged.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/wrap-up-record-resolution-conformance.test.js`
  Expected: FAIL on the new Approve-all payload assertion.

- [ ] **Step 3: Edit step 11's Approve-all sentence** (in place, nothing else in the paragraph changes)
  - Change the payload literal to `'{"memory":[...],"upstream":[...],"issues":[...],"ledger":[...]}'`.
  - After the command, add one clause: "— `issues` sourced exactly as the `--issues` call below sources it, the key omitted when no record resolves —".
  - Do not restate the `inputs.records`/Ruling R1 rule. The existing non-Approve-all sentence stays the single statement of it.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/wrap-up-record-resolution-conformance.test.js tests/verify-expectations-writer-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add plugin/skills/wrap-up/review-console.md tests/wrap-up-record-resolution-conformance.test.js`
  `git commit -m "Pass issues in Review Console Approve-all payload — step 11 no longer drops the record on finish-console, refs #3394"`

---

## Self-review

- **Spec coverage:** Task 1 covers Deliverable 1 and Task 2 covers Deliverable 2. Deliverable 3 is the tests in both tasks. AC1, AC2 and AC3 are Task 1's tests. AC4 is `npm test`, which runs centrally after Task 2.
- Waived AC4.1: `npm test` passing is verified centrally by `/build` Common Step 5 / `/test`, not by a task test.
- **Placeholders:** none.
- **Type consistency:** `issues` is `number[]` everywhere, matching `validateFields`/`mergeExpectations`.
