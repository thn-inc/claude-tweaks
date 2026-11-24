# Remaining hooks.js Verb Tests In-Process (#5376) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the verb calls of fifteen test files from a fresh `hooks.js` process per call onto the in-process `runCli` helper, so the fifteen files together start at most 25 `hooks.js` processes (198 today).

**Architecture:** Each file's local spawn helper becomes an `async` function that calls `runCli(HOOKS, argv, { cwd, env, stdin })` from `tests/helpers/run-cli.js` and returns the field names the file's assertions already read. Tests whose subject is the process itself stay on `spawnCli` (or their existing spawn) with a one-line comment naming the process property they prove. `plugin/bin` changes only where a converted test shows a function reading `process.cwd()` or `process.env` instead of the injected value.

**Tech Stack:** Node `node --test`, `tests/helpers/run-cli.js` (`runCli`, `spawnCli`), `tests/helpers/git-fixtures.js` (`cleanGitEnv`), `tools/count-node-procs.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T204658-spec-5376/work/5376-spec.md`

## Global Constraints

Measured baseline at the branch base (`8646f7c5e`, 2026-11-15, `CT_TEST_CONCURRENCY=6`): 198 `hooks.js` processes, 261 tests, 0 failing. Per file: `hooks-dispatch-prompt-gate` 39, `delete-ledger-verb` 28, `hooks-run-arg-anchoring` 19, `hooks-spec-status` 19, `hooks-adopt-run-dir` 15, `local-merge-close-run-ordering` 12, `curation-judge-stagepath` 11, `hooks-check-pass-reentry` 9, `hooks-resolve-console` 9, `resolve-ledger-verb` 8, `reconcile-dispatch` 8, `hooks-resolve-run-dir-cli` 7, `hooks-worktree-local-fallback-disclosure` 6, `hooks-archive-run-1452` 4, `hooks-verb-exception-exit` 4.

**Where the merged helper differs from the spec text (the merged version governs; each difference goes in the PR body):**

- `hooks.js`'s `run(argv, deps)` is `async`, so `runCliSync` refuses it. Every converted helper is `async`, every test that calls it becomes `async` and `await`s the call. The spec's "the test bodies do not change" holds for the assertions, not for the added `async`/`await`.
- `hooks.js`'s `realDeps` holds no key named in the helper's `FAIL_CLOSED_KEYS`, so the helper's fail-closed rule does not stop a verb from reaching the real `gh`. A converted test whose verb can reach `gh` keeps its own stub on the injected `PATH`, or passes `GH_HOST: 'localhost', GH_TOKEN: 'x'` as `tests/delete-ledger-verb.test.js`'s `inProcessEnv` does.

**Conversion recipe (every task):**

- The helper's `env` is the complete environment the verb sees. Build it as `{ ...cleanGitEnv(), <every key the old helper set>, ...env }`, with `cleanGitEnv` from `tests/helpers/git-fixtures.js`, never `{ ...process.env, … }`. Keep every key the old helper set (`PIPELINE_RUN_DIR: ''`, `CT_HOOKS_TEST_MODE: '1'`, `CLAUDE_CODE_SESSION_ID`, a stubbed `PATH`).
- The helper returns the field names the file already asserts on. `runCli` resolves to `{ code, stdout, stderr }`; a file that reads `r.status` gets `status: r.code` from its helper.
- The old helper's `input` option is `runCli`'s `stdin`. The old `timeout` option has no in-process form and is dropped.
- `cliPath` is the absolute `HOOKS`/`HOOKS_JS` constant the file already defines.
- Calls run one at a time: no `Promise.all`, no concurrent subtests. A test that passes only in one order is a leak to fix, and a case whose answer depends on clean module state passes `fresh: true`.
- A test left on a real process uses `spawnCli(HOOKS, argv, { cwd, env, stdin })` with the identical explicit `env`, and carries a one-line comment naming the process property it proves.
- Do not change what any existing assertion checks. A conversion that needs a changed assertion is a STOP (see below).
- Never pass a real run directory of this checkout to a verb: `archive-run` archives for real and ignores `--dry-run`. Every run dir is a temp fixture.

**Real-process ceiling (AC1.1, binding).** The fifteen files together start at most 25 `hooks.js` processes. The spec's amendment makes the smoke tests per converted CLI, not per file, so the rule is per verb: each verb these files exercise is proven through the script entry by a `spawnCli` success test, and by a refusal test where the verb has a non-zero-exit refusal. A file whose verb already has both in a file #5375 converted adds none: `record-worktree` (`tests/hooks-ledger-row.test.js`), `resolve-run-dir` (`tests/hooks-js-flag-strict.test.js`), `archive-run` and `close-run` (`tests/archive-run-verb.test.js`). Allotment (maximum real `hooks.js` processes per file, total 20, which leaves 5 under the ceiling for the controller to rebalance):

| File | Max | What stays real |
|---|---|---|
| `tests/hooks-run-arg-anchoring.test.js` | 0 | nothing; `record-worktree`'s smoke tests are in `tests/hooks-ledger-row.test.js` |
| `tests/hooks-resolve-run-dir-cli.test.js` | 0 | nothing; `resolve-run-dir`'s smoke tests are in `tests/hooks-js-flag-strict.test.js` |
| `tests/hooks-worktree-local-fallback-disclosure.test.js` | 0 | nothing; `close-run`'s and `archive-run`'s smoke tests are in `tests/archive-run-verb.test.js` |
| `tests/hooks-archive-run-1452.test.js` | 0 | nothing; `archive-run`'s smoke tests are in `tests/archive-run-verb.test.js` |
| `tests/delete-ledger-verb.test.js` | 1 | one success smoke |
| `tests/resolve-ledger-verb.test.js` | 1 | one success smoke |
| `tests/hooks-adopt-run-dir.test.js` | 2 | success, and the usage refusal (exit 2, stderr) |
| `tests/hooks-check-pass-reentry.test.js` | 2 | success, and the unknown-flag refusal (exit 1, stderr); 3 only under Task 2's stated fallback |
| `tests/hooks-spec-status.test.js` | 1 | one success smoke |
| `tests/hooks-resolve-console.test.js` | 2 | `--help` success, and the unknown-flag refusal (exit 1, stderr) |
| `tests/curation-judge-stagepath.test.js` | 2 | success, and the unset-worktree refusal (exit 1, stderr) |
| `tests/hooks-dispatch-prompt-gate.test.js` | 0 | nothing; `record-worktree`'s smoke tests are in `tests/hooks-ledger-row.test.js` |
| `tests/local-merge-close-run-ordering.test.js` | 4 | only the `hooks.js` calls the skill's own bash fences make |
| `tests/reconcile-dispatch.test.js` | 2 | one success smoke, and the #4897 module-load-fault test (a preload) |
| `tests/hooks-verb-exception-exit.test.js` | 3 | the two AC2.1 cases, plus one more only if it cannot run in-process |

A real process started with a replaced `NODE_OPTIONS` (a preload passed through `env`) is not logged by `tools/count-node-procs.js`. It still counts toward the ceiling: every such test carries its `// real process:` comment and Task 6 adds it to the measured total by hand.

If a file cannot meet its number, STOP and report the count and the reason; the controller rebalances within 25. Never exceed a file's number silently.

**Injected-value proof (AC6.1).** Each converted file has at least one in-process test that passes a `cwd` or `env` differing from the test runner's and fails when `run` ignores it. Name an existing converted test when the proof below shows it qualifies; otherwise add one named `AC6.1: {verb} {what} against the injected {cwd|env}`, modelled on `tests/hooks-adopt-run-dir.test.js`'s `AC10.1: a relative --worktree resolves against the injected cwd`. Prove it once, after the file's conversion is committed, in a scratch copy of HEAD outside the worktree, never by editing the shared worktree (the dispatch prompt carries the scratch-copy steps and the scratch location). In the copy: run `node --test --test-name-pattern "<test name>" <file>` and see it pass; replace the verb's `deps.cwd()` with `process.cwd()` (or `deps.env` with `process.env`, or revert the lib thread-through this task added) on the path the test exercises; run the same command and confirm that named test is the one that fails; then delete the copy. Report, per file: the test name, the mutated line before and after, and the raw failing line of the run. A test that stays green under the mutation does not qualify: pick or write another.

**A global read a converted test exposes.** When an in-process test fails because a function under `plugin/bin` reads `process.cwd()`, `process.env` or `os.homedir()` itself, that function takes the value as a parameter whose default is the inherited one, and its caller on this verb's path passes `deps.cwd()` / `deps.env`. In scope only on a path this record's tests exercise. List every `plugin/bin` file changed this way in the task report. If the change needs more than the function's signature and the call sites on this verb's path, leave the test on `spawnCli` with the reason in its comment, and report it.

**STOP and report, do not reconcile,** when: an existing assertion would have to change for the converted test to pass; a verb's behaviour would have to change; a file cannot meet its real-process number; a helper or seam named here does not exist or has a different signature in the live file. Verify against the live files, not this plan.

**Commands.** Run a test file with `node --test <file>` (glob form for a directory, never a bare directory). Count processes with `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list> --json <out>`, where `<list>` (one test path per line) and `<out>` live in the scratch directory the dispatch prompt names, outside the worktree. Redirect long output to a `.txt` file there, never `.log`. A task that edits `plugin/bin` also runs `node --test tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/windows-hide-spawn-conformance.test.js`. Never run the whole suite from a task; the controller runs it once, centrally.

**Commits.** Subject style `{Verb} {what} — {detail}`; reference the record as `refs #5376`, never a closing keyword before `#5376`. Stage files by explicit path.

**Governing project skills.** `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` governs in-process CLI tests; these rules are quoted from it verbatim:

- "Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath`; the helper fails the test on a leaked `process.exitCode`, working directory, `process.env` key, signal listener, direct stdout/stderr write, or an `os.homedir()` call under an injected home; each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code."
- "The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes."
- "Module-level state under `plugin/bin` (the forge probe's memos, for example) survives between in-process calls in one test file; a case that depends on it passes `fresh: true`, which clears `require.cache` under `plugin/bin` first."
- "A result one test computes and another reuses (a spawned script run compared against an in-process call, say) goes through a memoized helper, never a file-level variable an earlier test assigns, so every test passes alone under `--test-name-pattern`"
- "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- "Delete the same four from the env a converted test hands the CLI whenever it merges `process.env` and its assertion depends on which repository git finds, or on there being none"
- "An in-process test cannot set the other knobs, or this one through such a caller, through `env`, so a test of those is a `spawnCli` test." (The knobs are `CLAUDE_TWEAKS_GH_TIMEOUT_MS`, `CLAUDE_TWEAKS_GIT_TIMEOUT_MS`, `CT_HOOKS_GIT_TIMEOUT_MS`, and `CLAUDE_TWEAKS_LOCK_WAIT_MS` outside `ledger-row`.)
- "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`"

`.claude/skills/hooks-js-verb-registration/SKILL.md` does not apply: no verb or flag is added or removed. `.claude/skills/windows-checkout-test-parity/SKILL.md` applies to any new test that asserts a path: build the expected value with the same `path` call the code uses, and keep an existing `skip: process.platform === 'win32'` guard on a test that has one.

Waived AC8.1: the full `npm test` suite and the Windows CI job run centrally at the build's final verification and on the PR, not inside a plan task.

Waived tests/bin-lib/exit-code-conformance.test.js: read only; a task that edits `plugin/bin` runs it (Commands above).

Waived tests/bin-lib/cli-entry-conformance.test.js: read only; a task that edits `plugin/bin` runs it (Commands above).

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Task 6 Step 3 sums the after run's raw `hooks.js` counts against the ceiling of 25; each of Tasks 1-5 compares its files' test counts before and after |
| AC2.1 | Task 5 Step 4 keeps the VERBS-exception and event-exception tests on a real process |
| AC3.1 | Task 1 Step 3: `runRecordWorktree` asserts the injected `cwd` differs from the runner's before every in-process call |
| AC4.1 | Tasks 1-5, the run step: `runCli` rejects on a direct stdout or stderr write, so a passing file has a silent leak guard |
| AC5.1 | the `AC5.1: …` smoke tests of Tasks 1-5, within the allotment table |
| AC6.1 | the injected-value proof each of Tasks 1-5 runs per file |
| AC7.1 | Task 6 Steps 1-2 measure both runs back to back and write the table and the real-process list |

## Review Focus

- **Module-level stubs now reach the verb.** `tests/reconcile-dispatch.test.js` line 30 replaces `declined-learning/store`'s `pruneDeclines` for the whole test process. A spawned `hooks.js` never saw that stub; an in-process call does, and it must: the real prune resolves its store from `process.cwd()`, which an injected `cwd` does not move, so it would rewrite the maintainer's own store. Expected: a non-dry in-process `reconcile` call reaches the stub, never the real function. Pinned in Task 5 with a counting stub.
- **A stubbed `gh` on the injected `PATH` is actually used.** `hooks-resolve-console`'s three stub tests and `hooks-check-pass-reentry`'s gh-absent test pass a `PATH` through `env`. Expected: in-process, the verb's `gh` child reads that `PATH`, so the stub answers and the real `gh` is never started. Pinned in Tasks 2 and 3 (the existing assertions on the stub's output fail if the stub is skipped).
- **State carried between calls of one file.** `hooks-dispatch-prompt-gate` makes 39 `record-worktree` calls in one process after conversion. Expected: every test passes alone under `--test-name-pattern` and in file order. Pinned in Task 4.
- **A relative path argument under an injected cwd.** Expected: a relative `--run`, `--worktree` or `--ledger` resolves against the injected `cwd`, not the runner's. Pinned by each file's AC6.1 test where the verb takes a path.
- **The script entry still works.** Expected: for each verb in the allotment table, a real process prints the same stdout and exit code as the in-process call. Pinned by each task's AC5.1 smoke test.

---

### Task 1: Run-dir argument family

**Role:** integration

**Files:**
- Modify: `tests/hooks-run-arg-anchoring.test.js`
- Modify: `tests/hooks-resolve-run-dir-cli.test.js`
- Modify: `tests/hooks-worktree-local-fallback-disclosure.test.js`
- Modify: `tests/hooks-archive-run-1452.test.js`
- Modify: `plugin/bin/hooks.js` (only for a global read a converted test exposes)

**Interfaces:**
- Consumes: `runCli`, `spawnCli` from `tests/helpers/run-cli.js`; `cleanGitEnv` from `tests/helpers/git-fixtures.js`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Record each file's test count before the change**

Run `node --test` on each of the four files and note pass/fail counts.

- [ ] **Step 2: Run the conversion probe to verify it fails**

Run: `node -e 'const fs=require("fs");const miss=process.argv.slice(1).filter((f)=>!fs.readFileSync(f,"utf8").includes("helpers/run-cli"));if(miss.length){console.error("not converted: "+miss.join(", "));process.exit(1)}' tests/hooks-run-arg-anchoring.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-worktree-local-fallback-disclosure.test.js tests/hooks-archive-run-1452.test.js`
Expected: FAIL with "not converted:" naming all four files

- [ ] **Step 3: Convert the four helpers**

Each becomes `async` and calls `runCli`; signatures and return fields stay as they are:
- `runRecordWorktree(args, cwd)` → `Promise<{ code, stdout }>`, argv `['record-worktree', ...args]`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '' }`.
- `run(args, cwd, env)` in `hooks-resolve-run-dir-cli` → `Promise<{ code, stdout, stderr }>`, argv `['resolve-run-dir', ...args]`, env `{ ...cleanGitEnv(), ...env }`.
- `runHooks(cmd, args, cwd)` in the other two → `Promise<{ code, stdout }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '' }`.

AC3.1: in `runRecordWorktree`, before the call, assert the injected `cwd` is not the test runner's working directory (`assert.notEqual(fs.realpathSync(cwd), fs.realpathSync(process.cwd()))`), so every worktree-local `--run` refusal case in the file runs in-process under a cwd that differs from the runner's.

- [ ] **Step 4: Add the injected-value tests**

AC5.1: these four files add no smoke test. Their verbs' script-entry tests already exist (allotment table); add to each file's header comment one line naming the file that holds them.

Name or add each file's AC6.1 test and run the injected-value proof from Global Constraints.

- [ ] **Step 5: Run the four files and count processes**

Run: `node --test tests/hooks-run-arg-anchoring.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-worktree-local-fallback-disclosure.test.js tests/hooks-archive-run-1452.test.js`
Expected: PASS, with at least Step 1's test count per file and no `runCli: hooks.js leaked process state` error (AC4.1)

Then count with `tools/count-node-procs.js`: each file's `hooks.js` count is 0.

- [ ] **Step 6: Commit**

```bash
git add tests/hooks-run-arg-anchoring.test.js tests/hooks-resolve-run-dir-cli.test.js tests/hooks-worktree-local-fallback-disclosure.test.js tests/hooks-archive-run-1452.test.js
git commit -m "Run the run-dir argument verb tests in-process — refs #5376"
```

### Task 2: Ledger verbs, adopt-run-dir and check-pass-reentry

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/delete-ledger-verb.test.js`
- Modify: `tests/resolve-ledger-verb.test.js`
- Modify: `tests/hooks-adopt-run-dir.test.js`
- Modify: `tests/hooks-check-pass-reentry.test.js`
- Modify: `plugin/bin/hooks.js` (`runCheckPassReentry` passes `env: deps.env`; otherwise only for a global read a converted test exposes)
- Modify: `plugin/bin/lib/flow/consolidated-pass.js` (`checkPassReentry` takes an `env` option, default the inherited environment)
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (only if its `gh` lookup on this path needs the `env`)
- Modify: `plugin/bin/lib/hooks/run-integrity.js` (only if its `git` or `gh` child on this path needs the `env`)

**Interfaces:**
- Consumes: `runCli`, `spawnCli`; `cleanGitEnv`; the `inProcessEnv`/`runInProcess` helpers #5375 already added to the two ledger files.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Record each file's test count before the change**

- [ ] **Step 2: Run the conversion probe to verify it fails**

Run: `node -e 'const fs=require("fs");const miss=process.argv.slice(1).filter((f)=>!fs.readFileSync(f,"utf8").includes("helpers/run-cli"));if(miss.length){console.error("not converted: "+miss.join(", "));process.exit(1)}' tests/delete-ledger-verb.test.js tests/resolve-ledger-verb.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-check-pass-reentry.test.js`
Expected: FAIL with "not converted: tests/hooks-check-pass-reentry.test.js"

- [ ] **Step 3: Convert the helpers**

- `delete-ledger-verb`: `runHook(args, { cwd })` → `Promise<{ code, stdout }>` and `runHookFull(args, { cwd, env })` → `Promise<{ code, stdout, stderr }>`, both through the file's existing `runInProcess`. One in-process helper family in the file, not two.
- `resolve-ledger-verb`: `runHook(args, { cwd })` → `Promise<{ code, stdout, stderr }>` through the existing `runInProcess`; keep whatever fields the current `runHook` returns.
- `hooks-adopt-run-dir`: `runHook(args, { input, cwd, env })` → `Promise<{ code, stdout, stderr }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env }`.
- `hooks-check-pass-reentry`: the local helper is named `runCli`, which collides with the import. Rename it `runHook(args, { cwd, env })` → `Promise<{ code, stdout, stderr }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', CLAUDE_CODE_SESSION_ID: 'cpr-test', ...env }`. The gh-absent test (`#3553: --online is threaded through …`) passes a `PATH` holding only a symlink to git. Today `runCheckPassReentry` hands `checkPassReentry` only `{ online, sessionId }`, so in-process its `gh` and `git` lookups would read the runner's `PATH`, reach the real `gh`, and skip the stub `PATH` silently, which the spec forbids. Thread it: `checkPassReentry(runDir, { online, sessionId, env })`, with `env` passed on to each `gh`/`git` child it starts on the `--online` path (`prResolver`, `landedCheck`, and what they call in `pr-state.js` and `run-integrity.js`), every new parameter defaulting to the inherited environment so no other caller changes. Write the characterization test first (the maturity rule in the dispatch rules): the existing spawned gh-absent test is that characterization; run it green before the change and keep its assertions. **Fallback:** if the thread-through needs more than an added `env` option on those functions and their calls on this path, change no lib file, leave this one test on `spawnCli` with the comment `// real process: the gh lookup reads the process PATH, which an in-process env cannot replace`, and report it; the file's allotment is then 3.

- [ ] **Step 4: Add the smoke and injected-value tests**

- `AC5.1: delete-ledger deleting {run-dir}/ledger.md through runCli and spawnCli returns the same code and stdout`
- `AC5.1: resolve-ledger on a run-dir ledger through runCli and spawnCli returns the same code and stdout`
- `AC5.1: adopt-run-dir copying decisions.md through runCli and spawnCli returns the same code and stdout`
- `AC5.1: adopt-run-dir with --worktree missing exits 2 with the usage line on stderr through the script entry`
- `AC5.1: check-pass-reentry on an eligible fixture through runCli and spawnCli prints the same verdict JSON, exit 0`
- `AC5.1: check-pass-reentry with an unknown flag exits 1 with the usage line on stderr through the script entry`

AC6.1: the three #5375 tests named `AC10.1: …` in the first three files qualify if the injected-value proof turns them red; for `hooks-check-pass-reentry`, `#3553: the caller's CLAUDE_CODE_SESSION_ID is passed as sessionId` is the candidate (it passes a non-default env). Run the proof for all four files.

- [ ] **Step 5: Run the four files and count processes**

Run: `node --test tests/delete-ledger-verb.test.js tests/resolve-ledger-verb.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-check-pass-reentry.test.js`
Expected: PASS, with at least Step 1's test count per file and no leaked-process-state error (AC4.1)

Then count: `delete-ledger-verb` ≤ 1, `resolve-ledger-verb` ≤ 1, `hooks-adopt-run-dir` ≤ 2, `hooks-check-pass-reentry` ≤ 2 (3 under the fallback). The gh-absent test's env-threading is its own AC6.1 proof: in the scratch copy, drop the `env` this task threaded and the test must fail.

- [ ] **Step 6: Commit**

Stage the four test files and every `plugin/bin` file this task changed, each by path.

```bash
git add tests/delete-ledger-verb.test.js tests/resolve-ledger-verb.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-check-pass-reentry.test.js
git commit -m "Run the ledger, adopt-run-dir and pass-reentry verb tests in-process — refs #5376"
```

### Task 3: spec-status, resolve-console and sweep-shadow

**Role:** integration

**Files:**
- Modify: `tests/hooks-spec-status.test.js`
- Modify: `tests/hooks-resolve-console.test.js`
- Modify: `tests/curation-judge-stagepath.test.js`
- Modify: `plugin/bin/hooks.js` (only for a global read a converted test exposes)

**Interfaces:**
- Consumes: `runCli`, `spawnCli`; `cleanGitEnv`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Record each file's test count before the change**

- [ ] **Step 2: Run the conversion probe to verify it fails**

Run: `node -e 'const fs=require("fs");const miss=process.argv.slice(1).filter((f)=>!fs.readFileSync(f,"utf8").includes("helpers/run-cli"));if(miss.length){console.error("not converted: "+miss.join(", "));process.exit(1)}' tests/hooks-spec-status.test.js tests/hooks-resolve-console.test.js tests/curation-judge-stagepath.test.js`
Expected: FAIL with "not converted:" naming all three files

- [ ] **Step 3: Convert the helpers**

- `hooks-spec-status`: `runHook(args, { input, cwd = HOOK_SANDBOX, env })` → `Promise<{ code, stdout }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', ...env }`. Both `spec-status` and `manifest-init` calls go through it.
- `hooks-resolve-console`: `runHook(args, { cwd, env })` → `Promise<{ code, stdout, stderr }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', ...env }`, keeping the temp-dir default for an omitted `cwd`. The three tests that inline `execFileSync('node', [HOOKS, 'resolve-console', …])` with a `gh` stub prepended to `PATH` call `runHook` with that `PATH` in `env` instead. Their assertions read the stub's canned comment, so they fail if the in-process `gh` child skips the stub.
- `curation-judge-stagepath`: `sweep(cwd, { runDir, worktree })` → `Promise<{ status, stdout, stderr }>` (`status: r.code`), env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '' }`. `sweep-shadow` moves files with `mv` and compares `pwd -P` paths: any child it starts must get the injected `cwd` and `env`.

- [ ] **Step 4: Add the smoke and injected-value tests**

- `AC5.1: spec-status running through runCli and spawnCli prints the same banner, exit 0`
- `AC5.1: resolve-console --help through runCli and spawnCli prints the same usage, exit 0`
- `AC5.1: resolve-console with an unknown flag exits 1 with the usage line on stderr through the script entry` (the existing unknown-flag test moves onto `spawnCli` rather than gaining a twin)
- `AC5.1: sweep-shadow relocating a shadow staged file through runCli and spawnCli returns the same code and stdout`
- `AC5.1: sweep-shadow with an unset worktree arg exits 1 with its diagnostic through the script entry` (the existing unset-worktree test moves onto `spawnCli`)

Name or add each file's AC6.1 test and run the injected-value proof.

- [ ] **Step 5: Run the three files and count processes**

Run: `node --test tests/hooks-spec-status.test.js tests/hooks-resolve-console.test.js tests/curation-judge-stagepath.test.js`
Expected: PASS, with at least Step 1's test count per file and no leaked-process-state error (AC4.1)

Then count: `hooks-spec-status` ≤ 1, `hooks-resolve-console` ≤ 2, `curation-judge-stagepath` ≤ 2.

- [ ] **Step 6: Commit**

```bash
git add tests/hooks-spec-status.test.js tests/hooks-resolve-console.test.js tests/curation-judge-stagepath.test.js
git commit -m "Run the spec-status, resolve-console and sweep-shadow tests in-process — refs #5376"
```

### Task 4: Fixture record-worktree and close-run calls

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `tests/hooks-dispatch-prompt-gate.test.js`
- Modify: `tests/local-merge-close-run-ordering.test.js`
- Modify: `plugin/bin/hooks.js` (only for a global read a converted test exposes)

**Interfaces:**
- Consumes: `runCli`, `spawnCli`; `cleanGitEnv`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Record each file's test count before the change**

- [ ] **Step 2: Run the conversion probe to verify it fails**

Run: `node -e 'const fs=require("fs");const miss=process.argv.slice(1).filter((f)=>!fs.readFileSync(f,"utf8").includes("helpers/run-cli"));if(miss.length){console.error("not converted: "+miss.join(", "));process.exit(1)}' tests/hooks-dispatch-prompt-gate.test.js tests/local-merge-close-run-ordering.test.js`
Expected: FAIL with "not converted:" naming both files

- [ ] **Step 3: Convert the fixture calls**

- `hooks-dispatch-prompt-gate`: `recordWorktree(project, runDir, { dispatch, session })` → `Promise<void>`, calling `runCli` with env `{ ...cleanGitEnv(), CLAUDE_CODE_SESSION_ID: session, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' }` and asserting `code === 0`. `fixture(...)` becomes `async`, and every test that builds a fixture `await`s it. The gate calls (`ptu.run`) and `render` are already in-process and stay as they are.
- `local-merge-close-run-ordering`: the `hook(...)` closures inside `ownerAfterReprotect` and `assertReprotectRestores` (the `record-worktree` and `close-run` fixture calls) go through `runCli` with the same env keys they set today; both functions and their callers become `async`. `runFence` stays a real `bash -c`: the skill's literal fence is its subject, and the `hooks.js` processes a fence starts are the file's whole allotment. Add the comment `// real process: the subject is the skill's own bash fence, run by bash as an agent's shell would` on `runFence`.

- [ ] **Step 4: Add the smoke and injected-value tests**

- AC5.1: `hooks-dispatch-prompt-gate` adds no smoke test (`record-worktree`'s are in `tests/hooks-ledger-row.test.js`; say so in the file's header comment).
- `local-merge-close-run-ordering` adds no smoke test: its fence runs are its real-process coverage of `record-worktree`.

Name or add each file's AC6.1 test and run the injected-value proof. Then run every test of `hooks-dispatch-prompt-gate` alone once (`--test-name-pattern` per test name, driven by a small scratch script outside the worktree) to show no test depends on state an earlier one left.

- [ ] **Step 5: Run the two files and count processes**

Run: `node --test tests/hooks-dispatch-prompt-gate.test.js tests/local-merge-close-run-ordering.test.js`
Expected: PASS, with at least Step 1's test count per file and no leaked-process-state error (AC4.1)

Then count: `hooks-dispatch-prompt-gate` is 0, `local-merge-close-run-ordering` ≤ 4.

- [ ] **Step 6: Commit**

```bash
git add tests/hooks-dispatch-prompt-gate.test.js tests/local-merge-close-run-ordering.test.js
git commit -m "Run the fixture record-worktree and close-run calls in-process — refs #5376"
```

### Task 5: reconcile and the verb-exception exits

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/reconcile-dispatch.test.js`
- Modify: `tests/hooks-verb-exception-exit.test.js`
- Modify: `plugin/bin/hooks.js` (only for a global read a converted test exposes)

**Interfaces:**
- Consumes: `runCli`, `spawnCli`; `cleanGitEnv`; `VERBS` exported by `plugin/bin/hooks.js`.
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Record each file's test count before the change**

- [ ] **Step 2: Run the conversion probe to verify it fails**

Run: `node -e 'const fs=require("fs");const miss=process.argv.slice(1).filter((f)=>!fs.readFileSync(f,"utf8").includes("helpers/run-cli"));if(miss.length){console.error("not converted: "+miss.join(", "));process.exit(1)}' tests/reconcile-dispatch.test.js tests/hooks-verb-exception-exit.test.js`
Expected: FAIL with "not converted:" naming both files

- [ ] **Step 3: Convert `reconcile-dispatch`**

- `runHook(args, { input, cwd = HOOK_SANDBOX, env })` → `Promise<{ code, stdout }>`, env `{ ...cleanGitEnv(), PIPELINE_RUN_DIR: '', ...env }`.
- `runReconcileVerbStubbed` calls `runCli(HOOKS, argv, { cwd, env })` per argv instead of `main(...)` with `process.stdout.write` patched; it keeps its `reconcile` and `spawnBackgroundIfStale` module stubs and its return shape `{ calls, spawnCalls, outputs }`, parsing each call's `stdout`. No `fresh: true` on these calls: a reload would drop the stubs.
- Review Focus pin: the file's module-level `pruneDeclines = () => 0` stub now reaches in-process verb calls, and it must stay in place for every one of them: the real prune resolves its store from `process.cwd()`, so it would lock and rewrite the maintainer's own declined-learning store. Never restore or call the real `pruneDeclines` in this file. Add the test `an in-process reconcile verb call reaches the file's pruneDeclines stub, and a --dry-run call does not`, which swaps in a counting stub (restoring the file's `() => 0` stub in `finally`), runs `reconcile --json` on a no-remote fixture and asserts the count is 1, then runs `reconcile --dry-run --json` and asserts the count is still 1.
- `reconcile verb: a post-merge.js load fault still renders the reconcile-threw line in the compact output, not a silent exit 0 (#4897)` stays on a real process through `spawnCli`, unchanged in what it asserts, with the comment `// real process: the fault is injected at module load, which only a preload can do`. Its `NODE_OPTIONS` preload replaces the counting tool's own, so the tool does not log it: name it in the task report so Task 6 counts it.
- The real `reconcile` on these fixtures starts `git` and may probe `gh`: every such child must get the injected `cwd` and `env`. A test that only passes when a child reads the real environment exposes a global read; handle it per Global Constraints.

- [ ] **Step 4: Convert `hooks-verb-exception-exit`**

AC2.1: these two stay on a real process with the `--require` preload, unchanged, each with a comment naming what it proves:
- `AC1.1: a throwing VERBS handler exits 1 with empty stdout and the claude-tweaks: {verb}: stderr line` — `// real process: proves the script entry turns a VERBS exception into exit 1`
- `AC2.1: a throwing EVENTS module still exits 0` — `// real process: proves the entry catch turns an event exception into exit 0`

These two move in-process through `runCli`, with the fault injected by replacing the function on the loaded module object (restored in `finally`), the way the file's `#4932` test replaces `VERBS['check-staged-inventory'].run`:
- `AC1.1: a non-Error throw value is printed with String()` — asserts `code === 1`, `stdout === ''` and the same stderr line.
- `record-pr still records {number, url} when deriving the branch throws` — keeps its marker assertion, so a stub that never fires fails the test. If `hooks.js` holds `deriveBranch` in a way a module-object replacement cannot reach, leave this test on its preload spawn with the comment `// real process: the fault is injected at module load, which only a preload can do`, and report it.

The `#4932` test stays as it is (it calls `main` to reach `realDeps.stderr`, which `runCli` replaces); note it in the task report for the PR body.

- [ ] **Step 5: Add the smoke and injected-value tests**

- `AC5.1: reconcile --json on a no-remote fixture through runCli and spawnCli prints the same JSON, exit 0` in `reconcile-dispatch`.
- `hooks-verb-exception-exit` adds none: its two real-process tests are its script-entry coverage.

Name or add each file's AC6.1 test and run the injected-value proof.

- [ ] **Step 6: Run the two files and count processes**

Run: `node --test tests/reconcile-dispatch.test.js tests/hooks-verb-exception-exit.test.js`
Expected: PASS, with at least Step 1's test count per file and no leaked-process-state error (AC4.1)

Then count: `reconcile-dispatch` ≤ 2 (the tool logs 1; the #4897 preload test is the second), `hooks-verb-exception-exit` ≤ 3.

- [ ] **Step 7: Commit**

```bash
git add tests/reconcile-dispatch.test.js tests/hooks-verb-exception-exit.test.js
git commit -m "Run the reconcile verb tests in-process and keep the exit contracts on real processes — refs #5376"
```

### Task 6: Before/after measurement and the PR-body section

**Role:** integration

**Files:** none in the repository. This task commits nothing: its output is the measurement file `{evidence-dir}/process-counts-5376.md`, where `{evidence-dir}` is the run directory's `evidence/` folder, given as an absolute path in the dispatch prompt. Write it with a plain shell redirect from a file composed in the scratch directory (`cp` is fine); the Write tool is refused outside the worktree.

**Interfaces:**
- Consumes: the five converted commits; `tools/count-node-procs.js`; the task reports of Tasks 1-5, supplied in the dispatch prompt.
- Produces: the measurement file, whose content the controller copies into the PR body and cites in the run's decision log.

- [ ] **Step 1: Measure before and after, back to back**

Both runs on this machine within the same hour, `CT_TEST_CONCURRENCY=6`, the same fifteen-file list:
- Before: extract the merge base (`git -C <worktree> merge-base origin/main HEAD`) with `git -C <worktree> archive <sha>` into an empty scratch directory outside the worktree; make it a standalone repo (`git init -q -b main`, `git add -A`, `git write-tree`, `git commit-tree <tree> -m snapshot`, `git checkout -q --detach <commit>`) because `tests/hooks-dispatch-prompt-gate.test.js` runs `git grep` on its own repo; run `tools/count-node-procs.js` there.
- After: run it in the worktree at HEAD.

- [ ] **Step 2: Write the measurement file**

- AC7.1: under the heading `## Process counts`, a table with columns `File`, `hooks.js before`, `hooks.js after`, `wall ms before`, `wall ms after`, one row per file, plus a `| **Total** | {before} | {after} | | |` row, and a line naming the machine, the two run times and `CT_TEST_CONCURRENCY=6`.
- AC1.1: a line stating the after total is at most 25 and the before/after test counts (pass and fail) of the two runs.
- `## Tests left on a real process`: one row per test with its file and the reason, read from the comments the tasks wrote (grep the fifteen files for `// real process:` and for `spawnCli(`).
- `## plugin/bin files changed`: each file under `plugin/bin` in `git -C <worktree> diff --name-only <merge-base>..HEAD`, with the function that now takes the injected value; "none" when the list is empty.
- `## Injected-value proofs (AC6.1)`: per file, the test name and the mutation that turned it red, copied from the task reports the dispatch prompt supplies.
- `## Where the merged helper differs from the record`: the two differences in Global Constraints, plus any a task reported.

- [ ] **Step 3: Check the ceiling against the raw counts**

Read the after run's `--json` output and sum its `cliProcs["hooks.js"]` values with a small script in the scratch directory, then add one for every real-process test the tool cannot log (a test whose `// real process:` comment sits on a call that passes its own `NODE_OPTIONS` through `env`; list each). That total is the table's after total and is at most 25 (AC1.1). Apply the same addition to the before run, reading the merge-base copies of the files, so the two columns count the same way. A sum over 25 is a STOP: report the per-file counts against the allotment table, and do not edit a test to make the number fit.

- [ ] **Step 4: Report**

Quote in the report: the two raw count tables as `tools/count-node-procs.js` printed them, the two test summaries (`ℹ tests`, `ℹ pass`, `ℹ fail`), and the absolute path of the measurement file. No commit.
