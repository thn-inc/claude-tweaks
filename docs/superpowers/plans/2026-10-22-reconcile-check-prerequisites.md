# Reconcile Check Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reconcile()` expands an explicit `checks` subset with the checks its members depend on, so naming `archive` (or `red-tip`) without a fetch-producing check no longer silently skips.

**Architecture:** A `PREREQUISITES` table in `plugin/bin/lib/reconcile/index.js` maps a check to the check that produces the state it reads, plus the checks that already provide that state. A pure `expandChecks(checks)` adds any missing prerequisite, and `reconcile()` applies it where `checks` is first assigned. `DISPATCH_ORDER` is untouched and still decides execution order. `docs/reconcile-checks.md` documents the table and replaces its hand-written "name `mirror` too" warning.

**Tech Stack:** Node 18+, `node --test`, git fixtures (`pairedFixture()`, `writePolicyViaSeedAndPull()`, `withFetchArgvLog()` in `tests/reconcile.test.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-21T230143-record-3630/work/3630-spec.md`

Scope keywords: expandChecks, no-fetch-this-pass

Supersedes attempt 1's plan (`6a9d5ff35:docs/superpowers/plans/2026-10-20-reconcile-check-prerequisites.md`, closed PR #3689). This version reflects three changes since then: #3615's ceiling lift merged, test line numbers moved, and #3503 added a test that calls `checks: ['archive']`.

## Global Constraints

- The spec's ceiling premise is confirmed on `main`. `plugin/bin/hooks.js:1519` passes `budgetMs: Infinity` for an explicit `--checks` subset, and `docs/reconcile-checks.md:19` already documents it. The added prerequisite runs in the same pass, so it inherits that same unbounded budget. A programmatic `reconcile({ checks })` call without `budgetMs` keeps the default ceiling. The doc must not claim otherwise.
- `reconcile({ checks: ['reap'] })` runs only `reap`: no fetch, `result.mirror === null`.
- `DISPATCH_ORDER` (`mirror, red-tip, console, release, archive, archive-branches, remote-prune, reap`) is unchanged.
- `FAST_CHECKS` (`mirror, red-tip, console`; `plugin/bin/lib/hooks/session-start.js:37`) and `BACKGROUND_CHECKS` (`release, archive, archive-branches, remote-prune, reap`; `plugin/bin/hooks.js:60`) must each expand to themselves.
- No new top-level key on `reconcile()`'s result, so the `hooks.js` `reconcile-threw` fallback literal needs no change (`docs/reconcile-checks.md` "Adding a new check" step 4).
- `archive-branches` gets no `PREREQUISITES` entry. It reads the *local* integration ref through `git cherry`, but when cherry cannot prove equivalence it falls back to PR-state squash-merge evidence (#2252, `archive-branches.js:202-243`), so a stale ref only delays it and never wrongly skips. The doc says so in one clause.

## Review Focus

- `checks: ['archive', 'remote-prune']`: `remote-prune`'s `--prune` shared fetch already refreshes `origin/{integration}`, so `mirror` must not be added. Pinned in Step 1's unit test.
- An unscoped `ALL_CHECKS` pass must expand to a no-op. Pinned: `expandChecks(ALL_CHECKS)` deep-equals `ALL_CHECKS`.
- Duplicates in the caller's list (`['archive', 'archive']`) must not get `mirror` twice. Pinned in Step 1.
- Adding `mirror` turns on `fastChecksShape` (async preflight plus `sharedFetchAsync`) for any subset that did not name `remote-prune`. The #3503 test (`tests/reconcile.test.js` ~line 925, "an archive merged-partial skip carries unclosed through to result.runs") has origin `git@github.com:acme/w.git`, so the new fetch would go out over real SSH. Keep it hermetic: set `GIT_SSH_COMMAND=false` for the call (restore it in `finally`). The fetch then fails fast as `fetch-failed`, `mirror` is skipped, and `archive` still runs. Its existing `r.runs` assertion must keep passing unchanged. The step also asserts `r.skipped` carries a `{ check: 'mirror', reason: 'fetch-failed' }` entry, to prove the SSH fetch was really short-circuited.
- Local-merge with `checks: ['archive']`: the local-merge branch still runs only its `reap` fallback, and the added `mirror` is skipped under `local-merge-model` exactly as before. The existing local-merge tests keep passing, with no new test.

---

### Task 1: Declare, apply, and document check prerequisites

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js`. Add `PREREQUISITES` and `expandChecks` right after `ALL_CHECKS` (line 39). Apply `checks = expandChecks(checks)` immediately after `let checks = ...` (line 54). Reword the `fetchRan` comment (lines 302-309): red-tip without a fetch is now unreachable *because of expansion*, not because of caller pairing. Keep the gate itself. Export both new names.
- Modify: `docs/reconcile-checks.md`. Replace the closing sentence of the `#3026` bullet (lines 27-29, "A subset that names `archive` should name `mirror` too: …") with a new bullet after it. Add a clause to "Adding a new check" step 2.
- Test: `tests/reconcile.test.js`
  - Rewrite the red-tip-alone test at line 1193. It pins the `no-fetch-this-pass` skip that expansion now makes unreachable through `reconcile()`.
  - Make the #3503 test (~line 925-963) hermetic per Review Focus.
  - Update the stale comment in the archive+reap shared-cache test (~lines 1578-1587). It says "no 'mirror' in `checks`", so the sequential preflight runs. After expansion, `['archive','reap']` becomes `['mirror','archive','reap']` and takes the async path. Both are already stubbed, so the assertions are unchanged.
  - Add the new tests below, near the red-tip test.
- Caller enumeration (`git grep -n -E "checks: *\[[^]]*'(archive|red-tip)'" -- tests plugin`): every call site listed above, plus `['mirror','red-tip']` calls (~1681/1722/1734, already contain mirror, unchanged). Production callers: `hooks.js` `--checks` CLI path, `hooks.js` `BACKGROUND_CHECKS`, `session-start.js` `FAST_CHECKS`. All existing lists expand to themselves.

**Interfaces:**
- Produces: `PREREQUISITES: { [check: string]: { check: string, satisfiedBy: string[] } }`, with exactly two entries: `archive: { check: 'mirror', satisfiedBy: ['remote-prune'] }` and `'red-tip': { check: 'mirror', satisfiedBy: ['remote-prune'] }`.
- Produces: `expandChecks(checks: string[]) -> string[]`. Returns a new array:
  - the caller's checks in caller order, deduplicated
  - each missing prerequisite inserted immediately before the first check that needs it
  - a prerequisite counts as present when the check itself, or any `satisfiedBy` member, appears anywhere in the caller's list
  - never mutates its input
- `module.exports = { reconcile, ALL_CHECKS, PREREQUISITES, expandChecks, formatReconcileSummary }`

- [ ] **Step 1: Write the failing tests**

```js
test('expandChecks (#3630): adds mirror ahead of archive/red-tip and widens nothing else', () => {
  const { expandChecks, PREREQUISITES, ALL_CHECKS } = require('../plugin/bin/lib/reconcile');
  assert.deepEqual(expandChecks(['archive']), ['mirror', 'archive']);
  assert.deepEqual(expandChecks(['red-tip']), ['mirror', 'red-tip']);
  assert.deepEqual(expandChecks(['reap']), ['reap']);
  assert.deepEqual(expandChecks(['release', 'archive', 'reap']), ['release', 'mirror', 'archive', 'reap']);
  assert.deepEqual(expandChecks(['archive', 'remote-prune']), ['archive', 'remote-prune']);
  assert.deepEqual(expandChecks(['archive', 'archive']), ['mirror', 'archive']);
  assert.deepEqual(expandChecks(ALL_CHECKS), ALL_CHECKS);
  const { FAST_CHECKS } = require('../plugin/bin/lib/hooks/session-start');
  const { BACKGROUND_CHECKS } = require('../plugin/bin/hooks');
  assert.deepEqual(expandChecks(FAST_CHECKS), FAST_CHECKS);
  assert.deepEqual(expandChecks(BACKGROUND_CHECKS), BACKGROUND_CHECKS);
  const input = ['archive'];
  expandChecks(input);
  assert.deepEqual(input, ['archive'], 'input must not be mutated');
  assert.deepEqual(Object.keys(PREREQUISITES).sort(), ['archive', 'red-tip']);
});
```

Behavioral tests. Each uses a `pairedFixture()` and `writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n')`. After that, each commits one new file in `seedDir` and runs `git push -q origin main`, recording that commit as `NEW`. Origin's `main` is then ahead of the clone's local `main`.

Each stubs `preflight.ghHealthCheck`/`ghHealthCheckAsync` to `{ ok: true, reason: null }`. Each also monkeypatches the `archive-merged` / `release-merged` / `reap-merged` module exports. Then it re-requires `index.js` after `delete require.cache[...]`, the same idiom the archive+reap shared-cache test uses, and restores everything in `finally`.

The `archiveMerged` stub records two things at the moment it is called:
- `git rev-parse main` in `mainDir`
- `localHasMerge(mainDir, { oid: NEW }, 'main')`, the real function imported at line 14

It returns `{ archived: [], skipped: [] }`.

```js
test('AC1 (#3630): reconcile({ checks: [\'archive\'] }) runs mirror before archive', async () => {
  const r = await reconcileFresh({ cwd: mainDir, checks: ['archive'] });
  assert.equal(seenAtArchive.localMain, NEW, 'mirror must have fast-forwarded local main before archive ran');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
});

test('AC1 (#3630): reconcile({ checks: [\'reap\'] }) runs only reap — no fetch, no mirror', async () => {
  let r;
  const calls = await withFetchArgvLog(async () => { r = await reconcileFresh({ cwd: mainDir, checks: ['reap'] }); });
  assert.deepEqual(calls, []);
  assert.equal(r.mirror, null);
  assert.equal(archiveCalled, false);
  assert.equal(reapCalled, true);
});

test('AC2 (#3630): dispatch-style checks release,archive,reap sees the asynchronously merged commit at archive time', async () => {
  const r = await reconcileFresh({ cwd: mainDir, checks: ['release', 'archive', 'reap'] });
  assert.equal(seenAtArchive.hasMerge, true, 'localHasMerge must see the merge — no local-behind-merge from a missing fetch');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
});
```

(`'fast-forwarded'` is `mirror-ff.js`'s literal for this case, `mirror-ff.js:65`.)

Rename the line-1193 test to `reconcile(): red-tip requested alone pulls in mirror's fetch rather than reading a stale ref (#3630)`. Keep its fixture and preflight stub. Under `withFetchArgvLog`, it asserts:
- exactly one fetch line matching `/fetch .*origin main$/`
- `r.mirror !== null`
- `!r.skipped.some((s) => s.reason === 'no-fetch-this-pass')`

Also stub `ghHealthCheckAsync`, since the expanded subset now takes the async path.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="3630" tests/reconcile.test.js`
Expected: FAIL with these symptoms:
- `expandChecks is not a function`
- the archive tests see local `main` behind `NEW` / `hasMerge` false
- the red-tip test sees zero fetches and a `no-fetch-this-pass` skip

- [ ] **Step 3: Implement `PREREQUISITES` and `expandChecks(checks)` in `plugin/bin/lib/reconcile/index.js`. Apply it at line 54, reword the `fetchRan` comment, and export both names**

Each `PREREQUISITES` entry gets a one-line comment naming:
- the state it reads (`archive-merged.js`'s `localHasMerge` reads `refs/heads/{integration}` then `origin/{integration}`; `red-tip.js` reads `origin/{integration}`)
- why `remote-prune` satisfies it (its `--prune` shared fetch refreshes `origin/{integration}`)

- [ ] **Step 4: Make the #3503 test hermetic**

In the ~line 925 test, set `process.env.GIT_SSH_COMMAND = 'false'` alongside the existing `PATH` override, and restore the original value (or delete it if it was unset) in `finally`. Add `assert.ok(r.skipped.some((s) => s.check.split(',').includes('mirror') && s.reason === 'fetch-failed'), JSON.stringify(r.skipped))`. `plugin/bin/lib/hooks/git-exec.js` passes no `env` option, so child git inherits `process.env` and the variable reaches it.

- [ ] **Step 5: Update `docs/reconcile-checks.md`**

Delete the `#3026` bullet's last sentence ("A subset that names `archive` should name `mirror` too: …"). Add a new bullet right after it, titled **"An explicit subset is expanded with its prerequisites (#3630)."** It states:
- What `PREREQUISITES` holds: for each check that reads state another check produces, `index.js`'s `PREREQUISITES` table names the producing check and the checks that already provide that state. `expandChecks()` adds a missing one before dispatch. `DISPATCH_ORDER` still decides execution order.
- A two-row table:
  - `archive` → `mirror`, satisfied by `remote-prune`. `localHasMerge` reads `refs/heads/{integration}`, then `origin/{integration}`, and only the shared fetch refreshes the latter. Without it, a PR GitHub merged asynchronously skips as `local-behind-merge`.
  - `red-tip` → `mirror`, satisfied by `remote-prune`. It reads `origin/{integration}` right after the shared fetch, and otherwise skips as `no-fetch-this-pass`.
- Examples:
  - `release,archive,reap` runs as `mirror,release,archive,reap`.
  - `reap` alone stays `reap`.
  - A subset naming `remote-prune` is not widened.
  - `FAST_CHECKS` and `BACKGROUND_CHECKS` expand to themselves.
- The added prerequisite runs in the same pass. Under the CLI's `--checks` path it shares the unbounded budget from the bullet above.
- One clause on why `archive-branches` has no entry (Global Constraints).

Append to "Adding a new check" step 2: "and, when the check reads state only another check produces, add a `PREREQUISITES` entry for it (see the expansion bullet above)".

- [ ] **Step 6: Run the reconcile suites to verify they pass**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/ tests/hooks-session-start.test.js tests/bin-lib/hooks/reconcile-background.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js docs/reconcile-checks.md tests/reconcile.test.js
git commit -m "Expand explicit reconcile checks subsets with their prerequisites — refs #3630"
```

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 (declare prerequisites, expand, keep dispatch order) | Step 3 |
| Deliverable 2 (document table + expansion; subset runs without the hot-path ceiling) | Step 5 |
| Deliverable 3 (pin `archive` → `mirror` first; unrelated subset not widened) | Step 1 |
| AC1 (`['archive']` runs mirror first; `['reap']` runs only reap) | `AC1 (#3630)` tests + unit test |
| AC2 (`release,archive,reap` archives an async-merged PR, no `local-behind-merge`) | `AC2 (#3630)` test |
| AC3 (`node --test tests/reconcile.test.js` passes) | Step 6 |
