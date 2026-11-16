# Worktree reap honours a live session in the worktree (#4960) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A worktree a live Claude session is standing in is never removed by the merged-worktree reaper (or the SessionStart reaper) running in another process, and a reap of a merged run's worktree always lands a `worktree-reaped` event in that run's `events.jsonl`.

**Architecture:** A session's presence in a linked worktree is recorded as a small *hold* file inside that worktree's own git admin dir (`{gitdir}/claude-tweaks-holds/{key}.json`), written by hooks when the session enters the worktree and removed when it leaves or ends. One shared predicate in `worktree-reap.js` (`isHeldByLiveSession`) reads those holds and treats a hold whose recorded Claude pid is alive as "in use"; `reap-merged.js` and `reapWorktrees` both consult it beside their existing lock check. Separately, `reap-merged.js`'s owning-run lookup widens to closed and archived runs (matching `worktree` or `worktreeAtClose`), because the same reconcile pass archives a merged run before it reaps the run's worktree.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real git fixtures (`tests/helpers/git-fixtures.js`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153816-record-4960/work/4960-spec.md`

**Scope keywords:** isWorktreeLocked, resolveOwningRunDir, reapWorktrees, claude-tweaks-holds

## Background (Deliverable 1 — done before this plan)

The removal path is identified and posted on the record (https://github.com/thn-inc/claude-tweaks/issues/4960#issuecomment-6921658524), which satisfies **AC1.1** (named on the record, with the evidence). Summary: a sibling session's `SessionStart` spawned `hooks.js reconcile-background` from its own worktree; that pass ran `release` → `archive` → `reap`, and `reap-merged.js` removed `dispatch-record-4551` because (a) `isOwnCwd` compared the sibling's cwd, (b) `isWorktreeLocked` found no lock — dispatch creates group worktrees with raw `git worktree add` + `EnterWorktree(path)`, which never writes git's lock (an `EnterWorktree(name)` worktree carries `locked claude session <name> (pid N start …)`), and (c) the PR was `MERGED`. No reap event landed because `archive` had already moved the closed run (`worktree: null`, `worktreeAtClose` set) to `archive/`, and `findRunByWorktreePath` reads only the `worktree` field of non-terminal, non-archived runs.

## Global Constraints

- Hooks never break a session (docs/hooks.md, first rule): every new hook path is best-effort, catches its own errors, writes nothing to stdout, and never changes the hook's existing outcome. The hold writes are **log tier** (side effect only, no message).
- Every predicate in `worktree-reap.js` fails CLOSED (its header): "An unparseable lock reason, an unresolvable branch, an unresolvable cwd, or a git call that doesn't answer all resolve to "not eligible" — never to "eligible"." The hold reader follows it: an unparseable hold, a hold from another host, or a hold with no integer pid reads as **held**. A worktree with no hold directory reads as **not held** (nothing claims it).
- Source-scan lint (`tests/path-guard-conformance.test.js`): no new `fs.existsSync` / `fs.realpathSync` token under `plugin/bin/`. Use try/catch around `fs.readFileSync` / `fs.readdirSync` / `fs.statSync`, and `worktree-detect.js`'s `safeReal` for canonical paths.
- Spawns under `plugin/bin/` carry `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`). This plan adds no new spawn of its own; `pidStartTime` (run-liveness/process-probe.js) already complies.
- From the `pre-tool-use-gate-exemptions` skill, quoted: "**A containment check calls `shared-primitives.js`'s `isPathContained(candidate, root, { orEqual })` — never a retyped `startsWith(root + path.sep)` or a bare `path.relative`-derived `startsWith('..')`.**" Applies to `worktreeRootOf` and any path comparison in the new module.
- From the `windows-checkout-test-parity` skill, quoted (Anti-patterns row): "Faking `gh` PR state with a `PATH` stub in a test whose subject already accepts an injected resolver | `{ skip: STUB_SKIP }` keeps the file green on Windows but drops that test's only coverage there. Inject the state instead, `createPrStateResolver({ root, deps: { byBranch } })` passed as `reapMerged`'s `prStates`, so the test spawns nothing, needs no `installGhWrapper`, and runs on every platform". Every new `reapMerged` test in this plan injects `prStates` this way.
- From the same skill: "Stubbing `process.platform` in a test | It is process-global, so the stub leaks into other tests in the same `node --test` worker". The new module takes injectable deps (`hostname`, `isAlive`, `startTime`) instead.
- `bin/lib/run-liveness/process-probe.js` must not require `hooks/context.js` (its header). The new `hooks/worktree-hold.js` likewise requires only `fs`, `os`, `path`, `./worktree-detect` and `../shared-primitives` — never `context.js` or `worktree-reap.js` (`worktree-reap.js` will require it; a reverse edge is a cycle).
- `plugin/skills/dispatch/SKILL.md` is 51,668 B against the 52,500 B Read-limit rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`): its edit must stay byte-neutral or shrink (measure `wc -c` before and after).
- Commit messages: `{Verb} {what} — {detail}`, imperative, ending with `Claude-Session: https://claude.ai/code/session_017vXcAdz1d4DDedQE5ugdCo`.

## Review Focus

1. A resumed or compacted session (new Claude pid) sitting in a worktree: its old hold names a dead pid, so it must be re-stamped at `SessionStart` — Task 4 owns the test.
2. A nested `claude -p` (same `session_id`, different `CLAUDE_PID`) ending must not clear the parent session's hold — the key carries the pid (Task 1) and `SessionEnd` clears only its own pid's holds (Task 4 test).
3. A subagent `EnterWorktree(path)` (payload carries `agent_id`) must not move the main thread's hold — the key carries the agent id (Task 1 key test, Task 4 integration test).
4. A recycled pid: a hold whose recorded `pidStartedAt` differs from the live process's start time is dead, not held — Task 2 predicate test with an injected `startTime`.
5. The reap event for a merged run must survive the same pass archiving the run first — Task 3 test produces the state with the real `closeRunState` writer, then moves the dir to `archive/`.

---

### Task 1: Hold-file primitives (`plugin/bin/lib/hooks/worktree-hold.js`)

**Files:**
- Create: `plugin/bin/lib/hooks/worktree-hold.js`
- Test: `tests/bin-lib/hooks/worktree-hold.test.js`

**Interfaces:**
- Produces (all exported, none throws):
  - `HOLD_DIR_NAME = 'claude-tweaks-holds'`
  - `holdKey({ sessionId, agentId, pid }) -> string|null` — `${sessionId}__${agentId || 'main'}__${pid}`; null unless `sessionId` and `agentId` (when given) match `^[A-Za-z0-9_-]+$` and `pid` is a positive integer.
  - `worktreeRootOf(p) -> string|null` — walk up from `p` to the first `.git` entry; a **file** there means a linked worktree → return that directory via `safeReal`; a directory, an unreadable entry, or no entry → null.
  - `holdDirOf(wtPath) -> string|null` — read `{wtPath}/.git` (a file), take its `gitdir:` line resolved against `wtPath`, return `{gitdir}/claude-tweaks-holds`; null when `.git` is not a readable file or has no `gitdir:` line.
  - `writeHold(wtPath, { key, block, agentId }) -> boolean` — `block` is `context.js`'s `ownerBlock()` shape (`{ sessionId, host, pid, pidSource, pidStartedAt, heartbeatAt }`); writes `{holdDir}/{key}.json` = `{ ...block, agentId: agentId || null, worktree: wtPath, key }` atomically (write `{key}.json.tmp-{process.pid}` then `fs.renameSync`); creates the hold dir; false on any failure or null `holdDirOf`.
  - `readHolds(wtPath) -> Array<{ key, hold }>` — one entry per `*.json` in the hold dir; `hold` is the parsed object, or `null` when the file cannot be read or parsed; `[]` when the hold dir is absent.
  - `clearHolds(mainRoot, { key, except }) -> number` — remove `{mainRoot}/.git/worktrees/*/claude-tweaks-holds/{key}.json` in every admin dir except the one `holdDirOf(except)` names; returns the count removed.
  - `clearSessionHolds(mainRoot, { sessionId, pid }) -> number` — remove every hold file whose name matches `${sessionId}__*__${pid}.json` under the same admin-dir glob.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/hooks/worktree-hold.test.js`, using `gitRepo()` and `harnessWorktreeOf(main, name)` from `tests/helpers/git-fixtures.js`:
  - `holdKey: joins session, agent (default main) and pid; rejects path-hostile parts` — `holdKey({ sessionId: 's1', pid: 42 }) === 's1__main__42'`; `holdKey({ sessionId: 's1', agentId: 'a9', pid: 42 }) === 's1__a9__42'`; `null` for `sessionId: '../x'`, `agentId: 'a/b'`, `pid: 0`, `pid: '42'`, missing `sessionId`.
  - `worktreeRootOf: a subdirectory of a linked worktree resolves to the worktree; the main checkout resolves to null` — `mkdir {wt}/a/b`; `worktreeRootOf({wt}/a/b) === wt`; `worktreeRootOf(main) === null`.
  - `holdDirOf: names the worktree's own admin dir; null for the main checkout` — equals `path.join(fs.realpathSync(path.join(main, '.git', 'worktrees', leaf)), 'claude-tweaks-holds')` (compare after `safeReal` of both sides — macOS `/private` prefix); `holdDirOf(main) === null`.
  - `writeHold + readHolds: round-trips the owner block with agentId and worktree` — write with `key 's1__main__42'`, `block { sessionId: 's1', host: 'h', pid: 42, pidSource: 'env', pidStartedAt: 'T', heartbeatAt: 'Z' }`; `readHolds(wt)` deep-equals `[{ key: 's1__main__42', hold: { ...block, agentId: null, worktree: wt, key: 's1__main__42' } }]`; no `*.tmp-*` file remains.
  - `writeHold: refuses the main checkout and writes nothing` — returns `false`; `fs.readdirSync(path.join(main, '.git'))` gains no `claude-tweaks-holds`.
  - `readHolds: an unparseable hold reads as { hold: null }` — write `{holdDir}/x.json` = `{not json`; entry `{ key: 'x', hold: null }`.
  - `clearHolds: removes the key from other worktrees, keeps the except worktree and other keys` — worktrees A and B; holds `k` in A and B, `other` in A; `clearHolds(main, { key: 'k', except: B }) === 1`; A keeps only `other`, B keeps `k`.
  - `clearSessionHolds: removes this session+pid only` — holds `s1__main__42`, `s1__a9__42`, `s1__main__43`, `s2__main__42` in A; `clearSessionHolds(main, { sessionId: 's1', pid: 42 }) === 2`; `s1__main__43` and `s2__main__42` remain.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/hooks/worktree-hold.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/hooks/worktree-hold'`

- [ ] **Step 3: Implement `plugin/bin/lib/hooks/worktree-hold.js`** with the Interfaces above. Header comment states the contract in two sentences: what a hold is, and that every function is best-effort and never throws. Requires only `fs`, `os`, `path`, `./worktree-detect` (`safeReal`) and `../shared-primitives` (`isPathContained`, used in `clearHolds` to compare admin dirs) — no `existsSync`/`realpathSync` tokens.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/hooks/worktree-hold.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/worktree-hold.js tests/bin-lib/hooks/worktree-hold.test.js
git commit -m "Add worktree hold primitives — per-worktree session presence files (#4960)"
```

### Task 2: `isHeldByLiveSession` — honoured by `reap-merged.js` and `reapWorktrees`

**Files:**
- Modify: `plugin/bin/lib/hooks/worktree-reap.js` (new export beside `isWorktreeLocked`; `REASON.HELD`; `reapWorktrees` loop after the lock verdict)
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (import; skip after the `isWorktreeLocked` line, ~line 230; header comment)
- Test: `tests/bin-lib/hooks/worktree-held.test.js` (new), `tests/bin-lib/reconcile/reap-merged-held.test.js` (new — own minimal fixture: `git init -b main` + one commit in a `realpathSync`'d tmp root, `git worktree add -q -b worktree-issue-1 {root}/.claude/worktrees/issue-1`, and a run dir `{root}/.claude-tweaks/pipelines/2026-01-01T000000-test-run` whose `run-state.json` names the worktree via `writeRunState` — the same shape as `reap-merged.test.js`'s `buildReapableFixture`, which is not exported)

**Interfaces:**
- Consumes: Task 1's `readHolds(wtPath)`, `writeHold`, `holdKey`; `run-liveness/process-probe.js`'s `pidStartTime(pid)`.
- Produces:
  - `isHeldByLiveSession(wtPath, { hostname = os.hostname, isAlive = isPidAlive, startTime = pidStartTime } = {}) -> boolean` exported from `worktree-reap.js`. For each `readHolds(wtPath)` entry: `hold === null` → held; `hold.host !== hostname()` → held; `!Number.isInteger(hold.pid) || hold.pid <= 0` → held; `!isAlive(hold.pid)` → not this one; `hold.pidStartedAt` is a non-empty string and `startTime(hold.pid)` is a non-empty string that differs → not this one (recycled pid); otherwise held. No entries → `false`.
  - `REASON.HELD = 'held by a live session in this worktree'`, added to `QUIET_SKIP_REASONS`.
  - `reapMerged` skip entry `{ path, reason: 'held' }`, written with **no** `logReapEvent` call (same quiet posture as `'in-use'`).

- [ ] **Step 1: Write the failing tests.** Predicate and `reapWorktrees` tests in `tests/bin-lib/hooks/worktree-held.test.js` (`gitRepo()` + `harnessWorktreeOf()`):
  - `isHeldByLiveSession: no hold directory → false` (fresh `harnessWorktreeOf`).
  - `isHeldByLiveSession: a hold naming this live process → true` (`writeHold` with `block.pid = process.pid`, `host = os.hostname()`).
  - `isHeldByLiveSession: a hold whose pid is dead → false` (inject `isAlive: () => false`).
  - `isHeldByLiveSession: an unparseable hold → true (fails closed)`.
  - `isHeldByLiveSession: a hold from another host → true (fails closed)` (`host: 'elsewhere'`).
  - `isHeldByLiveSession: a recycled pid (start time differs) → false` (`pidStartedAt: 'A'`, inject `startTime: () => 'B'`); and the same hold with `startTime: () => null` → `true` (unknown start time never frees it).
  - `reapWorktrees: skips a held worktree with REASON.HELD even when merged and clean` — a harness worktree whose branch is content-identical with the main branch (the shape `tests/hooks-worktree-reap.test.js` reaps; call `reapWorktrees({ cwd: main, integration: <main branch> })`); write a live hold; result `skipped` contains `{ path: wt, reason: REASON.HELD }`; directory still exists; `QUIET_SKIP_REASONS.has(REASON.HELD)`.

  The AC2 test in `tests/bin-lib/reconcile/reap-merged-held.test.js`, injected PR state, no `STUB_SKIP`:

```js
test('AC2.1: reapMerged skips a worktree held by a live session running in another process, and reaps it once that process exits', async () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const holder = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore', windowsHide: true });
  try {
    const key = holdKey({ sessionId: 'sess-4960', pid: holder.pid });
    assert.ok(writeHold(wtPath, { key, block: ownerBlock({ sessionId: 'sess-4960', env: { CLAUDE_PID: String(holder.pid) } }) }));
    const prStates = createPrStateResolver({ root, deps: { byBranch: () => ({ number: 4724, state: 'MERGED', mergedAt: '2026-11-01T19:11:16Z', updatedAt: '2026-11-01T19:11:16Z' }) } });
    const held = reapMerged({ cwd: root, prStates });
    assert.deepEqual(held.skipped.map((s) => s.reason), ['held']);
    assert.equal(held.reaped.length, 0);
    assert.equal(fs.statSync(wtPath).isDirectory(), true);
    assert.throws(() => fs.statSync(path.join(runDir, 'events.jsonl')), /ENOENT/, 'a held skip is quiet');
  } finally {
    holder.kill();
  }
  await new Promise((r) => holder.once('exit', r));
  const prStates = createPrStateResolver({ root, deps: { byBranch: () => ({ number: 4724, state: 'MERGED', mergedAt: '2026-11-01T19:11:16Z', updatedAt: '2026-11-01T19:11:16Z' }) } });
  const after = reapMerged({ cwd: root, prStates });
  assert.equal(after.reaped.length, 1, `a dead holder frees the worktree: ${JSON.stringify(after)}`);
});
```

  (`cp` = `require('child_process')`; `holdKey`/`writeHold` from `plugin/bin/lib/hooks/worktree-hold`; `ownerBlock` from `plugin/bin/lib/hooks/context`. `ownerBlock` calls the real `pidStartTime`, so the hold carries the child's real start time — the real-writer fixture, not hand-written JSON. The `if (exitCode === null)` guard before `once('exit')` is the implementer's call.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/hooks/worktree-held.test.js tests/bin-lib/reconcile/reap-merged-held.test.js`
Expected: FAIL — `isHeldByLiveSession is not a function`, and AC2.1 reaps the held worktree (`skipped` is `[]`)

- [ ] **Step 3: Implement** `isHeldByLiveSession` + `REASON.HELD` in `worktree-reap.js`; in `reapWorktrees`, after the lock-verdict block and before the orphan-staleness check: `if (isHeldByLiveSession(real)) { skipped.push({ path: real, reason: REASON.HELD }); continue; }`. In `reap-merged.js`, directly after the `isWorktreeLocked` line: `if (isHeldByLiveSession(real)) { skipped.push({ path: real, reason: 'held' }); continue; }`, and add one sentence to the module header naming the third guard (a live session in another process, read from its hold — #4960).

- [ ] **Step 4: Run to verify they pass, plus both reapers' existing suites**

Run: `node --test tests/bin-lib/hooks/worktree-held.test.js tests/bin-lib/reconcile/reap-merged-held.test.js tests/hooks-worktree-reap.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS

- [ ] **Step 5: Prove AC2.1 discriminates (revert proof)** — comment out the new `reap-merged.js` line, re-run `node --test tests/bin-lib/reconcile/reap-merged-held.test.js`, expect FAIL (`skipped` deep-equal mismatch), restore the line, re-run, expect PASS. Quote both outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/worktree-reap.js plugin/bin/lib/reconcile/reap-merged.js tests/bin-lib/hooks/worktree-held.test.js tests/bin-lib/reconcile/reap-merged-held.test.js
git commit -m "Honour a live session's worktree hold in both reapers — reap-merged no longer strands a dispatching session (#4960)"
```

### Task 3: The reap event reaches a closed or archived run

**Files:**
- Modify: `plugin/bin/lib/reconcile/reap-merged.js` (`resolveOwningRunDir`, ~lines 44-59)
- Test: `tests/bin-lib/reconcile/reap-merged-owning-run.test.js` (new — same minimal fixture as Task 2's `reap-merged-held.test.js`)

**Interfaces:**
- Consumes: `context.js`'s `findRunByWorktreePath(root, real, { skipAdHoc: true })`, `iterRunDirsWithState(root, { status: 'clean' })`, `readRunState(dir)`, `isAdHocRunDir(dir)`, `RUN_ID_RE`, `priorWorktree(state)`; `worktree-detect.js`'s `safeReal`.
- Produces: `resolveOwningRunDir(root, real) -> string|null`, newest-first precedence: (1) the existing live lookup; (2) clean (closed, unarchived) runs whose `priorWorktree(state)` canonicalizes to `real`; (3) `{root}/.claude-tweaks/pipelines/archive/{run-id}/` dirs (names matching `RUN_ID_RE`, sorted newest first, ad-hoc skipped) whose `priorWorktree(readRunState(dir))` canonicalizes to `real`. Canonicalize with `safeReal(recorded) || recorded` and compare to `real` (the worktree still exists at this point — the call happens before removal). Exported for the test.

- [ ] **Step 1: Write the failing tests:**
  - `AC3.1: a merged run already closed and archived by the same pass still gets the worktree-reaped event` — the fixture; `writeRunState(runDir, { sessionId: 'sess-a3' })`, then the real `closeRunState(runDir, { explicit: true, checkLiveWorktree: false })` (from `plugin/bin/lib/hooks/close-run-state`; assert its returned `status === 'closed'` — pass `callerIdentity: { sessionId: 'sess-a3' }` if it refuses as foreign) so `run-state.json` reads `status: 'clean', worktree: null, worktreeAtClose: wtPath`; then `fs.renameSync(runDir, archived)` with `archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', path.basename(runDir))` (mkdir the parent) — the destination `archiveRunDir` produces; injected merged `prStates` (number 4724); `reapMerged` reaps 1; `archived/events.jsonl` has a `worktree-reaped` line with `prNumber: 4724`.
  - `AC3.1: a closed run that is not yet archived gets the event` — same, without the rename; event in `runDir/events.jsonl`.
  - `AC3.1: resolveOwningRunDir: a live run outranks an older archived run that recorded the same path` — archived run `2025-01-01T000000-old` with `worktreeAtClose: wtPath`; the fixture's live run; returns the live run dir.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/reap-merged-owning-run.test.js`
Expected: FAIL — no `worktree-reaped` event in the archived/closed run; `resolveOwningRunDir` not exported

- [ ] **Step 3: Implement** the widened `resolveOwningRunDir` per Interfaces, keeping its "resolved before removal" header comment and adding one line naming why clean and archived runs are searched (#4960: the same reconcile pass archives first).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/reap-merged-owning-run.test.js tests/bin-lib/reconcile/reap-merged.test.js`
Expected: PASS (the existing #2783 ad-hoc-twin test must stay green)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/reap-merged.js tests/bin-lib/reconcile/reap-merged-owning-run.test.js
git commit -m "Log worktree-reaped into closed and archived runs — the reap trail survives same-pass archival (#4960)"
```

### Task 4: Hooks write and clear the hold

**Files:**
- Modify: `plugin/bin/lib/hooks/worktree-hold.js` (add `syncHoldForToolUse`, `stampHoldForCwd`, `releaseSessionHolds`)
- Modify: `plugin/bin/lib/hooks/post-tool-use.js` (`run()`: one call before `stampAdHocRunDir(ctx)`)
- Modify: `plugin/bin/lib/hooks/session-start.js` (one guarded call early in `run`)
- Modify: `plugin/bin/lib/hooks/session-end.js` (one guarded call before the `if (!owned.dir) return {};` early return)
- Test: `tests/hooks-post-tool-use-worktree-hold.test.js` (new), `tests/bin-lib/hooks/worktree-hold.test.js`

**Interfaces:**
- Consumes: Task 1 primitives; `context.js`'s `ownerBlock({ sessionId, env, deps })` — passed **into** these functions as `deps.ownerBlock` by the hook modules, so `worktree-hold.js` still never requires `context.js`; `post-tool-use.js`'s existing `resolveCreatedWorktreePath(ctx)` (passed in as `deps.resolveEnteredPath`); `worktree-detect.js`'s `mainCheckoutRoot`.
- Produces (all never throw, return nothing meaningful beyond a status string for tests):
  - `syncHoldForToolUse(input, { cwd, env, ownerBlock, resolveEnteredPath }) -> 'stamped'|'cleared'|'skipped'` — `input.tool_name === 'EnterWorktree'`: `wt = worktreeRootOf(resolveEnteredPath() || cwd)`; `block = ownerBlock({ sessionId: input.session_id, env })`; `key = holdKey({ sessionId: input.session_id, agentId: input.agent_id, pid: block.pid })`; null `wt`/`key` → `'skipped'`; else `writeHold(wt, { key, block, agentId: input.agent_id })` then `clearHolds(mainCheckoutRoot(wt), { key, except: wt })` → `'stamped'`. `'ExitWorktree'`: `clearHolds(mainCheckoutRoot(cwd), { key })` (key from the same parts) → `'cleared'`. Anything else → `'skipped'`.
  - `stampHoldForCwd({ cwd, sessionId, env, ownerBlock }) -> 'stamped'|'skipped'` — SessionStart: `wt = worktreeRootOf(cwd)`; stamps a main-thread hold (`agentId` absent) and clears the same key elsewhere, exactly like the EnterWorktree branch.
  - `releaseSessionHolds({ cwd, sessionId, env }) -> number` — SessionEnd: `pid = claudePid(env)` from `run-liveness/process-probe.js`; null → 0; else `clearSessionHolds(mainCheckoutRoot(cwd), { sessionId, pid })`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-post-tool-use-worktree-hold.test.js`, driving `post.run(ctx)` (the real `post-tool-use.js`) with the `enterWorktreeCtx`/`createdAt` shape from `tests/hooks-post-tool-use-worktree-staleness.test.js` (copy the two helpers; set `input.session_id`, optional `input.agent_id`), and `process.env.CLAUDE_PID` set to `String(process.pid)` for the test's duration (restore in `finally`):
  - `EnterWorktree stamps a hold in the entered worktree` — `readHolds(A)` has one entry, `hold.sessionId === 's1'`, `hold.pid === process.pid`.
  - `entering a second worktree moves the hold` — enter A then B; `readHolds(A)` is `[]`, `readHolds(B)` has the key.
  - `ExitWorktree clears the session's hold` — enter A, then `post.run` with `tool_name: 'ExitWorktree'`, `cwd: main`; `readHolds(A)` is `[]`.
  - `a subagent's EnterWorktree (agent_id set) leaves the main thread's hold in place` — main enters A; agent `ag1` enters B; A still holds `s1__main__{pid}`, B holds `s1__ag1__{pid}`.
  - `no resolvable Claude pid writes no hold` — `CLAUDE_PID` deleted and `ownerBlock` returning `pid: null` (call `syncHoldForToolUse` directly with an injected `ownerBlock`); returns `'skipped'`.
  - `a hold-write failure never changes post-tool-use's outcome` — make the admin hold dir a **file** (`fs.writeFileSync({holdDir})`) before entering; `post.run` returns the same value it returns with no hold code path (`{}` or the staleness nudge the fixture triggers — assert it does not throw and the return has no `error` key).
  In `tests/bin-lib/hooks/worktree-hold.test.js` add:
  - `stampHoldForCwd: a resumed session in a worktree re-stamps with its current pid` — existing hold `s1__main__1` (dead pid); `stampHoldForCwd({ cwd: path.join(A, 'sub'), sessionId: 's1', env: { CLAUDE_PID: String(process.pid) }, ownerBlock })` → `'stamped'`; `readHolds(A)` includes `s1__main__{process.pid}`.
  - `releaseSessionHolds: clears only this pid's holds (a nested claude -p ending leaves the parent's)` — holds `s1__main__42` and `s1__main__{process.pid}`; `releaseSessionHolds({ cwd: A, sessionId: 's1', env: { CLAUDE_PID: '42' } }) === 1`; the `process.pid` hold remains.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-post-tool-use-worktree-hold.test.js tests/bin-lib/hooks/worktree-hold.test.js`
Expected: FAIL — no hold written; `syncHoldForToolUse`/`stampHoldForCwd`/`releaseSessionHolds` not exported

- [ ] **Step 3: Implement** the three functions in `worktree-hold.js`, then wire each call inside its own `try { … } catch { /* log tier: never break a session */ }`:
  - `post-tool-use.js` `run()`: `holdLib.syncHoldForToolUse(ctx.input, { cwd: ctx.cwd, env: process.env, ownerBlock: ctxLib.ownerBlock, resolveEnteredPath: () => resolveCreatedWorktreePath(ctx) })` directly before `stampAdHocRunDir(ctx);`.
  - `session-start.js` `run`: `holdLib.stampHoldForCwd({ cwd: ctx.cwd, sessionId: ctx.input.session_id, env: process.env, ownerBlock: ctxLib.ownerBlock })` before its reconcile call (so a pass this same SessionStart spawns already sees the hold).
  - `session-end.js` `run`: `holdLib.releaseSessionHolds({ cwd: ctx.cwd, sessionId: ctx.input.session_id, env: process.env })` as the first statement.

- [ ] **Step 4: Run to verify they pass, plus the existing suites of the three hook modules** (Dependency-caller enumeration — each now touches the fixture repo's admin dir when its cwd is a linked worktree):

Run: `node --test tests/hooks-post-tool-use-worktree-hold.test.js tests/bin-lib/hooks/worktree-hold.test.js tests/hooks-post-tool-use-worktree-staleness.test.js tests/hooks-session-start.test.js`
Then: `git grep -l "session-end" -- tests` and run each listed file.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/worktree-hold.js plugin/bin/lib/hooks/post-tool-use.js plugin/bin/lib/hooks/session-start.js plugin/bin/lib/hooks/session-end.js tests/hooks-post-tool-use-worktree-hold.test.js tests/bin-lib/hooks/worktree-hold.test.js
git commit -m "Stamp and release worktree holds from EnterWorktree, ExitWorktree, SessionStart and SessionEnd (#4960)"
```

### Task 5: Dispatch recovery sequence and contract docs

**Files:**
- Modify: `plugin/skills/dispatch/sequential-execution.md` (new subsection after "Creating the group's worktree")
- Modify: `plugin/skills/dispatch/SKILL.md:229` (the parenthetical `(\`reap-merged.js\` skips own-cwd and locked worktrees)`)
- Modify: `docs/hooks.md` (one bullet beside the `post-tool-use-failure` / `user-prompt-submit` event bullets)
- Modify: `docs/plugin-structure.md` (the line that enumerates `plugin/bin/lib/hooks/` modules, if one names its sibling modules; otherwise no change — say which in the report)
- Test: `tests/dispatch-worktree-recovery-prose.test.js` (new)

**Interfaces:**
- Consumes: Task 2's skip semantics and Task 4's writer events, for the prose.

- [ ] **Step 1: Write the failing prose test** `tests/dispatch-worktree-recovery-prose.test.js` reading the live files (house pattern for skill prose pins):
  - `AC4.1: sequential-execution.md states the recovery sequence` — the file contains `ExitWorktree(action: "keep")` and `EnterWorktree(path` within one section whose heading matches `/worktree disappears/i`, and the `ExitWorktree` mention precedes the `EnterWorktree` one.
  - `AC4.1: sequential-execution.md warns against a plain cd` — the same section matches `/plain `cd`/` and `/refus/`.
  - `SKILL.md Step 5's reap statement names the session hold` — `plugin/skills/dispatch/SKILL.md` contains `own-cwd, locked and session-held worktrees` and no longer contains `skips own-cwd and locked worktrees)`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dispatch-worktree-recovery-prose.test.js`
Expected: FAIL, 3 tests

- [ ] **Step 3: Edit the prose:**
  - `sequential-execution.md`, new `## When the group's worktree disappears anyway` after "Creating the group's worktree": the symptom (`Working directory … was deleted; shell cwd recovered`, then `gh`/`git` failing with `not a git repository`); the recovery: `ExitWorktree(action: "keep")` first (the session is still isolated in the deleted path), then `EnterWorktree(path: …)` into the next group's already-created worktree; the warning: a plain `cd` into another worktree or the main checkout leaves the harness refusing every command, because the session stays isolated in the deleted worktree; one sentence that a live session's hold (#4960) now keeps the reapers off a worktree it stands in, so this is the fallback, not the expected path.
  - `SKILL.md:229`: replace `(\`reap-merged.js\` skips own-cwd and locked worktrees)` with `(\`reap-merged.js\` skips own-cwd, locked and session-held worktrees)`. Measure `wc -c plugin/skills/dispatch/SKILL.md` before and after; it must stay under 52,500 B (it grows by 14 B).
  - `docs/hooks.md`: one bullet — `post-tool-use` (`EnterWorktree`/`ExitWorktree`), `session-start` and `session-end` write and clear a **worktree hold** (log tier, #4960): a `{gitdir}/claude-tweaks-holds/{session}__{agent|main}__{claude-pid}.json` file in the entered worktree's own git admin dir; `worktree-reap.js`'s `isHeldByLiveSession` (used by `reapWorktrees` and `reconcile/reap-merged.js`) treats a hold whose pid is alive as in use, failing closed on an unreadable hold or a foreign host; the file goes with the worktree's admin dir.

- [ ] **Step 4: Run to verify it passes, plus skill-prose suites that read these files**

Run: `node --test tests/dispatch-worktree-recovery-prose.test.js`
Then: `git grep -l -e "sequential-execution.md" -e "dispatch/SKILL.md" -- tests` and run each listed file.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/sequential-execution.md plugin/skills/dispatch/SKILL.md docs/hooks.md tests/dispatch-worktree-recovery-prose.test.js
git commit -m "Document the worktree hold and the stranded-session recovery for dispatch (#4960)"
```

(Add `docs/plugin-structure.md` to the `git add` only if Task 5 changed it.)

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Done before the plan — record comment 6921658524 |
| AC2.1 (a test skips a worktree held by a live session in another process, shown red without the fix) | Task 2 Step 2 `AC2.1` test + Step 6 revert proof |
| AC3.1 | Task 3 `AC3.1` tests |
| AC4.1 (recovery sequence + plain-`cd` warning) | Task 5 `AC4.1` prose tests |
| Deliverable 2 + Key Files `reap-merged.js`, `worktree-reap.js` | Tasks 2-4 |
| Key Files `sequential-execution.md`, `SKILL.md` | Task 5 |
