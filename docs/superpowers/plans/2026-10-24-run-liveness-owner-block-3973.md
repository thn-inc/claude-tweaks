# Run-Liveness Verdict and Owner Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp an additive `owner` block into `run-state.json` at the three ownership stamp sites, keep it fresh from the owner's own hooks, and add `plugin/bin/lib/run-liveness/` returning a `live | dead | unknown` verdict from positive evidence — with no caller consuming it yet.

**Architecture:** Three new files under `plugin/bin/lib/run-liveness/`: `constants.js` (the window/throttle constants, no requires), `process-probe.js` (pid resolution and `ps` start-time probe, no requires beyond `child_process`/`path`), and `index.js` + `probes.js` (evidence gathering over injectable probes, verdict composition). `context.js` gains the owner-block builder and heartbeat/re-stamp helper and requires only `constants.js` and `process-probe.js`, so there is no require cycle with `index.js` (which reaches `context.js` through `resume-freshness.js`).

**Tech Stack:** Node 18+ CommonJS, `node --test`, no new dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061105-record-3973/work/3973-spec.md` (record #3973)

## Global Constraints

- No behavior change: nothing outside the new module and its tests calls `runLiveness`. `isDeadRunDir`, `classifyRunDir`'s `abandoned-interrupted` test, `checkResumeFreshness`, and `parentLiveDetail` are frozen — no edits (only a new read-only export may be added to `resume-freshness.js`).
- `ownerPid` (top-level, #3845) stays exactly as it is — written by the same sites, read by `isNestedSession`. The owner block is added beside it (expand-contract); it never replaces it.
- `owner` shape: `{ sessionId, host, pid, pidSource, pidStartedAt, heartbeatAt }`; `host` = `os.hostname()`; `pidSource` is `'env'` or `'ancestry'` (or `null` when `pid` is `null`); `pidStartedAt` is the raw trimmed `ps -o lstart= -p <pid>` string, compared by equality only, never parsed; `null` on win32 or when `ps` fails; `heartbeatAt` ISO-8601.
- Constants: `HEARTBEAT_THROTTLE_MS = 60_000`, `LIVE_WINDOW_MS = 10 * 60_000`, `LEGACY_DEAD_MS = 72 * 3_600_000` — module constants, not policy keys.
- Hook-path writes swallow every error and never throw (`docs/hooks.md` never-break-a-session invariant). Throttle reads `owner.heartbeatAt`; no marker file.
- Every `child_process` call passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- Probe errors resolve to `unknown`, never `dead`.

**Measured premise (Task 0, done at plan time, raw output at `{run-dir}/claude-pid-probe.txt`):** a nested `claude -p` (Claude Code 2.1.302) with `SessionStart`/`UserPromptSubmit`/`SessionEnd` probe hooks: every hook saw `CLAUDE_PID=40521`, which is the hook process's direct parent (`comm` `claude`); that process's parent `/bin/zsh` descends from the outer session's `claude` (7356). So `env` is the primary source; the ancestry fallback is "walk up from `process.ppid`, at most 8 hops, first process whose `comm` basename is exactly `claude`" — always the nearest, i.e. the hook's own session, never an outer one; neither source → `pid: null, pidSource: null`.

**Spec drift (logged):** #3845 already shipped `claudePid`, `ownerPidPatch`, `isNestedSession` and a resume-only `ownerPid` re-stamp. This plan reuses `claudePid` for the env source. The owner block's every-event re-stamp is guarded so a nested `claude -p` that shares the owner's session id cannot steal it: re-stamp only when the stored owner process is not provably alive (gone, start time differs, other host, or no stored pid).

## Review Focus

1. A hook process with no `CLAUDE_PID` (env lacks it) runs the ancestry walk on every hook event — it must stay bounded (8 hops) and must never throw. Pinned in Task 1 (`resolveOwnerPid` with an injected `ps` that loops or fails).
2. A nested `claude -p` sharing the owner's session id fires hooks with a different `CLAUDE_PID` while the owner is alive: the owner block must not be re-stamped and must not heartbeat. Pinned in Task 3.
3. `run-state.json` unparseable or missing entirely: `runLiveness` treats it as legacy and never throws. Pinned in Task 5.
4. A `fallback`-attributed `session-end` event in `events.jsonl` (another session's guess) must not count as the run's SessionEnd witness. Pinned in Task 4 (`ownEventAt` ignores fallback lines).
5. `events.jsonl` absent: `ownEventRecency` reports it unreadable, so the verdict is `unknown` (accepted conservatism — a run whose hooks never wrote an event cannot be judged dead). Pinned in Task 5.

---

### Task 1: Owner-block builder, pid probes, and a function-form `writeRunState`

**Files:**
- Create: `plugin/bin/lib/run-liveness/constants.js`
- Create: `plugin/bin/lib/run-liveness/process-probe.js`
- Modify: `plugin/bin/lib/hooks/context.js` (`writeRunState`; new `ownerBlock`, `ownerStampPatch`; exports)
- Test: `tests/bin-lib/run-liveness/process-probe.test.js` (new), `tests/hooks-context.test.js`

**Interfaces:**
- Produces (`constants.js`): `HEARTBEAT_THROTTLE_MS`, `LIVE_WINDOW_MS`, `LEGACY_DEAD_MS`.
- Produces (`process-probe.js`): `pidStartTime(pid, deps = {}) -> string | null` (null on win32, non-integer pid, non-zero `ps` exit, empty output; `deps.platform`, `deps.execFileSync`); `ancestorClaudePid(deps = {}) -> number | null` (starts at `deps.ppid ?? process.ppid`, `ps -o ppid=,comm= -p <pid>` per hop, ≤ 8 hops, returns the first pid whose `path.basename(comm)` is `claude`; null on win32 or any failure); `claudePid(env) -> number | null` (moved here verbatim from `context.js`; `context.js` keeps exporting `claudePid` as a re-export, so every #3845 caller and test is unchanged); `resolveOwnerPid(env, deps = {}) -> { pid: number | null, pidSource: 'env' | 'ancestry' | null }` (`claudePid(env)` first, then `deps.ancestorClaudePid ?? ancestorClaudePid`).
- Produces (`context.js`): `writeRunState(runDir, patchOrFn)` — when `patchOrFn` is a function it is called with the existing state (`{}` when none) inside the lock; a `null`/`undefined` return writes nothing and returns the existing state unchanged (no `updatedAt` bump); otherwise behaves exactly as today. `ownerBlock({ sessionId, env = process.env, now = Date.now(), deps = {} }) -> owner` (`deps.hostname`, `deps.resolveOwnerPid`, `deps.pidStartTime`; `pidStartedAt` is `null` whenever `pid` is `null`). `ownerStampPatch(existing, sessionId, block, { replacesSessionId }) -> { owner } | {}` — `{}` when `existing.owner` exists with a different `sessionId` and `replacesSessionId` is false, or when `sessionId` is not a non-empty string.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/run-liveness/process-probe.test.js`:
- `pidStartTime(process.pid)` on non-win32 is a non-empty string equal to a second call; `pidStartTime(process.pid, { platform: 'win32' })` is `null`; a dead pid (spawn a short `node -e ""` child, wait for exit, use its pid) is `null`; an injected `execFileSync` that throws yields `null`.
- `AC15.1: resolveOwnerPid prefers env` — `{ CLAUDE_PID: '4242' }` → `{ pid: 4242, pidSource: 'env' }`; `{ CLAUDE_PID: 'abc' }` with an injected ancestry returning `777` → `{ pid: 777, pidSource: 'ancestry' }`.
- `AC15.2: neither source → pid null` — env empty, ancestry `null` → `{ pid: null, pidSource: null }`.
- `ancestorClaudePid` with an injected `execFileSync` map `{ 10: '20 zsh', 20: '30 /usr/local/bin/claude', 30: '1 claude' }` and `ppid: 10` → `20` (nearest, not 30); a map that loops (`10 → 10`) returns `null` after 8 hops; a throwing runner returns `null`.

`tests/hooks-context.test.js`:
- `writeRunState with a function patch that returns null writes nothing` — existing `run-state.json` bytes unchanged, return value deep-equals the existing state.
- `writeRunState with a function patch sees the existing state` — the function receives `{ a: 1 }` and its `{ b: 2 }` merges to `{ a: 1, b: 2, updatedAt }`.
- `ownerBlock` with injected deps (`hostname: () => 'h'`, `resolveOwnerPid: () => ({ pid: 9, pidSource: 'env' })`, `pidStartTime: () => 'Sat Oct 24 08:08:15 2026'`, `now: Date.parse('2026-10-24T06:00:00Z')`) deep-equals `{ sessionId: 's', host: 'h', pid: 9, pidSource: 'env', pidStartedAt: 'Sat Oct 24 08:08:15 2026', heartbeatAt: '2026-10-24T06:00:00.000Z' }`; with `pid: null` the block has `pidStartedAt: null` and `pidStartTime` is never called.
- `AC2.4: ownerStampPatch never replaces another session's owner block` — existing `{ owner: { sessionId: 'a' } }`, caller `'b'`, `replacesSessionId: false` → `{}`; with `replacesSessionId: true` → `{ owner: block }`; caller `'a'` → `{ owner: block }`; caller `undefined` → `{}`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/run-liveness/process-probe.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/run-liveness/process-probe'`. (The `tests/hooks-context.test.js` additions are append-shaped: that file passes today; its new tests fail with `ctxLib.ownerBlock is not a function`.)

- [ ] **Step 3: Implement the three files** per the Interfaces block. `pidStartTime` and `ancestorClaudePid` call `execFileSync('ps', [...], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000, windowsHide: true })`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/process-probe.test.js tests/hooks-context.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/constants.js plugin/bin/lib/run-liveness/process-probe.js plugin/bin/lib/hooks/context.js tests/bin-lib/run-liveness/process-probe.test.js tests/hooks-context.test.js
git commit -m "Add owner-block builder and pid probes — run-liveness groundwork, refs #3973"
```

### Task 2: The three stamp sites write the owner block

**Files:**
- Modify: `plugin/bin/hooks.js` (`record-worktree` branch, the `writeRunState(runDir, patch)` call)
- Modify: `plugin/bin/lib/hooks/post-tool-use.js` (`stampAdHocRunDir`'s `writeRunState` call)
- Modify: `plugin/bin/lib/hooks/context.js` (`stampAdHocRunDirForDenial`'s `writeRunState` call)
- Test: `tests/hooks-dispatcher.test.js`, `tests/hooks-post-tool-use-adhoc-rundir.test.js`, `tests/hooks-denial-run-dir.test.js` (next to each file's existing `#3845` ownerPid test)

**Interfaces:**
- Consumes: `ctxLib.ownerBlock`, `ctxLib.ownerStampPatch`, function-form `writeRunState` (Task 1).
- Produces: `run-state.json.owner` from all three sites. `record-worktree` passes `replacesSessionId: true` only when `CLAUDE_CODE_SESSION_ID` is set (it then also writes `sessionId`); with no session id it writes no owner block. The ad-hoc sites pass `replacesSessionId: false` and `sessionId = ctx.input.session_id`. Each site computes `ownerBlock(...)` before the call (the `ps` spawn stays outside the lock) and passes a function patch `(existing) => ({ ...todaysPatch, ...ownerStampPatch(existing, sessionId, block, opts) })`. `todaysPatch` (including `ownerPidPatch`) is unchanged.

- [ ] **Step 1: Append the failing tests** to the three existing (passing) files listed above — one per site, each asserting all five fields plus `pidSource`:
  - `AC1.1/AC1.2: record-worktree writes the owner block` — `runHook(['record-worktree', '--run', run, '/tmp/wt-1'], { cwd: project, env: { CLAUDE_CODE_SESSION_ID: 'owner', CLAUDE_PID: String(process.pid) } })` → `owner.sessionId === 'owner'`, `owner.host === os.hostname()`, `owner.pid === process.pid`, `owner.pidSource === 'env'`, `typeof owner.pidStartedAt === 'string'` (skip that one assertion on win32, where it is `null`), `!Number.isNaN(Date.parse(owner.heartbeatAt))`. Same call with `CLAUDE_PID` set to a dead pid → `owner.pidStartedAt === null`.
  - `AC2.4: record-worktree without a session id leaves the owner block unchanged` — stamp as `'owner'`, re-stamp with `CLAUDE_CODE_SESSION_ID: ''` → `owner` deep-equals the first.
  - `AC1.1/AC1.2: stampAdHocRunDir writes the owner block` and `AC1.1/AC1.2: stampAdHocRunDirForDenial writes the owner block` — reuse each file's existing `#3845` fixture (`CLAUDE_PID` = `String(process.pid)`, then a dead pid), same assertions, `owner.sessionId` equal to the fixture's `input.session_id`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="owner block" tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-adhoc-rundir.test.js tests/hooks-denial-run-dir.test.js`
Expected: FAIL after Step 1 — `owner` is `undefined` in each new test (append-shaped: the files pass before Step 1).

- [ ] **Step 3: Wire the three sites** per the Interfaces block. Leave the existing different-session guards in the ad-hoc sites as they are.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-adhoc-rundir.test.js tests/hooks-denial-run-dir.test.js tests/hooks-run-attribution.test.js`
Expected: PASS (the `#3845` ownerPid tests and the #3225 `--dispatch` byte-equality test stay green).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js plugin/bin/lib/hooks/post-tool-use.js plugin/bin/lib/hooks/context.js tests/hooks-dispatcher.test.js tests/hooks-post-tool-use-adhoc-rundir.test.js tests/hooks-denial-run-dir.test.js
git commit -m "Stamp the owner block at all three ownership sites, refs #3973"
```

### Task 3: Heartbeat and re-stamp from the owner's own hooks

**Files:**
- Modify: `plugin/bin/lib/hooks/context.js` (new `refreshOwnerBlock`, export)
- Modify: `plugin/bin/hooks.js` (common event path, immediately before `mod.run`)
- Modify: `plugin/bin/lib/hooks/session-start.js` (`run()`, directly after the `restampOwnerPidOnResume` line)
- Test: `tests/hooks-context.test.js`, `tests/hooks-session-start.test.js`, `tests/bin-lib/run-liveness/constants.test.js` (new)

**Interfaces:**
- Consumes: `ownerBlock`'s field set, `resolveOwnerPid`, `pidStartTime`, `HEARTBEAT_THROTTLE_MS` (Task 1); `isPidAlive` (already exported by `context.js`).
- Produces: `refreshOwnerBlock(ctx, { now = Date.now(), env = process.env, deps = {} } = {}) -> 'heartbeat' | 'restamp' | null`. `ctx` is `{ input, ownedRun }`. Never throws (whole body in `try`, returns `null`). Returns `null` with no write unless `isTrustedOwnedRun(ctx.ownedRun)`, the run's `owner` exists, and `owner.sessionId === ctx.input.session_id`. Then, with `cur = resolveOwnerPid(env)`:
  - `cur.pid !== owner.pid`: re-stamp `{ pid, pidSource, pidStartedAt: pidStartTime(cur.pid), host, heartbeatAt: now }` (spread over the existing owner, one write) only when `cur.pid !== null` and the stored owner process is **not** provably alive — provably alive = same host, integer `owner.pid`, `isPidAlive(owner.pid)`, and (`owner.pidStartedAt === null` or `pidStartTime(owner.pid) === owner.pidStartedAt`); a throwing probe counts as alive. Otherwise no write.
  - same pid: write `{ ...owner, heartbeatAt: now }` only when `now - Date.parse(owner.heartbeatAt) >= HEARTBEAT_THROTTLE_MS` or the stored value does not parse.
  - The write uses the function-form `writeRunState` and re-checks inside it that `existing.owner.sessionId` and `existing.owner.pid` still match what was read (else `null`, no write).
- `hooks.js` calls `ctxLib.refreshOwnerBlock({ input, ownedRun })` for every event except `session-start`, inside its own `try {} catch {}`; `session-start.js` calls it itself before any `spawn`.

- [ ] **Step 1: Write the failing tests**

`tests/hooks-context.test.js` (`now` injected; `deps.resolveOwnerPid`, `deps.pidStartTime`, `deps.isPidAlive`, `deps.hostname` injected; run dir with `{ sessionId: 's', owner: { sessionId: 's', host: 'h', pid: 100, pidSource: 'env', pidStartedAt: 'T100', heartbeatAt: T0 } }`, ownedRun `{ dir, attribution: 'session' }`):
- `AC2.1: a second owner event 30 s later leaves heartbeatAt unchanged` — calls at `T0` and `T0 + 30_000` (cur pid 100) → `heartbeatAt === T0` iso.
- `AC2.2: an owner event 61 s after the first advances heartbeatAt` → `heartbeatAt === new Date(T0 + 61_000).toISOString()`, return `'heartbeat'`.
- `AC2.3: a fallback-attributed event never changes the owner block` — `attribution: 'fallback'`, 61 s later → owner unchanged, return `null`.
- `AC2.4: a hook from another session id never changes the owner block` — `input.session_id: 'other'` → unchanged.
- `nested claude -p sharing the session id does not re-stamp or heartbeat` — cur pid 200, owner pid 100 alive with start `'T100'` → unchanged, `null`.
- `AC3.1: a resumed session re-stamps pid and pidStartedAt together` — owner pid 100 dead (`isPidAlive: () => false`), cur pid 200, `pidStartTime(200) === 'T200'` → `owner.pid === 200`, `owner.pidStartedAt === 'T200'`, `owner.pidSource === 'env'`, return `'restamp'`; spy on `fs.renameSync` (the atomic write's final step) to assert exactly one `run-state.json` write. Then `runLiveness(dir, { now, probes: { pidAlive: () => true, pidStartTime: () => 'T200', hostname: () => 'h', lockInUse: () => false, lastCommitAt: () => null, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null }) } })` from Task 5 is `live` with the `owner-pid` entry `positive` — add this assertion in Task 5's suite instead (it consumes Task 5), as `AC3.1 (verdict half)`.
- `a pid-reused owner (alive, different start time) is re-stamped` — owner pid 100 alive, `pidStartTime(100) === 'other'` → re-stamped to cur.
- `a missing CLAUDE_PID never re-stamps` — `resolveOwnerPid → { pid: null }`, owner pid 100 → unchanged.
- `a legacy run (no owner block) is never given one by a heartbeat` → no `owner` key after the call.
- `refreshOwnerBlock never throws` — `deps.resolveOwnerPid` throws → returns `null`.

`tests/hooks-session-start.test.js`:
- `AC3.2/AC3.3: SessionStart re-stamps the owner block before it spawns the reconcile pass` — fixture as `resumeStamp` above plus an owner block (dead stored pid, `CLAUDE_PID` set to `String(process.pid)`), no `reconcile-background-status.json` (so the spawn fires); replace `require('child_process').spawn` with a stub that records `ctxLib.readRunState(run).owner.pid` at call time and returns `{ on() {}, unref() {} }`; restore in `finally`. Assert the stub ran and saw `process.pid`.

`tests/bin-lib/run-liveness/constants.test.js`:
- `the live window is at least ten times the heartbeat throttle` — `LIVE_WINDOW_MS >= 10 * HEARTBEAT_THROTTLE_MS`, and the exact values `60_000`, `600_000`, `259_200_000`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-context.test.js tests/hooks-session-start.test.js tests/bin-lib/run-liveness/constants.test.js`
Expected: FAIL — `ctxLib.refreshOwnerBlock is not a function`; the session-start stub sees the stale pid. The constants test passes already (Task 1) — that is expected.

- [ ] **Step 3: Implement `refreshOwnerBlock` and the two call sites** per the Interfaces block.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-context.test.js tests/hooks-session-start.test.js tests/hooks-dispatcher.test.js tests/hooks-run-attribution.test.js tests/bin-lib/run-liveness/constants.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/context.js plugin/bin/hooks.js plugin/bin/lib/hooks/session-start.js tests/hooks-context.test.js tests/hooks-session-start.test.js tests/bin-lib/run-liveness/constants.test.js
git commit -m "Heartbeat and re-stamp the owner block from the owner's hooks, refs #3973"
```

### Task 4: Default probes behind tagged wrappers

**Files:**
- Create: `plugin/bin/lib/run-liveness/probes.js`
- Modify: `plugin/bin/lib/hooks/resume-freshness.js` (add export `lastCommitMs(worktree) -> number | null`; `checkResumeFreshness` untouched)
- Test: `tests/bin-lib/run-liveness/probes.test.js` (new)

**Interfaces:**
- Produces (`resume-freshness.js`): `lastCommitMs(worktree)` — `runGit(['log', '-1', '--format=%ct'], worktree)`; throws on `failure`; `null` when stdout is empty; throws when the value does not parse.
- Produces (`probes.js`): `DEFAULT_PROBES = { hostname, pidAlive, pidStartTime, lockInUse, lastCommitAt, ownEventAt }` with raw contracts the verdict module wraps: `hostname() -> string` (`os.hostname()`); `pidAlive(pid) -> boolean` (`worktree-reap`'s `isPidAlive`); `pidStartTime(pid) -> string | null` (Task 1); `lockInUse(worktree) -> boolean` — `mainCheckoutRoot`, `runGit(['worktree', 'list', '--porcelain'])`, `parseWorktreeList`, `findWorktreeEntry`, `lockVerdict`; `'in-use'` → `true`, `'free'`/`'orphaned'`/no entry → `false`, `'unknown'` or any lookup failure → throws; `lastCommitAt(worktree) -> number | null` (`lastCommitMs`); `ownEventAt(runDir) -> { lastOwnMs, lastSessionEndMs }` — `lastOwnMs` from `archive-merged.js`'s `ownEventRecency` (lazy `require` inside the function), throws when `readable` is false; `lastSessionEndMs` = newest parseable `ts` among `readEventLines` entries with `type === 'session-end'` and `attribution !== 'fallback'`, `null` when none.

- [ ] **Step 1: Write the failing tests**
  - `lastCommitMs` on a temp git repo with one commit equals `%ct * 1000`; on an empty repo (no commits) is `null`; on a non-repo dir throws.
  - `lockInUse` on a temp repo's linked worktree is `false`; after `git worktree lock --reason "claude (pid <process.pid>)"` it is `true`; on a non-repo path it throws.
  - `ownEventAt` over a fixture `events.jsonl` with an owner `skill_invoked` at `T1`, an owner `session-end` at `T2`, and a `fallback` `session-end` at `T3 > T2` → `{ lastOwnMs: T2, lastSessionEndMs: T2 }` (the fallback line counts for neither); a run dir with no `events.jsonl` throws; an empty `events.jsonl` → `{ lastOwnMs: null, lastSessionEndMs: null }`.
  - `DEFAULT_PROBES` has exactly the six keys.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/run-liveness/probes.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/run-liveness/probes'`

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/probes.test.js tests/hooks-resume-freshness.test.js`
Expected: PASS (`checkResumeFreshness`'s own suite stays green — the function is untouched).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-liveness/probes.js plugin/bin/lib/hooks/resume-freshness.js tests/bin-lib/run-liveness/probes.test.js
git commit -m "Add run-liveness default probes over the existing lock, commit and event readers, refs #3973"
```

### Task 5: `runLiveness` — evidence, precedence, verdict

**Files:**
- Create: `plugin/bin/lib/run-liveness/index.js`
- Test: `tests/bin-lib/run-liveness/index.test.js` (new; the spec's `tests/run-liveness.test.js`, placed under the repo's `tests/bin-lib/{module}/` convention)

**Interfaces:**
- Consumes: `DEFAULT_PROBES` (Task 4), constants (Task 1), `ctxLib.readRunState`.
- Produces: `PROBE_ORDER = ['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit', 'owner-events']`; `gatherEvidence(runDir, { now, probes }) -> { evidence, witnesses }`; `decideVerdict({ evidence, witnesses }) -> 'live' | 'dead' | 'unknown'`; `runLiveness(runDir, { now = Date.now(), probes = {} } = {}) -> { verdict, evidence }` where `evidence` is `[{ probe, result: 'positive' | 'negative' | 'error', detail }]`, one per `PROBE_ORDER` entry, always all five, in order. Injected `probes` are merged over `DEFAULT_PROBES`. Any probe that throws produces an `error` entry with the message as `detail`. `runLiveness` never throws; an unreadable `run-state.json` reads as `{}` (legacy).
- Per-probe rules (state = run-state, `owner = state.owner`):
  - `owner-pid`: no owner → negative `no-owner-block`; `owner.host !== hostname()` → negative `other-host`; `owner.pid` not a positive integer → negative `no-pid`; not alive → negative `gone` (**pid witness**); alive and `owner.pidStartedAt` null → negative `alive-no-start-time`; `pidStartTime(pid)` null → error `start-time-unavailable`; equal → positive `alive`; different → negative `pid-reused` (**pid witness**).
  - `heartbeat`: no owner → negative `no-owner-block`; unparseable → error; `now - t < LIVE_WINDOW_MS` → positive; else negative `stale`.
  - `worktree-lock` / `last-commit`: no string `state.worktree` or path not on disk → negative `no-worktree`; lock `true` → positive; last commit `null` → negative `no-commits`; `now - ms < LIVE_WINDOW_MS` → positive; else negative `age:{ms}`.
  - `owner-events`: `lastOwnMs ?? runIdMs(runDir)` where `runIdMs` parses the basename's `YYYY-MM-DDTHHMMSS` prefix as UTC (null → error `no-reference-time`); age `< LEGACY_DEAD_MS` → positive `recent`, else negative `silent`. This probe is not a live probe.
  - Witnesses: **pid** as marked above; **session-end** — owner present, `owner-pid` detail is `alive-no-start-time` or `no-pid`, `state.status === 'interrupted'`, `state.lastEvent === 'session-end'`, `lastSessionEndMs !== null`, `Date.parse(owner.heartbeatAt) < lastSessionEndMs`; **legacy** — no owner, `worktree-lock` negative, `last-commit` detail `no-worktree`/`no-commits` or age `>= LEGACY_DEAD_MS`, `owner-events` negative.
  - `decideVerdict`: any positive among the four live probes → `live`; else any `error` → `unknown`; else any witness → `dead`; else `unknown`.

- [ ] **Step 1: Write the failing tests** — a `fixture({ state, runId, probes })` helper writing `run-state.json` (and an empty `events.jsonl`) into a temp `.claude-tweaks/pipelines/{runId}/`, with a base probe set where every live probe is a clean negative (`pidAlive: () => false` unless overridden, `lockInUse: () => false`, `lastCommitAt: () => null`, `ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null })`, `hostname: () => 'h'`). One test per row:
  - `AC4.1` alive + matching start → `live`. `AC4.2` pid gone, rest clean → `dead`. `AC4.3` alive, different start → `owner-pid` not positive, verdict `dead`.
  - `AC5.1` heartbeat at `now - 9 min` alone → `live`; in-use lock alone → `live`; last commit at `now - 9 min` alone → `live` (three tests, each with the pid gone).
  - `AC6.1` alive pid, `pidStartedAt: null`, `status: 'interrupted'`, `lastEvent: 'session-end'`, heartbeat before `lastSessionEndMs` → `dead`. `AC6.2` heartbeat after it and `now - 5 min` → `live`; after it but `now - 20 min` → `unknown`. `AC6.3` no owner block, same status shape, run id 1 h old → `unknown`. `AC6.4` alive + matching start with `status: 'interrupted'` → `live`.
  - `AC7.1` legacy, `lastOwnMs` `now - 73 h`, commit `now - 73 h`, no lock → `dead`; `AC7.2` `lastOwnMs` `now - 71 h` → `unknown`.
  - `AC8.1` for each of `hostname`, `pidAlive`, `pidStartTime`, `lockInUse`, `lastCommitAt`, `ownEventAt`: a throwing probe (in a fixture where that probe is reached and every other evidence would yield `dead`) → `unknown` with that probe's entry `error`. `AC8.2` `owner.host: 'elsewhere'` → `unknown`; alive pid with `pidStartedAt: null` and `status: 'active'` → `unknown`.
  - `AC9.1` fail-open variant: `const failOpen = (g) => g.evidence.some((e) => e.result === 'error') ? 'dead' : decideVerdict(g)`; the AC8.1 assertions are written as `assertProbeErrorsYieldUnknown(decide)`; the suite calls it with `decideVerdict` (passes) and asserts `assert.throws(() => assertProbeErrorsYieldUnknown(failOpen))`.
  - `AC11.1/AC11.2` a run-state with no `owner` key → `readRunState`, `isDeadRunDir` and `checkResumeFreshness` return without throwing, and `runLiveness`'s `owner-pid`/`heartbeat` details are `no-owner-block`; a corrupt `run-state.json` → same legacy details, no throw.
  - `AC12.1/AC12.2` every verdict above has `evidence.map((e) => e.probe)` deep-equal to `PROBE_ORDER`; a throwing `lockInUse` gives `{ probe: 'worktree-lock', result: 'error' }`, not `negative`, and `unknown`.
  - `AC13.1` heartbeat positive + throwing `lockInUse` → `live`. `AC13.2` pid gone + throwing `lastCommitAt` (worktree on disk) → `unknown`. `AC13.3` both evidence lists in `PROBE_ORDER`.
  - `AC14.1` no `worktree` in state → lock and commit `negative`/`no-worktree`. `AC14.2` legacy, `ownEventAt` `lastOwnMs: null`, run id 73 h before `now` → `dead`; 71 h → `unknown`.
  - `AC15.2` owner with `pid: null`, `pidSource: null`, rest clean, `status: 'active'` → `owner-pid` `no-pid`, verdict `unknown`.
  - `AC3.1 (verdict half)` the re-stamped state from Task 3's resume test shape (owner pid = `process.pid`, start = `pidStartTime(process.pid)`, real `pidAlive`/`pidStartTime`) → `live`, `owner-pid` `positive` (skip on win32).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/run-liveness/index.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/run-liveness'`

- [ ] **Step 3: Implement `index.js`** per the Interfaces block.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/run-liveness/`
Expected: PASS

- [ ] **Step 5: Real-input probe.** Run `runLiveness` with default probes against this run's own dir (`/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-24T061105-record-3973`, which carries an owner block from Task 2's `record-worktree` re-stamp once the plugin build includes it — until then it is legacy) and one archived run dir under `.claude-tweaks/pipelines/archive/`; print the JSON. Expected: the live run reads `live` (lock or commit or pid positive); the archived run reads `unknown` or `dead`, never `live` unless its process is genuinely alive. Independently confirm each entry: `git -C {worktree} log -1 --format=%ct`, `git worktree list --porcelain | grep -A3 {worktree}`, and `jq -r 'select(.attribution != "fallback") | .ts' events.jsonl | sort | tail -1`. Paste both outputs into the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/run-liveness/index.js tests/bin-lib/run-liveness/index.test.js
git commit -m "Add runLiveness — live/dead/unknown verdict from positive evidence, refs #3973"
```

### Task 6: Document the owner block

**Files:**
- Modify: `docs/hooks.md` (the run-state field list in the "Run-dir state files written by hooks" bullet — one clause naming `owner`; the `## Ownership` section — one new paragraph)

- [ ] **Step 1: Write the paragraph.** It names: the six fields including `pidSource` (`env` = `CLAUDE_PID`, `ancestry` = nearest `claude` ancestor, `null` when neither); the writers (`record-worktree` — only with `CLAUDE_CODE_SESSION_ID`, which also adopts — and both ad-hoc mints); that a stamp never replaces another session's block except on that adoption; the heartbeat (owner-attributed hooks only, never `fallback`, at most once per `HEARTBEAT_THROTTLE_MS`, from the dispatcher's common path and SessionStart before its reconcile spawn) and the re-stamp guard (only when the stored process is not provably alive); `ownerPid` unchanged beside it; a missing block means legacy, never an error; `runLiveness`'s precedence (positive live probe → `live`; else any error → `unknown`; else a death witness → `dead`; else `unknown`) and the legacy rule (72 h of no owner event, no in-use lock, no commit for 72 h; the SessionEnd route needs an owner block); and that no caller consumes the verdict yet (#3977, #3979).

- [ ] **Step 2: Verify the docs** — `AC16.1`: `grep -n "pidSource" docs/hooks.md` and `grep -n "legacy" docs/hooks.md` each print a line in the Ownership section, then:

Run: `node --test tests/dispatch-config-gate-conformance.test.js tests/inform-tier-relay-realpath-conformance.test.js tests/dispatch-sequential-execution-conformance.test.js tests/timing-prose-conformance.test.js`
Expected: PASS (the suites that read `docs/hooks.md`; documentation task, no failing test first).

- [ ] **Step 3: Commit**

```bash
git add docs/hooks.md
git commit -m "Document the run-state owner block and runLiveness precedence, refs #3973"
```

Waived AC9.2: the fail-open evidence goes into the PR body at the build phase exit (command output from Task 5's run), not a test.
Waived AC10.1: the CLAUDE_PID premise and raw probe output go into the PR body at the build phase exit; the code's `pidSource` values are pinned by Task 1's AC15.1 test.
