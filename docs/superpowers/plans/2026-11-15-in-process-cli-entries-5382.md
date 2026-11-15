# In-process entry for plan-audit, phase-timing, resolve-profile and calibration-report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/plan-audit.js`, `plugin/bin/phase-timing.js`, `plugin/bin/resolve-profile.js` and `plugin/bin/calibration-report.js` meet #5374's CLI entry contract (`run(argv, deps)` + `realDeps`), `calibration-report.js` resolves `autonomy` through `resolve-policy.js`'s in-process core, and their five test files run in-process through `runCli`, dropping from ~189 CLI processes (and 19 `resolve-policy.js` processes) per suite run to at most 10 (and 0).

**Architecture:** Each CLI's `main` becomes `run(argv, deps)` returning an integer (a Promise of one for `phase-timing.js`); every `process.exitCode = N; return;` becomes `return N;`, and every `process.*` read moves onto `deps` (`stdout`, `stderr`, `cwd`, `env`, `homeDir`, plus named seams `gh`, `tmpDir`, `resolvePolicy`). Library functions on the CLI's path that start a child or read an ambient value gain an optional option whose default is today's behaviour, so their other callers do not change. Each test file's local helper calls `runCli`/`runCliSync` and maps the result onto the field names its assertions already read; one or two `spawnCli` smoke tests per CLI, committed **before** the conversion, pin the script entry.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies. Test helper `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`); `tests/helpers/path-stub.js` (`STUB_SKIP`); `plugin/bin/lib/health-core/io.js` (`makeExec`, `resolveAgainst`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T070437-spec-5382/work/5382-spec.md` (record #5382). Prerequisites #5374 (helper, conformance ratchet, `tools/count-node-procs.js`) and #5160 (CI gate in `phase-timing.js`) are merged; the merged versions govern over the spec's description of them.

## Global Constraints

- Entry statement, the last statement of each converted file: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. For `phase-timing.js` exactly: `if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; }).catch((err) => { process.stderr.write(`phase-timing.js: ${err && err.message}\n`); process.exitCode = 2; });` — the catch lives in the entry, not in `run`. `module.exports = { … }` goes **above** the guard.
- Above the guard and in everything `run` calls: no `process.exitCode`, no `process.exit(`, no `process.chdir(`, no write to `process.env`, no direct `process.stdout.write`/`process.stderr.write`, no `process.cwd()`, no `os.homedir()`, no `process.env` read.
- Standard io keys in each `realDeps`, present only when the CLI uses them, exactly: `stdout: (t) => process.stdout.write(t)`, `stderr: (t) => process.stderr.write(t)`, `cwd: () => process.cwd()`, `env: process.env`, `homeDir: () => os.homedir()`.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim: "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`), so a trailing slash or a `..` after a symlink still reaches the kernel; `path.resolve(deps.cwd(), p)` only where the CLI already normalized or needs one absolute, normalized value, such as a root passed to `git -C` (#5380). Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- Same file, verbatim: "The list is by key name: a `realDeps` key that can start `gh` or an arbitrary command carries one of those names, and a record converting a CLI whose `realDeps` holds such a seam under another name (for example `execFileSync`, `runPremiseCheck`) adds that name to `FAIL_CLOSED_KEYS` in the same change." — so `phase-timing.js`'s gh seam is named `gh`; no other new key may start a command.
- Same file, verbatim: "(1) Pin the script's output with real-process tests committed before the split, so the split is checked against the old behavior and not against itself" and "Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls, so a variable the test runner inherited cannot point them at the wrong repo."
- A child's stderr never reaches `process.stderr` from inside `run`: a child started with no `stdio` forwards its stderr to the parent's, which `runCli`'s leak guard rejects. Pipe it and write it to `deps.stderr` (`makeExec({ env, stderr })` does this) — under `realDeps` the bytes are the ones the parent's stderr received before.
- Output text and exit codes of every invocation are unchanged (spec Non-Goals). A path the CLI prints keeps the spelling the user gave; only the path handed to `fs`/a child is resolved against `deps.cwd()`.
- `tests/path-guard-conformance.test.js` pins an exact per-file `existsSync`/`realpathSync` count (`resolve-profile.js` existsSync 2, `calibration-report.js` existsSync 2, `phase-timing.js` realpathSync 1, `lib/timing/transcript.js` realpathSync 2): keep each count unchanged; a new presence/type probe uses `lstatType` from `plugin/bin/lib/path-guard`. Every new `execFileSync`/`spawnSync` call carries `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`).
- `runCli` calls run one at a time (no `Promise.all`, no concurrent subtests). The `env` passed is the complete environment: each file's local helper defaults it to `{ ...process.env }` (minus what the file already deletes, e.g. `CLAUDE_CODE_SESSION_ID`). A test that pre-sets `process.exitCode` restores it in `finally`. Give `runCli` and `spawnCli` the identical explicit `env` when comparing them.
- A test left on a real process uses `spawnCli` and carries a one-line comment naming the process property it proves. Ceiling across the five files: 10 processes of the four CLIs, 0 `resolve-policy.js`; this plan keeps exactly 8 (two per CLI).
- `tests/bin-lib/cli-entry-conformance.test.js`: delete only the converted CLI's line from `NOT_YET`; leave `NOT_YET_CEILING` untouched (21 entries remain, so the list and its reader stay).
- Commit subjects: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer line given to you.

## Spec coverage

| AC | Covered by |
|---|---|
| AC1.1 | Task 5 Step 3 (measured; waived below) |
| AC2.1 | Task 3 Step 1 |
| AC3.1 | Task 3 Steps 0–1 |
| AC4.1 | Task 4 Steps 0–1 |
| AC5.1 | Task 1 Step 0 (two `spawnCli` smoke tests) |
| AC6.1 | Tasks 1–4 Step 1 (require test per file) |
| AC7.1 | Each task's `NOT_YET` deletion + Step 5 conformance run |
| AC7.2 | Waived below (21 entries remain) |
| AC8.1 | Step 0 of Tasks 1–4 (two `spawnCli` tests per CLI, success + refusal) |
| AC9.1 | Tasks 1–4 Step 1 cwd/env tests, Step 4 revert proofs |
| AC10.1 | Task 5 Step 3 |
| AC11.1 | Waived below (Common Step 5 + pipeline Windows CI) |

## Review Focus

- A relative plan/spec/`--run`/`--run-dir`/`--root`/transcript path given with a `cwd` different from the test runner's: it must resolve against `deps.cwd()` — pinned by each file's cwd test (Tasks 1–4, AC9.1).
- `process.exitCode` already non-zero in the calling process: `resolve-profile.js --stance <valid>` must still resolve and return 0 — AC2.1 test (Task 3).
- A `gh` stub or `CLAUDE_CONFIG_DIR`/`HOME` given only in the injected `env`: phase-timing's budget lookup must run the stub and `--auto-transcript` must search the injected home — env-only tests (Task 2).
- `plan-audit.js` run outside a git repo without `--repo-root`: git's `fatal:` line must reach `deps.stderr` (bytes unchanged under `realDeps`), never `process.stderr` — in-process test (Task 1).
- An invalid or missing `autonomy` value in `policy.yml`: calibration must report what the spawned `resolve-policy.js` reported before (stdout and stderr), and any core failure must read as `unknown` (Task 4).

---

### Task 1: Convert `plan-audit.js` and run its tests in-process

**Role:** integration

**Files:**
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/bin/lib/plan-audit/checks.js` (`checkC`'s default runner only)
- Modify: `tests/bin-lib/plan-audit/cli.test.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'plan-audit.js',`)
- Test: `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js`, `tests/windows-hide-spawn-conformance.test.js`, every `tests/bin-lib/plan-audit/*.test.js` (run only)

**Interfaces:**
- Produces: `run(argv: string[], deps) -> 0 | 1 | 2`; `realDeps = { stdout, stderr, cwd, env }`; exports `{ run, realDeps, summaryLine }` (add `summaryLine` only if a test already reaches it; otherwise `{ run, realDeps }`).
- `resolveRepoRoot(explicit, cwd, { env, stderr })`: explicit → `path.resolve(cwd, explicit)`; else `makeExec({ env, stderr })('git', ['rev-parse', '--show-toplevel'], { cwd }).trim()`, falling back to `cwd` on throw.
- `checkC(verificationChecks, repoRoot, deps = {}, unparseableStep2s = [])`: the default runner passes `env: deps.env` to its `execFileSync` (omitted → inherited, as today). `plan-audit.js` calls `checkC(…, { env: deps.env }, …)`.
- File reads: `fs.readFileSync(resolveAgainst(deps.cwd(), parsed.planFile))` and the same for `parsed.spec`; every message and `planPath` keeps `parsed.planFile`/`parsed.spec` as given. `plannedPaths`' plan entry uses `path.relative(repoRoot, path.resolve(deps.cwd(), parsed.planFile))`. Check whether `lib/plan-audit/args.js` resolves any path against `process.cwd()`; if it does, thread `cwd` there too and list it in your report.

- [ ] **Step 0: Pin the script entry before converting (AC5.1, AC8.1)** — in `cli.test.js`, replace the existing no-arguments test (around line 425) and add one more, both `spawnCli(CLI, argv, { env: { ...process.env } })`:
  - `test('AC5.1, AC8.1: no arguments exits 2 with the usage text (script entry)', …)` → `code === 2`, `stdout === ''`, `stderr` strictly equal to the text the current script prints (record it by running the unconverted script once in this step). Comment: proves the refusal path's exit code and stderr survive the real entry.
  - `test('AC5.1, AC8.1: --count-tasks prints its JSON line (script entry)', …)` on a fixture plan with two `### Task N:` headings → `code === 0`, `stdout === '{"tasks": 2, "batched": false}\n'` (confirm against the unconverted script), `stderr === ''`. Comment: proves stdout is flushed on exit 0.
  Run `node --test tests/bin-lib/plan-audit/cli.test.js` → PASS. Commit alone: `Pin plan-audit.js script output — real-process smoke before the entry conversion`.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`:
  - Swap the four local helpers (`runCli`, `runCount`, `runTaskMarkers`, `runCliArgs`) and `runG`/`runProofs` and the direct `execFileSync('node', [CLI…])` sites for `runCliSync(CLI, argv, { env: { ...process.env, ...opts.env }, cwd: opts.cwd })` (rename the file's own `runCli` helper to `audit` to avoid shadowing the import). Keep each helper's returned field names (`exitCode`, `stdout`, `stderr`, or whatever each currently returns); `assert.throws(() => execFileSync(…), (e) => e.status === N)` sites become `assert.strictEqual(r.exitCode, N)` with the same stderr check. Test bodies otherwise unchanged.
  - `test('AC9.1: a relative plan path resolves against the injected cwd', …)` — write `plan.md` under a temp dir `D`; `runCliSync(CLI, ['plan.md', '--count-tasks'], { cwd: D, env })` → code 0 and the task count JSON (the test runner's real cwd has no `plan.md`).
  - `test('resolveRepoRoot: outside a git repo, git\'s fatal line goes to deps.stderr', …)` — `cwd` a fresh non-git temp dir, plan given by absolute path, no `--repo-root` → the call succeeds under `runCliSync` (the leak guard would throw on a `process.stderr` write) and `stderr` matches `/not a git repository/i`.
  - `test('AC6.1: require() prints nothing and leaves process.exitCode undefined', …)` — delete `require.cache[CLI]`, patch `process.stdout.write`/`process.stderr.write` to record, `require(CLI)`, restore in `finally`; assert nothing recorded and `process.exitCode === undefined`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — `runCli: plan-audit.js exports no run`; the require test sees the usage text written (the module calls `main()` at load); the conformance test reports `plan-audit.js` offences once its `NOT_YET` line is deleted.

- [ ] **Step 3: Implement** the Interfaces above: `main()` becomes `run(argv, deps)`; each `process.exitCode = N; return;` → `return N;`; the `--count-tasks`/`--task-markers` success returns are `return 0;`; every write goes through `deps.stdout`/`deps.stderr`; delete the trailing `main();` and add the guard (Global Constraints).

- [ ] **Step 4: Prove the cwd/env tests discriminate** — revert, one at a time, `resolveAgainst(deps.cwd(), …)` (back to the bare path) and the `makeExec` stderr routing; run the single test; confirm it FAILS; restore. Quote each red run's failing assertion line in your report.

- [ ] **Step 5: Run**

Run: `node --test "tests/bin-lib/plan-audit/*.test.js" tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS. Then `git grep -n -e "'node', \[CLI" -e "execPath, \[CLI" -- tests/bin-lib/plan-audit/cli.test.js` → no matches (only `spawnCli` remains).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/plan-audit.js plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/cli.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give plan-audit.js an injectable run entry — its CLI tests run in-process"
```

### Task 2: Convert `phase-timing.js` and run its tests in-process

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/phase-timing.js`
- Modify: `plugin/bin/lib/timing/budget.js` (`checkBudgets` deps, `defaultGh` env, export `defaultGh`)
- Modify: `tests/bin-lib/timing/cli.test.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'phase-timing.js',`)
- Test: `tests/bin-lib/timing/budget.test.js`, `tests/bin-lib/timing/transcript.test.js`, `tests/bin-lib/timing/golden.test.js`, `tests/bin-lib/timing/ci-gate.test.js` and the rest of `tests/bin-lib/timing/*.test.js`, `tests/bin-lib/path-guard/callers-characterization.test.js`, `tests/bin-lib/exit-code-conformance.test.js`, `tests/path-guard-conformance.test.js` (run only)

**Interfaces:**
- Produces: `async run(argv, deps) -> 0 | 2`; `realDeps = { stdout, stderr, cwd, env, homeDir, gh: defaultGh }`; `main(argv)` stays exported and returns `run(argv, realDeps)` (comment above it: removal condition — no file under `plugin/`, `tests/`, `tools/`, `perf/` or `evals/` calls it); exports `{ run, realDeps, main, parseArgs, renderMarkdown, renderDispatches, renderCiGate }`.
- `budget.js`: `defaultGh(args, { cwd, timeout, env, stderr, homeDir })` calls `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', cwd, timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env }, injectedGhDeps({ env, stderr, homeDir })))` (`injectedGhDeps` from `plugin/bin/lib/repo-resolve.js`; each value undefined → today's behaviour), so the GH_HOST probe's `git`, its gh-config home lookup and its one-time host note all use the injected values; `checkBudgets({ runDir, totals, unattributed, deps })` reads `deps.env`, `deps.stderr` and `deps.homeDir` and passes them on every `gh(args, { cwd, timeout, env, stderr, homeDir })` call it makes (through `findTrackingRecord`); export `defaultGh`. `phase-timing.js` calls `checkBudgets({ …, deps: { cwd: deps.cwd(), gh: deps.gh, env: deps.env, stderr: deps.stderr, homeDir: deps.homeDir } })` and writes `checked.stderr` lines through `deps.stderr`.
- `--run`: `path.resolve(deps.cwd(), o.run)` (already normalized + absolute today). Transcript reads: `readUsage(resolveAgainst(deps.cwd(), p), …)` and `collectDispatches` canonicalizes against `deps.cwd()`; every printed note keeps `p` as given.
- `--auto-transcript`: `locateTranscripts({ cwd: worktree, sessionId, homeDir: null, configDir })` with `configDir = deps.env.CLAUDE_CONFIG_DIR || path.join(deps.homeDir(), '.claude')`, computed only on the `--auto-transcript` path (so a call without it needs no `HOME` in `env`). `homeDir: null` is passed explicitly because `locateTranscripts`' `homeDir = os.homedir()` default parameter runs whenever `homeDir` is `undefined`, even with `configDir` given, and the leak guard rejects an `os.homedir()` call under an injected `HOME`; `homeDir` is read there only to default `configDir`.

- [ ] **Step 0: Pin the script entry before converting (AC8.1)** — two `spawnCli(CLI, argv, { env: { ...process.env } })` tests replacing two existing success/refusal spawns:
  - `test('AC8.1: --markdown on a fixture run prints the table and exits 0 (script entry)', …)` → `code === 0`, `stderr === ''`, `stdout` strictly equal to the unconverted script's output. Comment: proves stdout is flushed on exit 0.
  - `test('AC8.1: a rejected run exits 2 with the phase-timing.js: line (script entry)', …)` — make `{run}/timing.json` a directory so the write throws `EISDIR` → `code === 2`, `stderr` matches `/^phase-timing\.js: EISDIR/`. Comment: proves the entry's `.catch` maps a rejection to exit 2.
  Run → PASS against the unconverted script. Commit alone: `Pin phase-timing.js script output — real-process smoke before the entry conversion`.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`:
  - Swap `run`, `runAuto`, `runIn` and the direct `spawnSync(process.execPath, [CLI…])` sites for `await runCli(CLI, argv, { env, cwd })` mapped onto `{ status, stdout, stderr }` (the field names the assertions read). Tests become `async`. The `fixtureHomeEnv(home)` call sites pass that object as `env` unchanged.
  - The stub-`gh` tests (`runIn`, around line 480): pass `env: { ...process.env, PATH: stubBin + path.delimiter + process.env.PATH }` and `allowRealRunner: true` (the real `gh` seam must run, so it finds the stub through the injected `PATH`); keep their `{ skip: STUB_SKIP }` or equivalent guard. These are the file's env test for `gh` (AC9.1).
  - `test('AC9.1: a relative --run resolves against the injected cwd', …)` — `runCli(CLI, ['--run', 'run', '--json'], { cwd: parentOfRun, env })` → status 0, `JSON.parse(stdout).runDir === path.join(parentOfRun, 'run')`.
  - `test('--auto-transcript searches the injected HOME, never os.homedir()', …)` — the existing auto-transcript fixture, through `runCli` with `env: fixtureHomeEnv(home)` → finds the fixture session (the leak guard throws if `os.homedir()` is called under the injected `HOME`).
  - `test('--auto-transcript honours CLAUDE_CONFIG_DIR given only in the injected env', …)` — the fixture session under `<tmp>/cfg/projects/<slug>/`, `env: { ...fixtureHomeEnv(otherHome), CLAUDE_CONFIG_DIR: <tmp>/cfg }` → found.
  - `test('AC6.1: require() prints nothing and leaves process.exitCode undefined', …)` — as Task 1.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/timing/cli.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — `runCli: phase-timing.js exports no run`; conformance offences for `phase-timing.js`.

- [ ] **Step 3: Implement** the Interfaces above. Keep every message string byte-identical.

- [ ] **Step 4: Prove the env/cwd tests discriminate** — revert, one at a time: the `env` passed to `defaultGh`; the `injectedGhDeps(…)` argument to `ghOptions` (expect the leak guard or the stub test to fail; if neither test can see it, say so in your report); `configDir` from `deps.env` (back to `locateTranscripts`'s default); `path.resolve(deps.cwd(), o.run)` (back to `path.resolve(o.run)`); run the single test; confirm FAIL; restore. Quote each red line.

- [ ] **Step 5: Run**

Run: `node --test "tests/bin-lib/timing/*.test.js" tests/bin-lib/path-guard/callers-characterization.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS. `git grep -n "execPath, \[CLI" -- tests/bin-lib/timing/cli.test.js` → no matches.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/phase-timing.js plugin/bin/lib/timing/budget.js tests/bin-lib/timing/cli.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give phase-timing.js an injectable run entry — its CLI tests run in-process"
```

### Task 3: Convert `resolve-profile.js` and run its two test files in-process

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/resolve-profile.js`
- Modify: `plugin/bin/lib/model-profiles/session-failures.js` (optional `dir` on the four path-taking functions)
- Modify: `tests/bin-lib/model-profiles/cli.test.js`
- Modify: `tests/resolve-profile-run-dir-anchoring.test.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'resolve-profile.js',`)
- Test: `tests/bin-lib/model-profiles/session-failures.test.js` and the rest of `tests/bin-lib/model-profiles/*.test.js`, `perf/session-failures-lock-wait.test.js`, `tests/bin-lib/hooks/contract-retries.test.js`, `tests/wall-clock-budget-conformance.test.js`, `tests/resolve-profile-invocation-conformance.test.js`, `tests/pipeline-run-dir-cli-boundary-pin.test.js`, `tests/bin-lib/run-dir-guard.test.js`, `tests/path-guard-conformance.test.js` (run only)

**Interfaces:**
- Produces: `run(argv, deps) -> 0 | 1`; `realDeps = { stdout, stderr, cwd, env, tmpDir: () => os.tmpdir() }`; exports `{ run, realDeps }`.
- `requireValue(args, flag) -> { ok: true, value } | { ok: false }` — pure (no write); `run` writes `resolve-profile: ${flag} requires a value` and returns 1 when `ok` is false. `fail` becomes a local `(msg) => { deps.stderr(\`resolve-profile: ${msg}\n\`); return 1; }` used as `return fail(…)`. No `process.exitCode` read anywhere.
- `deps.env.CLAUDE_CODE_SESSION_ID` replaces the three `process.env` reads. `policyPath = path.join(deps.cwd(), '.claude-tweaks', 'policy.yml')`; `anchoredOrOutsideMessage(runDir, deps.cwd(), '--run-dir')`; `tallyPath = path.join(resolveAgainst(deps.cwd(), runDir), 'frontier-tally.log')`.
- `session-failures.js`: `failurePath(sessionId, dir = os.tmpdir())`, `readFailedModels(sessionId, { dir } = {})`, `recordFailure(sessionId, model, opts = {})` reading `opts.dir`, `invalidateFailures(sessionId, { dir } = {})` — `recordFailure`'s inner `readFailedModels` gets the same `dir`. `resolve-profile.js` passes `{ dir: deps.tmpDir() }` to each.

- [ ] **Step 0: Pin the script entry before converting (AC8.1, AC3.1)** — in `tests/bin-lib/model-profiles/cli.test.js`, two `spawnCli` tests with one shared explicit `env` (the file's `isolatedEnv()`):
  - `test('AC8.1: resolve-profile.js <profile> prints exactly one JSON line (script entry)', …)` → `code === 0`, `stderr === ''`, `stdout` strictly equal to the unconverted script's output for `standard` in a dir with no `policy.yml`, and `stdout.split('\n')` has length 2 with an empty last element. Comment: skills paste this stdout into Agent calls; proves one line and the flush on exit 0.
  - `test('AC3.1, AC8.1: --stance with no value exits 1 naming the flag (script entry)', …)` → `code === 1`, `stdout === ''`, `stderr === 'resolve-profile: --stance requires a value\n'` (confirm against the unconverted script). Comment: proves the refusal exit code survives the real entry.
  Run → PASS. Commit alone: `Pin resolve-profile.js script output — real-process smoke before the entry conversion`.

- [ ] **Step 1: Write the failing tests:**
  - `cli.test.js`: swap `run(args, cwd)` and every `execFileSync('node', [CLI…])` site for `runCliSync(CLI, argv, { env, cwd: dir, deps: { tmpDir: () => tmp } })` (`tmp` a per-test temp dir); `run` keeps returning the parsed JSON (assert `code === 0` first); `assert.throws(… e.status === 1 && /…/.test(e.stderr))` sites become code/stderr assertions. Tests that call `failurePath` from the lib to check the file pass the same `tmp` as `dir`.
  - `test('AC2.1: a preset process.exitCode does not stop a valid --stance resolution', …)` — `const prior = process.exitCode; process.exitCode = 1; try { r = runCliSync(CLI, ['standard', '--stance', 'default'], …) } finally { process.exitCode = prior; }` → `r.code === 0` and `JSON.parse(r.stdout).model` is a string. (The leak guard compares against the preset value, so it does not trip.)
  - `test('AC3.1: in-process --stance with no value matches the script entry', …)` → `runCliSync` gives `code === 1` and the same `stderr` as Step 0's spawned call, identical `env`.
  - `test('AC9.1: record-failure reads CLAUDE_CODE_SESSION_ID from the injected env and writes under the injected tmpDir', …)` — `env` with `CLAUDE_CODE_SESSION_ID: 'cli-test-inj'` and the real `process.env` without it → `{"recorded":true,…,"sessionId":"cli-test-inj"}` and `failurePath('cli-test-inj', tmp)` exists.
  - `test('AC6.1: require() prints nothing and leaves process.exitCode undefined', …)` — as Task 1.
  - `tests/resolve-profile-run-dir-anchoring.test.js`: its `runCli(args, cwd)` helper calls `runCliSync(CLI, args, { cwd, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } })`, keeping its returned shape. These tests already pass a non-default `cwd` (the fixture checkout) and assert anchoring against it — name the one that goes red under Step 4's revert as this file's AC9.1 test, and add `AC9.1` to its name.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/model-profiles/cli.test.js tests/resolve-profile-run-dir-anchoring.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — `exports no run`; conformance offences for `resolve-profile.js`.

- [ ] **Step 3: Implement** the Interfaces above; `main(process.argv)` at the bottom becomes the guard (`run` takes `process.argv.slice(2)`).

- [ ] **Step 4: Prove discrimination** — revert, one at a time: `deps.env` → `process.env` for the session id; `deps.cwd()` → `process.cwd()` in the anchoring call; `{ dir: deps.tmpDir() }` dropped. Run the single test; confirm FAIL; restore. Quote each red line.

- [ ] **Step 5: Run**

Run: `node --test "tests/bin-lib/model-profiles/*.test.js" perf/session-failures-lock-wait.test.js tests/resolve-profile-run-dir-anchoring.test.js tests/bin-lib/hooks/contract-retries.test.js tests/wall-clock-budget-conformance.test.js tests/resolve-profile-invocation-conformance.test.js tests/pipeline-run-dir-cli-boundary-pin.test.js tests/bin-lib/run-dir-guard.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/resolve-profile.js plugin/bin/lib/model-profiles/session-failures.js tests/bin-lib/model-profiles/cli.test.js tests/resolve-profile-run-dir-anchoring.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give resolve-profile.js an injectable run entry — requireValue returns its result"
```

### Task 4: Convert `calibration-report.js`, resolve `autonomy` in-process, run its tests in-process

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/calibration-report.js`
- Modify: `tests/bin-lib/calibration/cli.test.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'calibration-report.js',`)
- Test: `tests/bin-lib/calibration/*.test.js`, `tests/path-guard-conformance.test.js`, `tests/bin-lib/exit-code-conformance.test.js` (run only)

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps`, `scalarValue`, `warningLines`, `EXIT_OK` from `./resolve-policy`.
- Produces: `run(argv, deps) -> 0 | 2`; `realDeps = { stdout, stderr, cwd, env, homeDir, resolvePolicy }` (`resolvePolicy` = the imported core); exports `{ run, realDeps }`.
- `parseArgs(argv, cwd) -> { runs, json, root, displayRoot } | { error: string }` — `root` default `cwd`; `--root p` → `root = resolveAgainst(cwd, p)`, `displayRoot = p` (no `--root` → `displayRoot = cwd`); `run` writes `error + '\n'` to `deps.stderr` and returns 2. The `no telemetry yet (…)` line prints `path.join(displayRoot, '.claude-tweaks', 'wrap-up-outcomes.tsv')`, the bytes it prints today.
- `resolveAutonomyCeiling(root, deps) -> string`: `deps.resolvePolicy({ keys: ['autonomy'] }, callerDeps({ cwd: root, env: deps.env, homeDir: deps.homeDir, stderr: … }))`; a throw, or `code !== EXIT_OK`, → `'unknown'`; otherwise `scalarValue(out.result.autonomy)`. The `runner` parameter is deleted, not kept beside the dep. Whatever stderr the spawned `--values autonomy` call forwarded to the parent before (its `warningLines` in values mode) is written to `deps.stderr` byte-identically — Step 0 records what that is.

- [ ] **Step 0: Capture today's output, then pin the script entry (AC4.1, AC8.1, spec Deliverable 3)** — against the unconverted script, in fixture repos built like the file's existing ones (with ≥10 approve-all console stops so the ceiling suggestion is decided by `autonomy`):
  - record stdout and stderr of `node plugin/bin/calibration-report.js --root <R>` for `policy.yml` `autonomy: supervised`, `autonomy: trusted`, `autonomy: bogus`, and no `autonomy` key; write them to `$PIPELINE_RUN_DIR/calibration-capture.md` (outside the repo) for the PR body.
  - add `test('AC4.1, AC8.1: autonomy is read without starting resolve-policy.js (script entry)', { skip: STUB_SKIP }, …)` — per the spec's `## Plan Review Clarifications` (user decision), the fixture's `policy.yml` sets `autonomy: supervised`; a stub dir holding a `node` shim written as `#!/bin/sh` (`touch "$MARKER"; exit 1`, the marker path passed through `env` — never a `#!/usr/bin/env node` shim, which would resolve `node` back to itself and loop); `spawnCli(CLI, ['--root', R], { env: { ...process.env, MARKER: markerPath, PATH: stubDir + path.delimiter + process.env.PATH } })` → `code === 0`, the `Consider raising autonomy` line **present** (a fallback to `unknown` would omit it), marker file absent. Comment: proves the script entry resolves `autonomy` in-process. **This test fails against the unconverted script** (its child resolves through the stub, reads `unknown`, omits the line, and the marker exists); commit it with Step 3, not alone. The second spawn (refusal) is pinned now:
  - `test('AC8.1: --runs abc exits 2 naming the value (script entry)', …)` → `code === 2`, `stdout === ''`, `stderr === '--runs requires a positive number, got: abc\n'` (confirm against the unconverted script). Comment: proves the refusal exit code survives the real entry. Run → PASS; commit alone: `Pin calibration-report.js refusal output — real-process smoke before the entry conversion`.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`:
  - Swap `run(args, root)` and the `execFileSync('node', [CLI…])` sites for `runCliSync(CLI, [...args, '--root', root], { env })` mapped to the shapes the assertions read (`stdout` string; error sites → `code === 2` + stderr). Remove the `runner`-seam tests' use of `resolveAutonomyCeiling(root, runner)`; their cases become `deps: { resolvePolicy: fake }` cases: a fake that throws → `unknown` behaviour (no suggestion), a fake returning `{ code: 1, message: 'x' }` → same, a fake returning `{ code: 0, result: { autonomy: { value: 'supervised', source: 'policy' } }, invalidRaw: new Map(), degrades: [] }` → suggestion present.
  - `test('AC4.1: in-process, autonomy is read without starting resolve-policy.js', { skip: STUB_SKIP }, …)` — the Step 0 `#!/bin/sh` stub dir on the injected `PATH` (and `MARKER` in the injected `env`), through `runCliSync` → with `autonomy: trusted` the suggestion is absent, with `autonomy: supervised` it is present (so a CLI ignoring the policy cannot pass both), marker absent in both.
  - `test('spec Deliverable 3: an invalid or missing autonomy value prints what the spawned call printed', …)` — `autonomy: bogus` and no-key fixtures in-process → stdout and stderr equal Step 0's captured bytes.
  - `test('AC9.1: no --root reads the injected cwd', …)` — `runCliSync(CLI, [], { cwd: R, env })` → same stdout as `['--root', R]`.
  - `test('a relative --root resolves against the injected cwd and prints as given', …)` — `cwd` = parent of a root with no TSV, `['--root', 'r']` → `no telemetry yet (r/.claude-tweaks/wrap-up-outcomes.tsv absent)` (use `path.join('r', …)` for the separator).
  - `test('AC6.1: require() prints nothing and leaves process.exitCode undefined', …)` — as Task 1.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/calibration/cli.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — `exports no run`; conformance offences for `calibration-report.js`; the AC4.1 tests see the marker.

- [ ] **Step 3: Implement** the Interfaces above; drop the `execFileSync` import if nothing else uses it. Keep the `existsSync` count at 2 (`loadRuns`' archive probe and the printed `node -e` string).

- [ ] **Step 4: Prove discrimination** — revert, one at a time: `root` default back to `process.cwd()`; `env: deps.env` dropped from `callerDeps`; then temporarily restore the `execFileSync` child for `resolveAutonomyCeiling`. Run the single test; confirm FAIL; restore. Quote each red line.

- [ ] **Step 5: Run**

Run: `node --test "tests/bin-lib/calibration/*.test.js" tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS. `git grep -n -e "'node', \[CLI" -e "resolve-policy.js'" -- tests/bin-lib/calibration/cli.test.js plugin/bin/calibration-report.js` → no matches.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/calibration-report.js tests/bin-lib/calibration/cli.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give calibration-report.js an injectable run entry — autonomy resolves through the in-process core"
```

### Task 5: Measure processes before and after, and record the evidence

**Files:**
- Create: `$PIPELINE_RUN_DIR/proc-counts.md` (outside the repo — the orchestrator copies it into the PR body)

- [ ] **Step 1:** Write the five converted test file paths, one per line, to a scratch list file.
- [ ] **Step 2 (AC10.1): Baseline and after** — extract the merge base into a fresh scratch directory (`git archive <merge-base> | tar -x -C <scratch>`; run `npm ci` there only if the tool needs `node_modules`), run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list>` there, then the same command in this worktree — same machine, within the same hour.
- [ ] **Step 3 (AC1.1, AC10.1):** Write `proc-counts.md`: both tables as the tool prints them; the totals of the four CLIs (after ≤ 10) and of `resolve-policy.js` (after = 0); every test left on a real process with its reason (the eight `spawnCli` tests); every `plugin/bin/lib` file changed to take an injected value (`lib/plan-audit/checks.js`, `lib/timing/budget.js`, `lib/model-profiles/session-failures.js`); the calibration capture from Task 4 Step 0; any difference between the merged #5374 helper/tool/ratchet and the spec's description of them. If an after-total exceeds its ceiling, stop and report — do not commit around it.
- [ ] **Step 4:** No commit (nothing in the repo changes).

Waived AC1.1: measured, not asserted by a test — Task 5's tool run is the evidence and its ceilings are stop conditions.
Waived AC10.1: PR-body evidence produced by Task 5, not a test.
Waived plugin/bin/lib/timing/transcript.js: read only — `locateTranscripts` already takes `configDir`/`homeDir` options; Task 2 passes them.
Waived tests/bin-lib/exit-code-conformance.test.js: run only, in every task's Step 5 — it reads each converted file's last `require.main` block.
Waived AC11.1: the full `npm test` run is `/claude-tweaks:build`'s Common Step 5 verification; the Windows CI job is dispatched by the pipeline after the last code change — neither is a plan task.
Waived AC7.1: covered by each task's `NOT_YET` deletion plus the conformance run in its Step 5.
Waived AC7.2: 21 entries remain on `NOT_YET` after this change, so the list and the code reading it stay (Global Constraints).
