# docs-health verify-commit: serialize the shallow-clone deepen fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop concurrent `docs-health verify-commit` CLI invocations (separate OS processes, as `docs-health --budget > 1`'s parallel judge agents each run it) from racing the same shallow-clone `git fetch --unshallow`, and stop a too-large repo from re-paying a full `DEEPEN_TIMEOUT_MS` (120000ms) fetch attempt on every call within one process run.

**Architecture:** Add one internal helper, `deepenShallowClone(git, root, remote)`, to `plugin/bin/lib/docs-health/commit-ref.js`. It wraps the existing deepen-fetch logic in the project's existing cross-process mkdir mutex (`plugin/bin/lib/file-lock.js`'s `acquireLock`/`releaseLock`), keyed by the resolved repo root, with a per-call extended wait (so a losing caller blocks through the winner's fetch instead of racing it), and re-checks shallow state both before and after the lock so a caller that only waited never re-fetches work another caller already did. A module-level `Map`, keyed the same way, remembers a confirmed timeout for the life of the process so a repeated same-process call skips straight to the cached failure.

**Tech Stack:** Node.js built-ins only (`path`, `child_process`, `fs` via the existing `execFileSync`-based `git` injection point); the existing `plugin/bin/lib/file-lock.js` module. No new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172417-record-2988/work/2988-spec.md` (GitHub issue #2988) — executors read both.

## Global Constraints

- Reuse `plugin/bin/lib/file-lock.js`'s existing `acquireLock`/`releaseLock` primitives verbatim — do not hand-roll a second lock mechanism.
- No new npm dependencies; Node built-ins only (`path`, `child_process`, `Atomics`/`SharedArrayBuffer` for a test's synchronous sleep — the same primitive `file-lock.js`'s own `sleepSync` already uses).
- The `verify-commit` CLI's output contract for a single, uncontended caller is unchanged (per the spec's Release Note) — every one of the 15 pre-existing tests in `tests/bin-lib/docs-health/commit-ref.test.js` must keep passing unmodified.
- The same-run deepen-timeout cache is in-process only (a plain `Map`) — it is not, and must never be documented as, a cross-process memory of a prior timeout. Each CLI invocation is its own fresh process; the cache only helps a caller that invokes `verifyCommits` more than once against the same root within one process (a test harness, or a future batched caller).
- `risk:low size:medium ceremony:fast-lane` — keep the change proportionate: two tasks, no new files beyond the existing module/test pair.

## Review Focus

- A lock never released on an unexpected throw inside the critical section, stranding every later caller against that repo — Task 2's "lock is released even when fetch throws" test.
- The process-wide `CLAUDE_TWEAKS_LOCK_WAIT_MS` env-var override used to extend the wait leaking past this one call into the rest of the process — Task 2's "env var restored" test.
- A transient (non-timeout) fetch failure — a bad remote, a network blip — wrongly cached as a permanent timeout, blocking every later retry for the rest of the run — Task 2's "non-timeout failure does not poison the cache" test.
- The cache or lock bleeding across two different repos sharing one process (a multi-repo docs-health run) — Task 2's "cache is keyed per repo root" test.
- The real cross-process race itself — the bug's actual reported symptom — going unverified by a mocked, single-process-only test suite — Task 1's real two-child-process test.

---

### Task 1: Serialize the shallow-clone deepen fetch across concurrent OS processes

**Files:**
- Modify: `plugin/bin/lib/docs-health/commit-ref.js`
- Test: `tests/bin-lib/docs-health/commit-ref.test.js`

**Interfaces:**
- Consumes: `plugin/bin/lib/file-lock.js`'s `acquireLock(lockPath)` / `releaseLock(held)` (existing, unmodified).
- Produces: `deepenShallowClone(git, root, remote)` (internal, not exported) returning `{ stillShallow: boolean }` on success or `{ error: string }` on failure. `commit-ref.js` additionally exports a new `DEEPEN_LOCK_FILENAME` string constant (the lock's basename inside `{root}/.git/`) so the test in this task — and Task 2's tests — construct the exact same lock path the implementation uses, without duplicating the literal.

- [ ] **Step 1: Write the failing test — real cross-process race**

Add these requires to the top of `tests/bin-lib/docs-health/commit-ref.test.js` (alongside the existing ones):

```js
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
```

Append this test to the file:

```js
test('two real child processes racing verifyCommits against the same shallow clone: exactly one real fetch, both classify correctly (#2988)', async () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const counterPath = path.join(tmpDir('counter'), 'fetch-count.txt');
  fs.writeFileSync(counterPath, '');
  const commitRefModule = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'docs-health', 'commit-ref.js');

  // Each child sleeps synchronously right before the real fetch it's
  // about to issue -- widening the real git fetch's own duration so two
  // children spawned back-to-back reliably overlap instead of depending
  // on OS scheduling luck. The sleep happens in THIS wrapper, never
  // inside git itself, so it never interacts with execFileSync's own
  // DEEPEN_TIMEOUT_MS bound.
  const raceWorkerScript = (hash) => `
    const fs = require('fs');
    const { verifyCommits, defaultGit } = require(${JSON.stringify(commitRefModule)});
    function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
    const countingGit = (args, opts) => {
      if (args.includes('fetch')) {
        fs.appendFileSync(${JSON.stringify(counterPath)}, '1\\n');
        sleepSync(300);
      }
      return defaultGit(args, opts);
    };
    const r = verifyCommits({
      root: ${JSON.stringify(dir)}, hashes: [${JSON.stringify(hash)}],
      integrationBranch: 'main', git: countingGit,
    });
    process.stdout.write(JSON.stringify(r));
  `;

  function runChild(hash) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['-e', raceWorkerScript(hash)]);
      let stdout = ''; let stderr = '';
      p.stdout.on('data', (d) => { stdout += d; });
      p.stderr.on('data', (d) => { stderr += d; });
      p.on('close', (code) => (code === 0
        ? resolve(JSON.parse(stdout))
        : reject(new Error(`child exited ${code}: ${stderr}`))));
      p.on('error', reject);
    });
  }

  const [resultA, resultB] = await Promise.all([runChild(origin.root), runChild(origin.sideOnly)]);

  const fetchCount = fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length;
  assert.strictEqual(fetchCount, 1, 'exactly one real git fetch --unshallow must be issued across both racing processes');
  assert.deepStrictEqual(resultA.commits, [{ input: origin.root, outcome: 'reachable', sha: origin.root }]);
  assert.deepStrictEqual(resultB.commits, [{ input: origin.sideOnly, outcome: 'exists-unreachable', sha: origin.sideOnly }]);
  assert.strictEqual(resultA.shallow.deepened, true);
  assert.strictEqual(resultB.shallow.deepened, true);
});
```

- [ ] **Step 2: Run it against the current (pre-fix) code to confirm it fails**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: FAIL. Pre-fix, both children call the real `git fetch --unshallow` concurrently against the same clone with no coordination at all — `fetchCount` reads `2` (both attempted), and/or one child's result shows `outcome: 'unverifiable'` where a real concurrent fetch collided on git's own internal lock (e.g. `.git/shallow.lock`) and failed. This step is a manual, timing-sensitive sanity check of the pre-fix bug, not a permanent assertion — if one run happens not to collide, re-run it once or twice; the test only needs to be reliably green *after* Task 1 Step 3 below, which is what CI actually depends on.

- [ ] **Step 3: Implement the cross-process lock**

In `plugin/bin/lib/docs-health/commit-ref.js`, add `path` to the top requires:

```js
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { acquireLock, releaseLock } = require('../file-lock');
```

Add this constant near the top, alongside the existing `DEEPEN_TIMEOUT_MS`:

```js
// Basename of the cross-process lock file-lock.js creates under
// `{root}/.git/` to serialize concurrent --unshallow fetches against the
// same repo (#2988). Exported so tests construct the exact same path the
// implementation below uses, rather than duplicating the literal.
const DEEPEN_LOCK_FILENAME = 'docs-health-verify-commit.lock';
```

Add this helper function directly above `function verifyCommits(...)`:

```js
// Serializes the --unshallow fetch for `root` across every concurrent
// caller -- across OS processes via file-lock.js's cross-process mkdir
// mutex (#2988): under docs-health --budget > 1, concurrent judge agents
// each run the verify-commit CLI as a separate process against the same
// shared shallow checkout, so an in-process-only guard would not
// serialize them.
//
// Returns { stillShallow: boolean } on success (the fetch outcome,
// whichever caller actually performed it, or the already-deepened state
// found on re-check) or { error: string } on failure.
function deepenShallowClone(git, root, remote) {
  const cacheKey = path.resolve(root);
  const lockPath = path.join(cacheKey, '.git', DEEPEN_LOCK_FILENAME);
  // file-lock's default wait (500ms) is far too short to block a waiting
  // caller through another process's own DEEPEN_TIMEOUT_MS-bounded fetch
  // -- override it just for this acquisition, restoring whatever the
  // calling process had (or lacked) immediately after, so this module
  // never leaves a process-wide env mutation behind.
  const prevWait = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = String(DEEPEN_TIMEOUT_MS);
  let held;
  try {
    held = acquireLock(lockPath);
  } finally {
    if (prevWait === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prevWait;
  }
  try {
    // Re-check after acquiring (or failing to acquire) the lock: another
    // caller -- the lock's prior holder -- may have already deepened this
    // exact repo while this caller waited. Skipping a redundant fetch
    // here is what turns the loser's old "fetch fails, report
    // unverifiable" outcome into a correct classification against the
    // now-complete history instead.
    let shallowNow;
    try {
      shallowNow = isShallow(git, root);
    } catch (err) {
      return { error: `could not re-check shallow state: ${errorText(err)}` };
    }
    if (!shallowNow) return { stillShallow: false };
    try {
      git(['-C', root, 'fetch', '--quiet', '--unshallow', '--no-tags', remote,
        `+refs/heads/*:refs/remotes/${remote}/*`], {
        timeout: DEEPEN_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      return { error: errorText(err) };
    }
    try {
      return { stillShallow: isShallow(git, root) };
    } catch (err) {
      return { error: `could not re-check after deepening: ${errorText(err)}` };
    }
  } finally {
    releaseLock(held);
  }
}
```

Replace the existing shallow-handling block inside `verifyCommits` (currently the `if (result.shallow.initial) { ... }` block that does the fetch inline) with:

```js
  if (result.shallow.initial) {
    if (!deepen) return allUnverifiable('shallow clone: history is incomplete and deepening was disabled');
    const deepenOutcome = deepenShallowClone(git, root, remote);
    if (deepenOutcome.error) {
      result.shallow.error = deepenOutcome.error;
      return allUnverifiable(`shallow clone: deepening fetch from ${remote} failed (${deepenOutcome.error})`);
    }
    if (deepenOutcome.stillShallow) return allUnverifiable('shallow clone: still shallow after deepening');
    result.shallow.deepened = true;
  }
```

Update the module's final export line to add the new constant:

```js
module.exports = { verifyCommits, defaultGit, OUTCOMES, DEEPEN_TIMEOUT_MS, DEEPEN_LOCK_FILENAME };
```

- [ ] **Step 4: Run the new test and the full existing suite to confirm it passes**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: PASS — all 15 pre-existing tests plus the new race test, with `fetchCount === 1` and both children reporting correct, non-`unverifiable` outcomes every time (the lock makes this deterministic post-fix, unlike the pre-fix sanity check in Step 2).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/docs-health/commit-ref.js tests/bin-lib/docs-health/commit-ref.test.js
git commit -m "fix: docs-health verify-commit: serialize concurrent shallow-clone deepen fetches

refs #2988"
```

---

### Task 2: Add the same-run deepen-timeout cache and harden the lock's edge cases

**Files:**
- Modify: `plugin/bin/lib/docs-health/commit-ref.js`
- Test: `tests/bin-lib/docs-health/commit-ref.test.js`

**Interfaces:**
- Consumes: Task 1's `deepenShallowClone(git, root, remote)`, `DEEPEN_LOCK_FILENAME`, `DEEPEN_TIMEOUT_MS`.
- Produces: no new exports — the cache is purely internal to `deepenShallowClone`.

- [ ] **Step 1: Write the failing tests**

Add `defaultGit` to the existing top-of-file require in `tests/bin-lib/docs-health/commit-ref.test.js`:

```js
const { verifyCommits, defaultGit, OUTCOMES, DEEPEN_LOCK_FILENAME } = require('../../../plugin/bin/lib/docs-health/commit-ref');
```

Append these five tests:

```js
test('a cached deepen-timeout is not retried with a fresh fetch on a second call in the same process (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  let fetchCalls = 0;
  const timeoutGit = (args, opts) => {
    if (args.includes('fetch')) {
      fetchCalls += 1;
      const err = new Error('git fetch --unshallow timed out');
      err.signal = 'SIGTERM';
      throw err;
    }
    return defaultGit(args, opts);
  };
  const first = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(first, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1);

  const second = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(second, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1, 'the cached timeout must not trigger a second real fetch attempt');
});

test('the deepen lock is released even when the fetch throws, leaving the repo lockable immediately after (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const failingGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    return defaultGit(args, opts);
  };
  const r = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: failingGit });
  assert.strictEqual(outcomeOf(r, origin.third), 'unverifiable');

  const { acquireLock, releaseLock } = require('../../../plugin/bin/lib/file-lock');
  const lockPath = path.join(dir, '.git', DEEPEN_LOCK_FILENAME);
  const held = acquireLock(lockPath);
  assert.notStrictEqual(held, null, 'the lock must be free immediately after an ordinary (non-timeout) fetch failure');
  releaseLock(held);
});

test('CLAUDE_TWEAKS_LOCK_WAIT_MS is restored after a deepen attempt, even on failure (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const failingGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    return defaultGit(args, opts);
  };
  const prev = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '42';
  try {
    verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: failingGit });
    assert.strictEqual(process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS, '42');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
    else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prev;
  }
});

test('a non-timeout fetch failure does not poison the cache -- a later call still attempts a fresh fetch (#2988)', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  let fetchCalls = 0;
  const flakyGit = (args, opts) => {
    if (args.includes('fetch')) {
      fetchCalls += 1;
      if (fetchCalls === 1) { const err = new Error('network unreachable'); err.status = 1; throw err; }
    }
    return defaultGit(args, opts);
  };
  const first = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: flakyGit });
  assert.strictEqual(outcomeOf(first, origin.third), 'unverifiable');
  assert.strictEqual(fetchCalls, 1);

  const second = verifyCommits({ root: dir, hashes: [origin.third], integrationBranch: 'main', git: flakyGit });
  assert.strictEqual(outcomeOf(second, origin.third), 'reachable');
  assert.strictEqual(fetchCalls, 2, 'a non-timeout failure must not be cached -- the second call retries for real');
});

test('the deepen-timeout cache is keyed per repo root -- a cached timeout for one repo does not block a different one (#2988)', () => {
  const originA = makeOriginRepo();
  const dirA = cloneOf(originA, { depth: 1 });
  const originB = makeOriginRepo();
  const dirB = cloneOf(originB, { depth: 1 });
  const timeoutGit = (args, opts) => {
    if (args.includes('fetch')) { const err = new Error('timed out'); err.signal = 'SIGTERM'; throw err; }
    return defaultGit(args, opts);
  };
  const a1 = verifyCommits({ root: dirA, hashes: [originA.third], integrationBranch: 'main', git: timeoutGit });
  assert.strictEqual(outcomeOf(a1, originA.third), 'unverifiable');

  const b1 = verifyCommits({ root: dirB, hashes: [originB.third], integrationBranch: 'main', git: defaultGit });
  assert.strictEqual(outcomeOf(b1, originB.third), 'reachable', "repo B must still deepen normally -- its own cache entry is independent of repo A's");
});
```

- [ ] **Step 2: Run to verify these fail**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: FAIL on the first new test (`a cached deepen-timeout is not retried...`) — `fetchCalls` reads `2` on the second call, since no cache exists yet. (The other four new tests may already pass against Task 1's code alone — e.g. the lock-release and env-var-restore tests, since Task 1's `finally` blocks already cover those paths. That's fine: they're written now for the AC's explicit test-count intent and Review Focus coverage, and this step only needs to confirm the *timeout-cache* test is the one driving the real failure.)

- [ ] **Step 3: Implement the timeout cache**

In `plugin/bin/lib/docs-health/commit-ref.js`, add the cache and a timeout classifier directly above `deepenShallowClone`:

```js
// Keyed by the resolved repo root -- a same-process cache only (#2988): a
// separate CLI invocation is a fresh process with an empty cache, so this
// only helps a caller that invokes verifyCommits more than once against
// the same root within one process (a test harness, or a future batched
// caller). It is not, and must not be read as, a cross-process memory of
// a prior timeout.
const deepenTimeoutCache = new Map();

// execFileSync kills the child on a timeout using killSignal (SIGTERM by
// default), and the resulting error carries that signal with no exit
// code; an ordinary non-zero-exit git failure carries .status instead,
// with no .signal. This is how a genuine DEEPEN_TIMEOUT_MS timeout is
// told apart from a transient fetch failure (bad remote, network error),
// which must NOT poison the cache -- a transient failure should still be
// retried on the next call.
function isTimeoutError(err) {
  return Boolean(err && err.signal);
}
```

Inside `deepenShallowClone`, add the cache short-circuit as the first statement in the function body (before computing `lockPath`):

```js
function deepenShallowClone(git, root, remote) {
  const cacheKey = path.resolve(root);
  const cached = deepenTimeoutCache.get(cacheKey);
  if (cached) return { error: cached };

  const lockPath = path.join(cacheKey, '.git', DEEPEN_LOCK_FILENAME);
  // ... unchanged from Task 1 below this line ...
```

And update the fetch `catch` block inside `deepenShallowClone` (added in Task 1) to record a confirmed timeout:

```js
    try {
      git(['-C', root, 'fetch', '--quiet', '--unshallow', '--no-tags', remote,
        `+refs/heads/*:refs/remotes/${remote}/*`], {
        timeout: DEEPEN_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      const message = errorText(err);
      if (isTimeoutError(err)) deepenTimeoutCache.set(cacheKey, message);
      return { error: message };
    }
```

- [ ] **Step 4: Run the new tests and the full existing suite to confirm everything passes**

Run: `node --test tests/bin-lib/docs-health/commit-ref.test.js`
Expected: PASS — all 15 original tests, Task 1's race test, and all 5 of Task 2's new tests.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/docs-health/commit-ref.js tests/bin-lib/docs-health/commit-ref.test.js
git commit -m "fix: docs-health verify-commit: cache a same-run deepen-timeout so it is not retried

refs #2988"
```
