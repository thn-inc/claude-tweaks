# candidates-experiment-cleanup.js require order (circular-require hazard) (#3330) Implementation Plan

**Goal:** `plugin/bin/lib/code-health/candidates-experiment-cleanup.js` requires `./candidates-dead-code` before `./focus-generators`, emitting four "inside circular dependency" warnings on a fresh load; swap the two require lines to match `candidates-prelaunch.js` / `candidates-abstraction-police.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T200218-record-2977/spec-3330/work/3330-spec.md` (materialized from GitHub issue #3330)

---

### Task 1: Swap the require order and pin it with a fresh-process test

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-experiment-cleanup.js`
- Test: `tests/bin-lib/code-health/candidates-experiment-cleanup.test.js`
- Modify (comment only): `tests/bin-lib/code-health/candidates-require-order.test.js` — its header comment states "candidates-experiment-cleanup.js has the same reversed order today (a separate, pre-existing hazard filed as its own follow-up, not fixed here)", which this task makes false; reword that clause to say the hazard was fixed separately in #3330 (comment text only, no assertion change).

- [ ] **Step 1: Failing test** — append to `tests/bin-lib/code-health/candidates-experiment-cleanup.test.js` (using its existing `node:test` / `node:assert/strict` imports; add `spawnSync` to the existing `node:child_process` import) one test, `candidates-experiment-cleanup.js loads in a fresh process with no circular-dependency warning`, shaped exactly like the first test in `tests/bin-lib/code-health/candidates-require-order.test.js`: `spawnSync(process.execPath, ['-e', \`require(${JSON.stringify(MODULE_PATH)})\`], { encoding: 'utf8' })`, assert `status === 0` and that stderr does not match `/inside circular dependency/i`. A fresh child process is required — an in-process `require` hits the module cache and never emits the warning (spec Gotchas). Run `node --test tests/bin-lib/code-health/candidates-experiment-cleanup.test.js` — the new test FAILS on the current order (record the RED output).
- [ ] **Step 2: Implement** — in `candidates-experiment-cleanup.js`, move `const { registerGenerator } = require('./focus-generators');` above `const { listTrackedSourceFiles } = require('./candidates-dead-code');`. No other change to the module. Update the stale clause in `candidates-require-order.test.js`'s header comment.
- [ ] **Step 3: Run** — `node -e "require('./plugin/bin/lib/code-health/candidates-experiment-cleanup')"` prints no circular-dependency warning; `node --test tests/bin-lib/code-health/` passes (the new test now PASSES).
- [ ] **Step 4: Commit** — one commit, `Require focus-generators before candidates-dead-code in experiment-cleanup vertical — refs #3330`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (swap) → Step 2. Deliverable 2 (fresh-process regression test, proven red before the swap) → Steps 1 + 3. AC1 (`node -e` prints no warning) → Step 3. AC2 (fails pre-swap, passes after) → Steps 1 and 3. AC3 (`node --test tests/bin-lib/code-health/` passes) → Step 3. The require-order test comment update keeps a now-false repo statement from outliving the fix.
- **Placeholders:** none.
