# Run the tests of already-injectable CLIs in-process — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move thirteen test files off real node processes onto `tests/helpers/run-cli.js`, so they start at most 30 processes of the eleven CLIs they cover (156 today), by making each CLI meet the entry contract.

**Architecture:** Each covered CLI exports `run(argv, deps)` and a module-level `realDeps` whose members read process globals when called. `run` merges the caller's `deps` over `realDeps` and reaches cwd, env, stdio and child processes only through them. Each test file's local spawn helper calls `runCli`/`runCliSync` and maps `code` onto the field name its assertions already use. One or two `spawnCli` smoke tests per CLI keep the script entry covered.

**Tech Stack:** Node (CI runs Node 20; no npm dependencies), `node:test`, `node:assert`, `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`).

**Spec:** `.claude-tweaks/pipelines/2026-11-14T095430-spec-5383/work/5383-spec.md` (record #5383). Read it in full before a task. Its Gotchas bind every task.

## Global Constraints

- CI runs Node 20. Use no syntax or API newer than Node 20. No npm dependencies.
- Output and exit codes of every CLI stay the same for every invocation a test covers today, with one exception. `check-artifact-overwrite.js`'s `run` takes `process.argv.slice(2)` instead of the whole `process.argv` (Task 9), and its only caller is its own test file.
- The entry contract, verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`." "Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`." "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped." "The process-wide timeout knobs are the named exception".
- The `realDeps` shape, from the spec: "a module-level `realDeps` whose members read the globals when they are called (`cwd: () => process.cwd()`, `stdout: (s) => process.stdout.write(s)`, `env` read at call time), and `run(argv, deps = {})` spreads the caller's `deps` over it, so nothing captured at module load freezes the real environment or working directory." Write `env` as a getter, `get env() { return process.env; }`, so that `{ ...realDeps }` reads it at merge time. Merge as `const d = { ...realDeps, ...deps }` in a CLI whose `run` does not merge today (`log-decision.js`, `build-review-context.js`, `close-out-marker.js`, `plan-retention.js`, `digest-rollover.js`, `release-local.js`). A caller that passes a partial `deps` then keeps the real members it left out.
- A library function that gains an `env` (or `cwd`) option keeps today's behaviour when the option is absent. The default is the inherited environment or `process.cwd()`, so a call that passes no such option produces the same child-process options as before.
- From `.claude/skills/gh-api-module-pattern/SKILL.md`: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" The scan "accepts a literal `windowsHide` in the call's own argument text, or a bare identifier as the last argument whose `const X = { … }` literal names the key. It rejects a spread (`{ ...QUIET, timeout }`)." "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
- From the contract's conversion proof: "Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call". Use two repos: A with no remote, and B with an `origin` and a recorded `origin/HEAD`. Put the CLI's `cwd` in A and `GIT_DIR=<B>/.git` only in the injected `env`. Then a child that inherits the real environment reads A, and a child that got `env: deps.env` reads B. "Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls". `forgePair` in `tests/forge-probe-env.test.js` is the model.
- From the spec's Gotchas: "run calls one at a time (no `Promise.all`, no concurrent subtests: the guard's snapshots are not sound under overlap)". "The `env` passed to `runCli` is the complete environment, not merged over `process.env`: pass `PATH`, `HOME` (and `USERPROFILE` on Windows) and `TMPDIR` where the CLI or its children need them". "A converted file's local helper maps the helper's `code` onto the field name its assertions already use (`status`, `exitCode`), so the test bodies do not change." "Each test left on a real process carries a one-line comment naming the process property it proves."
- From the spec: "A test stays on a real process only when the process is its subject (a signal, a lock held across processes, a detached child, a closed stderr, `process.exit` timing). Use `spawnCli` for it and list it in the PR body." "never let it run with the stub silently skipped."
- Use `runCliSync` for a CLI whose `run` returns an integer, and `runCli` (awaited) for an async one. A `runCliSync` call against a promise-returning `run` throws, which settles which one fits. Pass an absolute `cliPath` (`path.join(__dirname, …)`).
- Each converted file's assertions keep their exact values. Converting changes how the CLI is called, never what a test expects. A test that passed before still passes.
- **Process budget (binding, AC1).** These are the processes each covered CLI may start across all thirteen files after this change. Each task keeps exactly the smoke tests listed for it:

  | CLI | Real-process tests kept | Processes |
  |---|---|---|
  | `review-coordination.js` | 1 success + 1 refusal `spawnCli` | 2 |
  | `digest-rollover.js` | 1 documented gh-form line through bash (success) + 1 under a gh-less PATH (exit 2) | 2 |
  | `release-local.js` | 1 success + 1 refusal | 2 |
  | `diff-facts.js` | 1 success + 1 refusal | 2 |
  | `log-decision.js` | the 8-process concurrent-append test (success) + 1 refusal | 9 |
  | `risk-flags.js` | 1 in `risk-flags-packet-e2e` (success) + 1 refusal in `risk-flags-cli` | 2 |
  | `acceptance-packet.js` | 1 in `risk-flags-packet-e2e` (success) + 1 refusal in `acceptance-packet-cli` | 2 |
  | `plan-retention.js` | 1 success + 1 refusal | 2 |
  | `check-artifact-overwrite.js` | 1 success + 1 refusal | 2 |
  | `build-review-context.js` | 1 success + 1 refusal, both in `exit-code.test.js` | 2 |
  | `close-out-marker.js` | 1 success + 1 refusal | 2 |
  | **total** | | **29** |

  A success smoke asserts exit 0 and stdout. A refusal smoke asserts the non-zero exit code and stderr. A task that cannot stay within its row stops and reports `NEEDS_CONTEXT` rather than going over. `declined-learning.js` (2, in `plan-retention/cli.test.js`) and `session-tmp-resolve.js` are not covered CLIs and are outside the budget.
- Every converted test file except `tests/close-out-marker-cli.test.js` gets at least one in-process test that passes a non-default `cwd` or `env` and fails when `run` ignores it. Prove each one goes red by reverting the thread-through it covers, and quote the red output in the report. `close-out-marker.js` reads neither value, and the PR body says so.
- A test reads a tracked text file through `readText` from `tests/helpers/read-skill.js`, never a raw `fs.readFileSync(p, 'utf8')` (`tests/raw-markdown-read-conformance.test.js`). JSON files are exempt.
- A test that installs a script stub for `gh` on `PATH` skips on win32 with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`. Join PATH entries with `path.delimiter`, never a literal `:`.
- From `.claude/skills/windows-checkout-test-parity/SKILL.md`: "`toPosix` at the display-ID producer with native fs paths left alone". An expected path a test compares against is built with `path.join`/`path.resolve` exactly as the CLI builds it, never as a hand-written `/`-joined string.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them. Here, the existing real-process tests are the characterization: run each task's files green before changing them.
- Commit message style: `{Verb} {what} — {detail}`, body line `refs #5383` (never "closes"/"fixes"), final line `Claude-Session: https://claude.ai/code/session_01JHXvgVqQhEPnaEShgxVfGt`. Stage files by explicit path. Never `git reset`, never `git checkout .`, never force push.
- Run only the test files a task names (`node --test <file> [<file>…]`), plus `node --test tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js` after any `plugin/bin` change. Never run `npm test` or `tools/run-tests.js` with no file list: the full suite runs centrally. Quote raw command output in the report, never a summary of it.

Governing project skills: `gh-api-module-pattern` (and its `cli-wrapper-contract.md`) and `windows-checkout-test-parity` are quoted above. `bin-source-scan-conformance` does not apply: no source-scan suite is added or changed. `lib-module-split` does not apply: no module is split or moved.

## Corrections to the spec's premises (decided at plan time)

1. The merged helper (#5374) differs from the spec's text in two ways. It also exports `runCliSync` for a synchronous `run`. `spawnCli`'s `env` defaults to `process.env`, not `{}`. The merged version governs (spec, last Gotcha), and the PR body names both differences.
2. `review-coordination.js`, `log-decision.js`, `risk-flags.js`, `acceptance-packet.js`, `build-review-context.js` and `close-out-marker.js` already build a module-level `realDeps` and do not export it. `diff-facts.js` and `check-artifact-overwrite.js` build their defaults inline in `run`. `release-local.js` builds them per call in `defaultDeps(root)`. So the spec's list of CLIs that "build their defaults inside `run`" is partly out of date. Every task's deliverable is the same either way: an exported module-level `realDeps` and a merging `run`.
3. `digest-rollover.js`'s `realDeps.carryDir` calls `resolvePrinted`, which reads `process.env.CLAUDE_CODE_SESSION_ID` and `os.tmpdir()` and takes no injected env until #5385 lands. This record leaves that read in place and names it in the PR body. The converted tests compute paths with `resolvePrinted` in the test process, which reads the same `process.env` that the in-process CLI reads, so the two agree (AC2).
4. Four `digest-rollover` tests run the skill's documented shell line through bash. Two of those lines stay real (the budget's gh-form success line and its gh-less refusal). The rest become in-process calls. The test extracts the line's argv after `digest-rollover.js`, replaces each `$(node … session-tmp-resolve.js --value X)` with `resolvePrinted(X)`, and calls `runCliSync`. The in-process calls no longer prove the line's shell quoting. The two kept bash lines prove it for the gh form, and the PR body says the file form is now proven by token extraction only.

## Review Focus

1. An in-process call that passes a relative path argument: today the CLIs resolve most path arguments against the real working directory, not `deps.cwd()`. Every converted test passes absolute paths, so behaviour is unchanged. The PR body lists the relative-path sites (sweep kind f) as a follow-up rather than fixing them here. The task review checks that no converted test passes a relative path to such a site.
2. Module state shared between in-process calls in one file: `repo-resolve.js` memos (`explicitRepoHost`, `ghHostSpecs`, `notedGhHosts`) survive from one call to the next. A test whose result depends on them passes `fresh: true`. Tests in Tasks 5 and 12.
3. A real child writing straight to the inherited stdio file descriptors in-process. `release-local.js`'s `runHook` uses `stdio: 'inherit'`, which in-process writes into the test runner's own output and corrupts its stream. Task 11 routes it through `deps.stdout`/`deps.stderr`. Test in Task 11.
4. A converted CLI whose `run` threw (rather than returned) on an unexpected error. The script entry mapped that to exit 1 for `build-review-context.js` only, and in-process the throw reaches the test. Task 10 moves the mapping into `run`. Test in Task 10.
5. `ghAvailable` probing the machine's real `gh` in-process when the test injected a PATH without one. Task 12 threads `env` into the probe. Test in Task 12.

## Spec coverage map

| AC clause | Task(s) |
|---|---|
| AC1.1 (≤30 processes, every test still passing) | Process budget above; every task; Task 13 measures |
| AC2.1 (digest-rollover resolves session paths via `resolvePrinted`, no `session-tmp-resolve.js` start) | Task 12 |
| AC3.1 (acceptance-packet and plan-retention read `CLAUDE_CODE_SESSION_ID` and cwd from injected `env`/`cwd`) | Tasks 5, 8 |
| AC4.1 (no converted call writes to real stdout/stderr) | Every task, through the helper's leak guard |
| AC5.1 (one or two `spawnCli` tests per CLI: success and refusal) | Process budget above; every task |
| AC6.1 (each converted file has a non-default `cwd`/`env` in-process test that goes red without the thread-through) | Every task except Task 1 (named exempt) |
| AC7.1 (PR body before/after table, `CT_TEST_CONCURRENCY=6`, same machine and hour, every real-process test listed with reason) | Task 13 |
| AC8.1 (full `npm test` and Windows CI pass) | Task 13, then central verification |

---

### Task 1: `close-out-marker.js` exports `realDeps`; `tests/close-out-marker-cli.test.js` in-process

**Files:**
- Modify: `plugin/bin/close-out-marker.js` (realDeps @198, run @207, exports @291)
- Test: `tests/close-out-marker-cli.test.js` (spawns @652, @670, @693)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, realDeps }`. `run(argv, deps = {})` merges `{ ...realDeps, ...deps }`.

- [ ] **Step 1: Run the file green before changing it.** `node --test tests/close-out-marker-cli.test.js`, expected all pass.
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/close-out-marker.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Export `realDeps` and merge in `run`.** Its members already read globals at call time.
- [ ] **Step 4: Convert the six spawns.** The three "subprocess: …" tests become `runCliSync(BIN, argv)` calls through a local helper that returns `{ status: code, stdout, stderr }`. Keep exactly two `spawnCli(BIN, argv)` tests: one success (exit 0 plus stdout, `bodyWritten`) and one refusal (non-zero exit plus stderr). Each gets a one-line comment: `// real process: proves the script entry and exit code`. Tests that read files the CLI wrote keep reading them by absolute path.
- [ ] **Step 5: Run** `node --test tests/close-out-marker-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`, expected all pass. Then `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <a file listing tests/close-out-marker-cli.test.js>`, expected `close-out-marker.js` 2.
- [ ] **Step 6: Commit** `Run close-out-marker's CLI tests in-process — export realDeps, keep two spawn smokes`.

### Task 2: `log-decision.js` exports `realDeps`; `tests/bin-lib/log-decision/append.test.js`

**Files:**
- Modify: `plugin/bin/log-decision.js` (realDeps @56, run @64, exports @163)
- Test: `tests/bin-lib/log-decision/append.test.js` (concurrent test @228)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, realDeps }`. `run(argv, deps = {})` merges `{ ...realDeps, ...deps }`. `risk-flags.js` (Task 4) passes `{ now, cwd, mainRoot, stdout, stderr }` through whole, and that still works.

- [ ] **Step 1: Run the file green.** `node --test tests/bin-lib/log-decision/append.test.js`.
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/log-decision.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Export `realDeps` and merge in `run`.**
- [ ] **Step 4: Tests.** Keep the 8-process concurrent test as it is, with its comment `// real processes: proves the cross-process lock never drops an entry (#816)`, and have it also collect each child's stdout and assert the echoed line, so it is the success smoke. Add `test('AC6.1: an in-process append anchors the run dir under the injected cwd', …)`. Use a tmp root with a fake `.git` directory and a run dir under its `.claude-tweaks/pipelines/`, call `runCliSync(CLI, ['--run', runDir, '--status', 'AUTO', '--text', 'in-process'], { cwd: root, env: {} })` with `cwd` set to that root, which differs from the test runner's cwd, and assert exit 0 and the line in `decisions.md`. Show it red by passing `realDeps.cwd` through (revert the merge so `deps.cwd` is ignored) and quote the failure. Add one `spawnCli` refusal: no `--run`, non-zero exit, stderr names the problem.
- [ ] **Step 5: Run** the file plus the three conformance suites. Count: `log-decision.js` 9.
- [ ] **Step 6: Commit** `Export log-decision's realDeps — in-process cwd test beside the concurrent-append processes`.

### Task 3: `review-coordination.js` exports `realDeps`; `tests/bin-lib/review-coordination/cli.test.js` in-process

**Files:**
- Modify: `plugin/bin/review-coordination.js` (realDeps @102, run @111, entry @288-290, exports @292)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (helper `runCli(args, opts)` @12, about 44 spawns)

**Interfaces:**
- Produces: `module.exports = { run, realDeps }`. Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/review-coordination.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Export `realDeps`; the entry passes it as the last statement.**
- [ ] **Step 4: Rename the file's local `runCli(args)` and route it through `runCliSync`.** Rename it `cli(args)` so it does not shadow the helper's `runCli`, and update its call sites. It returns `{ code, stdout, stderr }` as today. On exit 0 today's helper has no `stderr` key, and no assertion reads it there, so returning `''` is safe. Inject `now` where a test compares the `logLine` (the file's `TB_NOW`). Keep two `spawnCli` smokes: one success (`categorise-reproduction` exit 0 plus stdout) and one refusal (an arity failure, exit 2 plus usage stderr). Add `test('AC6.1: write-findings anchors under the injected cwd', …)` with an injected `cwd` that differs from the runner's, and show it red by ignoring `deps.cwd`.
- [ ] **Step 5: Run** the file plus the conformance suites. Count: `review-coordination.js` 2.
- [ ] **Step 6: Commit** `Run review-coordination's CLI tests in-process — export realDeps`.

### Task 4: `risk-flags.js` exports `realDeps` and threads `env`; `tests/risk-flags-cli.test.js`

**Files:**
- Modify: `plugin/bin/risk-flags.js` (realDeps @191, `execFile` @202, run @470, exports @560)
- Test: `tests/risk-flags-cli.test.js` (spawning tests @584, @758; its `runCli` @80 is already in-process and is left alone)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, USAGE, realDeps }`. `realDeps.env` getter. `realDeps.execFile(file, args, cwd, env)` passes `{ cwd, env, encoding: 'utf8', windowsHide: true, stdio: … }`, and `run` calls it with `deps.cwd()` and `deps.env`. `logRemovals` keeps passing `{ now, cwd, mainRoot, stdout, stderr }` to `log-decision.js`'s `run`.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/risk-flags.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Export `realDeps`, add the `env` getter, thread `env` into `execFile`.**
- [ ] **Step 4: Tests.** The six spawns: the `classify` success (@586) moves to `risk-flags-packet-e2e` as that file's kept test (Task 6), so it is removed here. Every other case becomes `runCliSync(BIN, argv, { env: {...} })` with the same assertions. Keep exactly one `spawnCli` refusal (a usage exit 2, empty stdout, stderr `^risk-flags\.js: `). Add `test('AC6.1: classify with no --repo-root resolves the repo root from the injected cwd and env', …)` using the env-only `GIT_DIR` fixture pair, so the `git rev-parse --show-toplevel` child must get `env: deps.env`. Show it red by dropping `env` from `execFile`.
- [ ] **Step 5: Run** the file plus the conformance suites.
- [ ] **Step 6: Commit** `Thread env into risk-flags' git child — export realDeps, run its CLI tests in-process`.

### Task 5: `acceptance-packet.js` exports `realDeps`, reads env/cwd through deps; `tests/acceptance-packet-cli.test.js`

**Files:**
- Modify: `plugin/bin/acceptance-packet.js` (realDeps @172-215, run @860, exports @874)
- Modify: `plugin/bin/lib/verify/report.js` (`gitDir` @62-64 gains an optional `env`)
- Test: `tests/acceptance-packet-cli.test.js` (`--help` spawn @126, `cli(...)` @1902 in the test @1881)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, droppedEntry, realDeps }`. `realDeps.env` getter. `realDeps.git(args, { cwd, env })`, `realDeps.gitDir({ cwd, env })` and `realDeps.tmpPath(name, env)` read the session id from `env.CLAUDE_CODE_SESSION_ID`. `run` passes `deps.cwd()` and `deps.env` to each call site. `gitDir(opts)` in `lib/verify/report.js` accepts `{ cwd, env }`, and both default to today's values.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/acceptance-packet.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Export `realDeps` and thread `cwd`/`env` through `git`, `gitDir` and `tmpPath`.** The `gh`, `ghAvailable` and `pinGhHost` seams stay unchanged. `gh` is force-faked by the helper, and every test fakes the other two. The PR body lists all three as not threaded, with that reason.
- [ ] **Step 4: Tests.** The four spawns in "real subprocess: snapshot then gather over a real repo" (@1881) become `runCliSync(BIN, argv, { cwd: repo, env: realGitEnv() })` with real `git`/`gitDir`, a fake `gh` and `fresh: true`. `--help` exits 0, so it moves in-process. The file's one `spawnCli` test becomes a refusal: an unknown verb, non-zero exit plus stderr. The success smoke is in Task 6. Add `test('AC3.1: tmpPath follows the injected CLAUDE_CODE_SESSION_ID and cwd, not process.env', …)`: with `process.env.CLAUDE_CODE_SESSION_ID` holding a different value (restore it in `finally`, outside the `runCliSync` call), a `--pr` post path lands under the injected session's tmp dir. Add `test('AC6.1: snapshot reads the git dir from the injected env', …)` with the `GIT_DIR` fixture pair. Show both red by reverting their thread-through.
- [ ] **Step 5: Run** the file plus `tests/bin-lib/verify/*.test.js` (`gitDir`'s own suite) and the conformance suites.
- [ ] **Step 6: Commit** `Read acceptance-packet's session id, git and git dir through deps — export realDeps`.

### Task 6: `tests/risk-flags-packet-e2e.test.js` keeps one real end-to-end test

**Files:**
- Test: `tests/risk-flags-packet-e2e.test.js` (helper `spawn(bin, args)` @27, three tests)

**Interfaces:**
- Consumes: Task 4's and Task 5's `realDeps` exports.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the conversion has not happened**

Run: `node -e "process.exit(require('fs').readFileSync('tests/risk-flags-packet-e2e.test.js','utf8').includes('runCliSync') ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Convert.** The first test (@31: one `risk-flags.js` then one `acceptance-packet.js`) stays on `spawnCli` for both. It is the success smoke for both CLIs: assert exit 0 and stdout for each step, with the comment `// real processes: the shipped bins end to end in a directory that is not a git checkout`. The other two tests call `runCliSync` with `cwd: dir` and injected `git`/`gitDir` fakes that report "not a git checkout", so the non-checkout condition holds in-process. The stale-output-removal assertions stay unchanged. One of the in-process tests passes `cwd: dir` and fails when `cwd` is ignored (AC6.1).
- [ ] **Step 4: Run** the file. Count: `risk-flags.js` 1 and `acceptance-packet.js` 1 here.
- [ ] **Step 5: Commit** `Run two of the risk-flags/packet end-to-end tests in-process — keep one real pipeline`.

### Task 7: `diff-facts.js` exports `realDeps`; `tests/diff-facts-cli-e2e.test.js`

**Files:**
- Modify: `plugin/bin/diff-facts.js` (run @25-27, exports @56, entry @58)
- Modify: `plugin/bin/lib/blast-radius-cli.js` (`defaultGit` @30-31 gains optional `{ cwd, env }`)
- Test: `tests/diff-facts-cli-e2e.test.js` (helper `runCli(cwd, args)` @15)

**Interfaces:**
- Produces: `module.exports = { run, realDeps }`. `realDeps = { stdout, stderr, cwd, get env(), git: (args, { cwd, env }) => … }`. `run(argv, deps = {})` merges and passes `git` bound to `deps.cwd()`/`deps.env` into the blast-radius code.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/diff-facts.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Move the inline defaults into an exported `realDeps`; thread `cwd`/`env` into git.** Entry: `run(process.argv.slice(2), realDeps)`.
- [ ] **Step 4: Tests.** Convert the local helper to `runCliSync(CLI, args, { cwd, env: gitEnv })` returning `{ status: code, stdout, stderr }`. Keep one `spawnCli` success test (the first fixture-repo case) and one `spawnCli` refusal (a flag-parsing exit with `^diff-facts: ` stderr). The fixture-repo cases are the AC6.1 test: cwd is the tmp repo. Show red by ignoring `deps.cwd` in git.
- [ ] **Step 5: Run** the file plus `tests/bin-lib/blast-radius*.test.js` and the conformance suites. Count: `diff-facts.js` 2.
- [ ] **Step 6: Commit** `Give diff-facts an exported realDeps with a cwd-bound git — tests in-process`.

### Task 8: `plan-retention.js` takes write functions and reads cwd/env through deps; `tests/bin-lib/plan-retention/cli.test.js`

**Files:**
- Modify: `plugin/bin/plan-retention.js` (realDeps @102-113, run @116)
- Modify: `plugin/bin/lib/declined-learning/store.js` (anchor @72 gains an optional `cwd`)
- Test: `tests/bin-lib/plan-retention/cli.test.js` (`spawnCli(repo, args)` @244; in-process `fakeDeps`/`invoke` @27/@41)

**Interfaces:**
- Produces: `realDeps = { git: (args, { cwd, env }) => …, lookupDecline: (…, { cwd }) => …, today, stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s), cwd: () => process.cwd(), get env() }`. `run` calls `deps.stdout(text)`/`deps.stderr(text)`, never `.write`.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm stdout is still a stream**

Run: `node -e "process.exit(typeof require('./plugin/bin/plan-retention.js').realDeps.stdout === 'function' ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Change `stdout`/`stderr` to write functions** and update `fakeDeps` in the test file to match, in the same change. Thread `deps.cwd()`/`deps.env` into `git` and `deps.cwd()` into `lookupDecline`'s store anchor. Merge `{ ...realDeps, ...deps }` in `run`.
- [ ] **Step 4: Tests.** The CLI spawns become `runCliSync(CLI, args, { cwd: repo, env: gitEnv })`. Keep one `spawnCli` success and one `spawnCli` refusal (bad argument, non-zero exit plus stderr). The two `declined-learning.js` spawns stay, since that CLI has no `run` until #5385. The test @265 keeps the real store round trip, and its CLI half runs in-process with `cwd` set to the fixture. Add `test('AC3.1: plan-retention reads CLAUDE_CODE_SESSION_ID and the working directory from the injected env and cwd', …)`: injected `cwd` is the fixture repo and `process.env` differs, and the output follows the fixture. Show red by restoring `cwd: process.cwd()` in `git`.
- [ ] **Step 5: Run** the file plus `tests/bin-lib/declined-learning/*.test.js` and the conformance suites. Count: `plan-retention.js` 2.
- [ ] **Step 6: Commit** `Thread cwd and env through plan-retention's git and decline store — write-function io, tests in-process`.

### Task 9: `check-artifact-overwrite.js` takes write functions and the standard argv; its CLI test in-process

**Files:**
- Modify: `plugin/bin/check-artifact-overwrite.js` (run @56-61, entry @137-139, exports @141)
- Modify: `plugin/bin/lib/flow/artifact-overwrite-check.js` (`checkArtifactOverwrite` @455 and `defaultGit` @116 gain optional `env`)
- Test: `tests/bin-lib/flow/check-artifact-overwrite-cli.test.js` (`spawnCli(dir, args)` @182, inline spawn @116, `fakeIo()` @19)

**Interfaces:**
- Produces: `module.exports = { run, realDeps }`. `run(argv, deps = {})` with `argv` = `process.argv.slice(2)`. `realDeps = { stdout(text), stderr(text), cwd, get env(), check: (opts) => checkArtifactOverwrite(opts), readFile }`. `run` passes `cwd: deps.cwd(), env: deps.env` in the check options. Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 1: Run the file green.** Grep the importers of `check-artifact-overwrite` across `plugin/`, `tests/`, `tools/`, `perf/` and `evals/`. Today the only caller of `run` is this test file. `tests/bin-lib/flow/artifact-overwrite-check.test.js` only spawns it.
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/check-artifact-overwrite.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Implement.** Write functions, standard argv, an exported `realDeps`, and `cwd`/`env` threaded into the check and its git child. Update `fakeIo()` and every in-process call's argv in the same change, dropping the leading `'node', 'check-artifact-overwrite.js'`.
- [ ] **Step 4: Tests.** The seven spawns: keep one `spawnCli` success (the clean-walk end-to-end @100, comment naming the script entry) and one `spawnCli` refusal. The rest go through `runCliSync` with `cwd: dir`. The end-to-end real-repo cases run in-process with real `check` and `cwd: dir`, and they are the AC6.1 test. Show red by dropping `cwd` from the check options.
- [ ] **Step 5: Run** the file plus `tests/bin-lib/flow/artifact-overwrite-check.test.js` and the conformance suites. Count: `check-artifact-overwrite.js` 2 in the converted file. The spawns in `artifact-overwrite-check.test.js` are outside this record's thirteen files.
- [ ] **Step 6: Commit** `Give check-artifact-overwrite write-function io and the standard argv — tests in-process`.

### Task 10: `build-review-context.js` exports `realDeps` and maps a throw to exit 1 in `run`; both review-context tests

**Files:**
- Modify: `plugin/bin/build-review-context.js` (realDeps @40, run @47, entry @84-91, exports @93)
- Modify: `plugin/bin/lib/review-context/build.js` (`realGit` @18-19 and `realLsof` @29 take `{ cwd, env }`, and `resolveDir` @45-58 resolves a relative `--dir`/`--run` against an injected `cwd`)
- Test: `tests/bin-lib/review-context/build.test.js` (inline spawns @127, @135, @158, @253, @851)
- Test: `tests/bin-lib/review-context/exit-code.test.js` (five spawns)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, realDeps }`. `realDeps = { resolveDir, buildContext, stdout, stderr, cwd, get env() }`. `run` passes `cwd: deps.cwd(), env: deps.env` into `buildContext`, and catches an unexpected throw by writing `build-review-context.js: {message}\n` to `deps.stderr` and returning 1. Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 1: Run both files green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/build-review-context.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Implement.** Thread through `realGit`/`realLsof`/`resolveDir` with defaults unchanged when no option is passed. The entry is the single contract statement. Add `test('a throw inside build maps to exit 1 with a build-review-context.js: stderr line', …)` in-process with a `buildContext` fake that throws.
- [ ] **Step 4: Tests.** `build.test.js`: every spawn becomes `runCliSync(CLI, argv, { cwd, env })`. The #3017 subdirectory test (@151) runs in-process with `cwd: path.join(repo, 'sub')` and real `buildContext`, and it is the AC6.1 test. Show red by ignoring `deps.cwd`. `exit-code.test.js`: keep exactly two `spawnCli` tests, the "mint with no --run exits 0" success and the "unknown command exits 2" refusal. Convert the other three to `runCliSync`, with `--print-dir`'s exact bytes still asserted on `stdout`. Clean every tmp dir a `mint` creates, in `t.after`.
- [ ] **Step 5: Run** both files plus `tests/bin-lib/review-context/*.test.js` and the conformance suites. Count: `build-review-context.js` 2.
- [ ] **Step 6: Commit** `Run the review-context CLI tests in-process — export realDeps, map a build throw to exit 1 in run`.

### Task 11: `release-local.js` exports `realDeps`, its entry calls `run`; `tests/bin-lib/release-local/acceptance.test.js`

**Files:**
- Modify: `plugin/bin/release-local.js` (run @127, `defaultDeps(root)` @345-385, `main` @388-395, entry @397, exports @399)
- Test: `tests/bin-lib/release-local/acceptance.test.js` (helper `runCli(root, args)` @16, `ENV` @14)

**Interfaces:**
- Produces: `module.exports = { run, parseArgs, defaultDeps, realDeps, writeInsideRoot, USAGE }`. `defaultDeps` stays exported while `tests/bin-lib/release-local/cli.test.js` imports it. `realDeps` carries `cwd`, `get env()`, `stdout`, `stderr`, and the root-independent members. `run(argv, deps = {})` resolves `--root` against `deps.cwd()` (or uses `deps.cwd()` when it is absent), stat-checks it and returns 2 with `root is not a directory: {root}\n{USAGE}\n` on `deps.stderr`, then builds its root-bound `git`/`runHook` from `defaultDeps(root, { env: d.env })` for any member the caller did not supply. `runHook` spawns with `stdio: ['ignore', 'pipe', 'pipe']`, `env`, `cwd: root`, `shell: true`, `windowsHide: true`, and writes the child's stdout/stderr through `deps.stdout`/`deps.stderr`. Entry: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. `main` is removed.

- [ ] **Step 1: Run the file and `tests/bin-lib/release-local/*.test.js` green.**
- [ ] **Step 2: Confirm the export is missing**

Run: `node -e "process.exit(require('./plugin/bin/release-local.js').realDeps ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Implement.** `run` keeps today's behaviour for a caller passing a full `deps`: `hardening.test.js` and `cli.test.js` pass one, and they stay unchanged and green.
- [ ] **Step 4: Tests.** The helper becomes `runCliSync(CLI, ['--root', root, ...args], { env: ENV_PLAIN })`, where `ENV_PLAIN` is `{ PATH, HOME, GIT_AUTHOR_*, GIT_COMMITTER_* }`. Keep one `spawnCli` success (a full release run) and one `spawnCli` refusal (`--root` naming a file, exit 2, stderr `root is not a directory`). Add `test('AC6.1: the release commit takes its identity from the injected env', …)`: inject `GIT_AUTHOR_NAME=injected-author` and assert it on `git log -1 --format=%an` in the fixture. Show red by dropping `env` from `git`. Add `test('runHook output reaches deps.stdout, not the inherited stdio', …)`: a hook `echo hook-said` shows up in the result's `stdout`.
- [ ] **Step 5: Run** `tests/bin-lib/release-local/*.test.js` plus the conformance suites. Count: `release-local.js` 2.
- [ ] **Step 6: Commit** `Point release-local's entry at run with an exported realDeps — hook output through deps, tests in-process`.

### Task 12: `digest-rollover.js` threads env into its gh probe; `tests/digest-rollover-cli.test.js` without `session-tmp-resolve.js`

**Files:**
- Modify: `plugin/bin/digest-rollover.js` (realDeps @124-134, run @241-247)
- Modify: `plugin/bin/lib/repo-resolve.js` (`ghAvailable(deps = {})` @44-52 gains an optional `deps.env` and `deps.cwd`, passed to the probe's spawn options)
- Test: `tests/digest-rollover-cli.test.js` (`runLine` @408, `resolved` @420, documented-line tests @440, @471, @490, @516)

**Interfaces:**
- Produces: `realDeps` gains `cwd`, `get env()`. `run(argv, deps = {})` merges `{ ...realDeps, ...deps }` and calls `d.ghAvailable({ env: d.env, cwd: d.cwd() })`. `ghAvailable({ env, cwd })` passes them through, and with no option it behaves exactly as today across its 73 callers.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Confirm the conversion has not happened**

Run: `node -e "process.exit(require('fs').readFileSync('tests/digest-rollover-cli.test.js','utf8').includes('resolvePrinted') ? 0 : 1)"`
Expected: FAIL (exit 1)

- [ ] **Step 3: Implement** the merge and the `env` thread into `ghAvailable`. `carryDir` keeps calling `resolvePrinted` (Correction 3).
- [ ] **Step 4: Tests.** `resolved(dir, name)` becomes `resolvePrinted(name)` from `plugin/bin/session-tmp-resolve.js`, called in the test process. Because that reads the real session's tmp dir, every file the tests write there is removed in `t.after` (AC2.1). Of the documented-line tests, keep exactly two `runLine` (bash) calls on the gh form: one verdict line with the stub `gh` on PATH (success, exit 0 plus stdout), and the same line under `noGh(dir)` (exit 2 plus stderr). Comment: `// real process: the documented line runs as written through bash, gh found by PATH`. Every other documented line becomes `runCliSync(CLI, argvFromLine(line), { env, deps: { gh: fakeGh(table) } })`. `argvFromLine` extracts the argv after `digest-rollover.js` and replaces each `$(node … session-tmp-resolve.js --value X)` with `resolvePrinted(X)`. `fakeGh(table)` answers from the same table as the stub (`--version` → version, a missing or `null` key → throws an error whose `stderr` is `HTTP 404: Not Found (<key>)` and whose `status` is 1). The gh-absent cases inject `env: noGh(dir)` and keep the real `ghAvailable`. They are the AC6.1 test: exit 2 only because the probe got the injected PATH. Show red by dropping `env` from the probe, which finds the machine's real `gh` (CI's ubuntu image has `gh`). Pass `fresh: true` to each case that runs the real `ghOptions` memo path. `STUB_SKIP` on win32 stays.
- [ ] **Step 5: Run** the file plus `tests/repo-resolve*.test.js` and the conformance suites. Count: `digest-rollover.js` 2 and `session-tmp-resolve.js` 0.
- [ ] **Step 6: Commit** `Thread env into digest-rollover's gh probe — documented lines in-process via resolvePrinted, two kept through bash`.

### Task 13: Measure and record

**Files:** none committed. This task writes the PR body section and the run-dir evidence.

- [ ] **Step 1: Measure.** In the same hour as the baseline (re-run the baseline at `git merge-base HEAD origin/main` in a detached scratch worktree if the hour has passed), run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <the thirteen files> --json "$PIPELINE_RUN_DIR/evidence/after.json" > "$PIPELINE_RUN_DIR/evidence/after.txt"`. Expected: the eleven covered CLIs' total is at most 30 (AC1.1), and `session-tmp-resolve.js` is 0 in `tests/digest-rollover-cli.test.js` (AC2.1).
- [ ] **Step 2: Log the evidence** with `log-decision.js --status AUTO --step "AC evidence" --text-file {file}`. The file is one line naming AC1.1 and AC2.1, the command shape, the before/after totals, and the evidence path.
- [ ] **Step 3: PR body section (AC7.1).** Include:
  - the before/after table per file and per CLI;
  - every test left on a real process, with its reason;
  - every `plugin/bin/lib` file changed to pass an injected value (`lib/verify/report.js`, `lib/blast-radius-cli.js`, `lib/declined-learning/store.js`, `lib/flow/artifact-overwrite-check.js`, `lib/review-context/build.js`, `lib/repo-resolve.js`);
  - `close-out-marker.js` as reading neither cwd nor env;
  - the sweep hits left unchanged, with reasons: `acceptance-packet.js`'s `gh`/`ghAvailable`/`pinGhHost` and `digest-rollover.js`'s `gh` (force-faked by the helper), `digest-rollover.js`'s `carryDir` (waits on #5385), `lib/file-lock.js`'s `CLAUDE_TWEAKS_LOCK_WAIT_MS` and the shared timeout getters (process-wide knobs, the contract's named exception), and the relative-path resolution sites (sweep kind f, a follow-up);
  - Corrections 1 and 4.
