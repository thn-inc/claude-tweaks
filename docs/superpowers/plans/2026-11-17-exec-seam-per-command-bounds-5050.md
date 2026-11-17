# Exec-Seam Per-Command Bounds (#5050) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every child process spawned by the four generic exec seams carries the bound for its own command — `gh` the batched bound, `git` the git bound, `node` a fixed 30000 — instead of one fixed `timeout: 30000`.

**Architecture:** One shared function in `plugin/bin/lib/shared-primitives.js` maps a command name to its bound by reading the existing memoized getters at spawn time. Each of the four seams keeps its single options object (for `maxBuffer`/`windowsHide`) and overrides `timeout` per spawn from that function. Tests drive each seam's real default runner through a probe helper that stubs `child_process` and evicts the module cache, so a seam that stops calling the function turns its own test red.

**Tech Stack:** Node 18+ CommonJS, `node --test` via `tools/run-tests.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153423-spec-4856-5050/spec-5050/work/5050-spec.md` (record #5050)

Scope keywords: `timeout: 30000`, `EXEC_OPTS`, `GH_BATCH_TIMEOUT_MS`, `GIT_TIMEOUT_MS`, `execBounded`

## Global Constraints

- `gh` spawns take `GH_BATCH_TIMEOUT_MS` (`max(30000, resolved gh-timeout-ms)`); `git` spawns take `GIT_TIMEOUT_MS` (default 30000, env `CLAUDE_TWEAKS_GIT_TIMEOUT_MS` up to 120000); `node` spawns stay at a fixed `30000`. No new policy key, no `GH_TIMEOUT_MS` (its 5000 default would lower the bound).
- Read the getters at spawn time, never destructured at module load (they are memoized once per process).
- With every key at its default no spawn carries a different timeout than before.
- `PROBE_TIMEOUT_MS = 60000` stays unchanged.
- Commits: `{Verb} {what} — {detail}`; stage specific files by path only; never `git stash`; run tests with `node tools/run-tests.js <files>` (never bare `node --test`).
- Deviation from the record's Key Files (shared-primitives "read only"): one small shared function is added there instead of four copies of the same three-line command-to-bound map. Classify as Beneficial at Common Step 4.5.

## Review Focus

- `CLAUDE_TWEAKS_GH_TIMEOUT_MS` outside `gh-timeout-ms`'s bounds (65000, 500): ignored, `gh` spawns carry 30000 — pinned in Task 1.
- `CLAUDE_TWEAKS_GIT_TIMEOUT_MS=200000` (above the 120000 max): ignored, `git` carries 30000 — pinned in Task 1.
- `wrap-up/pack.js`'s `ghOptions` wrap must not drop or reset `timeout` on the gh spawn — pinned in Task 5.
- A `node` spawn killed at the fixed bound reads `timeout after 30000ms: node …` even with both keys raised — pinned in Task 5.
- `release-preflight/pack.js`'s synchronous `git` runner picks `GIT_TIMEOUT_MS` while its async runner picks per command — pinned in Task 4.

---

### Task 1: Shared per-command bound and probe helper

**Files:**
- Modify: `plugin/bin/lib/shared-primitives.js` (export next to `ghTimeoutMsAt`)
- Modify: `tests/helpers/gh-timeout-probe.js` (add `captureExecTimeouts`, keep `captureGhTimeout` unchanged)
- Test: `tests/bin-lib/shared-primitives.test.js`

**Interfaces:**
- Produces: `execTimeoutMsFor(cmd: string): number` from `shared-primitives.js` — `'gh'` → `GH_BATCH_TIMEOUT_MS`, `'git'` → `GIT_TIMEOUT_MS`, anything else → `30000`. Reads the getters on every call.
- Produces: `captureExecTimeouts({ env, modulePaths, reply = '{}', exercise }): { gh, git, node }` from `tests/helpers/gh-timeout-probe.js` — `env` is `{ ENV_NAME: value }` applied via the `setEnv()` callback handed to `exercise` (so the caller chooses before/after module load); stubs both `child_process.execFileSync` and `child_process.execFile` (the latter carrying `util.promisify.custom` that resolves `{ stdout: reply, stderr: '' }`) and records the `timeout` last seen per command name (`null` when that command was never spawned); evicts `modulePaths` and `shared-primitives` from the require cache before and after; restores the stubs and every env var it set.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/shared-primitives.test.js`: `execTimeoutMsFor` with a fresh `shared-primitives` load (evict, set env, require, restore) — gh env 45000 → `gh` 45000, `git` 30000, `node` 30000; gh env 10000 → `gh` 30000; gh env 65000 and 500 → `gh` 30000; git env 90000 → `git` 90000; git env 200000 → `git` 30000; both set high → `node` 30000; unset → 30000/30000/30000. Add one test for `captureExecTimeouts` itself: a `exercise` that calls `execFileSync('gh', …)` and `execFileSync('git', …)` yields `{ gh: <timeout>, git: <timeout>, node: null }` and leaves `process.env` and `child_process` as it found them.
- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/shared-primitives.test.js`
Expected: FAIL with `execTimeoutMsFor is not a function` / `captureExecTimeouts is not a function`.

- [ ] **Step 3: Implement** `execTimeoutMsFor` in `plugin/bin/lib/shared-primitives.js` (module-level `const DEFAULT_EXEC_TIMEOUT_MS = 30000`; read `module.exports.GH_BATCH_TIMEOUT_MS` / `module.exports.GIT_TIMEOUT_MS` inside the function body) with a short comment citing #5050, and `captureExecTimeouts` in the probe helper reusing the existing `evict` shape.
- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/shared-primitives.js tests/helpers/gh-timeout-probe.js tests/bin-lib/shared-primitives.test.js
git commit -m "Add execTimeoutMsFor and a per-command timeout probe — one command-to-bound map for the four exec seams (#5050)"
```

### Task 2: `console-resolve.js` per-command bound

**Files:**
- Modify: `plugin/bin/console-resolve.js` (`defaultExecFile`, ~line 254)
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Consumes: `execTimeoutMsFor`, `captureExecTimeouts` (Task 1).

- [ ] **Step 1: Write the failing tests** (new `describe` block, "default exec bound (#5050)"): through `captureExecTimeouts` with `modulePaths: [require.resolve('../../../plugin/bin/console-resolve')]`, drive the real default runner (the `deps.execFile || defaultExecFile` path via `run`, with an argv/shape that reaches one `gh` and one `git` spawn; if no shape reaches both without a record, export `defaultExecFile` and call it directly for each command — say so in the commit). Assertions: gh env 45000 → `gh` 45000; gh env unset and 10000 → `gh` 30000; git env 90000 → `git` 90000; git unset → `git` 30000. One test per assertion group, titled so a failure names the seam.
- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/console/resolve.test.js`
Expected: FAIL — the 45000 and 90000 cases see `30000`.

- [ ] **Step 3: Implement** — in `defaultExecFile`, replace the literal `timeout: 30000` with `timeout: execTimeoutMsFor(cmd)`; caller `opts` still spread after it so an explicit `opts.timeout` keeps winning. Import `execTimeoutMsFor` from `./lib/shared-primitives`.
- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Prove discrimination** — temporarily restore the literal `timeout: 30000`, rerun, confirm the new tests are red, then restore the change (do not commit the revert).
- [ ] **Step 6: Commit**

```bash
git add plugin/bin/console-resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "Route console-resolve's exec bound by command — gh and git follow their policy keys (#5050)"
```

### Task 3: `flow/preflight.js` per-command bound

**Files:**
- Modify: `plugin/bin/lib/flow/preflight.js` (`EXEC_OPTS` line 30; `defaultDeps` `execFile`/`execFileAsync`, lines 70-71)
- Test: `tests/bin-lib/flow/preflight.test.js`

**Interfaces:**
- Consumes: `execTimeoutMsFor`, `captureExecTimeouts` (Task 1).

- [ ] **Step 1: Write the failing tests** (block "default exec bounds (#5050)"): through `captureExecTimeouts` with the module evicted, call `defaultDeps(cwd).execFile` (sync) and `.execFileAsync` (async) for `'gh'` and `'node'` and assert: gh env 45000 → both runners' `gh` 45000; gh env unset/10000 → 30000; both keys set high → `node` 30000 on both runners.
- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/flow/preflight.test.js`
Expected: FAIL — `gh` sees `30000` at env 45000.

- [ ] **Step 3: Implement** — `EXEC_OPTS` keeps `maxBuffer` only (drop its fixed `timeout`); both runners set `timeout: execTimeoutMsFor(cmd)` after `...EXEC_OPTS` and before `...opts`.
- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Prove discrimination** — restore the literal temporarily, confirm red, restore the change.
- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/flow/preflight.js tests/bin-lib/flow/preflight.test.js
git commit -m "Route flow preflight's exec bound by command — gh follows gh-timeout-ms, node stays 30 s (#5050)"
```

### Task 4: `release-preflight/pack.js` per-command bound

**Files:**
- Modify: `plugin/bin/lib/release-preflight/pack.js` (`EXEC_OPTS` line 24; `defaultDeps` `git` line 113 and `execFileAsync` line 114)
- Test: `tests/bin-lib/release-preflight/pack.test.js`

**Interfaces:**
- Consumes: `execTimeoutMsFor`, `captureExecTimeouts` (Task 1).

- [ ] **Step 1: Write the failing tests** (block "default exec bounds (#5050)"): through `captureExecTimeouts`, call `defaultDeps(cwd).git([...])` and `.execFileAsync('gh', […])`: git env 90000 → `git` 90000, unset → 30000; gh env 45000 → `gh` 45000, unset and 10000 → 30000; both high leaves nothing else changed (no `node` spawn here, assert `node` is `null`).
- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/release-preflight/pack.test.js`
Expected: FAIL — 90000/45000 cases see `30000`.

- [ ] **Step 3: Implement** — `EXEC_OPTS` keeps `maxBuffer`; the sync `git` runner sets `timeout: execTimeoutMsFor('git')`; `execFileAsync` sets `timeout: execTimeoutMsFor(cmd)` before `...opts`.
- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Prove discrimination** — restore the literal temporarily, confirm red, restore.
- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/release-preflight/pack.js tests/bin-lib/release-preflight/pack.test.js
git commit -m "Route release preflight's exec bound by command — gh and git follow their policy keys (#5050)"
```

### Task 5: `wrap-up/pack.js` per-command bound and timeout message

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (comment above `EXEC_OPTS` line 33-37; `EXEC_OPTS` line 38; `execBounded` lines 49-59; the direct `pr-checks.js` spawn ~line 795)
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:**
- Consumes: `execTimeoutMsFor`, `captureExecTimeouts` (Task 1).

- [ ] **Step 1: Write the failing tests** (block "exec bounds (#5050)"): (a) through `gatherPack` with a recording fake `deps.execFile`, the `gh` spawn carries `timeout` 45000 under gh env 45000, 30000 unset/10000 (module evicted per probe via `captureExecTimeouts`' evict, or a fresh require); every `node` spawn — including the direct `pr-checks.js` one — carries 30000 with both keys at 45000/90000. (b) a fake `deps.execFile` that rejects a `gh` call with `{ killed: true, signal: 'SIGTERM' }` under gh env 45000 makes the probe's thrown message read `timeout after 45000ms: gh …`; the same for a `node` kill under both keys high reads `timeout after 30000ms: node …`.
- [ ] **Step 2: Run to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL — `gh` sees 30000 and the message names 30000.

- [ ] **Step 3: Implement** — `EXEC_OPTS` keeps `maxBuffer` and `windowsHide`; `execBounded` computes `const timeout = execTimeoutMsFor(cmd)`, passes `{ cwd, ...EXEC_OPTS, timeout }` to `wrap`, and the thrown message uses that `timeout`; the direct `pr-checks.js` spawn passes `timeout: execTimeoutMsFor('node')`. Reword the comment above `EXEC_OPTS` to describe the per-command bound. Confirm `ghOptions` does not overwrite `timeout`.
- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.
- [ ] **Step 5: Prove discrimination** — restore the literal `EXEC_OPTS.timeout` use temporarily, confirm red, restore.
- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/wrap-up/pack.js tests/bin-lib/wrap-up/pack.test.js
git commit -m "Route wrap-up pack's exec bound by command — the timeout message names the bound the killed call carried (#5050)"
```

### Task 6: Summaries and journey

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`gh-timeout-ms` row ~line 171, `git-timeout-ms` row ~line 182)
- Modify: `docs/journeys/resolve-a-policy-key.md` (the `GH_BATCH_TIMEOUT_MS` consumer sentence in step 2 and a new `Step 2 updated during build of #5050` line beside the #4815 one)
- Modify (if they restate the consumer lists): `plugin/skills/_shared/policy-schema.md`, `docs/plugin-structure.md`
- Test: `tests/policy-schema.test.js` only if it pins either summary

**Interfaces:**
- Consumes: the finished seam changes (Tasks 2-5).

- [ ] **Step 1: Find pins and restatements** — `git grep -n "gh-timeout-ms\|git-timeout-ms\|GH_BATCH_TIMEOUT_MS"` over `tests/`, `docs/`, `plugin/skills/_shared/` and read every hit that describes a consumer list; update each (never leave a stale list).
- [ ] **Step 2: Write the failing assertion** only where a test already pins summary text: extend it to expect the new wording; otherwise skip this step and say so in the commit.
- [ ] **Step 3: Edit** — `gh-timeout-ms` summary: still bounds one `gh` call, and also reaches console-resolve, flow preflight, release preflight and the wrap-up pack's `gh` reads through the batched bound; `git-timeout-ms` summary: names the claims-registry, pr-checks, compose-subject runners plus console-resolve and release-preflight's `git` calls. Journey: name the four seams as `GH_BATCH_TIMEOUT_MS` consumers (and `console-resolve`/`release-preflight` as `GIT_TIMEOUT_MS` consumers), and note `node` spawns keep 30000.
- [ ] **Step 4: Run to verify** — `node tools/run-tests.js tests/policy-schema.test.js tests/resolve-policy-cli.test.js`; Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js docs/journeys/resolve-a-policy-key.md
git commit -m "Name the four exec seams as gh-timeout-ms and git-timeout-ms consumers — summaries and the policy-key journey (#5050)"
```

(Stage any further file Step 1 changed by its own path.)
