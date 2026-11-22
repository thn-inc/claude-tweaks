---
files:
  - plugin/bin/lib/driver/worker.js
  - plugin/bin/lib/driver/roles.js
  - plugin/bin/lib/driver/launch.js
---

# Launch a Rights-Limited Headless Worker

**Persona:** a maintainer writing the pipeline driver's run loop, who needs to hand one task to a headless `claude -p` worker and act on what comes back, and who does not want to learn the CLI's flags, permission settings or exit behaviour to do it.
**Goal:** start one worker for a named role in a given directory and get back one object that says what happened, with the worker unable to push, commit, reach the network or widen its own rights.
**Entry point:** a call to `launchWorker(opts)` from `plugin/bin/lib/driver/worker.js`, with a role (`implementer`, `reviewer`, `explorer`, `merge-check` or `acceptance`), an absolute working directory, a prompt, a settings directory outside the working directory, and a wall-clock ceiling.
**Success state:** the call resolves to an envelope whose `status` is `ok`, `fail` or `timeout`, the per-launch files are gone from the settings directory, and nothing was launched twice.

## Steps

### 1. Describe the launch — the run loop's own code
- **URL:** `launchWorker({ role, cwd, prompt, settingsDir, ceilings: { wallClockMs, spendCeiling }, schema, testCommand, claudeMdText, readPaths })`
- **Action:** pass the role and the directories. Leave the flags alone: the role decides the tool list and, for the implementer, the generated settings file. Leave `readPaths` out too, unless the test command needs a directory the launcher cannot work out.
- **Should feel:** like filling in a short form. The caller names what it wants done and where, never how the CLI is told.
- **Should understand:** the implementer may edit files in the working directory. Where the Bash sandbox was probed (macOS), it may also run the test command the caller passes and read git, inside the sandbox. The driver passes the project's declared targeted runner (its `verify-scope.json` `impact.command` cut before ` {files}`, here `node tools/run-tests.js --files-from`), never a whole-suite command; a caller that passes no `testCommand` gets no test rule and no toolchain read path at all (#5915). Code that command runs cannot read outside the working directory, the home directory included. Only the test command's own toolchain stays readable: the launcher derives it from the command's first word and the interpreter that word's script names, and never re-opens `/`, the home directory or a parent of it. Passing `readPaths` replaces that derived list; an empty list re-opens nothing. Everywhere else the implementer has no Bash at all, so its prompt must name the files it is to work on. The reviewer, the explorer and the merge step's two judgment roles (`merge-check`, `acceptance`) only read. `launchWorker` adds `--model` only when it is given a `model`; the driver always gives one, because `launchTracked` resolves the role's profile from policy key `express-driver-models` through `profiles.js` as an unattended launch (#5917, `docs/driver.md`'s Worker models). A role with no resolvable model throws `DRIVER_MODEL_REFUSED` there before any process starts, and is never relaunched on the account's default model. `launchWorker` adds `--effort {level}` only when it is given an `effort`; the driver gives one when `model-effort: profile` resolves a level for the role's profile, from the same resolution as the model (#5942). A level outside `low`, `medium`, `high`, `xhigh`, `max` throws a `RangeError` before anything is written or started, because the CLI itself only warns on an unknown level and runs at its default.
- **Red flags:** needing to pass a permission mode, a flag list or an environment to make a launch work. A caller that builds its own argument list has gone around the role table. A caller passing its home directory in `readPaths` to make a test run has undone the read block. A driver launch whose argument list has no `--model`, or a model refusal followed by a launch without one. An unknown `--effort` value that reaches the CLI instead of being refused.

### 2. Get refused early when the launch is unsafe — the same call
- **URL:** the promise `launchWorker` returns, rejected
- **Action:** read the error and fix the option it names.
- **Should feel:** strict and immediate. A wrong option costs nothing, because no file was written and no process was started.
- **Should understand:** the launcher refuses a working directory or settings directory that is not absolute, a settings directory inside the working directory (the worker could edit its own rights file there), including one that reaches it through a symbolic link, a case variant or a second spelling, a working or settings directory whose path cannot be resolved (a dangling link, an unreadable part), a prompt that is not text, a ceiling that is not a positive number, a schema it cannot check, and, for the implementer, a `readPaths` that is not a list of absolute, already-normalized paths, that names the filesystem root, or (on macOS) that names the home directory or an ancestor of it, directly or through a link (the error names the entry).
- **Red flags:** a settings file left behind after a refused launch, or a refusal that arrives only after the worker has already run.

### 3. Read the envelope — the same call, resolved
- **URL:** the envelope: `status`, `reason`, `result`, `usage`, `turns`, `denials`, `spendOverrun`, `costUsd`, `detail`
- **Action:** branch on `status` and `reason`. On `ok`, use `result`. On `fail`, `reason` says which kind: `launch-error` (the worker never started), `exit`, `schema` or `spend-ceiling`.
- **Should feel:** unambiguous. One object, one verdict; a worker that printed something odd never reads as success.
- **Should understand:** `ok` means only that a structured output matching the schema arrived, not that the task was done. Under the default schema (`RESULT_SCHEMA`) the worker's own verdict is `result.status`, which is `done` or `cannot-complete`, so branch on it before treating the task as finished. A launch that passes its own `schema` gets that shape instead: the driver's reviewer passes `REVIEW_RESULT_SCHEMA` and gets `{ findings: [...] }`, with no `status`, and the launcher checks only that `findings` is an array, so the caller checks each element itself. The judgment workers pass their own schemas too: `merge-check` passes `MERGE_CHECK_RESULT_SCHEMA` and gets `{ verdict, rationale }`, the verdict `auto-merge` or `needs-human`; `acceptance` passes `ACCEPTANCE_RESULT_SCHEMA` and gets `{ tryIt, observationPlan, claims, parentBrief }`, whose inner shapes `acceptance.js` checks, because the launcher's schema subset has no `items`. `denials` lists what the worker tried and was refused. That is information for a log line, never a reason to launch again with wider rights. Every string the worker wrote (every string in `result`, `detail` when it carries the worker's words, and each denial's `tool_input`) is untrusted text: keep it out of commands, and neutralize it before it reaches a commit message or a comment.
- **Red flags:** the run loop retrying a launch because of a denial, or pasting the worker's title straight into a commit subject.

### 4. Trust the ceiling — a worker that hangs
- **URL:** the envelope with `status: timeout`, `reason: wall-clock-ceiling`
- **Action:** nothing to do during the wait. At the ceiling the launcher ends the worker and everything it started, then returns.
- **Should feel:** bounded. The call always comes back, even when the worker does not.
- **Should understand:** the envelope normally arrives after the worker has exited. If the worker survives the kill, the launcher gives up five seconds later and says so in `detail`, naming the process id. On POSIX the worker runs detached, so a run loop that is itself interrupted must end its workers. The pipeline driver launches every worker through `launchTracked` in `plugin/bin/lib/driver/launch.js`, which records the worker's handle so that `run.js`'s signal handler can end it; a new driver launch goes through it too, not through `launchWorker` directly. `launchTracked` resolves to `{ envelope, model, effort }`, not the bare envelope, and a launcher throw after the model resolved is rethrown with `model` and `effort` attached, so the caller's event line can still name both (#5917, #5942).
- **Red flags:** a launch that never returns, or a `timeout` envelope with worker processes still running and no `detail` saying so.

### 5. Check it against a real worker — a terminal
- **URL:** `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern="live smoke test" tests/bin-lib/driver/worker.test.js`
- **Action:** run it after a Claude Code upgrade, or before trusting the launcher on a new machine. It starts one small real worker, on the implementer's default model, in a temporary directory and spends a few tokens. After a change to a role's default model, also run `--test-name-pattern="live probe"`, which launches every role on each distinct default model, and record the dated result in `worker.js`'s header.
- **Should feel:** like a seat-belt check: one command, well under a minute, a plain pass or fail.
- **Should understand:** the test shows the write the worker is allowed, and that an `echo` redirect, a `curl`, a write into `.git` and two `git log --output` attempts leave nothing behind. On macOS it also runs the driver's targeted test command (`node tools/run-tests.js --files-from`, on a list file naming one test file) through the worker: the test file's read of a canary placed in the home directory must fail with a permission error, while the test file itself still runs on the same `node` as `PATH` names. Without the variable the test is skipped, so the ordinary suite never spends tokens.
- **Red flags:** the smoke test failing after an upgrade. The CLI's permission or sandbox behaviour has changed, and the facts in the module headers need probing again before any worker is launched.

## Origin
- Created during build of #5217 (run `2026-11-12T060404-spec-5217`), the first unit of the pipeline driver: the worker launcher with per-role rights.
- Updated during build of #5268 (run `2026-11-13T000350-spec-5268`): the implementer's read block is on where the sandbox was probed, with the test command's toolchain re-opened (steps 1, 2 and 5).
- Updated at wrap-up of #5222 (run `2026-11-13T093607-spec-5222`): the reviewer launch passes its own result schema (steps 1 and 3), and the driver's launch wiring moved from `steps.js` to `launch.js` (step 4).
- Updated at wrap-up of #5228 (run `2026-11-14T212212-spec-5228`): the entry point and step 1 add the read-only `merge-check` and `acceptance` judgment roles, and step 3 names their result schemas.
- Updated during build of #5915 (run `2026-11-19T062113-spec-5915-5917`): step 1 says `testCommand` is optional and that the driver passes only a targeted runner.
- Updated during build of #5917 (run `2026-11-19T062113-spec-5915-5917`): step 1 says every driver launch names a policy-chosen model and refuses a role with none, and step 5 adds the per-role live probe.
- Updated at wrap-up of #5915 (run `2026-11-19T062113-spec-5915-5917`): step 5's smoke test runs the driver's targeted test command instead of `npm test`.
- Updated at wrap-up of #5917 (run `2026-11-19T062113-spec-5915-5917`): step 4 says `launchTracked` returns the model beside the envelope and attaches it to a launcher throw.
- Updated during build of #5942 (run `2026-11-21T171056-spec-5941-5942`): step 1 adds the `--effort` flag and its refusal of an unknown level, and step 4 says `launchTracked` also returns and attaches the `effort`.
- The rights, the sandbox settings and what the sandbox was observed to contain are recorded, with the CLI version and date of each probe, in the header comments of `plugin/bin/lib/driver/roles.js` and `plugin/bin/lib/driver/worker.js`.
