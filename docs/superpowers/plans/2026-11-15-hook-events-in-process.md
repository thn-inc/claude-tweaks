# Hook Events In-Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hook event modules read the environment, cwd, home directory and spawn function from the context `hooks.js` hands them, so six test files call hook events in-process instead of starting about 240 `hooks.js` processes.

**Architecture:** The event tail of `plugin/bin/hooks.js` builds one context object from `deps` and every event module reads only that. Helpers reached from an event take `env` as an option. Tests reach events through one shared helper that wraps `runCli` and fails a call whose `plugin/bin` code reads `process.env`.

**Tech Stack:** Node 18+ (CI runs Node 20), `node --test`, `tests/helpers/run-cli.js`, `tools/run-tests.js`, `tools/count-node-procs.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T204710-spec-5377/work/5377-spec.md`

**Scope keywords:** spawnBackgroundIfStale, refreshOwnerBlock, ownerPidPatch, repoPinnedEnv

## Global Constraints

- No gate changes what it allows or denies. Every allow/deny assertion in the converted files passes with its assertion text unchanged; only `async`/`await` and the helper change.
- Context shape, built only by the event tail: `{ input, runDir, runState, ownedRun, cwd, env, homeDir, spawn }`. `env` is `deps.env`, `homeDir` is `deps.homeDir`, `spawn` is `deps.spawn`.
- A missing `env` is a programming error: `ctxLib.requireEnv(ctx)` throws `TypeError`. No event module, and no function only events call, falls back to `process.env`.
- A helper that callers outside this plan also use keeps its `env = process.env` default (the contract's "a library function on the CLI's path takes that `env` as an option whose default is the inherited environment"); every call from an event module passes `env` explicitly.
- The session id comes off the hook payload (`input.session_id`), never the environment (comment at `plugin/bin/hooks.js:2228`).
- `CT_HOOKS_GIT_TIMEOUT_MS` (`plugin/bin/lib/hooks/git-exec.js:45`) stays a read of the real `process.env`: it is the contract's named process-wide timeout knob.
- The event JSON keeps its synchronous real writer (`realDeps.stdoutSync`, `fs.writeSync(1, …)`).
- Run calls one at a time: no `Promise.all`, no concurrent subtests around `runCli`.
- A test stays on a real process only when the process is its subject. It uses `spawnCli`, carries a one-line comment naming the process property it proves, and counts toward the ceiling of 20 `hooks.js` processes across the six converted files.
- Smoke tests are exactly three, in `tests/hooks-dispatcher.test.js`: one `pre-tool-use` deny, one `pre-tool-use` allow, one `session-end`.
- Prove git-facing tests under the runner: `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`.
- Commits: `{Verb} {what} — {detail} (refs #5377)`, ending with the trailer line `Claude-Session: https://claude.ai/code/session_01Ngy9oYYiQj5QuEdEVENpop`. Stage files by explicit path.
- Every `plugin/bin/lib` file changed to pass an injected value is named in the task report, with the test that went red when that one thread-through was reverted.

Rules quoted from the project skills that govern these files:

- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md:4` — "Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`."
- same — "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- same — "The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes."
- same — "Module-level state under `plugin/bin` (the forge probe's memos, for example) survives between in-process calls in one test file; a case that depends on it passes `fresh: true`, which clears `require.cache` under `plugin/bin` first."
- same — "The helper fails closed: after merging `realDeps` with the test's fakes, it replaces a key named in `FAIL_CLOSED_KEYS` (`runner`, `gh`, `ghAvailable`, `runHook`, `spawn`, `runSuite`) that still holds the CLI's real value with a function that throws, and records the reach so a CLI that catches the throw still fails the test; `allowRealRunner: true` lifts it for one call."
- `cli-wrapper-contract.md:6` — "Delete the same four from the env a converted test hands the CLI whenever it merges `process.env` and its assertion depends on which repository git finds, or on there being none: a git hook's `GIT_DIR` otherwise reaches the CLI's own git children" (the four: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`).
- `cli-wrapper-contract.md:63` — "A mutation probe of a CLI that writes outside its `cwd` runs contained, or not at all." Run a revert-proof mutant in a `git archive` extract with `HOME`/`USERPROFILE` pointed at a decoy directory, never in this linked worktree.
- `.claude/skills/gh-api-module-pattern/SKILL.md:13` — "Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see."
- `.claude/skills/hooks-js-verb-registration/SKILL.md:25` — "`runCli`'s `env` is the whole environment the verb sees, so build it through a `hookEnv` helper that spreads `cleanGitEnv()` and blanks `PIPELINE_RUN_DIR` (#1130) under the test's own keys, as `tests/hooks-ledger-row.test.js` and `tests/archive-run-verb.test.js` do (#5375)."
- `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md:28` — "A fix to how either run resolves is proven only by a regression test that fires the very gate whose write misattributed — `tests/hooks-run-attribution.test.js`'s \"#3515 incident e2e\" case spawns `hooks.js pre-tool-use` on a real `Write` — not by a `resolveRun` unit case alone." That case stays on `spawnCli`.
- `.claude/skills/windows-checkout-test-parity/SKILL.md:189` — "Reading `env.PATH` from a `{ ...process.env }` copy, or asserting `copy.PATH === process.env.PATH` | win32's `process.env` is a case-insensitive proxy whose stored key is `Path`. A spread copy is a plain object that keeps the stored name, so `copy.PATH` is `undefined` on Windows only while `process.env.PATH` still answers."
- `SKILL.md:158` — "Set both keys to the fixture home … `tests/helpers/fixture-home.js`'s shared `fixtureHomeEnv` does both — require it rather than re-implementing it".
- `.claude/skills/bin-source-scan-conformance/SKILL.md:125` — "Build the list's go-red self-tests from inline fixtures and match the failure message; never borrow a file that is on the list, because the record that converts it turns the self-test red."
- `.claude/skills/git-ground-truth-test-env/SKILL.md:17` — "A reader call in a test passes an explicit env. Build it from `process.env` minus the variables the reader keys on."

Source-scan suites to run after any `plugin/bin` edit: `tests/windows-hide-spawn-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`, `tests/path-containment-conformance.test.js`, `tests/bin-lib/reconcile/subprocess-timing-conformance.test.js`, `tests/bin-lib/cli-entry-conformance.test.js`. After any `pre-tool-use.js` edit also: `tests/hooks-gate-coverage.test.js`, `tests/guard-refusals/shapes.test.js`, `tests/hooks-bookkeeping-stamps-gate.test.js`, `tests/bin-lib/path-guard/pre-tool-use-identity.test.js`.

Files this plan reads and never edits: `tests/bin-lib/hooks/reconcile-background.test.js` and `tests/hooks-bash-prefilter.test.js` (spec Non-Goals), `tests/helpers/run-cli.js`, `tools/count-node-procs.js`.

Waived .claude/skills/pre-tool-use-gate-exemptions: read in full by the Task 3 implementer before Step 1; its SKILL.md is edited in Task 8.

Criteria covered outside a test step:

| Criterion | Covered by |
|---|---|
| AC10.1 | Task 9 Steps 2 and 3: the back-to-back measurement and the PR-body section listing every real-process test with its reason |
| AC7.2 | Task 8 Step 4: the conformance file passes |

## Review Focus

- A direct `run(ctx)` call with no `env` must throw, never allow silently: Task 2 test `requireEnv throws on a context without env`, and one per event in Tasks 3 to 5.
- An injected `env` with no `PATH` and no `HOME` must still end in an integer exit code, not a rejection: Task 3 test `pre-tool-use with an empty env resolves to an exit code`.
- An in-process `session-start` with a stale background status and no spawn fake must fail the test, not start a detached process: Task 5 test `session-start without a spawn fake rejects`.
- An event module that throws rejects in-process, while the script entry still exits 0: Task 6 keeps the script-entry half on `spawnCli` only if an existing test asserts it; otherwise the in-process test asserts the rejection.
- A hook payload without `cwd` uses the injected `cwd`, not the test runner's: one test per converted file (AC9), Tasks 6 and 7.

---

### Task 1: Test helpers, the event context, and the pinned smoke tests

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/helpers/env-tripwire.js`
- Create: `tests/helpers/hook-event.js`
- Create: `tests/helpers-hook-event.test.js`
- Modify: `plugin/bin/hooks.js:2240-2250` (event tail)
- Modify: `plugin/bin/hooks.js:2287-2294` (`realDeps`)
- Modify: `plugin/bin/hooks.js:1878` (reconcile verb's `spawnBackgroundIfStale` call)
- Modify: `tests/hooks-dispatcher.test.js` (append three smoke tests)
- Test: `tests/helpers-run-cli.test.js`
- Test: `tests/hooks-help-guard.test.js`
- Test: `tests/hooks-js-flag-strict.test.js`
- Test: `tests/reconcile-dispatch.test.js`

**Interfaces:**
- Produces: `withEnvTripwire(fn) -> Promise<{ value, reads: Array<{ key: string, frame: string }> }>` in `tests/helpers/env-tripwire.js`. While `fn` runs, `process.env` is a `Proxy` over the real object; a `get`, `has`, `getOwnPropertyDescriptor` or `ownKeys` (key `'*'`) trap records the read only when `new Error().stack` holds a frame under `plugin/bin/` (match with `path.sep`), and `frame` is that first frame. `process.env` is the original object again afterwards, also when `fn` throws.
- Produces: `runHookCli(args, { input, cwd, env, deps, fresh, tripwire }) -> Promise<{ code, stdout, stderr }>` in `tests/helpers/hook-event.js`. `cwd` and `env` are required (throw `TypeError` without them). It calls `runCli(HOOKS, args, { cwd, env, stdin: input, fresh, deps: { stdoutSync, ...deps } })`, where its `stdoutSync` fake appends to the same `stdout` string `deps.stdout` writes land in (wrap both so write order is kept). When `args[0]` is not a key of `require(HOOKS).VERBS` and `tripwire !== false`, the call runs inside `withEnvTripwire` and rejects with `Error('hook event read process.env: ' + list of key@frame)` when `reads` minus `TRIPWIRE_ALLOWED` is non-empty. `TRIPWIRE_ALLOWED` is an exported object `{ CT_HOOKS_GIT_TIMEOUT_MS: 'process-wide timeout knob, cli-wrapper-contract.md', NODE_V8_COVERAGE: 'read by node:child_process itself on every spawn, with or without an env option' }`; a later task adds a key only with a reason and names it in its report.
- Probed while planning (scratch script, Node 26.13.1 and Node 20.20.2, darwin): `process.env` can be replaced by a `Proxy` and restored; a write through the proxy reaches the real object; `spawnSync` with an explicit `env` reads only `NODE_V8_COVERAGE`; `spawnSync` with no `env` reads `'*'` (ownKeys) on Node 20 and nothing on Node 26, so a child that inherits the environment is caught on Node 20 only. Run every tripwire test under `npx -y node@20 --test <file>` as well as the local Node before calling a task green; CI runs Node 20.
- Produces: `hookEnv(overrides) -> object` in `tests/helpers/hook-event.js`: `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...overrides }`, using the `cleanGitEnv` the `hookEnv` helper in `tests/hooks-ledger-row.test.js` uses.
- Produces: the event tail calls `mod.run({ input, runDir, runState, ownedRun, cwd, env: deps.env, homeDir: deps.homeDir, spawn: deps.spawn })` and `ctxLib.refreshOwnerBlock({ input, ownedRun }, { env: deps.env })`.
- Produces: `realDeps.homeDir = () => os.homedir()` and `realDeps.spawn = (file, args, options) => require('child_process').spawn(file, args, options)` (looked up at call time).

- [ ] **Step 1: Write the failing tests** in `tests/helpers-hook-event.test.js`:
  - `withEnvTripwire records a read made from plugin/bin and none made from the test`: inside `fn`, call `require('../plugin/bin/lib/plugin-version').resolvePluginVersion()` (it defaults to `process.env`) and read `process.env.PATH` directly; assert `reads` is non-empty, every `frame` contains `plugin` + `path.sep` + `bin`, and `process.env` is strictly the original object afterwards.
  - `withEnvTripwire restores process.env when fn throws`.
  - `AC9.1: the event tail hands env, cwd, homeDir and spawn to the event module`: replace `require('../plugin/bin/lib/hooks/session-end').run` with a recorder (restore in `finally`), call `runHookCli(['session-end'], { input: '{}', cwd: sandbox, env: hookEnv({ CT_5377_SENTINEL: 'x' }), deps: { spawn: fakeSpawn } })`, assert `seen.env.CT_5377_SENTINEL === 'x'`, `seen.cwd === sandbox`, `seen.spawn === fakeSpawn`, `typeof seen.homeDir === 'function'`.
  - `runHookCli returns the event JSON in stdout`: the recorder returns `{ json: { ok: 1 } }`; assert `stdout === '{"ok":1}'` and nothing reached the real fd 1 (the test replaces `fs.writeSync` for the call and asserts no call with fd `1`).
  - `runHookCli rejects when an event reads process.env`: the recorder reads `process.env.HOME` from inside a function defined in a `plugin/bin` module (reuse `resolvePluginVersion()` with no argument); assert the rejection message names the key.
  - `runHookCli leaves a verb call outside the tripwire`: `runHookCli(['resolve-run-dir', '--root-only'], …)` resolves.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/helpers-hook-event.test.js`
Expected: FAIL (the helper files do not exist)

- [ ] **Step 3: Implement** the two helpers and the three `hooks.js` edits. Read `tests/helpers/run-cli.js` first: `runCli` takes its leak-guard snapshot before the CLI is required, so arm the tripwire around the whole `runCli` call. At `plugin/bin/hooks.js:1878` add `spawn: deps.spawn, env: deps.env` to the argument object (Task 2 gives the function those parameters; until then they are ignored).

- [ ] **Step 4: Run** `node --test tests/helpers-hook-event.test.js tests/helpers-run-cli.test.js tests/hooks-help-guard.test.js tests/hooks-js-flag-strict.test.js tests/reconcile-dispatch.test.js`
Expected: PASS

- [ ] **Step 5: Append the three smoke tests** to `tests/hooks-dispatcher.test.js`, on `spawnCli`, each with a comment naming what the real process proves (script entry, stdin payload, exit code). Each builds its environment with an explicit `hookEnv(...)` and stores `{ args, input, cwd, env, result }` under its own key (`deny`, `allow`, `sessionEnd`) in a module-level `const SMOKE = {}`, which Task 6's parity test reads:
  - `AC6.1 AC8.1 smoke: pre-tool-use deny through the script entry` — fixture: `gitRepo()` plus `writeWorktreeAlwaysPolicy(project)` and an `Edit` payload on a file in that checkout; assert the exit code and the deny text on stderr (or the deny JSON on stdout, whichever the process emits today) with exact values, the fixture path substituted.
  - `AC6.1 AC8.1 smoke: pre-tool-use allow through the script entry` — `Bash` payload `echo hi` with `cwd: HOOK_SANDBOX`; assert exit 0 and the exact stdout.
  - `AC8.1 smoke: session-end through the script entry` — assert exit 0 and the exact stdout; the comment says the event has no non-zero refusal path, so it has no refusal test.
  Run them on this tree before any Task 2 change: `node --test --test-name-pattern "smoke:" tests/hooks-dispatcher.test.js`. Expected: PASS (3 tests). They are never edited again in this plan; that is what proves AC6's "same as before".

- [ ] **Step 6: Record the starting baseline.** Write the six converted file paths, one per line, to a scratch list and run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list>`; redirect the output to `"$PIPELINE_RUN_DIR/evidence/proc-count-start.txt"` (create the directory with `mkdir -p` first; plain Bash redirect, absolute path). Report the per-file `hooks.js` counts.

- [ ] **Step 7: Commit** the helpers, the test file, `plugin/bin/hooks.js` and `tests/hooks-dispatcher.test.js`.

### Task 2: Helpers take the environment as a parameter

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/hooks-env-params.test.js`
- Modify: `plugin/bin/lib/hooks/context.js` (`:673` lock-wait read, `:813` `ownerBlock`, `:873` `refreshOwnerBlock`, `:1006` `ownerPidPatch(process.env)`; add `requireEnv`)
- Modify: `plugin/bin/lib/hooks/git-exec.js` (`:199` `repoPinnedEnv` and the callers that build a child env)
- Modify: `plugin/bin/lib/hooks/sibling-sessions.js` (`:170`, `:246`)
- Modify: `plugin/bin/lib/hooks/dispatch-prompt-gate.js` (`:63`, `:69`)
- Modify: `plugin/bin/lib/hooks/worktree-detect.js` (`:91`, `:151`)
- Modify: `plugin/bin/lib/hooks/repo-info-cache.js` (read only unless a signature must widen)
- Modify: `plugin/bin/lib/reconcile/background-spawn.js`
- Modify: `tests/bin-lib/reconcile/background-spawn.test.js` (its eight calls pass `env`)
- Modify: `plugin/bin/lib/hooks/session-start.js` (`:447` only: the `spawnBackgroundIfStale` call passes `env: ctx.env, spawn: ctx.spawn`, so the now-required `env` never throws into that call's best-effort catch; Task 5 does the rest of the file)
- Modify: `tests/hooks-session-start.test.js` (direct `run` calls pass `env: process.env`, so the background spawn those tests observe still happens)
- Test: `tests/hooks-context.test.js`
- Test: `tests/hooks-git-exec.test.js`
- Test: `tests/hooks-sibling-sessions.test.js`
- Test: `tests/hooks-dispatch-prompt-gate.test.js`
- Test: `tests/hooks-worktree-detect.test.js`
- Test: `tests/hooks-repo-info-cache.test.js`
- Test: `tests/bin-lib/file-lock.test.js`

**Interfaces:**
- Produces: `ctxLib.requireEnv(ctx) -> object`: returns `ctx.env`; throws `TypeError('hook context has no env: hooks.js builds it for every event')` when `ctx` or `ctx.env` is not a non-null object.
- Produces: `spawnBackgroundIfStale({ root, cwd, sessionId, now, env, spawn })`. `env` is required: a non-object `env` throws `TypeError` before the function's `try` (inside it, the catch would report `spawn-failed` and the child would inherit `process.env`). `spawn` defaults to the call-time `require('child_process').spawn`. The child's env is `{ ...env, CLAUDE_TWEAKS_SESSION_ID: sessionId }` or `env`. The spawn options literal keeps `windowsHide: true` in the call's own argument text.
- Produces: the lock wait is read per call, not at module load: the `context.js` lock call sites pass `env` to `plugin/bin/lib/file-lock.js`'s existing `env` option. Functions with callers outside the event path keep `env = process.env` as the default of a new or existing option.
- Produces: `wtDetect` functions that events call (`repoInfo`, `mainCheckoutRoot`, and any sibling that reaches `lookupRepoInfo`/`rememberRepoInfo`) take a trailing `opts = {}` with `env` (default `process.env`) and pass it to `repo-info-cache.js`.
- Produces: `dispatch-prompt-gate.js`'s plugin-root and test-tag helpers take `env` as their first parameter, no default.
- Produces: `sibling-sessions.js`'s two entry functions read `opts.env.CLAUDE_CODE_SESSION_ID` only when the caller passed no session id; event callers always pass `env`.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-env-params.test.js`. Every test sets a sentinel in `process.env` to one value and the passed `env` to another (restore in `finally`), and asserts the passed value wins:
  - `requireEnv throws on a context without env` (`{}`, `{ env: null }`, `undefined`) and returns the object otherwise.
  - `spawnBackgroundIfStale passes the given env and session id to the given spawn`: fake `spawn` records `(file, args, options)`; assert `options.env.CT_5377_SENTINEL === 'given'`, `options.env.CLAUDE_TWEAKS_SESSION_ID === 'sess-1'`, `options.cwd`, `options.detached === true`, `options.windowsHide === true`, and the real `child_process.spawn` (replaced by a thrower for the test) was not called.
  - `spawnBackgroundIfStale throws without env`.
  - `ownerBlock and refreshOwnerBlock read the owner pid from the passed env` (`CLAUDE_PID`).
  - `the lock wait comes from the passed env`: `CLAUDE_TWEAKS_LOCK_WAIT_MS` differing between `process.env` and the passed `env`; assert through the narrowest exported function that returns or applies the wait.
  - `repoInfo consults the store the passed env names`: two store files via `CT_HOOKS_REPO_INFO_STORE`, one in `process.env` and one in `opts.env`; after `repoInfo(repo, { env })` only the passed one exists or changed.
  - `dispatch-prompt-gate reads the plugin root and test mode from the passed env`.
  - `sibling-sessions reads the session id from the passed env`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-env-params.test.js`
Expected: FAIL (the file does not exist; once written, each test fails on the unchanged helpers)

- [ ] **Step 3: Implement** the signatures above. Before changing a signature, list its callers: `git grep -n -e 'refreshOwnerBlock' -e 'ownerPidPatch' -e 'repoPinnedEnv' -e 'spawnBackgroundIfStale' -e 'ownerBlock(' -- plugin tests` and update every caller this change breaks; a caller on a verb path keeps the default.

- [ ] **Step 4: Run** `node --test tests/hooks-env-params.test.js tests/bin-lib/reconcile/background-spawn.test.js tests/hooks-context.test.js tests/hooks-git-exec.test.js tests/hooks-sibling-sessions.test.js tests/hooks-dispatch-prompt-gate.test.js tests/hooks-worktree-detect.test.js tests/hooks-repo-info-cache.test.js tests/bin-lib/file-lock.test.js tests/hooks-js-flag-strict.test.js tests/reconcile-dispatch.test.js tests/hooks-session-start.test.js tests/run-integrity.test.js` and the source-scan suites in Global Constraints.
Expected: PASS

- [ ] **Step 5: Commit.**

### Task 3: pre-tool-use reads the context

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/hooks-event-env.test.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`:64` plugin root; test-tag reads at `:598`, `:630`, `:779`, `:800`, `:866`, `:1125`, `:1188`, `:1238`, `:1896`, `:2392`; every `ctx.cwd || process.cwd()` at `:521`, `:526`, `:589`, `:591`, `:664`, `:857`, `:2068`, `:2537`)
- Modify: `tests/hooks-pre-tool-use.test.js` (AC5)
- Modify: `tests/hooks-pipeline-shadow-guard.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-bookkeeping-stamps-gate.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-bookkeeping-stamps-gate-claim-memo.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-policy-exemption.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-gate-coverage.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-dispatch-prompt-gate.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-harness-refusal.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-denial-run-dir.test.js` (direct `run` calls pass `env`)
- Modify: `tests/hooks-pre-tool-use-forge-memo.test.js` (direct `run` calls pass `env`)
- Modify: `tests/bin-lib/path-guard/pre-tool-use-identity.test.js` (direct `run` calls pass `env`)
- Modify: `tests/friction-adhoc-enterworktree-roundtrip.test.js` (direct `run` calls pass `env`)
- Modify: `tests/teardown-gate.test.js` (direct `run` calls pass `env`)
- Test: `tests/guard-refusals/shapes.test.js`
- Test: `tests/hooks-run-attribution.test.js`

**Interfaces:**
- Consumes: `requireEnv`, the `opts.env` helpers of Task 2, `runHookCli`/`hookEnv` of Task 1.
- Produces: `pre-tool-use.js`'s `run(ctx)` starts with `const env = ctxLib.requireEnv(ctx)`; the file names `process.env` and `process.cwd()` nowhere outside comments. `ctx.cwd` is used as given (the tail always sets it).

Before Step 1, read `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` in full.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-event-env.test.js`, all through `runHookCli`:
  - `AC2.1: pre-tool-use resolves the run directory from the injected env, not process.env`: two fixture run dirs A and B in one project, each bound to its own worktree; `process.env.PIPELINE_RUN_DIR` is set to a third directory for the whole test (restore in `finally`). With `env: hookEnv({ PIPELINE_RUN_DIR: A })` a `git commit` payload from the main checkout is denied naming A's worktree; with `PIPELINE_RUN_DIR: ''` the result does not name A's worktree. Reuse the run-state fixture shape of `tests/hooks-pre-tool-use.test.js:60-67`.
  - `AC3.1: CT_HOOKS_TEST_MODE only in the injected env tags the denial's friction event as a test event`: `process.env.CT_HOOKS_TEST_MODE` deleted for the call; read the event back from the file `tests/hooks-denial-run-dir.test.js` reads and assert `test === true`.
  - `AC3.2: CT_HOOKS_TEST_MODE only in process.env leaves the event untagged`: `process.env.CT_HOOKS_TEST_MODE = '1'`; build the injected env with `hookEnv()` and then `delete env.CT_HOOKS_TEST_MODE` (`hookEnv` adds the key and `cleanGitEnv()` copies the live `process.env`), asserting `!('CT_HOOKS_TEST_MODE' in env)` before the call; assert the event has no `test` field. AC3.1 asserts the mirror: `!('CT_HOOKS_TEST_MODE' in process.env)` before its call.
  - `pre-tool-use allow and deny read nothing from process.env`: one allow payload and the worktree-always deny payload resolve under the tripwire.
  - `pre-tool-use deny text names the injected CLAUDE_PLUGIN_ROOT`.
  - `pre-tool-use with an empty env resolves to an exit code`: `env: {}`; assert `Number.isInteger(r.code)`.
  - `pre-tool-use run throws on a context without env`: direct `require` and `assert.throws(() => pre.run({ input, cwd }), TypeError)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-event-env.test.js`
Expected: FAIL (the file does not exist; once written, AC3.1, AC3.2, the tripwire test and the missing-env test fail on the unchanged module)

- [ ] **Step 3: Implement.** Thread `env` from `run` to each helper that needs it as a parameter; do not store it in module state. Pass `{ env }` at every `wtDetect` call and `env` to every git child the module starts.

- [ ] **Step 4: Convert `tests/hooks-pre-tool-use.test.js`** (AC5.1 AC5.2): add `const BASE_ENV = Object.freeze({ ...process.env })` and pass `env: BASE_ENV` or `{ ...BASE_ENV, KEY: value }` in each `pre.run` context; the two `CLAUDE_PLUGIN_ROOT` cases at `:312-326` pass the key (or omit it) in `env` and stop touching `process.env`. Verify: `grep -c -E "process\.env\.[A-Z_]+ ?=|delete process\.env" tests/hooks-pre-tool-use.test.js` prints `0` (control: the same command prints `4` on the base commit, lines 315 to 326). In the other listed files, pass `env: process.env` (the live object, so a test that steers by mutation keeps working unchanged).

- [ ] **Step 5: Run** every file in this task's Files block plus the two source-scan lists in Global Constraints, then `node tools/run-tests.js --files-from <list of the same files>`.
Expected: PASS. A failure in a file not listed that carries the `requireEnv` message is a direct caller this plan missed: pass `env: process.env` there and name the file in the report.

- [ ] **Step 6: Revert-proof.** In a `git archive HEAD` extract (fresh `git init`, one snapshot commit, `HOME` and `USERPROFILE` set to a decoy directory), restore one `process.env.CT_HOOKS_TEST_MODE` read and one dropped `{ env }` argument in turn; record which `tests/hooks-event-env.test.js` test went red for each in the report.

- [ ] **Step 7: Commit.**

### Task 4: The six light event modules read the context

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/post-tool-use.js` (`:330`, `:529`)
- Modify: `plugin/bin/lib/hooks/post-tool-use-failure.js` (`:26`)
- Modify: `plugin/bin/lib/hooks/session-end.js` (`:17`)
- Modify: `plugin/bin/lib/hooks/pre-compact.js`
- Modify: `plugin/bin/lib/hooks/subagent-stop.js`
- Modify: `plugin/bin/lib/hooks/user-prompt-submit.js`
- Modify: `tests/hooks-event-env.test.js`
- Modify: `tests/hooks-post-tool-use-closing-keyword.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-adhoc-rundir.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-teardown-reanchor.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-worktree-staleness.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-design-doc.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-commit-dedup.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-ask-user-question.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-post-tool-use-failure.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-log-modules.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-lifecycle.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-subagent-stop.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/hooks-run-attribution.test.js` (direct `run` calls pass `env: process.env`)
- Modify: `tests/post-merge-parent-left-open-e2e.test.js` (direct `run` calls pass `env: process.env`)

**Interfaces:**
- Consumes: `requireEnv`, Task 2's helpers, `runHookCli`.
- Produces: each of the six modules' `run(ctx)` starts with `ctxLib.requireEnv(ctx)` and names `process.env` and `process.cwd()` nowhere outside comments.

- [ ] **Step 1: Append failing tests** to `tests/hooks-event-env.test.js`, one block per event (`post-tool-use`, `post-tool-use-failure`, `session-end`, `pre-compact`, `subagent-stop`, `user-prompt-submit`):
  - `{event} reads nothing from process.env`: a representative payload from that event's existing test file resolves under the tripwire.
  - `{event} run throws on a context without env`.
  - `session-end treats a nested session by the injected CLAUDE_PID` (`:17`'s `isNestedSession`): same session id, `CLAUDE_PID` differing only in the injected env; assert the run stays active (fixture of `tests/hooks-dispatcher.test.js:601-609`).
  - `post-tool-use stamps the owner pid from the injected env` (`:330`).
  - `post-tool-use-failure tags its event from the injected CT_HOOKS_TEST_MODE` (both directions, as AC3).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-event-env.test.js`
Expected: FAIL (the new tests fail on the unchanged modules)

- [ ] **Step 3: Implement**, as Task 3 Step 3.

- [ ] **Step 4: Run** every file in this task's Files block and the source-scan suites; then the runner over the same list.
Expected: PASS, with any unlisted `requireEnv` failure handled as Task 3 Step 5.

- [ ] **Step 5: Revert-proof** one thread-through per module, as Task 3 Step 6, and record it.

- [ ] **Step 6: Commit.**

### Task 5: session-start reads the context and starts its child through the seam

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/session-start.js` (`:58` `resolveBuildLine`, `:87` `ownerPidPatch`, `:102` `saveNodePath`, `:150` plugin root, `:447` `spawnBackgroundIfStale` call, and each call into `deps`, `reconcile`, `portsEnsure`, `resolvePluginVersion`, `effectiveSuperpowersVersion`)
- Modify: `plugin/bin/lib/deps.js` (`:15`, `:139`)
- Modify: `plugin/bin/lib/superpowers-version.js` (`:75`)
- Modify: `plugin/bin/lib/reconcile/index.js` — only where the session-start path reaches the read
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`:2389`)
- Modify: `plugin/bin/lib/ports/ensure.js` (`:57`) — only where the session-start path reaches the read
- Modify: `tests/hooks-event-env.test.js`
- Modify: `tests/hooks-session-start.test.js` (direct `run` calls pass `env`, `homeDir`, `spawn`)
- Test: `tests/bin-lib/hooks/reconcile-background.test.js`
- Test: `tests/reconcile.test.js`
- Test: `tests/reconcile-dispatch.test.js`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: `spawnBackgroundIfStale({ …, env, spawn })`, `requireEnv`, `ctx.homeDir`, `ctx.spawn`.
- Produces: `session-start.js`'s `run(ctx)` passes `env: ctx.env, spawn: ctx.spawn` to `spawnBackgroundIfStale`, uses `ctx.env.HOME || ctx.homeDir()` where `saveNodePath` defaulted to `process.env.HOME || os.homedir()`, passes `home` to the ports helpers, and passes `env` (and `sessionId` from the payload) to `reconcile`. Each function it reaches that read `process.env` gains an `env` option whose default stays `process.env` when a verb or another CLI also calls it.

- [ ] **Step 1: Append failing tests** to `tests/hooks-event-env.test.js`:
  - `session-start reads nothing from process.env`: a payload in a fresh `gitRepo()` with `deps: { spawn: fakeSpawn }` and `env` built with `fixtureHomeEnv` from `tests/helpers/fixture-home.js` (both `HOME` and `USERPROFILE` at a fixture home) resolves under the tripwire and under `runCli`'s `os.homedir()` guard.
  - `session-start starts the background pass through the injected spawn with the injected env`: stale status file; assert the fake got `[HOOKS_JS, 'reconcile-background']`, `options.env.CT_5377_SENTINEL`, `options.env.CLAUDE_TWEAKS_SESSION_ID` equal to the payload's `session_id`.
  - `session-start without a spawn fake rejects`: same fixture, no `deps.spawn`; `assert.rejects(…, /real spawn reached/)`.
  - `session-start run throws on a context without env`.
  - `session-start writes the node path under the injected home`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-event-env.test.js`
Expected: FAIL (the new tests fail on the unchanged module)

- [ ] **Step 3: Implement.** Work outward from `session-start.js`: run the tripwire test, fix the first reported `key@frame`, repeat until it is empty. A `'*'` read is a child started without `env` (Node 20): give that child `env`. A read reported from a Node internal called by `plugin/bin` code is fixed at the `plugin/bin` caller when a value from `env` can replace it; otherwise its key is added to `TRIPWIRE_ALLOWED` with the reason and named in the report.

- [ ] **Step 4: Run** this task's Files block and the source-scan suites; then the runner over the same list.
Expected: PASS

- [ ] **Step 5: Confirm the Non-Goal is untouched**: `node --test tests/bin-lib/hooks/reconcile-background.test.js` passes and `git diff --stat` shows no change to it.

- [ ] **Step 6: Revert-proof** the `env` and the `spawn` argument of the `spawnBackgroundIfStale` call, as Task 3 Step 6, and record it.

- [ ] **Step 7: Commit.**

### Task 6: tests/hooks-dispatcher.test.js calls hooks.js in-process

**Role:** integration

**Files:**
- Create: `tests/hooks-event-process-ceiling.test.js`
- Modify: `tests/hooks-dispatcher.test.js`

**Interfaces:**
- Consumes: `runHookCli`, `hookEnv`, `spawnCli`.
- Produces: `tests/hooks-event-process-ceiling.test.js` exports nothing; it holds `CONVERTED = ['tests/hooks-dispatcher.test.js']` (Task 7 appends five paths) and `CEILING = 20`.

- [ ] **Step 1: Write the failing test** `tests/hooks-event-process-ceiling.test.js`:
  - `AC1.1: no converted file starts hooks.js outside spawnCli`: for each path in `CONVERTED`, the comment-stripped source (use `tests/helpers/strip-comments`) has no match for `/(execFileSync|spawnSync|execSync|spawn)\(\s*('node'|"node"|process\.execPath)\s*,\s*\[[^\]]*\b(HOOKS|hooks)\b/` (any argv array that names the script, so a `['--require', preload, HOOKS, …]` site is flagged too). Assert the flagged line numbers are empty, not a count.
  - `AC1.1: the converted files hold at most 20 spawnCli call sites for hooks.js`: the sum of `/spawnCli\(\s*(HOOKS|hooks)\b/g` matches across `CONVERTED` is `<= CEILING`, and no `spawnCli(` call sits inside a `for`/`while`/`.forEach(`/`.map(` body (flag by line).
  - Self-tests from inline fixtures: a planted `execFileSync('node', [HOOKS, 'pre-tool-use'])` and a planted `execFileSync('node', ['--require', preload, HOOKS, 'pre-tool-use'])` are each flagged with their line; a planted twenty-first `spawnCli(HOOKS` fails with the ceiling message; `spawnSync(process.execPath, ['-e', ''])` is not flagged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hooks-event-process-ceiling.test.js`
Expected: FAIL (the file does not exist; once written it flags `tests/hooks-dispatcher.test.js`'s `runHook` spawn at `:27` and the `--require` preload spawn at `:885`)

- [ ] **Step 3: Convert `tests/hooks-dispatcher.test.js`.** `runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {}, deps, fresh } = {})` becomes `async` and returns `runHookCli(args, { input, cwd, env: hookEnv(env), deps, fresh })`'s `{ code, stdout, stderr }`; every test that calls it becomes `async` and awaits each call. Assertion text does not change (AC4.1). Rules for the cases that differ in-process:
  - A `session-start` call passes `deps: { spawn: fakeSpawn }`.
  - The `--require` preload case at `:885` stays a real process: its subject is a module replaced before `hooks.js` loads. Move it onto `spawnCli(HOOKS, ['pre-tool-use'], { env: { …, NODE_OPTIONS: '--require "<preload path>"' } })` (quote the path: a checkout path can hold spaces), with the comment "real process: a require-time preload cannot be installed after the module graph is loaded", and count it toward the ceiling.
  - A test that asserted exit 0 for a throwing event module asserts `assert.rejects` instead; if the script-entry exit 0 is itself the subject, it stays on `spawnCli` with the comment.
  - Forge-degrade cases get one run directory each (the 60 s degrade memo is per run, not per process).
  - A case whose answer depends on module state passes `fresh: true`.
  - A case that fakes `gh` or `git` with a stub on `PATH` must see the stub used in-process (its own assertion proves it); if it cannot, it stays on `spawnCli` and is listed.
  - On Windows a spread env keeps the stored key `Path`: do not read or assert `env.PATH` in the test.
  - Add `AC9.1: hooks-dispatcher — an event call uses the injected cwd and env`: a payload without `cwd`, `cwd` set to a fixture project that is not `process.cwd()`, and an `env` whose `PIPELINE_RUN_DIR` names that project's run; assert an observable only that project and run produce.
  - Add `smoke parity: in-process and script-entry agree`: for the three smoke fixtures, the `runHookCli` result deep-equals `SMOKE.{deny,allow,sessionEnd}.result`, called with that entry's own `args`, `input`, `cwd` and `env` (Task 1 Step 5 stores them), so this adds no process. The test sits after the three smoke tests in the file and fails with a clear message when a `SMOKE` entry is missing (a filtered run).

- [ ] **Step 4: Run** `node --test tests/hooks-dispatcher.test.js tests/hooks-event-process-ceiling.test.js`, then `node tools/run-tests.js --files-from <list of the two>`.
Expected: PASS, with the same number of passing tests as before the conversion plus the tests this plan added (record both numbers from the TAP summary).

- [ ] **Step 5: Run the file three times in a row** and once with `--test-concurrency=1`; a case that passes only in one order is a leak to fix, not to retry.

- [ ] **Step 6: Commit.**

### Task 7: The other five files call hooks.js in-process

**Role:** integration

**Files:**
- Modify: `tests/teardown-gate.test.js`
- Modify: `tests/user-prompt-submit.test.js`
- Modify: `tests/skill-invocation.test.js`
- Modify: `tests/hooks-run-attribution.test.js`
- Modify: `tests/run-integrity.test.js`
- Modify: `tests/hooks-event-process-ceiling.test.js` (append the five paths to `CONVERTED`)

**Interfaces:**
- Consumes: `runHookCli`, `hookEnv`, Task 6's rules.

- [ ] **Step 1: Append the five paths to `CONVERTED`.**

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/hooks-event-process-ceiling.test.js`
Expected: FAIL (on the base tree the file does not exist; after Task 6 it flags every remaining spawn site that names `HOOKS`/`hooks` in the five files)

- [ ] **Step 3: Convert each file** with Task 6 Step 3's rules, keeping each file's local helper name and return field names (`status`, `exitCode`, `stdout`) so test bodies change only by `async`/`await`. Per file:
  - `tests/teardown-gate.test.js`, `tests/user-prompt-submit.test.js`, `tests/skill-invocation.test.js`: the local `runHook` wraps `runHookCli`.
  - `tests/hooks-run-attribution.test.js`: `:592` and `:714` go in-process; the `#3515 incident e2e` case at `:729-739` stays a real process, moved onto `spawnCli` with the comment "real process: proves the misattributing gate end to end through the script entry (pre-tool-use-gate-exemptions)". Its `process.env.CLAUDE_PID` mutation at `:159-165` becomes an `env` key for the converted calls.
  - `tests/run-integrity.test.js`: `runSessionStart` at `:475` goes in-process with `deps: { spawn: fakeSpawn }`.
  - Each file gets `AC9.1: {file} — an event call uses the injected cwd or env`, written so that it fails when `run` ignores the injected value.

- [ ] **Step 4: Run** the five files and the ceiling test, then the runner over the same list; then each file three times in a row.
Expected: PASS, with per-file passing-test counts equal to before plus the added AC9 test.

- [ ] **Step 5: Revert-proof each AC9 test**: in the archive extract, make the event tail pass `cwd: process.cwd()` (then `env: process.env`) and record which AC9 tests went red. An AC9 test that stays green for both is rewritten.

- [ ] **Step 6: Commit.**

### Task 8: hooks.js leaves NOT_YET as a named exemption; stale skill text

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/cli-entry-conformance.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`
- Modify: `.claude/skills/bin-source-scan-conformance/SKILL.md`
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`
- Test: `tests/bin-lib/exit-code-conformance.test.js`

**Interfaces:**
- Produces: `const EXEMPT = { 'hooks.js': { reason: 'require-time bash prefilter (exits before run) and a script entry that calls process.exit(code) so a hook never outlives its event', proof: 'tests/hooks-bash-prefilter.test.js' } }`. Only the `'hooks.js'` line leaves `NOT_YET`. The list still holds `verify.js` at `tests/bin-lib/cli-entry-conformance.test.js:26-29`, so the spec's conditional ("If `NOT_YET` is then empty, the list and the code that reads it are deleted") does not fire: `NOT_YET`, `NOT_YET_CEILING` and their tests stay. Re-read the list after the pre-verification catch-up merge; delete the list and its reading code only if a merged sibling record has emptied it.

- [ ] **Step 1: Rewrite the file's tests first:**
  - `AC7.1 AC7.2: every top-level plugin/bin CLI meets the entry rules, except the named EXEMPT entries`.
  - `AC7.1: each EXEMPT entry names a reason and an existing proof file` (`fs.existsSync` on `proof`, non-empty `reason`).
  - `AC7.4: an EXEMPT file that now conforms fails the walk` — from an inline fixture, matching the message `now conforms — delete it from EXEMPT`.
  - `AC7.3: hooks.js is in EXEMPT and not in NOT_YET` — `!NOT_YET.includes('hooks.js')` and `Object.keys(EXEMPT)` deep-equals `['hooks.js']`; a comment records that the list is not empty (it holds `verify.js`), so the list and its reading code stay.
  - `AC7.1: a file cannot be both exempt and listed` — no `EXEMPT` key appears in `NOT_YET`.
  - The existing `NOT_YET` self-tests stay as they are.

- [ ] **Step 2: Run the check to verify it fails**

Run: `node -e "const s=require('fs').readFileSync('tests/bin-lib/cli-entry-conformance.test.js','utf8');const m=s.match(/const NOT_YET = \[([^\]]*)\]/);process.exit(/const EXEMPT = /.test(s)&&m&&!/hooks\.js/.test(m[1])?0:1)"`
Expected: FAIL (exit 1: the file declares no `EXEMPT` and `NOT_YET` still names `hooks.js`)

- [ ] **Step 3: Implement** the `EXEMPT` handling in `assertFile` and delete the `'hooks.js'` line from `NOT_YET`.

- [ ] **Step 4: Run** `node --test tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js` (AC7.2).
Expected: PASS

- [ ] **Step 5: Update the three skill passages** this change makes stale, changing only the stale clauses: `cli-wrapper-contract.md:4` ("`hooks.js` is the standing exception" now says it is the named `EXEMPT` entry, with the `NOT_YET` list unchanged beside it; "`context.js`'s own module-load read, which #5377 owns" is removed from the list of callers that pass no `env`); `bin-source-scan-conformance/SKILL.md:22`; `pre-tool-use-gate-exemptions/SKILL.md:28` and `:42` (`resolveRunDir(cwd, process.env)` / `resolveRun(cwd, process.env, …)` become `deps.env`, and the "#3515 incident e2e" sentence says the case runs through `spawnCli`). Then `git grep -n -F "is the standing exception" -- .claude/skills` must print nothing (control, run while planning on commit 66764ef7e: it matches `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md:4`).

- [ ] **Step 6: Commit.**

### Task 9: Measure, and write the PR-body section

**Role:** integration

**Files:**
- Test: `tests/hooks-dispatcher.test.js`
- Test: `tests/teardown-gate.test.js`
- Test: `tests/user-prompt-submit.test.js`
- Test: `tests/skill-invocation.test.js`
- Test: `tests/hooks-run-attribution.test.js`
- Test: `tests/run-integrity.test.js`

- [ ] **Step 1: Extract the base tree** next to the after tree: `git merge-base HEAD origin/main` as its own call, then `git archive <sha>` into a scratch directory under the session scratchpad (never a linked worktree).

- [ ] **Step 2: Measure both, back to back, within the same hour** (AC10.1): in the base extract and then in this worktree, `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <the six paths>`; redirect to `"$PIPELINE_RUN_DIR/evidence/proc-count-before.txt"` and `"$PIPELINE_RUN_DIR/evidence/proc-count-after.txt"`. AC1.1 holds when the after file's `hooks.js` total for the six files is at most 20; a higher total is not accepted and not rounded: convert the test that causes it, or stop and report.

- [ ] **Step 3: Write the PR-body section** to `"$PIPELINE_RUN_DIR/evidence/pr-body-section.md"` (Bash redirect): the before/after table per file (node processes, `hooks.js` processes, wall time), the starting baseline from Task 1, every test left on a real process with its one-line reason, every `plugin/bin/lib` file changed to pass an injected value with the test that goes red without it, every `TRIPWIRE_ALLOWED` key with its reason, and each place the merged #5374 helper differs from the spec's description (`runCli` is async-only for `hooks.js`; `stdoutSync` is a separate deps key the shared test helper collects; the shared `tests/helpers/hook-event.js` wrapper sits between the local helpers and `runCli`).

- [ ] **Step 4: Log the evidence** with `log-decision.js --status AUTO --step "AC evidence" --text-file <file>`: one line naming AC1 and AC10, the command shape, the two totals, and the three evidence paths.

- [ ] **Step 5: Commit** nothing from this task unless a conversion changed in Step 2.

Waived AC11.1: the full `npm test` suite and the Windows CI job run at `/claude-tweaks:build` Common Step 5 and on the PR, after this plan's last commit.
