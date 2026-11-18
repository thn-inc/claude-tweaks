# Queue pull: unresolvable origin HEAD branch skips target-missing (#5863) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resolved integration branch that does not name a resolvable `origin/` ref — `HEAD branch: (unknown)` included — makes the target-missing pass skip with the same one Warning the empty branch (#5305) already gets: nothing is excluded as `target-missing`, no Close proposal is staged. Only the target-missing pass is affected (the maintainer's answer at plan review, Reading B, recorded in the spec's `## Plan Review Clarifications`).

**Architecture:** After the branch is resolved (policy key, else `git remote show origin`), probe `origin/{branch}` once with `git rev-parse --verify --quiet origin/{branch}^{commit}`. A failed probe makes only the target-missing pass take its existing empty-branch skip path; it does NOT clear the shared `state.integrationBranch` / `state.integrationRef` (module) or `INTEGRATION_BRANCH` / `INTEGRATION_REF` (fence), because the unlanded-blocker pass reads them and checks landing through the GitHub API, not a local ref: a branch that exists on GitHub with no local `origin/` ref (a single-branch clone) must keep its unlanded-blocker exclusions and print no new landing-skip Warning. The module and the fence (`plugin/skills/dispatch/queue-pull-script.md`) change identically.

**Tech Stack:** Node (CommonJS), bash fence, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-18T072534-spec-5879-5863-5865-5830/spec-5863/work/5863-spec.md`

Scope keywords: remoteHeadBranch, TARGET_MISSING_SKIPPED, INTEGRATION_REF

## Global Constraints

- `plugin/skills/dispatch/queue-pull-script.md` is 52,499 bytes against the 52,500-byte Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). After Task 2 it must still be at or under 52,500 bytes (`wc -c`), with the `rail:` tests green. Make room by cutting bytes from comments or prose in the same file (never an executed line, never a string a test reads from the fence via `fenceText`), or by moving a lazy prose section into `plugin/skills/dispatch/queue-pull-notes.md` with a pointer. Keep the fence's line count from line 376 down unchanged where possible: the module cites fence line numbers in comments (`Fence 376-459`, `fence 382`, `fence 394-395`); if a line count changes, update every such citation in `plugin/bin/lib/dispatch/queue-pull.js`.
- The skip Warning text read `Warning: target-missing pass skipped — no integration branch resolved`; review changed it to `… — no resolvable integration branch`, since a branch can now resolve while its `origin/` ref does not (module constant `TARGET_MISSING_SKIPPED`, fence line 395). The test helpers read it from the fence.
- Scope: Touch only what the task requires. Do not change the policy-key path's behaviour beyond the probe.

## Review Focus

1. A policy `integration-branch` naming a branch origin does not have (typo, deleted branch) — expected: the same skip-with-Warning path (the probe applies to both sources). Pinned in Task 1.
2. A valid remote HEAD (`trunk`, `release/next`) — expected: unchanged exclusions; the probe adds exactly one git call before the `cat-file` probes. Pinned by updating the existing #5227 portability argv assertions in Task 1.
3. The unlanded-blocker pass after an unresolvable branch — expected: unchanged from today (Reading B). It still receives the resolved branch (`state.integrationBranch` keeps its value) and does not print its empty-branch landing-skip Warning. For a branch that exists on GitHub but has no local `origin/` ref, its exclusions are kept. For the literal `(unknown)` value no such branch exists on GitHub, so its compare call fails and that pass's existing `undetermined` handling applies (the record is kept, one `kept` line); the parity row pins exactly that observed behaviour. Pinned in Task 1 by asserting `state.integrationBranch`/`integrationRef` still hold the resolved values (`pull4` runs only the first nine passes, so an in-process Warning-absence assertion would pass vacuously and is not used), and in Task 2 by a parity expectation derived from a baseline run of that pass, never copied from `F-intbranch` (whose empty branch does skip it).
4. An empty branch (failed `git remote show origin`) — expected: unchanged from #5305; the module runs no probe for an empty branch (the existing test asserts no `cat-file`; keep the probe off too).
5. A branch name with shell-significant characters — the module passes argv (no shell); the fence quotes `"$INTEGRATION_REF^{commit}"`.

---

### Task 1: Module probe + in-process test

**Review risk:** high — the probe's result decides whether records are excluded and Close proposals staged, and the branch state is shared between two passes.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (`runTargetMissing`, ~line 1018; `remoteHeadBranch` neighbour)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`fakeRun`, ~line 165: answer the new probe)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (beside the `#5227 portability` tests, ~line 1983-2022)

**Interfaces:**
- Produces: git argv `['rev-parse', '--verify', '--quiet', 'origin/{branch}^{commit}']`, run once per pull only when the resolved branch is non-empty, before any `cat-file` probe. On a throw, `runTargetMissing` takes its existing empty-branch skip path (the one Warning, no `cat-file`, nothing excluded or staged) and leaves `state.integrationBranch` and `state.integrationRef` as resolved.

- [ ] **Step 1: Write the failing test (AC1.1)** — first teach `fakeRun` the probe: for git sub-argv `rev-parse --verify --quiet {ref}^{commit}`, return `'{40-hex}\n'` when `originBranchFiles(scenario, ref-without-origin/)` is truthy, else throw `fakeFailure(args, { status: 1, stdout: '', stderr: '' })` (`gitFail` already applies first). Then the test `#5863: an origin HEAD branch of (unknown) skips the target-missing pass with the Warning, excludes nothing as target-missing and stages no Close proposal`, modelled on the `#5227 … failing git remote show origin` test at ~2008:
  - `pull4({ ...FULL(), headBranch: '(unknown)' }, { run: <argv recorder over fakeRun> })`
  - `assert.equal(r.state.integrationBranch, '(unknown)')` and `assert.equal(r.state.integrationRef, 'origin/(unknown)')` (Reading B: the shared branch is left as resolved; no Warning-absence assertion for the unlanded-blocker pass, which `pull4` never runs)
  - `assert.deepEqual(entriesOf(r, 'target-missing'), [])`
  - `assert.ok(r.errs.includes(`${TARGET_MISSING_SKIPPED}\n`))`
  - `assert.ok(!r.cap.staged.some((s) => s.id.startsWith('dispatch-target-missing-')))`
  - `assert.ok(!gitArgvs.some((a) => a[0] === 'cat-file'))`
  - Second case in the same test: policy `'integration-branch': 'no-such-branch'` → same outcomes, with `state.integrationBranch` still `'no-such-branch'`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test --test-name-pattern "#5863" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL after Step 1 (`integrationBranch` is `'(unknown)'`; target-missing entries are non-empty).

- [ ] **Step 3: Implement** in `runTargetMissing`: after `if (!branch) branch = remoteHeadBranch(ctx);`, when `branch` is non-empty run the probe via `ctx.deps.run('git', argv, runOpts(ctx, { stdio: 'pipe' }))` in a try/catch; on a throw make this pass take its existing empty-branch skip path without writing `ctx.state.integrationBranch` or `ctx.state.integrationRef` (a local `skip` flag or local `branch`/`ref` variables; never the shared state). Update the `#5305` comment above `const ref` to say "an empty or unresolvable branch". Name the probe helper `originRefResolves(ctx, ref)` returning a boolean.

- [ ] **Step 4: Update the existing argv assertions** the new call changes: the `#5227 portability` test's `gitArgvs` (insert `['rev-parse', '--verify', '--quiet', 'origin/trunk^{commit}']` after `['remote', 'show', 'origin']`) and `policyGit` (prepend `'rev-parse --verify --quiet origin/release/next^{commit}'`). Any other test pinning a git argv sequence that now fails: same treatment, never loosening the assertion. The `policyGit` scenario's fake base (`policyBase = fakeRun(FULL())`, ~line 2089) has an origin holding only `main`, so the new probe on `origin/release/next` would throw and the pass would skip: give `policyBase` and its matching `pull4` scenario an origin that holds `release/next`, the way the `withPolicy` helper at ~line 2072 already does, before prepending the probe argv.

- [ ] **Step 5: Run the test suite and verify the revert goes red (AC1.1, AC2.1)**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS, 0 failures. Then revert only the Step 3 code change in `queue-pull.js`, re-run the `#5863` test, see it FAIL, and restore it (AC2.1). Quote both raw outputs in the report.

- [ ] **Step 6: Commit** — `Skip the target-missing pass on an unresolvable origin HEAD branch — module (refs #5863)`.

### Task 2: Fence probe + parity row

**Review risk:** high — the fence is the executable twin of Task 1's branching, and its probe must skip only the target-missing pass while the unlanded-blocker pass reads the same shared branch.

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (lines 380-384 and byte trim; see Global Constraints)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`FAULTS`, beside `F-intbranch` ~line 693)
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`seedOrigin` ~line 253: a way to leave origin's HEAD dangling)
- Modify: `tests/bin-lib/dispatch/queue-pull-helpers.js` (`FAULT_EXPECT`, beside `'F-intbranch'` ~line 319)
- Test: `tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js` (the AC4.1 detail test, beside the `F-intbranch` loop ~line 64)
- Modify: `docs/reference/gh-issue-write-inventory.md` — only if the fence's line count changes: shift the `queue-pull-script.md` line numbers its `### plugin/skills/dispatch/queue-pull-script.md` table and line 76 cite past fence line 384 by the same delta (Check B scope-keyword hit on `INTEGRATION_REF`)

**Interfaces:**
- Consumes: Task 1's skip-only-target-missing behaviour (the module side of the parity pair): the shared branch and ref are left as resolved.

- [ ] **Step 1: Add the parity row** `F-headunknown` (pass `target-missing`): the `F-intbranch` scenario (with the `#9017`/`docs/present.md` record) but instead of `gitFail`, a scenario flag (e.g. `danglingHead: true`) applied in `createSandbox` AFTER the `git clone` (`tests/bin-lib/dispatch/queue-pull-oracle.js` ~line 642: `git -C {originDir} symbolic-ref HEAD refs/heads/{absent}`), never in `seedOrigin` (a bare origin whose HEAD dangles before the clone yields an unborn-HEAD clone with no checkout, which changes every other pass's repo state, and `seedOrigin` throws when `headBranch` names no seeded branch). The clone then checks out `main` normally and only the live `git remote show origin` prints `HEAD branch: (unknown)` — verify that with one manual run before relying on it. The scenario also needs a failing gh answer (a 404-shaped status) for the unlanded-blocker pass's `gh api repos/{slug}/compare/(unknown)...{sha}` call (`compareArgv(REPO_SLUG, '(unknown)')` in `queue-pull-fixtures.js`, which today answers only `main`), otherwise the shim exits 97 UNHANDLED on both sides and `assertClean` fails. Its `FAULT_EXPECT` row: the target-missing skip Warning and no target-missing exclusion, with the unlanded-blocker pass's output taken from a baseline run of that pass at the unchanged branch (Reading B keeps its exclusions and adds no landing-skip Warning), so `stderr`, `drops` and `adds` are NOT copied from `F-intbranch`, whose empty branch also skips the blocker pass. In the AC4.1 detail test, add a loop over `sides(R['F-headunknown'])` asserting no `target-missing` exclusion, no `dispatch-target-missing-*` staged proposal, and no `cat-file` git argv.

- [ ] **Step 2: Run it to verify it fails (oracle side)**

Run: `node --test tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js`
Expected: FAIL after Step 1 on `F-headunknown` — the fence still probes `origin/(unknown)` and excludes the named targets.

- [ ] **Step 3: Implement in the fence** — the mirror of Task 1, scoped to the target-missing pass only (Reading B): read how the fence's target-missing pass tests `INTEGRATION_BRANCH` for the empty-branch skip (fence ~line 394-395) and the unlanded-blocker pass's own read of it; add a probe guarded as `[ -n "$INTEGRATION_BRANCH" ] && git rev-parse --verify --quiet "$INTEGRATION_REF^{commit}" >/dev/null 2>&1` (same flag order as the module's argv, and no probe at all for an empty branch, matching the module) whose failure makes only the target-missing pass take that existing skip (a new local flag or a local ref variable), and leave `INTEGRATION_BRANCH` and `INTEGRATION_REF` untouched for the unlanded-blocker pass. The empty-branch case is unchanged. Then trim bytes per Global Constraints until `wc -c` ≤ 52500.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/dispatch/queue-pull-parity-ac4.test.js tests/bin-lib/dispatch/queue-pull.test.js`
  Expected: PASS. Then the rail suite: `node --test tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js` — Expected: PASS; and `wc -c plugin/skills/dispatch/queue-pull-script.md` ≤ 52500.

- [ ] **Step 5: Commit** — `Skip the target-missing pass on an unresolvable origin HEAD branch — fence and parity row (refs #5863)`.

---

## Self-review

- Spec coverage: Deliverable 1 (module + fence) → Task 1 Step 4, Task 2 Step 3. Deliverable 2 (in-process test + parity row) → Task 1 Step 2, Task 2 Step 1. AC 1 → Task 1 Step 2 assertions. AC 2 → Task 1 Step 6 revert check.
- Reading B (spec `## Plan Review Clarifications`) → Task 1 Interfaces and Step 3, Task 2 Step 3 and Step 1, Review Focus 3.
- Placeholders: none.
