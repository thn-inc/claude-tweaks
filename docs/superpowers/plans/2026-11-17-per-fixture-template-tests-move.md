# Per-Fixture Template Tests Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every per-fixture test out of `tests/helpers-git-template.test.js` into a test file whose own tests already build that fixture's template, so the template builds this file pays for alone disappear.

**Architecture:** Templates are cached per test process, so a warm-call or content test costs a template build only in a file that does not build that template anyway. Each test moves verbatim (name, builder arguments, assertions) to the file that already calls the same builder with the same arguments; the warm-call check itself becomes one shared helper. `tests/helpers-git-template.test.js` keeps the tests of the template helper itself.

**Tech Stack:** Node `node --test`, started through `node tools/run-tests.js`; git trace2 (`GIT_TRACE2_EVENT`) for process counts.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T172201-spec-5846/work/5846-spec.md`

## Global Constraints

- No test is deleted, skipped, renamed, merged or loosened. A moved test keeps its name, its builder arguments and every assertion. Only two things may change in a moved test: how it reaches the fixture module (the destination's own `require`/binding) and how it cleans up (the destination's own idiom, for example `t.after` or the file's cleanup list).
- A moved test lands in exactly one file. It is removed from `tests/helpers-git-template.test.js` in the same commit that adds it to its destination.
- Test concurrency is not lowered anywhere. `tools/run-tests.js`, `tests/helpers/git-fixtures.js` and every fixture module's builders stay unchanged (this record changes test files, one new helper, one header comment and one allowlist).
- Git operations under test stay real; nothing is stubbed to save a process.
- Run tests with `node tools/run-tests.js <files>`, never a bare `node --test`.
- Commit style: `{Verb} {what} — {detail}`, ending `refs #5846`. No conventional-commit prefix.
- Governing project skill, `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md`, quoted: "The template is cached by `key` alone, so `build` must not read per-test arguments; give each variant its own key, as `gitRepo` keys on `branch`." It applies as a reading aid only: a destination "already builds the template" only when it calls the builder with arguments that produce the same key. No builder or key changes in this plan.
- Governing project skill, `.claude/skills/git-ground-truth-test-env/SKILL.md`, quoted: "a bare `node --test` of a suite that loads `tests/helpers/git-template.js` (`tests/helpers/git-fixtures.js` loads it) builds the same template and sets it on `process.env`." It applies to the new helper: it must set and restore only `GIT_TRACE2_EVENT`, and must not load `tests/helpers/git-template.js` itself.
- `.claude/skills/windows-checkout-test-parity/SKILL.md` names `tests/helpers/git-template.js` only for path rewriting inside it; no rule there applies, because this plan changes that file's header comment only.
- The record's aim-over-literal rule: where its wording leaves a choice between a literal reading and its aim (fewer git processes per test, coverage kept), take the aim and record the choice for the PR body.

## Review Focus

1. A moved test whose destination builds a different template key (same builder, different arguments): the build is paid again in the destination and nothing is saved. Each task measures `git init` per destination before and after (Task steps "Count").
2. A moved test colliding with an existing test name in its destination, which would make "present in exactly one file" unprovable. Each task's name check counts every moved name across all touched files.
3. A moved test that passes for the wrong reason because an earlier test in the destination left process state behind (an env var, a changed cwd). The helper restores `GIT_TRACE2_EVENT`; a moved test is placed at the end of its destination file.
4. A warm-call test that can no longer fail. Task 1 adds a test that the helper throws when the traced call starts a git process, and the controller runs the red proof of AC4.1 on a moved test.
5. `tests/fixture-identity-config-scan.test.js` going red because a moved test reads `user.email` back in a file that is not allowlisted. Tasks 3 and 4 update the allowlist with the same reason.

## File Structure

- Create `tests/helpers/git-trace.js` — the one copy of the warm-call check.
- Modify `tests/helpers/git-template.js` — header comment only (where a builder's warm-call test belongs).
- Modify `tests/helpers-git-template.test.js` — keeps the helper's own tests; loses every per-fixture test and the requires only they used.
- Modify the destination test files named per task.
- Modify `tests/fixture-identity-config-scan.test.js` — allowlist entries for files that gain a `git config user.email` read.

## Shared interface (produced by Task 1, consumed by Tasks 2-4)

```js
// tests/helpers/git-trace.js
// warmCallStartsNoGit(warm, opts = {}) -> { warm, traced }
//   warm:        () => any   called once first; it may build a template and start git
//   opts.traced: () => any   called under GIT_TRACE2_EVENT=<fresh empty dir>; defaults to `warm`
//   opts.track:  (result) => void   called with warm's result, then with traced's result,
//                                   before the assertion, so the caller can register cleanup
// Asserts with assert.deepStrictEqual(<names of the files in the trace dir>, []) and removes the
// trace dir. Returns both results for the caller's further assertions.
module.exports = { warmCallStartsNoGit };
```

A moved warm-call test is rewritten onto it like this (name unchanged, the inline `mk`/`withEnv`/`readdirSync` lines replaced by the helper, any further assertions kept after it):

```js
test(`${name}: a second call starts no git process`, () => {
  warmCallStartsNoGit(make, { track: (r) => scratch.push(...dirsOf(r)) });
});
```

For a test that warms several variants and traces others (the two learned-skills tests), `warm` runs every warm-up call and `opts.traced` runs every traced call and returns what the later assertions read.

## How every moving task proves itself (Tasks 1-4)

The controller hands each implementer two things outside this plan: the path of a JSON file holding, for every candidate file at the branch base, its top-level test names and its git process counts by subcommand, and the path of a script that re-measures a list of files the same way. Each task ends with:

- **Names:** every test name the task moved is absent from `tests/helpers-git-template.test.js`, present once in its destination, present in no other touched file, and passing; every name the destination had at the base is still there and passing.
- **Count:** for each destination, `git init` after is not above `git init` before, except for a build the task names in its report (a builder variant no other file builds). Total git processes of the source file fall.

### Task 1: Shared warm-call helper, header comment, and the pre-tool-use tests

**Role:** integration

**Files:**
- Create: `tests/helpers/git-trace.js`
- Modify: `tests/helpers/git-template.js` (header comment, lines 1-26)
- Modify: `tests/helpers-git-template.test.js`
- Modify: `tests/hooks-pre-tool-use.test.js`

**Interfaces:**
- Produces: `warmCallStartsNoGit(warm, opts)` as specified above.

- [ ] **Step 1: Write the failing test for the helper** in `tests/helpers-git-template.test.js`, after `a copy starts no git process`:

```js
test('#5846 AC4.1: warmCallStartsNoGit throws when the traced call starts a git process, and restores GIT_TRACE2_EVENT', () => {
  const before = process.env.GIT_TRACE2_EVENT;
  const startsGit = () => execFileSync('git', ['--version'], { env: gitEnv(), stdio: 'ignore', windowsHide: true });
  assert.throws(() => warmCallStartsNoGit(() => {}, { traced: startsGit }), assert.AssertionError);
  assert.strictEqual(process.env.GIT_TRACE2_EVENT, before);
  const tracked = [];
  const r = warmCallStartsNoGit(() => 'w', { traced: () => 't', track: (x) => tracked.push(x) });
  assert.deepStrictEqual(r, { warm: 'w', traced: 't' });
  assert.deepStrictEqual(tracked, ['w', 't']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/run-tests.js --test-name-pattern "warmCallStartsNoGit" tests/helpers-git-template.test.js`
Expected: FAIL with `warmCallStartsNoGit is not defined` (or `Cannot find module './helpers/git-trace'` once the require is added).

- [ ] **Step 3: Implement `warmCallStartsNoGit` in `tests/helpers/git-trace.js`** to the interface above. It requires only `node:assert`, `fs`, `os`, `path`. The trace directory is made with `fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gt-trace-'))`; `GIT_TRACE2_EVENT` is restored in a `finally` (deleted when it was unset before); the trace dir's file names are read before it is removed, and the assertion runs after the removal.

- [ ] **Step 4: Run the test to verify it passes** (same command, Expected: PASS).

- [ ] **Step 5: Put `a copy starts no git process` on the helper** (kept test, same name, same `deepStrictEqual(…, [])` assertion through the helper): `warm` is the warm-up `fromTemplate('k1', build, …)` call, `opts.traced` returns the two copies, `opts.track` pushes to `scratch`.

- [ ] **Step 6: Move the pre-tool-use tests** to the end of `tests/hooks-pre-tool-use.test.js`, each under its current name, the warm-call ones on the helper:
  - `pre-tool-use gitRepo: a second call starts no git process`
  - `pre-tool-use gitRepoWithCommit: a second call starts no git process`
  - `AC1.1 AC1.2: pre-tool-use mainAndWorktree: a second call starts no git process`
  - `AC1.1 AC1.2: pre-tool-use mainAndWorktree({ localMain }): a second call starts no git process`
  - `AC1.1 AC1.2: pre-tool-use gitRepoOnLocalMain: a second call starts no git process`
  - `AC1.1 AC1.2: pre-tool-use unpinnedRepoWithOrigin: a second call starts no git process`
  - `a copied mainAndWorktree pair resolves to its own main, and a second worktree can be added to it`
  - `mainAndWorktree({ localMain: true }) and gitRepoOnLocalMain copies are on main`
  - `unpinnedRepoWithOrigin copies carry the GitHub-shaped origin and one commit`

  The content tests call a local `git(cwd, args)` in the source file (`fixtureGit` with `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` pinned to an empty file and a fixed author). Give the destination the same call for these tests, built from `fixtureGit` in `tests/helpers/git-fixtures.js`, unless it already has an equivalent; do not change what the assertions compare. The `git-fixtures gitRepo…` and `originWithTwoClones` entries of the source's `builders` table stay for Task 4.

- [ ] **Step 7: Add the placement rule to the header comment of `tests/helpers/git-template.js`**, as a new paragraph after the "Timestamps are deliberately NOT preserved" paragraph:

```js
// Where a builder's warm-call test belongs: in a test file that already uses
// the builder, never in tests/helpers-git-template.test.js. Templates are
// cached per process, so a "second call starts no git process" test costs
// nothing where the template is built anyway and costs a whole build in a file
// that would not otherwise build it. The check itself is
// `warmCallStartsNoGit` in tests/helpers/git-trace.js.
```

- [ ] **Step 8: Run** `node tools/run-tests.js tests/helpers-git-template.test.js tests/hooks-pre-tool-use.test.js` (Expected: all pass, 0 skipped), then the Names and Count checks above (covers AC1.1, AC1.2, AC1.3, AC3.1 for this group).

- [ ] **Step 9: Commit** the four files: `Add the shared warm-call check and move the pre-tool-use fixture tests to their own suite — refs #5846`.

### Task 2: Reconcile, claims-git-cas, pre-review-catchup and prune-remote tests

**Role:** integration

**Files:**
- Modify: `tests/helpers-git-template.test.js`
- Modify: `tests/reconcile.test.js`
- Modify: `tests/bin-lib/issues/claims-git-cas.test.js`
- Modify: `tests/bin-lib/pre-review-catchup/cli.test.js`
- Modify: `tests/bin-lib/reconcile/prune-remote.test.js`

**Interfaces:**
- Consumes: `warmCallStartsNoGit` from `tests/helpers/git-trace.js`.

- [ ] **Step 1: Move to the end of `tests/reconcile.test.js`:** `reconcile pairedFixture: a second call starts no git process`, `reconcile bareRepoRoot: a second call starts no git process`, `pairedFixture copies point at their own origin and sync through it`.
- [ ] **Step 2: Move to the end of `tests/bin-lib/issues/claims-git-cas.test.js`:** the four `AC4.1: claims-git-cas {builder}: a second call starts no git process` tests (`makeBareOriginAndClone`, `makeBranchlessOriginAndClone`, `makeDecoyOriginAndClone`, `makeRegistryWithClaims`), keeping the two `rev-parse origin/claims-registry` assertions of the `makeRegistryWithClaims` case after the helper call.
- [ ] **Step 3: Move to the end of `tests/bin-lib/pre-review-catchup/cli.test.js`:** every `AC4.1: pre-review-catchup catchupFixture{ shape}: a second call starts no git process` test (one with no shape, one per `CATCHUP_SHAPES` entry), `catchupFixture rejects an unknown shape, inherited object keys included`, `a catchupFixture copy is on feat with origin/main equal to main in work and other`, `a catchupFixture shape copy holds the shape setup: a feat edit in work, an unfetched upstream commit on origin only when the shape pushes`.
- [ ] **Step 4: Move to the end of `tests/bin-lib/reconcile/prune-remote.test.js`:** every `AC4.1: prune-remote {name}: a second call starts no git process` test (one per `PRUNE_REMOTE_FIXTURES` entry), `a prune-remote squashed copy holds the squash commit on main over preSquash`, `a prune-remote b1-deleted copy lacks build/b1 on the origin but keeps its stale tracking ref`.
- [ ] **Step 5:** For each destination, give the moved content tests the source's `git(cwd, args)`/`commit(cwd, name)`/`gitEnv()` behaviour where they call it and the destination has no equivalent (same rule as Task 1 Step 6). Remove from the source the requires only these tests used (`./helpers/reconcile-fixtures`, `./bin-lib/issues/claims-git-cas-fixtures`, `./bin-lib/pre-review-catchup/fixtures`, `./bin-lib/reconcile/prune-remote-fixtures`).
- [ ] **Step 6: Run** `node tools/run-tests.js tests/helpers-git-template.test.js tests/reconcile.test.js tests/bin-lib/issues/claims-git-cas.test.js tests/bin-lib/pre-review-catchup/cli.test.js tests/bin-lib/reconcile/prune-remote.test.js` (Expected: all pass, 0 skipped), then the Names and Count checks (covers AC1.1, AC1.2, AC1.3, AC3.1 for these groups). A destination that does not build one variant at the base (for example a catch-up shape or a prune-remote fixture no destination test uses) is reported by name with the `git init` it adds.
- [ ] **Step 7: Commit:** `Move the reconcile, claims, catch-up and prune-remote fixture tests to their own suites — refs #5846`.

### Task 3: Learned-skills, stack-check, archive-merged and statusline tests

**Role:** integration

**Files:**
- Modify: `tests/helpers-git-template.test.js`
- Modify: `tests/bin-lib/learned-skills/capture.test.js`
- Modify: `tests/bin-lib/learned-skills/land.test.js`
- Modify: `tests/bin-lib/staged-patch/stack-check.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
- Modify: `tests/statusline.test.js`
- Modify: `tests/fixture-identity-config-scan.test.js`

**Interfaces:**
- Consumes: `warmCallStartsNoGit` from `tests/helpers/git-trace.js`.

- [ ] **Step 1: Move** `AC3.1: learned-skills capture fixture(): a warm copy starts no git process` to the end of `tests/bin-lib/learned-skills/capture.test.js` and `AC3.1: learned-skills land fixture(): a warm copy starts no git process and owns its paths` to the end of `tests/bin-lib/learned-skills/land.test.js`. `warm` runs the warm-up calls, `opts.traced` runs the traced calls and returns what the later assertions read; every later assertion stays.
- [ ] **Step 2: Move to the end of `tests/bin-lib/staged-patch/stack-check.test.js`:** the three `AC3.1: stack-check …: a second call starts no git process` tests and `AC4.1: a stack-check fixture copy carries maintenance.auto=false and gc.auto=0 in its own config`.
- [ ] **Step 3: Move to the end of `tests/bin-lib/reconcile/archive-merged.test.js`:** the `AC3.1: archive-merged …: a second call starts no git process` tests for `makeRepo()`, `mergedFeatureBranchRepo(feat-x)`, `fixtureCleanUnarchivedRun({ origin: true })`, `fixtureAbandonedShippedRun`, `cloneOfSeededOrigin()`, `fixtureAbandonedBehindOrigin()`, `fixtureAbandonedBehindOrigin({ squash: true })`, `headerMergedRepo3976({ moved: true, merge: squash })`, `headerMergedRepo3976({ moved: false, merge: no-ff })`; `AC3.1: archive-merged mergedFeatureBranchRepo(): a call with a new branch name starts no git process`; `mergedFeatureBranchRepo copy: feature tip is an ancestor of main and the branch ref exists`; `mergedFeatureBranchRepo copy under a new branch name: the ref and its reflog carry that name only`. The `originDirOf` one-liner moves with them.
- [ ] **Step 4: Move to the end of `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`** (the only file that calls these three builders): the `AC3.1: archive-merged …: a second call starts no git process` tests for `deletedBranchMergedRepo(feat-3503-bynumber, origin)`, `reusedBranchLiveRepo()`, `shellRepo3975()`.
- [ ] **Step 5: Move to the end of `tests/statusline.test.js`:** the six `AC3.1: statusline …: a second call starts no git process` tests and `worktreeShapes copy: link points at this copy's wt, and wt and sub resolve inside this copy`.
- [ ] **Step 6: Update `ALLOWLIST` in `tests/fixture-identity-config-scan.test.js`:** add `'tests/bin-lib/staged-patch/stack-check.test.js'` with the reason `` `reads ${USER}.email back with git config to prove an identity reached a template copy (moved from tests/helpers-git-template.test.js by #5846)` ``. The existing `tests/helpers-git-template.test.js` entry stays as it is in this task.
- [ ] **Step 7:** Same local-helper rule as Task 1 Step 6 for moved content tests; remove from the source the requires only these tests used (`./bin-lib/staged-patch/stack-check-fixtures`, `./bin-lib/reconcile/archive-merged-helpers`, `./helpers/statusline-fixtures`, and the inline `./helpers/learned-skills-capture` and `./helpers/learned-skills-land` requires).
- [ ] **Step 8: Run** `node tools/run-tests.js tests/helpers-git-template.test.js tests/bin-lib/learned-skills/capture.test.js tests/bin-lib/learned-skills/land.test.js tests/bin-lib/staged-patch/stack-check.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/statusline.test.js tests/fixture-identity-config-scan.test.js` (Expected: all pass, 0 skipped), then the Names and Count checks (covers AC1.1, AC1.2, AC1.3, AC3.1 for these groups and AC5.1 for the stack-check read). A variant no destination test builds at the base (for example `gitFixture` with Latin-1 bytes, `mergedFeatureBranchRepo('feat-x')`) is reported by name with the `git init` it adds.
- [ ] **Step 9: Commit:** `Move the learned-skills, stack-check, archive-merged and statusline fixture tests to their own suites — refs #5846`.

### Task 4: Verify and git-fixtures tests, the identity tests, and the source file's leftovers

**Role:** integration

**Files:**
- Modify: `tests/helpers-git-template.test.js`
- Modify: `tests/bin-lib/verify/cli.test.js`
- Modify: `tests/bin-lib/verify/cli-baseline.test.js`
- Modify: `tests/bin-lib/verify/cli-flaky-preexisting.test.js`
- Modify: `tests/helpers-git-fixtures.test.js`
- Modify: `tests/bin-lib/worktree/remote-branch-collision.test.js`
- Modify: `tests/fixture-identity-config-scan.test.js`

**Interfaces:**
- Consumes: `warmCallStartsNoGit` from `tests/helpers/git-trace.js`.

Destination rule for this task: a test goes to the file that already calls its builder with arguments producing the same template key; where no file does, it goes to the file that uses the builder's other variants and the report names the build it adds. Read each builder's key in `tests/bin-lib/verify/cli-helpers.js` and `tests/helpers/git-fixtures.js` before placing a test; the placements below are the expected result, and a placement the keys contradict is changed and reported.

- [ ] **Step 1: Move to the end of `tests/bin-lib/verify/cli.test.js`:** `AC1.1 AC1.2: verify scopedRepo: a second call starts no git process`, `AC1.1 AC1.2: verify scopedRepo with generated: a second call starts no git process`, `tmpGitRepo: a second call starts no git process and carries the verify identity`, `verify builders: per-call values match git, and different arguments never share a template`, `Absorbed AC (identity): a fresh process building every owned fixture starts no git config user.name/user.email process`, `Absorbed AC (identity): the identity written into a template reaches its copies`. The fresh-process identity test builds every fixture cold by design, so it saves nothing wherever it lives; its module list (`./helpers/git-template`, `./helpers/pre-tool-use`, `./bin-lib/verify/cli-helpers`) is re-pointed to the destination's relative paths and nothing else in it changes.
- [ ] **Step 2: Move** `AC1.1 AC1.2: verify baselineRepo: a second call starts no git process` to the end of `tests/bin-lib/verify/cli-baseline.test.js`, and `AC1.1 AC1.2: verify flakyRepo(): a second call starts no git process` and `AC1.1 AC1.2: verify flakyRepo({ retryExit: 1 }): a second call starts no git process` to the end of `tests/bin-lib/verify/cli-flaky-preexisting.test.js`.
- [ ] **Step 3: Move to the end of `tests/helpers-git-fixtures.test.js`:** `git-fixtures gitRepo(): a second call starts no git process`, `git-fixtures gitRepo({ branch }): a second call starts no git process`, `git-fixtures gitRepo({ branch }) keeps the requested branch`, `AC4.1: originWithTwoClones with a seed and no key throws`. Move `originWithTwoClones: a second call starts no git process` to the end of `tests/bin-lib/worktree/remote-branch-collision.test.js` when the unseeded template key does not depend on the prefix argument; otherwise to `tests/helpers-git-fixtures.test.js`, reported with the build it adds.
- [ ] **Step 4: Update `ALLOWLIST` in `tests/fixture-identity-config-scan.test.js`:** add each destination that now holds a `git config … user.email` read (`tests/bin-lib/verify/cli.test.js` at least) with the reason `` `reads ${USER}.email back with git config to prove an identity reached a template copy; one test title names the command (moved from tests/helpers-git-template.test.js by #5846)` ``, and shorten the `tests/helpers-git-template.test.js` entry to what still holds there: `` `reads ${USER}.name/${USER}.email back with git config to prove writeIdentity wrote them; the writeIdentity byte-parity test runs git config ${USER}.name as the reference its bytes are compared against (the behaviour under test)` ``. The scan's own test `every allowlist entry names an existing file that still holds a site, and carries a reason` decides whether each entry is still needed: an entry whose file holds no site fails it and is removed.
- [ ] **Step 5: Clean the source file.** After this task `tests/helpers-git-template.test.js` holds only: the `fromTemplate`/`fromTemplateSet`/`rewriteTemplatePaths`/`assertNoTemplatePaths`/`disableReceiveAutoGc` tests (lines 74-271 at the base), `#5846 AC4.1: warmCallStartsNoGit …`, `AC3.1: under the runner's git template a bare-origin push and a fixture commit start no maintenance process`, `template build runs with auto-maintenance off`, and the `initRepo`/`writeIdentity` tests (line 817 onward at the base). It requires `./helpers/git-fixtures` (for `fixtureGit`, `initRepo`, `writeIdentity`, which kept tests call), `./helpers/git-template`, `./helpers/git-trace` and `../tools/run-tests`, and none of `./helpers/pre-tool-use`, `./bin-lib/verify/cli-helpers`, `./helpers/reconcile-fixtures`, `./bin-lib/issues/claims-git-cas-fixtures`, `./bin-lib/pre-review-catchup/fixtures`, `./bin-lib/reconcile/prune-remote-fixtures`, `./helpers/learned-skills-capture`, `./helpers/learned-skills-land`, `./bin-lib/staged-patch/stack-check-fixtures`, `./bin-lib/reconcile/archive-merged-helpers`, `./helpers/statusline-fixtures`. Local helpers no kept test calls any more (`tracedArgvs`, `withEnv`, `commit`, …) are removed only when unused; one a kept test still calls stays.
- [ ] **Step 6: Run** `node tools/run-tests.js tests/helpers-git-template.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js tests/helpers-git-fixtures.test.js tests/bin-lib/worktree/remote-branch-collision.test.js tests/fixture-identity-config-scan.test.js` (Expected: all pass, 0 skipped), then the Names and Count checks (covers AC1.1, AC1.2, AC1.3, AC3.1 for these groups and AC5.1). Then check the require list of Step 5: `grep -n "require(" tests/helpers-git-template.test.js` lists only the modules Step 5 allows.
- [ ] **Step 7: Commit:** `Move the verify and git-fixtures tests out and leave helpers-git-template with the helper's own tests — refs #5846`.

### Task 5: Measure, prove and report (run by the controller; folded into final verification)

This task changes no repository file; its results go to the run directory and the PR body.

Waived AC2.1: a count over two measured runs, taken by the controller in Step 2 below, not a committed test.
Waived AC4.2: the red output is produced in Step 4 below and quoted in the PR body in Step 7.
Waived AC5.1: the scan is an existing committed test; Tasks 3 and 4 update its allowlist and Step 5 below runs it.
Waived AC6.1: it states how the counts are taken; Step 2 below takes them that way.
Waived AC7.1: read from the PR's checks and the Windows regression job in Step 6 below.

- [ ] **Step 1 (AC1.1, AC1.2, AC1.3):** Re-measure every touched test file at HEAD with the same command as the base measurement and compare names: each base name of `tests/helpers-git-template.test.js` is present after in exactly one touched file and passes; each base name of every destination is still present and passes; no file reports a skipped or failed test.
- [ ] **Step 2 (AC2.1, AC6.1):** Sum git processes over every touched test file before and after. The fall must be at least half of the before-count of `tests/helpers-git-template.test.js`. Both runs use `GIT_TRACE2_EVENT=<absolute path of an empty directory>` around `node tools/run-tests.js --files-from <list>`, one file per list, the before run at the branch's merge-base with main and the after run at HEAD, back to back on the same machine with the same concurrency.
- [ ] **Step 3 (AC3.1):** For every destination, compare `git init` before and after; each increase is one of the builds Tasks 1-4 named.
- [ ] **Step 4 (AC4.1):** In an archive extract of HEAD, change one moved builder so a warm call starts a git process (for example make `preToolUse.gitRepo` run its build on every call), run its moved warm-call test, and keep the red output for the PR body. The unchanged extract passes the same test.
- [ ] **Step 5 (AC5.1):** `node tools/run-tests.js tests/fixture-identity-config-scan.test.js` passes at HEAD.
- [ ] **Step 6 (AC7.1):** The PR's full-suite checks and the Windows regression job pass on the last code change.
- [ ] **Step 7:** Write each result to the run directory as an `AC evidence` entry in `decisions.md` (via `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file …`) citing a full-output file under `$PIPELINE_RUN_DIR/evidence/`, and put the moved-tests table, the per-file before/after counts, the named extra builds, the kept-require exceptions with reasons, and the red output into the PR body.
