# Verify Leave-Open Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wrap-up-engine.js verify` stops false-failing `run-dir-archived` and `worktree-removed` on a pr-first run whose Review Console merge resolution is leave-open.

**Architecture:** One fail-open reader pulls `merge.resolution` out of `{runDir}/console.json`. Both checks keep computing exactly as today. Only a would-be `fail` becomes `skip` with a pending-review reason, and only when that reader returns `'leave-open'`. The `pass`/`unknown` results and the merge path are untouched. No live PR-state read.

**Tech Stack:** Node 18+, `node:test`, `node:assert`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T103744-record-3373/work/3373-spec.md`

## Global Constraints

- Skip detail text: `pending-review — teardown follows the human merge`. Use it verbatim in both checks.
- Do not read the PR's live merge state. The only input is `console.json`'s `merge.resolution`.
- A missing or unparseable `console.json`, a missing `merge` object, or any other resolution value must leave today's behavior unchanged. That is fail-open toward the existing check, never toward `skip`.

## Review Focus

- `console.json` absent: the check must still `fail` when teardown is missing. This is pinned by the "no console.json" test.
- `console.json` present but malformed JSON: treat it as no resolution, so it still fails. This is pinned by the malformed-console test.
- Leave-open run whose teardown already happened: the check must still report `pass`, not `skip`, so the skip only replaces a `fail`. This is pinned by the leave-open-archived test.
- `merge.resolution: 'merge'` with teardown missing: the check must still `fail` (spec AC2). This is pinned.
- An existing `deferred` short-circuit keeps precedence and its own `deferred to parent console` detail. Covered by the existing tests, unchanged.

---

### Task 1: Leave-open skip for run-dir-archived and worktree-removed

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (add reader near `readExpectations`, ~line 131; edit checks at ~292-325 and ~328-363)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js` (append after the existing `worktree-removed` / `run-dir-archived` tests)

**Interfaces:**
- Produces: `consoleMergeResolution(runDir: string) -> string | null`, module-internal and not exported. It returns `merge.resolution` when `{runDir}/console.json` parses and that value is a string, and `null` otherwise. It never throws.
- Produces: a module-level constant `PENDING_REVIEW_SKIP = { result: 'skip', detail: 'pending-review — teardown follows the human merge' }`, or the equivalent inline object used by both checks.

- [ ] **Step 1: Write the failing tests**

Add a helper `writeConsole(runDir, resolution)` that writes `{ resolved: true, merge: { resolution, reason: 'test' } }` to `{runDir}/console.json`. Each test builds its run dir as `path.join(repoRoot, '.claude-tweaks', 'pipelines', '<id>')` under `repoRoot = makeCleanRepoRoot()`, and passes `repoRoot`, `cwd: makeCleanRepoRoot()` and `deps: { git: fakeGit, gh: () => '' }`.

- `#3373: run-dir-archived skips with the pending-review reason when console.json records leave-open and the original path is still present`: run dir exists, console is `leave-open`. Assert `row.result === 'skip'` and `row.detail === 'pending-review — teardown follows the human merge'`.
- `#3373: worktree-removed skips with the pending-review reason when console.json records leave-open and the worktree is still listed`: the run dir is named `2026-01-01T000000-spec-3373`. Use the same `fakeGit` shape as the existing "still listed" test, with path `/repo/.claude/worktrees/flow-spec-3373` and branch `worktree-flow-spec-3373`, and console `leave-open`. Assert `skip` plus the same detail.
- `#3373: leave-open still passes when teardown already happened`: an archived run (original gone, `archive/<id>` exists) whose archived dir holds `console.json` `leave-open`. Pass `runDir` as the original path. The check reads console from the resolved archive dir, so call `runVerify` with `runDir: archivePath, originalRunDir: originalPath`. Assert `run-dir-archived` is `pass`. Also assert `worktree-removed` is `pass` with `fakeGit` returning `''`.
- `#3373: merge resolution keeps run-dir-archived and worktree-removed failing when teardown is missing`: console `merge`, run dir present, worktree listed. Assert both rows `fail` and `result.exitCode === 3`.
- `#3373: no console.json keeps both checks failing when teardown is missing`: same setup without a console file. Assert both rows `fail`.
- `#3373: malformed console.json keeps both checks failing`: write `'{not json'` to `console.json`. Assert both rows `fail`.
- `#3373 AC1: leave-open run exits 0 when every other check passes`: mirror the existing `AC1: fixture run-dir with one unexecuted approved action…` test (~line 163). Use the same `writeExpectations(originalPath, { version: 1, memory: [], upstream: [] })`, but without the `deferred` entry, and add `writeConsole(originalPath, 'leave-open')`. Use the same `fakeGitDirty` worktree listing and `gh: () => 'gh version 2.0.0'`. Assert `exitCode === 0`, that no row has `result === 'fail'`, and that both `run-dir-archived` and `worktree-removed` are `skip`. Clean up the same way that test does.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: FAIL. The leave-open tests report `fail` where `skip` is expected. The merge, no-console and malformed tests already pass, as they pin today's behavior.

- [ ] **Step 3: Implement `consoleMergeResolution(runDir)` and the leave-open branch in both checks**

Reader: `JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8'))` inside try/catch, returning `data && data.merge && typeof data.merge.resolution === 'string' ? data.merge.resolution : null`. Add a short comment in the module's existing style. It should name #3373, say that leave-open is the designed resting state (Section C forbids removing an unmerged PR's worktree, and the reconciler archives after the human merge), and say that the reader is fail-open toward the existing check.

In both checks, keep the `deferred` short-circuit first. Wrap only the `fail` returns: compute the would-be fail result, then return the pending-review skip instead when `consoleMergeResolution(runDir) === 'leave-open'`. `run-dir-archived` must destructure `runDir` too. Read console from `runDir`, which is the resolved run dir and the original path while it still exists. `unknown` results, such as `git worktree list failed`, stay as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the new tests discriminate**

Temporarily make `consoleMergeResolution` return `null` unconditionally and run the suite. Expected: the two leave-open skip tests and the AC1 test fail. Restore the real body and re-run, expecting PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js tests/bin-lib/wrap-up/engine-verify.test.js
git commit -m "Skip run-dir-archived and worktree-removed on a leave-open console — teardown follows the human merge (refs #3373)"
```
