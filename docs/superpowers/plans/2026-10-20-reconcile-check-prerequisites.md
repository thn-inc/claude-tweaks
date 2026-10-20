# Reconcile Check Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reconcile()` expands an explicit `checks` subset with the checks its members depend on, so naming `archive` (or `red-tip`) without a fetch-producing check no longer silently skips.

**Architecture:** A `PREREQUISITES` table in `plugin/bin/lib/reconcile/index.js` maps a check to the check that produces the state it reads, plus the checks that already provide that state. A pure `expandChecks(checks)` adds a missing prerequisite before dispatch. `DISPATCH_ORDER` is untouched and still decides execution order. `docs/reconcile-checks.md` documents the table.

**Tech Stack:** Node 18+, `node --test`, git fixtures (`pairedFixture()` in `tests/reconcile.test.js`).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T022848-record-3630/work/3630-spec.md`

Scope keywords: expandChecks, no-fetch-this-pass

## Global Constraints

- Corrected premise (logged in `decisions.md`): on `main` an explicit `--checks` subset still runs under `budget.js`'s 18 s ceiling. The ceiling lift is #3026's unmerged PR #3615. The doc must not claim the ceiling is lifted. It says the added prerequisite runs in the same pass under the same per-pass budget, which is true with or without #3615.
- `reconcile({ checks: ['reap'] })` runs only `reap`: no fetch, `result.mirror === null`.
- `DISPATCH_ORDER` (`mirror, red-tip, console, release, archive, archive-branches, remote-prune, reap`) is unchanged.
- `BACKGROUND_CHECKS` (`release, archive, archive-branches, remote-prune, reap`) and `FAST_CHECKS` (`mirror, red-tip, console`) must expand to themselves. Both already contain a fetch provider for every member that needs one.
- No new top-level key on `reconcile()`'s result, so the `hooks.js` `reconcile-threw` fallback literal needs no change (`docs/reconcile-checks.md` step 4).

## Review Focus

- `checks: ['archive', 'remote-prune']`: `remote-prune`'s `--prune` fetch already refreshes `origin/{integration}`, so `mirror` must not be added (pinned in Step 1's unit test).
- An `ALL_CHECKS` / unscoped pass: expansion is a no-op (pinned: `expandChecks(ALL_CHECKS)` deep-equals `ALL_CHECKS`).
- A local-merge project with `checks: ['archive']`: the local-merge branch still runs nothing but its `reap` fallback. Expansion adds `mirror`, which is skipped under local-merge exactly as before. No new test; existing local-merge tests at `tests/reconcile.test.js:879`/`1095` keep passing.
- A preflight failure on an expanded subset: `checks` narrows to `['mirror']`, the same as for a caller who named `mirror` by hand. No new test.
- Duplicates in the caller's list (`['archive', 'archive']`): expansion must not add `mirror` twice (pinned in Step 1).

---

### Task 1: Declare and apply check prerequisites

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js`. Add `PREREQUISITES` + `expandChecks` near `ALL_CHECKS`, and apply `expandChecks` where `checks` is first assigned in `reconcile()`. Re-word the `fetchRan` comment (~line 299-306), which says red-tip-without-a-fetch is "currently unreachable, since every caller ... pairs red-tip with mirror": it is now unreachable because of expansion. Keep the gate itself. Export both new names.
- Modify: `docs/reconcile-checks.md`. Add a bullet after the "`ALL_CHECKS` is the requested-subset default" bullet. Add a clause to "Adding a new check" step 2.
- Test: `tests/reconcile.test.js`
  - Rewrite the test at line 1149 (`red-tip requested alone ... skips rather than reading a stale ref`). It pins the `no-fetch-this-pass` skip that expansion now makes unreachable through `reconcile()`.
  - Update the stale comment in the test at line 1506: lines ~1534-1543 say there is "no 'mirror' in `checks`", so the sequential preflight runs. After expansion, `['archive','reap']` becomes `['mirror','archive','reap']` and runs the async preflight. Both are already stubbed, so the assertions are unchanged.
  - Add the new tests below.
- Caller enumeration (`git grep -n -E "checks: *\[[^]]*'(archive|red-tip)'" -- tests plugin`, run at authoring): `tests/reconcile.test.js:1158` (rewritten above), `:1565` (comment only), `:1637` (`['mirror','red-tip']`, already contains mirror, unchanged). Production callers: `hooks.js:1490` (`['mirror']`), `hooks.js:1567` (`BACKGROUND_CHECKS`), `session-start.js:231` (`FAST_CHECKS`). All expand to themselves.

**Interfaces:**
- Produces: `PREREQUISITES: { [check: string]: { check: string, satisfiedBy: string[] } }`, with exactly two entries: `archive: { check: 'mirror', satisfiedBy: ['remote-prune'] }` and `'red-tip': { check: 'mirror', satisfiedBy: ['remote-prune'] }`.
- Produces: `expandChecks(checks: string[]) -> string[]`. Returns a new array with the caller's checks in caller order, deduplicated. Each missing prerequisite is inserted immediately before the first check that needs it. A prerequisite counts as present when the check itself, or any `satisfiedBy` member, is anywhere in the caller's list. Never mutates its input.
- `module.exports = { reconcile, ALL_CHECKS, PREREQUISITES, expandChecks, formatReconcileSummary }`

- [ ] **Step 1: Write the failing tests** (append near the existing `checks`-filter tests in `tests/reconcile.test.js`)

```js
const { expandChecks, PREREQUISITES, ALL_CHECKS } = require('../plugin/bin/lib/reconcile');

test('AC1.1 (unit): expandChecks adds mirror ahead of archive/red-tip and widens nothing else', () => {
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
  assert.deepEqual(Object.keys(PREREQUISITES).sort(), ['archive', 'red-tip']);
});
```

Behavioral tests. Fixture order is load-bearing: commit `policy.yml` in `mainDir` and `git push -q origin main`, then `git pull -q` in `seedDir` and commit + push `NEW` from there. A policy commit left local-only diverges from origin, and `mirror` never fast-forwards a diverged branch. Each test uses a `pairedFixture()` with that `policy.yml` (`integration-model: pr-first`) and stubbed `preflight.ghHealthCheck`/`ghHealthCheckAsync`. Each pushes one new commit from `seedDir` to origin before calling, so origin's `main` (`NEW`) is ahead of the clone's local `main`. Each monkeypatches the `archive-merged`/`release-merged`/`reap-merged` module exports, then re-requires `index.js` after `delete require.cache[...]`, the same way as the test at line 1506. `archiveMerged` is stubbed to capture `git rev-parse main` in `mainDir`, plus `localHasMerge(mainDir, { oid: NEW }, 'main')` (the real function, imported at the top of the file), at the moment it is called.

```js
test('AC1.1: reconcile({ checks: [\'archive\'] }) runs mirror before archive', async () => {
  // ...fixture/stubs as above...
  const r = await reconcileFresh({ cwd: mainDir, checks: ['archive'] });
  assert.equal(seenAtArchive.localMain, NEW, 'mirror must have fast-forwarded local main before archive ran');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded', JSON.stringify(r.mirror));
});

test('AC1.1: reconcile({ checks: [\'reap\'] }) runs only reap — no fetch, no mirror', async () => {
  // reapMerged stubbed; archiveMerged/releaseMerged stubbed to record any call
  const calls = await withFetchArgvLog(async () => { r = await reconcileFresh({ cwd: mainDir, checks: ['reap'] }); });
  assert.deepEqual(calls, []);
  assert.equal(r.mirror, null);
  assert.equal(archiveCalled, false);
  assert.equal(reapCalled, true);
});

test('AC2.1: dispatch-style checks release,archive,reap sees the asynchronously merged commit at archive time', async () => {
  const r = await reconcileFresh({ cwd: mainDir, checks: ['release', 'archive', 'reap'] });
  assert.equal(seenAtArchive.hasMerge, true, 'localHasMerge must see the merge — no local-behind-merge from a missing fetch');
  assert.ok(r.mirror && r.mirror.action === 'fast-forwarded');
});
```

The rewritten line-1149 test, renamed `reconcile(): red-tip requested alone pulls in mirror's fetch rather than reading a stale ref (#3630)`, asserts under `withFetchArgvLog`:
- exactly one fetch matching `/fetch origin main$/`
- `r.mirror !== null`
- `!r.skipped.some((s) => s.reason === 'no-fetch-this-pass')`

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="expandChecks|AC1.1|AC2.1|red-tip requested alone" tests/reconcile.test.js`
Expected: FAIL. `expandChecks` is not a function. The archive test sees local `main` behind `NEW`. The red-tip test sees zero fetches and a `no-fetch-this-pass` skip.

- [ ] **Step 3: Implement `PREREQUISITES` and `expandChecks(checks)` in `plugin/bin/lib/reconcile/index.js`; apply `checks = expandChecks(checks)` right after `checks` is assigned in `reconcile()`; update the `fetchRan` comment; export both names**

Each `PREREQUISITES` entry gets a one-line comment naming the state read and its reader: `archive-merged.js`'s `localHasMerge` reads `origin/{integration}`, and `red-tip.js` reads `origin/{integration}`. Each comment says why `remote-prune` satisfies it (its `--prune` shared fetch refreshes `origin/{integration}`).

- [ ] **Step 4: Update `docs/reconcile-checks.md`**

Add a bullet after the `ALL_CHECKS` bullet, titled "**An explicit subset is expanded with its prerequisites (#3630).**". It must say:
- `index.js`'s `PREREQUISITES` table names, for a check that reads state another check produces, the check that produces it and the checks that already provide it. `expandChecks()` adds a missing one before dispatch, and `DISPATCH_ORDER` still decides execution order.
- A two-row table: `archive` → `mirror` (`localHasMerge` reads `refs/heads/{integration}`, then `origin/{integration}`, and only the shared fetch refreshes the latter; a PR GitHub merged asynchronously otherwise skips as `local-behind-merge`), satisfied by `remote-prune`; `red-tip` → `mirror` (reads `origin/{integration}` right after the shared fetch, and otherwise skips as `no-fetch-this-pass`), satisfied by `remote-prune`.
- Examples: `release,archive,reap` runs as `mirror,release,archive,reap`. `reap` alone stays `reap`. A subset naming `remote-prune` is not widened. `FAST_CHECKS` and `BACKGROUND_CHECKS` expand to themselves.
- The added prerequisite runs in the same pass as the named checks, under the same per-pass wall-clock budget (`budget.js`). No sentence may claim an explicit subset runs without the ceiling (Global Constraints).

Append to "Adding a new check" step 2: "and, when the check reads state only another check produces, add a `PREREQUISITES` entry for it".

- [ ] **Step 5: Run the reconcile suites to verify they pass**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/ tests/hooks-session-start.test.js tests/bin-lib/hooks/reconcile-background.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js docs/reconcile-checks.md tests/reconcile.test.js
git commit -m "Expand explicit reconcile checks subsets with their prerequisites — refs #3630"
```

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 (declare prerequisites, expand, keep dispatch order) | Step 3 |
| Deliverable 2 (document table + expansion; ceiling clause corrected per premise) | Step 4 |
| Deliverable 3 (pin `archive` → `mirror` first; unrelated subset not widened) | Step 1 |
| AC1.1 | `AC1.1` tests (unit + both behavioral) |
| AC2.1 | `AC2.1` test |
| AC3.1 (`node --test tests/reconcile.test.js` passes) | Step 5 |
