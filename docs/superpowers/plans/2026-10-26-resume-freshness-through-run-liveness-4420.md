# Resume Freshness Through Run-Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `checkResumeFreshness` and `parentLiveDetail` through `runLiveness` via one shared `blocksResume` helper, and delete their private lock and `git log` probes, with every decision kept except the listed intentional changes, all of which move toward blocking.

**Architecture:** `lastCommitMs`/`isUnbornHead` move into `run-liveness/probes.js`, which breaks the `run-liveness → hooks/resume-freshness` require. `run-liveness/index.js` exports `blocksResume(result)`. It reads only the `worktree-lock` and `last-commit` evidence entries, and either one being `positive` or `error` blocks. Both callers keep their pre-probe early returns, call `runLiveness` with injectable `probes`, and map the two entries to their existing result shapes.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real-git fixtures from `tests/helpers/git-fixtures.js`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T123848-spec-4336-4419-4420-4421/spec-4420/work/4420-spec.md`

## Global Constraints

- Verdict strings stay exactly `no-state`, `own-session`, `not-interrupted`, `no-worktree`, `worktree-gone`, `locked`, `recent-commit`, `indeterminate`, `stale`; no new string; `recent-commit` still carries `ageMs` (AC 5).
- `checkResumeFreshness`'s five pre-probe returns stay first, in today's order; `not-interrupted` returns before any probe (the two-call dispatch handoff).
- `blocksResume` considers **only** `worktree-lock` and `last-commit`; `owner-pid`, `heartbeat` and `owner-events` never block (maintainer ruling 2026-10-26).
- An `error` on `worktree-lock`/`last-commit` never falls through to `stale` — fail closed.
- A positive always beats an error (`locked`, then `recent-commit`, then `indeterminate`).
- `RESUME_FRESHNESS_THRESHOLD_MS` is defined from `run-liveness/constants.js`'s `LIVE_WINDOW_MS`; the `thresholdMs` option is removed.
- `plugin/bin/hooks.js` and `plugin/bin/lib/flow/preflight.js` get no code change (AC 7).
- One commit per task, in this order, so each equivalence row bisects: move, `blocksResume`, `checkResumeFreshness`, `parentLiveDetail`.
- `docs/hooks.md` holds one very long line per bullet: edit sentences in place, never reflow.

## Review Focus

1. A recorded worktree reached through a symlink, with a live lock: still `locked`. `lockInUse` matches via `findWorktreeEntry(…, safeReal(worktree) || worktree)`, where the old code compared both the real and the raw path (Task 3 test "symlinked worktree path").
2. A commit dated in the future (clock skew) still blocks as `recent-commit`, with a negative `ageMs`, as today (Task 3 test "future-dated commit").
3. A recorded worktree that is a regular file, not a directory, stays `indeterminate`. Today `mainCheckoutRoot` fails on it; under `runLiveness`, `worktreeTarget` reports an error (Task 3 test "worktree path is a file").
4. `own-session` with every probe throwing returns before any probe runs, and so does `not-interrupted` (Task 3 tests AC2.1 and "own session").
5. An owner block from another session (`owner-session-mismatch` errors on the owner probes) never blocks a resume (Task 3 test AC4.1, mismatch row).

---

### Task 1: Move `lastCommitMs` and `isUnbornHead` into `run-liveness/probes.js`

**Files:**
- Modify: `plugin/bin/lib/run-liveness/probes.js` (receive both functions and drop the `../hooks/resume-freshness` require; export `lastCommitMs`)
- Modify: `plugin/bin/lib/hooks/resume-freshness.js` (delete both functions, the `lastCommitMs` export, and the now-unused `path`/`FAILURE` imports; `checkResumeFreshness` is untouched in this task)
- Modify: `docs/plugin-structure.md:44` ("lastCommitAt via hooks/resume-freshness.js's lastCommitMs" → "lastCommitAt via probes.js's own lastCommitMs (moved from hooks/resume-freshness.js, #4420)")
- Test: `tests/bin-lib/run-liveness/probes.test.js` (re-point the `lastCommitMs` import at `probes.js`; add the load test)

**Interfaces:**
- Produces: `require('plugin/bin/lib/run-liveness/probes').lastCommitMs(worktree: string) -> number | null`, with the same contract as today: it throws when it cannot ask, and returns `null` on an unborn HEAD or empty output. `isUnbornHead` stays module-private.

- [ ] **Step 1: Write the failing test** in `tests/bin-lib/run-liveness/probes.test.js`, and change the line-10 import to `const { lastCommitMs } = require('../../../plugin/bin/lib/run-liveness/probes');`:

```js
test('AC6.1: run-liveness loads without requiring hooks/resume-freshness', () => {
  const index = path.join(__dirname, '../../../plugin/bin/lib/run-liveness/index.js');
  const script = "require(process.argv[1]); process.stdout.write(String(Object.keys(require.cache).some((k) => k.endsWith(require('path').join('hooks', 'resume-freshness.js')))))";
  const out = execFileSync(process.execPath, ['-e', script, index], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(out, 'false');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC6.1" tests/bin-lib/run-liveness/probes.test.js`
Expected: FAIL. `lastCommitMs` is not yet exported from `probes.js`, so every `lastCommitMs` test errors, and the load test reads `'true'`.

- [ ] **Step 3: Move the two functions verbatim** (bodies and comments) into `probes.js`, above `DEFAULT_PROBES`. Add `fs`, `path` and `FAILURE` (from `../hooks/git-exec`) to its requires, and drop `lastCommitMs`'s "frozen until #3979" sentence. Delete them from `resume-freshness.js`, and set its export to `{ checkResumeFreshness, RESUME_FRESHNESS_THRESHOLD_MS }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/probes.test.js tests/bin-lib/run-liveness/index.test.js tests/hooks-resume-freshness.test.js`
Expected: PASS
Run: `git grep -n -e lastCommitMs -e isUnbornHead -- plugin tests docs ':!docs/superpowers/plans'`
Expected: hits only in `plugin/bin/lib/run-liveness/probes.js`, `tests/bin-lib/run-liveness/probes.test.js` and `docs/plugin-structure.md`

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/probes.js plugin/bin/lib/hooks/resume-freshness.js docs/plugin-structure.md tests/bin-lib/run-liveness/probes.test.js
git commit -m "Move lastCommitMs into run-liveness/probes — run-liveness no longer requires hooks/resume-freshness (#4420)"
```

### Task 2: Export `blocksResume` from `run-liveness`

**Files:**
- Modify: `plugin/bin/lib/run-liveness/index.js` (add and export `blocksResume`; the header's "One consumer" line becomes "Consumers: … plus `blocksResume`'s two resume callers (#4420)")
- Test: `tests/bin-lib/run-liveness/index.test.js`

**Interfaces:**
- Produces: `blocksResume(result: { evidence: {probe, result, detail}[] } | any) -> boolean`. It returns true when the `worktree-lock` or `last-commit` entry has `result` `positive` or `error`, and also when `result` carries no `evidence` array, because a missing answer can't be read as no. Everything else is false, including `last-commit` `negative`/`no-commits`; the callers handle that case themselves (Task 3, Task 4).

- [ ] **Step 1: Write the failing tests** (import `blocksResume` alongside `PROBE_ORDER`):

```js
const evidenceWith = (over) => ({ verdict: 'unknown', evidence: PROBE_ORDER.map((probe) => ({ probe, result: 'negative', detail: 'x', ...(over[probe] || {}) })) });

test('blocksResume: a positive or erroring worktree-lock or last-commit entry blocks', () => {
  for (const probe of ['worktree-lock', 'last-commit']) {
    for (const result of ['positive', 'error']) {
      assert.strictEqual(blocksResume(evidenceWith({ [probe]: { result } })), true, `${probe} ${result}`);
    }
  }
});

test('blocksResume: owner-pid, heartbeat and owner-events never block, whatever their result', () => {
  for (const probe of ['owner-pid', 'heartbeat', 'owner-events']) {
    for (const result of ['positive', 'error']) {
      assert.strictEqual(blocksResume(evidenceWith({ [probe]: { result } })), false, `${probe} ${result}`);
    }
  }
  assert.strictEqual(blocksResume(evidenceWith({})), false);
  assert.strictEqual(blocksResume(evidenceWith({ 'last-commit': { detail: 'no-commits' } })), false);
});

test('blocksResume: a result with no evidence array blocks (cannot tell)', () => {
  for (const r of [null, undefined, {}, { evidence: 'x' }]) assert.strictEqual(blocksResume(r), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/lib/run-liveness').blocksResume === 'function' ? 0 : 1)"`
Expected: FAIL (exit 1). `blocksResume` is not exported yet. Then `node --test tests/bin-lib/run-liveness/index.test.js` fails with "blocksResume is not a function".

- [ ] **Step 3: Implement `blocksResume`** in `index.js`, with a comment stating the ruling: owner probes are informational, and widening the helper turns every missing `events.jsonl` and every just-ended session into a blocked resume (#3979 red-team). Export it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/index.js tests/bin-lib/run-liveness/index.test.js
git commit -m "Add run-liveness blocksResume — lock and commit evidence only, owner probes never block (#4420)"
```

### Task 3: Route `checkResumeFreshness` through `runLiveness`

**Files:**
- Modify: `plugin/bin/lib/hooks/resume-freshness.js`
  - Replace the lock and `git log` section with the mapping below.
  - Add an `opts.probes` pass-through; remove `opts.thresholdMs`.
  - Set `RESUME_FRESHNESS_THRESHOLD_MS = LIVE_WINDOW_MS`, keeping its rationale comment.
  - Drop the imports that are no longer used: `parseWorktreeList`, `lockVerdict`, `mainCheckoutRoot`, `safeReal`, `runGit`.
  - Require `../run-liveness` and `../run-liveness/constants` at top level. There is no cycle: after Task 1, nothing under `run-liveness/` requires this file.
- Modify: `plugin/skills/_shared/run-resume-freshness.md`
  - Rewrite steps 4–5 and the "An unresolvable git call …" sentence: the probes are `runLiveness`'s `worktree-lock` and `last-commit` entries read through `blocksResume`.
  - An unknown lock, an unlisted worktree, a failed listing or `git log`, an unparseable time, and no commits are all `indeterminate`.
  - An orphaned lock is not a blocker.
  - In the `indeterminate` remedy, name the unknown-lock case: the `git worktree lock` reason carries no pid.
- Test: `tests/hooks-resume-freshness.test.js`
- Callers checked, with no change needed (dependency-caller enumeration):
  - `tests/hooks-dispatcher.test.js:1410-1430`: a real repo is its own listed worktree, so lock is `free` and the fresh commit gives `recent-commit`; the reason regex still matches.
  - `tests/bin-lib/flow/preflight.test.js`: stubs `checkResumeFreshness`.
  - `tests/bin-lib/flow/consolidated-pass.test.js`: stubs it on the interrupted path.

**Interfaces:**
- Consumes: `runLiveness(runDir, { now, probes })` and `blocksResume(result)` from `plugin/bin/lib/run-liveness`; `DEFAULT_PROBES` from `run-liveness/probes`; `LIVE_WINDOW_MS` from `run-liveness/constants`.
- Produces: `checkResumeFreshness(runDir, { sessionId?, now?, probes? }) -> { safe, verdict, reason?, ageMs? }`, with the same shape as today and `thresholdMs` gone. `probes` is merged over `DEFAULT_PROBES` by `runLiveness`.

The mapping applies after the five unchanged early returns. It is an algorithm the signature doesn't determine, so here it is:

```js
let commitAt = null;
const lastCommitAt = (opts.probes && opts.probes.lastCommitAt) || DEFAULT_PROBES.lastCommitAt;
const probes = { ...(opts.probes || {}), lastCommitAt: (wt) => (commitAt = lastCommitAt(wt)) };
const result = runLiveness(runDir, { now, probes });
const entry = (name) => result.evidence.find((e) => e.probe === name);
const lock = entry('worktree-lock');
const commit = entry('last-commit');
if (lock.result === 'positive') return { safe: false, verdict: 'locked', reason: 'worktree lock held by a live process' };
if (commit.result === 'positive') {
  return { safe: false, verdict: 'recent-commit', reason: `worktree committed to within the last ${Math.round(RESUME_FRESHNESS_THRESHOLD_MS / 60000)} minutes`, ageMs: now - commitAt };
}
if (blocksResume(result)) return { safe: false, verdict: 'indeterminate', reason: (lock.result === 'error' ? lock : commit).detail };
if (commit.detail === 'no-commits') return { safe: false, verdict: 'indeterminate', reason: 'could not determine worktree activity' };
return { safe: true, verdict: 'stale' };
```

- [ ] **Step 1: Write the failing tests.** Shared helpers:

```js
const { LIVE_WINDOW_MS } = require('../plugin/bin/lib/run-liveness/constants');
const OLD = Date.parse('2026-01-01T00:00:00Z');
const thrower = (msg) => () => { throw new Error(msg); };
// An interrupted run whose recorded worktree is a real, existing directory; the
// lock and commit answers come from `probes`.
function probed(probes, state = {}, now = Date.now()) {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resume-freshness-wt-'));
  const runDir = tmpRunDir({ status: 'interrupted', sessionId: 'sess-a', worktree: wt, ...state });
  return checkResumeFreshness(runDir, { sessionId: 'sess-b', now, probes });
}
```

Tests (name, then assertions):

- `AC1.2: an unknown worktree lock is indeterminate, no longer read as unlocked`
  - `probed({ lockInUse: thrower('worktree lock state is unknown for X'), lastCommitAt: () => OLD })` deep-equals `{ safe: false, verdict: 'indeterminate', reason: 'worktree lock state is unknown for X' }`.
  - Real fixture: `linkedWorktreeOf(gitRepo())`, `git worktree lock --reason held` (no pid), a commit backdated with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` = `2026-01-01T00:00:00Z`. The verdict is `indeterminate`.
- `AC1.2: a worktree git does not list is indeterminate`
  - `probed({ lockInUse: thrower('W is not listed by git worktree list in R'), lastCommitAt: () => OLD })` gives verdict `indeterminate`.
- `AC1.2: an orphaned lock is unchanged — the old commit reads stale`
  - Real fixture: the lock reason is `claude session test (pid 2147483646 start now)` and the commit is backdated as above; `now: Date.now()`.
  - The verdict is `stale`, safe.
- `AC3.1: every old indeterminate source fails closed with a non-empty reason`. Each row of this table gives `safe === false`, `verdict === 'indeterminate'`, and a `reason` that is a non-empty string:
  - `{ lockInUse: thrower('could not resolve the main checkout of W') }`
  - `{ lockInUse: thrower('could not list worktrees from R: git timeout') }`
  - `{ lockInUse: () => false, lastCommitAt: thrower('could not read the last commit time of W: git error') }`
  - `{ lockInUse: () => false, lastCommitAt: () => null }` (empty log or unborn HEAD)
  - `{ lockInUse: () => false, lastCommitAt: () => NaN }` (unparseable)
- `AC3.1: a real unborn-HEAD worktree is indeterminate`
  - The worktree is a fresh `git init -q` directory with no commit, and no probes are injected.
  - The verdict is `indeterminate`. The lock entry may error or be negative, and both paths end there.
- `AC4.1: owner-probe noise never blocks a quiet interrupted run`. Each row uses `lockInUse: () => false, lastCommitAt: () => OLD` and asserts `{ safe: true, verdict: 'stale' }`:
  - **Fresh heartbeat and live owner pid.** `state.owner = { sessionId: 'sess-a', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T1', heartbeatAt: new Date().toISOString() }` with `hostname: () => 'h', pidAlive: () => true, pidStartTime: () => 'T1'`.
  - **No `events.jsonl`.** This is the `tmpRunDir` default.
  - **Owner block from another session.** `owner.sessionId: 'other'`, which gives `owner-session-mismatch`.
- `AC2.1: an active run returns not-interrupted before any liveness probe runs`
  - Every probe in `['hostname','pidAlive','pidStartTime','lockInUse','lastCommitAt','ownEventAt','pathType']` is a recording thrower.
  - `tmpRunDir({ status: 'active', sessionId: 'sess-a', worktree: os.tmpdir() })` deep-equals `{ safe: true, verdict: 'not-interrupted' }`, and the recorded calls are `[]`. `runLiveness` always calls `ownEventAt` and `pathType`, so zero calls means it was never invoked.
- `own session returns before any liveness probe runs` makes the same assertion with `sessionId: 'sess-a'` and `status: 'interrupted'`, expecting `own-session`.
- `AC5.1 AC5.2 AC5.3: the verdict set is exactly today's nine, and recent-commit carries ageMs`
  - Build one result per verdict:
    - `no-state`: `tmpRunDir(null)`.
    - `own-session`, `not-interrupted` and `no-worktree`: plain run-states.
    - `worktree-gone`: a path under a deleted mkdtemp.
    - `locked`: `lockInUse: () => true`.
    - `recent-commit`: `lockInUse: () => false, lastCommitAt: () => now - 60000`.
    - `indeterminate`: the lock throws.
    - `stale`: `lastCommitAt: () => OLD`.
  - Assert the sorted set deep-equals the nine Global Constraints strings, and `recent.ageMs === 60000` (`now` fixed).
- `symlinked worktree path with a live lock is still locked`
  - Real linked worktree locked with `claude session test (pid ${process.pid} start now)` (the existing line-52 reason), recorded through a symlink to it.
  - The verdict is `locked`.
- `future-dated commit is recent-commit with a negative ageMs`
  - `lockInUse: () => false, lastCommitAt: () => now + 60000` gives `recent-commit`, and `ageMs === -60000`.
- `worktree path is a file stays indeterminate`
  - The recorded worktree is a regular file; no probes are injected. The verdict is `indeterminate`.
- `RESUME_FRESHNESS_THRESHOLD_MS is the run-liveness live window`
  - `assert.equal(RESUME_FRESHNESS_THRESHOLD_MS, LIVE_WINDOW_MS)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "const fs = require('fs'), os = require('os'), p = require('path'); const d = fs.mkdtempSync(p.join(os.tmpdir(), 'ct-c3-')); const w = fs.mkdtempSync(p.join(os.tmpdir(), 'ct-c3-wt-')); fs.writeFileSync(p.join(d, 'run-state.json'), JSON.stringify({ status: 'interrupted', sessionId: 'a', worktree: w })); const r = require('./plugin/bin/lib/hooks/resume-freshness').checkResumeFreshness(d, { sessionId: 'b', probes: { lockInUse: () => true } }); process.exit(r.verdict === 'locked' ? 0 : 1)"`
Expected: FAIL (exit 1). Today's `checkResumeFreshness` ignores `opts.probes` and reads the non-git tmp worktree as `indeterminate`. Then `node --test tests/hooks-resume-freshness.test.js` fails on the `AC1.2`, `AC4.1` and `AC5.1` tests.

- [ ] **Step 3: Implement the mapping above** in `checkResumeFreshness`. Keep the five early returns byte-for-byte, and reword the header and inline comments that describe the deleted probes so they name `runLiveness`/`blocksResume`. Update `plugin/skills/_shared/run-resume-freshness.md` as listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-resume-freshness.test.js tests/flow-resume-freshness-citations.test.js tests/bin-lib/flow/preflight.test.js tests/bin-lib/flow/consolidated-pass.test.js`
Expected: PASS
Run: `node --test --test-name-pattern="check-resume-freshness" tests/hooks-dispatcher.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/resume-freshness.js plugin/skills/_shared/run-resume-freshness.md tests/hooks-resume-freshness.test.js
git commit -m "Route checkResumeFreshness through runLiveness and blocksResume — delete its lock and git log probes (#4420)"
```

### Task 4: Route `parentLiveDetail` through `runLiveness`

**Files:**
- Modify: `plugin/bin/lib/flow/consolidated-pass.js`
  - Replace `parentLiveDetail`'s non-interrupted branch after its two early `null` returns (see the code below).
  - Delete `listWorktrees` and the `parseWorktreeList`/`lockVerdict`/`mainCheckoutRoot`/`runGit` imports. Keep `safeReal`, which the archive check uses.
  - Update the header and the `opts.deps` comment. The deps are now `{ checkBranchLanded, resolvePrStateByNumber, checkResumeFreshness, probes }`.
- Modify: `docs/hooks.md:59`. Replace the sentence "One caller consumes the verdict: `archive-merged.js`'s `adhoc-session-ended` sweep (#4179), through `adHocSessionLiveness`, which neutralises the lock and commit probes for a main-checkout dir; the remaining consumers are #3977 and #3979." with one naming both routes:
  - the sweep through `adHocSessionLiveness`;
  - `checkResumeFreshness` and `parentLiveDetail` through `blocksResume` (#4420), which reads only the lock and commit entries, blocks on positive or error, and treats the owner probes as informational;
  - "the remaining consumers are #3977 and #4421."

  Edit in place, no reflow.
- Modify: `docs/plugin-structure.md:44`, the same consumer sentence.
- Modify: `plugin/skills/flow/multispec-review-console.md:57`. "An `indeterminate` or `unknown` detail" becomes "An `indeterminate` detail", because an unknown lock now reports as `indeterminate: …`.
- Test: `tests/bin-lib/flow/consolidated-pass.test.js`. Migrate the four `#3497 I1` tests from the `listWorktrees`/`lockVerdict` deps to `deps.probes`, keeping each test's decision:
  - in-use: `lockInUse: () => true`
  - unknown: `lockInUse` throws `worktree lock state is unknown for W`, still `parent-live`
  - failed listing: `lockInUse` throws `could not list worktrees from R: git timeout`, still `parent-live` and `/indeterminate/`
  - orphaned or free: `lockInUse: () => false`

  Every probe set adds `lastCommitAt: () => OLD`. A `NO_CALL` on `listWorktrees` becomes a `NO_CALL` on `probes.lockInUse`.
- Callers checked:
  - `tests/hooks-check-pass-reentry.test.js:97`: a pid-less lock was `unknown` and is now `indeterminate`, still `parent-live`. Its fixture commits are dated 2026-08-01, so they are never recent.
  - `tests/bin-lib/hooks/session-residue.test.js` and `tests/hooks-session-start.test.js`: they use `tests/helpers/reentry-fixture.js`, where commits are dated 2026-08-01 and there is no lock, so lock is `free`, commit is old, and the decision is unchanged.

**Interfaces:**
- Consumes: `runLiveness`, `blocksResume` (Task 2).
- Produces: `parentLiveDetail(runDir, runState, opts, deps) -> string | null`:
  - `'worktree lock in-use'` for a positive lock;
  - `'worktree recently committed to'` for a positive commit;
  - `` `indeterminate: ${detail}` `` for an error, lock first, or for `last-commit` `no-commits` (`detail` = `no-commits`), because AC 3.2 holds it to the same sources as `checkResumeFreshness`;
  - otherwise `null`.

```js
const result = runLiveness(runDir, { probes: deps.probes || {} });
const entry = (name) => result.evidence.find((e) => e.probe === name);
const lock = entry('worktree-lock');
const commit = entry('last-commit');
if (lock.result === 'positive') return 'worktree lock in-use';
if (commit.result === 'positive') return 'worktree recently committed to';
if (blocksResume(result)) return `indeterminate: ${(lock.result === 'error' ? lock : commit).detail}`;
if (commit.detail === 'no-commits') return 'indeterminate: no-commits';
return null;
```

- [ ] **Step 1: Write the failing tests** (`OLD = Date.parse('2026-01-01T00:00:00Z')`, `run` = `makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT } })`):
  - `AC1.2: an unlisted worktree now blocks the pass`
    - `lockInUse` throws `W is not listed by git worktree list in R`.
    - `reason === 'parent-live'`, and `detail` matches `/^indeterminate: .*not listed/`.
  - `AC1.2: a commit under 10 minutes old now blocks a non-interrupted parent`
    - `lockInUse: () => false, lastCommitAt: () => Date.now() - 60000`.
    - `reason === 'parent-live'` and `detail === 'worktree recently committed to'`.
  - `AC1.2: a failed last-commit read now blocks a non-interrupted parent`
    - `lockInUse: () => false, lastCommitAt: thrower('could not read the last commit time of W: git error')`.
    - `parent-live` with `/^indeterminate: /`.
  - `AC3.2: parentLiveDetail is non-null for every old indeterminate source`
    - Use the same five probe rows as Task 3's AC3.1 table.
    - Each gives `reason === 'parent-live'` and a `detail` matching `/^indeterminate: ./`.
  - Migrated `#3497 I1 live worktree lock -> parent-live`: `detail === 'worktree lock in-use'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node -e "const fs = require('fs'), os = require('os'), p = require('path'); const d = p.join(fs.mkdtempSync(p.join(os.tmpdir(), 'ct-c4-')), '2026-08-01T090000-spec-11-12'); fs.mkdirSync(d); const w = fs.mkdtempSync(p.join(os.tmpdir(), 'ct-c4-wt-')); fs.writeFileSync(p.join(d, 'manifest.yml'), 'multispec:\n  parent: .claude-tweaks/pipelines/2026-08-01T090000-spec-11-12/\n  specs:\n    - id: 11\n      status: complete\n      subdir: spec-11/\n'); fs.writeFileSync(p.join(d, 'config.yml'), 'mode: auto\n'); fs.writeFileSync(p.join(d, 'run-state.json'), JSON.stringify({ status: 'active', sessionId: 'parent', worktree: w })); const r = require('./plugin/bin/lib/flow/consolidated-pass').checkPassReentry(d, { deps: { checkBranchLanded: () => ({ landed: false, evidence: {} }), probes: { lockInUse: () => false, lastCommitAt: () => Date.now() } } }); process.exit(r.detail === 'worktree recently committed to' ? 0 : 1)"`
Expected: FAIL (exit 1). Today's `parentLiveDetail` ignores `deps.probes`, and the non-git tmp worktree's real listing fails, so the detail reads `indeterminate: could not list worktrees…`. Then `node --test tests/bin-lib/flow/consolidated-pass.test.js` fails on the `AC1.2` and `AC3.2` tests.

- [ ] **Step 3: Implement the code above**, and make the doc edits listed under Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/consolidated-pass.test.js tests/hooks-check-pass-reentry.test.js tests/bin-lib/hooks/session-residue.test.js tests/hooks-session-start.test.js tests/flow-pass-reentry-conformance.test.js`
Expected: PASS
Run: `git grep -n -e lockVerdict -e isPidAlive -e "'log'" -- plugin/bin/lib/hooks/resume-freshness.js plugin/bin/lib/flow/consolidated-pass.js`
Expected: no output (AC6.1)
Run: `git diff --stat ca55a7c54 -- plugin/bin/hooks.js plugin/bin/lib/flow/preflight.js`
Expected: no output (AC7.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/consolidated-pass.js docs/hooks.md docs/plugin-structure.md plugin/skills/flow/multispec-review-console.md tests/bin-lib/flow/consolidated-pass.test.js
git commit -m "Route parentLiveDetail through runLiveness and blocksResume — delete its own lock probe (#4420)"
```

## AC coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | The existing tests in `tests/hooks-resume-freshness.test.js`, `tests/flow-resume-freshness-citations.test.js` and `tests/bin-lib/flow/consolidated-pass.test.js` keep their decisions (Task 3 Step 4, Task 4 Step 4). The `#3497 I1` tests migrate their dep seam only. |
| AC1.2 | Task 3 `AC1.2` tests (unknown lock, unlisted, orphaned unchanged); Task 4 `AC1.2` tests (unlisted, recent commit, failed commit read) |
| AC2.1 | Task 3 `AC2.1` |
| AC3.1, AC3.2 | Task 3 `AC3.1` (two tests); Task 4 `AC3.2` |
| AC4.1 | Task 3 `AC4.1` |
| AC5.1, AC5.2, AC5.3 | Task 3 `AC5.1 AC5.2 AC5.3` |
| AC6.1 | Task 1 load test; Task 4 Step 4 grep |
| AC7.1 | Task 4 Step 4 `git diff --stat` |
| AC8.1 | Central `verify.js` full suite after the last task (`/build` Common Step 5) |

## PR-body equivalence table (the controller pastes this into PR #4425's #4420 section at phase exit)

| Caller | Run shape | Before | After | Why |
|---|---|---|---|---|
| checkResumeFreshness | main checkout unresolvable | `indeterminate` | `indeterminate` (reason = the lock probe's detail) | same decision |
| checkResumeFreshness | `git worktree list` fails | `indeterminate` | `indeterminate` | same |
| checkResumeFreshness | `git log` fails | `indeterminate` | `indeterminate` | same |
| checkResumeFreshness | empty log / unborn HEAD | `indeterminate` | `indeterminate` (`no-commits`) | same |
| checkResumeFreshness | unparseable commit time | `indeterminate` | `indeterminate` | same |
| checkResumeFreshness | unknown lock (no pid in reason) | fell through to the commit age | `indeterminate` | intentional 1, toward blocking |
| checkResumeFreshness | worktree not listed by git | fell through to the commit age | `indeterminate` | intentional 1, toward blocking |
| checkResumeFreshness | orphaned lock | fell through | fell through | unchanged |
| checkResumeFreshness | lock probe errors **and** commit is recent | `indeterminate` | `recent-commit` | a positive beats an error; still unsafe |
| parentLiveDetail | failed listing / unresolvable checkout | `indeterminate: could not list worktrees…` | `indeterminate: {detail}` | same decision |
| parentLiveDetail | unknown lock | `worktree lock unknown (reason)` | `indeterminate: worktree lock state is unknown…` | same decision, new text |
| parentLiveDetail | lock in use | `worktree lock in-use (reason)` | `worktree lock in-use` | lock-reason suffix dropped |
| parentLiveDetail | worktree not listed | `null` (eligible) | `indeterminate: …` | intentional 2, toward blocking |
| parentLiveDetail | commit under 10 min, lock free | `null` | `worktree recently committed to` | intentional 3, toward blocking |
| parentLiveDetail | `git log` fails, unparseable, or no commits; lock free | `null` | `indeterminate: …` | derived from intentional 3 plus AC 3.2, toward blocking |
