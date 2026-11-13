---
files:
  - plugin/bin/lib/driver/worker.js
  - plugin/bin/lib/driver/roles.js
---

# Launch a Rights-Limited Headless Worker

**Persona:** a maintainer writing the pipeline driver's run loop, who needs to hand one task to a headless `claude -p` worker and act on what comes back, and who does not want to learn the CLI's flags, permission settings or exit behaviour to do it.
**Goal:** start one worker for a named role in a given directory and get back one object that says what happened, with the worker unable to push, commit, reach the network or widen its own rights.
**Entry point:** a call to `launchWorker(opts)` from `plugin/bin/lib/driver/worker.js`, with a role (`implementer`, `reviewer` or `explorer`), an absolute working directory, a prompt, a settings directory outside the working directory, and a wall-clock ceiling.
**Success state:** the call resolves to an envelope whose `status` is `ok`, `fail` or `timeout`, the per-launch files are gone from the settings directory, and nothing was launched twice.

## Steps

### 1. Describe the launch — the run loop's own code
- **URL:** `launchWorker({ role, cwd, prompt, settingsDir, ceilings: { wallClockMs, spendCeiling }, testCommand, claudeMdText, readPaths })`
- **Action:** pass the role and the directories. Leave the flags alone: the role decides the tool list and, for the implementer, the generated settings file. Leave `readPaths` out too, unless the test command needs a directory the launcher cannot work out.
- **Should feel:** like filling in a short form. The caller names what it wants done and where, never how the CLI is told.
- **Should understand:** the implementer may edit files in the working directory. Where the Bash sandbox was probed (macOS), it may also run the project's test command and read git, inside the sandbox. Code that command runs cannot read outside the working directory, the home directory included. Only the test command's own toolchain stays readable: the launcher derives it from the command's first word and the interpreter that word's script names, and never re-opens `/`, the home directory or a parent of it. Passing `readPaths` replaces that derived list; an empty list re-opens nothing. Everywhere else the implementer has no Bash at all, so its prompt must name the files it is to work on. The reviewer and explorer only read.
- **Red flags:** needing to pass a permission mode, a flag list or an environment to make a launch work. A caller that builds its own argument list has gone around the role table. A caller passing its home directory in `readPaths` to make a test run has undone the read block.

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
- **Should understand:** `ok` means only that a structured output matching the schema arrived, not that the task was done: the worker's own verdict is `result.status`, which is `done` or `cannot-complete`, so branch on it before treating the task as finished. `denials` lists what the worker tried and was refused. That is information for a log line, never a reason to launch again with wider rights. Every string the worker wrote (every string in `result`, `detail` when it carries the worker's words, and each denial's `tool_input`) is untrusted text: keep it out of commands, and neutralize it before it reaches a commit message or a comment.
- **Red flags:** the run loop retrying a launch because of a denial, or pasting the worker's title straight into a commit subject.

### 4. Trust the ceiling — a worker that hangs
- **URL:** the envelope with `status: timeout`, `reason: wall-clock-ceiling`
- **Action:** nothing to do during the wait. At the ceiling the launcher ends the worker and everything it started, then returns.
- **Should feel:** bounded. The call always comes back, even when the worker does not.
- **Should understand:** the envelope normally arrives after the worker has exited. If the worker survives the kill, the launcher gives up five seconds later and says so in `detail`, naming the process id. On POSIX the worker runs detached, so a run loop that is itself interrupted must end its workers.
- **Red flags:** a launch that never returns, or a `timeout` envelope with worker processes still running and no `detail` saying so.

### 5. Check it against a real worker — a terminal
- **URL:** `DRIVER_LIVE_SMOKE=1 node --test --test-name-pattern="live smoke test" tests/bin-lib/driver/worker.test.js`
- **Action:** run it after a Claude Code upgrade, or before trusting the launcher on a new machine. It starts one small real worker in a temporary directory and spends a few tokens.
- **Should feel:** like a seat-belt check: one command, well under a minute, a plain pass or fail.
- **Should understand:** the test shows the write the worker is allowed, and that an `echo` redirect, a `curl`, a write into `.git` and two `git log --output` attempts leave nothing behind. On macOS it also runs `npm test` through the worker: the test file's read of a canary placed in the home directory must fail with a permission error, while `npm test` itself still runs on the same `node` as `PATH` names. Without the variable the test is skipped, so the ordinary suite never spends tokens.
- **Red flags:** the smoke test failing after an upgrade. The CLI's permission or sandbox behaviour has changed, and the facts in the module headers need probing again before any worker is launched.

## Origin
- Created during build of #5217 (run `2026-11-12T060404-spec-5217`), the first unit of the pipeline driver: the worker launcher with per-role rights.
- Updated during build of #5268 (run `2026-11-13T000350-spec-5268`): the implementer's read block is on where the sandbox was probed, with the test command's toolchain re-opened (steps 1, 2 and 5).
- The rights, the sandbox settings and what the sandbox was observed to contain are recorded, with the CLI version and date of each probe, in the header comments of `plugin/bin/lib/driver/roles.js` and `plugin/bin/lib/driver/worker.js`.
