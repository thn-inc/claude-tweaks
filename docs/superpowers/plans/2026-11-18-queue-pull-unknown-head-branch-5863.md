# Queue pull: unresolvable origin HEAD branch skips target-missing (#5863) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resolved integration branch that does not name a resolvable `origin/` ref — `HEAD branch: (unknown)` included — is treated exactly like the empty branch #5305 already handles: the target-missing pass is skipped with its one Warning, nothing is excluded as `target-missing`, no Close proposal is staged.

**Architecture:** After the branch is resolved (policy key, else `git remote show origin`), probe `origin/{branch}` once with `git rev-parse --verify --quiet origin/{branch}^{commit}`. A failed probe clears the branch to `''` (and so the ref), so every later reader — the target-missing pass and the unlanded-blocker pass that takes `--integration-branch` — sees the empty-branch state #5305 already handles. The module and the fence (`plugin/skills/dispatch/queue-pull-script.md`) change identically.

**Tech Stack:** Node (CommonJS), bash fence, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-18T072534-spec-5879-5863-5865-5830/spec-5863/work/5863-spec.md`

Scope keywords: remoteHeadBranch, TARGET_MISSING_SKIPPED, INTEGRATION_REF

## Global Constraints

- `plugin/skills/dispatch/queue-pull-script.md` is 52,499 bytes against the 52,500-byte Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). After Task 2 it must still be at or under 52,500 bytes (`wc -c`), with the `rail:` tests green. Make room by cutting bytes from comments or prose in the same file (never an executed line, never a string a test reads from the fence via `fenceText`), or by moving a lazy prose section into `plugin/skills/dispatch/queue-pull-notes.md` with a pointer. Keep the fence's line count from line 376 down unchanged where possible: the module cites fence line numbers in comments (`Fence 376-459`, `fence 382`, `fence 394-395`); if a line count changes, update every such citation in `plugin/bin/lib/dispatch/queue-pull.js`.
- The skip Warning text stays byte-identical: `Warning: target-missing pass skipped — no integration branch resolved` (module constant `TARGET_MISSING_SKIPPED`, fence line 395). The test helpers read it from the fence.
- Scope: Touch only what the task requires. Do not change the policy-key path's behaviour beyond the probe.

## Review Focus

1. A policy `integration-branch` naming a branch origin does not have (typo, deleted branch) — expected: the same skip-with-Warning path (the probe applies to both sources). Pinned in Task 1.
2. A valid remote HEAD (`trunk`, `release/next`) — expected: unchanged exclusions; the probe adds exactly one git call before the `cat-file` probes. Pinned by updating the existing #5227 portability argv assertions in Task 1.
3. The unlanded-blocker pass after an unresolvable branch — expected: its existing `no integration branch resolved` skip Warning, as for the empty branch (it reads the cleared `state.integrationBranch`). Pinned by the Task 2 parity row's expectation (same stderr as `F-intbranch`).
4. An empty branch (failed `git remote show origin`) — expected: unchanged from #5305; the module runs no probe for an empty branch (the existing test asserts no `cat-file`; keep the probe off too).
5. A branch name with shell-significant characters — the module passes argv (no shell); the fence quotes `"$INTEGRATION_REF^{commit}"`.

---

### Task 1: Module probe + in-process test

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`runTargetMissing`, ~line 1018; `remoteHeadBranch` neighbour)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`fakeRun`, ~line 165: answer the new probe)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (beside the `#5227 portability` tests, ~line 1983-2022)

**Interfaces:**
- Produces: git argv `['rev-parse', '--verify', '--quiet', 'origin/{branch}^{commit}']`, run once per pull only when the resolved branch is non-empty, before any `cat-file` probe. On a throw, `state.integrationBranch` and `state.integrationRef` are both `''`.

- [ ] **Step 1: Write the failing test (AC1.1)** — first teach `fakeRun` the probe: for git sub-argv `rev-parse --verify --quiet {ref}^{commit}`, return `'{40-hex}\n'` when `originBranchFiles(scenario, ref-without-origin/)` is truthy, else throw `fakeFailure(args, { status: 1, stdout: '', stderr: '' })` (`gitFail` already applies first). Then the test `#5863: an origin HEAD branch of (unknown) skips the target-missing pass with the Warning, excludes nothing as target-missing and stages no Close proposal`, modelled on the `#5227 … failing git remote show origin` test at ~2008:
  - `pull4({ ...FULL(), headBranch: '(unknown)' }, { run: <argv recorder over fakeRun> })`
  - `assert.equal(r.state.integrationBranch, '')`, `assert.equal(r.state.integrationRef, '')`
  - `assert.deepEqual(entriesOf(r, 'target-missing'), [])`
  - `assert.ok(r.errs.includes(`${TARGET_MISSING_SKIPPED}\n`))`
  - `assert.ok(!r.cap.staged.some((s) => s.id.startsWith('dispatch-target-missing-')))`
  - `assert.ok(!gitArgvs.some((a) => a[0] === 'cat-file'))`
  - Second case in the same test: policy `'integration-branch': 'no-such-branch'` → same four outcomes.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "#5863" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL after Step 1 (`integrationBranch` is `'(unknown)'`; target-missing entries are non-empty).

- [ ] **Step 3: Implement** in `runTargetMissing`: after `if (!branch) branch = remoteHeadBranch(ctx);`, when `branch` is non-empty run the probe via `ctx.deps.run('git', argv, runOpts(ctx, { stdio: 'pipe' }))` in a try/catch; on a throw set `branch = ''`. Update the `#5305` comment above `const ref` to say "an empty or unresolvable branch". Name the probe helper `originRefResolves(ctx, ref)` returning a boolean.

- [ ] **Step 4: Update the existing argv assertions** the new call changes: the `#5227 portability` test's `gitArgvs` (insert `['rev-parse', '--verify', '--quiet', 'origin/trunk^{commit}']` after `['remote', 'show', 'origin']`) and `policyGit` (prepend `'rev-parse --verify --quiet origin/release/next^{commit}'`). Any other test pinning a git argv sequence that now fails: same treatment, never loosening the assertion.

- [ ] **Step 5: Run the test suite and verify the revert goes red (AC1.1, AC2.1)**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS, 0 failures. Then revert only the Step 3 code change in `queue-pull.js`, re-run the `#5863` test, see it FAIL, and restore it (AC2.1). Quote both raw outputs in the report.

- [ ] **Step 6: Commit** — `Skip the target-missing pass on an unresolvable origin HEAD branch — module (refs #5863)`.

### Task 2: Fence probe + parity row

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (lines 380-384 and byte trim; see Global Constraints)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`FAULTS`, beside `F-intbranch` ~line 693)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`seedOrigin` ~line 253: a way to leave origin's HEAD dangling)
- Modify: `tests/bin-lib/dispatch/queue-pull-helpers.js` (`FAULT_EXPECT`, beside `'F-intbranch'` ~line 319)
- Test: `tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js` (the AC4.1 detail test, beside the `F-intbranch` loop ~line 64)
- Modify: `docs/reference/gh-issue-write-inventory.md` — only if the fence's line count changes: shift the `queue-pull-script.md` line numbers its `### plugin/skills/dispatch/queue-pull-script.md` table and line 76 cite past fence line 384 by the same delta (Check B scope-keyword hit on `INTEGRATION_REF`)

**Interfaces:**
- Consumes: Task 1's clear-on-failed-probe behaviour (the module side of the parity pair).

- [ ] **Step 1: Add the parity row** `F-headunknown` (pass `target-missing`): the `F-intbranch` scenario (with the `#9017`/`docs/present.md` record) but instead of `gitFail`, a scenario flag (e.g. `danglingHead: true`) that makes `seedOrigin` point origin's `HEAD` at a branch that does not exist (`git symbolic-ref HEAD refs/heads/{absent}`), so a real `git remote show origin` prints `HEAD branch: (unknown)` — verify that with one manual run before relying on it. Its `FAULT_EXPECT` row: same `status`, `stderr`, `stdout`, `drops` and `adds` as `F-intbranch`. In the AC4.1 detail test, add a loop over `sides(R['F-headunknown'])` asserting no `target-missing` exclusion, no `dispatch-target-missing-*` staged proposal, and no `cat-file` git argv.

- [ ] **Step 2: Run it to verify it fails (oracle side)**

Run: `node --test tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js`
Expected: FAIL after Step 1 on `F-headunknown` — the fence still probes `origin/(unknown)` and excludes the named targets.

- [ ] **Step 3: Implement in the fence** — immediately after line 384 (`INTEGRATION_REF=...`), the mirror of Task 1:
  `git rev-parse -q --verify "$INTEGRATION_REF^{commit}" >/dev/null 2>&1 || INTEGRATION_BRANCH= INTEGRATION_REF=`
  (an empty ref fails the probe too, which leaves the empty case unchanged). Then trim bytes per Global Constraints until `wc -c` ≤ 52500.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS. Then the rail suite: `node --test tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js` — Expected: PASS; and `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.

- [ ] **Step 5: Commit** — `Skip the target-missing pass on an unresolvable origin HEAD branch — fence and parity row (refs #5863)`.

---

## Self-review

- Spec coverage: Deliverable 1 (module + fence) → Task 1 Step 4, Task 2 Step 3. Deliverable 2 (in-process test + parity row) → Task 1 Step 2, Task 2 Step 1. AC 1 → Task 1 Step 2 assertions. AC 2 → Task 1 Step 6 revert check.
- Placeholders: none.
