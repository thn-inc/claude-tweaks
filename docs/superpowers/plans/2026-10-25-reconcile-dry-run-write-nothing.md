# reconcile --dry-run writes nothing; escalate/resolve failures say why — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reconcile --dry-run` write neither `reconcile-cache.json` nor GitHub, and report what it would have done instead. Give swallowed escalate/resolve failures one recorded, surfaced reason.

**Architecture:** `cache.js` gains one error field on residue entries (`lastResidueError`) and a dry-run mode for `trackResidue`/`commitCacheBatch` that computes the would-be action without mutating anything. `archive-merged.js` threads `dryRun` into every residue call and returns the dry-run plan plus this pass's prune failures. `reconcile()` (`index.js`) skips its end-of-pass cache writes on a dry run, and adds `residuePlan` and `residueErrors` to its result. The residue summary line names failing escalations.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/archive/2026-10-25T094343-record-4180/work/4180-spec.md` (record #4180)

## Global Constraints

- A dry run writes neither the cache nor GitHub; it reports what it would have done (Deliverable 1).
- One channel for swallowed escalate/resolve failures: the reason sits on the cache entry and appears in reconcile's JSON output and residue summary (Deliverable 2).
- Non-dry-run behavior is unchanged: the existing reconcile suites pass (AC3.1). In particular: a failed escalation still leaves `escalated: true`; `pruneResidueFailures` still drops a gone path's entry whatever its resolve returns; `clearResidue`'s return shape `{ cleared, resolved }` is unchanged.
- Every new test must be red on the pre-change code (Deliverable 3). Before committing, prove it by reverting the source change, running the test, and seeing it fail.
- `plugin/bin/lib/reconcile/` modules never throw out of a residue call (never-break-a-session, `docs/hooks.md`).
- Commit subjects use `{Verb} {what} — {detail}` and carry `refs #4180`, never `closes`/`fixes`.

## Review Focus

1. **A dry run over a cache batch that already holds an entry.** The dry-run plan must read the existing count/escalated flag from the batch's in-memory cache, not from disk. Pinned in Task 2 (`#4180 dry-run trackResidue reads an existing batch entry`).
2. **A resolve that throws, rather than returning `resolution-failed`.** It must record a reason too (the thrown error's text), not only the returned-status case. Pinned in Task 1.
3. **`escalate` returning `escalation-failed` vs throwing.** Both are failures; both record `op: 'escalate'`. Pinned in Task 1.
4. **A later successful pass clears the error.** When an entry is dropped (resolve success, path success), its `lastResidueError` goes with it. No stale error survives a recovered path. Pinned in Task 1.
5. **A dry run with no stuck dirs at all.** `residuePlan` is `[]` (not absent) on a dry run, and `null` on a real run, so a JSON consumer can tell "dry run, nothing to do" from "not a dry run". Pinned in Task 3.

Follow-up to report, not fix (behavior change outside this record): `recordResidueFailure` sets `escalated: true` before `escalate` runs, so a failed escalation never retries. That is the pre-existing non-dry behavior AC3.1 keeps. Record it in the open-items ledger as a follow-up.

---

### Task 1: One recorded reason for swallowed escalate/resolve failures (`cache.js`)

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js` (`recordResidueError` new; `trackResidue` ~277-290; `clearResidue` ~253-266; `pruneResidueFailures` ~320-336; header comment's `residueFailures` shape line ~64; `module.exports`)
- Test: `tests/bin-lib/reconcile/cache.test.js` (append)

**Interfaces:**
- Produces: `recordResidueError(target, reason, targetPath, { op, error, now = Date.now() })`. Here `target` is a root string or a cache batch, `op` is `'escalate' | 'resolve'`, and `error` is a string. It sets `entry.lastResidueError = { op, reason: error, at: now }` on an **existing** entry, and is a no-op when no entry exists. Batch-aware exactly like `recordResidueFailure` (mutate `target.cache` and set `dirty`, or `writeCache`).
- Produces: `pruneResidueFailures(...)` now returns `{ failures: Array<{ reason, path, op: 'resolve', error }> }`. Previously it returned `undefined`. A failure is a resolve that threw, or a result whose status is not in `RESIDUE_RESOLVED_STATUSES`. The entry is still dropped.
- Produces: the entry field `lastResidueError: { op: 'escalate'|'resolve', reason: string, at: number }`. `listResidueFailures` already spreads entry fields, so it appears there with no change.

Failure-reason text: use the result's `reason` when present, otherwise `` `status ${status}` `` for an unexpected status, `'no result'` for a falsy result, or the thrown error's `message`/`String(err)`. `errorText` in `escalate-residue.js` is exported and may be reused.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/reconcile/cache.test.js`, using its existing `tmpRoot()` helper)

```js
test('#4180 AC2.1 clearResidue: a resolution-failed resolve leaves its reason on the kept entry', () => {
  const root = tmpRoot();
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) recordResidueFailure(root, 'structurally-stuck', '/x/p', { lastError: 'stuck at no-branch' });
  const r = clearResidue(root, 'o/r', 'structurally-stuck', '/x/p', { resolve: () => ({ status: 'resolution-failed', reason: 'HTTP 502' }) });
  assert.deepEqual(r, { cleared: false, resolved: { status: 'resolution-failed', reason: 'HTTP 502' } });
  const [e] = listResidueFailures(root);
  assert.equal(e.lastResidueError.op, 'resolve');
  assert.equal(e.lastResidueError.reason, 'HTTP 502');
  assert.equal(typeof e.lastResidueError.at, 'number');
});

test('#4180 clearResidue: a resolve that throws records the thrown message', () => {
  // same setup; resolve: () => { throw new Error('gh: not found'); }
  // assert listResidueFailures(root)[0].lastResidueError -> { op: 'resolve', reason: 'gh: not found' } (at: number)
});

test('#4180 trackResidue: an escalation-failed escalate records op escalate and its reason; escalated stays true', () => {
  // threshold-1 recordResidueFailure calls, then trackResidue(root,'o/r','move-failed','/x/m',{failed:true,lastError:'EBUSY'},{escalate:()=>({status:'escalation-failed',reason:'rate limited'})})
  // assert entry.escalated === true, entry.lastResidueError.op === 'escalate', .reason === 'rate limited'
});

test('#4180 trackResidue: an escalate that throws records the thrown message', () => {
  // escalate: () => { throw new Error('boom'); } -> lastResidueError.reason === 'boom', no throw out of trackResidue
});

test('#4180 trackResidue: a successful escalate records no error', () => {
  // escalate: () => ({ status: 'filed', number: 9 }) -> entry has no lastResidueError
});

test('#4180 a later success drops the entry and its lastResidueError together', () => {
  // record an error via the resolution-failed path, then clearResidue with resolve -> { status: 'closed' }
  // assert listResidueFailures(root) deepEquals []
});

test('#4180 pruneResidueFailures: returns resolve failures for gone escalated paths and still drops the entries', () => {
  // escalated entry at a non-existent path (e.g. path.join(root,'gone')); resolve: () => ({ status: 'resolution-failed', reason: 'HTTP 500' })
  // const out = pruneResidueFailures(root, 'o/r', { resolve })
  // assert.deepEqual(out, { failures: [{ reason: 'move-failed', path: gonePath, op: 'resolve', error: 'HTTP 500' }] })
  // assert.deepEqual(listResidueFailures(root), [])
});

test('#4180 recordResidueError: a no-op when the entry does not exist', () => {
  // recordResidueError(root, 'move-failed', '/x/none', { op: 'resolve', error: 'x' }); assert listResidueFailures(root) deepEquals []
});

test('#4180 recordResidueError: through a cache batch, lands on commit', () => {
  // beginCacheBatch, recordResidueFailure(batch,...), recordResidueError(batch,...), assert on-disk has no error before commitCacheBatch, has it after
});
```

Fill the commented bodies with the stated setup and assertions, matching the first test's style. Import `recordResidueError` in the file's existing destructure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4180" tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL (`recordResidueError is not a function`; `lastResidueError` undefined; `pruneResidueFailures` returns `undefined`)

- [ ] **Step 3: Implement** `recordResidueError` and the three call-site changes in `cache.js`. Every catch and every non-resolved branch still returns or continues exactly as today; the only addition is the `recordResidueError` call (or the collected `failures` entry for prune). In `pruneResidueFailures`, the entry is deleted from `failures` before the resolve, so collect the failure in a local array and return it. Do not write the error onto the dropped entry. Update the shape comment at ~line 64 to list `lastResidueError`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/cache.test.js`
Expected: PASS (all, including pre-existing tests)

- [ ] **Step 5: Prove red, then commit.** Restore the pre-change source with `git show HEAD:plugin/bin/lib/reconcile/cache.js > plugin/bin/lib/reconcile/cache.js`, re-run Step 2's command, and see it FAIL. Then restore your change (re-apply the edit) and re-run Step 4. Never use `git stash`.

```bash
git add plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Record why a residue escalate or resolve failed — lastResidueError on the cache entry, prune failures returned (refs #4180)"
```

---

### Task 2: Thread `dryRun` through the residue family (`cache.js`, `archive-merged.js`)

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js`: `trackResidue` gains `dryRun`; `commitCacheBatch(batch, { dryRun = false } = {})`; new pure `planClear`
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`: `trackStuckSkip` ~1780-1789, `trackArchiveResult` ~1808-1840, `archiveMerged` ~2062-2423 (collect plan, return it, pass `dryRun` to `commitCacheBatch`, capture prune failures)
- Test: `tests/bin-lib/reconcile/cache.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `pruneResidueFailures` return `{ failures }`.
- Produces: `trackResidue(target, repoSlug, reason, targetPath, { failed, lastError, dirtyFiles }, { escalate, runner, dryRun = false } = {})`. It now returns a plan object in both modes (callers that ignore the return are unaffected):
  - dry run (no cache/batch mutation, no `escalate` call): `failed` → `{ action: count >= RESIDUE_ESCALATE_THRESHOLD && !existing.escalated ? 'would-escalate' : 'would-track', reason, path: targetPath, count }`, where `count = (existing ? existing.count : 0) + 1` and `existing` is read from the batch's in-memory cache or from disk. `!failed` → `{ action: existing ? 'would-clear' : 'none', reason, path: targetPath }`.
  - real run: returns `undefined`, as today. No new return value is needed there.
- Produces: `planClear(target, reason, targetPath) -> { action: 'would-resolve'|'would-clear'|'none', reason, path }`. Pure; it reads the entry (escalated → `would-resolve`, unescalated → `would-clear`, absent → `none`).
- Produces: `commitCacheBatch(batch, { dryRun })`, a no-op whenever `dryRun` is true.
- Produces: `trackStuckSkip(..., { escalate, resolve, runner, dryRun })` returns the plan object on a dry run. The exempt branch returns `planClear(...)`; the non-exempt branch forwards `dryRun` into `trackResidue` and returns its result. It returns `undefined` on a real run and when the dir is not stuck.
- Produces: `trackArchiveResult(..., { escalate, resolve, runner, dryRun = false })`. On a dry run it forwards `dryRun` to `trackResidue`, replaces `recordResidueSuccess`/`clearResidue` with no-ops, and returns the plan. Defensive only: no current dry-run caller reaches it, because `finishArchiveAttempt` and `archiveMergedRun` return before it on a dry run.
- Produces: `archiveMerged(...)` returns `{ archived, skipped, residuePlan, residueErrors }`:
  - `residuePlan` is an array of every non-`none` plan object the pass's `trackStuckSkip` calls returned on a dry run (`[]` when none), and `null` on a real run.
  - `residueErrors` is Task 1's `pruneResidueFailures(...).failures` on a real run, and `[]` on a dry run (prune does not run).

  Collect the plan with one local array pushed from every `trackStuckSkip` call site, including the two `onSkip` closures; the simplest shape is a small local `track(reason)` helper. Return-shape widening check: no test deep-equals `archiveMerged`'s whole return (grep `archiveMerged(` across `tests/` before finalizing and confirm). `index.js` is its only production consumer (Task 3).

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/reconcile/cache.test.js`:

```js
test('#4180 dry-run trackResidue: past threshold plans would-escalate, calls no escalate, writes nothing', () => {
  // threshold-1 recordResidueFailure(root,'move-failed','/x/m'); const before = fs.readFileSync(path.join(root,'.claude-tweaks',CACHE_FILENAME))
  // const plan = trackResidue(root,'o/r','move-failed','/x/m',{failed:true,lastError:'e'},{escalate:()=>{calls++},dryRun:true})
  // assert.deepEqual(plan, { action: 'would-escalate', reason: 'move-failed', path: '/x/m', count: RESIDUE_ESCALATE_THRESHOLD })
  // assert calls === 0; assert.deepEqual(fs.readFileSync(same path), before)
});
test('#4180 dry-run trackResidue: below threshold plans would-track; success with an entry plans would-clear; success without plans none', () => {});
test('#4180 dry-run trackResidue reads an existing batch entry', () => {
  // batch = beginCacheBatch(root); threshold-1 recordResidueFailure(batch, ...) (in memory only)
  // plan = trackResidue(batch, ..., {dryRun:true}) -> action 'would-escalate'; batch.dirty unchanged from before the call
});
test('#4180 commitCacheBatch: dryRun never writes a dirty batch', () => {
  // batch dirtied by recordResidueFailure; commitCacheBatch(batch,{dryRun:true}); assert cache file absent
});
```

In `tests/bin-lib/reconcile/archive-merged.test.js`, next to the `#2724 trackStuckSkip` tests and reusing `mkAdHocRunDir`/`mkDirWithMtime`:

```js
test('#4180 trackStuckSkip: dryRun on a past-threshold stuck dir neither escalates nor writes, and returns would-escalate', () => {
  // root=tmp; stuckDir=mkDirWithMtime(STRUCTURALLY_STUCK_TTL_MS*2); threshold-1 trackStuckSkip(root,'o/r',stuckDir,'no-branch',{escalate})
  // snapshot listResidueFailures(root); plan = trackStuckSkip(..., {escalate, dryRun:true})
  // assert escalate calls === 0, listResidueFailures(root) deepEquals the snapshot, plan.action === 'would-escalate', plan.reason === 'structurally-stuck'
});
test('#4180 trackStuckSkip: dryRun on an exempted ad-hoc dir with an escalated entry returns would-resolve', () => {});
test('#4180 trackArchiveResult: dryRun on a move-failed result calls no escalate and writes nothing', () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4180" tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL (dry-run `trackResidue` writes the cache and calls `escalate`; `trackStuckSkip` returns `undefined`)

- [ ] **Step 3: Implement** the interfaces above. In `archiveMerged`, call `commitCacheBatch(cacheBatch, { dryRun })`, and keep the existing `if (!dryRun)` guard on `pruneResidueFailures`, capturing its `failures`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-work-boundary.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS

- [ ] **Step 5: Prove red (revert the two source files via `git show HEAD:<path> > <path>`, re-run Step 2, see FAIL, restore), then commit**

```bash
git add plugin/bin/lib/reconcile/cache.js plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "Thread dryRun through reconcile residue tracking — a dry run plans escalations instead of filing them (refs #4180)"
```

---

### Task 3: `reconcile()` writes nothing on a dry run and surfaces plan + errors

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js`:
  - the result literal (~127) gains `residuePlan: null, residueErrors: null`;
  - the archive dispatch (~489-506) copies `r.residuePlan`;
  - the finalize phase (~606-631): skip `prStates.persist()` and `writeCache` when `dryRun`, and set `result.residueErrors`;
  - update the header return-shape comment (~95).
- Modify: `plugin/bin/hooks.js` ~1666: the `reconcile-threw` fallback object gains `residuePlan: null, residueErrors: null`
- Modify: `plugin/bin/lib/reconcile/residue-summary.js`: `formatReconcileSummary` appends the error part
- Modify: `plugin/bin/lib/reconcile/format-summary.js`: one dry-run plan line
- Modify: `docs/hooks.md`, the Background convergence bullet's residue sentence (one clause: `--dry-run` writes neither the cache nor GitHub and reports `residuePlan`; failed escalate/resolve reasons ride on `lastResidueError` and `residueErrors`)
- Test: `tests/reconcile.test.js`, `tests/bin-lib/reconcile/residue-summary.test.js` (append)

**Interfaces:**
- Consumes: Task 2's `archiveMerged` return `{ residuePlan, residueErrors }`; Task 1's `lastResidueError` entry field via `listResidueFailures(root)`.
- Produces: the reconcile result fields.
  - `residuePlan` is `archiveMerged`'s `residuePlan` when the archive check ran: an array on a dry run, `null` on a real run, and `null` when archive did not run.
  - `residueErrors` is computed in finalize as every `listResidueFailures(root)` entry carrying `lastResidueError`, mapped to `{ reason, path, op, error, at }`, followed by the archive check's prune `residueErrors` mapped to the same shape with `at: null`. It is `[]` when there are none.
- Produces: `formatReconcileSummary` appends `, {n} escalation error(s) (last: {op} — {reason})` when any tracked entry carries `lastResidueError`. `last` is the entry with the greatest `at`. With none, the line is byte-identical to today, so the existing assertions in `residue-summary.test.js`, `tests/bin-lib/hooks/reconcile-summary.test.js` and `tests/reconcile.test.js` stay green.
- Produces: `formatSummary` adds `residue (dry run): would escalate {a}, would track {b}, would clear {c}` when `result.residuePlan` is a non-empty array. Count `would-resolve` with `would-clear`. Omit zero parts. No line otherwise.

- [ ] **Step 1: Write the failing tests**

In `tests/reconcile.test.js`, modelled on the `#3503` archive test (local git fixture, `remote add origin git@github.com:acme/w.git`, `policy.yml` with `integration-branch: main`, `process.env.GIT_SSH_COMMAND = 'false'`, `resolveIntegrationModel: () => 'pr-first'`). Two additions:
- Monkeypatch `require('../plugin/bin/lib/reconcile/preflight').ghHealthCheck = () => ({ ok: true })` (the documented seam, `index.js` ~258), restoring it in `finally`.
- Put a PATH `gh` shim that appends `"$@"` to a log file and exits 1.

```js
test('#4180 AC1.1: reconcile --dry-run over a past-threshold stuck run dir makes zero gh calls and leaves reconcile-cache.json byte-identical', async () => {
  // run dir: .claude-tweaks/pipelines/2026-01-01T000000-record-4180 with config.yml and
  //   run-state.json {status:'active', worktree: <root>/.claude/worktrees/gone} (no pr), then backdate the
  //   DIR's mtime to now - 2*STRUCTURALLY_STUCK_TTL_MS (after writing its files)
  // seed: RESIDUE_ESCALATE_THRESHOLD-1 recordResidueFailure(root,'structurally-stuck',runDir,{lastError:'stuck at no-worktree'})
  // const before = fs.readFileSync(cacheFile)
  // const r = await reconcile({ cwd: root, checks: ['archive'], dryRun: true, resolveIntegrationModel: () => 'pr-first' })
  // assert.equal(fs.existsSync(ghLog) ? fs.readFileSync(ghLog,'utf8') : '', '')
  // assert.deepEqual(fs.readFileSync(cacheFile), before)
  // assert.deepEqual(r.residuePlan, [{ action: 'would-escalate', reason: 'structurally-stuck', path: runDir, count: RESIDUE_ESCALATE_THRESHOLD }])
});

test('#4180 AC2.1: a recorded resolve failure appears in reconcile JSON residueErrors', async () => {
  // same fixture shape without dryRun, no run dirs needed; seed an escalated entry at an existing path and
  //   recordResidueError(root,'structurally-stuck',p,{op:'resolve',error:'HTTP 502'})
  // r = await reconcile({ cwd: root, checks: ['archive'], resolveIntegrationModel: () => 'pr-first' })
  // assert.deepEqual(r.residueErrors.map(({at, ...e}) => e), [{ reason: 'structurally-stuck', path: p, op: 'resolve', error: 'HTTP 502' }])
  // assert.match(r.residueSummary, /1 escalation error\(s\) \(last: resolve — HTTP 502\)/)
});

test('#4180 reconcile: a dry run with nothing stuck reports residuePlan [] and a real run reports null', async () => {});
```

Before finalizing Step 1, confirm the fixture dir's archive skip reason really is structurally stuck. Print `r.runs` once in scratch. If the reason is not in `STRUCTURALLY_STUCK_REASONS` (`no-worktree`/`no-branch`/`no-pr`), adjust the fixture (not the assertion) until it is. The pre-change run of AC1.1 must fail on the gh log (an `issue list` lookup from escalation) or on the cache bytes.

In `tests/bin-lib/reconcile/residue-summary.test.js`:

```js
test('#4180 formatReconcileSummary: names the latest escalation error', () => {
  // two entries; recordResidueError on both with now=1 and now=2; assert the line ends with
  // ', 2 escalation error(s) (last: <op of the now=2 one> — <its reason>)'
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#4180" tests/reconcile.test.js tests/bin-lib/reconcile/residue-summary.test.js`
Expected: FAIL (cache file rewritten with `lastRunAt`/escalation count on the dry run; `residuePlan`/`residueErrors` undefined; summary lacks the error part)

- [ ] **Step 3: Implement** the interfaces above. In finalize, wrap both `prStates.persist()` and the `writeCache` block in `if (!dryRun)`. Replace the existing "dry-run included" comment with the new rule and its reason: a dry run writes nothing (#4180).

- [ ] **Step 4: Run the reconcile suites (AC3.1)**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/ tests/bin-lib/hooks/reconcile-summary.test.js tests/hooks-session-start.test.js tests/console-execute.test.js tests/dispatch-drain-close-run-reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Prove red (revert `index.js`, `residue-summary.js` via `git show HEAD:<path> > <path>`, re-run Step 2, see FAIL, restore), then commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/hooks.js plugin/bin/lib/reconcile/residue-summary.js plugin/bin/lib/reconcile/format-summary.js docs/hooks.md tests/reconcile.test.js tests/bin-lib/reconcile/residue-summary.test.js
git commit -m "Make reconcile --dry-run write nothing — skip end-of-pass cache writes, report residuePlan and residueErrors (refs #4180)"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (dryRun through trackStuckSkip/trackArchiveResult/trackResidue/commitCacheBatch; report instead) | Task 2, Task 3 (`residuePlan`, finalize writes) |
| Deliverable 2 (one failure channel: cache entry + JSON + residue summary) | Task 1, Task 3 |
| Deliverable 3 (tests red pre-change) | every task's Step 5 |
| AC1.1 | Task 3 `#4180 AC1.1` |
| AC2.1 | Task 1 `#4180 AC2.1` (cache entry), Task 3 `#4180 AC2.1` (JSON output) |
| AC3.1 | Task 3 Step 4 (plus each task's Step 4) |
