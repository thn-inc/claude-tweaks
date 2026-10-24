# Reconcile Timing and Hot-Spot Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hooks.js reconcile` report per-check and per-subprocess timing in its JSON output, and cut its wall time on this repo from ~50-90 s to a p50 under 10 s, without changing what any check decides.

**Architecture:** A new `timing.js` collector (AsyncLocalStorage-scoped) records each dispatch phase and every reconcile-family subprocess; `reconcile()` attaches its summary as `result.timings`. A per-pass PR-state resolver (`pr-state-cache.js`) memoizes and prefetches (concurrently) the `gh pr view`/`gh pr list --head` lookups that archive, reap and release repeat, and persists only terminal answers (MERGED, pr-not-found) plus short-TTL "no PR" answers across passes in `reconcile-cache.json`. Release reuses claim-blob content by git blob sha, the residue dedup lookup reuses a marker->issue index instead of a 10 000-issue list, and the unscoped CLI pass hands the three janitorial checks (archive-branches, remote-prune, ledger-residue) to the existing detached `reconcile-background` pass.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI, git.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T154345-record-4032/work/4032-spec.md` (record #4032)

**Scope keywords:** resolvePrStateByNumber, resolvePrState, findResidueDuplicate, reconcile-background

## Measured baseline (2026-10-24, this repo, live `gh`, profiler in session scratch)

Unscoped `node plugin/bin/hooks.js reconcile --dry-run --json`: 52.5 s wall, `archive-branches,remote-prune,ledger-residue,reap` skipped `budget-exceeded`. Per check, unbounded, dry-run:

| Check | Wall | Dominant subprocesses |
|---|---|---|
| archive | 48-89 s | `gh pr view` x47 (28.7 s), `gh pr list --head` x37 (18.9 s), `gh issue list --limit 10000` x1 (21.9 s, only when a residue escalates/resolves), `git` x143 (2.9 s) |
| reap | 16.0 s | `gh pr list --head` x24 (15.0 s), sequential |
| archive-branches | 16.3 s | `gh api graphql` bulk screen x9 (15.9 s) |
| remote-prune + ledger-residue | 18.7 s | `gh api graphql` x10 (17.4 s) |
| release (live) | 8.4 s | claim blob reads x13 sequential (~5 s), `gh pr view` x12 pooled |
| mirror + red-tip + console | 1.3 s | `git fetch`, `gh pr view` x2 |

Archive outcome mix (150 run dirs): 34 `console-never-rendered-staged-pending` (MERGED PRs), 13 `pr-open`, 29 `no-pr`, 60 `no-branch`, 6 `pr-closed-unmerged`. MERGED and `no-pr` answers dominate the repeated lookups, which is why caching only terminal answers recovers most of the time.

## Global Constraints

- Acceptance target, verbatim: "p50 reconcile wall time is under 10 s on this repo over 20 calls."
- "Per-check timings appear in the JSON output."
- "Existing reconcile fixture tests show unchanged convergence results." No existing assertion about what a check archives, reaps, releases, prunes or skips may change. The one existing test this plan edits (`tests/reconcile.test.js` "AC3.1/AC3.2: hooks.js reconcile: an explicit --checks subset runs unbounded; an unscoped pass keeps the default budget") pins the CLI's `opts`, not a convergence result — Task 7 states the edit.
- A cache may only ever answer what a fresh call would answer. Never persist OPEN or CLOSED PR states, or any failure string other than `pr-not-found`, across passes.
- Never break a session: every new I/O path degrades to the pre-change live call on any read/parse failure, never throws out of `reconcile()`.
- Every `child_process` call keeps `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- `reconcile-cache.json`: a new key must be added to `readCache`'s parse (cache.js header, #3132) or the next unrelated write drops it.
- Commit messages: `{Verb} {what} — {detail}`, `refs #4032`, never `closes`/`fixes`.

## Review Focus

1. A branch name reused by a later run (#3416): `byBranch` must return exactly what `gh pr list --head` would — MERGED wins — so a cached MERGED answer is equivalent; but a cached `null` must expire (5 min) because a PR can open on that head. Task 3 pins both.
2. `gh` absent or failing mid-prefetch: a failed prefetch item must not be memoized, so the later sync lookup retries live and returns the same failure string it does today. Task 3 pins it.
3. A residue marker index entry pointing at an issue whose body no longer carries the marker (edited by a human): the lookup must fall back to the full list, not return the wrong issue. Task 6 pins it.
4. The unscoped CLI under `--dry-run`, on a no-repo/no-remote fixture, or with a fresh background status: it must not spawn a background pass. Task 7 pins all three.
5. Concurrent passes rewriting `reconcile-cache.json`: each writer re-reads immediately before writing and merges its new keys (the release.js precedent), so one pass never wipes another's `prStates`. Task 3 pins the merge.

---

### Task 1: Timing collector and per-check timings in `reconcile()`'s result

**Files:**
- Create: `plugin/bin/lib/reconcile/timing.js`
- Modify: `plugin/bin/lib/reconcile/index.js` (wrap `reconcile`; time each dispatch block)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (`runGit`/`runGitAsync` record their subprocess)
- Modify: `plugin/bin/hooks.js:1589` (`reconcile-threw` fallback literal gains `timings: null`)
- Test: `tests/bin-lib/reconcile/timing.test.js` (new), `tests/reconcile.test.js` (append)

**Interfaces:**
- Produces (`timing.js`):
  - `createTimings() -> Timings` — `{ startedAt: number, current: string, phases: Map }`, `current` starts `'setup'`.
  - `withTimings(timings, fn) -> ReturnType<fn>` — runs `fn` inside an `AsyncLocalStorage` store holding `timings`.
  - `timePhaseSync(name, fn)` / `async timePhase(name, fn)` — sets the active store's `current` to `name` for the call, adds the elapsed ms to that phase, restores the previous `current`. No-op wrappers (just call `fn`) outside a store.
  - `recordSubprocess(file, args, ms)` — adds one call to the active phase's `commandFamily(file, args)` bucket; no-op outside a store.
  - `commandFamily(file, args) -> string` — pure.
  - `execFileSyncTimed(file, args, opts)` / `execFileAsyncTimed(file, args, opts) -> Promise<{stdout, stderr}>` — call `require('child_process').execFileSync` / promisified `execFile` by **property access at call time** (so `t.mock.method(cp, …)` stubs still reach them, git-exec.js's documented convention), record in a `finally` (failures are timed too), return/throw exactly what the underlying call does.
  - `summarizeTimings(timings) -> { totalMs, phases: { [name]: { ms, subprocessMs, subprocessCount, subprocesses: { [family]: { count, ms, maxMs } } } } }`.
- Produces (`reconcile()`): `result.timings` — `summarizeTimings` output, present on **every** return path, including the early `no-repo`/`no-remote`/`local-merge`/preflight/budget returns. Phase names: `setup` (everything before the first check), one per dispatched check using its `ALL_CHECKS` name, `finalize` (end-of-pass cache write + residue summary).

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/reconcile/timing.test.js`:
- `commandFamily: git skips -C/-c pairs` — `commandFamily('git', ['-C', '/x y', '-c', 'a=b', 'worktree', 'list', '--porcelain'])` === `'git worktree'`.
- `commandFamily: gh pr/issue keep two words` — `('gh', ['pr','view','12','--json','x'])` === `'gh pr view'`; `('gh', ['issue','list','--repo','o/r'])` === `'gh issue list'`.
- `commandFamily: gh api graphql and REST resource` — `('gh', ['api','graphql','-f','q=1'])` === `'gh api graphql'`; `('gh', ['api','repos/o/r/contents/claims/issue-3.json?ref=claims-registry'])` === `'gh api contents'`; `('gh', ['api','repos/o/r/git/trees/claims-registry?recursive=1'])` === `'gh api git/trees'`; `('gh', ['api','rate_limit','-q','.x'])` === `'gh api rate_limit'`.
- `recordSubprocess outside a store is a no-op` — does not throw, `summarizeTimings(createTimings()).phases` deep-equals `{}`.
- `phases accumulate ms and subprocess buckets` — inside `withTimings(t, …)`: `timePhaseSync('archive', () => { recordSubprocess('gh', ['pr','view','1'], 30); recordSubprocess('gh', ['pr','view','2'], 50); })`; summary `phases.archive.subprocesses['gh pr view']` deep-equals `{ count: 2, ms: 80, maxMs: 50 }`, `subprocessCount` 2, `subprocessMs` 80.
- `async phases isolate concurrent stores` — two `withTimings` runs in `Promise.all`, each recording in its own `timePhase`; neither summary contains the other's family.
- `execFileSyncTimed records a failing call and rethrows` — `assert.throws(() => execFileSyncTimed('git', ['definitely-not-a-subcommand'], { stdio: 'ignore', windowsHide: true }))` inside a store, then the active phase shows `'git definitely-not-a-subcommand'` count 1.

`tests/reconcile.test.js` (append, reuse `noRemoteFixture` / `pairedFixture` already in that file):
- `AC2.1: reconcile() attaches timings on an early no-remote return` — `r.timings.totalMs` is a number ≥ 0 and `r.timings.phases.setup` exists.
- `AC2.1: reconcile() times each dispatched check` — on `pairedFixture()` with `checks: ['mirror']` and `dryRun: true` (the same forcing the D2 shared-fetch test uses): `Object.keys(r.timings.phases)` includes `'setup'`, `'mirror'`, `'finalize'`; `r.timings.phases.mirror.ms` is a number; some phase's `subprocesses` has a key starting `'git '`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/timing.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/reconcile/timing'`

- [ ] **Step 3: Implement `timing.js`, wire `reconcile()` and git-exec**

`commandFamily`: for `git`, drop leading `-C <v>`/`-c <v>` pairs, take the next token; for `gh api`, `graphql` stays `graphql`; a `repos/{o}/{r}/…` endpoint maps to its 4th segment, or `git/{5th}` when the 4th is `git`, with any `?query` stripped; any other endpoint maps to its first segment; other `gh` commands take two tokens. In `index.js`, rename the body to `reconcileInner(opts)` and export `reconcile(opts)` as: create timings, `await withTimings(t, () => reconcileInner(opts))`, set `result.timings = summarizeTimings(t)`, return. Inside `reconcileInner`, wrap each of the nine dispatch blocks' check call in `timePhaseSync(name, …)` / `await timePhase(name, …)`, and the final cache write + `formatReconcileSummary` in `finalize`. In `git-exec.js`, record inside `runGit`/`runGitAsync` with `require('../reconcile/timing').recordSubprocess('git', args, ms)` (lazy require — git-exec is loaded by hook paths that never reconcile).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/timing.test.js tests/reconcile.test.js tests/hooks-git-exec.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/timing.js plugin/bin/lib/reconcile/index.js plugin/bin/lib/hooks/git-exec.js plugin/bin/hooks.js tests/bin-lib/reconcile/timing.test.js tests/reconcile.test.js
git commit -m "Add per-check reconcile timings — refs #4032"
```

### Task 2: Time every reconcile-family subprocess

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js`, `ledger-residue.js`, `pr-state.js`, `preflight.js`, `prune-remote.js`, `red-tip.js`, `release-merged.js` — the seven modules that `require('child_process')` directly today (grep: `grep -n "require('child_process')" plugin/bin/lib/reconcile/*.js`); every direct exec call there is routed through `execFileSyncTimed`/`execFileAsyncTimed`. Every other reconcile module spawns only through `runGit`/`runGitAsync` (timed by Task 1).
- Modify: `plugin/bin/lib/reconcile/issue-list-cache.js` — time each `base(argv)` call as `gh` + argv (the escalate/resolve `gh issue …` traffic flows through it)
- Test: `tests/bin-lib/reconcile/subprocess-timing-conformance.test.js` (new)

**Interfaces:**
- Consumes: Task 1's `execFileSyncTimed`, `execFileAsyncTimed`, `recordSubprocess`.
- Produces: no new API. Calls that go through `runGit`/`runGitAsync` (Task 1) need no change.

- [ ] **Step 1: Write the failing conformance test**

Follow the `bin-source-scan-conformance` skill: import `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES` from `../../helpers/strip-comments`; walk `plugin/bin/lib/reconcile/*.js` except `timing.js`; offenders are any `execFileSync(`, `execFile(`, `execFileAsync(`, `spawnSync(`, `spawn(` or `execSync(` call token in stripped code (bare, `cp.`-qualified, or destructured), plus any file whose verdict is not `ok`. Tests:
- `every reconcile subprocess goes through timing.js` — offender list deep-equals `[]`.
- `floor: the scan sees the timed call sites` — count of `execFileSyncTimed(`/`execFileAsyncTimed(` tokens across the walked files ≥ 15 (today's direct-call sites in those seven modules number ~18; a matcher that sees nothing must fail).
- `matcher self-test` — the matcher flags a planted `const { execFileSync } = require('child_process'); execFileSync('gh', [])` string and does not flag `execFileSyncTimed('gh', [])`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/reconcile/subprocess-timing-conformance.test.js`
Expected: FAIL — offender list names the current direct call sites

- [ ] **Step 3: Migrate the call sites**

Replace each direct call with the timed wrapper, keeping arguments, options (including `windowsHide`, `timeout`, `stdio`, `maxBuffer`) and error handling byte-identical. Where a module's tests inject a runner (`resolvePrStatesBulk`'s `opts.runner`, `archiveBranches`'s `resolvePrBulk`), the default runner is what changes; injected runners stay untouched. Remove now-unused `child_process` destructures.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/ tests/reconcile.test.js tests/windows-hide-spawn-conformance.test.js tests/console-execute.test.js tests/console-execution.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile tests/bin-lib/reconcile/subprocess-timing-conformance.test.js
git commit -m "Time every reconcile subprocess through timing.js — refs #4032"
```

### Task 3: Per-pass PR-state resolver with a terminal-answer cache

**Files:**
- Create: `plugin/bin/lib/reconcile/pr-state-cache.js`
- Modify: `plugin/bin/lib/reconcile/cache.js` (`readCache` parses `prStates`)
- Test: `tests/bin-lib/reconcile/pr-state-cache.test.js` (new), `tests/bin-lib/reconcile/cache.test.js` (the three `readCache` shape assertions at lines 19/29/41 gain `prStates: {}`)

**Interfaces:**
- Consumes: `pr-state.js`'s `resolvePrState`, `resolvePrStateByNumber`, `resolvePrStateAsync`, `resolvePrStateByNumberAsync`; `cache.js`'s `readCache`/`writeCache`; `gh-pool.js`'s `runWithConcurrency`.
- Produces:
  - `createPrStateResolver({ root, now = Date.now, concurrency = 8, deps }) -> Resolver`; `deps` overrides `{ byNumber, byBranch, byNumberAsync, byBranchAsync }` (default: the four `pr-state.js` functions bound to `root`) for tests.
  - `Resolver.byNumber(n)` / `Resolver.byBranch(branch)` — sync; same return contract as `resolvePrStateByNumber(root, n)` / `resolvePrState(root, branch)` with no opts.
  - `Resolver.byNumberAsync(n)` / `Resolver.byBranchAsync(branch)` — async twins, same contract.
  - `async Resolver.prefetch({ numbers = [], branches = [] })` — resolves every not-yet-known key through the async twins via `runWithConcurrency(…, concurrency)` and memoizes the answers.
  - `Resolver.persist()` — merges newly learned persistable entries into `reconcile-cache.json`'s `prStates` (fresh `readCache` immediately before `writeCache`, other keys and other writers' `prStates` entries kept), dropping entries older than `PR_STATE_RETENTION_MS`.
  - `persistableTtl(kind, value) -> number | 0` — pure: `kind` `'number'` + object with `state === 'MERGED'` → `PR_STATE_RETENTION_MS`; `'number'` + `'pr-not-found'` → `PR_STATE_RETENTION_MS`; `'branch'` + MERGED object → `PR_STATE_RETENTION_MS`; `'branch'` + `null` → `NO_PR_TTL_MS`; everything else → `0` (not persisted).
  - Constants: `PR_STATE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000`, `NO_PR_TTL_MS = 5 * 60 * 1000`. Cache keys `n:{number}` / `b:{branch}`, entry `{ v, at }`.
- Lookup order for every method: in-pass memo → persisted entry still inside its TTL → live call. Live answers that are objects or `null` go into the memo; failure strings (`gh-absent`, `network-failure`, `invalid-arguments`) never do; `pr-not-found` does.

- [ ] **Step 1: Write the failing tests** (fake `deps` counting calls; tmp `root` with `.claude-tweaks/`)
- `persistableTtl: MERGED and pr-not-found persist, OPEN/CLOSED/failures do not` — table over `('number', {state:'MERGED'})`, `('number','pr-not-found')`, `('branch',{state:'MERGED'})`, `('branch', null)` → `[RET, RET, RET, NO_PR_TTL_MS]`; `('number',{state:'OPEN'})`, `('number',{state:'CLOSED'})`, `('branch','network-failure')`, `('number','gh-absent')` → all `0`.
- `byNumber memoizes within a pass` — two `byNumber(5)` calls → one `deps.byNumber` call.
- `failure strings are not memoized` — `deps.byNumber` returns `'network-failure'` then `{state:'OPEN'}`; second `byNumber(5)` returns the OPEN object and `deps.byNumber` ran twice.
- `persist then a new resolver serves MERGED without a live call` — resolver A learns `byNumber(7)` MERGED and `byBranch('b')` MERGED, `persist()`; resolver B on the same root returns both deep-equal with zero `deps` calls.
- `OPEN is never served from a prior pass` — A learns `byNumber(8)` OPEN, `persist()`; B's `byNumber(8)` makes one live call.
- `a null branch answer expires after NO_PR_TTL_MS` — A learns `byBranch('x')` null at `now = 0`, persists; B with `now = () => NO_PR_TTL_MS - 1` serves null with no call; C with `now = () => NO_PR_TTL_MS + 1` makes one live call.
- `entries past retention are dropped on persist` — seed `prStates` with an entry `at: 0`, persist at `now = PR_STATE_RETENTION_MS + 1`; the key is gone from `readCache(root).prStates`.
- `persist merges with a concurrent writer` — after A learns key `n:1`, another writer adds `n:2` and `claimShas: {9:'s'}` to the file; `A.persist()` leaves `n:1`, `n:2` and `claimShas` all present.
- `prefetch resolves concurrently and fills the memo` — `deps.byNumberAsync` resolves after a 20 ms timer; `prefetch({numbers:[1,2,3,4,5,6,7,8]})` with `concurrency: 8` completes in under 120 ms; then `byNumber(1..8)` make zero sync `deps.byNumber` calls.
- `a failed prefetch item falls back live` — `deps.byBranchAsync('y')` returns `'gh-absent'`; later `byBranch('y')` calls `deps.byBranch` once and returns its answer.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/pr-state-cache.test.js`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement `pr-state-cache.js` and the `readCache` key**

`readCache` keeps `prStates` when it is a plain object, else `{}`; the empty default gains `prStates: {}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/pr-state-cache.test.js tests/bin-lib/reconcile/cache.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/pr-state-cache.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/pr-state-cache.test.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Add a per-pass PR-state resolver with a terminal-answer cache — refs #4032"
```

### Task 4: Route archive, reap and release through the resolver, prefetched

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveMerged`, `resolveRunPrState`, the main loop's by-number probe at ~line 2172; new exported `prefetchArchivePrStates`)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (`reapMerged`'s `resolvePrState` at ~line 209; new exported `prefetchReapPrStates`)
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (Phase 1.5's two `runWithConcurrency` batches)
- Modify: `plugin/bin/lib/reconcile/index.js` (one resolver per pass; prefetch inside the `archive` and `reap` phases; `persist()` in `finalize`)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`, `reap-merged.test.js`, `release-merged.test.js` (append), `tests/reconcile.test.js` (append)

**Interfaces:**
- Consumes: Task 3's `createPrStateResolver` / `Resolver`.
- Produces:
  - `archiveMerged({ …existing, prStates })`, `reapMerged({ …existing, prStates })`, `releaseMerged({ …existing, prStates })` — `prStates` optional; absent → today's direct `pr-state.js` calls, unchanged.
  - `async prefetchArchivePrStates(root, prStates)` — two phases over `iterRunDirsWithState(root)` plus the `status: 'clean'` dirs: (1) `prefetch({ numbers })` for every stamped `state.pr.number`; (2) `prefetch({ branches })` for every dir whose branch resolves (`wtEntry.branch || fallbackBranch(root, dir, state)`, the main loop's own derivation, reused, not copied) and whose number is absent or answered `null`.
  - `async prefetchReapPrStates(root, prStates)` — `prefetch({ branches })` over `parseWorktreeList(git worktree list --porcelain)` branches.

- [ ] **Step 1: Write the failing tests**
- `archiveMerged: prStates answers replace live PR lookups` (archive-merged.test.js) — on an existing merged-PR fixture from that file, pass a resolver built with fake `deps` returning that fixture's PR object; the result's `archived`/`skipped` deep-equal the result of the same fixture run without `prStates`, and the real `pr-state.js` resolvers are never reached (count via `t.mock.method` on the `pr-state` module exports).
- `prefetchArchivePrStates: numbers first, branches only for unanswered dirs` — fixture with dir A stamped `pr.number: 11` (deps answer MERGED) and dir B unstamped on branch `bb`: `byNumberAsync` called with `[11]`, `byBranchAsync` called with `['bb']` only.
- `reapMerged: prStates answers replace live lookups` (reap-merged.test.js) — same equivalence shape as the archive test.
- `releaseMerged: prStates async answers replace live lookups` (release-merged.test.js) — with the file's existing injected `ghApi`, a resolver whose `byNumberAsync` returns MERGED-closing; the released set equals the no-`prStates` run.
- `reconcile(): one resolver per pass is shared by release, archive and reap` (reconcile.test.js) — monkeypatch `require('../plugin/bin/lib/reconcile/pr-state-cache').createPrStateResolver` to record instances; a pass with `checks: ['release','archive','reap']` on `pairedFixture()` creates exactly one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/bin-lib/reconcile/release-merged.test.js tests/reconcile.test.js`
Expected: FAIL after Step 1 — the new tests (unknown `prStates`/`prefetchArchivePrStates`)

- [ ] **Step 3: Implement the routing**

Inside each module, pick the lookup once: `const byNumber = prStates ? (n) => prStates.byNumber(n) : (n) => resolvePrStateByNumber(root, n)` (and the branch / async equivalents), and call those at every existing PR-state site. In `index.js`, create the resolver after the preflight narrowing, call `await prefetchArchivePrStates(root, prStates)` as the first statement inside the `archive` phase and `await prefetchReapPrStates(root, prStates)` inside the `reap` phase, and `prStates.persist()` in `finalize` (dry-run included — it persists reads, never writes repo state).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/ tests/reconcile.test.js`
Expected: PASS, 0 failures — every pre-existing archive/reap/release test unchanged (AC3.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile tests/bin-lib/reconcile tests/reconcile.test.js
git commit -m "Prefetch and share PR state across archive, reap and release — refs #4032"
```

### Task 5: Release reuses claim-blob content by blob sha

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (Phase 1 read)
- Modify: `plugin/bin/lib/reconcile/cache.js` (`readCache` parses `claimBlobs`)
- Test: `tests/bin-lib/reconcile/release-merged.test.js` (append), `tests/bin-lib/reconcile/cache.test.js` (shape assertions gain `claimBlobs: {}`)

**Interfaces:**
- Produces: `reconcile-cache.json` key `claimBlobs: { [blobSha]: content }`, rewritten each pass to exactly the active (live/stale) claims seen in this pass's listing, in the same final `writeCache` that already writes `claimShas`.
- Rule: a listing entry whose `sha` is in `claimBlobs` skips `readClaim` and uses `{ content: claimBlobs[sha], sha: entry.sha }`; classification still runs on that content with the current time. A git blob sha names its content, so the reuse is exact; a stale sha only makes the later conditional tombstone write fail (`release-write-failed`), never release the wrong claim.

- [ ] **Step 1: Write the failing tests**
- `releaseMerged: an unchanged active claim is not re-read` — run twice with the same injected listing (one live claim, sha `s1`); the second run's injected `ghApi` sees zero `contents/claims/issue-*.json` reads, and both runs return the same `skipped` entry for that claim.
- `releaseMerged: a changed sha is re-read` — second run's listing has sha `s2`: exactly one contents read.
- `releaseMerged: claimBlobs keeps only this pass's active shas` — after a run whose listing drops the claim, `readCache(root).claimBlobs` deep-equals `{}`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js`
Expected: FAIL after Step 1 — the second run still issues a contents read

- [ ] **Step 3: Implement the sha-keyed reuse**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/cache.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/release-merged.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Reuse unchanged claim blobs by sha in release — refs #4032"
```

### Task 6: Residue dedup lookup through a marker index instead of a full issue list

**Files:**
- Modify: `plugin/bin/lib/reconcile/issue-list-cache.js` (`createIssueListCache({ base, index })`; runner gains `findIssueByMarker`)
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` (`findResidueDuplicate` consults it first)
- Modify: `plugin/bin/lib/reconcile/cache.js` (`readCache` parses `residueIssueIndex`)
- Modify: `plugin/bin/lib/reconcile/index.js` (load the index into the per-pass cache; write it back in `finalize`)
- Test: `tests/bin-lib/reconcile/issue-list-cache.test.js`, `tests/bin-lib/reconcile/escalate-residue.test.js` (append), `cache.test.js` (shape gains `residueIssueIndex: {}`)

**Interfaces:**
- Produces:
  - `createIssueListCache({ base, index = {} }) -> { runner, index }` — `index` is a mutable `{ ["{repo}\n{marker}"]: issueNumber }`.
  - `runner.findIssueByMarker(repo, marker) -> issue | undefined` — `undefined` means "cannot answer, do the list". Returns `undefined` when this pass already memoized the list for `repo` (the memo is cheaper and write-aware) or when `index` has no entry. Otherwise `base(['issue','view', String(n), '--repo', repo, '--json', 'number,title,body,createdAt,state'])`; returns the parsed issue when its body carries `marker` (`findByMarker([issue], marker)`), else deletes the index entry and returns `undefined`. A throw or unparseable output returns `undefined`.
  - Index population: every memoized `issue list` read indexes the canonical (newest, `findByMarker`'s rule) issue for each `<!-- fingerprint: reconcile-residue-… -->` marker in the list; an `issue create` write indexes its own `--body`'s marker against the created number.
  - `findResidueDuplicate({ repo, marker, runner })` — first `typeof runner.findIssueByMarker === 'function' ? runner.findIssueByMarker(repo, marker) : undefined`; a non-`undefined` answer is returned as-is; otherwise today's list path, unchanged.
  - Known divergence, documented in the module header: when duplicates exist, the indexed issue (the canonical at index time) answers even if a newer duplicate was filed later by another process.

- [ ] **Step 1: Write the failing tests**
- `findIssueByMarker: an indexed issue whose body carries the marker answers with one view` (issue-list-cache.test.js) — fake `base` counts calls; `index = { 'o/r\n<!-- fingerprint: reconcile-residue-aaaa -->': 42 }`; returns `{number:42,…}`; `base` saw only `issue view 42`.
- `findIssueByMarker: a body without the marker drops the entry and falls back` — returns `undefined`; index entry deleted.
- `findIssueByMarker: defers to an already-memoized list` — after one `runner(['issue','list','--repo','o/r',…])`, returns `undefined` with no further `base` call.
- `list reads index every reconcile-residue marker` — list returns two issues for one marker (`createdAt` 2026-01-01 #5 and 2026-02-01 #9) and one for another; index maps the first marker to 9 and the second to its number.
- `create indexes its own marker` — after `runner(['issue','create','--repo','o/r','--title','t','--body','x\n<!-- fingerprint: reconcile-residue-bbbb -->'])` with base output `https://github.com/o/r/issues/77`, index maps that marker to 77.
- `findResidueDuplicate uses the index before listing` (escalate-residue.test.js) — runner with a `findIssueByMarker` returning `{number:3, state:'OPEN', body:m}`; no `issue list` call made; result `.number === 3`.
- `findResidueDuplicate: plain runner keeps the list path` — a runner function with no property behaves exactly as today (existing tests cover it; assert one `issue list` call here).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/issue-list-cache.test.js tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL after Step 1 — `runner.findIssueByMarker is not a function` / extra `issue list` call

- [ ] **Step 3: Implement the index**

`createIssueListCache` keeps returning `{ runner }` plus `index`; existing callers that destructure `runner` are unaffected. `index.js` passes `index: readCache(root).residueIssueIndex` and writes `residueIssueIndex: issueListCache.index` in the `finalize` write (fresh `readCache` merge, as Task 3).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/ tests/reconcile.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile tests/bin-lib/reconcile
git commit -m "Look residue records up through a marker index — refs #4032"
```

### Task 7: The unscoped CLI pass defers the janitorial checks to the background pass

**Files:**
- Create: `plugin/bin/lib/reconcile/background-spawn.js` (the spawn decision + spawn, moved out of `session-start.js`)
- Modify: `plugin/bin/lib/hooks/session-start.js:355-421` (call the helper; behavior unchanged)
- Modify: `plugin/bin/hooks.js` (`reconcile` branch at ~line 1543; new `CLI_DEFERRED_CHECKS` beside `BACKGROUND_CHECKS`)
- Modify: `docs/hooks.md` (Background convergence bullet: the unscoped CLI defers three checks)
- Test: `tests/reconcile.test.js` (edit the AC3.1/AC3.2 test; append), `tests/bin-lib/reconcile/background-spawn.test.js` (new); `tests/hooks-session-start.test.js` spawn-gate tests must pass unmodified

**Interfaces:**
- Produces:
  - `spawnBackgroundIfStale({ root, cwd, sessionId, now = Date.now() }) -> { spawned: boolean, reason: 'spawned' | 'fresh' | 'spawn-failed' | 'no-root' }` — reads `{root}/.claude-tweaks/reconcile-background-status.json`, gates on `isFresh({ lastRunAt: status.completedAt }, now)`, spawns `process.execPath [bin/hooks.js, 'reconcile-background']` with `{ cwd, detached: true, stdio: 'ignore', windowsHide: true, env }` (`CLAUDE_TWEAKS_SESSION_ID` when `sessionId` is set), attaches a no-op `'error'` listener, `unref()`s. `require('child_process').spawn` is read at call time (the session-start tests stub `cp.spawn`). Never throws.
  - `hooks.js`: `CLI_DEFERRED_CHECKS = ['archive-branches', 'remote-prune', 'ledger-residue']`. An unscoped `reconcile` (no `--checks`) passes `checks: ALL_CHECKS.filter((c) => !CLI_DEFERRED_CHECKS.includes(c))` (= `['mirror','red-tip','reap','release','archive','console']`), keeps `budgetMs: undefined` and `skipCacheStamp: undefined` (FAST_CHECKS ⊂ that set, so stamping `lastRunAt` stays truthful), then adds to the output object:
    - when the pass converged (no `skipped` entry has `check === 'all'`), a `skipped` entry `{ check: 'archive-branches,remote-prune,ledger-residue', reason: 'deferred-to-background' }` — a `no-repo`/`no-remote`/`local-merge` result keeps today's exact `skipped` array, so the existing fixture assertions on it stay untouched;
    - always, `background: { checks: CLI_DEFERRED_CHECKS, spawned, reason }` — spawned via `require('./lib/reconcile/background-spawn').spawnBackgroundIfStale(...)` (property access, so tests stub it) only when converged and not `--dry-run`; otherwise `spawned: false` with `reason: 'not-converged'` (checked first) or `'dry-run'`.
  - An explicit `--checks` call is unchanged: no deferral, no `background` key.

- [ ] **Step 1: Write the failing tests**
- Edit `AC3.1/AC3.2` in reconcile.test.js: stub `background-spawn.spawnBackgroundIfStale` to record calls and return `{ spawned: true, reason: 'spawned' }`; assert `calls[1].checks` deep-equals `['mirror','red-tip','reap','release','archive','console']` (was `undefined` — the CLI now names its inline set; budget and stamp assertions unchanged).
- `unscoped CLI defers three checks and spawns the background pass` — same stubs; captured stdout JSON has the `deferred-to-background` skipped entry and `background` deep-equals `{ checks: ['archive-branches','remote-prune','ledger-residue'], spawned: true, reason: 'spawned' }`; stub called once.
- `unscoped CLI never spawns under --dry-run or on a no-remote fixture` — `runHook(['reconcile','--dry-run','--json'], { cwd: noRemoteFixture(...) })` → `background` deep-equals `{ checks: [...], spawned: false, reason: 'not-converged' }` and `skipped` still deep-equals `[{ check: 'all', reason: 'no-remote' }]`; in-process `main([... 'reconcile','--dry-run','--json'])` with `reconcile` stubbed to return `{ skipped: [] }` → spawn stub not called, `reason === 'dry-run'`, `skipped` carries the deferral entry.
- `explicit --checks output has no background key` — `main([... '--checks','reap','--json'])` → parsed output lacks `background`.
- The existing no-repo/no-remote verb tests (reconcile.test.js ~lines 1519-1577) must pass unmodified.
- background-spawn.test.js: `fresh status suppresses the spawn` (`reason: 'fresh'`, `cp.spawn` stub not called); `stale status spawns detached + windowsHide with an error listener` (asserts argv `[hooks.js, 'reconcile-background']`, `detached`, `windowsHide`, one `'error'` listener, `unref` called); `a throwing spawn reports spawn-failed`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/background-spawn.test.js`
Expected: FAIL after Step 1 — `checks` still `undefined`; module missing

- [ ] **Step 3: Implement the helper, the CLI deferral, the session-start call and the docs bullet**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/background-spawn.test.js tests/hooks-session-start.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/background-spawn.js plugin/bin/lib/hooks/session-start.js plugin/bin/hooks.js docs/hooks.md tests/reconcile.test.js tests/bin-lib/reconcile/background-spawn.test.js
git commit -m "Defer janitorial checks from the unscoped reconcile CLI to the background pass — refs #4032"
```

### Task 8: Timing contract doc and the live 20-call measurement

**Files:**
- Modify: `docs/reconcile-checks.md` (new `## Timing contract` section; the fast/background bullet names the CLI deferral)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/reconcile/` inventory line gains `timing.js`, `pr-state-cache.js`, `background-spawn.js`)

**Interfaces:** none (documentation + verification).

`## Timing contract` states: the `timings` key and its shape (Task 1 `summarizeTimings`), the phase names, that `subprocessMs` can exceed `ms` when a phase runs subprocesses concurrently, that every `plugin/bin/lib/reconcile/*.js` subprocess is timed (enforced by `subprocess-timing-conformance.test.js`) and git through `runGit`/`runGitAsync`; the PR-state cache rules (Task 3's `persistableTtl` table, `PR_STATE_RETENTION_MS`, `NO_PR_TTL_MS`); the claim-blob reuse rule (Task 5); the residue marker index and its documented duplicate divergence (Task 6); the CLI deferral (Task 7); and the measured before/after numbers from Step 2 below.

- [ ] **Step 1: Write the doc sections**

- [ ] **Step 2: Measure (AC1.1)** — from this worktree, against the main checkout this repo resolves to, run `node plugin/bin/hooks.js reconcile --json` 20 times sequentially (the shape `_shared/worktree-setup.md`'s Pre-creation reconcile, `dispatch` Step 2 and `/tidy` run), recording each call's wall time and its `timings.totalMs`; report min / p50 / p90 / max and the per-phase p50. Expected: p50 < 10 000 ms. Cross-check one call's `timings.totalMs` against its externally measured wall time (independent count — they must agree within process start-up, ~100-300 ms). Record the numbers in the doc section and in the run's `decisions.md`.
  - Waived AC1.1: a live-network wall-time property of this repo's state, not hermetic — verified by this measurement, not by a committed `npm test` assertion.

- [ ] **Step 3: Commit**

```bash
git add docs/reconcile-checks.md docs/plugin-structure.md
git commit -m "Document the reconcile timing contract and measured wall time — refs #4032"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 — per-check and per-subprocess timing in JSON | 1, 2 |
| Deliverable 2 — batch/parallelize `gh` calls (`gh-pool.js`) | 3, 4 |
| Deliverable 2 — reuse cached results within a TTL (`cache.js`) | 3, 5, 6 |
| Deliverable 2 — skip checks whose inputs are unchanged | 5 (claim blobs by content sha); the only check-level input fingerprint that is sound — archive-branches/remote-prune age with wall time and PR state, so their inputs are never "unchanged" |
| Deliverable 2 — move non-blocking checks to the background | 7 |
| Deliverable 3 — `docs/reconcile-checks.md` timing contract | 8 |
| AC1.1 — p50 < 10 s over 20 calls | 8 Step 2 (waived as a committed test) |
| AC2.1 — per-check timings in JSON | 1 (tests `AC2.1: …`) |
| AC3.1 — existing fixture tests unchanged | 2, 4, 6 Step 4 (full reconcile suites); 7 names its two opts/skipped-shape edits |
