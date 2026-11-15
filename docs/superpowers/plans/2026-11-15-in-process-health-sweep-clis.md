# In-process entry for code-health, docs-health and design-detect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/code-health.js`, `plugin/bin/docs-health.js` and `plugin/bin/design-detect.js` meet #5374's CLI entry contract (`run(argv, deps)` + `realDeps`), `commit-ref.js` passes its lock wait by value instead of writing `process.env`, and the eleven test files that start one of these CLIs five or more times run in-process through `runCli`, dropping from 112 CLI processes per suite run to at most 16.

**Architecture:** #5380's pattern, applied unchanged: every sub-command becomes `cmdX(args, ctx) -> integer`, with `ctx` built once per `run` call from `deps` (`stdout`, `stderr`, `cwd`, `env`) plus per-run instances of the shared health-core factories constructed with that io/env (`harness-health.js`'s `run` is the worked example to copy). Library functions on the CLIs' paths gain an optional `env` / `stderr` option whose default is today's behaviour. `file-lock.js`'s `acquireLock`/`withLock` gain an explicit `waitMs` option that wins over `CLAUDE_TWEAKS_LOCK_WAIT_MS`.

**Tech Stack:** Node 18+ CommonJS (CI runs Node 20), `node --test`, no dependencies. Test helper `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`); tool `tools/count-node-procs.js --files-from <list>`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T070442-spec-5381/work/5381-spec.md` (record #5381). Read it in full before a task; its Gotchas bind every task. The entry contract is the merged `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`; `plugin/bin/harness-health.js` (#5380) is the converted sibling to mirror.

## Global Constraints

- Entry statement, last statement of each converted file: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` — `module.exports = { … }` goes **above** it.
- Above the guard and in everything `run` calls: no `process.exitCode`, no `process.exit(`, no `process.chdir(`, no write to `process.env`, no direct `process.stdout.write` / `process.stderr.write`, no `process.cwd()` (use `deps.cwd()`), no `fs.readFileSync(0)` (use `deps.stdin()`).
- Standard io keys in `realDeps`, exactly as `harness-health.js` has them: `stdout: (t) => process.stdout.write(t)`, `stderr: (t) => process.stderr.write(t)`, `cwd: () => process.cwd()`, `env: process.env`; `design-detect.js` adds `stdin: () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }`; `docs-health.js` adds `lock: acquireLock` (from `./lib/file-lock`; spec Plan Review Clarifications, AC3). No `runner`/`gh`/`spawn` key is added.
- Exit codes, stdout and stderr text of every sub-command are byte-identical to today (spec Non-Goals). Unknown command → usage on stderr, code 2 (`code-health.js`, `docs-health.js`); `design-detect.js`'s `fail()` paths → code 1.
- `main` stays exported and returns `run(…, realDeps)`; it never sets `process.exitCode`. `code-health.js`/`docs-health.js`: `main(argv)` takes `process.argv.slice(2)`-shaped argv (as today). `design-detect.js`: `main(argv)` keeps today's full-`process.argv` shape and returns `run(argv.slice(2), realDeps)`. Comment above each `main`: `Removal condition: delete once no file under plugin/, tests/, tools/, perf/ or evals/ imports it — callers use run(argv, deps) instead.`
- Relative paths: a `--root` becomes `path.resolve(deps.cwd(), args.root || '.')` once in `run` (as `harness-health.js` line 407); a file path the CLI hands to `fs` as written (`validate-findings` findings file, `--issues`, `pull-issues --issues`, `word-count <path>`, `design-detect --signals/--claude-md/--surface-lines`) is resolved with `resolveAgainst(ctx.cwd(), p)` from `plugin/bin/lib/health-core/io.js`. Paths already resolved against `root` (`find-refs`, `check-freshness`, `--area`, `--slice`) keep that. Every diagnostic that names a path prints the caller's own spelling, never the joined path: `--issues` goes through `loadIssueIndex(args.issues, TOOL_NAME, { stderr: ctx.stderr, cwd: ctx.cwd })` (it already reads against `cwd` and prints the spelling as given), and the findings-file, `pull-issues --issues` and `word-count` reads use the `resolveAgainst` path while their error lines print the argument as written.
- Accepted output difference (spec Plan Review Clarifications): the normalized root makes `verify-commit`'s `result.root` and `next-slice`'s slice `path` print absolute for a **relative** `--root`. Tasks 5 and 7 each pin it with one test; Task 9 states it in the PR body. No other printed byte changes.
- Every child process on a converted CLI's path receives `env: deps.env`, and a child's own stderr never reaches `process.stderr` from inside `run` (pipe/ignore it, or route through `makeExec({ env, stderr })`).
- `plugin/bin/docs-health.js` keeps exactly one `fs.existsSync` (`tests/path-guard-conformance.test.js` allowlists `existsSync: 1` for it). Every `execFileSync`/`spawnSync` you add or edit under `plugin/bin` carries `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- `runCli`/`runCliSync` calls run one at a time (no `Promise.all`, no concurrent subtests). The `env` passed is the complete environment: each file's local helper defaults it to `{ ...process.env }`, and a test comparing `runCli` with `spawnCli` passes both the identical explicit `env`. A converted file's local helper maps `code` onto the field name its assertions already read (`status`, or the parsed stdout), so test bodies do not change. A test that pre-sets `process.exitCode` restores it in `finally`.
- A test left on a real process uses `spawnCli` and carries a one-line comment naming the process property it proves. Ceiling across the eleven files of AC1: 16 processes of the three CLIs, smoke tests included; this plan targets 5.
- Commit subjects: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01Ngy9oVmqcMU49khRwf1y3p`.

Governing skills, quoted verbatim:

- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`), so a trailing slash or a `..` after a symlink still reaches the kernel; `path.resolve(deps.cwd(), p)` only where the CLI already normalized or needs one absolute, normalized value, such as a root passed to `git -C` (#5380). Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- Same file: "(1) Pin the script's output with real-process tests committed before the split, so the split is checked against the old behavior and not against itself … (2) Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call … Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls, so a variable the test runner inherited cannot point them at the wrong repo. Find the ambient reads on a CLI's path by running each documented invocation through `runCliSync` and through `spawnCli` against the same fixture, with an injected `cwd`, `env` and `HOME` that differ from the real ones, and comparing the two results, not by reading the code".
- `.claude/skills/gh-api-module-pattern/caching-and-locks.md`: "Do not copy that env swap. A second long-hold caller adds a `waitMs` option to `acquireLock`/`withLock` and moves `commit-ref.js` onto it in the same change."
- Not applicable: `lock-race-test-seam` (no test here claims a writer holds a lock across a read-modify-write; AC3's test observes the wait value only); `bin-source-scan-conformance` (the only source-scan suite edited is `cli-entry-conformance.test.js`, and only its `NOT_YET` data); `windows-checkout-test-parity` (no new path-string assertion is pinned; the Windows CI job after the last code change is the pipeline's, AC10).

## Review Focus

- `process.exitCode` already non-zero in the calling process: each CLI's validation path (`validate-findings`, `pull-issues --min-severity`, design-detect's argument parse) must still run and return its own code — AC2.1 tests (Tasks 5, 7, 8).
- A relative `--root` / findings / `--issues` / `--signals` path given with a `cwd` different from the test runner's: must resolve against `deps.cwd()` — each converted file's cwd test (Tasks 5, 7, 8).
- A `git` child reached only through a library function (`code-health/scope.js` `find`/`git log`, `docs-health/freshness.js` `git log`, `commit-ref.js`, the durable-state `git fetch` behind `createDurable({ env })`, `resolveReadCommit`, design-detect's `repoRoot`): it must see a value present only in the injected `env` — env-only fixture tests (Tasks 2, 3, 5, 7, 8), each shown red by reverting the thread-through.
- A library warning written while `run` is on the stack (`code-health/scope.js`'s dot-directory scan failure and unsupported-workspace-pattern lines): it must reach `deps.stderr`, never `process.stderr`, or the leak guard rejects the call — Task 3's unit test.
- A test that commits to a fixture repo between two in-process calls: the per-process memos (`churnCache` in `health-core/churn.js`, any other module cache found in Task 3's audit) must not return the first call's answer — `fresh: true` on the second call, and one test per file that has this shape (Tasks 5, 7).
- `design-detect.js --surface-lines -` / `--signals -` with an empty stdin: in-process and spawned output identical — AC4.1 test (Task 8).

---

### Task 1: Measure the baseline and pin today's script output

**Files:**
- Create: `$PIPELINE_RUN_DIR/evidence/proc-baseline.txt` (outside the repo)
- Modify: `tests/bin-lib/code-health/cli-pull-issues.test.js`, `tests/bin-lib/code-health/cli-validate-findings.test.js`, `tests/bin-lib/docs-health/cli-word-count.test.js`, `tests/bin-lib/docs-health/cli-validate-findings.test.js`, `tests/bin-lib/design-detect/cli.test.js`

- [ ] **Step 1: Baseline (AC1.1, AC9.1).** Write the eleven AC1 file paths, one per line, to a scratch list (`tests/bin-lib/code-health/{cli-validate-findings,status-v2,cli-pull-issues,cli-nextslice}.test.js`, `tests/bin-lib/docs-health/{cli-validate-findings,cli-next-target,cli-mark,cli-verify-commit,cli-find-refs,cli-check-freshness}.test.js`, `tests/bin-lib/design-detect/cli.test.js`). Run `mkdir -p "$PIPELINE_RUN_DIR/evidence"` then `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list> > "$PIPELINE_RUN_DIR/evidence/proc-baseline.txt" 2>&1` in this worktree before any code change, and record the start time on the file's first line. Quote the per-CLI totals in your report; they replace the spec's 112 floor.
- [ ] **Step 2: Capture the smoke outputs from the unconverted scripts (AC5.1).** Run each once and record stdout, stderr and exit code exactly: `node plugin/bin/code-health.js no-such-command`; `node plugin/bin/docs-health.js word-count <a fixture doc with known content>`; `node plugin/bin/design-detect.js < /dev/null`.
- [ ] **Step 3: Write the pinning tests**, each `spawnCli(CLI, argv, { env: { ...process.env }, cwd, stdin })`, asserting `code`, `stdout` and `stderr` with `assert.strictEqual` against Step 2's captured text (temp paths replaced by a placeholder on both sides), each with a one-line comment naming the property it proves:
  - `cli-pull-issues.test.js`: `test('AC5.1, AC7.1: code-health.js no-such-command exits 2 with the usage text on stderr (real process)', …)` — refusal path.
  - `cli-validate-findings.test.js` (code-health): `test('AC7.1: validate-findings --dry-run on a valid finding exits 0 and prints the payload array (real process)', …)` — pass `--run-id fixed-run` so stderr is deterministic.
  - `cli-word-count.test.js`: `test('AC5.1, AC7.1: docs-health.js word-count <file> prints the result envelope and exits 0 (real process)', …)` — convert one existing `execFileSync` success test into this, so the file's process count does not grow.
  - `cli-validate-findings.test.js` (docs-health): `test('AC7.1: validate-findings --min-confidence bogus --dry-run exits 2 with the tier message (real process)', …)` — refusal path.
  - `design-detect/cli.test.js`: `test('AC5.1, AC7.1: design-detect.js with no arguments and an empty stdin exits 1 with --mode is required (real process)', …)` and `test('AC7.1: design-detect.js --mode review … prints the decision JSON and exits 0 (real process)', …)` — the success case uses the argv of one existing test in the file.
- [ ] **Step 4: Run** `node --test` on the five files. Expected: PASS against the unconverted scripts.
- [ ] **Step 5: Commit** the five test files alone: `Pin code-health, docs-health and design-detect script output — real-process smoke before the entry conversion`.

### Task 2: Pass the deepen lock wait by value, and thread env through commit-ref

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/file-lock.js` (`acquireLock`, `withLock`, the header comment above `resolveLockWaitMs`)
- Modify: `plugin/bin/lib/docs-health/commit-ref.js` (`deepenShallowClone`, `verifyCommits`, `defaultGit` callers, the fetch's `env`)
- Modify: `.claude/skills/gh-api-module-pattern/caching-and-locks.md` (the `file-lock.js`'s-wait bullet: it says "`file-lock.js` has no per-call wait option, so that module sets the env var around its one `acquireLock` call" — rewrite to state `commit-ref.js` now passes `waitMs`, keeping the "Do not copy that env swap" rule's intent as "pass `waitMs`")
- Test: `tests/bin-lib/file-lock.test.js`, `tests/bin-lib/docs-health/commit-ref.test.js`

**Interfaces:**
- Produces:
  - `acquireLock(lockPath, { waitMs } = {})`: deadline `Date.now() + (waitMs ?? resolveLockWaitMs())` when `waitMs` is a non-negative integer; otherwise the env/500 ms rule unchanged. `withLock(lockPath, fn, { failClosed, waitMs } = {})` passes `waitMs` to `acquireLock`.
  - `verifyCommits({ root, hashes, integrationBranch, remote, deepen, git, env, lock })`: `env` (default `process.env`) reaches every git call — `git` defaults to `(args, opts = {}) => defaultGit(args, { env, ...opts })`, and the deepen fetch's env is `{ ...env, GIT_TERMINAL_PROMPT: '0' }`; `lock` (default `acquireLock`) is called as `lock(lockPath, { waitMs: DEEPEN_TIMEOUT_MS + LOCK_WAIT_MARGIN_MS })`. Export `LOCK_WAIT_MARGIN_MS` beside `DEEPEN_TIMEOUT_MS`.
  - `commit-ref.js` no longer names `process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS`.

- [ ] **Step 1: Failing tests.**
  - `file-lock.test.js`: `test('acquireLock: an explicit waitMs wins over CLAUDE_TWEAKS_LOCK_WAIT_MS', …)` — hold a lock, set the env var to `'0'` (restore in `finally`), then `acquireLock(samePath, { waitMs: 150 })` returns `null` only after ≥ 120 ms elapsed; and `test('acquireLock: with no waitMs the env var still applies', …)` — env `'0'`, no option → returns `null` in < 100 ms.
  - `commit-ref.test.js`: replace `CLAUDE_TWEAKS_LOCK_WAIT_MS is restored after a deepen attempt` with `test('AC3.1, AC3.2: the deepen lock is acquired with waitMs DEEPEN_TIMEOUT_MS + LOCK_WAIT_MARGIN_MS and process.env is never written', …)` — shallow clone, a failing-fetch `git`, a `lock` fake recording `(lockPath, opts)` and returning `null`; set `process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '42'` first (restore in `finally`), then snapshot `const before = { ...process.env }` before the call; assert the recorded `opts.waitMs === DEEPEN_TIMEOUT_MS + LOCK_WAIT_MARGIN_MS` and `assert.deepStrictEqual({ ...process.env }, before)`.
  - `commit-ref.test.js`: `test('verifyCommits runs git with the injected env', …)` — the env-only fixture: `root` a non-git temp dir, `B` = `makeOriginRepo().dir`; `verifyCommits({ root, hashes: [B's HEAD sha], integrationBranch: 'main', env: { ...process.env, GIT_DIR: path.join(B, '.git') } })` classifies it `reachable` (it is `unverifiable`, "not a git repository", when `env` is ignored).
- [ ] **Step 2: Run** `node --test tests/bin-lib/file-lock.test.js tests/bin-lib/docs-health/commit-ref.test.js`. Expected: FAIL — `waitMs` ignored; `lock`/`env` options ignored.
- [ ] **Step 3: Implement the Interfaces.** Delete the env swap and its comment in `deepenShallowClone`; rewrite `file-lock.js`'s "One production caller now sets it too" sentence to say the env var is the test-only knob and long-hold callers pass `waitMs`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/file-lock.test.js "tests/bin-lib/docs-health/*.test.js" tests/hooks-context.test.js tests/bin-lib/declined-learning/store-concurrency.test.js`. Expected: PASS. Then revert the `waitMs` pass-through in `commit-ref.js` once, confirm the AC3 test FAILS, restore; quote the failing assertion.
- [ ] **Step 5: Commit** `Pass the deepen lock wait to acquireLock by value — commit-ref.js no longer writes process.env`.

### Task 3: Library seams on the three CLIs' paths take env and stderr

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/code-health/cache.js`, `plugin/bin/lib/docs-health/cache.js` (add `createDurable({ env, stderr } = {})` exactly as `plugin/bin/lib/harness-health/cache.js` lines 22-38; module-level exports stay, bound to `createDurable()`)
- Modify: `plugin/bin/lib/code-health/scope.js` (`listSlices`, `selectSlice`, `contentHash`, `sliceRecursive`, `sourceFilesRaw`, `isEmptySourceDir`, `gitChurn`, `expandWorkspacePattern`)
- Modify: `plugin/bin/lib/docs-health/scope.js` (`selectTarget`'s `opts.env` → `domainChurn(root, paths, sinceMs, { env })`)
- Modify: `plugin/bin/lib/docs-health/freshness.js` (`checkTrackedFreshness`, `gitLastChangedMap`)
- Test: `tests/bin-lib/code-health/scope*.test.js` (find the `listSlices`/`selectSlice` unit file with `git grep -ln selectSlice -- tests`), `tests/bin-lib/docs-health/freshness*.test.js` (find with `git grep -ln checkTrackedFreshness -- tests`), `tests/bin-lib/docs-health/scope.test.js`

**Interfaces:**
- Produces (every new option optional; omitted = today's behaviour):
  - `listSlices(root, { env, stderr } = {})`; `selectSlice(root, cursors, { now, fileDataCache, env, stderr })`; `contentHash(absDir, cache, { recursive, env })`; `sliceRecursive(id, root, { env, stderr } = {})`. Every `find`/`git` child these reach gets `env` (when defined); the two `process.stderr.write` sites write through `stderr` (default `DEFAULT_IO.stderr` from `health-core/io.js`).
  - `selectTarget(root, cursors, { now, dir, env })` (docs-health) passes `env` to `domainChurn`.
  - `checkTrackedFreshness(content, root, sinceTimestamp, { env } = {})` passes `env` to `gitLastChangedMap`'s `git log`.
  - `createDurable({ env, stderr })` in both cache modules → `{ readDurableState, writeDurableState }`.
- Audit step (spec Gotcha): before Step 1, grep `plugin/bin/lib/{code-health,docs-health,design-detect,health-core}` for `process.cwd`, `process.env`, `os.homedir`, bare `path.resolve(` of a single argument, spawns without `env`, and module-level `Map`/`Set`/object caches. Fix every hit on a path a converted test exercises; list each hit, fixed or not (with why), in your report — Task 9 copies it into the PR body.

- [ ] **Step 1: Failing tests.**
  - code-health scope: `test('gitChurn runs git log with the injected env', …)` — call the exported `gitChurn` directly (with empty cursors `selectSlice` returns the stalest slice before churn is ever computed, so it cannot discriminate): a repo `B` with a recent commit touching `src/a.js`, a non-git `root` holding `src/a.js`; `gitChurn(root, 'src', now, { recursive: true, env: { ...process.env, GIT_DIR: path.join(B, '.git') } })` returns ≥ 1, and `0` with `env` omitted. Also `test('selectSlice passes env through to gitChurn', …)`: two slices both carrying fresh cursors (recent `lastSweptMs`, a mismatched `lastHash`) so Phase 2 must rank by churn, churn only in `B` for one of them → that slice wins with `why: 'hotspot'` only when `env` reaches `gitChurn`.
  - code-health scope: `test('listSlices writes its unsupported-workspace-pattern warning to the injected stderr', …)` — a root whose `package.json` `workspaces` holds `"packages/**"`; patch `process.stderr.write` to record (restore in `finally`); `listSlices(root, { stderr: (t) => { err += t; } })` → `err` matches `/unsupported workspace pattern/` and the patch recorded nothing.
  - docs-health freshness: `test('checkTrackedFreshness runs git log with the injected env', …)` — env-only fixture as above; a doc whose `files:` names a path committed in `B` after `sinceTimestamp` is reported changed only with the injected `GIT_DIR`.
  - docs-health scope: `test('selectTarget passes env to domainChurn', …)` — only if an observable ordering change is cheap (two tied docs, churn only in a `GIT_DIR`-supplied repo); otherwise rely on #5380's `domainChurn` unit test and say so.
- [ ] **Step 2: Run** the touched test files. Expected: FAIL (options ignored).
- [ ] **Step 3: Implement the Interfaces.** Message strings byte-identical.
- [ ] **Step 4: Run** `node --test "tests/bin-lib/code-health/*.test.js" "tests/bin-lib/docs-health/*.test.js" "tests/bin-lib/health-core/*.test.js"`. Expected: PASS (CLIs still call with defaults).
- [ ] **Step 5: Commit** `Give the code-health and docs-health library seams injectable env and stderr — defaults unchanged`.

### Task 4: Convert `code-health.js` to the entry contract

**Review risk:** high

**Files:**
- Modify: `plugin/bin/code-health.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'code-health.js',` from `NOT_YET`)
- Modify: `tests/bin-lib/health-core/main-exitcode-integration.test.js` (the `code-health` rows)
- Test: `tests/bin-lib/exit-code-conformance.test.js` (run only)

**Interfaces:**
- Consumes: Task 3's `createDurable`, `selectSlice`/`listSlices`/`contentHash`/`sliceRecursive` options; `makeExec`, `resolveAgainst`, `DEFAULT_IO` from `./lib/health-core/io`; `loadIssueIndex(file, toolName, { stderr })`.
- Produces: `run(argv, deps) -> integer`, `realDeps`, `main(argv) -> integer`, `parseArgs(argv, cwd = process.cwd())`, `cmdX(args, ctx) -> integer` with `ctx = { stdout, stderr, cwd, env, durable, retryQueueCommands, cmdChurnReport }`. Exports: `parseArgs, cmdValidateFindings, main, run, realDeps`.

- [ ] **Step 0: Record the code map.** For every `process.exitCode = N` in the file, note sub-command, `N`, and set-then-return vs set-then-continue; quote the table in your report. A set-then-continue site returns the last code it would have assigned.
- [ ] **Step 1: Failing tests** — the `code-health` row(s) in `main-exitcode-integration.test.js` use `returnedCode(() => captureStdio(() => codeHealth.main([...])))` and assert `2` (split it out of `CHURN_REPORT_CLIS`; leave the `docs-health` row for Task 6). The `NOT_YET` line deletion (Files) is the AC6.1 change for this CLI; Tasks 6 and 8 make it for theirs.
- [ ] **Step 2: Run** `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js`. Expected: FAIL — `main` returns `undefined`; conformance reports `code-health.js` offences.
- [ ] **Step 3: Implement.** `validateRiskArg(value, opts, stderr)` returns `{ ok: true }` or `{ ok: false, code: 2 }`; the two `if (process.exitCode) return;` reads (`cmdPullIssues`, `cmdValidateFindings`) become checks of it. `cmdStatus`, `cmdPullIssues`, `cmdValidateFindings`, `cmdNextSlice`, `cmdClassify` return integers on every path. `resolveReadCommit(root, makeExec({ env: ctx.env, stderr: ctx.stderr }))`; thread `ctx.env`/`ctx.stderr` into every Task 3 seam; `loadIssueIndex(args.issues, TOOL_NAME, { stderr: ctx.stderr, cwd: ctx.cwd })`; the findings file and `pull-issues --issues` are read at `resolveAgainst(ctx.cwd(), p)` while their error lines print `p` as written. `run` mirrors `harness-health.js`'s `run` (lines 377-436): build `ctx`, `args.root = path.resolve(ctx.cwd(), args.root || '.')`, dispatch, usage → `2`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js "tests/bin-lib/code-health/*.test.js" tests/code-health-misc/cli.test.js`. Expected: PASS, including Task 1's two code-health pins unchanged, and `cli-entry-conformance.test.js` passing with `code-health.js` off `NOT_YET` (AC6.1).
- [ ] **Step 5: Commit** `Give code-health.js an injectable run entry — sub-commands return their exit codes`.

### Task 5: Run the four code-health CLI test files in-process

**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/code-health/cli-validate-findings.test.js`
- Modify: `tests/bin-lib/code-health/status-v2.test.js`
- Modify: `tests/bin-lib/code-health/cli-pull-issues.test.js`
- Modify: `tests/bin-lib/code-health/cli-nextslice.test.js`

**Interfaces:**
- Consumes: `run`/`realDeps` from Task 4; `runCliSync`, `spawnCli` from `tests/helpers/run-cli.js`.

- [ ] **Step 1: Swap each file's local spawn helper** (and each inline `spawnSync('node', [CLI…])`/`execFileSync('node', [CLI…])`) for `runCliSync(CLI, argv, { env: { ...process.env, ...opts.env }, cwd: opts.cwd, fresh: opts.fresh })`, mapping onto the fields the assertions read. Keep Task 1's two `spawnCli` pins.
- [ ] **Step 2: Add the per-file cwd/env test (AC8.1):** each file one test with no `--root` and `cwd: root` (`cli-pull-issues`: a relative `--issues issues.json` written under the injected `cwd`; `cli-validate-findings`: a relative findings path too), asserting the same outcome as its `--root` twin.
- [ ] **Step 3: Cross-cutting tests.** `cli-validate-findings`: `test('AC2.1: validate-findings returns 0 on a valid findings file when process.exitCode is already 1', …)` — `const prior = process.exitCode; process.exitCode = 1; try { … --dry-run … } finally { process.exitCode = prior; }` → `status === 0`, stdout a JSON array. `cli-validate-findings`: the `resolveReadCommit` env-only fixture test (non-git `root`, `GIT_DIR` of repo `B` only in `env` → the payload's `Verified-as-of:` line carries `B`'s HEAD). `status-v2`: the durable-state env-only test — repo `B` whose `origin` is a bare repo seeded with a `health-state` branch holding `code-health/remembered.json` with one entry (seed as `tmpGitRootWithOneRun` in `main-exitcode-integration.test.js` does); `status --root <non-git dir>` with `GIT_DIR` of `B` only in `env` prints `remembered:1` (`remembered:0` when `createDurable` ignores `env`). `cli-nextslice`: the accepted-difference pin — `next-slice --root src` (relative) with `cwd: root` prints slice paths equal to `path.resolve(root, 'src', …)`. A test that commits to a fixture repo between two calls passes `fresh: true` on the second.
- [ ] **Step 4: Prove each cwd/env test discriminates.** Temporarily revert the thread-through it covers in `plugin/bin/code-health.js` or the Task 3 seam (root default back to `process.cwd()`; drop `env` from `makeExec`; drop `resolveAgainst` on `--issues`), run the single test, confirm FAIL, restore, confirm `git diff --stat plugin/` shows only intended changes. Quote each red line in your report.
- [ ] **Step 5: Run** `node --test` on the four files → PASS; `git grep -n "'node', \[CLI" -- tests/bin-lib/code-health/cli-validate-findings.test.js tests/bin-lib/code-health/status-v2.test.js tests/bin-lib/code-health/cli-pull-issues.test.js tests/bin-lib/code-health/cli-nextslice.test.js` → no matches (control: the same grep on `tests/bin-lib/code-health/churn-v2.test.js`, which this task does not convert, still matches).
- [ ] **Step 6: Commit** `Run the code-health CLI tests in-process — runCli in place of a node process per call`.

### Task 6: Convert `docs-health.js` to the entry contract

**Review risk:** high

**Files:**
- Modify: `plugin/bin/docs-health.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'docs-health.js',` from `NOT_YET`)
- Modify: `tests/bin-lib/health-core/main-exitcode-integration.test.js` (the `docs-health` rows; delete `withExitCode`/`CHURN_REPORT_CLIS` once no row uses them)
- Test: `tests/bin-lib/exit-code-conformance.test.js`, `tests/bin-lib/docs-health/derive-doc-id.test.js` (run only — `deriveDocId(targetPath, root)` keeps its signature)

**Interfaces:**
- Consumes: Task 2 (`verifyCommits({ …, env })`), Task 3 seams, `makeCmdMark`/`makeCmdStatus`/`makeCmdChurnReport`/`makeRetryQueueCommands` with `io` (#5380).
- Produces: `run`, `realDeps` (with `lock: acquireLock`), `main(argv) -> integer`, `parseArgs(argv, cwd = process.cwd())`, `cmdX(args, ctx) -> integer` with `ctx = { stdout, stderr, cwd, env, lock, durable, retryQueueCommands, cmdChurnReport, cmdMark, cmdStatus }`. Exports: the existing names (the `cmdX` now take `(args, ctx)`) plus `run`, `realDeps`.

- [ ] **Step 0: Record the code map** as Task 4 Step 0.
- [ ] **Step 1: Failing tests** — the `docs-health` rows of `main-exitcode-integration.test.js` in `returnedCode` form.
- [ ] **Step 2: Run** `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** as Task 4 Step 3, for docs-health's commands (`next-target`, `validate-findings`, `churn-report`, `mark`, `status`, `word-count`, `find-refs`, `check-freshness`, `verify-commit`, `retry-queue drain|update`). `validateConfidenceArg(value, stderr)` returns `{ ok, code }`, replacing the line-130 read. `cmdVerifyCommit` passes `env: ctx.env, lock: ctx.lock`; `readIntegrationBranch(root)` unchanged. `cmdWordCount` and the findings file read `resolveAgainst(ctx.cwd(), p)` but print `p` as written in their errors; `--issues` per Global Constraints. Keep the one `fs.existsSync`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js "tests/bin-lib/docs-health/*.test.js"`. Expected: PASS, Task 1's docs-health pins unchanged. AC6.2: `NOT_YET` still holds other CLIs, so the list and its reader stay — confirm in your report.
- [ ] **Step 5: Commit** `Give docs-health.js an injectable run entry — sub-commands return their exit codes`.

### Task 7: Run the six docs-health CLI test files in-process

**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/docs-health/cli-validate-findings.test.js`
- Modify: `tests/bin-lib/docs-health/cli-next-target.test.js`
- Modify: `tests/bin-lib/docs-health/cli-mark.test.js`
- Modify: `tests/bin-lib/docs-health/cli-verify-commit.test.js`
- Modify: `tests/bin-lib/docs-health/cli-find-refs.test.js`
- Modify: `tests/bin-lib/docs-health/cli-check-freshness.test.js`

- [ ] **Step 1:** Task 5 Step 1, for these six files; keep Task 1's `spawnCli` pin in `cli-validate-findings`.
- [ ] **Step 2:** Per-file cwd test (AC8.1) — no `--root`, `cwd: root`; for `find-refs`/`check-freshness`, a relative target path resolved under that root.
- [ ] **Step 3:** `cli-validate-findings`: AC2.1 test (pre-set `process.exitCode = 1`, restore in `finally`, valid findings `--dry-run` → `0`). `cli-verify-commit`: `test('AC3.1, AC3.2: an in-process verify-commit that deepens a shallow clone passes the extended wait to the lock and leaves process.env untouched', …)` — the existing "deepens by default" case run through `runCliSync` with `env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '7' }` and `deps: { lock: (p, opts) => { calls.push(opts); return acquireLock(p, opts); } }` (`acquireLock` from `plugin/bin/lib/file-lock`); the leak guard enforces the real `process.env`; assert `calls.length === 1`, `calls[0].waitMs === DEEPEN_TIMEOUT_MS + LOCK_WAIT_MARGIN_MS` (imported from `commit-ref.js`), and `result.shallow.deepened === true`. `cli-verify-commit` env-only test: non-git `--root`, `GIT_DIR` of the origin repo only in `env` → the hash classifies `reachable`. `cli-verify-commit`: the accepted-difference pin — `verify-commit <sha> --root <relative dir>` with `cwd` its parent prints `result.root === path.resolve(cwd, dir)`. `cli-validate-findings`: the `resolveReadCommit` env-only test (Task 5 Step 3's form, `Verified-as-of:` carries `B`'s HEAD). `cli-mark` or `cli-next-target`: the durable-state env-only test (Task 5 Step 3's form, with a `docs-health/` slice seeded in `B`'s `health-state` and an outcome the CLI prints). `cli-check-freshness`: the test that commits between two calls passes `fresh: true` on the second.
- [ ] **Step 4:** Discrimination proof as Task 5 Step 4, reverting thread-throughs in `plugin/bin/docs-health.js`, `commit-ref.js` (`env`) and `freshness.js`.
- [ ] **Step 5: Run** `node --test "tests/bin-lib/docs-health/*.test.js"` → PASS; `git grep -n "'node', \[CLI" --` on the six files → no matches (control: same grep on `tests/bin-lib/docs-health/durable-integration.test.js` still matches).
- [ ] **Step 6: Commit** `Run the docs-health CLI tests in-process — runCli in place of a node process per call`.

### Task 8: Convert `design-detect.js` and run its CLI tests in-process

**Review risk:** high

**Files:**
- Modify: `plugin/bin/design-detect.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'design-detect.js',`)
- Modify: `tests/bin-lib/design-detect/cli.test.js`
- Test: `tests/design-wrapper-caller-precheck.test.js` (run only — not converted; its stdout contract must hold)

**Interfaces:**
- Produces: `run(argv, deps) -> integer` (argv already sliced), `realDeps` (with `stdin`), `main(argv) -> integer` (full `process.argv`), `parseArgs(argv) -> { ok: true, args } | { ok: false, message }`. `fail(msg)` becomes a `deps.stderr` write plus `return 1`. `readStdin` → `deps.stdin()`, called only for a `-` operand. `repoRoot(deps)` runs `git rev-parse --show-toplevel` with `cwd: deps.cwd(), env: deps.env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true` and falls back to `deps.cwd()`. `--signals`, `--claude-md`, `--surface-lines` file operands go through `resolveAgainst(deps.cwd(), p)`. Exports: `main, run, realDeps`.

- [ ] **Step 1: Failing tests** in `cli.test.js` (via `runCliSync`): `test('AC2.1: a valid --mode payload returns 0 when process.exitCode is already 1', …)`; `test('AC4.1: --signals - reads the payload from deps.stdin and matches the spawned output', …)` — `runCliSync` and `spawnCli` with the identical `env` and `stdin` → equal `stdout`; `test('AC4.1: --surface-lines - with an empty stdin matches the spawned output', …)`; the AC8.1 cwd test — `cwd` a temp git repo whose `CLAUDE.md` sets the design-integration flag to the opposite of this worktree's, no `--design-integration`/`--claude-md` → the decision follows the temp repo (read `lib/design-detect`'s `readDesignIntegrationFlagFromFile` for the flag line's exact form); and `test('repoRoot runs git with the injected env', …)` — `cwd` a non-git temp dir, repo `B` with that `CLAUDE.md`, `env: { ...process.env, GIT_DIR: path.join(B, '.git'), GIT_WORK_TREE: B }` (with `GIT_DIR` alone, `--show-toplevel` reports the cwd, so `GIT_WORK_TREE` is what makes it discriminate) → the decision follows `B`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/design-detect/cli.test.js tests/bin-lib/cli-entry-conformance.test.js`. Expected: FAIL — no `run` export.
- [ ] **Step 3: Implement the Interfaces**; swap the file's local `run(args, opts)` helper to `runCliSync(CLI, args, { env: { ...process.env }, cwd: opts.cwd, stdin: opts.input })`, keeping Task 1's two `spawnCli` pins. The line-109 `if (process.exitCode) return;` becomes a check of `parseArgs`'s `ok`.
- [ ] **Step 4:** Discrimination proof — revert `cwd: deps.cwd()` in `repoRoot`, `env: deps.env` in `repoRoot`, and the `deps.stdin()` read once each; each covering test FAILS; restore.
- [ ] **Step 5: Run** `node --test tests/bin-lib/design-detect/cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/design-wrapper-caller-precheck.test.js tests/design-wrapper-review-surface-gate-prose.test.js` → PASS.
- [ ] **Step 6: Commit** `Give design-detect.js an injectable run entry — stdin through deps, its CLI tests in-process`.

### Task 9: Re-measure, sweep the contract prose, and record the evidence

**Files:**
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (the guard-rule bullet: "`code-health.js` and `docs-health.js`, not yet on the entry contract (#5381), still copy it into `process.exitCode` in `main()` …" — rewrite to say all four health CLIs return it from `run(argv, deps)`)
- Create: `$PIPELINE_RUN_DIR/evidence/proc-after.txt`, `$PIPELINE_RUN_DIR/evidence/proc-counts.md` (outside the repo — the orchestrator copies `proc-counts.md` into the PR body)

- [ ] **Step 1: Prose sweep.** `git grep -n "#5381\|not yet on the entry contract" -- .claude plugin docs tests` — update every statement that says these three CLIs are unconverted or that `commit-ref.js` swaps the env var; list each hit and its disposition in your report.
- [ ] **Step 2: After count (AC1.1, AC9.1).** Same list and command as Task 1 Step 1, within the same hour as the baseline where possible (re-run the baseline from a `git archive` extract of the merge base into a fresh scratch dir if more than an hour has passed), output to `proc-after.txt`.
- [ ] **Step 3:** Write `proc-counts.md`: the before/after table (per file: node processes, `plugin/bin` CLI processes by CLI, wall time), the three-CLI totals (after ≤ 16, or stop and report — do not commit around it), every test left on a real process with its one-line reason, every `plugin/bin/lib` file changed to accept an injected value (Tasks 2-3), and the accepted output difference — a relative `--root` now prints absolute in `verify-commit`'s `result.root` and `next-slice`'s slice paths (spec Plan Review Clarifications). Log `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.168.0/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file <file>` with one line: `AC1/AC9: count-node-procs before {N} → after {M} three-CLI processes over the eleven files; evidence/proc-counts.md`.
- [ ] **Step 4: Commit** the prose sweep only: `Retire the not-yet-converted notes for the health sweep CLIs — all four now return from run`.

Waived AC1.1: measured, not asserted by a test — Task 9 Steps 2-3 are the evidence, and the ≤ 16 total is a stop condition.
Waived AC9.1: PR-body evidence produced by Task 9 Step 3, not a test.
Waived AC6.2: conditional on `NOT_YET` becoming empty, which it cannot in this change (Task 6 Step 4 confirms).
Waived AC10.1: the full `npm test` run is `/claude-tweaks:build`'s Common Step 5 verification and the Windows CI job is dispatched by the pipeline after the last code change — neither is a plan task.
