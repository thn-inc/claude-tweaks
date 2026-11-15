# Give eight small CLIs an injectable entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `record-graph.js`, `blast-radius.js`, `init-verify-scope.js`, `release-bootstrap.js`, `session-tmp-resolve.js`, `declined-learning.js`, `residue.js` and `visual-decide.js` the `run(argv, deps)` + `realDeps` entry contract, and move their eight test files onto `tests/helpers/run-cli.js`, so those files start at most 20 processes of the eight CLIs (114 measured today).

**Architecture:** One task per CLI, each the same move: wrap the body in `run(argv, deps = {})` that merges `const d = { ...realDeps, ...deps }`, return exit codes instead of assigning `process.exitCode`, reach cwd, env, stdin, stdio and child processes only through `d`, export `run` and `realDeps`, and make the guarded entry the file's last statement. Each test file's local spawn helper calls `runCliSync` (sync `run`) or `runCli` (async `run`) and maps `code` onto the field name its assertions already use. One or two `spawnCli` smoke tests per CLI keep the script entry covered.

**Tech Stack:** Node (CI runs Node 20; no npm dependencies), `node:test`, `node:assert`, `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T070456-spec-5385/work/5385-spec.md` (record #5385). Read it in full before a task. Its Gotchas bind every task.

## Global Constraints

- CI runs Node 20. Use no syntax or API newer than Node 20. No npm dependencies.
- No change to any CLI's output or exit code for any invocation (spec Non-Goals: "Any change to output or exit codes."). The no-argument baselines, captured at `27095a279` and saved to `$PIPELINE_RUN_DIR/evidence/noarg-baseline.txt`, are:

  | CLI | exit | stderr (stdout is empty for all eight) |
  |---|---|---|
  | `visual-decide.js` | 1 | `visual-decide: unknown command: (none) — expected start\|stop\|status` |
  | `release-bootstrap.js` | 2 | `missing required --integration-model` + the usage line |
  | `declined-learning.js` | 2 | the two-line usage |
  | `session-tmp-resolve.js` | 1 | `Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...] \| --value filename` |
  | `init-verify-scope.js` | 2 | `init-verify-scope.js: --root <dir> is required` + usage |
  | `record-graph.js` | 2 | `record-graph: unknown command "undefined" (expected: render)` |
  | `blast-radius.js` | 1 | `blast-radius: usage: blast-radius.js (--base <ref> \| --integration-branch <branch>) [--run <dir>]` |
  | `residue.js` | 2 | the usage line |

- The entry contract, verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`." "Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`." "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`), so a trailing slash or a `..` after a symlink still reaches the kernel; `path.resolve(deps.cwd(), p)` only where the CLI already normalized or needs one absolute, normalized value". "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped." "a record converting a CLI whose `realDeps` holds such a seam under another name (for example `execFileSync`, `runPremiseCheck`) adds that name to `FAIL_CLOSED_KEYS` in the same change."
- The `realDeps` shape (#5383's plan, the convention its siblings landed): members read the globals when called — `cwd: () => process.cwd()`, `stdout: (s) => process.stdout.write(s)`, `stderr: (s) => process.stderr.write(s)`, `get env() { return process.env; }`, `stdin: () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }` — so `{ ...realDeps }` reads them at merge time and nothing captured at module load freezes the real environment.
- A library function that gains an `env`, `cwd` or `tmpdir` option keeps today's behaviour when the option is absent.
- From `.claude/skills/gh-api-module-pattern/SKILL.md`: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" The scan "accepts a literal `windowsHide` in the call's own argument text, or a bare identifier as the last argument whose `const X = { … }` literal names the key. It rejects a spread (`{ ...QUIET, timeout }`)." "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**"
- From the contract's conversion proof: "Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call": repo A with no remote, repo B with an `origin` and a recorded `origin/HEAD`, the CLI's `cwd` in A and `GIT_DIR=<B>/.git` only in the injected `env`; "Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls". `forgePair` in `tests/forge-probe-env.test.js` is the model.
- From the spec's Gotchas: "run calls one at a time (no `Promise.all`, no concurrent subtests: the guard's snapshots are not sound under overlap)". "The `env` passed to `runCli` is the complete environment, not merged over `process.env`: pass `PATH`, `HOME` (and `USERPROFILE` on Windows) and `TMPDIR` where the CLI or its children need them, and give `runCli` and `spawnCli` the identical explicit `env` when comparing them." "A converted file's local helper maps the helper's `code` onto the field name its assertions already use (`status`, `exitCode`), so the test bodies do not change." "Each test left on a real process carries a one-line comment naming the process property it proves." "A test stays on a real process only when the process is its subject (a signal, a lock held across processes, a detached child, a closed stderr, `process.exit` timing)." "never let it run with the stub silently skipped."
- Use `runCliSync` for a CLI whose `run` returns an integer and `runCli` (awaited) for an async one; pass an absolute `cliPath`. Each converted file's assertions keep their exact values.
- **Process budget (binding, AC1.1).** Processes of the eight CLIs each converted file may start after this change:

  | CLI | Real-process tests kept | Processes |
  |---|---|---|
  | `record-graph.js` | 1 success `spawnCli` + the no-arg refusal | 2 |
  | `blast-radius.js` | 1 success + the no-arg refusal | 2 |
  | `init-verify-scope.js` | 1 success + the no-arg refusal | 2 |
  | `release-bootstrap.js` | 1 success + the no-arg refusal | 2 |
  | `session-tmp-resolve.js` | 1 success + the no-arg refusal + the bash command-substitution test (2 CLI starts; its subject is the shell line) | 4 |
  | `declined-learning.js` | 1 success (also AC3.1's spawned side) + the no-arg refusal | 2 |
  | `residue.js` | 1 success + the no-arg refusal | 2 |
  | `visual-decide.js` | 1 success: a real `start` (CLI + its detached daemon) stopped by an in-process `stop` that signals the real daemon (AC4.2) + the no-arg refusal | 3 |
  | **total** | | **19** |

  The no-arg refusal smoke is AC6.1's test for that CLI and asserts the exact baseline above. A success smoke asserts exit 0 and stdout. A task that cannot stay within its row stops and reports `NEEDS_CONTEXT` rather than going over.
- Each converted test file gets at least one in-process test that passes a non-default `cwd` or `env` and fails when `run` ignores it (AC9.1). Prove it red by reverting the thread-through it covers, and quote the red output in the report.
- Each task deletes its CLI's line from `NOT_YET` in `tests/bin-lib/cli-entry-conformance.test.js` (the test fails with "now conforms — delete it from NOT_YET" otherwise). `NOT_YET_CEILING` stays 27: "A ratchet, not a pin: the list only shrinks, and the sibling records of #5373 delete their own lines without ever editing this constant."
- Source-scan suites pinning these files: `tests/path-guard-conformance.test.js` allowlists exactly 2 `existsSync` in `lib/visual-decide/cli.js` and flags any new bare `fs.existsSync`/`fs.realpathSync` in `plugin/bin/lib/` (use `lstatType` from `plugin/bin/lib/path-guard`); `tests/gh-host-seam-conformance.test.js` pins three literal shapes in `residue.js` — `const wrap = argv[0] === 'gh' ? ghOptions : `, `execFileSync(argv[0], args, wrap(args, {` and `probeForge({ scope, run, ` — keep each byte-for-byte; `tests/bin-lib/exit-code-conformance.test.js` reads each file's last `require.main` block.
- A test reads a tracked text file through `readText` from `tests/helpers/read-skill.js`, never a raw `fs.readFileSync(p, 'utf8')`. A test that installs a script stub on `PATH` skips on win32 with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`; join PATH entries with `path.delimiter`.
- From `.claude/skills/windows-checkout-test-parity/SKILL.md`: "`toPosix` at the display-ID producer with native fs paths left alone". An expected path a test compares against is built with `path.join`/`path.resolve` exactly as the CLI builds it.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it. Here the existing real-process tests are the characterization: run each task's file green before changing it.
- Commit message style: `{Verb} {what} — {detail}`, body line `refs #5385` (never "closes"/"fixes"), final line `Claude-Session: https://claude.ai/code/session_01Ngy9oYwvuepUCC7ySACcyS`. Stage files by explicit path. Never `git reset`, never `git checkout .`, never force push.
- Run only the files a task names (`node --test <file> …`), plus `node --test tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js` after any `plugin/bin` change. Never run `npm test` with no file list: the full suite runs centrally. Quote raw command output in the report.

Governing project skills: `gh-api-module-pattern` (with `cli-wrapper-contract.md`) and `windows-checkout-test-parity` are quoted above. `bin-source-scan-conformance` does not apply: no source-scan suite is added, and the only edit to a scan suite is deleting `NOT_YET` lines. `lib-module-split` does not apply: no module is split (Task 5 moves one function, `envTmpdir`, and re-exports it from its old home).

## Corrections to the spec's premises (decided at plan time)

1. Baseline: one run of `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <the eight files>` on 2026-11-15 at `27095a279`, 89 tests, 0 failures, gave 114 CLI processes (spec: 112): visual-decide 27, release-bootstrap 19, session-tmp-resolve 15, declined-learning 13, init-verify-scope 13, record-graph 12, blast-radius 8, residue 7. Raw output: `$PIPELINE_RUN_DIR/evidence/baseline.txt`. The PR body carries the measured number.
2. The merged helper (#5374) exports `runCliSync` too, its `spawnCli` `env` defaults to `process.env` (not `{}`), and its `FAIL_CLOSED_KEYS` is `['runner', 'gh', 'ghAvailable', 'runHook', 'spawn']`. The merged versions govern; the PR body names the differences from the spec's text.
3. `session-tmp-resolve.js` reads the temp directory through `os.tmpdir()`, which reads the real `process.env`. The spec asks for the session id **and** temp directory through `deps.env`. `lib/review-context/build.js` already has `envTmpdir(env, platform)` (resolves the way `os.tmpdir()` does, tested in `tests/bin-lib/review-context/exit-code.test.js`). Task 5 moves it into `lib/session-tmp.js` and `build.js` imports and re-exports it, so one implementation serves both.
4. `visual-decide`'s in-process stop (spec Gotcha): the daemon's `run` takes a `deps.onStarted({ info, stop })` hook (real value: a no-op) and resolves only after `stop` has closed the server and removed its `SIGTERM`/`SIGINT` handlers. The server writes `pid: process.pid` into `server-info`, so an in-process daemon records the **test runner's** pid; `stop` therefore signals through a `deps.kill(pid, signal)` seam, and an in-process `start` test fakes `spawn` to run the server in-process and fakes `kill` to call its `stop`. Never let an in-process test reach `process.kill` with `process.pid`.
5. AC7.2 does not trigger: after this record `NOT_YET` still holds 17 entries.
6. AC4.2 narrowed (decided by the user at plan review, spec `## Plan Review Clarifications`): only the test whose subject is the signal path keeps a real daemon — Task 8's success smoke, a real `start` stopped by a real SIGTERM. The status test's "crashed" step and the stale-PID stop test, which SIGKILL a daemon only to produce a dead one, run in-process (Task 8 Step 5). The PR body records the narrowing.

## Review Focus

1. A relative path argument under an injected `cwd`: `record-graph`'s `<json>` and `--out`, `blast-radius`'s `--run`, `init-verify-scope`'s `--root`, `release-bootstrap`'s `--root`/`--extra-file`, `visual-decide`'s `--dir`/`--state`. Each must resolve against `deps.cwd()`, and a task whose CLI takes one adds a relative-path case under an injected cwd (it doubles as AC9.1 where it fits).
2. A `git`/`gh`/`npm` child that inherits the test runner's env: `blast-radius`'s `defaultGit`, `release-bootstrap`'s `git tag -l`, `residue`'s runner, `probeWorktrees`' `defaultIsDirty` and its `npm test` suite run. Each gets `env: deps.env` and `cwd` from `deps.cwd()`; Tasks 2, 4 and 7 prove one with the env-only `GIT_DIR` fixture.
3. `declined-learning`'s store landing in this checkout: `recordDecline` anchors through `anchorRoot()` with no argument, i.e. the real cwd. Task 6 threads `cwd` into `recordDecline` and `lookupDecline`, and its in-process tests pass a fixture `cwd`. Test in Task 6 asserts the fixture store file exists and this checkout's does not change.
4. `visual-decide`'s signal listeners and open handles surviving an in-process call: `run` must remove what it registered and close the server and idle timer before resolving. Test in Task 8 (AC4.1, plus an open-handle check).
5. Module state shared across in-process calls: `require.cache` for `plugin/bin` survives between calls in one file. A case depending on clean module state passes `fresh: true`; a case that passes only in one order is a leak to fix.

## Spec coverage map

| AC clause | Task(s) |
|---|---|
| AC1.1 (≤20 processes of the eight CLIs, every test still passing) | Process budget above; every task; Task 9 measures |
| AC2.1 (`runCli(session-tmp-resolve, ['--value','x.json'], { env: { CLAUDE_CODE_SESSION_ID: 's1' } })` prints a path containing `s1` while `process.env.CLAUDE_CODE_SESSION_ID` holds another value) | Task 5 |
| AC3.1 (in-process `declined-learning.js` reads `stdin` and matches the spawned stdout) | Task 6 |
| AC4.1 (SIGTERM/SIGINT listener counts unchanged after an in-process start-and-stop) | Task 8 |
| AC4.2 (tests that signal a running server keep a real process — narrowed per correction 6) | Task 8 |
| AC5.1 (`require()` of `record-graph.js`, `blast-radius.js`, `visual-decide.js` prints nothing, `process.exitCode` undefined) | Tasks 1, 2, 8 |
| AC6.1 (no-arg script run prints the same stdout, stderr and exit code as before) | Every task (its no-arg refusal smoke) |
| AC7.1 (the eight removed from `NOT_YET`, test passes) | Every task |
| AC8.1 (one or two `spawnCli` tests per CLI: success and refusal) | Process budget; every task |
| AC9.1 (each converted file has an in-process non-default `cwd`/`env` test that fails when `run` ignores it) | Every task |
| AC10.1 (PR body before/after table, `CT_TEST_CONCURRENCY=6`, same machine and hour; every real-process test listed with its reason) | Task 9 |
| AC11.1 (full `npm test` and Windows CI pass) | Task 9, then central verification |

Waived AC7.2: `NOT_YET` keeps 17 entries after this record, so its "if the list is then empty" condition never holds (correction 5).

---

### Task 1: `record-graph.js` — injectable entry; `tests/bin-lib/record-graph/cli-render.test.js` in-process

**Role:** integration

**Files:**
- Modify: `plugin/bin/record-graph.js` (whole file, 95 lines; top-level `main();` at the end)
- Modify: `tests/bin-lib/record-graph/cli-render.test.js` (spawns @20, @29, @42, @53, @64, @128)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'record-graph.js',` from `NOT_YET`)

**Interfaces:**
- Produces: `module.exports = { run, realDeps, parseArgs }`. `run(argv, deps = {}) -> integer`; `realDeps = { stdout, stderr, cwd, now }` with `now: () => new Date()`. `parseArgs(argv, { now })` takes `generatedAt` default from `now().toISOString()`. The `<faceted-json-path>` and `--out` paths are joined onto `deps.cwd()` with `resolveAgainst` from `plugin/bin/lib/health-core/io.js`.

- [ ] **Step 1: Run the file green.** `node --test tests/bin-lib/record-graph/cli-render.test.js`, all pass.
- [ ] **Step 2: Add the failing tests**
  - `test('AC5.1: require() of record-graph.js prints nothing and leaves process.exitCode undefined', …)` — no spawn: call `runCliSync(CLI, ['render', <abs json>, '--format', 'd2', '--work-links', 'native', '--generated-at', 'X'], { fresh: true })`. With `fresh: true` the CLI is re-required inside the helper's snapshot, so a require-time stdout/stderr write or `process.exitCode` change fails the call. Then assert `process.exitCode === undefined` in the test process.
  - `test('AC9.1: a relative <json> path and --out resolve against the injected cwd', …)` — fixture dir `D` (≠ `process.cwd()`) holding `records.json`; `runCliSync(CLI, ['render', 'records.json', '--format', 'd2', '--work-links', 'native', '--out', 'out.d2', '--generated-at', 'X'], { cwd: D })`; assert `code === 0` and `D/out.d2` exists.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/record-graph.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero; today the require also runs `main()` and prints the unknown-command line). The new tests fail with `runCli: record-graph.js exports no run`.

- [ ] **Step 4: Convert `record-graph.js`.** `cmdRender(args, d)` returns its code (2 on each refusal, 0 on success); `main` becomes `run`; the guarded entry is the last statement.
- [ ] **Step 5: Convert the spawns.** A local helper `cli(args)` → `runCliSync(CLI, args, { cwd: … })` returning `{ status: code, stdout, stderr }`. Keep exactly two real-process tests, each with `// real process: proves the script entry and exit code`: `spawnCli(CLI, ['render', <abs json>, '--format', 'd2', '--work-links', 'native', '--generated-at', 'X'])` asserting exit 0 and D2 stdout, and `spawnCli(CLI, [])` asserting `{ code: 2, stdout: '', stderr: 'record-graph: unknown command "undefined" (expected: render)\n' }` (AC6.1). Delete `'record-graph.js',` from `NOT_YET`.
- [ ] **Step 6: Run** the file plus the four conformance suites; all pass. Show AC9.1 red by temporarily replacing the `deps.cwd()` join with the bare path, quote the failure, restore.
- [ ] **Step 7: Commit** `Give record-graph.js an injectable entry — run its CLI tests in-process`.

### Task 2: `blast-radius.js` — injectable entry, `git` child gets cwd and env; `tests/blast-radius-cli-e2e.test.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/blast-radius.js` (whole file; `main(process.argv)` unguarded at the end)
- Modify: `tests/blast-radius-cli-e2e.test.js` (spawns @39, @52, @60, @69, @79, @126, @137, @138)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'blast-radius.js',`)

**Interfaces:**
- Consumes: `computeBlastRadius(opts, { git, readFile })` and `defaultGit(args, { cwd, env })` behaviour from `plugin/bin/lib/blast-radius-cli.js` (already takes `cwd`/`env`; not exported today — export `defaultGit` there, no other change).
- Produces: `module.exports = { run, realDeps }`. `run(argv, deps = {}) -> integer` where `argv` is `process.argv.slice(2)` (today `main` slices itself). `realDeps = { stdout, stderr, cwd, env }`. `run` passes `git: (args) => defaultGit(args, { cwd: d.cwd(), env: d.env })` into `computeBlastRadius`; `--run` is joined onto `d.cwd()` with `resolveAgainst` (`plugin/bin/lib/health-core/io.js`) for the directory check and for `computeBlastRadius`, while the stderr message keeps the user's original string (`--run dir does not exist or is not a directory: ${raw}`). Exit 1 for every failure, as today, with no stdout. Step 2 adds `test('AC9.1: a relative --run that does not exist prints the argument as given', …)` — `runCliSync(CLI, ['--integration-branch', 'main', '--run', 'nope'], { cwd: dir, env })`, asserting exit 1, empty stdout and stderr exactly `blast-radius: --run dir does not exist or is not a directory: nope\n`.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Add the failing tests**
  - `test('AC5.1: require() of blast-radius.js prints nothing and leaves process.exitCode undefined', …)` — same shape as Task 1's.
  - `test('AC9.1: the git child reads the repo named by the injected env, not the inherited one', …)` — the env-only fixture: repo A (cwd, no commits beyond one, no `main` branch) and repo B with `main` and a feature commit; `runCliSync(CLI, ['--integration-branch', 'main'], { cwd: A, env: { PATH, HOME, GIT_DIR: <B>/.git } })`; assert `code === 0` and `JSON.parse(stdout).mergeBase` equals B's merge base. Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` from the fixture's setup `git` calls.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/blast-radius.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: blast-radius.js exports no run`.

- [ ] **Step 4: Convert `blast-radius.js`** per the Interfaces block. `fail(msg, d)` writes through `d.stderr` and returns 1.
- [ ] **Step 5: Convert the spawns** to `runCliSync(CLI, args, { cwd: dir, env: { PATH, HOME } })` through a local helper returning `{ status: code, stdout, stderr }`. Keep exactly two real-process tests with the one-line comment: the "e2e: success prints one JSON object" case through `spawnCli(CLI, ['--integration-branch', 'main'], { cwd: dir })`, and `spawnCli(CLI, [], { cwd: dir })` asserting exit 1, empty stdout and the baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** the file and the conformance suites. Show AC9.1 red by dropping `env` from the injected `git`, quote it, restore.
- [ ] **Step 7: Commit** `Give blast-radius.js an injectable entry — its git child takes the injected cwd and env`.

### Task 3: `init-verify-scope.js` — injectable entry; `tests/bin-lib/init/init-verify-scope-cli.test.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/init-verify-scope.js` (`main` @97, `runDrift` @69, `printSkippedWarnings` @63, exports/guard @166-168)
- Modify: `tests/bin-lib/init/init-verify-scope-cli.test.js` (helper `runCli(args)` @20 — rename it `cli` so it does not shadow the helper's export)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'init-verify-scope.js',`)

**Interfaces:**
- Produces: `module.exports = { run, realDeps, parseArgs, UsageError }`. `run(argv, deps = {}) -> integer`; `realDeps = { stdout, stderr, cwd }`. `--root` resolves with `path.resolve(d.cwd(), parsed.root)` (today `path.resolve(parsed.root)` — already normalized, so `path.resolve` is the sanctioned form). `runDrift` and `printSkippedWarnings` take `d` and return a code. The non-`UsageError` rethrow in `parseArgs`'s catch stays a throw. Keep the existing `fs.existsSync(targetPath)` call as it is (top-level bin file, not under `lib/`).

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Add the failing test** `test('AC9.1: a relative --root resolves against the injected cwd', …)` — parent dir `P` (≠ `process.cwd()`) with `P/proj/package.json`; `runCliSync(CLI, ['--root', 'proj', '--json'], { cwd: P })`; assert `code === 0` and `JSON.parse(stdout).path === path.join(P, 'proj', '.claude-tweaks', 'verify-scope.json')`.
- [ ] **Step 3: Run it to see it fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/init-verify-scope.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: init-verify-scope.js exports no run`.

- [ ] **Step 4: Convert `init-verify-scope.js`** per the Interfaces block.
- [ ] **Step 5: Convert the spawns** (local `cli(args, opts)` → `runCliSync`, `{ status: code, stdout, stderr }`). Keep two real-process tests with the comment: `(a)`'s `--root <root> --json` via `spawnCli` (exit 0 + JSON stdout), and `spawnCli(CLI, [])` asserting exit 2, empty stdout, baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** the file and the conformance suites; show AC9.1 red by using `path.resolve(parsed.root)` again; restore.
- [ ] **Step 7: Commit** `Give init-verify-scope.js an injectable entry — run its CLI tests in-process`.

### Task 4: `release-bootstrap.js` — `run` beside `main`, `git tag` child gets env; `tests/bin-lib/init/release-bootstrap-cli.test.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/release-bootstrap.js` (`parseArgs` @20 — `root` default `process.cwd()`; `main` @57; guard/exports @83-85)
- Modify: `plugin/bin/lib/init/release-bootstrap.js` (the `git -C root tag -l v*` default listTags @336 gains an `env` option; `bootstrapRelease` @356 forwards an optional `env` to it)
- Modify: `tests/bin-lib/init/release-bootstrap-cli.test.js` (helper `run(args)` @10)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'release-bootstrap.js',`)

**Interfaces:**
- Produces: `module.exports = { run, main, parseArgs, realDeps }`. `run(argv, deps = {}) -> integer`; `main(argv)` stays exported and returns `run(argv, realDeps)` (grep its importers first: `git grep -n "release-bootstrap')" -- plugin tests`; none import `main` today besides this file, keep it anyway per the spec). `realDeps = { stdout, stderr, cwd, env }`. `parseArgs(argv, { cwd })` defaults `root` to `cwd()`; a given `--root` is joined onto `cwd()` with `resolveAgainst` (`plugin/bin/lib/health-core/io.js`) for the stat and for `bootstrapRelease`, while `root is not a directory: ${raw}` keeps the user's original string. `bootstrapRelease({ …, env })` passes `env` to the `git` child; absent, the child inherits as today. A relative `--extra-file` is today resolved inside `bootstrapRelease` against `root` — leave that rule unchanged.

- [ ] **Step 1: Run the file green.**
- [ ] **Step 2: Add the failing test** `test('AC9.1: the default --root is the injected cwd', …)` — fresh fixture root `R` (≠ `process.cwd()`); `runCliSync(CLI, ['--integration-model', 'local-merge', '--dry-run'], { cwd: R, env: { PATH, HOME } })`; assert `code === 0` and the JSON names paths under `R` (assert on the field the existing "fresh local-merge root" test reads). Also `test('AC9.1: the git tag child reads the repo named by the injected env', …)` — the env-only fixture: cwd and `--root` in repo A (no tags), `GIT_DIR=<B>/.git` only in the injected `env`, B holding a `v1.2.3` tag; assert the field the tag drives (the seeded manifest version the existing tag-aware tests read; find it in `tests/bin-lib/init/release-bootstrap.test.js`) reflects `1.2.3`. Show it red by dropping `env` from the `git tag` child. And `test('a relative --root that is not a directory prints the argument as given', …)` — `runCliSync(CLI, ['--integration-model', 'local-merge', '--root', 'nope'], { cwd: R })`, exit 2, stderr starting `root is not a directory: nope\n`.
- [ ] **Step 3: Run it to see it fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/release-bootstrap.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: release-bootstrap.js exports no run`.

- [ ] **Step 4: Convert** per the Interfaces block; the guard becomes `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` and is the file's last statement (move `module.exports` above it).
- [ ] **Step 5: Convert the 19 spawns** to `runCliSync(CLI, args, { cwd, env: { PATH, HOME } })` through the local helper mapped to `{ status: code, stdout, stderr }`. Keep two real-process tests with the comment: the "fresh local-merge root prints the JSON envelope and exits 0" case via `spawnCli`, and `spawnCli(CLI, [])` asserting exit 2, empty stdout, baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** the file, `tests/bin-lib/init/release-bootstrap.test.js` (the lib's own suite — check its exact name with `ls tests/bin-lib/init/`), and the conformance suites. Show AC9.1 red by defaulting `root` to `process.cwd()` again; restore.
- [ ] **Step 7: Commit** `Give release-bootstrap.js an injectable entry — main delegates to run`.

### Task 5: `session-tmp-resolve.js` — session id and temp dir through `deps.env`; `tests/session-tmp-resolve-cli.test.js`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/session-tmp.js` (`sessionTmpRoot` @22, `sessionTmpPath` @34; gains `envTmpdir`)
- Modify: `plugin/bin/lib/review-context/build.js` (`envTmpdir` @50 moves out; `build.js` imports it from `../session-tmp` and keeps it in its `module.exports` @401)
- Modify: `plugin/bin/session-tmp-resolve.js` (`resolvePrinted` @36, `main` @41, guard @71, exports @77)
- Modify: `tests/session-tmp-resolve-cli.test.js` (helper `run(args, env)` @18; bash tests @123, @144)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'session-tmp-resolve.js',`)

**Interfaces:**
- Produces in `lib/session-tmp.js`: `envTmpdir(env, platform = process.platform) -> string` (moved verbatim); `sessionTmpRoot(sessionId, { tmpdir } = {})` and `sessionTmpPath(sessionId, filename, { tmpdir } = {})`, `tmpdir` defaulting to `os.tmpdir()`.
- Produces in `session-tmp-resolve.js`: `module.exports = { run, realDeps, formatPrintedPath, resolvePrinted }`. `resolvePrinted(filename, { env = process.env } = {})` — the one-argument call `digest-rollover.js:58` and `tests/digest-rollover-cli.test.js` make keeps today's result; with `env` it reads `env.CLAUDE_CODE_SESSION_ID` and `envTmpdir(env)` for both the session root and the no-session fallback. `formatPrintedPath`'s signature is unchanged. `run(argv, deps = {}) -> integer`, `realDeps = { stdout, stderr, get env() }`; `console.log`/`console.error` become `d.stdout(line + '\n')`/`d.stderr(line + '\n')`.

- [ ] **Step 1: Run** `node --test tests/session-tmp-resolve-cli.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/bin-lib/review-context/exit-code.test.js tests/digest-rollover-cli.test.js`, all pass.
- [ ] **Step 2: Add the failing tests**
  - `test('AC2.1: --value reads the session id from the injected env, not process.env', …)` — set `process.env.CLAUDE_CODE_SESSION_ID = 'not-s1'` for the test (restore in `finally`; the helper's guard snapshots `process.env` at call time, so set it before the call); `runCliSync(CLI, ['--value', 'x.json'], { env: { CLAUDE_CODE_SESSION_ID: 's1' } })`; assert `code === 0`, `stdout` contains `s1` and not `not-s1`.
  - `test('AC9.1: the temp root comes from the injected env TMPDIR', …)` — fixture dir `T`; `runCliSync(CLI, ['--value', 'x.json'], { env: { CLAUDE_CODE_SESSION_ID: 's2', TMPDIR: T, TMP: T, TEMP: T } })`; assert `stdout === formatPrintedPath(path.join(T, 'ct-session-s2', 'x.json')) + '\n'`.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/session-tmp-resolve.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: session-tmp-resolve.js exports no run`.

- [ ] **Step 4: Move `envTmpdir`, add the `tmpdir` options, convert the CLI** per the Interfaces block.
- [ ] **Step 5: Convert the spawns.** The local `run(args, env)` helper becomes `runCliSync(CLI, args, { env: { ...env } })` mapped to `{ status: code, stdout, stderr }` — today's helper passes `{ ...process.env, ...env }`; pass the same merged object so `TMPDIR` and the expected `os.tmpdir()` paths still agree. The eval test's CLI call goes in-process; its bash `eval` stays (bash starts no CLI there). Keep real: the command-substitution test (`// real process: its subject is the shell substitution line`, 2 CLI starts), one `spawnCli` success (`['--value', 'a.json']` with a session id, exit 0, stdout the path), and `spawnCli(CLI, [])` asserting exit 1, empty stdout, baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** Step 1's four files and the conformance suites. Show AC2.1 red by reading `process.env.CLAUDE_CODE_SESSION_ID` in `run` again; restore.
- [ ] **Step 7: Commit** `Resolve session-tmp-resolve's session id and temp dir from deps.env — run its CLI tests in-process`.

### Task 6: `declined-learning.js` — stdin and cwd through deps; `tests/bin-lib/declined-learning-cli.test.js`

**Role:** integration
**Review risk:** high (store lock anchor: the lock and the store must resolve from the same anchor)

**Files:**
- Modify: `plugin/bin/declined-learning.js` (`usageExit` @29, `readStdin` @34, `readDescriptionPayload` @56, `runLookup` @80, `runRecordDecline` @90, `main` @117)
- Modify: `plugin/bin/lib/declined-learning/store.js` (`locked(deps, fn)` @77 anchors with `anchorRoot()`; `recordDecline(fingerprint, opts, deps)` @150 gains a `cwd` read from `deps`)
- Modify: `tests/bin-lib/declined-learning-cli.test.js` (helper `run(args, { input })` @21)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'declined-learning.js',`)

**Interfaces:**
- Produces: `module.exports = { run, realDeps, parseArgs, USAGE }`. `run(argv, deps = {}) -> integer` where `argv[0]` is the verb. `realDeps = { stdout, stderr, cwd, stdin }`. `lookupDecline(fp, { cwd: d.cwd() })` (already supported) and `recordDecline(fp, { reason, source, subject }, { cwd: d.cwd() })`; `locked` resolves `anchorRoot(deps.cwd)` and does not pass `cwd` on to the fs calls. Empty stdin (`d.stdin()` returns `''`) keeps today's exit 1 "not valid JSON" result.

- [ ] **Step 1: Run the file green**, plus `tests/bin-lib/declined-learning/store.test.js` (confirm its name with `ls tests/bin-lib/declined-learning/`).
- [ ] **Step 2: Add the failing tests**
  - `test('AC3.1: an in-process lookup reads stdin and matches the spawned call', …)` — fixture repo dir `F` (a `git init`, so the store anchors there); `const env = { PATH, HOME }`; `const payload = '{"description":"same text"}'`; `const a = runCliSync(CLI, ['lookup', '--source', 'reflect'], { cwd: F, env, stdin: payload })`; `const b = spawnCli(CLI, ['lookup', '--source', 'reflect'], { cwd: F, env, stdin: payload })` (`// real process: proves the script entry reads real stdin`); assert both exit 0 and `a.stdout === b.stdout`. This spawn is the CLI's success smoke.
  - `test('AC9.1: record-decline writes the store under the injected cwd, not this checkout', …)` — `runCliSync(CLI, ['record-decline', '--source', 'reflect'], { cwd: F, stdin: '{"description":"d","reason":"r"}' })`; assert exit 0, `F/.claude-tweaks/declined-learning/store.json` holds the fingerprint, and this checkout's store file's mtime (or absence) is unchanged.
  - `test('empty stdin keeps the not-valid-JSON exit 1', …)` — `runCliSync(CLI, ['lookup', '--source', 's'], { cwd: F, stdin: '' })`, assert `code === 1` and the stderr names `stdin is not valid JSON`.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/declined-learning.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: declined-learning.js exports no run`.

- [ ] **Step 4: Convert** per the Interfaces block; each helper returns its code instead of assigning it.
- [ ] **Step 5: Convert the 13 spawns** (local helper → `runCliSync(CLI, args, { cwd: F, stdin: input })`, mapped to the field names the file's assertions read). Every in-process test passes a fixture `cwd` (spec Gotcha: "In-process tests must pass a fixture `cwd`, or the store lands in this checkout."). Keep real: AC3.1's spawned side and `spawnCli(CLI, [])` asserting exit 2, empty stdout, baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** Step 1's files and the conformance suites. Show AC9.1 red by dropping `cwd` from the `recordDecline` call; restore.
- [ ] **Step 7: Commit** `Read declined-learning's stdin and cwd through deps — run its CLI tests in-process`.

### Task 7: `residue.js` — runner, suite and probes take the injected cwd and env; `tests/bin-lib/residue/cli.test.js`

**Role:** integration
**Review risk:** high (child-process env threading across five probes)

**Files:**
- Modify: `plugin/bin/residue.js` (`runner(cwd)` @58, `main` @77, guard @176)
- Modify: `plugin/bin/lib/residue/probes/worktrees.js` (`defaultIsDirty` @~100 gains an `env` option; `probeWorktrees` @123 already takes `isDirty`)
- Modify: `tests/bin-lib/residue/cli.test.js`, `tests/bin-lib/residue/cli-helpers.js` (`runExpectingFailure` @11)
- Modify: `tests/helpers/run-cli.js` (add `'runSuite'` to `FAIL_CLOSED_KEYS`) and `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (its literal list "(`runner`, `gh`, `ghAvailable`, `runHook`, `spawn`)")
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'residue.js',`)

**Interfaces:**
- Produces: `module.exports = { run, realDeps, parseArgs }`. `run(argv, deps = {}) -> integer` (2 on the two usage refusals, 0 otherwise). `realDeps = { stdout, stderr, cwd, get env(), runner, runSuite }`. `realDeps.runner(argv, opts)` is today's inner closure with `cwd` and `env` taken from `opts` (`run` passes `{ cwd: d.cwd(), env: d.env }` into every call through a bound wrapper named `run` so `probeForge({ scope, run, ` keeps its text). `realDeps.runSuite({ cwd, env })` is today's `suiteRun` body with `env` added. `isDirty` passed to `probeWorktrees` calls `defaultIsDirty(path, { env: d.env })`. `hasTestScript(cwd)`, `probePipelineRuns({ cwd })` and `probeArtifacts({ cwd })` get `d.cwd()`. `PIPELINE_RUN_DIR` is read from `d.env`. Keep the three literal shapes `tests/gh-host-seam-conformance.test.js` pins.

- [ ] **Step 1: Run the file green** (note the `#1781` case takes ~17 s; record which `gh` calls it makes with real `gh`).
- [ ] **Step 2: Add the failing test** `test('AC9.1: PIPELINE_RUN_DIR is read from the injected env', …)` — reuse the existing "#1118 PIPELINE_RUN_DIR attributes only that run dir" fixture, but pass `PIPELINE_RUN_DIR` only in the injected `env` while `process.env.PIPELINE_RUN_DIR` is unset/different; assert the same attribution the existing test asserts. Plus `test('runner children get the injected env', …)` with the env-only `GIT_DIR` fixture: cwd in repo A, `GIT_DIR=<B>/.git` in `env`, `--base HEAD --no-suite --json`; assert `scope` names B's HEAD sha.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/residue.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: residue.js exports no run`.

- [ ] **Step 4: Convert** per the Interfaces block.
- [ ] **Step 5: Convert the spawns.** In-process tests pass a test-side `runner` that runs `git` argv for real with `opts.cwd`/`opts.env` (`execFileSync(argv[0], argv.slice(1), { …opts, encoding: 'utf8', windowsHide: true })`, `null` on error, mirroring the real one) and answers a `gh` argv with the value the real runner gives for this fixture. A test whose assertion only holds with the real `gh` passes `allowRealRunner: true` and says why in a comment. `runSuite` is faked except in the AC7.2/AC7.3 suite tests, which pass `allowRealRunner: true` (they prove the `npm test` start or its absence; the `npm` child is not one of the eight CLIs). Keep two real-process tests with the comment: one success (`--base HEAD --no-suite --json` in a fixture repo, exit 0, JSON stdout) and `spawnCli(CLI, [], { cwd: fixture })` asserting exit 2, empty stdout, baseline stderr (AC6.1). Move `cli-helpers.js`'s `runExpectingFailure` to `runCliSync` (or delete it if no test uses it after conversion). Add `'runSuite'` to `FAIL_CLOSED_KEYS` and to the contract's literal list. Delete the `NOT_YET` line.
- [ ] **Step 6: Run** the file, `node --test tests/bin-lib/residue/` (every residue suite — the probes' own tests must stay green), `tests/gh-host-seam-conformance.test.js`, `tests/run-cli-helper.test.js` (confirm its name: `git grep -l "FAIL_CLOSED_KEYS" -- tests`) and the conformance suites. Show AC9.1 red by reading `process.env.PIPELINE_RUN_DIR` again; restore.
- [ ] **Step 7: Commit** `Thread residue's cwd and env into its runner, suite and probes — run its CLI tests in-process`.

### Task 8: `visual-decide` — async `run` in the lib, signal handlers removed on stop; `tests/bin-lib/visual-decide/cli.test.js`

**Role:** judgment
**Review risk:** high (signal handlers, detached child, open handles)

**Files:**
- Modify: `plugin/bin/lib/visual-decide/cli.js` (`pidAlive` @50, `cmdStart` @118, `runDaemon` @168, `cmdStop` @194, `cmdStatus` @230, `main` @245, exports @254)
- Modify: `plugin/bin/visual-decide.js` (whole file)
- Modify: `tests/bin-lib/visual-decide/cli.test.js` (helper `run(args)` @20; `spawn`s @144, @176 are non-CLI victims and stay)
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'visual-decide.js',`)

**Interfaces:**
- Produces in the lib: `run(argv, deps = {}) -> Promise<integer>`; `realDeps = { stdout, stderr, cwd, get env(), spawn, kill, onStarted }` with `spawn: (cmd, args, opts) => spawn(cmd, args, opts)` (the real call keeps its literal `windowsHide: true` in `cmdStart`'s options), `kill: (pid, sig) => process.kill(pid, sig)`, `onStarted: () => {}`. A thrown error becomes `d.stderr('visual-decide: ' + err.message + '\n')` and code 1 (moved from the bin). `cmdStart`/`cmdStop`/`cmdStatus` take `d` and resolve 0; `--dir`/`--state` resolve with `path.resolve(d.cwd(), …)` (already normalized today); the daemon spawn passes `cwd: d.cwd(), env: d.env`. `pidAlive(pid, kill = (p, s) => process.kill(p, s))` keeps its one-argument behaviour (the `#1231` test). The daemon path (`--__daemon__`) registers `SIGTERM`/`SIGINT` handlers that call `stop`, calls `d.onStarted({ info, stop })`, and resolves 0 only after the server has closed and both handlers are removed (`process.removeListener`). `main` is deleted unless `git grep -n "\.main\b" -- plugin tests` finds an importer beside the bin. `fs.existsSync` stays at its 2 call sites (path-guard allowlist).
- Produces in the bin: `const { run, realDeps } = require('./lib/visual-decide/cli.js'); module.exports = { run, realDeps };` then, last, `if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });`.

- [ ] **Step 1: Run the file green** (≈15 s).
- [ ] **Step 2: Add the failing tests**
  - `test('AC4.1: an in-process daemon start-and-stop leaves SIGTERM/SIGINT listener counts unchanged', …)` — record `process.listenerCount('SIGTERM')`/`('SIGINT')`; `await runCli(BIN, ['start', '--dir', D, '--state', S, '--port', '0', '--idle-minutes', '5', '--__daemon__'], { cwd: D, deps: { onStarted: ({ stop }) => setImmediate(stop) } })`; assert `code === 0`, both counts equal before, `S/server-stopped` exists; then assert no open server or timer: `process.getActiveResourcesInfo()` holds no more `TCPServerWrap`/`Timeout` entries than before the call.
  - `test('AC5.1: require() of visual-decide.js prints nothing and leaves process.exitCode undefined', …)` — same shape as Task 1's.
  - `test('AC9.1: relative --state resolves against the injected cwd', …)` — `await runCli(BIN, ['status', '--state', 'st'], { cwd: D })` with `D/st/server-info` absent; assert `stdout === 'never-started\n'` and, with a `D/st/server-info` written pointing at a closed port and a `server-stopped` marker, `stopped\n`.
- [ ] **Step 3: Run them to see them fail**

Run: `node -e "process.exit(typeof require('./plugin/bin/visual-decide.js').run === 'function' ? 0 : 1)"`
Expected: FAIL (exit non-zero: no `run` export today). The new tests fail with `runCli: visual-decide.js exports no run`.

- [ ] **Step 4: Convert the lib and the bin** per the Interfaces block.
- [ ] **Step 5: Convert the tests.** The local `run(args)` helper becomes `async`, calls `await runCli(BIN, args, { cwd, deps })` and returns `{ code, out: stdout, err: stderr }` (today's field names, `cli.test.js:20-27`); adding `await` at each `run(...)` and `stopQuiet(...)` call site is the one sanctioned change to the test bodies. The status test's "crashed" step and the stale-PID test no longer SIGKILL a daemon (correction 6): "crashed" closes the fake-spawned server's `server` (kept by the fake `spawn` beside `stop`) with `server.close()`, which writes no marker, then asserts `crashed`; the stale-PID test writes `server-info` naming the pid of a `node -e` victim it spawned and already killed (a non-CLI process), then runs `stop` in-process and asserts exit 0 and the marker. In-process `start` tests (AC1's start/second-start refusal, the status sequence, `#1232`) pass `deps.spawn` that starts the server in the test process via `require('…/lib/visual-decide/server.js').startServer({ dir, stateDir, port: 0, idleMinutes })` with the resolved args it was given, keeps the returned `stop`, and returns `{ unref() {} }`; and `deps.kill` that calls that `stop` for `SIGTERM` and answers signal `0` as alive. The idle-minutes tests (`--idle-minutes 0`, AC6 fractional) run the daemon path in-process and await `run`'s resolution (the idle timer calls `stop`). The two victim tests (`stop writes server-stopped marker defensively…`, `stop leaves server-stopped … without running its SIGTERM handler`) keep their non-CLI `node -e` victims and call `stop` in-process with the real `kill` (the victim's pid, never `process.pid`). Keep real, with the comment: the success smoke — `spawnCli(BIN, ['start', '--dir', D, '--state', S])` (exit 0, server-info JSON on stdout) followed by an in-process `stop` with the real `kill`, asserting `stopped\n` and the marker (`// real process: a detached daemon stopped by a real SIGTERM — AC4.2`); and `spawnCli(BIN, [])` asserting exit 1, empty stdout, baseline stderr (AC6.1). Delete the `NOT_YET` line.
- [ ] **Step 6: Run** the file and the conformance suites (path-guard included). Show AC4.1 red by not removing the `SIGTERM` handler on stop; quote it; restore.
- [ ] **Step 7: Commit** `Give visual-decide an injectable async entry — the daemon removes its signal handlers when it stops`.

### Task 9: Measure, record evidence, write the PR body table

**Role:** integration

**Files:**
- No source files. Evidence under `$PIPELINE_RUN_DIR/evidence/`; the PR body of the run's draft PR.

- [ ] **Step 1: Measure after.** Within the same hour as a fresh before-run on the same machine (re-run the before-count against `27095a279` in a detached scratch worktree, then the after-count on this branch): `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list of the eight files> > "$PIPELINE_RUN_DIR/evidence/after.txt" 2>&1`. Expected: `cli` total ≤ 20 and 0 failures (AC1.1).
- [ ] **Step 2: Log the AC evidence** with `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file {file}`, `{file}` holding one line: `AC1.1: count-node-procs before {n} / after {m} CLI processes across the eight files, {t} tests 0 failures — evidence/before.txt, evidence/after.txt`.
- [ ] **Step 3: PR body (AC10.1).** Add a `### Process counts` section to the draft PR body (below the spec summary, above the fixes block, keeping the session link line last): the per-file before/after table (`node`, `cli`, `wall-ms` columns), the `CT_TEST_CONCURRENCY=6` and machine/hour note, every test left on a real process with its reason (from each task's one-line comments), every `plugin/bin/lib` file changed to pass an injected value (`blast-radius-cli.js`, `init/release-bootstrap.js`, `session-tmp.js`, `review-context/build.js`, `declined-learning/store.js`, `residue/probes/worktrees.js`, `visual-decide/cli.js`), the helper differences from correction 2, and the `runSuite` addition to `FAIL_CLOSED_KEYS`.
- [ ] **Step 4: Full suite** runs centrally (Common Step 5); the Windows CI job is dispatched after the last code change (AC11.1).
