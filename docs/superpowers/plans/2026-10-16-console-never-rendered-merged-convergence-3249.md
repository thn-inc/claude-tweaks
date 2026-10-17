# Console-Never-Rendered Merged-Run Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fast-lane, pr-first-merged singleton run actually converge — claim released, grants/`bot:in-progress` stripped, run directory archived — instead of being permanently stuck because its worktree/branch are already gone by the time the post-merge reconcile sweep runs, and because its console was never written to disk.

**Architecture:** Two independent reconcile-check bugs, both rooted in the same shape (evidence that used to live in a now-torn-down worktree): (1) `release-merged.js`'s claim-release join derives the PR-bearing branch *only* from a live `git worktree list` entry, with no fallback once the worktree is reaped — add the same two-layer fallback (`fallbackBranch`, then a by-PR-number probe) `archive-merged.js` already uses for the identical shape (#1962); (2) `archive-merged.js`'s `decideArchiveCore` treats "no `console.json` on disk" as a permanent block, because the fast-lane auto-merge short-circuit (`wrap-up/auto-merge-short-circuit.md`) composes console content for a non-blocking PushNotification but never writes the file — add a narrowly-scoped exception that archives a `console.json`-less MERGED run only when its `staged/` directory holds nothing pending, preserving the #657/#1130 protection otherwise.

**Tech Stack:** Node.js (CommonJS), `node --test`, `gh` CLI (via this module's existing injectable/PATH-wrapper test seams) — no new dependencies.

**Spec:** GitHub issue #3249 ("Fast-lane pr-first merges never release their claim or archive their run (console-never-rendered)") — materialized at `.claude-tweaks/pipelines/2026-10-16T190415-record-3249/work/3249-spec.md`.

## Global Constraints

- Surgical changes only — do not reformat or restructure adjacent code; match the file's existing style exactly (this repo's CLAUDE.md Working Approach).
- Commit tests sized like the neighboring test files in the same suite — no new test infrastructure/helpers beyond what each file's existing conventions already provide.
- Every new or changed public function keeps the module's existing injectable-runner/PATH-wrapper test seam (`gh-api-module-pattern` convention) — never shell to a real `gh` in a test.
- `decideArchiveCore` must stay a pure function (no I/O) — any filesystem check (`staged/` directory listing) is computed by the caller and passed in as a plain boolean.
- Every new optional parameter defaults to preserving today's existing behavior for every caller that doesn't pass it — existing tests that call a changed function with its old argument count must keep passing unmodified, except the one test explicitly named in Task 3 whose assertion is deliberately flipped (it pins the exact bug this plan fixes).

## Review Focus

- A candidate with `runState.pr.number` set but `resolvePrStateByNumberAsync` returning `'gh-absent'`/`'network-failure'`/`'invalid-arguments'` must still land in `skipped` with a sensible reason — never throw, never silently drop the candidate from both `released` and `skipped`. Task 2's tests cover the MERGED-success path only; add a quick assertion that a `gh-absent`/`invalid-arguments` by-number result does not crash `releaseMerged`.
- A run dir whose `staged/` directory exists but is empty (zero files) must be treated identically to a run dir with no `staged/` directory at all (both "nothing pending") — don't let an empty-vs-absent distinction silently reintroduce the bug for the common "staged/ created, nothing ever staged into it" case.
- The by-number fallback in `release-merged.js` must never fire for a candidate whose branch *did* resolve (via the live worktree or `fallbackBranch`) — it is strictly a last-resort for `joinFailure !== null`, never a competing source of truth when ordinary evidence is already available.
- `decideArchiveCore`'s new archive-on-no-staged-pending exception must still correctly skip (not archive) a CLOSED, never-merged PR reached via the by-number fallback — only a MERGED PR with nothing pending in `staged/` gets the new behavior; a CLOSED PR keeps its existing `console-never-rendered-pr-closed` reason regardless of `staged/`'s contents (there's no run left to converge toward).
- `resolvePrStateByNumberAsync`'s argument validation (`byNumberArgsValid`) must reject the same malformed inputs the sync `resolvePrStateByNumber` already rejects (non-string `repoRoot`, non-positive-integer `number`) without ever reaching `execFileAsync` — mirror, don't re-derive, the existing guard.

---

### Task 1: Add `resolvePrStateByNumberAsync` to `pr-state.js`

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (add the function after `resolvePrStateAsync`, ~line 232; add to `module.exports`, ~line 302)
- Test: `tests/bin-lib/reconcile/pr-state.test.js` (add after the existing `resolvePrStateByNumber` tests, ~line 340)

**Interfaces:**
- Consumes: `execFileAsync` (already defined in this file, `promisify(execFile)`), `runClassifiedAsync` (already imported), `byNumberArgsValid`/`classifyByNumberError` (already defined in this file, used by the sync `resolvePrStateByNumber`), `FETCH_TIMEOUT_MS` (already defined).
- Produces: `resolvePrStateByNumberAsync(repoRoot, number)` — async, returns a Promise resolving to the same shape `resolvePrStateByNumber` returns synchronously: `{number, state, mergedAt, updatedAt, mergeCommit, mergeable, mergeStateStatus}` object, or `null` (falsy `number`), or one of the strings `'gh-absent'` / `'network-failure'` / `'invalid-arguments'`. Consumed by Task 2's `release-merged.js` changes.

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/reconcile/pr-state.test.js`, right after the last existing `resolvePrStateByNumber` test (the `mergeable`/`mergeStateStatus` one):

```js
test('resolvePrStateByNumberAsync: no number -> null, no gh call', async () => {
  assert.equal(await resolvePrStateByNumberAsync('/tmp', null), null);
  assert.equal(await resolvePrStateByNumberAsync('/tmp', undefined), null);
});

test('resolvePrStateByNumberAsync: resolves the single PR by number (no tie-break needed)', async () => {
  const pr = { number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid: 'a'.repeat(40) } };
  const wrapper = installGhWrapper(pr);
  try {
    const result = await resolvePrStateByNumberAsync('/tmp', 42);
    assert.equal(result.number, 42);
    assert.equal(result.state, 'MERGED');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumberAsync: gh absent -> gh-absent, no throw', async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-path-with-no-gh';
  try {
    assert.equal(await resolvePrStateByNumberAsync('/tmp', 42), 'gh-absent');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('resolvePrStateByNumberAsync: malformed gh output -> network-failure, no throw', async () => {
  const wrapper = installGhWrapper('#!/bin/sh\necho "not json"\n');
  try {
    assert.equal(await resolvePrStateByNumberAsync('/tmp', 42), 'network-failure');
  } finally {
    wrapper.restore();
  }
});

test('resolvePrStateByNumberAsync: malformed/misordered call -> invalid-arguments, no gh call (#3029 shape)', async () => {
  assert.equal(await resolvePrStateByNumberAsync(4242, { cwd: '/tmp' }), 'invalid-arguments');
  assert.equal(await resolvePrStateByNumberAsync('/tmp', -1), 'invalid-arguments');
  assert.equal(await resolvePrStateByNumberAsync('/tmp', '4.2'), 'invalid-arguments');
});
```

Also add `resolvePrStateByNumberAsync` to this test file's destructured import at the top (line 8-10):

```js
const {
  resolvePrState, resolvePrStateAsync, resolvePrStatesBulk, resolvePrStateByNumber, resolveIssueStateByNumber, resolvePrStateByNumberAsync, BULK_CHUNK,
} = require('../../../plugin/bin/lib/reconcile/pr-state');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: FAIL — `resolvePrStateByNumberAsync is not a function` (it doesn't exist yet).

- [ ] **Step 3: Implement `resolvePrStateByNumberAsync`**

In `plugin/bin/lib/reconcile/pr-state.js`, add this function immediately after `resolvePrStateAsync` (which ends around line 232, just before the `const BULK_TIMEOUT_MS = 15000;` line):

```js
// Async twin of resolvePrStateByNumber — mirrors resolvePrStateAsync's
// non-blocking execFile shape (#3249) so release-merged.js's by-number
// fallback can run through gh-pool's runWithConcurrency the same way its
// branch-based Phase 1.5 probe already does, rather than blocking the
// event loop once per candidate. Same argument validation, same return
// shape, same classifyByNumberError mapping as the sync version.
async function resolvePrStateByNumberAsync(repoRoot, number) {
  if (!number) return null;
  if (!byNumberArgsValid(repoRoot, number)) return 'invalid-arguments';
  return runClassifiedAsync(
    async () => {
      const { stdout } = await execFileAsync(
        'gh',
        ['pr', 'view', String(number), '--json', 'number,state,mergedAt,updatedAt,mergeCommit,mergeable,mergeStateStatus'],
        { cwd: repoRoot, encoding: 'utf8', timeout: FETCH_TIMEOUT_MS, windowsHide: true },
      );
      return JSON.parse(stdout);
    },
    classifyByNumberError(repoRoot),
    { retryOnTimeout: true },
  );
}
```

Then update `module.exports` (currently at the end of the file) to include it:

```js
module.exports = {
  resolvePrState, resolvePrStateAsync, resolvePrStatesBulk, resolvePrStateByNumber, resolveIssueStateByNumber, resolvePrStateByNumberAsync,
  FETCH_TIMEOUT_MS, BULK_CHUNK,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state.test.js`
Expected: PASS (all tests in the file, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state.js tests/bin-lib/reconcile/pr-state.test.js
git commit -m "Add resolvePrStateByNumberAsync — the async twin release-merged.js's by-number fallback needs — refs #3249"
```

---

### Task 2: `release-merged.js` — fall back to `fallbackBranch` / by-PR-number when the worktree is gone

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (imports near the top; the Phase 1 candidate-building loop; Phase 1.5)
- Test: `tests/bin-lib/reconcile/release-merged.test.js` (add new tests after the existing `releaseMerged: Phase 1.5 resolves prState...` test)

**Interfaces:**
- Consumes: `resolvePrStateByNumberAsync` (Task 1, from `./pr-state`), `fallbackBranch` (`../hooks/run-integrity.js`, already used by `archive-merged.js` for the identical shape), `runWithConcurrency` (already imported in this file), `decideRelease`/`needsIssueEvidence` (already defined in this file, unchanged signatures).
- Produces: no new exported function — `releaseMerged`'s existing exported behavior widens (more claims resolve to `released` than before) but its signature (`releaseMerged({ cwd, ghApi })` → `{ released, skipped, failure }`) is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/reconcile/release-merged.test.js`, after the existing `'releaseMerged: Phase 1.5 resolves prState via the pool and reaches a merged-PR release decision'` test (around line 264):

```js
// #3249: the exact shape the record names — the worktree this claim's
// run-state.json pointed at has already been torn down (the normal
// post-merge-teardown timing, not an edge case), AND the branch name
// itself has been deleted (pr-first-merge-post-merge.md Step 5), so
// neither the live-worktree join nor fallbackBranch's branchExists check
// can recover a branch to query `gh pr list --head` with. Before this
// fix, this candidate's joinFailure stayed 'no-branch' forever, prState
// stayed null forever, and decideRelease only ever consulted issue-state
// evidence — which may lag the merge. run-state.json's pr.number (stamped
// once at PR-early-lifecycle time, never cleared) is what the by-number
// fallback resolves instead.
test('releaseMerged: releases a live claim via the by-number fallback when the worktree AND its branch are both gone (#3249)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  // No worktree is ever created for this run — simulates one already
  // reaped by the time this reconcile pass runs. No branch of this name
  // exists in this checkout either, so fallbackBranch's branchExists check
  // also fails — the only surviving evidence is run-state.json's pr.number.
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-gone-3249');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'already-reaped'),
    pr: { number: 3249001, branch: 'already-deleted-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-gone-3249', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-61.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-61.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null }; // removeInProgressLabel/removeGrantLabels, best-effort
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  // A `gh` wrapper on PATH answers `gh pr view 3249001 ...` with a merged PR
  // — `gh pr list --head {branch}` must never be called (no branch resolved).
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr view 3249001"*) cat <<\'EOF\'\n'
    + '{"number":3249001,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","mergeCommit":{"oid":"deadbeef"}}\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr list"*) echo "pr list must never be called when no branch resolved" >&2; exit 1 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1, `expected the by-number fallback to release the claim, got ${JSON.stringify(result)}`);
    assert.equal(result.released[0].issueNumber, 61);
    assert.equal(result.released[0].prNumber, 3249001);
  } finally {
    process.env.PATH = originalPath;
  }
});

// Companion: the by-number fallback must never fire (and never call `gh pr
// view`) for a candidate whose branch actually resolved via the ordinary
// live-worktree join — it is strictly a last resort.
test('releaseMerged: does not invoke the by-number fallback when the live-worktree join already resolved a branch', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-unused-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  const wtPath = path.join(root, '.worktrees', 'wt-run-live-branch');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'live-branch', wtPath], { cwd: root });

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-live-branch');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: wtPath, pr: { number: 999999, branch: 'live-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-live-branch', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-62.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-62.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-unused-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr list --head live-branch"*) cat <<\'EOF\'\n'
    + '[{"number":77,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr view 999999"*) echo "by-number must never be called when the branch already resolved" >&2; exit 1 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1);
    assert.equal(result.released[0].prNumber, 77, 'must use the branch-resolved PR, never the by-number one');
  } finally {
    process.env.PATH = originalPath;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL — the first new test (`releases a live claim via the by-number fallback...`) reports `result.released.length` as `0`, not `1` (the claim lands in `skipped` with reason `'no-branch'` on current code, since `joinFailure` is never cleared and `prState` is never resolved).

- [ ] **Step 3: Implement the fallback in `release-merged.js`**

First, widen the imports near the top of the file (currently, around line 12-20):

```js
const { readRunState } = require('../hooks/context');
```

becomes:

```js
const { readRunState } = require('../hooks/context');
const { fallbackBranch } = require('../hooks/run-integrity');
```

And the existing `pr-state` import:

```js
const { resolvePrStateAsync } = require('./pr-state');
```

becomes:

```js
const { resolvePrStateAsync, resolvePrStateByNumberAsync } = require('./pr-state');
```

Next, in the Phase 1 candidate-building loop (the `for (const entry of entries)` loop), find this block:

```js
    let runId = null;
    try { runId = JSON.parse(claim.content).runId || null; } catch { /* falls through to no-run-id below */ }
    if (!runId) {
      skipped.push({ issueNumber, reason: 'no-run-id' });
      continue;
    }

    let joinFailure = null; // 'no-run-state' | 'no-branch' — preserved as the skip reason when no evidence releases
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    const runState = readRunState(runDir);
    const wtEntry = runState && runState.worktree
      ? worktrees.find((w) => path.resolve(w.path) === path.resolve(runState.worktree))
      : null;
    const branch = wtEntry ? wtEntry.branch : null;
    if (!runState || !runState.worktree) {
      joinFailure = 'no-run-state'; // archived/gone run dir — issue-closed evidence below may still release
    } else if (!branch) {
      joinFailure = 'no-branch';
    }
    // prState is resolved in Phase 1.5 below (deferred so the per-active-claim
    // `gh pr list` call goes through the pool, not this sync loop) — null here
    // is a placeholder, never a "no PR" result; joinFailure gates whether
    // Phase 1.5 attempts the fetch at all.

    // `sha` here is claim.sha (this fresh read's blob sha, NOT the earlier
    // listing's entry.sha) — the same sha writeTombstone below treats as
    // authoritative for its conditional write, and the same distinction
    // the `!isActive` cache-write above draws for exactly the same reason.
    candidates.push({
      issueNumber, runId, name: entry.name, sha: claim.sha, classifiedState: classified.state, prState: null, joinFailure, branch, runDir,
    });
```

Replace it with:

```js
    let runId = null;
    try { runId = JSON.parse(claim.content).runId || null; } catch { /* falls through to no-run-id below */ }
    if (!runId) {
      skipped.push({ issueNumber, reason: 'no-run-id' });
      continue;
    }

    let joinFailure = null; // 'no-run-state' | 'no-branch' — preserved as the skip reason when no evidence releases
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    const runState = readRunState(runDir);
    const wtEntry = runState && runState.worktree
      ? worktrees.find((w) => path.resolve(w.path) === path.resolve(runState.worktree))
      : null;
    // #3249: a live worktree entry wins; when it's gone (the ordinary
    // post-merge-teardown timing, not an edge case under `integration-model:
    // pr-first`), fallbackBranch recovers the branch name from
    // run-state.json's pr.branch (stamped once, live, by hooks.js
    // record-pr) or decisions.md, as long as that branch ref still
    // resolves — mirrors archive-merged.js's identical fallback for this
    // exact shape (#1962/#1684).
    const branch = (wtEntry && wtEntry.branch) || fallbackBranch(root, runDir, runState);
    // Surviving evidence when BOTH the worktree and the branch itself are
    // gone (e.g. pr-first-merge-post-merge.md Step 5 already deleted the
    // remote ref) — run-state.json's pr.number, stamped once at
    // PR-early-lifecycle time and never cleared.
    const prNumber = runState && runState.pr && runState.pr.number ? runState.pr.number : null;
    if (!runState || !runState.worktree) {
      joinFailure = 'no-run-state'; // archived/gone run dir — issue-closed evidence below may still release
    } else if (!branch) {
      joinFailure = 'no-branch';
    }
    // prState is resolved in Phase 1.5 below (deferred so the per-active-claim
    // `gh pr list` call goes through the pool, not this sync loop) — null here
    // is a placeholder, never a "no PR" result; joinFailure gates whether
    // Phase 1.5 attempts the fetch at all.

    // `sha` here is claim.sha (this fresh read's blob sha, NOT the earlier
    // listing's entry.sha) — the same sha writeTombstone below treats as
    // authoritative for its conditional write, and the same distinction
    // the `!isActive` cache-write above draws for exactly the same reason.
    candidates.push({
      issueNumber, runId, name: entry.name, sha: claim.sha, classifiedState: classified.state, prState: null, joinFailure, branch, prNumber, runDir,
    });
```

Then, in Phase 1.5, find this block:

```js
  const needPrState = candidates.filter((c) => c.joinFailure === null);
  const prStates = await runWithConcurrency(
    needPrState,
    (c) => resolvePrStateAsync(root, c.branch),
  );
  const prStateByIssue = new Map(
    needPrState.map((c, i) => [c.issueNumber, prStates[i] instanceof Error ? 'network-failure' : prStates[i]]),
  );
  for (const c of candidates) {
    if (c.joinFailure === null) c.prState = prStateByIssue.get(c.issueNumber);
  }
```

and add this immediately after it (still inside the async function, before Phase 2):

```js

  // #3249: a candidate whose branch could not be derived at all (joinFailure
  // still set — the ordinary branch join above, including its own
  // fallbackBranch layer, found nothing) still carries a by-number fallback
  // when run-state.json stamped pr.number — probe it directly, the same
  // escape hatch archive-merged.js's own by-number fallback uses for the
  // identical "worktree AND branch both gone" shape (#1962). Gated on
  // c.prNumber so this never fires for a run dir with no pr field at all
  // (an already-archived run with no run-state.json, for instance).
  const needPrByNumber = candidates.filter((c) => c.joinFailure !== null && c.prNumber);
  const prStatesByNumber = await runWithConcurrency(
    needPrByNumber,
    (c) => resolvePrStateByNumberAsync(root, c.prNumber),
  );
  const prStateByNumberByIssue = new Map(
    needPrByNumber.map((c, i) => [c.issueNumber, prStatesByNumber[i] instanceof Error ? 'network-failure' : prStatesByNumber[i]]),
  );
  for (const c of candidates) {
    if (c.joinFailure !== null && c.prNumber) {
      const byNumber = prStateByNumberByIssue.get(c.issueNumber);
      if (byNumber && typeof byNumber === 'object') {
        // Real evidence recovered — this candidate now behaves exactly like
        // an ordinary branch-joined one for decideRelease's purposes, and
        // Phase 2 below gates its own issue-evidence fetch on this same
        // prState, so a resolved MERGED/OPEN/CLOSED result here correctly
        // skips an unnecessary issue-state lookup.
        c.prState = byNumber;
        c.joinFailure = null;
      } else if (byNumber === 'gh-absent' || byNumber === 'network-failure') {
        c.prState = byNumber;
      }
      // 'invalid-arguments' (malformed prNumber — shouldn't happen given the
      // truthy-number gate above, but fails closed) leaves joinFailure and
      // prState untouched; Phase 2 still tries issue evidence as before.
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: PASS (every test in the file, including every pre-existing one — this change is additive).

Also run the full reconcile suite to confirm nothing else regressed:

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/pr-state.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js tests/bin-lib/reconcile/release-merged.test.js
git commit -m "release-merged.js: fall back to fallbackBranch/by-PR-number when the worktree is already gone — refs #3249"
```

---

### Task 3: `archive-merged.js` — archive a console-never-rendered MERGED run when nothing is pending in `staged/`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`decideArchiveCore`, ~line 319; `classifyRunDir`'s `'merged'` branch, ~line 1444; the by-number fallback's inline console check, ~line 1827-1851)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (flip one existing test's expectation, add two new ones)

**Interfaces:**
- Consumes: `fs.readdirSync` (new local helper, no new import).
- Produces: `decideArchiveCore(prState, consoleState, hasStagedPending)` — widened signature, third parameter optional (`undefined` preserves today's behavior exactly: `consoleState === 'none'` always skips). A new local helper `hasStagedItems(runDir)` (not exported — internal to this file, mirrors the file's existing unexported helpers like `readConsoleState`).

- [ ] **Step 1: Write the failing tests**

First, **flip the existing pinned-bug test**. In `tests/bin-lib/reconcile/archive-merged.test.js`, find this test (around line 2485):

```js
// Companion case: the MERGED sub-case of the same fallback branch must
// keep emitting plain 'console-never-rendered' and must NOT be tracked —
// code landed there, so a console may genuinely still be pending; only the
// CLOSED sub-case changes in this fix.
test('archiveMerged: a MERGED PR reached via the by-number fallback with no console.json still uses plain console-never-rendered and is never tracked', () => {
```

Replace the comment and test body with (same fixture, new expectation — this is the exact scenario #3249 names: a fast-lane auto-merge short-circuit's console was never written, and nothing was ever staged, so it's safe to archive):

```js
// #3249: the MERGED sub-case of the same fallback branch used to stay
// stuck on plain 'console-never-rendered' forever — the fast-lane
// auto-merge short-circuit (wrap-up/auto-merge-short-circuit.md) renders
// its console content as a non-blocking PushNotification FYI and never
// writes console.json, so this state was permanent for every such run,
// not "a console may still be pending". When staged/ holds nothing
// pending (this fixture's case — no staged/ directory at all), the run
// now archives instead.
test('archiveMerged: a MERGED PR reached via the by-number fallback with no console.json and nothing staged now archives (#3249)', () => {
```

Then update its body — the two assertions that pinned the old skip behavior:

```js
  assert.ok(!result.archived.includes(runDir));
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'console-never-rendered');

  const failures = listResidueFailures(root);
  assert.ok(
    !failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `a MERGED PR's never-rendered console must not be tracked toward escalation, got ${JSON.stringify(failures)}`,
  );
```

become:

```js
  assert.ok(result.archived.includes(runDir), `expected ${runDir} archived, got ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(runDir), false, 'the run dir must have been archived away');

  const failures = listResidueFailures(root);
  assert.ok(
    !failures.some((f) => f.reason === 'structurally-stuck' && f.path === runDir),
    `an archived run must never be tracked toward structurally-stuck escalation, got ${JSON.stringify(failures)}`,
  );
```

(Leave everything else in the test — the `fs.mkdirSync`/`fs.writeFileSync`/`installGhWrapper` setup, the `stuckBackdated` mtime stamp — exactly as it is; only the assertions after the `archiveMerged` call change.)

Second, **add a companion test proving the #657/#1130 protection still holds** when `staged/` genuinely has a pending item. Add this immediately after the test above:

```js
// Companion (#657/#1130 protection, preserved): the SAME shape as above,
// except staged/ holds a real pending file — this run must still skip,
// never silently archived out from under an unresolved staged proposal.
test('archiveMerged: a MERGED PR reached via the by-number fallback with no console.json but a pending staged/ item still skips (#3249, #657 protection)', () => {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-3249-merged-staged-pending');
  git(root, 'branch', '-D', 'feat-3249-merged-staged-pending'); // branch ref gone too — nothing for fallbackBranch to recover
  const runId = '2026-08-01T090000-record-3249-mergedpr-staged';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'gone-record-3249-staged'),
    pr: { number: 3249002, branch: 'feat-3249-merged-staged-pending' },
  }));
  // Deliberately no console.json — same "never rendered" shape — but
  // staged/ holds a real pending proposal nobody has acted on yet.
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'staged', 'review-1.patch'), 'diff --git a/x b/x\n');
  const stuckBackdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(runDir, stuckBackdated, stuckBackdated);

  const wrapper = installGhWrapper({
    number: 3249002, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  });
  let result;
  try {
    result = archiveMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.ok(!result.archived.includes(runDir), 'a run with a genuinely pending staged/ item must never be archived out of sight');
  const skip = result.skipped.find((s) => s.runDir === runDir);
  assert.ok(skip, `expected ${runDir} reported in skipped, got ${JSON.stringify(result)}`);
  assert.equal(skip.reason, 'console-never-rendered');
  assert.equal(fs.existsSync(runDir), true);
});
```

Third, add a direct unit test for `decideArchiveCore`'s new parameter, near the existing `#1854` test (around line 2529) — import `decideArchiveCore` at the top of the test file if it isn't already (check the existing `require(...)` destructure at the top of the file first; add `decideArchiveCore` to it if missing):

```js
// #3249: decideArchiveCore's new third parameter — defaults (2-arg calls,
// every pre-existing caller) preserve today's unconditional skip; only an
// explicit `hasStagedPending: false` unlocks the archive path.
test('decideArchiveCore: consoleState none + MERGED + no 3rd arg still skips (unchanged default)', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none');
  assert.deepStrictEqual(decision, { action: 'skip', reason: 'console-never-rendered' });
});
test('decideArchiveCore: consoleState none + MERGED + hasStagedPending:true skips', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none', true);
  assert.deepStrictEqual(decision, { action: 'skip', reason: 'console-never-rendered' });
});
test('decideArchiveCore: consoleState none + MERGED + hasStagedPending:false archives (#3249)', () => {
  const decision = decideArchiveCore({ state: 'MERGED' }, 'none', false);
  assert.deepStrictEqual(decision, { action: 'archive' });
});
test('decideArchiveCore: consoleState unresolved still skips regardless of hasStagedPending', () => {
  assert.deepStrictEqual(decideArchiveCore({ state: 'MERGED' }, 'unresolved', false), { action: 'skip', reason: 'console-unresolved' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — the flipped test (`...now archives (#3249)`) reports `result.archived` not containing `runDir` (current code still skips); the new `decideArchiveCore` 3-arg `hasStagedPending:false` test reports `{ action: 'skip', reason: 'console-never-rendered' }` instead of `{ action: 'archive' }` (the parameter doesn't exist yet, so it's ignored). The new staged-pending companion test should already pass today (current code already skips unconditionally) — that's expected; it becomes a real regression pin once Step 3 lands, not before.

- [ ] **Step 3: Implement the fix**

First, add the `hasStagedItems` helper immediately after `readConsoleState` (around line 363, right after that function's closing brace):

```js
// #3249: whether this run's staged/ directory holds any file at all —
// used to distinguish "nothing was ever staged, safe to archive on a
// never-rendered console" from "staged/ genuinely holds unapproved items"
// (the #657/#1130 protection this file's console-never-rendered skip
// exists for). Returns false when the directory doesn't exist or is
// empty — an absent and an empty staged/ directory are the same signal
// (nothing pending), never distinguished.
function hasStagedItems(runDir) {
  try {
    return fs.readdirSync(path.join(runDir, 'staged')).length > 0;
  } catch {
    return false;
  }
}
```

Next, widen `decideArchiveCore` (currently at line 319):

```js
function decideArchiveCore(prState, consoleState) {
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (!prState) return { action: 'skip', reason: 'no-pr' };
  if (prState.state !== 'MERGED') {
    return { action: 'skip', reason: prState.state === 'OPEN' ? 'pr-open' : 'pr-closed-unmerged' };
  }
  if (consoleState === 'unresolved') return { action: 'skip', reason: 'console-unresolved' };
  // #1130: this sweep's population is non-terminal runs only
  // (iterRunDirsWithState skips status:'clean'), so an absent console.json
  // here always means wrap-up never rendered a console for this run — never
  // the empty-console fast path, which closes the run terminal and archives
  // via the archive-run verb without ever reaching this sweep. Archiving on
  // mere PR-merge swept live runs with pending staged decisions (#657).
  if (consoleState === 'none') return { action: 'skip', reason: 'console-never-rendered' };
  return { action: 'archive' };
}
```

becomes:

```js
function decideArchiveCore(prState, consoleState, hasStagedPending) {
  if (prState === 'gh-absent') return { action: 'skip', reason: 'gh-absent' };
  if (prState === 'network-failure') return { action: 'skip', reason: 'network-failure' };
  if (!prState) return { action: 'skip', reason: 'no-pr' };
  if (prState.state !== 'MERGED') {
    return { action: 'skip', reason: prState.state === 'OPEN' ? 'pr-open' : 'pr-closed-unmerged' };
  }
  if (consoleState === 'unresolved') return { action: 'skip', reason: 'console-unresolved' };
  // #1130: this sweep's population is non-terminal runs only
  // (iterRunDirsWithState skips status:'clean'), so an absent console.json
  // here always means wrap-up never rendered a console for this run — never
  // the empty-console fast path, which closes the run terminal and archives
  // via the archive-run verb without ever reaching this sweep. Archiving on
  // mere PR-merge swept live runs with pending staged decisions (#657).
  //
  // #3249: that protection is about a run with genuinely *pending, unresolved*
  // staged decisions — but the fast-lane auto-merge short-circuit
  // (wrap-up/auto-merge-short-circuit.md) renders its console content as a
  // non-blocking PushNotification FYI and never writes console.json at all,
  // making this skip permanent for every such run regardless of whether
  // anything was ever actually staged. `hasStagedPending` is computed by the
  // caller (this function stays pure — no I/O of its own) from the run's own
  // staged/ directory; only an explicit `false` unlocks the archive path, so
  // every existing 2-arg call site (and any caller that genuinely doesn't
  // know) keeps today's unconditional skip.
  if (consoleState === 'none') {
    if (hasStagedPending === false) return { action: 'archive' };
    return { action: 'skip', reason: 'console-never-rendered' };
  }
  return { action: 'archive' };
}
```

Next, wire this into `classifyRunDir`'s `'merged'` branch (currently at line 1444-1449):

```js
    } else if (kind === 'merged') {
      if (prState !== undefined) {
        const decision = decideArchiveCore(prState, consoleState);
        if (decision.action === 'archive') return { kind: 'merged', ttlMs: null, evidence: {} };
        return { kind: 'none', ttlMs: null, evidence: { skipReason: decision.reason } };
      }
```

becomes:

```js
    } else if (kind === 'merged') {
      if (prState !== undefined) {
        // #3249: `dir` is this ctx's own run directory (already present on
        // every real caller) — undefined only in a handful of direct
        // classifyRunDir unit tests that don't set it, where `hasStagedItems`
        // is skipped entirely (hasStagedPending stays undefined, preserving
        // the existing unconditional skip for those fixtures).
        const hasStagedPending = dir ? hasStagedItems(dir) : undefined;
        const decision = decideArchiveCore(prState, consoleState, hasStagedPending);
        if (decision.action === 'archive') return { kind: 'merged', ttlMs: null, evidence: {} };
        return { kind: 'none', ttlMs: null, evidence: { skipReason: decision.reason } };
      }
```

Finally, update the inline by-number fallback's own console check (currently around lines 1827-1848):

```js
          const consoleState = readConsoleState(dir);
          if (consoleState === 'unresolved') {
            skipped.push({ runDir: dir, reason: 'console-unresolved' });
            continue;
          }
          if (consoleState === 'none') {
            // #2231: a CLOSED (never-merged) PR's console will never
            // render — nothing drives this run's pipeline to wrap-up
            // anymore, so the plain 'console-never-rendered' reason's
            // usual "a human answers the console" resolution path
            // (STRUCTURALLY_STUCK_REASONS' own comment above) does not
            // apply here. Use a distinct, tracked reason so this
            // genuinely dead-ended state escalates like no-branch/
            // no-worktree/no-pr, instead of silently freezing the
            // escalation cache the way plain 'console-never-rendered'
            // does today (that reason stays untracked for the MERGED
            // case, where a console really may still be pending).
            const consoleReason = byNumber.state === 'CLOSED' ? 'console-never-rendered-pr-closed' : 'console-never-rendered';
            skipped.push({ runDir: dir, reason: consoleReason });
            trackStuckSkip(cacheBatch, repoSlug, dir, consoleReason, { runner });
            continue;
          }
          finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
          continue;
```

becomes:

```js
          const consoleState = readConsoleState(dir);
          if (consoleState === 'unresolved') {
            skipped.push({ runDir: dir, reason: 'console-unresolved' });
            continue;
          }
          if (consoleState === 'none') {
            // #3249: a MERGED PR with nothing pending in staged/ is the
            // fast-lane auto-merge short-circuit's own normal shape — its
            // console was never written at all, not left unresolved — so
            // archive it the same way the ordinary branch-joined path now
            // does (decideArchiveCore's hasStagedPending exception above).
            // A CLOSED (never-merged) PR keeps the distinct, tracked reason
            // below unconditionally — there's no run left to converge
            // toward regardless of staged/'s contents.
            if (byNumber.state === 'MERGED' && !hasStagedItems(dir)) {
              finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
              continue;
            }
            // #2231: a CLOSED (never-merged) PR's console will never
            // render — nothing drives this run's pipeline to wrap-up
            // anymore, so the plain 'console-never-rendered' reason's
            // usual "a human answers the console" resolution path
            // (STRUCTURALLY_STUCK_REASONS' own comment above) does not
            // apply here. Use a distinct, tracked reason so this
            // genuinely dead-ended state escalates like no-branch/
            // no-worktree/no-pr, instead of silently freezing the
            // escalation cache the way plain 'console-never-rendered'
            // does today (that reason stays untracked for the MERGED
            // case, where a console really may still be pending).
            const consoleReason = byNumber.state === 'CLOSED' ? 'console-never-rendered-pr-closed' : 'console-never-rendered';
            skipped.push({ runDir: dir, reason: consoleReason });
            trackStuckSkip(cacheBatch, repoSlug, dir, consoleReason, { runner });
            continue;
          }
          finishArchiveAttempt(cacheBatch, repoSlug, dir, dryRun, runner, archived, skipped, () => archiveRunDir(root, dir));
          continue;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS (every test in the file, including every pre-existing one, the flipped test, and the two new ones).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "archive-merged.js: archive a console-never-rendered MERGED run when staged/ holds nothing pending — refs #3249"
```

---

### Task 4: Re-verify `pr-first-merge-post-merge.md` Step 4.2's wording against the fixed behavior

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (Step 4.2, the paragraph describing the reconcile call's degrade behavior)

**Interfaces:**
- Consumes: nothing code-level — this task is a documentation accuracy check against Tasks 2/3's fix, with no behavioral change of its own.
- Produces: no new interface.

This is not a TDD code task (no production code changes) — it is a verification-plus-documentation task, since this file is prose consumed by the pipeline, not a module `node --test` exercises directly.

- [ ] **Step 1: Re-read the current wording**

Read `plugin/skills/_shared/pr-first-merge-post-merge.md`'s Step 4.2 section in full (it is short — about a dozen lines). Confirm it still reads, in substance: "This is convergent cleanup, not owed — a failure here (network, `gh` blip) is logged and left for the next trigger point, never retried inline and never a reason to report anything other than `merged`."

- [ ] **Step 2: Confirm the claim is now true for the specific gap this plan closes**

With Tasks 2 and 3 landed, the exact two gaps the record names (`releaseMerged` never releasing a live claim whose worktree/branch are gone; `decideArchiveCore` permanently skipping a console-never-rendered MERGED run) now resolve **within this same reconcile call** — `hooks.js reconcile --checks mirror,release,archive` runs `release` and `archive` in the same pass Step 4.2 already invokes, so a run that used to be stuck forever now converges on this very call, not merely "at the next trigger point." The existing wording's claim ("left for the next trigger point... never retried inline") was true as *written* for an actual transient failure (network, `gh` blip); it was *misleading* only because, for this specific structural cause, no later trigger point could ever actually converge it — Deliverable #3's root complaint. Since Tasks 2/3 remove that structural dead end, the only reconcile failures this step can still degrade on are genuinely transient ones, for which the existing wording is accurate as written.

- [ ] **Step 3: Add one clarifying sentence**

In `plugin/skills/_shared/pr-first-merge-post-merge.md`, find Step 4.2's paragraph:

```markdown
`--checks mirror,release,archive` scopes the sweep to exactly what this step needs — the full
`ALL_CHECKS` default also runs `red-tip`/`reap`/`archive-branches`/`remote-prune`/`console`, none
of which this step's own next paragraph describes needing, and `remote-prune`'s inclusion is what
forces the full `--prune all-refs` fetch (`shared-fetch.js`) instead of the single-ref fetch a
`mirror`-only request uses. Fast-forwards the mirror (the local integration branch — "mirror" and
"local main" name the same object; this file uses "mirror" throughout since that is
`bin/lib/reconcile`'s own term), releases the claim, and archives the run dir. This is convergent
cleanup, not owed — a failure
here (network, `gh` blip) is logged and left for the next trigger point, never retried inline and
never a reason to report anything other than `merged`. **No `git merge`, `git commit`, or
`git push` runs in the main checkout anywhere in this procedure** — the reconciler's own
`mirrorFastForward` is a strict `--ff-only`, never a merge that could conflict, so it needs no
worktree, no branch guard, and no close-run relief.
```

Append one sentence after "never a reason to report anything other than `merged`":

```markdown
(`release`'s own join and `archive`'s own `console.json` check both now fall back past a torn-down
worktree/branch — a run whose worktree is already gone by the time this call runs converges in this
same pass, not merely "eventually"; see `release-merged.js`'s `fallbackBranch`/by-number fallback and
`archive-merged.js`'s `decideArchiveCore` staged-item exception, #3249.)
```

- [ ] **Step 4: Verify the prose change didn't break any conformance test**

Run: `node --test tests/skill-prose-conformance.test.js`

(If no such single file exists, run the full suite's skill-prose-conformance suite — check `tests/` for the exact file/directory name via `ls tests/ | grep -i conformance` first; this repo pins skill prose with dedicated `node --test` suites per the `skill-prose-conformance-tests` convention.)
Expected: PASS — this is an additive sentence inside an existing paragraph, not a restructuring; no byte-pinned assertion should reference this exact sentence boundary.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge-post-merge.md
git commit -m "pr-first-merge-post-merge.md: note that release/archive now converge past a torn-down worktree — refs #3249"
```

---

## Final Step: Full suite

- [ ] Run: `npm test`
- [ ] Expected: PASS (full suite, including every file touched above plus everything else — this repo's CLAUDE.md notes a run-to-run flake tolerance tracks machine load, not a regression; re-run only the affected file(s) in isolation before concluding anything is actually broken).
