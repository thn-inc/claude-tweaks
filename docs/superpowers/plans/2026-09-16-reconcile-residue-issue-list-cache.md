# Reconcile Residue: Shared Per-Pass `gh issue list` Cache (#2505) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `escalate-residue.js`'s `findResidueDuplicate` reuse one cached `gh issue list --repo ... --state all --json ... --limit 10000` result per repo for the whole duration of one `reconcile()` pass, instead of re-fetching it once per stuck dir/path that escalates or resolves.

**Architecture:** Add a small, injectable, in-memory memo (`bin/lib/reconcile/issue-list-cache.js`) keyed by repo, scoped to one `createIssueListCache()` instance. Thread an optional `runner` option down the existing injectable-`escalate`/`resolve` call chain — `cache.js`'s `trackResidue`/`pruneResidueFailures` → `archive-merged.js`'s `trackStuckSkip`/`trackArchiveResult`/`archiveMergedRun`/`archiveMerged`, and `reap-merged.js`'s `trackReapResidue`/`reapMerged` — into `escalate-residue.js`'s already-injectable `runner` param on `escalateResidue`/`resolveResidue`/`findResidueDuplicate` (no changes needed in that file — it already accepts `runner`). `reconcile/index.js`'s `reconcile()` creates exactly one cache instance per pass, before dispatching the `archive`/`reap` checks, and passes its `runner` into both.

**Tech Stack:** Plain Node.js (CommonJS), `node --test` for tests. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-09-16T070707-record-2505/work/2505-spec.md` (materialized from GitHub issue #2505)

## Global Constraints

- Every changed function's default behavior (no `runner` passed) must be byte-identical to today — every existing test in `tests/bin-lib/reconcile/cache.test.js`, `tests/bin-lib/reconcile/archive-merged.test.js`, `tests/bin-lib/reconcile/reap-merged.test.js`, and `tests/reconcile.test.js` must keep passing unmodified.
- No change to which duplicates are detected, or how dedup-hit/append/reopen/close decisions are made — this is purely a fetch-count optimization, never a behavior change to `escalate-residue.js`'s own logic (spec Acceptance Criteria).
- The cache must never survive across two `reconcile()` passes, or across two process invocations — a fresh `createIssueListCache()` per pass is what guarantees this (spec Acceptance Criteria).
- Only the exact `['issue', 'list', ...]` shape is ever memoized. Every write call (`issue create`/`edit`/`comment`/`reopen`/`close`) must always execute — never memoized, never skipped.

---

### Task 1: Add the shared issue-list cache module

**Files:**
- Create: `plugin/bin/lib/reconcile/issue-list-cache.js`
- Test: `tests/bin-lib/reconcile/issue-list-cache.test.js`

**Interfaces:**
- Produces: `createIssueListCache({ base?: (argv: string[]) => string } = {}) -> { runner: (argv: string[]) => string }` — `base` defaults to `defaultRunner` from `../feedback/file-feedback` (the real `gh` shell-out). `runner` has the exact same signature as `defaultRunner`/`escalateResidue`'s own injectable `runner` param, so it can be passed anywhere that param is accepted.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/bin-lib/reconcile/issue-list-cache.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIssueListCache } = require('../../../plugin/bin/lib/reconcile/issue-list-cache');

function countingBase(respond) {
  const calls = [];
  const base = (argv) => {
    calls.push(argv);
    return respond(argv);
  };
  return { base, calls };
}

test('createIssueListCache: two issue-list calls for the same repo hit base exactly once', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  const argv = ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'number,title,body,createdAt,state', '--limit', '10000'];
  const first = runner(argv);
  const second = runner(argv);
  assert.equal(calls.length, 1, 'the second call must be served from the memo, not re-fetched');
  assert.equal(first, '[]');
  assert.equal(second, '[]');
});

test('createIssueListCache: two different repos each get their own base call', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'list', '--repo', 'o/r1', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'list', '--repo', 'o/r2', '--state', 'all', '--json', 'x', '--limit', '10000']);
  runner(['issue', 'list', '--repo', 'o/r1', '--state', 'all', '--json', 'x', '--limit', '10000']);
  assert.equal(calls.length, 2, 'one base call per distinct repo, memoized on the repeat');
  assert.deepEqual(calls.map((c) => c[c.indexOf('--repo') + 1]), ['o/r1', 'o/r2']);
});

test('createIssueListCache: a non-issue-list argv always passes through, never memoized', () => {
  const { base, calls } = countingBase(() => 'ok');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b']);
  runner(['issue', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b']);
  assert.equal(calls.length, 2, 'writes must never be memoized');
});

test('createIssueListCache: a base throw is never cached — the next call for the same repo retries', () => {
  let attempt = 0;
  const base = () => {
    attempt += 1;
    if (attempt === 1) throw new Error('gh: rate limited');
    return '[]';
  };
  const { runner } = createIssueListCache({ base });
  const argv = ['issue', 'list', '--repo', 'o/r', '--state', 'all', '--json', 'x', '--limit', '10000'];
  assert.throws(() => runner(argv));
  const result = runner(argv);
  assert.equal(result, '[]');
  assert.equal(attempt, 2, 'the failed first attempt must not have been cached');
});

test('createIssueListCache: an issue-list argv missing --repo passes through uncached (defensive)', () => {
  const { base, calls } = countingBase(() => '[]');
  const { runner } = createIssueListCache({ base });
  runner(['issue', 'list', '--state', 'all']);
  runner(['issue', 'list', '--state', 'all']);
  assert.equal(calls.length, 2);
});

test('createIssueListCache: defaults `base` to the real gh runner when omitted (smoke)', () => {
  const { runner } = createIssueListCache();
  assert.equal(typeof runner, 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/issue-list-cache.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/reconcile/issue-list-cache'"

- [ ] **Step 3: Write minimal implementation**

```javascript
// plugin/bin/lib/reconcile/issue-list-cache.js — #2505: a shared, in-memory
// memo for the one `gh issue list --repo ... --state all --json ...
// --limit 10000` shape escalateResidue/resolveResidue's own
// findResidueDuplicate (escalate-residue.js) issues — that fetch is
// identical for every caller within one reconcile pass regardless of which
// (reason, path) or marker it's filtering for afterward, so N stuck
// dirs/paths escalating or resolving in the same pass were each paying for
// their own full-repo `gh issue list` round trip (#2505's Current State).
// Scoped to ONE createIssueListCache() instance's own lifetime —
// reconcile/index.js creates exactly one per reconcile() pass and threads
// its `runner` down through archiveMerged/reapMerged/cache.js's
// trackResidue/pruneResidueFailures into escalateResidue/resolveResidue's
// own injectable `runner` param (escalate-residue.js needs no changes —
// it already accepts one), so nothing here persists across passes or
// processes (the AC's "no stale cross-pass reuse").
'use strict';
const { defaultRunner } = require('../feedback/file-feedback');

// Only this exact shape is memoized — every other runner call (issue
// create/edit/comment/reopen/close) is a write and must always execute, so
// it passes straight through uncached.
function isIssueListCall(argv) {
  return Array.isArray(argv) && argv[0] === 'issue' && argv[1] === 'list';
}

function repoFromArgv(argv) {
  const i = argv.indexOf('--repo');
  return i === -1 ? null : argv[i + 1];
}

// { base?: (argv) => string } -> { runner: (argv) => string }
// `base` defaults to the real `gh` runner (file-feedback.js's
// defaultRunner) so production callers (reconcile/index.js) need pass
// nothing; tests inject a counting fake instead. A thrown `base` call is
// never cached — the memo is only populated after a successful read, so
// the next call for that repo retries rather than replaying a failure.
function createIssueListCache({ base = defaultRunner } = {}) {
  const memo = new Map();
  function runner(argv) {
    if (!isIssueListCall(argv)) return base(argv);
    const repo = repoFromArgv(argv);
    if (repo === null) return base(argv);
    if (memo.has(repo)) return memo.get(repo);
    const out = base(argv);
    memo.set(repo, out);
    return out;
  }
  return { runner };
}

module.exports = { createIssueListCache, isIssueListCall, repoFromArgv };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/reconcile/issue-list-cache.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/issue-list-cache.js tests/bin-lib/reconcile/issue-list-cache.test.js
git commit -m "feat: add shared per-reconcile-pass gh issue-list cache module (refs #2505)"
```

---

### Task 2: Thread `runner` through `cache.js`'s `trackResidue`/`pruneResidueFailures`

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js:158` (function `trackResidue`)
- Modify: `plugin/bin/lib/reconcile/cache.js:201` (function `pruneResidueFailures`)
- Test: `tests/bin-lib/reconcile/cache.test.js`

**Interfaces:**
- Consumes: nothing new — `escalateResidue`/`resolveResidue` (from `./escalate-residue`, already imported) already accept a `runner` field in their single args object.
- Produces: `trackResidue(root, repoSlug, reason, targetPath, {failed, lastError}, {escalate, runner} = {})` and `pruneResidueFailures(root, repoSlug, {resolve, runner} = {})` — both now accept an optional `runner`, forwarded into the `escalate`/`resolve` call's args object. Omitting `runner` (or passing `undefined`) is byte-identical to today, since `escalateResidue`/`resolveResidue`'s own destructured default (`runner = defaultRunner`) applies whenever the field's value is `undefined`, whether or not the key is present.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/reconcile/cache.test.js` (near the existing `trackResidue`/`pruneResidueFailures` tests):

```javascript
test('trackResidue: forwards an injected `runner` into the escalate call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-runner-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const runner = () => '[]';
  let last;
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    last = trackResidue(root, 'o/r', 'removal-failed', '/x/wt-runner', { failed: true, lastError: 'x' }, { escalate, runner });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, runner, 'the escalate call must receive the same runner reference this call was given');
});

test('trackResidue: omitting `runner` is unaffected — escalate receives runner: undefined, same as before this change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-runner-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackResidue(root, 'o/r', 'removal-failed', '/x/wt-no-runner', { failed: true, lastError: 'x' }, { escalate });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, undefined);
});

test('pruneResidueFailures: forwards an injected `runner` into the resolve call', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-prune-runner-'));
  const gonePath = path.join(root, 'gone-runner');
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    recordResidueFailure(root, 'move-failed', gonePath, { lastError: 'x' });
  }
  assert.equal(listResidueFailures(root)[0].escalated, true);
  const calls = [];
  const resolve = (args) => { calls.push(args); return { status: 'closed', number: 1 }; };
  const runner = () => '[]';
  pruneResidueFailures(root, 'o/r', { resolve, runner });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, runner);
});
```

Add `RESIDUE_ESCALATE_THRESHOLD` to the file's top-of-file destructure from `../../../plugin/bin/lib/reconcile/cache` if not already imported (check the existing `require` line at the top of `tests/bin-lib/reconcile/cache.test.js` first — it is already imported per the existing threshold tests in that file; reuse it, do not re-declare).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL — `assert.equal(calls[0].runner, runner, ...)` fails because `trackResidue`/`pruneResidueFailures` don't forward `runner` yet (both new tests report `undefined` where a function reference was expected, or fail differently — actual current behavior never sets `.runner` on the escalate/resolve args object at all today, so this is `undefined !== [Function: runner]`).

- [ ] **Step 3: Write minimal implementation**

Replace `plugin/bin/lib/reconcile/cache.js` lines 158-171 (`trackResidue`) with:

```javascript
function trackResidue(root, repoSlug, reason, targetPath, { failed, lastError }, { escalate = escalateResidue, runner } = {}) {
  if (!failed) {
    recordResidueSuccess(root, reason, targetPath);
    return;
  }
  const streak = recordResidueFailure(root, reason, targetPath, { lastError });
  if (!streak.shouldEscalate) return;
  try {
    escalate({
      repo: repoSlug, reason, targetPath,
      count: streak.count, firstFailedAt: streak.firstFailedAt, lastError, runner,
    });
  } catch { /* best-effort — never let escalation turn a residue-tracking call into a thrown error */ }
}
```

Replace lines 201-217 (`pruneResidueFailures`) with:

```javascript
function pruneResidueFailures(root, repoSlug, { resolve = resolveResidue, runner } = {}) {
  const cache = readCache(root);
  const failures = { ...cache.residueFailures };
  let changed = false;
  for (const [key, entry] of Object.entries(cache.residueFailures)) {
    const sep = key.indexOf(':');
    const reason = sep === -1 ? key : key.slice(0, sep);
    const targetPath = sep === -1 ? '' : key.slice(sep + 1);
    if (!targetPath || fs.existsSync(targetPath)) continue;
    delete failures[key];
    changed = true;
    if (entry && entry.escalated) {
      try { resolve({ repo: repoSlug, reason, targetPath, runner }); } catch { /* best-effort */ }
    }
  }
  if (changed) writeCache(root, { ...cache, residueFailures: failures });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/reconcile/cache.test.js`
Expected: PASS (every existing test in the file plus the 3 new ones)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/cache.test.js
git commit -m "feat: cache.js threads an optional runner into escalate/resolve calls (refs #2505)"
```

---

### Task 3: Thread `runner` through `archive-merged.js`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1189` (`trackStuckSkip`)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1208` (`trackArchiveResult`)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1258` (`archiveMergedRun`)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1279` (`archiveMerged` — signature and every internal `trackArchiveResult`/`trackStuckSkip`/`archiveMergedRun`/`pruneResidueFailures` call site: lines 1316, 1336, 1377, 1400, 1465, 1534, 1539, 1546, 1550-1553, 1567-1574, 1582)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `trackResidue`/`pruneResidueFailures`'s new `runner` option from Task 2 (`./cache`, already imported).
- Produces: `trackStuckSkip(root, repoSlug, dir, reason, {escalate, runner} = {})`, `trackArchiveResult(root, repoSlug, dir, result, {escalate, runner} = {})`, `archiveMergedRun({root, repoSlug, dir, branch, dryRun, onSkip, runner})`, and `archiveMerged({cwd, dryRun, sessionId, runner} = {})` — all now accept an optional `runner`, forwarded all the way down to `escalateResidue`/`resolveResidue`. Omitting it is byte-identical to today.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/reconcile/archive-merged.test.js` (near the existing `trackStuckSkip`/`trackArchiveResult` tests, after the `'archiveMerged: still skips in place...'` test around line 1439):

```javascript
// #2505 — two independently stuck dirs both crossing the escalation
// threshold in the SAME archiveMerged() call must still make only ONE
// underlying gh issue-list call when a shared runner (the shape
// reconcile/index.js's createIssueListCache produces) is injected — proof
// that archiveMerged's `runner` option actually reaches every trackStuckSkip
// call site in its loop, not just the first one reached.
test('archiveMerged: two dirs crossing the structurally-stuck threshold in one call share one injected runner — only one underlying issue-list call fires', () => {
  const root = fs.realpathSync(makeRepo());

  function seedStuckDir(id, gonePath) {
    const dir = path.join(root, '.claude-tweaks', 'pipelines', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({
      status: 'active', worktree: gonePath, sessionId: 'sess-1',
    }));
    const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
    fs.utimesSync(dir, backdated, backdated);
    // Pre-seed the residue counter one short of the threshold, so this
    // single archiveMerged() call's own trackStuckSkip crosses it for
    // BOTH dirs at once, simultaneously reaching escalateResidue.
    for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD - 1; i++) {
      recordResidueFailure(root, 'structurally-stuck', dir, { lastError: 'stuck at no-branch' });
    }
    return dir;
  }

  const dirA = seedStuckDir('2026-01-01T000000-stuck-a-2505', path.join(root, 'long-gone-a'));
  const dirB = seedStuckDir('2026-01-01T010000-stuck-b-2505', path.join(root, 'long-gone-b'));

  const calls = [];
  const runner = (argv) => {
    calls.push(argv);
    return '[]'; // no prior issue — findResidueDuplicate reads an empty list, escalateResidue files fresh
  };

  const wrapper = installGhWrapper([]); // issue create's own gh call still goes to real gh unless intercepted — see note below
  let result;
  try {
    result = archiveMerged({ cwd: root, runner });
  } finally {
    wrapper.restore();
  }

  assert.ok(result.skipped.some((s) => s.runDir === dirA && s.reason === 'no-branch'));
  assert.ok(result.skipped.some((s) => s.runDir === dirB && s.reason === 'no-branch'));

  const issueListCalls = calls.filter((c) => c[0] === 'issue' && c[1] === 'list');
  assert.equal(issueListCalls.length, 1, `expected exactly one issue-list call across both escalations, got ${issueListCalls.length}: ${JSON.stringify(calls)}`);

  const failures = listResidueFailures(root);
  assert.ok(failures.find((f) => f.path === dirA && f.escalated === true));
  assert.ok(failures.find((f) => f.path === dirB && f.escalated === true));
});
```

**Note on the test's own `runner`:** the injected `runner` intercepts every `gh` call `escalateResidue` makes — including its `issue create` write, once `findResidueDuplicate` reads back `[]` (no prior issue) — so this fake `runner` must itself return something `escalateResidue`'s own `issue create` branch can parse (it regexes `/\/issues\/(\d+)/` out of the create call's stdout; an unmatched regex just yields `number: null`, which does not fail the test — `escalateResidue`'s own `errorText`/try-catch handles a non-matching output gracefully). No real `gh` binary is invoked by either the `issue list` or `issue create` calls in this test, since `archiveMerged`'s `runner` option (once Step 3 below lands) reaches every one of `trackStuckSkip`'s `escalate` calls, which defaults to the real `escalateResidue` — but `escalateResidue`'s own `runner` param (not `escalate`) is what this test overrides, so `installGhWrapper([])` here is a defensive no-op (nothing in this test path should reach the real `gh` at all once Step 3 lands); keep it only so a regression that fails to thread `runner` through some call site falls back to the wrapper's fake (empty-array) `gh` instead of a real network call, rather than hanging or erroring in CI.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL — `archiveMerged({ cwd: root, runner })` ignores the unknown `runner` option today (`archiveMerged`'s destructured params don't include it), so both escalations fall through to `trackStuckSkip`'s default `escalate = escalateResidue` with no `runner`, which defaults to the real `defaultRunner` (real `gh`) — the injected `runner` is never called, so `calls.length` (and therefore `issueListCalls.length`) stays `0`, failing the `assert.equal(issueListCalls.length, 1, ...)` assertion. (In an environment with no `gh` on PATH or no auth, this may instead fail earlier with a real `gh` invocation error inside `escalateResidue`'s own try/catch — either way, a failure, confirming the runner isn't threaded yet.)

- [ ] **Step 3: Write minimal implementation**

Replace `plugin/bin/lib/reconcile/archive-merged.js` line 1189 (`trackStuckSkip`):

```javascript
function trackStuckSkip(root, repoSlug, dir, reason, { escalate = escalateResidue, runner } = {}) {
  if (!isStructurallyStuck(dir, reason)) return;
  trackResidue(root, repoSlug, 'structurally-stuck', dir, { failed: true, lastError: `stuck at ${reason}` }, { escalate, runner });
}
```

Replace line 1208 (`trackArchiveResult`):

```javascript
function trackArchiveResult(root, repoSlug, dir, result, { escalate = escalateResidue, runner } = {}) {
  if (result.ok) {
    recordResidueSuccess(root, 'move-failed', dir);
    recordResidueSuccess(root, 'structurally-stuck', dir);
    return;
  }
  if (result.reason !== 'move-failed') return;
  trackResidue(root, repoSlug, 'move-failed', dir, { failed: true, lastError: result.lastError }, { escalate, runner });
}
```

Replace lines 1258-1277 (`archiveMergedRun`):

```javascript
function archiveMergedRun({
  root, repoSlug, dir, branch, dryRun, onSkip, runner,
}) {
  const prState = resolvePrState(root, branch);
  const consoleState = readConsoleState(dir);
  const decision = decideArchive(prState, consoleState);
  if (decision.action === 'skip') {
    if (onSkip) onSkip(decision.reason);
    return { outcome: 'skipped', reason: decision.reason };
  }

  const hasMerge = localHasMerge(root, prState.mergeCommit);
  if (hasMerge !== true) {
    return { outcome: 'skipped', reason: hasMerge === false ? 'local-behind-merge' : 'merge-commit-unknown' };
  }
  if (dryRun) return { outcome: 'archived' };

  const result = archiveRunDir(root, dir);
  trackArchiveResult(root, repoSlug, dir, result, { runner });
  if (!result.ok) return { outcome: 'skipped', reason: result.reason };
  return { outcome: 'archived' };
}
```

In `archiveMerged` (starting line 1279):

1. Change the signature (line 1279) from:
   `function archiveMerged({ cwd, dryRun = false, sessionId = process.env.CLAUDE_CODE_SESSION_ID || null } = {}) {`
   to:
   `function archiveMerged({ cwd, dryRun = false, sessionId = process.env.CLAUDE_CODE_SESSION_ID || null, runner } = {}) {`

2. Every `trackArchiveResult(root, repoSlug, dir, result);` call (lines 1316, 1336, 1377, 1400, 1465, 1539) becomes:
   `trackArchiveResult(root, repoSlug, dir, result, { runner });`
   (line 1400's variable is `archiveResult`, not `result` — becomes `trackArchiveResult(root, repoSlug, dir, archiveResult, { runner });`, unchanged otherwise)

3. Every `trackStuckSkip(root, repoSlug, dir, reason);` / `trackStuckSkip(root, repoSlug, dir, consoleReason);` call (lines 1534, 1546) becomes:
   `trackStuckSkip(root, repoSlug, dir, reason, { runner });` / `trackStuckSkip(root, repoSlug, dir, consoleReason, { runner });`

4. Line 1550-1553's `archiveMergedRun` call:
   ```javascript
   const runResult = archiveMergedRun({
     root, repoSlug, dir, branch, dryRun,
     onSkip: (reason) => trackStuckSkip(root, repoSlug, dir, reason),
   });
   ```
   becomes:
   ```javascript
   const runResult = archiveMergedRun({
     root, repoSlug, dir, branch, dryRun, runner,
     onSkip: (reason) => trackStuckSkip(root, repoSlug, dir, reason, { runner }),
   });
   ```

5. Line 1571's `archiveMergedRun` call (the `#1544` clean-status sweep loop):
   `const runResult = archiveMergedRun({ root, repoSlug, dir, branch, dryRun });`
   becomes:
   `const runResult = archiveMergedRun({ root, repoSlug, dir, branch, dryRun, runner });`

6. Line 1582's `pruneResidueFailures` call:
   `if (!dryRun) pruneResidueFailures(root, repoSlug);`
   becomes:
   `if (!dryRun) pruneResidueFailures(root, repoSlug, { runner });`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS (every existing test in the file plus the new one)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js tests/bin-lib/reconcile/archive-merged.test.js
git commit -m "feat: archive-merged.js threads an optional shared runner into every residue escalation/resolution call site (refs #2505)"
```

---

### Task 4: Thread `runner` through `reap-merged.js`

**Files:**
- Modify: `plugin/bin/lib/reconcile/reap-merged.js:77` (`trackReapResidue`)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js:93` (`reapMerged` signature)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js:145` and `:151` (the two `trackReapResidue` call sites inside `reapMerged`)
- Test: `tests/bin-lib/reconcile/reap-merged.test.js`

**Interfaces:**
- Consumes: `trackResidue`'s new `runner` option from Task 2 (`./cache`, already imported).
- Produces: `trackReapResidue(root, repoSlug, real, {failed, lastError}, {escalate, runner} = {})` and `reapMerged({cwd, dryRun, releasePorts, runner} = {})` — both accept an optional `runner`, forwarded to `escalateResidue`. Omitting it is byte-identical to today.

- [ ] **Step 1: Write the failing test**

Add to `tests/bin-lib/reconcile/reap-merged.test.js` (near the existing `trackReapResidue` tests, after the `'trackReapResidue: escalates exactly once...'` test around line 281-300):

```javascript
// #2505 — two independent (reason, path) entries both crossing the
// escalation threshold in the SAME pass must share one injected runner —
// proof that trackReapResidue actually forwards it into escalateResidue's
// own runner param, the same wiring reapMerged's real call sites use.
test('trackReapResidue: two paths crossing threshold share one injected runner — only one underlying issue-list call fires', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-track-runner-'));
  const calls = [];
  const runner = (argv) => { calls.push(argv); return '[]'; };

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackReapResidue(root, 'o/r', '/x/wt-runner-a', { failed: true, lastError: 'removal-failed' }, { runner });
  }
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackReapResidue(root, 'o/r', '/x/wt-runner-b', { failed: true, lastError: 'removal-failed' }, { runner });
  }

  const issueListCalls = calls.filter((c) => c[0] === 'issue' && c[1] === 'list');
  assert.equal(issueListCalls.length, 1, `expected exactly one issue-list call across both paths, got ${issueListCalls.length}: ${JSON.stringify(calls)}`);
});

test('trackReapResidue: omitting `runner` is unaffected by this change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-track-no-runner-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackReapResidue(root, 'o/r', '/x/wt-no-runner', { failed: true, lastError: 'x' }, { escalate });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runner, undefined);
});
```

Confirm `RESIDUE_ESCALATE_THRESHOLD` is already imported at the top of `tests/bin-lib/reconcile/reap-merged.test.js` (it is, per the existing threshold test at line 226) — reuse it, do not re-declare.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/reap-merged.test.js`
Expected: FAIL — `trackReapResidue`'s options object doesn't accept/forward `runner` yet, so the injected fake `runner` is never called; `calls.length` (and `issueListCalls.length`) stays `0` in the first new test, failing `assert.equal(issueListCalls.length, 1, ...)`.

- [ ] **Step 3: Write minimal implementation**

Replace `plugin/bin/lib/reconcile/reap-merged.js` line 77 (`trackReapResidue`):

```javascript
function trackReapResidue(root, repoSlug, real, { failed, lastError }, { escalate = escalateResidue, runner } = {}) {
  trackResidue(root, repoSlug, 'removal-failed', real, { failed, lastError }, { escalate, runner });
}
```

Change the `reapMerged` signature (line 93) from:
`function reapMerged({ cwd, dryRun = false, releasePorts = releasePortsDefault } = {}) {`
to:
`function reapMerged({ cwd, dryRun = false, releasePorts = releasePortsDefault, runner } = {}) {`

Change the two internal `trackReapResidue` calls (lines 145, 151):

```javascript
      trackReapResidue(root, repoSlug, real, { failed: true, lastError: rm.stderr || rm.failure }, { runner });
```

```javascript
    trackReapResidue(root, repoSlug, real, { failed: false }, { runner });
```

(read the surrounding lines first via `Read` to confirm exact current indentation/context before editing — both calls currently pass no fifth options argument at all, per the grep at plan-authoring time; add `{ runner }` as the new fifth argument to each.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS (every existing test in the file plus the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/reap-merged.js tests/bin-lib/reconcile/reap-merged.test.js
git commit -m "feat: reap-merged.js threads an optional shared runner into residue escalation (refs #2505)"
```

---

### Task 5: Wire `reconcile/index.js` to create and share one cache per pass

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js:23` (add the new `require`)
- Modify: `plugin/bin/lib/reconcile/index.js:241-242` (create the cache once, alongside the existing `budget` creation)
- Modify: `plugin/bin/lib/reconcile/index.js:352` (`archiveMerged` call)
- Modify: `plugin/bin/lib/reconcile/index.js:398` (`reapMerged` call)
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Consumes: `createIssueListCache` from `./issue-list-cache` (Task 1); `archiveMerged`'s and `reapMerged`'s new `runner` option (Tasks 3, 4).
- Produces: `reconcile()`'s existing public contract is unchanged — this task only adds internal plumbing, no new option on `reconcile()` itself (the cache is always created fresh per call, unconditionally, matching "one instance per pass" with no caller-visible toggle to get wrong).

- [ ] **Step 1: Write the failing test**

Add to `tests/reconcile.test.js`, near the other `archive`/`reap`-focused tests (search the file for `checks: ['archive'` or a similar existing archive/reap-scoped `reconcile()` call to place this alongside):

```javascript
// #2505 — reconcile()'s own archive+reap dispatch must share ONE issue-list
// cache instance across both checks in the same pass. Exercised at the
// module-wiring level (a spy on issue-list-cache.js's own
// createIssueListCache, confirming it is called exactly once per
// reconcile() invocation, and that the SAME returned runner reaches both
// archiveMerged and reapMerged) rather than by re-deriving N-stuck-dir
// git/gh fixtures here — Task 3/4's own tests already prove the runner,
// once received, is forwarded correctly through every call site in each
// module; this test's only job is proving index.js creates and shares
// exactly one instance.
test('reconcile(): creates exactly one issue-list cache per pass and passes its runner to both archiveMerged and reapMerged', async () => {
  const issueListCache = require('../plugin/bin/lib/reconcile/issue-list-cache');
  const archiveMergedModule = require('../plugin/bin/lib/reconcile/archive-merged');
  const reapMergedModule = require('../plugin/bin/lib/reconcile/reap-merged');

  const originalCreate = issueListCache.createIssueListCache;
  const originalArchive = archiveMergedModule.archiveMerged;
  const originalReap = reapMergedModule.reapMerged;

  let createCalls = 0;
  const fakeRunner = () => '[]';
  issueListCache.createIssueListCache = (...args) => {
    createCalls += 1;
    return { runner: fakeRunner };
  };
  let archiveRunnerSeen;
  let reapRunnerSeen;
  archiveMergedModule.archiveMerged = (opts) => {
    archiveRunnerSeen = opts.runner;
    return { archived: [], skipped: [] };
  };
  reapMergedModule.reapMerged = (opts) => {
    reapRunnerSeen = opts.runner;
    return { reaped: [], skipped: [], portsRelease: [] };
  };

  try {
    // Rebuild index.js's own top-level requires against the monkeypatched
    // modules by clearing its module cache entry first — index.js
    // destructures archiveMerged/reapMerged/createIssueListCache at
    // require-time, so a patch applied AFTER index.js has already been
    // required elsewhere in this suite would not be seen without this.
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
    const { reconcile } = require('../plugin/bin/lib/reconcile/index');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-cache-share-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'init');

    await reconcile({
      cwd: dir,
      checks: ['archive', 'reap'],
      resolveIntegrationModel: () => 'pr-first',
      mcpReachable: true,
    });

    assert.equal(createCalls, 1, 'exactly one cache must be created per reconcile() pass');
    assert.equal(archiveRunnerSeen, fakeRunner, 'archiveMerged must receive the shared cache runner');
    assert.equal(reapRunnerSeen, fakeRunner, 'reapMerged must receive the same shared cache runner');
  } finally {
    issueListCache.createIssueListCache = originalCreate;
    archiveMergedModule.archiveMerged = originalArchive;
    reapMergedModule.reapMerged = originalReap;
    delete require.cache[require.resolve('../plugin/bin/lib/reconcile/index')];
  }
});
```

**Note:** this test monkeypatches `archiveMerged`/`reapMerged`/`createIssueListCache` at the module-export level and re-requires `index.js` after patching (clearing its cache entry first) so `index.js`'s own top-of-file `require(...)` destructure picks up the patched functions — the same monkeypatch idiom this file's header comment already documents for `resolveIntegrationModel`/`ghHealthCheck` (see the existing `require('./budget').createBudget = fn` pattern index.js's own comments describe). If `reconcile()`'s GitHub-health preflight (`ghDependentChecks`) blocks this fixture before reaching the archive/reap dispatch (no real `gh`/network in this sandbox), stub `require('../plugin/bin/lib/reconcile/preflight').ghHealthCheck`/`ghHealthCheckAsync` to return `{ ok: true }` for the duration of this test, the same way other tests in this file that reach past the preflight gate already do — search this file for an existing `ghHealthCheck =` monkeypatch and mirror its restore-in-`finally` pattern exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/reconcile.test.js`
Expected: FAIL — `index.js` never calls `createIssueListCache` today, so `createCalls` stays `0`, failing `assert.equal(createCalls, 1, ...)`.

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/reconcile/index.js`:

1. Add a new require near the existing ones (after line 23's `sharedFetch`/`sharedFetchAsync` import):

```javascript
const { createIssueListCache } = require('./issue-list-cache');
```

2. Immediately after the existing `const budget = require('./budget').createBudget();` line (line 241), add:

```javascript
  // #2505 — one shared per-pass memo for the `gh issue list` fetch
  // escalateResidue/resolveResidue's own findResidueDuplicate issues,
  // reused across every stuck dir/path archive+reap escalate or resolve in
  // THIS pass — created fresh every reconcile() call (never a module-level
  // singleton), so nothing here survives across passes or processes.
  const issueListCache = createIssueListCache();
```

3. Change the `archive` dispatch block (around line 352):

   From:
   ```javascript
   if (checks.includes('archive')) {
     const r = archiveMerged({ cwd: root, dryRun, sessionId: opts.sessionId });
   ```
   To:
   ```javascript
   if (checks.includes('archive')) {
     const r = archiveMerged({
       cwd: root, dryRun, sessionId: opts.sessionId, runner: issueListCache.runner,
     });
   ```

4. Change the `reap` dispatch block (around line 398):

   From:
   ```javascript
   const r = reapMerged({ cwd, dryRun });
   ```
   To:
   ```javascript
   const r = reapMerged({ cwd, dryRun, runner: issueListCache.runner });
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/reconcile.test.js`
Expected: PASS (every existing test in the file plus the new one)

- [ ] **Step 5: Run the full reconcile suite once more**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/escalate-residue.test.js tests/bin-lib/reconcile/issue-list-cache.test.js`
Expected: PASS — every test across all five touched files, plus the new module, green together.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js tests/reconcile.test.js
git commit -m "feat: reconcile() creates one shared issue-list cache per pass, threaded into archive+reap (refs #2505)"
```

---

## Self-review

- **Spec coverage:**
  - "Design and implement a shared per-reconcile-pass cache... scoped correctly across every call site active in one reconcile pass" — Task 1 (the cache module) + Tasks 2-4 (threading `runner` through every call site in `cache.js`, `archive-merged.js`, `reap-merged.js`) + Task 5 (one instance per `reconcile()` pass, shared between `archive` and `reap`).
  - "A single reconcile pass touching N stuck dirs/paths makes at most one gh issue list --limit 10000 call for a given repo, not N" — proven directly by Task 3's two-simultaneous-dirs test (archive) and Task 4's two-simultaneous-paths test (reap); Task 5 proves the SAME cache instance (hence the SAME memo) is shared between the two checks, so the guarantee holds across the whole pass, not just within one check.
  - "No change to which duplicates are detected or how dedup-hit/append/reopen decisions are made" — `escalate-residue.js` itself is untouched; only its already-injectable `runner` param is now fed a memoizing wrapper instead of always defaulting to `defaultRunner`.
  - "Cache is correctly scoped to one reconcile pass (no stale cross-pass reuse)" — Task 5's cache is created fresh (`const issueListCache = createIssueListCache();`) on every `reconcile()` call, never a module-level variable; Task 1's own module holds no state outside a `createIssueListCache()` instance's closure.
- **Placeholders:** none — every step above shows complete, runnable code or an exact line-range edit instruction.
- **Type consistency:** `runner: (argv: string[]) => string` is the one signature threaded through every layer (`createIssueListCache`'s `runner` → `trackResidue`/`pruneResidueFailures`'s `runner` → `trackStuckSkip`/`trackArchiveResult`/`trackReapResidue`'s `runner` → `escalateResidue`/`resolveResidue`/`findResidueDuplicate`'s existing `runner` param) — verified against `escalate-residue.js`'s own existing signatures (read in full during planning) rather than assumed.
