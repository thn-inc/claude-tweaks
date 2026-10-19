# Reconcile PR Identity by Stamped Number Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the reconciler from archiving a live run (and releasing its claims) because a reused branch name once backed a merged PR, and stop it archiving a multi-spec run whose staged items sit under `spec-*/staged/`.

**Architecture:** A run's PR identity is `run-state.json`'s stamped `pr.number`; the branch name is a reusable label. `archive-merged.js` gains one resolver (`resolveRunPrState`) that both archive loops reach through `archiveMergedRun`: stamped number first via `resolvePrStateByNumber`, branch lookup only when no number is stamped (or the by-number probe returns `null`). `release-merged.js`'s Phase 1.5 probes by number for every candidate that stamps one, and by branch only for the rest. `hasStagedItems` also walks `spec-*/staged/`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` intercepted in tests by a PATH-prepended shell wrapper.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T035126-record-3416/work/3416-spec.md`

## Global Constraints

- Do not change `plugin/bin/lib/reconcile/pr-state.js` (`pickGoverningPr`'s MERGED-wins tie-break is deliberate for branch-scoped callers).
- Do not change `plugin/bin/lib/hooks/run-integrity.js` (`fallbackBranch`).
- `reap-merged.js` is out of scope; do not touch it.
- Do not narrow `hasStagedItems` to match `console/resolve.js`'s `readSnapshot` (top-level only) — the divergence is deliberate, failing toward not archiving.
- `hasStagedItems` keeps its fail-closed rule at every level: ENOENT = nothing pending; any other read error = pending.
- Keep `runWithConcurrency` pooling for every per-candidate `gh` call in `release-merged.js`.
- Commit messages: `{Verb} {what} — {detail}`, body line `refs #3416` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_01TD7u6vcLPnwgWapEAQRThU`.

## Build-time premise corrections (logged to the run's decisions.md)

- `resolvePrStateByNumber`/`resolvePrStateByNumberAsync` return `null` only for a falsy number; a nonexistent PR makes `gh pr view` exit non-zero, which classifies as `'network-failure'`. So: `null` → fall back to the branch lookup; any string result (`'gh-absent'`, `'network-failure'`, `'invalid-arguments'`) → skip. Never fall back to the branch on a failure string — that reintroduces the bug whenever the by-number probe flakes.
- AC4.2 ("existing tests pass unchanged") cannot hold for `release-merged.test.js`'s `'releaseMerged: does not invoke the by-number fallback when the live-worktree join already resolved a branch'` — it pins the exact behavior Deliverable 2 removes. Task 3 inverts it. `archive-merged.test.js`'s `installGhWrapper` returns one canned body for every `gh` call; Task 1 makes it argv-aware for `gh pr view {n}` so the two existing fixtures that stamp `pr.number` beside a resolvable branch (`fixtureOrdinaryMergedNoConsole`, pr 3249100; the ENOTDIR test, pr 3249101) keep their assertions unchanged.

Waived AC4.2: `release-merged.test.js`'s by-number-never-called test is inverted (Task 3), not kept — it asserts the removed behavior.

## Caller enumeration (Dependency-caller check)

- `archiveMergedRun` — called only inside `archive-merged.js` (main loop line ~1924, clean sweep line ~1945): `grep -n "archiveMergedRun(" plugin/bin/lib/reconcile/archive-merged.js`.
- `hasStagedItems` — three callers, all in `archive-merged.js`: `classifyRunDir` (~1494), `archiveMergedRun` (~1626), the by-number fallback (~1894).
- Tests reaching `archiveMerged`/`releaseMerged`: `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/bin-lib/reconcile/release-merged.test.js`, `tests/reconcile.test.js`, `tests/bin-lib/hooks/reconcile-background.test.js`. `grep -n "pr: {" tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js` shows only one stamp, `pr: { branch: 'feat-branch' }` (no `number`) — no new `gh pr view` call reaches them; no change needed there.

## Review Focus

- A by-number probe that fails transiently (`network-failure`) on a run whose branch backs an old MERGED PR must skip, never fall back to the branch and archive/release — Task 1 and Task 3 each pin it.
- `invalid-arguments` (a malformed `pr.number` such as `"abc"`) must skip with a reason naming it, not misreport as `pr-closed-unmerged` — Task 1 pins it in `decideArchiveCore`; Task 3 in `decideRelease`.
- A by-number MERGED result whose branch list returns OPEN must still archive (resolution keyed on the number, not on MERGED-wins) — Task 1's orthogonal test.
- A `spec-N/staged` that exists but is unreadable (ENOTDIR) must fail closed — Task 2 pins it.
- A run with no stamped `pr.number` must never call `gh pr view` from these paths — Task 1 pins it for archive.

---

### Task 1: Resolve the run's PR by stamped number in both archive loops

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`decideArchiveCore` ~320, `archiveMergedRun` ~1617, main-loop call ~1924, clean-sweep call ~1945)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Produces: `resolveRunPrState(root: string, state: object|null, branch: string) -> prState` (module-private; same return vocabulary as `resolvePrState`: object | `null` | `'gh-absent'` | `'network-failure'` | `'invalid-arguments'`).
- Produces: `archiveMergedRun({ root, repoSlug, dir, branch, state, dryRun, onSkip, runner, cacheTarget, integration })` — new `state` param (the run's parsed `run-state.json`); both callers pass the `state` they already hold.
- Produces: test helper `installGhPrWrapper({ list, view })` in the test file — `list`: JSON value printed for `gh pr list ...`; `view`: object keyed by PR number → JSON printed for `gh pr view {n} ...`; any unmapped `pr view` number exits 1; any other argv exits 1. Returns `{ restore }`.

- [ ] **Step 1: Make `installGhWrapper` argv-aware and add the new tests**

`installGhWrapper(prsJson)`: when `prsJson` is an array, `gh pr view {n}` prints the element whose `number` equals `{n}` (exit 1 when none matches); every other call (and a non-array body for any call) keeps printing `prsJson` exactly as today. Add `installGhPrWrapper({ list, view })` per the Interfaces block (argv dispatch on `"$1 $2"` then `$3`, `installGhIssueStateWrapper` is the precedent). Extend `fixtureCleanUnarchivedRun` with an optional `prNumber` that, when set, writes `pr: { number: prNumber, branch: 'feat-clean-branch' }`.

New tests (each named with its AC id):

```js
test('AC1.1: archiveMerged skips pr-open a live run whose stamped pr.number is OPEN while its live worktree branch backs an older MERGED PR (#3416)', () => {
  // root via mergedFeatureBranchRepo('feat-reused-branch'); then a live worktree on a NEW branch
  // reused name: git worktree add <realpath wt> -b 'worktree-reused' ; stamp state.worktree = realpath(wt)
  // run-state: { status: 'active', worktree: wt, pr: { number: 3406, branch: 'worktree-reused' } }; config.yml; no console.json; no staged/
  // installGhPrWrapper({ list: [{ number: 3391, state: 'MERGED', mergedAt: '2026-10-17T14:09:02Z', updatedAt: '2026-10-17T14:09:02Z', mergeCommit: { oid: featureSha } }],
  //                      view: { 3406: { number: 3406, state: 'OPEN', mergedAt: null, updatedAt: '2026-10-17T17:00:00Z', mergeCommit: null } } })
  // assert: !result.archived.includes(runDir); skipped entry reason === 'pr-open'; fs.existsSync(runDir) === true;
  //         fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)) === false
});

test('AC1.1 orthogonal: a stamped pr.number that is MERGED archives even when the branch list returns OPEN — resolution is keyed on the number (#3416)', () => {
  // same live-worktree shape; list: [{ number: 7, state: 'OPEN', ... }]; view: { 3406: { number: 3406, state: 'MERGED', mergeCommit: { oid: featureSha }, ... } }
  // console.json { resolved: true }
  // assert: result.archived.includes(runDir); fs.existsSync(runDir) === false
});

test('AC1.1 transport failure: a by-number probe that fails skips network-failure, never falls back to the MERGED branch PR (#3416)', () => {
  // same live-worktree shape; list: [old MERGED PR with mergeCommit featureSha]; view: {} (pr view 3406 exits 1)
  // assert: not archived; skipped reason === 'network-failure'; runDir still exists
});

test('AC2.1: the clean-status sweep does not archive a status:clean run whose pr.number is OPEN even when its pr.branch backs a MERGED PR (#3416)', () => {
  // fixtureCleanUnarchivedRun({ runId, prNumber: 3407 }) (console resolved)
  // installGhPrWrapper({ list: [{ number: 99, state: 'MERGED', mergeCommit: { oid: featureSha }, ... }], view: { 3407: { number: 3407, state: 'OPEN', ... } } })
  // assert: not archived; skipped reason === 'pr-open'; runDir still exists
});

test('AC4.1: a run with no stamped pr.number resolves by branch and never calls gh pr view (#3416)', () => {
  // fixtureActiveUnstampedMergedRun({ runId }) (no pr.number); installGhPrWrapper({ list: [{ number: 101, state: 'MERGED', mergeCommit: { oid: featureSha }, ... }], view: {} })
  // the wrapper also touches a marker file on any `pr view` call
  // assert: result.archived.includes(runDir); marker file does not exist
});

test('decideArchiveCore: invalid-arguments skips with reason invalid-arguments (#3416)', () => {
  assert.deepStrictEqual(decideArchiveCore('invalid-arguments', 'resolved'), { action: 'skip', reason: 'invalid-arguments' });
});
```

The comment lines inside each test body are the fixture recipe; the implementer writes them as real fixture code, reusing `mergedFeatureBranchRepo` / `fixtureCleanUnarchivedRun` / `fixtureActiveUnstampedMergedRun`. Every test restores its wrapper in `finally`.

- [ ] **Step 2: Run the suite to verify the new tests fail on the pre-fix code**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1 — AC1.1 (archived instead of `pr-open`), AC1.1 orthogonal (skipped `pr-open`), AC1.1 transport failure (archived), AC2.1 (archived), and the `decideArchiveCore` invalid-arguments test (reason `pr-closed-unmerged`). AC4.1 passes (it pins unchanged behavior). Every pre-existing test passes. Paste the failing test names into the task report — this is AC6.1's red evidence.

- [ ] **Step 3: Implement**

- `decideArchiveCore`: add `if (prState === 'invalid-arguments') return { action: 'skip', reason: 'invalid-arguments' };` beside the other two string checks.
- `resolveRunPrState(root, state, branch)`: when `state && state.pr && state.pr.number`, call `resolvePrStateByNumber(root, state.pr.number)`; return its result unless it is `null`; otherwise (no number, or `null`) return `resolvePrState(root, branch)`. Comment: why the number is the identity (#3416, reused branch names) and why a failure string never falls back to the branch.
- `archiveMergedRun`: take `state`; replace `resolvePrState(root, branch)` with `resolveRunPrState(root, state, branch)`; update its header comment.
- Both call sites pass `state`. The main loop's `!branch` by-number fallback block is unchanged; the clean sweep's `!branch` → `no-branch` skip is unchanged.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures (all pre-existing assertions unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Resolve a run's PR by stamped number in archive-merged — reused branch names no longer archive live runs"
```

### Task 2: Count per-spec staged items in `hasStagedItems`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`hasStagedItems` ~397)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `listSpecDirs(runDir) -> string[]` (existing, same file), Task 1's argv-aware `installGhWrapper`.
- Produces: `hasStagedItems(runDir) -> boolean` — same signature, widened to `spec-*/staged/`.

- [ ] **Step 1: Extend `fixtureOrdinaryMergedNoConsole` and add tests**

Add a 4th parameter `specStaged = {}` mapping a spec dir name to an array of entries; for each, create `{runDir}/{spec}/staged/` and write each entry (an empty array creates an empty `staged/`). Add a 5th-style option for the ENOTDIR case or build that one inline.

```js
test('AC5.1: a multi-spec run whose only staged items sit under spec-N/staged/ skips console-never-rendered (#3416)', () => {
  // fixtureOrdinaryMergedNoConsole('feat-3416-spec-staged', '2026-10-17T144508-spec-3375-3380', [], { 'spec-3375': ['review-1.patch', 'review-2.patch', 'reflect-1.md'] })
  // assert: not archived; skipped reason === 'console-never-rendered'; runDir still exists
});

test('AC5.2: a multi-spec run whose spec-*/staged/ are empty or absent still archives (#3249 fast path preserved) (#3416)', () => {
  // specStaged: { 'spec-3375': [], 'spec-3380': ['.DS_Store'] } plus an extra mkdir of spec-3381 with no staged/
  // assert: result.archived.includes(runDir)
});

test('AC5.1 fail-closed: a spec-N/staged that exists as a file (ENOTDIR) counts as pending (#3416)', () => {
  // spec-3375 dir created, {runDir}/spec-3375/staged written as a plain file
  // assert: not archived; skipped reason === 'console-never-rendered'
});
```

- [ ] **Step 2: Run the suite to verify the new tests fail on the pre-fix code**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1 — AC5.1 and AC5.1 fail-closed (archived instead of skipped). AC5.2 passes (fast path unchanged). Paste the failing names into the task report (AC6.1).

- [ ] **Step 3: Implement `hasStagedItems(runDir)`**

Check `path.join(runDir, 'staged')`, then each `path.join(runDir, name, 'staged')` for `name` of `listSpecDirs(runDir)`; return `true` as soon as any level has a non-dotfile entry or throws a non-ENOENT error; `false` otherwise. Update its comment: multi-spec layout (`plugin/skills/flow/multispec-run-dir-layout.md`), and that the divergence from `console/resolve.js`'s `readSnapshot` (top-level only) is deliberate.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Count spec-*/staged items in hasStagedItems — multi-spec runs with pending proposals are not archived"
```

### Task 3: Resolve claim-release PR state by stamped number

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`decideRelease` ~87, Phase 1.5 ~458-500, header comment ~320)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`

**Interfaces:**
- Consumes: `resolvePrStateByNumberAsync(root, n)`, `resolvePrStateAsync(root, branch)` from `./pr-state` (unchanged).
- Produces: `decideRelease(classifiedState, prState, issueState, closesIssue)` — same signature; `'invalid-arguments'` now skips with reason `'invalid-arguments'`.

- [ ] **Step 1: Write the failing tests and invert the obsolete one**

Replace `'releaseMerged: does not invoke the by-number fallback when the live-worktree join already resolved a branch'` with:

```js
test('releaseMerged: resolves by stamped pr.number ahead of the live-worktree branch join (#3416)', async () => {
  // same fixture as the test it replaces (live worktree on 'live-branch', pr: { number: 999999, branch: 'live-branch' }, issue-62 claim)
  // wrapper: *"pr view 999999"* → {"number":999999,"state":"MERGED",...,"closingIssuesReferences":[{"number":62,"repository":{"name":"w","owner":{"login":"acme"}}}]}
  //          *"pr list"* → echo "pr list must never be called when pr.number is stamped" >&2; exit 1
  //          *"api --method PUT"* → exit 0
  // assert: result.released.length === 1; result.released[0].prNumber === 999999
});
```

Add:

```js
test('AC3.1 AC3.2: a live claim whose stamped pr.number is OPEN is skipped pr-open and never released, even when its branch backs a MERGED PR that closes the issue (#3416)', async () => {
  // live worktree on 'reused-branch'; run-state pr: { number: 3406, branch: 'reused-branch' }; claim issue-3375.json live
  // wrapper: *"pr list --head reused-branch"* → [{"number":3391,"state":"MERGED",...,"closingIssuesReferences":[{"number":3375,"repository":{"name":"w","owner":{"login":"acme"}}}]}]
  //          *"pr view 3406"* → {"number":3406,"state":"OPEN",...}
  //          *"api --method PUT"* → touch '<putMarker>'; exit 0
  // ghApi records label deletes
  // assert: released.length === 0; skipped has { issueNumber: 3375, reason: 'pr-open' }; putMarker does not exist; no label deletes
});

test('AC3.1 transport failure: a failed by-number probe on a branch-resolved candidate skips network-failure, never releases via the branch PR (#3416)', async () => {
  // same as above but *"pr view 3406"* → echo "error connecting to api.github.com" >&2; exit 1
  // assert: released.length === 0; skipped reason === 'network-failure'; putMarker absent
});

test('decideRelease: invalid-arguments skips with reason invalid-arguments (#3416)', () => {
  assert.deepStrictEqual(decideRelease('live', 'invalid-arguments', undefined, undefined), { action: 'skip', reason: 'invalid-arguments' });
});
```

AC4.1's unchanged branch path is already pinned by the existing `'releaseMerged: Phase 1.5 resolves prState via the pool and reaches a merged-PR release decision'` and `'releaseMerged: an unstamped worktree with a fallbackBranch-recovered branch still joins by branch (#3249)'` (no `pr.number`); they must keep passing unmodified. The existing `'a failed by-number probe still lets a CLOSED issue release the claim via issue-closed (#3249)'` (no branch resolves) must also keep passing.

- [ ] **Step 2: Run the suite to verify the new tests fail on the pre-fix code**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL after Step 1 — the inverted test (pr list is called and exits 1 / prNumber 999999 not used), AC3.1 AC3.2 (released via PR #3391), AC3.1 transport failure (released), and the `decideRelease` invalid-arguments test. Paste the failing names into the task report (AC6.1).

- [ ] **Step 3: Implement**

- `decideRelease`: `if (prState === 'invalid-arguments') return { action: 'skip', reason: 'invalid-arguments' };` beside the `gh-absent`/`network-failure` checks.
- Phase 1.5: first pool every candidate with `c.prNumber` through `resolvePrStateByNumberAsync` (one `runWithConcurrency` batch). Per result: object → `c.prState = r; c.joinFailure = null`; `null` → leave for the branch pool; a failure string → if `c.joinFailure === null` (branch resolved) set `c.prState = r` (skip downstream), else leave `prState` null and `joinFailure` set (keeps today's issue-closed path). Then pool, through `resolvePrStateAsync`, every candidate with `c.joinFailure === null` whose `prState` is still unset (no number stamped, or by-number returned `null`). The old `needPrByNumber` block (join-failure-only) folds into the first pool. Update the Phase-list header comment and the Phase 1.5 comments.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the neighbouring reconcile suites**

Run: `node --test tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/bin-lib/reconcile/release-merged.test.js
git commit -m "Resolve claim-release PR state by stamped number — a reused branch's merged PR no longer releases a live run's claims"
```
