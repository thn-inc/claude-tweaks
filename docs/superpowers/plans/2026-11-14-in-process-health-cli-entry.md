# In-process entry for harness-health and journey-health — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/harness-health.js` and `plugin/bin/journey-health.js` meet #5374's CLI entry contract (`run(argv, deps)` + `realDeps`), the shared health-core helpers they reach take injected io/env, and their ten CLI test files run in-process through `runCli`, dropping from 120 CLI processes per suite run to at most 10.

**Architecture:** Every sub-command becomes `cmdX(args, ctx)` returning an integer, where `ctx` is built once per `run` call from `deps` (`stdout`, `stderr`, `cwd`, `env`) plus per-run instances of the shared factories (retry-queue, mark, churn-report, status, durable state) constructed with that io/env. Shared helpers gain an optional io/env parameter whose default is today's `process.*` behaviour, so `code-health.js` and `docs-health.js` (still on `NOT_YET` until #5381) do not change. `main` stays exported and returns `run(argv, realDeps)`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies. Test helper `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`).

**Spec:** `.claude-tweaks/pipelines/2026-11-14T095430-spec-5380/work/5380-spec.md` (record #5380). The entry contract it cites is the merged `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` ("A CLI that tests call in-process meets the entry contract"); `plugin/bin/resolve-policy.js` is the worked example.

## Global Constraints

- Entry statement, last statement of each converted file: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` — `module.exports = { … }` goes **above** it (the conformance test reads the last guard line; nothing below it may reference `process.exitCode` except that line).
- Above the guard and in everything `run` calls: no `process.exitCode`, no `process.exit(`, no `process.chdir(`, no write to `process.env`, no direct `process.stdout.write` / `process.stderr.write`, no `process.cwd()` (use `deps.cwd()`).
- Standard io keys in `realDeps`, exactly: `stdout: (t) => process.stdout.write(t)`, `stderr: (t) => process.stderr.write(t)`, `cwd: () => process.cwd()`, `env: process.env`. No `runner`/`gh`/`spawn` key is added (those names are fail-closed in `runCli`).
- Every relative path (`--root`, `--memory-dir`, `--issues`, the `validate-findings` findings file, the `qa-evidence` report file, the `retry-queue update` results file) is resolved with `path.resolve(deps.cwd(), p)`; the `--root` default is `deps.cwd()`.
- Every child process the converted CLIs start (git via durable state, `git log` via `health-core/churn.js`'s `domainChurn` (reached from both `scope.js` `selectTarget`s), `git rev-parse` via `resolveReadCommit`, `git -C … rev-parse --show-toplevel` in `resolvePremiseRoot`, the Premise-check shell via `premiseReadsUnresolved`) receives `env: deps.env`; `resolvePluginVersion` receives `deps.env`.
- A child's own stderr never reaches `process.stderr` from inside `run`: `execFileSync` with no `stdio` forwards the child's stderr to the parent's, which `runCli`'s leak guard rejects ("wrote to process.stderr directly"). Every child started on `run`'s path either ignores its stderr (as `churn.js`, `resolvePremiseRoot` and the Premise-check shell already do) or pipes it and writes it to `deps.stderr` — through Task 1's `makeExec`. Under `realDeps` the bytes are the same ones the parent's stderr received before.
- Exit codes, stdout and stderr text of every sub-command are unchanged (spec Non-Goals). Unknown command → usage text on stderr, code 2.
- `code-health.js` and `docs-health.js`: no edits unless a `makeRetryQueueCommands` call site needs one (they already map `update`'s returned code onto `process.exitCode`; `drain` returning `0` is ignored by `return retryQueueCommands.drain(args)`). They stay on `NOT_YET`.
- `main(argv)` stays exported, returns `run(argv, realDeps)`, never sets `process.exitCode`. Removal condition (put it in a comment above `main`): no file under `plugin/`, `tests/`, `tools/`, `perf/` or `evals/` imports it.
- `runCli` calls run one at a time (no `Promise.all`, no concurrent subtests). The `env` passed is the complete environment: each file's local helper defaults it to `{ ...process.env }`. A test that pre-sets `process.exitCode` restores it in `finally`.
- A test left on a real process uses `spawnCli` and carries a one-line comment naming the process property it proves. Ceiling across the ten files: 10 `harness-health.js`/`journey-health.js` processes; this plan targets 5.
- Commit subjects: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer line given to you.

## Review Focus

- A relative `--root` / findings path given with a `cwd` different from the test runner's: must resolve against `deps.cwd()`, not the real working directory — pinned by each file's cwd test (Tasks 3, 5).
- A `git` stub on an injected `PATH` (not on the real `process.env.PATH`): durable-state's `git fetch` must run the stub — pinned by the git-spy tests built with an explicit `env` (Task 3).
- `process.exitCode` already non-zero in the calling process: `validate-findings` must still validate and return 0 — AC2.1, AC2.2 tests (Tasks 3, 5).
- A health-state fetch failure (unreachable `origin`, or a root that is not a git repo) inside an in-process call: both git's own `fatal: …` stderr and the `health-state: fetch failed …` trace must go to `deps.stderr`, not `process.stderr` (the leak guard rejects the call otherwise) — `makeExec`'s unit test (Task 1) and every in-process test whose fixture has no reachable remote, AC2.1's dry run included (Tasks 3, 5).
- Each threaded child given a value only in the injected `env` (a `GIT_DIR`, a `CLAUDE_PLUGIN_ROOT`, a variable the Premise-check shell reads): the child must see it — one env-only test per child (Tasks 1, 3, 5), each shown red by reverting its thread-through.
- Two roots in one test file: the per-process `targetsCache` / `journeysCache` must not hand one root's target to the other — AC4.1 tests (Tasks 3, 5).

---

### Task 1: Shared helpers take injected io/env; retry-queue returns its code

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/health-core/io.js`
- Modify: `plugin/bin/lib/health-core/retry-cli.js`
- Modify: `plugin/bin/lib/health-core/mark.js` (`makeCmdMark` only)
- Modify: `plugin/bin/lib/health-core/churn-report.js`
- Modify: `plugin/bin/lib/health-core/remembered-status.js`
- Modify: `plugin/bin/lib/health-core/issue-index.js`
- Modify: `plugin/bin/lib/health-core/validate-findings-dispatch.js`
- Modify: `plugin/bin/lib/health-core/durable-state.js` (`createNamespacedState`, `createDurableState` option bags)
- Modify: `plugin/bin/lib/health-core/premise-self-check.js`
- Modify: `plugin/bin/lib/health-core/churn.js` (`domainChurn` options)
- Modify: `plugin/bin/lib/harness-health/scope.js`, `plugin/bin/lib/journey-health/scope.js` (`selectTarget`'s `opts.env` → `domainChurn`)
- Modify: `plugin/bin/lib/harness-health/cache.js`, `plugin/bin/lib/journey-health/cache.js`
- Test: `tests/bin-lib/health-core/io.test.js` (new), `tests/bin-lib/health-core/premise-self-check.test.js`, and the existing `domainChurn` test file (find it with `git grep -ln domainChurn -- tests`; add one there)
- Verify, no edit expected: `plugin/bin/code-health.js`, `plugin/bin/docs-health.js` (their `makeRetryQueueCommands` call sites already map `update`'s returned code onto `process.exitCode`; edit only if Step 4 shows otherwise)
- Test: `tests/bin-lib/health-core/retry-cli.test.js`, `tests/bin-lib/health-core/main-exitcode-integration.test.js` (only if a code-health/docs-health row breaks — it must not), `tests/bin-lib/health-core/durable-state.test.js`

**Interfaces:**
- Produces (every new parameter optional; omitted = today's behaviour):
  - `io` shape used throughout: `{ stdout(text), stderr(text), cwd() }`. Default object `DEFAULT_IO = { stdout: (t) => process.stdout.write(t), stderr: (t) => process.stderr.write(t), cwd: () => process.cwd() }` — define it once in a new `plugin/bin/lib/health-core/io.js` exporting `{ DEFAULT_IO, makeExec }` and require it from each helper.
  - `makeExec({ env, stderr })` → `exec(cmd, args, opts = {}) -> string`: behaves as `execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...opts, env })` (returns stdout, throws on non-zero exit with the usual `err.status`/`err.stdout`/`err.stderr`), except the child's stderr is piped and written to `stderr(text)` — on success and, before rethrowing, on failure. `opts.input` still reaches the child's stdin (durable-state's `mktree -z` passes it); an explicit `opts.stdio` whose third entry is `'ignore'` is honoured (nothing to forward). `env` undefined → inherited, as today.
  - `domainChurn(root, relPaths, sinceMs, { env } = {})`; `selectTarget(root, cursors, { …existing, env })` in both `scope.js` files passes `env` to it. The memo key is unchanged (an env-only change to the same root within one process is not a case this record supports; say so in a one-line comment).
  - `makeRetryQueueCommands({ readDurableState, writeDurableState, io = DEFAULT_IO })` → `{ drain(args) -> 0, update(args) -> 0 | 1 | 2 }`. `update` returns `1` (never sets `process.exitCode`) on the persistence-failure branch, after printing `[]`.
  - `makeCmdMark({ …existing, io = DEFAULT_IO })`, `makeCmdChurnReport({ readDurableState, computeChurn, io = DEFAULT_IO })`, `makeCmdStatus({ readDurableState, io = DEFAULT_IO })` — each returned command returns an integer on **every** path (`0` where it returns nothing today). `root` default becomes `io.cwd()`.
  - `loadIssueIndex(file, toolName, { stderr = DEFAULT_IO.stderr } = {})`; `dedupAndDispatch({ …existing, stderr })` passes it through.
  - `createNamespacedState(namespace, fileSpecs, { run, sleep, env, stderr = DEFAULT_IO.stderr })`: when the caller passes `env` or `stderr` and no `run`, the base runner is `makeExec({ env, stderr })` with `defaultRun`'s 30 s timeout default; when the caller passes its own `run` and `env`, every internal `run(cmd, args, opts)` call receives `env` (wrap once at the top: `(cmd, args, opts = {}) => baseRun(cmd, args, { env, ...opts })`); with neither, `defaultRun` exactly as today. `readState`'s `health-state: fetch failed …` line goes through `stderr`. `createDurableState(skillName, { …existing, env, stderr })` passes both through.
  - `premiseReadsUnresolved(command, { root, runner, timeoutMs, env })`: `env` reaches `defaultRunner`'s `exec` options; omitted → inherited (today).
  - `plugin/bin/lib/harness-health/cache.js` and `plugin/bin/lib/journey-health/cache.js` each export `createDurable({ env, stderr } = {})` → `{ readDurableState, writeDurableState, writeDurableStateLocal, pushDurableState }` (journey: the keys its current exports carry) built on `createDurableState` with the same `includeRemembered`/`includeDeclined` flags as today. The existing module-level exports stay, bound to `createDurable()`.

- [ ] **Step 1: Write the failing test** — in `tests/bin-lib/health-core/retry-cli.test.js`, rewrite the test that saves/restores `process.exitCode` around `update()` (around line 148) to assert on the return value instead:

```js
const code = cmds.update({ root, _: ['update', resultsFile] });
assert.strictEqual(code, 1);
assert.strictEqual(process.exitCode, undefined, 'update must not set process.exitCode');
```

  and add `test('drain returns 0 and writes through an injected io', …)`: build `makeRetryQueueCommands({ readDurableState: () => ({ retryQueue: [{ payload: { a: 1 } }] }), writeDurableState, io: { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: () => root } })`, call `drain({ _: [] })` with **no** `root`, assert the return is `0`, `JSON.parse(out)` deep-equals `[{ a: 1 }]`, and the fake `readDurableState` received `root` (record its argument).

  In `tests/bin-lib/health-core/durable-state.test.js` add `test('createNamespacedState threads env into every git call and routes the fetch-failure trace to the injected stderr', …)`: a fake `run` that records `opts.env` and throws `new Error('fatal: unable to access')` on `fetch`; `createNamespacedState('ns', specs, { run, env: { MARKER: '1' }, stderr: (t) => { err += t; } })`; call `readState(root)`; assert every recorded `opts.env` is that object and `err` matches `/^health-state: fetch failed/`.

  In `tests/bin-lib/health-core/io.test.js` (new) add: `test('makeExec writes a failing child\'s stderr to the injected stderr, never to process.stderr', …)` — `makeExec({ env: { ...process.env }, stderr: (t) => { err += t; } })('git', ['-C', <a fresh non-git temp dir>, 'rev-parse', 'HEAD'])` throws; `err` matches `/not a git repository/i`; a patched `process.stderr.write` recorded nothing during the call (restore it in `finally`). `test('makeExec passes env to the child', …)` — `exec(process.execPath, ['-e', 'process.stdout.write(process.env.CT_MARK || "")'])` with `env: { ...process.env, CT_MARK: 'x' }` returns `'x'`. `test('makeExec forwards input to stdin', …)` — `exec(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'abc' })` returns `'abc'`.

  In `tests/bin-lib/health-core/premise-self-check.test.js` add `test('premiseReadsUnresolved runs the command with the injected env', …)` — `premiseReadsUnresolved('test "$CT_MARK" = 1', { root: tmp, env: { ...process.env, CT_MARK: '1' } })` is `true`, and with `env` lacking `CT_MARK` it is `false` (skip on `win32` like the file's other shell tests, if it has that guard).

  In the `domainChurn` test file add `test('domainChurn runs git with the injected env', …)` — a git repo `B` with one commit touching `a.md`; call `domainChurn(<a non-git temp dir>, ['a.md'], 0, { env: { ...process.env, GIT_DIR: path.join(B, '.git') } })` → `1` (it is `0` when `env` is ignored, since the root is not a repo).

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/health-core/retry-cli.test.js tests/bin-lib/health-core/durable-state.test.js tests/bin-lib/health-core/io.test.js tests/bin-lib/health-core/premise-self-check.test.js`
Expected: FAIL after Step 1 — `update` returns `undefined`; the env/stderr test sees no env and no captured trace; `io.js` does not exist; the premise env test returns `false`. (Also run the `domainChurn` file: its new test returns `0`.)

- [ ] **Step 3: Implement the Interfaces above.** Keep every message string byte-identical. Do not change `durable-state.js`'s write paths beyond the single `run` wrap.

- [ ] **Step 4: Run the helper and consumer suites**

Run: `node --test "tests/bin-lib/health-core/*.test.js" "tests/bin-lib/code-health/*.test.js" "tests/bin-lib/docs-health/*.test.js" "tests/bin-lib/harness-health/*.test.js" "tests/bin-lib/journey-health/*.test.js"`
Expected: PASS, every test (the CLIs still call the helpers with defaults, so behaviour is unchanged). This includes `tests/bin-lib/code-health/durable-integration.test.js` and `tests/bin-lib/docs-health/durable-integration.test.js`, which already assert a failing `retry-queue update` exits non-zero through a real process — confirm each still contains that `spawnSync` assertion (AC6.1, and the spec's "one `spawnCli` test per file keeps a failing retry-queue command exiting 1"); if either lacks it, add one test in that file's existing style.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/health-core plugin/bin/lib/harness-health/cache.js plugin/bin/lib/journey-health/cache.js plugin/bin/lib/harness-health/scope.js plugin/bin/lib/journey-health/scope.js tests/bin-lib/health-core {domainChurn test file}
git commit -m "Give the health-core helpers injectable io and env — retry-queue update returns its exit code"
```

### Task 2: Convert `harness-health.js` to the entry contract

**Files:**
- Modify: `plugin/bin/harness-health.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete the `'harness-health.js',` line from `NOT_YET`; do not touch `NOT_YET_CEILING`)
- Modify: `tests/bin-lib/health-core/main-exitcode-integration.test.js` (the `harness-health` rows)
- Test: `tests/bin-lib/exit-code-conformance.test.js` (run only — it reads each file's last `require.main` block)

**Interfaces:**
- Consumes: Task 1's factories and `createDurable({ env, stderr })` from `./lib/harness-health/cache`.
- Produces: `run(argv: string[], deps) -> integer`; `realDeps` (Global Constraints); `main(argv) -> integer`; every `cmdX(args, ctx) -> integer` where `ctx = { stdout, stderr, cwd, env, durable, retryQueueCommands, cmdChurnReport, cmdMark, cmdStatus }` built once at the top of `run`; `parseArgs(argv, cwd = process.cwd())` (the `root` default is `cwd`; `runId` unchanged); `resolvePremiseRoot(root, { env, runner } = {})` (`runner(cmd, args, opts) -> string`, default an `execFileSync` call; it keeps today's `stdio: ['ignore', 'pipe', 'ignore']`). Exports: the existing names plus `run`, `realDeps`.

- [ ] **Step 0: Write the pinning test before converting (AC5.1, AC8.1)** — following the merged contract's "pin the script's output with real-process tests committed before the split", add one `spawnCli` test to `tests/bin-lib/harness-health/cli-next-target.test.js`: `spawnCli(CLI, ['next-target'], { env: { ...process.env }, cwd: root })` (no arguments; `root` a fixture with one skill `auth`) → `code === 0`, `stdout` strictly equal to the exact text the current script prints (`JSON.stringify({ target: …, gapScanDue: … }, null, 2) + '\n'` — derive the expected object by running the current script once in this step), and `stderr` strictly equal to the current script's stderr with the fixture's temp paths replaced by a placeholder on both sides. Comment: proves the script entry's stdout, stderr and exit code are unchanged by the conversion. Run it: PASS against the unconverted script. Commit it alone (`Pin harness-health.js next-target output — real-process smoke before the entry conversion`) before Step 3, so the same test checks the converted script against the old behaviour.

- [ ] **Step 1: Write the failing tests** — in `main-exitcode-integration.test.js`, change only the `harness-health` rows: instead of `withExitCode(() => mod.main([...]))` they assert `assert.strictEqual(mod.main([...]), N)` and `process.exitCode` unchanged (keep `captureStdio`). Split the loops so `code-health`/`docs-health` rows keep the `withExitCode` form untouched (they still set `process.exitCode`). The `journey-health` rows are Task 4's. The `NOT_YET` line deletion (Files) is the AC7.1 change; AC7.2: `code-health.js`, `docs-health.js` and `design-detect.js` stay on the list and `NOT_YET_CEILING` is untouched.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — `main` returns `undefined`; the conformance test reports `harness-health.js` offences now that it is off `NOT_YET`.

- [ ] **Step 3: Implement.**
  - `validateConfidenceArg(value, stderr)` returns `{ ok: true }` or `{ ok: false, code: 2 }` after writing its message; `cmdValidateFindings` returns that `code` — this replaces `if (process.exitCode) return;` (line 204) with a check of the returned value.
  - Each `process.exitCode = N; return;` becomes `return N;`; each fall-through end of a command returns `0`.
  - `run`: build `ctx`, dispatch exactly as `main` does today, return the sub-command's code; unknown command → usage on `ctx.stderr`, return `2`.
  - Thread `ctx.env` into `resolveReadCommit(root, makeExec({ env, stderr }))`, `resolvePremiseRoot(root, { env })`, `premiseReadsUnresolved(command, { root, env })`, `resolvePluginVersion(env)`, and `selectTarget(…, { …, env })`; thread `ctx.stderr` into `dedupAndDispatch({ …, stderr })`.
  - Resolve paths per Global Constraints (`cmdValidateFindings` already `path.resolve`s `root`; make it `path.resolve(ctx.cwd(), …)`).

- [ ] **Step 4: Add the second real-process test** to `tests/bin-lib/harness-health/cli-validate-findings.test.js` (refusal; Step 0's smoke is the first), using `spawnCli` with the same `env` the in-process call uses:
  - AC3.1, AC8.1 refusal: `validate-findings <file> --root <root> --min-confidence bogus --dry-run` once through `runCli` and once through `spawnCli`, identical `env` → both `code === 2`, `stderr` strictly equal, and matching `/--min-confidence "bogus" is not a recognized value/` (comment: proves the refusal path's exit code survives the real entry).

- [ ] **Step 5: Run**

Run: `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js "tests/bin-lib/harness-health/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/harness-health.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/harness-health/cli-next-target.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js
git commit -m "Give harness-health.js an injectable run entry — sub-commands return their exit codes"
```

### Task 3: Run the five harness-health CLI test files in-process

**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/harness-health/cli-validate-findings.test.js`
- Modify: `tests/bin-lib/harness-health/cli-next-target.test.js`
- Modify: `tests/bin-lib/harness-health/cli-push-cursor.test.js`
- Modify: `tests/bin-lib/harness-health/cli-mark.test.js`
- Modify: `tests/bin-lib/harness-health/durable-integration.test.js`

**Interfaces:**
- Consumes: `run`/`realDeps` from Task 2; `runCli`, `runCliSync`, `spawnCli` from `tests/helpers/run-cli.js`.

- [ ] **Step 1: Swap each file's local spawn helper** for one that calls `runCliSync(CLI, argv, { env: { ...process.env, ...opts.env }, cwd: opts.cwd, fresh: opts.fresh })` (`CLI` absolute) and maps the result onto the field names the file's assertions already read (`status`, `stdout`, `stderr`; `execFileSync`-style call sites that `JSON.parse` the return get `stdout` and an `assert.strictEqual(code, 0, stderr)`; the `assert.throws(… err.status === 2)` site becomes a `code === 2` assertion). Test bodies otherwise unchanged. Remove `execFileSync('node', [CLI…])` / `spawnSync('node', [CLI…])` everywhere except Task 2's two `spawnCli` tests. `git` fixture setup calls stay as they are.

- [ ] **Step 2: Git-spy tests (`cli-next-target.test.js`, the two "fetches durable state exactly once" tests)** — do not use `installStub` (it mutates the real `process.env.PATH`, so a CLI ignoring `deps.env` would still pass). Build the stub dir yourself (same shim script as `makeGitSpy`), and pass `env: { ...process.env, PATH: stubDir + path.delimiter + process.env.PATH }` to the in-process call. Keep `{ skip: STUB_SKIP }`. These two tests are this file's env test (AC9.1).

- [ ] **Step 3: Add the per-file cwd test (AC9.1) and the cross-cutting tests:**
  - Each of the five files: one test calling its command **without** `--root` and with `cwd: root` (for `cli-validate-findings`, also a relative findings path `findings.json` written under `root`), asserting the same outcome its `--root` twin asserts (e.g. `cli-mark`: `cache.json` under `root` holds the declined entry; `cli-push-cursor`: `health-state` appears on the bare remote; `durable-integration`: drain prints `[]` / update exits 1).
  - AC2.1, AC2.2 (`cli-validate-findings`): `const prior = process.exitCode; process.exitCode = 1; try { r = run(valid findings, --dry-run) } finally { process.exitCode = prior; }` → `r.status === 0` and stdout is a JSON array.
  - AC4.1 (`cli-next-target`): two fixture roots with different single skills (`alpha`, `beta`); two sequential in-process `next-target --root` calls → `target.id` is `alpha` then `beta`.
  - A test that rewrites a fixture root in place between two calls and expects a fresh read passes `fresh: true` on the second call.
  - Env-only fixture tests, one per child the CLI threads `env` to where the child's effect is observable in the CLI's output (the merged contract's "an env-only fixture… `GIT_DIR=<B>/.git` only in the injected `env`"):
    - `resolveReadCommit` (`cli-validate-findings`): `root` a non-git temp dir, `B` a git repo with one commit; an in-process `validate-findings` producing one payload with `env: { ...process.env, GIT_DIR: path.join(B, '.git') }` → the payload body carries `B`'s HEAD sha on its `Verified-as-of:` line.
    - `resolvePluginVersion` (`cli-validate-findings`): a temp dir `P` holding `.claude-plugin/plugin.json` with `"version": "9.9.9-test"`; an in-process call with `env: { ...process.env, CLAUDE_PLUGIN_ROOT: P }` on a finding whose payload carries the plugin version (read `lib/harness-health/issue-payload.js` for which kind emits it) → the payload shows `9.9.9-test`.
    - `domainChurn` via `selectTarget` (`cli-next-target`): only when an observable ordering change can be built from churn (two otherwise-tied targets, commits only in a `GIT_DIR`-supplied repo); otherwise rely on Task 1's `domainChurn` unit test and say so in your report.
    - `resolvePremiseRoot` and the Premise-check shell: covered by Task 1's unit tests unless an output-visible difference is cheap to build; say which in your report.

- [ ] **Step 4: Prove each cwd/env test discriminates.** For each new cwd test, each env-only fixture test and the two git-spy tests: temporarily revert the thread-through it covers in `plugin/bin/harness-health.js` / `plugin/bin/lib/health-core/durable-state.js` (e.g. `--root` default back to `process.cwd()`; drop the `env` wrap; drop `env` from the `resolveReadCommit` exec or from `resolvePluginVersion(env)`), run the single test, confirm it FAILS, restore, confirm `git diff --stat plugin/` shows only your intended changes. Quote each red run's failing assertion line in your report.

- [ ] **Step 5: Run**

Run: `node --test "tests/bin-lib/harness-health/*.test.js"`
Expected: PASS. Then `git grep -n "'node', \[CLI" -- tests/bin-lib/harness-health/` → no matches.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/harness-health
git commit -m "Run the harness-health CLI tests in-process — runCli in place of a node process per call"
```

### Task 4: Convert `journey-health.js` to the entry contract

**Files:**
- Modify: `plugin/bin/journey-health.js`
- Modify: `tests/bin-lib/cli-entry-conformance.test.js` (delete `'journey-health.js',` from `NOT_YET`)
- Modify: `tests/bin-lib/health-core/main-exitcode-integration.test.js` (the `journey-health` rows, same form as Task 2)
- Test: `tests/bin-lib/journey-health/cli-qa-evidence.test.js`, `tests/bin-lib/journey-health/cli-validate-findings.test.js` (real-process tests)

**Interfaces:**
- Consumes: Task 1 (`createDurable` from `./lib/journey-health/cache`); Task 2's shape.
- Produces: `run`, `realDeps`, `main(argv) -> integer`, `cmdX(args, ctx) -> integer`, `parseArgs(argv, cwd = process.cwd())`. `validateConfidenceArg(value, stderr)` returns `{ ok, code }`; the line-133 `if (process.exitCode) return;` becomes a check of it. `cmdValidateFindings`'s `root` becomes `path.resolve(ctx.cwd(), args.root)` (absolute, like harness-health's). `resolveReadCommit` gets the env-threaded exec; `dedupAndDispatch` gets `stderr`. Exports: existing names plus `run`, `realDeps`.

- [ ] **Step 0: Write the pinning test before converting (AC5.1, AC8.1)** — as Task 2 Step 0, committed alone before Step 3, in `tests/bin-lib/journey-health/cli-qa-evidence.test.js`:
  - refusal: `spawnCli(CLI, ['no-such-command'], { env: { ...process.env } })` → `code === 2`, `stdout === ''`, `stderr` strictly equal to the current script's full usage text (record it from one run of the unconverted script in this step). Comment: proves an unknown command's stdout, stderr and exit code are unchanged by the conversion.
  - success: `spawnCli(CLI, ['qa-evidence', reportPath, '--story-ids', 'a', '--now', '0'], { env: { ...process.env } })` → `code === 0`, `stderr === ''`, `stdout` strictly equal to the current script's output. Comment: proves the script entry flushes stdout on exit 0.
  Run: PASS against the unconverted script; commit (`Pin journey-health.js output — real-process smoke before the entry conversion`).
- [ ] **Step 1: Failing tests** — `main-exitcode-integration.test.js` journey rows assert the returned code (Task 2 Step 1's form).
- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL after Step 1 — journey `main` returns `undefined`; the conformance test reports `journey-health.js` offences.
- [ ] **Step 3: Implement** as Task 2 Step 3, for journey-health's commands (`next-target`, `validate-findings`, `qa-evidence`, `churn-report`, `mark`, `retry-queue drain|update`; no `push-cursor`/`status`).
- [ ] **Step 4: Third real-process test** (`spawnCli`, same `env` as in-process; journey-health keeps three — the user's plan-review decision recorded in the spec's `## Plan Review Clarifications`):
  - AC3.1 (`cli-validate-findings.test.js`): `validate-findings <file> --root <root> --min-confidence bogus --dry-run` through `runCli` and `spawnCli` → both `2`, identical stderr matching `/--min-confidence "bogus" is not a recognized confidence tier/`.
- [ ] **Step 5: Run** `node --test tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js "tests/bin-lib/journey-health/*.test.js"` → PASS.
- [ ] **Step 6: Commit**

```bash
git add plugin/bin/journey-health.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/health-core/main-exitcode-integration.test.js tests/bin-lib/journey-health/cli-qa-evidence.test.js tests/bin-lib/journey-health/cli-validate-findings.test.js
git commit -m "Give journey-health.js an injectable run entry — sub-commands return their exit codes"
```

### Task 5: Run the five journey-health CLI test files in-process

**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/journey-health/cli-validate-findings.test.js`
- Modify: `tests/bin-lib/journey-health/cli-next-target.test.js`
- Modify: `tests/bin-lib/journey-health/cli-qa-evidence.test.js`
- Modify: `tests/bin-lib/journey-health/cli-mark.test.js`
- Modify: `tests/bin-lib/journey-health/durable-integration.test.js`

- [ ] **Step 1:** Task 3 Step 1, for these five files.
- [ ] **Step 2:** Per-file cwd test (AC9.1) — no `--root`, `cwd: root`; for `cli-qa-evidence`, a relative report path resolved under `cwd`. If a file carries a `PATH`-stub git spy, give it Task 3 Step 2's explicit-`env` form.
- [ ] **Step 3:** AC2.1, AC2.2 in `cli-validate-findings` (pre-set `process.exitCode = 1`, restore in `finally`, valid findings `--dry-run` → `0`); AC4.1 in `cli-next-target` (two journey roots, two sequential calls, each its own root's journey id); the `resolveReadCommit` env-only fixture test (Task 3 Step 3's form) in `cli-validate-findings` (journey-health does not read the plugin version).
- [ ] **Step 4:** Discrimination proof as Task 3 Step 4, reverting the thread-throughs in `plugin/bin/journey-health.js`.
- [ ] **Step 5: Run** `node --test "tests/bin-lib/journey-health/*.test.js"` → PASS; `git grep -n "'node', \[CLI" -- tests/bin-lib/journey-health/` → no matches.
- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/journey-health
git commit -m "Run the journey-health CLI tests in-process — runCli in place of a node process per call"
```

### Task 6: Measure processes before and after, and record the evidence

**Files:**
- Create: `$PIPELINE_RUN_DIR/proc-counts.md` (outside the repo — the orchestrator copies it into the PR body)

- [ ] **Step 1:** Write the ten converted test file paths, one per line, to a scratch list file.
- [ ] **Step 2: Baseline** — in a detached checkout of the merge base (extract it with `git archive <merge-base> | tar -x -C <scratch>`, a fresh directory, and run the tool there), run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from <list>`; then the same command in this worktree. Both within the same hour, same machine.
- [ ] **Step 3 (AC1.1, AC10.1):** Write `proc-counts.md`: the before/after table as the tool prints it (per file: node processes, `plugin/bin` CLI processes by CLI, wall time), the totals for `harness-health.js` + `journey-health.js` (after must be ≤ 10), every test left on a real process with its one-line reason, and every `plugin/bin/lib` file changed to accept an injected value (Task 1's list). If the after-total exceeds 10, stop and report — do not commit around it.
- [ ] **Step 4:** No commit (nothing in the repo changes).

Waived AC1.1: measured, not asserted by a test — Task 6 Step 3's tool run is the evidence and its ≤ 10 total is a stop condition.
Waived AC10.1: PR-body evidence produced by Task 6 Step 3, not a test.
Waived AC6.1: verified by Task 1 Step 4's run of the existing `code-health` / `docs-health` suites; no new test.
Waived plugin/bin/code-health.js: read only — its `makeRetryQueueCommands` call sites already map the returned code (Task 1 Files).
Waived plugin/bin/docs-health.js: read only — same as `code-health.js`.
Waived AC11.1: the full `npm test` run is `/claude-tweaks:build`'s Common Step 5 verification and the Windows CI job is dispatched by the pipeline after the last code change — neither is a plan task.
