# Wrap-up engine CLIs on the in-process entry contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/wrap-up-engine.js` and `plugin/bin/wrap-up-state.js` export `run(argv, deps)` and `realDeps` behind a `require.main` guard, and their six test files move onto `tests/helpers/run-cli.js`, so those files start at most 12 CLI processes (170 measured on 2026-11-15).

**Architecture:** Each CLI's `run` merges the caller's `deps` over a module-level `realDeps` and reaches cwd, env, stdin, stdout, stderr, the home directory and child processes only through it. Every verb function returns its exit code. The libraries on the CLIs' path that start `git` or `gh` without an `env` gain an optional `env` (default: the inherited environment), so production behaviour is unchanged. Each test file's local spawn helper calls `runCliSync` and maps `code` onto the field its assertions already read. A small, named set of `spawnCli` tests keeps the script entry covered.

**Tech Stack:** Node (CI runs Node 20; no npm dependencies), `node:test`, `node:assert`, `tests/helpers/run-cli.js` (`runCliSync`, `spawnCli`).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T070453-spec-5379/work/5379-spec.md` (record #5379). Read it in full before a task. Its Gotchas bind every task.

**Scope keywords:** wrap-up-engine.js, wrap-up-state.js, makeDefaultRunner, resolveLedgerPath, makeGitRunner

## Global Constraints

- CI runs Node 20. Use no syntax or API newer than Node 20. No npm dependencies.
- Output and exit codes stay byte-identical for every invocation with absolute path flags, which is every skill call site (`$PIPELINE_RUN_DIR` is absolute per `_shared/pipeline-run-dir.md`). The engine's own messages print each path flag exactly as given. A message naming a *derived* path (`resolvedDir`, an archive path) prints the derived absolute path, which is identical to today for an absolute flag.
- `run` is **synchronous** in both CLIs. Measured: no verb awaits anything (`runVerify` returns `{ rows, exitCode }` directly, and nothing on the engine's path starts `verify.js`; the spec's "`runVerifyVerb` and `runFinishConsole` start `verify.js`" is a false premise, so record it in the PR body). Tests use `runCliSync`.
- `lib/wrap-up/facts.js` no longer spawns `resolve-policy.js`: #5384 merged (eaea2f9c5) and `resolveBudgets` already resolves in-process with an `env` option. The spec's Gotcha about it is stale, so record that in the PR body. `gatherFacts` must receive `env: d.env`.
- From `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, verbatim: "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. The standard io keys, each present only when the CLI uses it, are `stdout(text)`, `stderr(text)`, `cwd()`, `env` (a plain object, read-only), `stdin()` (the whole input as a string) and `homeDir()`. Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`), so a trailing slash or a `..` after a symlink still reaches the kernel; `path.resolve(deps.cwd(), p)` only where the CLI already normalized or needs one absolute, normalized value, such as a root passed to `git -C` (#5380). Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- Same file, verbatim: "A git-only seam (`git`, `gitRunner`) is deliberately not on the list: it runs real git against the injected `cwd` and `env`, which is the behaviour under test." The engine's `gh` seam is named `gh`, so `runCli` fails it closed; a test that reaches it supplies a fake.
- Same file, verbatim: "(1) Pin the script's output with real-process tests committed before the split, so the split is checked against the old behavior and not against itself" and "(2) Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call: two repos, A with no remote and B with an `origin` and a recorded `origin/HEAD`, the CLI's `cwd` in A and `GIT_DIR=<B>/.git` only in the injected `env`, so a child that inherits the real environment reads A and a child that got `env: deps.env` reads B's remote". Also: "Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls".
- Same file, verbatim: "each path-taking flag gets a relative-path case under an injected `cwd` that differs from the real one." The engine's path flags are `--run-dir`, `--batch`, `--ledger` and `--spec-state`.
- Same file, verbatim: "A validation guard bolted onto an already-seamed CLI is exactly where the seam gets holed, because it doesn't feel like a side effect — inject it". The engine's `--run-dir` anchoring check reads `d.cwd()`, not `process.cwd()`.
- `realDeps` shape (as in `plugin/bin/acceptance-packet.js`): members read the globals when called (`cwd: () => process.cwd()`, `get env() { return process.env; }`, `homeDir: () => os.homedir()`, `stdout: (s) => process.stdout.write(s)`, `stderr: (s) => process.stderr.write(s)`). `run(argv, deps = {})` begins `const d = { ...realDeps, ...deps };`.
- Source-scan suites walk `plugin/bin`. Every spawn keeps a literal `windowsHide: true` inside the spawn call's own argument text (`tests/windows-hide-spawn-conformance.test.js` rejects options built by a spread alone). Every `gh` spawn wraps its options in `ghOptions(args, opts, deps)` (`tests/gh-host-seam-conformance.test.js`). Add no `fs.existsSync`/`fs.realpathSync` token: `tests/path-guard-conformance.test.js` pins `wrap-up-engine.js` at exactly 1 `existsSync`, `lib/wrap-up/facts.js` at 1, `lib/wrap-up/engine-verify.js` at 13 and `lib/wrap-up/ledger-write.js` at 5.
- `runCliSync` calls run one at a time (no `Promise.all`, no concurrent subtests). The `env` passed is the whole environment, so local helpers pass `{ ...process.env }` unless a test injects its own.
- A test left on a real process carries a one-line comment naming the process property it proves.
- Restore any temporary revert with the Edit tool, never `git checkout`/`git stash`/`git reset`.
- Evidence directory, written `{evidence}` in this plan (absolute, main checkout): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T070453-spec-5379/evidence/`. Create it with `mkdir -p` and write files there with plain Bash redirects (`>>`), never the Write tool.
- Commits: `{Verb} {what} — {detail}` subject, ending with the line `Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m`. Stage named files only.
- Run `node --test` on every test file a task touches. The full suite runs centrally at Common Step 5, not inside a task.

## Review Focus

1. **A relative path flag under an injected `cwd`** (`--run-dir rel`, `--batch rel.json`, `--ledger rel-ledger.md`, `--spec-state id=rel.json`): each is read at `cwd/rel`, never at the test runner's directory, and any error message names the flag value as typed. Tests: Task 4 Step 1 (`--run-dir`, `--batch`, `--spec-state`), Task 5 Step 1 (`--ledger`).
2. **"Set and keep going" exit precedence**: `render --strict` prints, then exits 2; `render --section console` with no recorded rows writes its stderr diagnostic and still exits 0 without `--strict`; `verify` with a failed `verify.json` write keeps the verdict code. Existing tests pin these; Task 4's conversion must keep each one green unchanged.
3. **Module state between in-process calls in one file**: a usage error followed by a valid call must not carry an exit code or a stale memo. Test: Task 4 Step 1 (AC2.1).
4. **Real stdin bytes**: a payload with non-ASCII text through fd 0 decodes the same as the in-process `stdin` string. Test: Task 1 Step 1 (kept on `spawnCli`).
5. **`verify` with `gh` absent, and GH_HOST**: an injected `gh` that throws ENOENT reads as `gh absent` (`unknown`), the same as a gh-absent `PATH`. The `gateDeps` the engine now passes reads the same env and home directory as today's `undefined`. Test: Task 5 Step 1 (verify-json in-process cases).

---

### Task 1: Pin the script behaviour before the split

**Role:** integration

**Files:**
- Test: `tests/bin-lib/wrap-up/engine-cli.test.js` (append)
- Test: `tests/bin-lib/wrap-up/cli.test.js` (append)

**Interfaces:**
- Consumes: `spawnCli(cliPath, argv, { env, cwd, stdin })` → `{ code, stdout, stderr }` from `tests/helpers/run-cli.js`; the file's existing `run`, `makeRunDir`, `planFreshRunDir`, `baseSha`, `repoDir`.
- Produces: the five `spawnCli` tests named below, which Tasks 3 and 4 keep unchanged as the script-entry smoke set; plus three verb-vocabulary pins that Task 4 converts with the rest of the file.

These tests pass against today's code. They pin it, so Step 2 expects PASS.

- [ ] **Step 1: Write the pins**

In `engine-cli.test.js`, with `const { spawnCli } = require('../../helpers/run-cli');`:
- `test('AC4.1: script with no verb prints usage and exits 2', …)`: `spawnCli(CLI, [], { cwd: repoDir })` → `code === 2`, `stderr` starts with `usage: wrap-up-engine.js plan`, and `stdout === ''`. Comment: `// real process: proves the shebang, the require.main guard and the exit code of the script entry`.
- `test('AC4.2: script plan --dry-run prints the worklist JSON', …)`: `spawnCli(CLI, ['plan', '--run-dir', makeRunDir(), '--base', baseSha, '--dry-run'], { cwd: repoDir })` → `code === 0`, `stderr === ''`, `JSON.parse(stdout).rows.length === 8`. Keep the parsed stdout in a file-level `let scriptPlanStdout` for Task 4's AC3/AC4.2 parity check.
- `test('real stdin: a non-ASCII record payload decodes through fd 0', …)`: plan a fresh run dir, then `spawnCli(CLI, ['record', '--run-dir', runDir, '--dry-run'], { cwd: repoDir, stdin: payload })`, where `payload` is a valid `clean` record for the first open row whose `detail` is `'naïve — ✓ 日本'` → `code === 0`, `stdout` matches `/SCANNED/`, and the string round-trips byte-for-byte into the run's stored artifacts. Probe which of `engine-state.json` / `decisions.md` stores the payload's `detail` (engine-record's `pickStoredFields`) and assert on that one. If neither stores it, carry the non-ASCII text in a field that is stored. Comment: `// real process: fd-0 byte decoding, which runCli's string stdin skips`.
- Verb-vocabulary pins (amend and verify have no non-zero CLI assertion today), through the existing spawn `run`:
  - `test('amend against a run dir with no engine-state.json exits 2', …)` → `status === 2`, stderr matches `/amend: no engine-state\.json/`.
  - `test('amend with garbage stdin exits 1', …)`: planned run dir, input `'{not-json'` → `status === 1`, stderr matches `/amend: stdin is not valid JSON/`.
  - `test('verify without --base exits 2 with usage', …)`: `run(['verify', '--run-dir', makeRunDir()])` → `status === 2`, stderr matches `/^usage: wrap-up-engine\.js/`.
  - `test('record with a falsy JSON stdin (null) exits 0 with no output', …)`: planned run dir, input `'null'` → `status === 0`, `stdout === ''`, `stderr === ''`. This pins today's `if (!payload) return;`. Add the same pin for `amend` (planned run dir, input `'null'`).

In `cli.test.js`, with `const { spawnCli } = require('../../helpers/run-cli');`:
- `test('AC7.1 script: missing --since exits 2 with usage on stderr', …)`: `spawnCli(CLI, [])` → `code === 2`, `stderr` matches `/usage: wrap-up-state\.js --since/`, `stdout === ''`. Comment names the script-entry property.
- `test('AC7.1 script: a valid --since exits 0 and renders the Branch line', …)`: `spawnCli(CLI, ['--since', 'HEAD~1'], { cwd: <repo root> })` → `code === 0`, stdout matches `/^Branch\s+\S/m`.

- [ ] **Step 2: Run them against today's code**

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js tests/bin-lib/wrap-up/cli.test.js`
Expected: PASS (all tests, the new pins included). A pin that fails here means it pins the wrong thing: fix the pin, never the CLI.

- [ ] **Step 3: Commit**

```bash
git add tests/bin-lib/wrap-up/engine-cli.test.js tests/bin-lib/wrap-up/cli.test.js
git commit -m "Pin the wrap-up CLIs' script behaviour — real-process cases committed before the in-process split (#5379)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m"
```

### Task 2: Give the engine's spawning libraries an injected `env`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js:44-55` (`makeDefaultRunner`)
- Modify: `plugin/bin/lib/wrap-up/facts.js` (`makeGitRunner`, `lineCount`, `gatherFacts`)
- Modify: `plugin/bin/lib/wrap-up/ledger-write.js` (`defaultGit`, `resolveLedgerPath`)
- Modify: `plugin/bin/lib/wrap-up/pack.js` (`defaultGit`, `defaultGhSync`, `defaultResolvePolicy`, `defaultDeps`; export `defaultDeps`)
- Test: `tests/bin-lib/wrap-up/engine-verify.test.js`, `tests/bin-lib/wrap-up/facts.test.js`, `tests/bin-lib/wrap-up/ledger-write.test.js`, `tests/bin-lib/wrap-up/pack.test.js` (append)

**Interfaces:**
- Produces:
  - `defaultGit(args, cwd, ctx = {})` and `defaultGh(args, cwd, ctx = {})`, where `ctx` is `{ env, stderr, homeDir }`, each optional. `ctx.env` is added to the spawn options only when given. `defaultGh` calls `ghOptions(args, opts, injectedGhDeps(ctx))` (`injectedGhDeps` from `../repo-resolve`). Calling either with two arguments behaves exactly as today.
  - `gatherFacts({ cwd, base, env, resolvePolicy })` passes `env` to every `git` and `wc` child, via `makeGitRunner(cwd, env)` and `lineCount(filePath, env)`.
  - `resolveLedgerPath({ runDir, worktree, explicit, env, deps })`: the default `git` becomes `(args, o) => defaultGit(args, { ...o, env })`, and `defaultGit(args, { cwd, env } = {})` puts `env` into its options. `deps.resolveBase` stays injectable. Its default stays `pack.js`'s `resolveWorktreeBase(wt)`; the engine overrides it in Task 4.
  - `pack.js`: `defaultDeps(cwd, { env } = {})` threads `env` into `git` (`defaultGit(args, opts)` puts `opts.env` into its options), `ghSync` and `resolvePolicy` (`defaultResolvePolicy`'s own `git`), and is added to `module.exports`. Calling `defaultDeps(cwd)` behaves exactly as today. Every other key is unchanged. `resolveWorktreeBase(wt, deps)`'s signature is unchanged.

- [ ] **Step 1: Write the env-only tests**

Each test builds the spec's two-repo fixture locally: A with one commit and no remote, B with a second, distinct commit (and, for facts, a changed file `b-only.txt` after B's base), with `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_COMMON_DIR` stripped from the setup `git` calls' env.
- `engine-verify.test.js`, `test('defaultGit: the git child gets ctx.env', …)`: `defaultGit(['rev-parse', 'HEAD'], A, { env: { ...cleanEnv, GIT_DIR: path.join(B, '.git') } }).trim()` equals B's HEAD sha, not A's.
- `engine-verify.test.js`, `test('defaultGh: the gh child gets ctx.env', { skip: process.platform === 'win32' && 'sh stub' }, …)`: a `gh` sh stub that echoes `stubbed` in its own directory; `defaultGh(['--version'], A, { env: { ...cleanEnv, PATH: stubDir + path.delimiter + process.env.PATH, GH_HOST: 'github.com' } })` contains `stubbed`. (`GH_HOST` set makes `ghOptions` return the options untouched.)
- `facts.test.js`, `test('gatherFacts: git children get env', …)`: `gatherFacts({ cwd: A, base: <B base sha>, env: { ...cleanEnv, GIT_DIR: path.join(B, '.git') } }).changedFiles` includes `b-only.txt`.
- `ledger-write.test.js`, `test('resolveLedgerPath: ownership git gets env', …)`: A holds an untracked `docs/plans/x-ledger.md` on disk. B's history adds `docs/plans/x-ledger.md` after `<B base sha>`. With `resolveLedgerPath({ runDir: <empty dir>, worktree: A, env: { ...cleanEnv, GIT_DIR: B/.git }, deps: { resolveBase: () => '<B base sha>' } })` → `{ ok: true, path: A/docs/plans/x-ledger.md }`. Probe `ownedPlansFiles` against this fixture first. If B's diff alone cannot make the file owned, adjust the fixture so `env` is the only difference between `ok: true` and `unattributable`, and note the adjustment in the commit body.
- `pack.test.js`, `test('defaultDeps(cwd, { env }): resolveWorktreeBase reads the env-only repo', …)`: the spec's two-repo fixture (B with an `origin` remote, `refs/remotes/origin/main` at B's base commit and `refs/remotes/origin/HEAD` → `refs/remotes/origin/main`, then one more commit; A with no remote). `resolveWorktreeBase(A, defaultDeps(A, { env: { ...cleanEnv, GIT_DIR: path.join(B, '.git') } }))` equals B's base sha. Run without `env`, it does not.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/wrap-up/facts.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/pack.test.js`
Expected: FAIL after Step 1 — the five new tests (the child reads A, or the env argument is ignored).

- [ ] **Step 3: Thread `env` through the four libraries as the Interfaces block states**

- [ ] **Step 4: Run them to see them pass**

Run: the Step 2 command, plus `node --test tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/lib/wrap-up/facts.js plugin/bin/lib/wrap-up/ledger-write.js plugin/bin/lib/wrap-up/pack.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/wrap-up/facts.test.js tests/bin-lib/wrap-up/ledger-write.test.js tests/bin-lib/wrap-up/pack.test.js
git commit -m "Thread an injected env through the wrap-up engine's git and gh children — default stays the inherited environment (#5379)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m"
```

### Task 3: `wrap-up-state.js` on the entry contract

**Role:** integration

**Files:**
- Modify: `plugin/bin/wrap-up-state.js` (whole entry: `main` → `run`)
- Modify: `tests/bin-lib/wrap-up/cli.test.js:21-33` (local `run` helper) + append tests
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete the `'wrap-up-state.js',` line from `NOT_YET`)

**Interfaces:**
- Consumes: `readState({ cwd, since, run })` from `lib/wrap-up/state.js`. Its `run(args)` returns trimmed stdout or `null`, which is exactly the CLI's own `git` shape.
- Produces: `module.exports = { run, realDeps, parseArgs }`. `realDeps = { cwd, get env, stdout, stderr }`. `run(argv, deps = {}) → 0 | 2`. `git(args, cwd, env)` with `env` in its options. `readState` receives `run: (args) => git(args, cwd, env)`. The file ends with the contract's guard line.

- [ ] **Step 1: Write the failing in-process tests and switch the helper**

The local helper becomes `function run(args, cwd) { const r = runCliSync(CLI, args, { cwd: cwd || process.cwd(), env: { ...process.env } }); return { status: r.code, stdout: r.stdout, stderr: r.stderr }; }`. Existing test bodies stay unchanged; Task 1's two `spawnCli` tests stay as they are. Append:
- `test('AC8.1: an injected env reaches every git child (GIT_DIR only in env)', …)`: two-repo fixture (A on branch `a-side`, B on branch `b-side`, cleaned setup env); `runCliSync(CLI, ['--since', 'HEAD', '--json'], { cwd: A, env: { ...cleanEnv, GIT_DIR: path.join(B, '.git') } })` → `code === 0` and `JSON.parse(stdout).state.branch === 'b-side'`.
- The existing `'outside a git repository …'` test is this file's injected-`cwd` case (a cwd outside any repo, which differs from the runner's).

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/bin-lib/wrap-up/cli.test.js`
Expected: FAIL after Step 1 with `runCli: wrap-up-state.js exports no run`.

- [ ] **Step 3: Convert `wrap-up-state.js`**

Each `process.exitCode = 2; return;` becomes `return 2;`, and the success path returns 0. `process.stderr.write`/`process.stdout.write` become `d.stderr`/`d.stdout` with identical bytes. `process.cwd()` becomes `d.cwd()`. The guard line is the contract's. Delete `'wrap-up-state.js',` from `NOT_YET`.

- [ ] **Step 4: Run to see it pass, then prove the env test discriminates**

Run: `node --test tests/bin-lib/wrap-up/cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.
Then drop `env` from `git`'s spawn options with the Edit tool, re-run `cli.test.js`, and confirm the AC8.1 test FAILS (branch reads `a-side`). Restore with the Edit tool and re-run to PASS. Append one line to `{evidence}/revert-red.txt`: `wrap-up-state.js git env dropped -> AC8.1 env test FAIL (a-side); restored -> PASS`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/wrap-up-state.js tests/bin-lib/wrap-up/cli.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give wrap-up-state.js the in-process entry — run(argv, deps), tests on runCliSync (#5379)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m"
```

### Task 4: `wrap-up-engine.js` on the entry contract

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js` (entry, every verb, `resolveRepoRoot`/`resolveFactsRoot`/`resolveTelemetryPath`, `readStdin`)
- Modify: `tests/bin-lib/wrap-up/engine-cli.test.js:1-33` (header comment, local `run`) + append tests
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'wrap-up-engine.js',` from `NOT_YET`; 23 entries remain, so the list and its reader stay — AC6.2 does not trigger)
- Test (run, unchanged): `tests/bin-lib/exit-code-conformance.test.js` — reads the file's last `require.main` block

**Interfaces:**
- Consumes: Task 2's `defaultGit`/`defaultGh(args, cwd, ctx)`, `gatherFacts({ …, env })` and `resolveLedgerPath({ …, env })`; `injectedGhDeps` from `./lib/repo-resolve`; `resolveAgainst` from `./lib/health-core/io`.
- Produces: `module.exports = { run, realDeps, parseArgs }` and the contract's guard line as the last statement. Also:
  - `realDeps = { cwd, get env, homeDir, stdin: () => <today's readStdin body>, stdout, stderr, git: defaultGit, gh: defaultGh }`.
  - `run(argv, deps = {}) → 0 | 1 | 2 | 3`. The verb is `argv[0]`; the flags are `parseArgs(argv.slice(1))`.
  - Every verb is `runX(args, d) → number`. `usage(d)` writes `USAGE` to `d.stderr` and returns 2. `requireEngineState(runDirPath, runDir, verb, d) → null | 2`. `parseStdinPayload(verb, d) → { payload } | { code: 1 }`. `printLastDecisionLine(runDirPath, d)`.
  - `resolveRepoRoot(cwd, env)`, `resolveFactsRoot(cwd, env)` and `resolveTelemetryPath(cwd, env)` take `env` into their `git` options.
  - Paths: the anchoring check uses `path.resolve(d.cwd(), args.runDir)` and `wtDetect.mainCheckoutRoot(d.cwd())`. After it passes, `args.runDirPath = resolveAgainst(d.cwd(), args.runDir)` feeds every fs call and library call. `--batch`, each `--spec-state` path and `--ledger` are read through `resolveAgainst(d.cwd(), p)`. Messages print `args.runDir`, the batch path and the spec-state `p` as given. `--ledger`'s rejection message prints `args.ledger`, which equals today's `candidates[0]`.
  - `verify` passes `deps: { git: (a, c) => d.git(a, c, ctx), gh: (a, c) => d.gh(a, c, ctx), gateDeps: injectedGhDeps(ctx) }` to `runVerify`, with `ctx = { env: d.env, stderr: d.stderr, homeDir: d.homeDir }`.
  - `finish-console`'s fallback worktree is `d.cwd()`. `resolveLedgerPath` gets `env: d.env` and `deps: { resolveBase: (wt) => resolveWorktreeBase(wt, { ...defaultDeps(wt, { env: d.env }), ghSync: (args, o = {}) => d.gh(args, o.cwd, ctx) }) }` (both from `./lib/wrap-up/pack`). Every `gh` child on the engine's path therefore goes through the one fail-closed `gh` seam. The docs/plans fallback's `gh repo view` probe now carries the verify runner's options (5000 ms timeout, piped stderr). A timeout falls through `resolveIntegrationBranch`'s try/catch ladder, the same way a gh failure does today. Record this in the PR body.
  - Falsy payload: `parseStdinPayload` keeps today's semantics. Valid JSON that is falsy (`null`, `false`, `0`) makes `record`, `amend` and `finish-console` return 0 with no output, exactly as today's `if (!payload) return;`. Task 1's `null` pins hold this.
  - `gatherFacts` gets `env: d.env`.
- Exit precedence: a verb that today assigns `process.exitCode` and continues keeps a local `code` and returns the last value it would have assigned (`render --strict` prints first, then returns 2; `verify` returns its verdict after any `verify.json` write-failure message).

- [ ] **Step 1: Switch the helper and write the failing in-process tests**

The local helper becomes `function run(args, { cwd, input } = {}) { const r = runCliSync(CLI, args, { cwd: cwd || repoDir, stdin: input !== undefined ? input : '', env: { ...process.env } }); return { status: r.code, stdout: r.stdout, stderr: r.stderr }; }`, and the header comment drops "Spawns the CLI as a real child process". Task 1's `spawnCli` tests and every existing test body stay unchanged. Append:
- `test('AC2.1: a usage error then a valid plan return 2 then 0 — no exit code carries over', …)`: `runCliSync(CLI, [], …)` → `code === 2`; then `runCliSync(CLI, ['plan', '--run-dir', makeRunDir(), '--base', baseSha, '--dry-run'], { cwd: repoDir, env: { ...process.env } })` → `code === 0`.
- `test('AC4.2/AC3.1: in-process plan stdout equals the script plan stdout', …)`: the in-process `plan --dry-run` on a fresh run dir, with stdout parsed, `deepStrictEqual`s Task 1's `scriptPlanStdout`.
- `test('relative --run-dir resolves against the injected cwd', …)`: `cwd: repoDir`, `--run-dir rel-<unique>` (relative) on `plan --dry-run` → `code === 0` and `repoDir/rel-<unique>/engine-state.json` exists.
- `test('relative --batch resolves against the injected cwd', …)`: a batch file written at `repoDir/batch-<unique>.json`, passed as the bare name → `code === 0`.
- `test('relative --spec-state path resolves against the injected cwd', …)`: `render --section console --spec-state a=<relative engine-state.json path>` → `code === 0`; a missing relative path's stderr names the path as typed.
- `test('AC8.1: plan telemetry follows the injected env (GIT_DIR only in env)', …)`: two-repo fixture (A, the cwd, holds the run dir; B is a separate repo), cleaned setup env; `plan --run-dir <A/run> --base <A HEAD>` (no `--dry-run`), with `env: { ...cleanEnv, GIT_DIR: path.join(B, '.git') }` → `B/.claude-tweaks/wrap-up-outcomes.tsv` exists and `A/.claude-tweaks/wrap-up-outcomes.tsv` does not.
- The existing subdirectory and linked-worktree `plan` tests are this file's injected-`cwd` cases.

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js`
Expected: FAIL after Step 1 with `runCli: wrap-up-engine.js exports no run`.

- [ ] **Step 3: Convert `wrap-up-engine.js` per the Interfaces block**

Every `process.stdout.write`/`process.stderr.write` becomes `d.stdout`/`d.stderr` with identical bytes, trailing newlines included. `readStdin()` becomes `d.stdin()`. No `process.cwd()`, `process.exitCode` or `process.env` remains above the guard. Delete `'wrap-up-engine.js',` from `NOT_YET`.

- [ ] **Step 4: Run to see it pass**

Run: `node --test tests/bin-lib/wrap-up/engine-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/pipeline-run-dir-cli-boundary-pin.test.js`
Expected: PASS. A case that passes only in one order, or only with `fresh: true`, is a leak to fix, not a flag to add.

- [ ] **Step 5: Prove the cwd and env tests discriminate**

With the Edit tool, one at a time, re-run `engine-cli.test.js` and restore after each:
- (a) the anchoring check uses `process.cwd()` instead of `d.cwd()` → the relative `--run-dir` test or the linked-worktree tests FAIL;
- (b) drop `env` from `resolveRepoRoot`'s options → the AC8.1 telemetry test FAILS;
- (c) `--batch` read via the raw path → the relative `--batch` test FAILS.
Append one line per revert to `{evidence}/revert-red.txt`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/wrap-up-engine.js tests/bin-lib/wrap-up/engine-cli.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give wrap-up-engine.js the in-process entry — verbs return codes, cwd/env/stdio through deps (#5379)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m"
```

### Task 5: Move the remaining four engine test files in-process

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/wrap-up/finish-console-cli.test.js:26-35` (local `run`) + append tests
- Modify: `tests/wrap-up-engine-run-dir-anchoring.test.js:22-33` (`runPlan`)
- Modify: `tests/bin-lib/wrap-up/verify-json-cli.test.js:55-62` (local spawn helper; rename it to `runVerifyCli` so it does not shadow an import) + append a test
- Modify: `tests/wrap-up-engine-journey-crlf.test.js:1-40` (header comment, `runPlan`)

**Interfaces:**
- Consumes: Task 4's engine `run`; its `gh` seam (`gh(args, cwd, ctx)`), which a test fakes.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Switch each helper to `runCliSync` and write the new tests**

Every helper passes `cwd` as today, `stdin` (where the helper takes input) and `env: { ...process.env }`, and maps `code` onto the field its assertions read (`status` or `code`). finish-console's helper also passes `deps: { gh: ghAbsent }`, where `ghAbsent` throws an ENOENT error like verify-json's below. Its docs/plans cases (ambiguous, unattributable, the new AC8.1 case) reach `resolveBase`'s `gh repo view` probe when the fixture has no policy and no `origin/HEAD`. The real `gh` there fails for the same reason (a fixture with no remote), so the outcome is unchanged and no real `gh` is reached. verify-json passes `env: { ...process.env, PATH: binDir }` as today, plus `deps: { gh: () => { const e = new Error('spawnSync gh ENOENT'); e.code = 'ENOENT'; throw e; } }`. `inProcessExitCode` stays as it is. journey-crlf's header sentence that explains the subprocess calls (no `require.main` guard) is replaced with one line saying the tests call `run` in-process. Append:
- `finish-console-cli.test.js`, `test('AC8.1: with no worktree in run-state, the ledger resolves under the injected cwd', …)`: a run dir with no `run-state.json`, and a `docs/plans/*-ledger.md` that only the injected `cwd` holds. The ledger resolve uses `resolveBase`, so pick a fixture that `resolveLedgerPath` resolves from `cwd` alone. A `ledger.md` placed by `--ledger <relative name>` under `cwd` also qualifies and covers Review Focus 1. Assert the row flips.
- `finish-console-cli.test.js`, `test('relative --ledger resolves against the injected cwd', …)`: `--ledger <relative>` naming a ledger inside the run dir, relative to `cwd`, → `status === 0` and the row flips. An outside relative ledger's rejection names the value as typed.
- `verify-json-cli.test.js`: the existing "lands in the archived copy" case is this file's injected-`cwd` case (`repoRoot` comes from `cwd`).
- `wrap-up-engine-run-dir-anchoring.test.js`: the existing `accept:` case is AC5.1's in-process case with `cwd` ≠ the runner's, and the `reject:` relative case is its refusal twin.
- `wrap-up-engine-journey-crlf.test.js`: both existing cases run with `cwd: main` ≠ the runner's.

- [ ] **Step 2: Run them**

Run: `node --test tests/bin-lib/wrap-up/finish-console-cli.test.js tests/wrap-up-engine-run-dir-anchoring.test.js tests/bin-lib/wrap-up/verify-json-cli.test.js tests/wrap-up-engine-journey-crlf.test.js`
Expected: PASS, the existing assertions unchanged (AC3.1, AC5.1).

- [ ] **Step 3: Prove each file's cwd case discriminates**

With the Edit tool, temporarily make the engine read `process.cwd()` in place of `d.cwd()` (all sites at once), run the four files, and confirm that each one has at least one FAIL. Restore, re-run to PASS, and append one line per file to `{evidence}/revert-red.txt`.

- [ ] **Step 4: Commit**

```bash
git add tests/bin-lib/wrap-up/finish-console-cli.test.js tests/wrap-up-engine-run-dir-anchoring.test.js tests/bin-lib/wrap-up/verify-json-cli.test.js tests/wrap-up-engine-journey-crlf.test.js
git commit -m "Run the wrap-up engine's remaining CLI tests in-process — finish-console, anchoring, verify-json, journey CRLF (#5379)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oWzg41k3Z4ESKmz36m"
```

### Task 6: Measure before and after, and write the PR-body table

**Role:** integration

**Files:**
- No repository file. Evidence only, under `{evidence}`.

**Interfaces:**
- Consumes: the six-file list, base sha `27095a27949b1ef8494dec30bd7f858c96534ba3`.
- Produces: `{evidence}/proc-before.txt`, `{evidence}/proc-after.txt` and `{evidence}/pr-body-proc-table.md`, which the controller appends to PR #5467's body.

- [ ] **Step 1: Measure base and HEAD back to back**

Write the six paths to `{evidence}/files.txt`. Base: extract `git archive 27095a279` into a scratchpad directory (never a linked worktree), `git init` it, and commit the snapshot twice (so `HEAD~1` resolves). Then run there: `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from {evidence}/files.txt > {evidence}/proc-before.txt 2>&1`. Then, in this worktree, run the same command `> {evidence}/proc-after.txt 2>&1`. Both runs happen on the same machine within the same hour. Record `date` before each.

- [ ] **Step 2: Check the ceiling**

Expected: `proc-after.txt`'s `cli` total for the six files is ≤ 12 (AC1.1), with pass count = base pass count + the tests this plan added and fail 0. Over 12 → stop and report the overage; never merge over it.

- [ ] **Step 3: Write the table**

`{evidence}/pr-body-proc-table.md` holds:
- a `### Process counts (#5379)` heading;
- the before/after `node`/`cli`/`wall-ms` rows per file, with both dates and the command;
- the list of every test left on a real process, with its reason (Task 1's five `spawnCli` tests);
- the `plugin/bin/lib` files changed to pass an injected value (`engine-verify.js`, `facts.js`, `ledger-write.js`, `pack.js`);
- the docs/plans fallback's `gh repo view` probe, now on the verify runner's 5000 ms timeout;
- the spec premises that differ from the merged code (the false premise that `run` awaits `verify.js`; `facts.js`'s `resolve-policy` spawn, gone since #5384; and the CRLF Gotcha: `wrap-up-engine-journey-crlf.test.js` pipes no stdin, so the real-stdin case lives in `engine-cli.test.js`).

Log the AC9 evidence with `--text-file` per `_shared/auto-decision-log.md`.

## Spec coverage

| AC | Covered by |
|----|------------|
| AC1.1 | Task 6 Step 2 (ceiling ≤ 12, all tests passing) |
| AC2.1 | Task 4 Step 1 |
| AC3.1 | Task 5 Step 2 (existing finish-console assertions unchanged) + Task 4's parity test |
| AC4.1 | Task 1 Step 1 |
| AC4.2 | Task 1 Step 1 + Task 4 Step 1 |
| AC5.1 | Task 5 Step 1/2 (anchoring file in-process, cwd ≠ runner's) |
| AC6.1 | Tasks 3 and 4 (`NOT_YET` edits, conformance test run) |
| AC6.2 | Waived AC6.2: the list keeps 23 entries after this change, so the delete-when-empty branch does not trigger |
| AC7.1 | Task 1 Step 1 (engine: AC4.1 refusal + AC4.2 success; state: two script tests). Per the spec's Plan Review Clarification (Reading B), the engine's fd-0 stdin test is outside AC7's count and is listed in the PR body |
| AC8.1 | Task 3 Step 1, Task 4 Step 1, Task 5 Step 1, with revert-red proofs in Tasks 3–5 |
| AC9.1 | Task 6 Step 3 |
| AC10.1 | Waived AC10.1 for tasks: the build's Common Step 5 runs the full suite, and the Windows CI job (`windows-regression.yml`) is dispatched after simplify and after any review fix wave |
