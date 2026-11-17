---
files:
  - tests/helpers/hook-event.js
  - tests/helpers/env-tripwire.js
  - tests/helpers/process-env.js
  - tests/hooks-event-env-conformance.test.js
  - tests/hooks-event-process-ceiling.test.js
  - tools/count-node-procs.js
  - plugin/bin/hooks.js
  - plugin/bin/lib/hooks/context.js
  - plugin/bin/lib/hooks/session-start.js
---

# Run a Hook Event In-Process From a Test

**Persona:** A claude-tweaks plugin maintainer who is writing a test for a `hooks.js` hook event (`pre-tool-use`, `post-tool-use`, `post-tool-use-failure`, `session-start`, `session-end`, `pre-compact`, `subagent-stop`, `user-prompt-submit`), or changing an event module or a helper an event calls.
**Goal:** Have the test call the event inside the test process with a payload, a working directory and an environment of its own, and have a red test or scan say exactly which read of the live process broke that.
**Entry point:** A test file under `tests/` that needs an event's output, and `tests/helpers/hook-event.js`.
**Success state:** The test passes with the event reading only the `cwd` and `env` the test passed, the two source scans are green, and the six converted hook-event files still hold at most 20 real `hooks.js` process starts.

## Steps

### 1. Call the event through `runHookCli`
- **URL:** `tests/helpers/hook-event.js`.
- **Action:** `const { code, stdout, stderr } = await runHookCli(['pre-tool-use'], { input: JSON.stringify(payload), cwd: fixtureDir, env: hookEnv({ PIPELINE_RUN_DIR: runDir }) });`. Give a `session-start` call `deps: { spawn: fakeSpawn }`.
- **Should feel:** Like calling a function. No process starts, and the JSON the event prints comes back in `stdout`.
- **Should understand:**
  - `cwd` and `env` are required (`runHookCli: cwd is required`, `runHookCli: env is required`). `env` is the whole environment the event sees, not merged over `process.env`.
  - `hookEnv(overrides)` is a clean git environment with `PIPELINE_RUN_DIR: ''` and `CT_HOOKS_TEST_MODE: '1'`, under the test's own keys.
  - The event tail hands the event module `{ input, runDir, runState, ownedRun, cwd, env, homeDir, spawn }`, and each event's `run` starts with `ctxLib.requireEnv(ctx)`.
  - Temp and home paths follow the passed env: the ad-hoc worktree marker, the SubagentStop retry counter and the SubagentStop stop marker land under the env's `TMPDIR` (`TEMP` on Windows), and `session-start` writes under the env's `HOME`. A test that looks for one of those files sets the variable to a directory in its own fixture and removes it afterwards.
- **Red flags:**
  - `hook context has no env`. A test that builds a context by hand and calls an event module's `run` directly left out `env`. Add it at the file's shared context builder.
  - `hook context has no homeDir`. A hand-built `session-start` context needs `homeDir` (a function) as well.
  - `runCli: real spawn reached`. A `session-start` call was made without a `spawn` fake, so the background pass would have started a real child.
  - A stub `git` or `gh` on `PATH` that never runs. Put the stub on the `PATH` of the env the test passes; on Windows find that key without spelling it (`Path`).

### 2. Read what the env tripwire tells you
- **URL:** the error text of a test that rejects with `hook event read process.env: <KEY>@<frame>`.
- **Action:** Open the `plugin/bin` frame it names and make that read come from the event's context.
- **Should feel:** Specific. One key and one frame per read.
- **Should understand:**
  - The tripwire (`tests/helpers/env-tripwire.js`) wraps `process.env` for the length of an event call and records every read made from `plugin/bin` code. A key of `*` is a child started without an `env` option: Node enumerates `process.env` to build the child's environment.
  - The rule for the fix: a function only hook events call takes `env` with no default and throws `TypeError` without it (`ctxLib.assertEnvObject`); a helper that verbs or other CLIs also call takes an optional `env`, and a call without it must build exactly the options it built before (no key set to `undefined`).
  - `TRIPWIRE_ALLOWED` holds the two reads that are allowed, each with its reason: `CT_HOOKS_GIT_TIMEOUT_MS` (a process-wide knob) and `NODE_V8_COVERAGE` (read by Node itself on every spawn).
  - The tripwire cannot see a native `os.tmpdir()` or `os.homedir()` call, a `process.cwd()` read, or a reference to `process.env` captured before the call. `runCli`'s own guard reports `os.homedir()` under an injected `HOME`; a temp-directory read is found only by a test that injects `TMPDIR` and looks where the file landed.
- **Red flags:**
  - Passing `tripwire: false`, or adding a key to `TRIPWIRE_ALLOWED`, to get to green. The read is the defect the test found.
  - A `*` read that appears only under `npx -y node@20 --test`. CI runs Node 20, so run a new event test there once before pushing.
  - A fix that passes `env` at the call site while the helper drops it on the way to its git child. Prove the thread-through with a clean passed env while the real `process.env.GIT_DIR` names no repository (`withBrokenGitDir` in `tests/helpers/process-env.js`), and a control call without `env` that goes the other way.

### 3. Act on a red event-module scan
- **URL:** `node --test tests/hooks-event-env-conformance.test.js`.
- **Action:** Fix the line the message names: `<file>:<line>: reads process.env (Scan A)`, `reads process.cwd (Scan A)`, or `<file>:<line>: runGit( call does not name env (Scan B)` (also for `repoInfo(`, `writeRunState(`, `resolveIntegrationBranch(` and `preferRemoteTrackingRef(`).
- **Should feel:** Like a lint error with a line number.
- **Should understand:**
  - Scan A covers every hook event module plus `dispatch-prompt-gate.js` and `skill-invocation.js`, default parameters included. Scan B needs `env` inside the call's own parentheses, so an `env` moved into a variable built elsewhere does not count.
  - `repoInfo`'s environment is its third parameter: `repoInfo(p, opts, { env })`.
  - Each module has a floor per call name. `<file>: matched N runGit( calls, floor M` means the scan found fewer calls than the floor. Either the matcher stopped matching (repair the matcher) or a real call was removed (lower the floor to the new count). Raise a floor when a call is added, so the next silent drop is caught.
  - `hooks.js dispatches event modules the scans do not read: add them to EVENT_MODULES and FLOORS here:` followed by module paths means `hooks.js`'s own `EVENT_MODULES` map dispatches an event module the scan list lacks. Add each path to the test's `EVENT_MODULES` array and give it a `FLOORS` entry.
- **Red flags:** Lowering a floor to get to green without having removed a call.

### 4. Keep real processes few and counted
- **URL:** `node --test tests/hooks-event-process-ceiling.test.js`, and `node tools/count-node-procs.js --files-from <list>`.
- **Action:** Leave a test on `spawnCli(HOOKS, …)` only where the process is its subject, under a `// real process: <reason>` comment. Convert anything else.
- **Should feel:** Deliberate. Five real `hooks.js` processes remain across the six converted files, each for a stated reason: the three smoke tests, the `--require` preload case, and the `#3515 incident e2e` case.
- **Should understand:**
  - The scan fails on a raw spawn of `hooks.js` in a converted file (it names the lines), on a `spawnCli(` call inside a loop body, and when the files hold more than 20 `spawnCli(HOOKS` call sites (`N spawnCli call sites for hooks.js … over the ceiling of 20`).
  - It counts call sites, not calls. `tools/count-node-procs.js` measures the processes a run really starts: the six files went from 241 `hooks.js` processes to 5 (252 node processes to 16).
  - A real-process test that sets its own `NODE_OPTIONS` keeps the ambient value in front of its own flags, or the counter's preload is dropped and that child is not counted.
- **Red flags:**
  - A test kept on a real process because an event or a verb ignores the injected env. Thread the env instead; `record-worktree`, `record-pr` and `check-session-residue` pass `deps.env` to their run-state writes for that reason.
  - Raising `CEILING`. It is the record's acceptance number.

## Origin
- Created during build of #5377, which moved `tests/hooks-dispatcher.test.js`, `tests/teardown-gate.test.js`, `tests/user-prompt-submit.test.js`, `tests/skill-invocation.test.js`, `tests/hooks-run-attribution.test.js` and `tests/run-integrity.test.js` onto `runHookCli` and made every hook event module read its environment from the context.
- Step 3 updated during wrap-up of #5377: review commit 20c8e4067 tied the scan list to `hooks.js`'s `EVENT_MODULES`, which added the missing-module message.
- Related: `call-a-plugin-bin-cli-in-process-from-a-test-5374.md` (the `runCli` helper this builds on), `act-on-a-red-cli-entry-conformance-scan-5374.md` (where `hooks.js` is a named exemption).
