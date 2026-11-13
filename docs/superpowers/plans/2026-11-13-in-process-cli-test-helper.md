# In-process CLI test helper, entry contract and resolve-policy.js conversion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tests call a `plugin/bin` CLI inside the test process through a shared helper that fails the test on leaked process state, and prove it on `resolve-policy.js` with no change to that CLI's output or exit codes.

**Architecture:** Extend the existing `run(argv, deps)` convention: a CLI exports `run` and `realDeps` and reaches cwd, env, stdio and child processes only through `deps`. `tests/helpers/run-cli.js` merges fakes over `realDeps`, calls `run`, and compares process state before and after. `resolve-policy.js` splits into a core that returns an object and a `run` that prints it; the library functions it reaches accept an injected `env` and hand it to every `git`/`gh` child.

**Tech Stack:** Node (CI runs Node 20; no npm dependencies), `node:test`, `node:assert`, `node:async_hooks` (`AsyncLocalStorage`).

**Spec:** `.claude-tweaks/pipelines/2026-11-13T170335-spec-5374/work/5374-spec.md` (record #5374). Read it in full before a task; its Data / API Surface and Gotchas sections bind every task.

## Global Constraints

- CI runs Node 20. Use no syntax or API newer than Node 20. No npm dependencies.
- `resolve-policy.js`'s stdout, stderr and exit code are a public contract: byte-identical output for `--values autonomy`, `--all`, an invalid `policy.yml` value, `--run` with a missing path, and no arguments.
- The entry contract (spec, Technical Approach), verbatim: "Above the guarded entry, and in everything `run` calls: no `process.exitCode`, no `process.exit()`, no `process.chdir()`, no write to `process.env`." "A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`, which use the real working directory." "Every child process is started with `cwd: deps.cwd()` and `env: deps.env`."
- A library function that gains an `env` (or `stderr`, `cwd`) option keeps today's behaviour when the option is absent: the default is the inherited environment, and a call that passes no such option produces the same child-process options and the same forwarded `opts` keys as before.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them.
- A test reads a tracked text file through `readText` from `tests/helpers/read-skill.js`, never a raw `fs.readFileSync(p, 'utf8')` (`tests/raw-markdown-read-conformance.test.js` fails otherwise). JSON files are exempt.
- A test that installs a script stub for `gh` skips on win32 with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`. Join PATH entries with `path.delimiter`, never a literal `:`.
- Commit message style: `{Verb} {what} — {detail}`, body line `refs #5374` (never "closes"/"fixes"), final line `Claude-Session: https://claude.ai/code/session_01X7gPFDg2BHrfQoiZ2QBuMu`. Stage files by explicit path. Never `git reset`, never `git checkout .`, never force push.
- Run only the test files a task names (`node --test <file> [<file>…]`). Never run `npm test` or `tools/run-tests.js` with no file list: the full suite is run centrally. Quote raw command output in the report, never a summary of it.

Governing project skills, quoted (read the named file in full before the task that cites it):

- `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (Tasks 3, 4, 6): "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout)." "**A guard added to an existing `run(argv, deps)` reaches the environment through `deps` too.**" "**A CLI whose result an in-process caller consumes as data splits into a core that returns an object and a `run` that only prints it.**" "Pin the split two ways, as `tests/bin-lib/flow/closing-links-cli.test.js` does: the core's envelope deep-equals the line `run` prints for the same fixture, and with no `stdout` injected the core writes nothing to `process.stdout`."
- `.claude/skills/gh-api-module-pattern/SKILL.md` (Tasks 3, 4): "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" The windows-hide scan "accepts a literal `windowsHide` in the call's own argument text, or a bare identifier as the last argument whose `const X = { … }` literal names the key. It rejects a spread (`{ ...QUIET, timeout }`)."
- `.claude/skills/bin-source-scan-conformance/SKILL.md` (Task 6): "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`. From a `tests/bin-lib/` suite the path is `../helpers/strip-comments`." "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15. `tests/strip-comments-callers-twin.test.js` pins both to the tree" "Add the stem to both lists in the commit that adds the suite." "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." "Pin the planted mis-parse through each scan that calls the verdict, not only through the helper's own tests." "`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing. For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree, and make the message say what a low count means." "Assert the exact flagged line numbers, not just a count, because the right count can come from the wrong lines. Run each new assertion against the code it guards with the guard removed, and watch it go red." "A scan whose matcher reads template or comment text owes a narrower detector for its own case, as the exit-code scan does for its guard."
- `.claude/skills/windows-checkout-test-parity/SKILL.md` (Task 6): "When code parses text it reads from a tracked file (a workflow, a skill's markdown, a decisions log), add a CRLF case beside the LF one. Build it from the same string with `.replace(/\n/g, '\r\n')`, so the two cases differ only in line endings".
- `.claude/skills/suite-slot-test-env/SKILL.md` (Task 2): "A test that waits on a slot-holding child bounds it with the spawn's own `timeout` and `killSignal: 'SIGKILL'`" "Never assert a wall-clock budget to catch a hang". A test that spawns `tools/run-tests.js` builds the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`; this plan's one such test passes `slotEnv(dir, { CT_TEST_SUITE_SLOT_HELD: '1' })` so the nested run takes no slot.
- `.claude/skills/policy-key-addition`, `test-impact-tracer-read-shape`, `node-test-output-evidence`: none apply. No policy key is added, `tools/test-impact/tracer.js` is read as a model and not changed, and no code here reads test-reporter output as evidence.

## Corrections to the spec's premises (decided at plan time)

1. The spec's audit of ambient reads on `resolve-policy.js`'s path named `gitRoot()` and two `process.env` reads. Reading the code found more, and this plan threads `env`/`cwd` through all of them: `resolvePolicyConfig`'s `process.cwd()` fallback when git fails (`plugin/bin/lib/policy-schema.js:933`); `readDefaultBranch`'s `gh` and `git` children (`plugin/bin/lib/merge-verification.js:444–459`); `resolveIntegrationBranch`'s `git` children (`plugin/bin/lib/hooks/worktree-reap.js:369–383`); `ghOptions`' origin read (`originUrl`, `plugin/bin/lib/repo-resolve.js:94`), its `GH_CONFIG_DIR` read and its one-time note written to `process.stderr` (`repo-resolve.js:276–291`); and `fs.statSync(runDir)` on a relative `--run` value (`plugin/bin/resolve-policy.js:146`).
2. The helper also exports `runCliSync`, a synchronous twin of `runCli` for a CLI whose `run` returns an integer. Reason: `resolve-policy.js`'s `run` is synchronous and the two converted test files hold 87 synchronous call sites behind four small helpers; with only a Promise-returning `runCli`, every test body would need `async`/`await`, and a missed `await` can pass silently (`assert.notStrictEqual(promise.status, 0)` holds for `undefined`). `runCli` keeps the spec's signature.
3. A remote injected through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0` is not seen by `git remote get-url origin` (probed 2026-11-13: `error: No such remote 'origin'`). Env-only fixtures therefore use `GIT_DIR`: with `GIT_DIR=<repo B>/.git` in the child's env and cwd in repo A, `git rev-parse --show-toplevel` prints A, while `git remote get-url origin`, `git rev-parse --abbrev-ref origin/HEAD` and `git rev-parse --verify refs/remotes/origin/main` read repo B (probed the same day; all four printed as stated).

## Review Focus

1. A CLI whose `run` throws or rejects: the helper must restore `process.stdout.write`, `process.stderr.write`, `os.homedir` and its pending flag, so the next `runCli` call in the same file works. Test in Task 1.
2. The test runner's own writes to `process.stdout`/`process.stderr` while an async `run` is awaited must not be reported as the CLI's leak. Test in Task 1.
3. A relative `--run` value and a cwd outside any git repository must resolve against the injected `cwd`, not the test runner's working directory. Tests in Task 4.
4. A log line torn by a killed process (half a JSON object) must be skipped by the counting tool, not crash it. Test in Task 2.
5. A `plugin/bin` file checked out with CRLF line endings must get the same conformance verdict as its LF text. Test in Task 6.

---

### Task 1: The in-process helper `tests/helpers/run-cli.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tests/helpers/run-cli.js`
- Create: `tests/helpers-run-cli.test.js`
- Create: `tests/fixtures/run-cli/ok-cli.js`, `tests/fixtures/run-cli/async-cli.js`, `tests/fixtures/run-cli/leaky-cli.js`, `tests/fixtures/run-cli/runner-cli.js`, `tests/fixtures/run-cli/no-realdeps-cli.js`, `tests/fixtures/run-cli/throwing-cli.js`, `tests/fixtures/run-cli/script-cli.js`

**Interfaces:**
- Consumes: nothing from other tasks. Model the file header and test layout on `tests/helpers/git-template.js` and `tests/helpers-git-template.test.js`.
- Produces (`module.exports = { runCli, runCliSync, spawnCli }`):
  - `runCli(cliPath, argv, { env = {}, cwd = process.cwd(), stdin = '', deps = {}, fresh = false, allowRealRunner = false } = {})` → `Promise<{ code, stdout, stderr }>`.
  - `runCliSync(cliPath, argv, sameOptions)` → `{ code, stdout, stderr }`. Throws `runCliSync: run returned a promise — use runCli` when `run` returns a thenable.
  - `spawnCli(cliPath, argv, { env = process.env, cwd, stdin } = {})` → `{ code, stdout, stderr }` from `spawnSync(process.execPath, [cliPath, ...argv], { encoding: 'utf8', windowsHide: true, cwd, env, input: stdin })`; `code` is the child's `status`.

Behaviour both in-process functions share (spec, Data / API Surface):

- Require `cliPath`. Refuse a module with no `run` function or no `realDeps` object: `runCli: <basename> exports no realDeps — see the entry contract in .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`.
- Fakes: `stdout: (s) => collect`, `stderr: (s) => collect`, `cwd: () => cwd`, `env: Object.freeze({ ...env })`, `stdin: () => stdin`, `homeDir: () => env.HOME || env.USERPROFILE` (throws `runCli: env has no HOME or USERPROFILE` when neither is set). Merged deps: `{ ...cli.realDeps, ...fakes, ...deps }`.
- Fail-closed runners: after the merge, each key among `runner`, `gh`, `spawn` whose value is still `cli.realDeps[key]` is replaced, unless `allowRealRunner` is true, by a function that throws `runCli: real <key> reached — pass a fake in deps or allowRealRunner: true`.
- `fresh: true` deletes every `require.cache` key under the repository's `plugin/bin` directory (resolved from the helper's own `__dirname`, compared as a path prefix ending in `path.sep`) before requiring the CLI.
- `run` must return an integer (or a Promise of one for `runCli`); anything else fails with `runCli: run returned <value>, expected an integer exit code`.
- Leak guard. Before the call record `process.exitCode`, `process.cwd()`, a shallow copy of `process.env`, and for each of `exit`, `SIGINT`, `SIGTERM`, `SIGHUP`, `uncaughtException` the array `process.listeners(name)`. For the duration of the call replace `process.stdout.write`, `process.stderr.write` and `os.homedir` with recorders. Attribute with an `AsyncLocalStorage`: `run` is called inside `storage.run(token, …)`, and a recorder counts a call as the CLI's only when `storage.getStore() === token`; any other call passes through to the original function unchanged. A counted direct write is swallowed (not passed through). An `os.homedir()` call counts as a leak only when `env.HOME` or `env.USERPROFILE` was given and differs from the real `process.env` value; otherwise the recorder returns the original's result.
- After the call, in a `finally`: put the three functions back, then undo every difference — reset `process.exitCode`, `process.chdir` back, restore changed/added/removed `process.env` keys, remove each listener that was not in the recorded arrays — and clear the pending flag. If `run` threw or rejected, rethrow that error. Otherwise, if there was any difference, fail with one error whose message starts `runCli: <basename> leaked process state: ` and lists every difference joined by `; `, using these phrases: `process.exitCode changed (<before> -> <after>)`, `process.cwd() changed`, `process.env.<KEY> <added|changed|removed>`, `<event> listeners <n> -> <m>`, `wrote to process.stdout directly`, `wrote to process.stderr directly`, `called os.homedir() while env.HOME was injected`.
- A second in-process call while one is pending throws `runCli: another runCli call is still pending`. `runCli` is a plain (non-`async`) function that runs this check synchronously before it returns its Promise, so the second caller gets a throw, not a rejection.

Fixture CLIs (each a small CommonJS file exporting `run` and, except `no-realdeps-cli.js`, `realDeps`; only `script-cli.js`, described with its test below, has a `require.main` entry):

- `ok-cli.js`: `run(argv, deps)` writes `JSON.stringify({ argv, cwd: deps.cwd(), x: deps.env.X ?? null, stdin: deps.stdin() })` plus `\n` to `deps.stdout`, writes `warn\n` to `deps.stderr`, returns `undefined` when `argv[0] === 'undefined'`, else `Number(argv[0]) || 0`.
- `async-cli.js`: `async run` awaits `new Promise((r) => setTimeout(r, 20))`, writes `done\n` to `deps.stdout`, returns `3`.
- `leaky-cli.js`: `run([kind], deps)` performs one leak then returns `0`. Kinds: `exitcode` (`process.exitCode = 3`), `chdir` (`process.chdir(require('os').tmpdir())`), `env-add` (`process.env.CT_RUN_CLI_LEAK = '1'`), `env-change` (`process.env.PATH = 'changed'`), `listener` (`process.on('SIGTERM', () => {})`), `stdout` (`process.stdout.write('leak')`), `stderr` (`process.stderr.write('leak')`), `homedir` (`require('os').homedir()`), `async-stdout` (returns a Promise that, after a 10 ms timer, calls `process.stdout.write('late')` and resolves `0`).
- `runner-cli.js`: `realDeps = { runner: () => 'real-runner-reached', stdout: … }`; `run` writes `deps.runner()` to `deps.stdout` and returns `0`.
- `no-realdeps-cli.js`: exports only `run`.
- `throwing-cli.js`: `run([kind])` — `sync` throws `new Error('boom')` after calling `process.stdout.write('x')`; `async` returns a rejected Promise of `new Error('boom')`.

- [ ] **Step 1: Write the failing tests** in `tests/helpers-run-cli.test.js`

One `test()` per line below, with these names and assertions (`FX` is `path.join(__dirname, 'fixtures', 'run-cli')`):

```js
test('runCliSync captures stdout, stderr and the exit code, and passes argv, cwd, env and stdin through deps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-run-cli-'));
  const res = runCliSync(path.join(FX, 'ok-cli.js'), ['7', 'b'], { cwd: dir, env: { X: 'y' }, stdin: 'in' });
  assert.deepStrictEqual(res, { code: 7, stdout: `${JSON.stringify({ argv: ['7', 'b'], cwd: dir, x: 'y', stdin: 'in' })}\n`, stderr: 'warn\n' });
});
test('runCli awaits an async run', async () => {
  assert.deepStrictEqual(await runCli(path.join(FX, 'async-cli.js'), []), { code: 3, stdout: 'done\n', stderr: '' });
});
test('runCliSync refuses a run that returns a promise', () => {
  assert.throws(() => runCliSync(path.join(FX, 'async-cli.js'), []), /run returned a promise — use runCli/);
});
test('env is the complete environment the CLI sees: default {} hides process.env', () => {
  process.env.X = 'ambient';
  try { assert.match(runCliSync(path.join(FX, 'ok-cli.js'), []).stdout, /"x":null/); } finally { delete process.env.X; }
});
```

Leak tests, AC1 — each asserts the rejection message and that the state is restored afterwards (`leak` is `(kind, opts) => runCli(path.join(FX, 'leaky-cli.js'), [kind], opts)`):

- `AC1.1 (a): runCli rejects when run sets process.exitCode` — `await assert.rejects(leak('exitcode'), /leaked process state: .*process\.exitCode changed \(undefined -> 3\)/)`; then `assert.strictEqual(process.exitCode, undefined)`.
- `AC1.1 (b): runCli rejects when run calls process.chdir` — rejects `/process\.cwd\(\) changed/`; then `process.cwd()` equals its value before the call.
- `AC1.1 (c): runCli rejects when run adds a process.env key` — rejects `/process\.env\.CT_RUN_CLI_LEAK added/`; then `'CT_RUN_CLI_LEAK' in process.env` is false.
- `AC1.1 (c): runCli rejects when run changes a process.env key` — rejects `/process\.env\.PATH changed/`; then `process.env.PATH` equals its value before the call.
- `AC1.1 (d): runCli rejects when run leaves a SIGTERM listener registered` — rejects `/SIGTERM listeners \d+ -> \d+/`; then `process.listenerCount('SIGTERM')` equals its value before the call.
- `AC1.1 (e): runCli rejects when run writes to process.stdout directly` — rejects `/wrote to process\.stdout directly/`. Same test, second assertion: kind `stderr` rejects `/wrote to process\.stderr directly/`.
- `AC1.1 (e): a direct write after an await is still attributed to the CLI` — kind `async-stdout` rejects `/wrote to process\.stdout directly/`.
- `AC1.1 (f): runCli rejects when run calls os.homedir() while env.HOME differs from the real one` — `leak('homedir', { env: { HOME: '/nonexistent-home', USERPROFILE: '/nonexistent-home' } })` rejects `/called os\.homedir\(\) while env\.HOME was injected/`; and `leak('homedir', { env: { ...process.env } })` resolves `{ code: 0, stdout: '', stderr: '' }`.
- `runCliSync applies the same leak guard` — `assert.throws(() => runCliSync(path.join(FX, 'leaky-cli.js'), ['exitcode']), /process\.exitCode changed/)`; then `process.exitCode` is `undefined`.
- `a deps.stderr write is not a leak` — covered by the first test (`stderr: 'warn\n'` with no rejection); no separate test.

Runner tests, AC2:

- `AC2.1: a real runner left in realDeps throws, naming the key, when the CLI calls it` — `await assert.rejects(runCli(path.join(FX, 'runner-cli.js'), []), /runCli: real runner reached — pass a fake in deps or allowRealRunner: true/)`, and the same message from `assert.throws(() => runCliSync(path.join(FX, 'runner-cli.js'), []), …)`.
- `AC2.2: allowRealRunner reaches the real runner, and a fake in deps replaces it` — `(await runCli(…, [], { allowRealRunner: true })).stdout === 'real-runner-reached'`; `runCliSync(…, [], { allowRealRunner: true }).stdout === 'real-runner-reached'`; `runCliSync(…, [], { deps: { runner: () => 'fake' } }).stdout === 'fake'`.

Contract and Review Focus tests:

- `refuses a CLI that exports no realDeps` — throws `/no-realdeps-cli\.js exports no realDeps/`.
- `rejects a run that returns a non-integer` — `assert.throws(() => runCliSync(path.join(FX, 'ok-cli.js'), ['undefined']), /run returned undefined, expected an integer exit code/)`.
- `Review Focus 1: a run that throws leaves the helper usable` — `assert.throws(() => runCliSync(path.join(FX, 'throwing-cli.js'), ['sync']), /^Error: boom$/)`; then `runCliSync(path.join(FX, 'ok-cli.js'), [])` returns `code: 0`; and `await assert.rejects(runCli(path.join(FX, 'throwing-cli.js'), ['async']), /^Error: boom$/)` followed by another successful `runCliSync`.
- `Review Focus 2: a write from outside the CLI's async context is not reported as its leak` — `const p = runCli(path.join(FX, 'async-cli.js'), []); process.stderr.write(''); assert.deepStrictEqual(await p, { code: 3, stdout: 'done\n', stderr: '' });`.
- `a second in-process call while one is pending throws` — `const p = runCli(path.join(FX, 'async-cli.js'), []); assert.throws(() => runCliSync(path.join(FX, 'ok-cli.js'), []), /another runCli call is still pending/); assert.throws(() => runCli(path.join(FX, 'ok-cli.js'), []), /another runCli call is still pending/); await p;`.
- `spawnCli returns the same shape from a real process` — add a seventh fixture, `tests/fixtures/run-cli/script-cli.js`, which exports `run` and `realDeps` like `ok-cli.js` and ends with `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` (its `realDeps.stdin` reads `fs.readFileSync(0, 'utf8')`). Assert `spawnCli(path.join(FX, 'script-cli.js'), ['4'], { cwd: dir, env: { ...process.env, X: 'y' }, stdin: 'in' })` deep-equals `{ code: 4, stdout: `${JSON.stringify({ argv: ['4'], cwd: dir, x: 'y', stdin: 'in' })}\n`, stderr: 'warn\n' }`, and that `runCliSync` on the same file with the same argv, `cwd`, `env: { X: 'y' }` and `stdin` returns the same object (`dir` passed through `fs.realpathSync`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/helpers-run-cli.test.js`
Expected: FAIL with `Cannot find module './helpers/run-cli'`.

- [ ] **Step 3: Write the seven fixture CLIs and implement `tests/helpers/run-cli.js`**

Share one internal function between `runCli` and `runCliSync` for building the merged deps and one pair (`snapshot()` / `finish(snapshot)`) for the guard, so the two cannot drift. Header comment: what the helper is for, the contract file it enforces, and that `runCli`'s default `env` is `{}` (a CLI that starts `git` or `gh` needs `PATH`, and `SystemRoot` on Windows, in the `env` a test passes).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/helpers-run-cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove each guard discriminates, then commit**

For each of the seven leak comparisons (exitCode, cwd, env, listeners, stdout recorder, stderr recorder, homedir recorder) and for the fail-closed runner replacement: comment out that one check in `run-cli.js`, run the file, confirm exactly the matching test goes red, restore. Quote the failing test name per mutation in the report.

```bash
git add tests/helpers/run-cli.js tests/helpers-run-cli.test.js tests/fixtures/run-cli
git commit -F <message file>   # Add in-process CLI test helper — runCli, runCliSync, spawnCli with a process-state leak guard
```

---

### Task 2: The node-process counter `tools/count-node-procs.js`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tools/count-node-procs.js`
- Create: `tools/count-node-procs-preload.js`
- Create: `tests/count-node-procs.test.js`
- Modify: `docs/plugin-structure.md` (the `tools/` entry near line 88 and the maintainer command list near line 169 — one clause and one command line)

**Interfaces:**
- Consumes: `requireOption(p)` from `tools/test-impact/node-options.js` (returns `--require "<forward-slashed path>"`); `tools/run-tests.js`'s CLI (`--files-from <list>`, or root arguments). `tools/test-impact/tracer.js` is the model for a preload that must never break the process it loads into (read its header; do not change it). A working scratch prototype of this tool exists for reference only at `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/051b3b3e-3c33-460f-b4ed-730fa84d0a52/scratchpad/analyze-procs.js` (the attribution walk, lines 32–50).
- Produces:
  - CLI: `node tools/count-node-procs.js [--files-from <list>] [--json <out>]`. Exit code is the test run's exit code; a malformed invocation exits 2 with usage on stderr.
  - `module.exports = { run, analyze, formatTable }` with `run(argv, deps)` → exit code (deps: `spawnSync`, `env`, `stdout`, `stderr`, `tmpdir`), `analyze(logText, { repoRoot })` → `{ files: [{ file, nodeProcs, cliProcs, wallMs }], unattributed: { nodeProcs, cliProcs }, skippedLines }`, `formatTable(result)` → string.

Decisions:

- Preload (`tools/count-node-procs-preload.js`): whole body inside `try { … } catch {}`. When `process.env.CT_COUNT_NODE_LOG` is set, append one line `{"ev":"start","pid":…,"ppid":…,"t":Date.now(),"argv":process.argv.slice(1, 6),"execArgv":process.execArgv.slice(0, 3)}` with `fs.appendFileSync`, and register `process.on('exit', …)` appending `{"ev":"exit","pid":…,"t":Date.now()}` (its own `try/catch`). It writes nothing to stdout or stderr.
- `run`: creates a temp dir under `deps.tmpdir()`, sets `CT_COUNT_NODE_LOG` to a file in it and `NODE_OPTIONS` to `[deps.env.NODE_OPTIONS, requireOption(preloadPath)].filter(Boolean).join(' ')`, then runs `spawnSync(process.execPath, [runTestsPath, ...args], { stdio: 'inherit', env, windowsHide: true })`. `args` is `['--files-from', list]` when given, else the two default roots spelled out, `tests` and `tools/upstream-drift/tests` (explicit roots, so the no-argument form always runs the whole root set whatever a plain `npm test` selects). After the run it prints the table to `deps.stdout`, writes `--json` when asked, removes the temp dir, and returns the child's status (`1` when the status is `null`).
- `analyze`: parse line by line, skipping (and counting in `skippedLines`) any line that is not a JSON object with a numeric `pid` and `t`. A start line's script is `argv[0]`. A test-file process is one whose script, made repo-relative with forward slashes, ends in `.test.js`. A CLI process is one whose repo-relative script matches `plugin/bin/<name>.js` (top level only), named `<name>.js`. Each start line is attributed to the test file at the top of its parent chain: follow `ppid` to the most recent start line of that pid at or before the child's `t`, at most 12 hops; a chain that reaches no test file counts under `unattributed`. `nodeProcs` counts every attributed process including the test-file process itself. `wallMs` is the latest exit `t` minus the earliest start `t` among the file's attributed processes (the latest start `t` when no exit line was logged). `files` is sorted by `file`.
- `formatTable`: first line `# counts are a floor: a child started with a replaced env drops NODE_OPTIONS and is not logged; a node process started through a non-node parent (a shell) is not attributed to a test file`, then a header row `file  node  cli  wall-ms`, one row per file (`cli` is the sum of that file's `cliProcs` values), an `(unattributed)` row, and a `total` row.
- `--json <out>` writes `JSON.stringify(result.files)` — one object per test file with `file`, `nodeProcs`, `cliProcs` (an object keyed by CLI) and `wallMs`.
- Script entry, last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

- [ ] **Step 1: Write the failing tests** in `tests/count-node-procs.test.js`

- `analyze attributes a CLI process to the test file at the top of its parent chain` — log text built from these lines (repoRoot `/r`): start pid 10 ppid 1 t 100 argv `['/r/tests/a.test.js']`; start pid 11 ppid 10 t 110 argv `['/r/plugin/bin/resolve-policy.js', '--values']`; start pid 12 ppid 11 t 120 argv `['/r/plugin/bin/lib/x.js']`; exit pid 12 t 130; exit pid 11 t 140; exit pid 10 t 200. Assert `files` deep-equals `[{ file: 'tests/a.test.js', nodeProcs: 3, cliProcs: { 'resolve-policy.js': 1 }, wallMs: 100 }]` and `unattributed` deep-equals `{ nodeProcs: 0, cliProcs: {} }`.
- `analyze resolves a reused pid to the most recent start at or before the child` — two start lines for pid 10 (t 100 `tests/a.test.js`, t 500 `tests/b.test.js`), a child pid 20 ppid 10 at t 510; assert the child counts under `tests/b.test.js`.
- `analyze counts a process with no test-file ancestor as unattributed` — start pid 30 ppid 999 argv `['/r/plugin/bin/hooks.js', 'reconcile']`; assert `unattributed` deep-equals `{ nodeProcs: 1, cliProcs: { 'hooks.js': 1 } }` and `files` is `[]`.
- `Review Focus 4: analyze skips a torn log line` — a valid start line, then the text `{"ev":"start","pid":4`, then a valid exit line; assert `skippedLines === 1` and the one file row is intact.
- `formatTable prints the floor note, one row per file and a total` — assert the first line starts `# counts are a floor`, that a line matching `/^tests\/a\.test\.js\s+3\s+1\s+100$/m` is present, and a line matching `/^total\s+3\s+1\b/m`.
- `AC10.1: run passes the list through, returns the test run's exit code and writes --json` — call `run(['--files-from', 'list.txt', '--json', outPath], deps)` with a fake `spawnSync` that asserts `args.slice(1)` deep-equals `['--files-from', 'list.txt']`, asserts `options.env.NODE_OPTIONS` ends with `count-node-procs-preload.js"` and starts with the fake env's existing `NODE_OPTIONS` value `--max-old-space-size=64`, writes the three-process log above to `options.env.CT_COUNT_NODE_LOG`, and returns `{ status: 5 }`. Assert the return value is `5`, the collected stdout contains the `tests/a.test.js` row, and `JSON.parse(fs.readFileSync(outPath))` deep-equals the `files` array above.
- `run with no arguments names both default roots` — fake `spawnSync` asserts `args.slice(1)` deep-equals `['tests', path.join('tools', 'upstream-drift', 'tests')]`; returns `{ status: 0 }`; `run([], deps)` returns `0`.
- `run rejects an unknown flag with exit 2` — `run(['--nope'], deps)` returns `2`, the fake `spawnSync` is never called, stderr contains `usage:`.
- `the preload logs a start and an exit line and prints nothing` — `spawnSync(process.execPath, ['-e', '0'], { env: { ...process.env, NODE_OPTIONS: requireOption(preloadPath), CT_COUNT_NODE_LOG: logFile }, encoding: 'utf8', windowsHide: true })`; assert status `0`, stdout and stderr both `''`, and the log's two parsed lines have `ev` `start` then `exit` with the same `pid`.
- `AC10.1: one real run prints a row for the listed test file` — write a list file naming `tests/helpers-git-template.test.js` (an existing fast file), then `spawnSync(process.execPath, [toolPath, '--files-from', listFile, '--json', outPath], { cwd: repoRoot, env: slotEnv(lockDir, { CT_TEST_SUITE_SLOT_HELD: '1' }), encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', windowsHide: true })`. Assert status `0`, and the parsed JSON has exactly one object whose `file` is `tests/helpers-git-template.test.js` with `nodeProcs >= 1` and a numeric `wallMs`. If this test hangs when run from inside an agent session, report it with the raw output instead of loosening it.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/count-node-procs.test.js`
Expected: FAIL with `Cannot find module '../tools/count-node-procs.js'`.

- [ ] **Step 3: Implement the preload and the tool; add the `docs/plugin-structure.md` entries**

In `docs/plugin-structure.md` add `count-node-procs.js` to the `tools/` entry's list, in that entry's style: what it does, its flags, its exit codes, that its counts are a floor, and `tests in tests/count-node-procs.test.js`; and one command line beside `node tools/efficiency-report.js …`: `node tools/count-node-procs.js [--files-from <list>] [--json <out>]   # Per-test-file node process counts (#5374, maintainer-side, not shipped) — …`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/count-node-procs.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tools/count-node-procs.js tools/count-node-procs-preload.js tests/count-node-procs.test.js docs/plugin-structure.md
git commit -F <message file>   # Add count-node-procs tool — node processes, plugin/bin CLI processes and wall time per test file
```

---

### Task 3: Thread an injected environment through the forge probe's library functions

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`resolveForgeProbeTimeoutMs` ~785, `detectIntegrationModel` ~846, `resolvePolicyConfig` ~928)
- Modify: `plugin/bin/lib/policy-derived-defaults.js` (`computeDerivedDefaults`)
- Modify: `plugin/bin/lib/merge-verification.js` (`readDefaultBranch` ~444, `deriveMergeVerification` ~471)
- Modify: `plugin/bin/lib/hooks/worktree-reap.js` (`preferRemoteTrackingRef` ~369, `resolveIntegrationBranch` ~374)
- Modify: `plugin/bin/lib/repo-resolve.js` (`originUrl` ~94, `resolveGhSpec` ~196)
- Create: `tests/forge-probe-env.test.js` (all of this task's new tests, in one file with one shared fixture helper)

**Interfaces:**
- Consumes: `runGit(args, cwd, opts)` in `plugin/bin/lib/hooks/git-exec.js` already forwards `opts.env` to its child. `ghOptions(args, opts, deps)` already reads `opts.env`, `deps.env` and `deps.stderr`.
- Produces (every addition optional; absent means today's behaviour):
  - `resolveForgeProbeTimeoutMs(repoRoot, opts)` reads `CLAUDE_TWEAKS_GH_TIMEOUT_MS` from `opts.env` when `opts.env` is given, else from `process.env`.
  - `detectIntegrationModel(repoRoot, opts)` accepts `opts.env` and `opts.stderr`. When `opts.env` is given, both children (`git remote get-url origin`, `gh repo view`) get it as their `env` option and `ghOptions` is called with a third argument carrying `env` (and `stderr` when `opts.stderr` is given). When it is absent, both option objects and the `ghOptions` call are exactly as today.
  - `resolveIntegrationModel(repoRoot, opts)` already forwards `opts` unchanged.
  - `resolvePolicyConfig({ git, readFile, runDir, keys, onInvalid, cwd })`: when `git` throws, `root` is `cwd` if given, else `process.cwd()`.
  - `computeDerivedDefaults(result, keys, root, deps)` accepts `deps.env` and `deps.stderr`. When `deps.env` is given it is added to the `opts` handed to `detectModel` and `resolveModel` and to the deps handed to `deriveVerification` (as `env`); `deps.stderr` likewise as `stderr` to the two model lookups. When absent, the `opts` objects have exactly today's keys.
  - `deriveMergeVerification(repoRoot, deps)` accepts `deps.env` and passes it to `readDefaultBranch(repoRoot, env)` and to `resolveIntegrationBranch(repoRoot, undefined, { env })` (only when the caller injected neither `deps.defaultBranch` nor `deps.integrationBranch`).
  - `resolveIntegrationBranch(repoRoot, cache, opts = {})` and `preferRemoteTrackingRef(repoRoot, name, opts = {})` pass `opts.env` to `runGit` when given.
  - `detectIntegrationModel`'s `opts`, `deriveMergeVerification`'s `deps` (for `readDefaultBranch`) and `computeDerivedDefaults`'s `deps` also accept `homeDir`, a function returning the home directory. When given, the object handed to `ghOptions` as its third argument carries a lazy getter, `get homedir() { return homeDir(); }`, which `ghConfigDir` reads only on its last fallback (`deps.homedir || os.homedir()`, `repo-resolve.js:107`). `computeDerivedDefaults` forwards `deps.homeDir` exactly as it forwards `deps.env`.
  - `originUrl(cwd, env)` adds `env` to its child's options when given; `resolveGhSpec(cwd, deps)` calls `originUrl(key, deps.env)` when `deps.remoteUrl` is absent.

- [ ] **Step 1: Write the failing tests**

Shared fixture, a local helper `forgePair({ origin })`: two temp repos made with `git init -q -b main` plus one empty commit (`-c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m init`). Repo A has no remote. Repo B has `remote add origin <origin>`, `update-ref refs/remotes/origin/main HEAD` and `symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`. Return `{ a, b, gitDir: path.join(b, '.git') }` with both paths passed through `fs.realpathSync`. A stub `gh` for an injected-only PATH is a `#!/bin/sh` script written into its own `fs.mkdtempSync` directory and `chmod 0o755` — never `installStub`, which edits `process.env.PATH`. Injected env: `{ ...process.env, GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH }` with `GH_HOST` and `GH_REPO` deleted.

- `detectIntegrationModel: the git and gh children get opts.env` (`{ skip: STUB_SKIP }`) — origin `https://github.com/o/r.git`; stub writes `ran` to a marker file and exits 0. Assert `detectIntegrationModel(a) === 'local-merge'` and the marker does not exist (control: no env, A has no origin); then `detectIntegrationModel(a, { env }) === 'pr-first'` and the marker exists.
- `detectIntegrationModel: a GitHub Enterprise origin read through opts.env sets GH_HOST for the gh child, and the note goes to opts.stderr` (`{ skip: STUB_SKIP }`) — origin `https://ghe.example.test/o/r.git`; a temp `GH_CONFIG_DIR` holding `hosts.yml` with the single line `ghe.example.test:`; the stub writes `$GH_HOST` to the marker. Call `_resetGhHostCache()` (exported by `repo-resolve.js`) first. With `env` as above plus `GH_CONFIG_DIR`, and `stderr: (s) => notes.push(s)`: assert the result is `'pr-first'`, the marker's content trimmed is `ghe.example.test`, and `notes.join('')` matches `/gh calls get GH_HOST=ghe\.example\.test/`.
- `detectIntegrationModel: hosts.yml is read under opts.homeDir() when the env names no gh config dir` (`{ skip: STUB_SKIP }`) — the same GitHub Enterprise pair and `$GH_HOST`-writing stub; a temp `home` holding `.config/gh/hosts.yml` with the line `ghe.example.test:`; `env` as above with `GH_CONFIG_DIR`, `XDG_CONFIG_HOME`, `GH_HOST` and `GH_REPO` deleted; `_resetGhHostCache()` first. With `{ env, homeDir: () => home, stderr: () => {} }` the marker's content trimmed is `ghe.example.test`. Second half, after another `_resetGhHostCache()` and with the marker removed: `{ env, homeDir: () => emptyDir, stderr: () => {} }` (a temp dir with no `.config`) leaves the marker's content empty (the host is unknown, so no `GH_HOST` is set).
- `resolveForgeProbeTimeoutMs reads CLAUDE_TWEAKS_GH_TIMEOUT_MS from opts.env and ignores process.env when opts.env is given` — with `process.env.CLAUDE_TWEAKS_GH_TIMEOUT_MS = '4321'` set inside `try/finally` and a temp root with no `policy.yml`: `resolveForgeProbeTimeoutMs(root, { env: { CLAUDE_TWEAKS_GH_TIMEOUT_MS: '1234' } }) === 1234`; `resolveForgeProbeTimeoutMs(root, { env: {} }) === 5000`; `resolveForgeProbeTimeoutMs(root) === 4321`.
- `resolvePolicyConfig falls back to the given cwd when git fails` — `git: () => { throw new Error('no git'); }`, `readFile: (p) => { seen.push(p); return null; }`, `keys: ['autonomy']`, `cwd: other` (a temp dir): `root === other` and `seen[0] === path.join(other, '.claude-tweaks', 'policy.yml')`; without `cwd`, `root === process.cwd()`.
- `computeDerivedDefaults forwards deps.env and deps.stderr, and adds no key when they are absent` — with `result = { 'integration-model': { value: null, source: 'default' } }`, `keys = ['integration-model']` and a fake `detectIntegrationModel` that records its `opts` and returns `'local-merge'`: given `deps.env = E`, `deps.stderr = S` and `deps.homeDir = H`, assert `opts.env === E`, `opts.stderr === S` and `opts.homeDir === H`; given neither, assert `Object.keys(opts).sort()` deep-equals `['mcpReachable', 'onDegrade']`. Second half, `keys = ['merge-verification']` with a fake `deriveMergeVerification` recording its second argument: `env` is `E` when given and `'env' in deps` is false when not.
- `resolveIntegrationBranch reads origin/HEAD through opts.env` — `resolveIntegrationBranch(a) === null`; `resolveIntegrationBranch(a, undefined, { env: { ...process.env, GIT_DIR: gitDir } }) === 'main'`.
- `deriveMergeVerification: both branch lookups get deps.env` — repo A gets `.github/workflows/ci.yml` with the text `on:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`; env is `{ ...process.env, GIT_DIR: gitDir, PATH: pathWithOnly(['git'], { exclude: ['gh'] }) }`. Assert `deriveMergeVerification(a, { integrationModel: () => 'pr-first' }) === 'off'` and `deriveMergeVerification(a, { integrationModel: () => 'pr-first', env }) === 'merge-when-green'`.
- `deriveMergeVerification: readDefaultBranch's gh child gets deps.env` (`{ skip: STUB_SKIP }`) — a plain temp repo (no pair) with the same workflow file and `.claude-tweaks/policy.yml` holding `integration-branch: trunk\n`; stub `gh` prints `trunk`; env `{ ...process.env, PATH: stubDir + path.delimiter + process.env.PATH }` without `GH_HOST`/`GH_REPO`. Assert `deriveMergeVerification(root, { integrationModel: () => 'pr-first', env }) === 'merge-when-green'`, and `deriveMergeVerification(root, { integrationModel: () => 'pr-first', env: { ...process.env, PATH: pathWithOnly(['git'], { exclude: ['gh'] }) } }) === 'off'` (no `gh` on that PATH and no `origin/HEAD`, so no default branch).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/forge-probe-env.test.js`
Expected: FAIL — each test fails on its `env` assertion (for example `'local-merge' !== 'pr-first'`).

- [ ] **Step 3: Implement the additions listed under Produces**

Keep each child's options object a literal that names `windowsHide: true` (no spread of a shared options constant into a spawn call). Update each function's header comment to state the new option in one sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/forge-probe-env.test.js tests/integration-model.test.js tests/integration-model-gh-timeout.test.js tests/merge-verification.test.js tests/hooks-worktree-reap.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/bin-lib/express/policy.test.js tests/bin-lib/flow/preflight.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove each threading point, then commit**

Remove the hand-off at each of these nine points in turn, run `tests/forge-probe-env.test.js`, confirm a test goes red, restore: the `git` child and the `gh` child in `detectIntegrationModel`; the `ghOptions` third argument; its `homedir` getter; `originUrl`'s `env`; `resolveForgeProbeTimeoutMs`'s read; `readDefaultBranch`'s `gh` child and its `git` child; `resolveIntegrationBranch`'s `runGit` call. Quote the failing test name per point.

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy-derived-defaults.js plugin/bin/lib/merge-verification.js plugin/bin/lib/hooks/worktree-reap.js plugin/bin/lib/repo-resolve.js tests/forge-probe-env.test.js
git commit -F <message file>   # Thread an injected env through forge detection — git and gh children, the gh timeout read and the root fallback
```

---

### Task 4: Convert `plugin/bin/resolve-policy.js` to `resolvePolicy` + `run` + `realDeps`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/resolve-policy.js`
- Create: `tests/resolve-policy-entry.test.js`
- Modify: `tests/helpers-run-cli.test.js` (add the `fresh` test)

**Interfaces:**
- Consumes: `runCliSync`, `spawnCli` (Task 1); `resolvePolicyConfig({ …, cwd })`, `computeDerivedDefaults(result, keys, root, { mcpReachable, runConfigRaw, onDegrade, env, stderr })` (Task 3); `anchoredOrOutsideMessage(runDir, cwd, '--run')` from `plugin/bin/lib/run-dir-guard.js`.
- Produces (`module.exports = { resolvePolicy, run, realDeps }`):
  - `resolvePolicy({ keys, runDir = null, mcpReachable = false }, deps)` → `{ code: 0, result, invalidRaw, degrades }` (`invalidRaw` and `degrades` are `Map`s) or `{ code: 1, message }`, where `message` is the text that follows `resolve-policy: ` on stderr, without the trailing newline. `deps`: `cwd()`, `env`, `git(args, { cwd, env })`, `readFile(path)`, optional `stderr(text)` (handed to the library for its own notes; the core itself prints nothing) and optional `homeDir()` (handed to the library for gh's config-dir fallback).
  - `run(argv, deps = realDeps)` → `0` or `1`.
  - `realDeps = { cwd: () => process.cwd(), env: process.env, homeDir: () => os.homedir(), git, readFile, stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }`, where `git(args, { cwd, env })` is today's `gitRoot` with `cwd` and `env` added to its options.
  - Last statement of the file: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

Decisions:

- `run` owns argv parsing, the three flag checks (`--all` with `--values`, `--all` with keys, `--values` with a block key), the usage error, and all printing. It calls the core once. On `{ code: 1 }` it writes `resolve-policy: ${message}\n` to `deps.stderr` and returns 1. Every message text and the order of checks stay as they are today (flag checks before the `--run` checks).
- The core owns, in this order: the `--run` anchoring guard (`anchoredOrOutsideMessage(runDir, deps.cwd(), '--run')`), the is-a-directory check, `resolvePolicyConfig`, `computeDerivedDefaults`, and the `model-profiles` block. The is-a-directory check and the `config.yml` read use `path.resolve(deps.cwd(), runDir)`; the "does not exist" message keeps echoing `runDir` as given.
- The core passes `resolvePolicyConfig` a `git` that calls `deps.git(args, { cwd: deps.cwd(), env: deps.env })` and `cwd: deps.cwd()`; it passes `computeDerivedDefaults` `env: deps.env` and, when present, `stderr: deps.stderr` and `homeDir: deps.homeDir`.
- The degrade lines and the `--values` warnings are printed by `run` from `degrades` and `invalidRaw`, with today's text and order.
- Update the file's header comment: the usage block stays; add two sentences naming the exports and the entry contract file.

- [ ] **Step 1: Write the tests** in `tests/resolve-policy-entry.test.js`

Local helpers: `repo(policy)` — a temp dir, `git init -q -b main`, optional `.claude-tweaks/policy.yml`, path through `fs.realpathSync`; `ENV = { ...process.env }` with `GH_HOST` and `GH_REPO` deleted; `CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js')`.

Script-entry characterization (these five pass against the unchanged CLI and must still pass after the change; each calls `spawnCli(CLI, args, { cwd, env: ENV })`):

- `AC5.1 script entry: --values autonomy` — `repo('autonomy: trusted\n')`: `{ code: 0, stdout: 'trusted\n', stderr: '' }`.
- `AC5.1 script entry: --all` — `repo()`: code 0, stderr `''`, stdout is one line; `Object.keys(JSON.parse(stdout))` deep-equals `POLICY_KEYS.map((r) => r.key)`; `JSON.parse(stdout).autonomy` has the keys `value`, `source`, `summary`, `category`, `tier`, `type`, `default`.
- `AC5.1 script entry: an invalid value in policy.yml` — `repo('autonomy: bogus\n')`, args `['--values', 'autonomy']`: code 0, stdout `'supervised\n'`, stderr `'resolve-policy: warning: autonomy has invalid value "bogus" — using default "supervised"\n'`.
- `AC5.1 script entry: --run with a path that does not exist` — `missing = path.join(fs.realpathSync(os.tmpdir()), 'ct-no-such-run-dir')`, args `['--run', missing, 'autonomy']`: code 1, stdout `''`, stderr `` `resolve-policy: --run dir does not exist or is not a directory: ${missing}\n` ``.
- `AC5.1 script entry: no arguments` — code 1, stdout `''`, stderr `'resolve-policy: usage: resolve-policy.js [--values | --all] [--mcp-reachable] [--run <dir>] <key> [<key>…]\n'`.

If one of these five fails against the unchanged CLI, the expected value in the test is wrong: run the command by hand, pin what the CLI prints, and say so in the report. Never change the CLI to match.

In-process tests (fail until Step 3):

- `AC4.1: runCliSync and spawnCli agree for --values autonomy and for no arguments` — same `repo('autonomy: trusted\n')`, same `ENV`, same cwd, for `['--values', 'autonomy']` and for `[]`: take `spawned = spawnCli(CLI, args, { cwd, env: ENV })` once, then `assert.deepStrictEqual(await runCli(CLI, args, { cwd, env: ENV }), spawned)` and `assert.deepStrictEqual(runCliSync(CLI, args, { cwd, env: ENV }), spawned)`.
- `AC5.2: runCliSync and spawnCli agree for --all, an invalid value and a missing --run path` — the three remaining AC5 fixtures, each a `deepStrictEqual` of the two helpers' results.
- `AC6.1: requiring the CLI prints nothing and leaves process.exitCode undefined` — `spawnSync(process.execPath, ['-e', 'const m = require(process.argv[1]); process.stdout.write(JSON.stringify({ exitCodeUnset: process.exitCode === undefined, keys: Object.keys(m).sort() }))', CLI], { encoding: 'utf8', windowsHide: true })`: status 0, stderr `''`, stdout `'{"exitCodeUnset":true,"keys":["realDeps","resolvePolicy","run"]}'`.
- `AC7.1: the core returns the entries run prints, and writes nothing to stdout` — `const { resolvePolicy, realDeps } = require(CLI)`; deps `{ cwd: () => cwd, env: ENV, git: realDeps.git, readFile: realDeps.readFile }` (no `stdout`, no `stderr`). Replace `process.stdout.write` with a counter inside `try/finally`; `const out = resolvePolicy({ keys: ['autonomy', 'auto-mode'] }, deps)`; assert the counter is 0, `out.code === 0`, and `out.result` deep-equals `JSON.parse(runCliSync(CLI, ['autonomy', 'auto-mode'], { cwd, env: ENV }).stdout)`.
- `AC7.2: the core refuses a worktree-local runDir with run's message and reads no config.yml` — fixture: a main repo with one commit and a linked worktree (`git worktree add -q <tmp>/wt -b wt`), and `wtRun = path.join(wt, '.claude-tweaks', 'pipelines', 'r')` created with a `config.yml` inside. Deps as in AC7.1 but `cwd: () => wt` and `readFile: (p) => { seen.push(p); return realDeps.readFile(p); }`. `const out = resolvePolicy({ keys: ['autonomy'], runDir: wtRun }, deps)`: assert `out.code === 1`, `typeof out.message === 'string'`, `out.message` matches `/resolves outside the main checkout/`, `seen.filter((p) => p.endsWith('config.yml'))` is `[]`, and `runCliSync(CLI, ['--run', wtRun, 'autonomy'], { cwd: wt, env: ENV })` deep-equals `{ code: 1, stdout: '', stderr: `resolve-policy: ${out.message}\n` }`. Model the fixture on `tests/resolve-policy-run-dir-anchoring.test.js`.
- `AC3.1: an in-process integration-model call runs a gh stub that is only on the injected PATH` (`{ skip: STUB_SKIP }`) — Task 3's `forgePair({ origin: 'https://github.com/o/r.git' })` shape (rebuild it locally) and a marker-writing stub in its own temp dir; `env = { ...ENV, GIT_DIR: gitDir, PATH: stubDir + path.delimiter + process.env.PATH }`. Assert `runCliSync(CLI, ['--values', 'integration-model'], { cwd: a, env })` deep-equals `{ code: 0, stdout: 'pr-first\n', stderr: '' }` and the marker file exists.
- `Review Focus 3: a relative --run value resolves against the injected cwd` — `repo()` with `.claude-tweaks/pipelines/r/config.yml` holding `integration-model: local-merge\n`: `runCliSync(CLI, ['--values', '--run', path.join('.claude-tweaks', 'pipelines', 'r'), 'integration-model'], { cwd, env: ENV })` deep-equals `{ code: 0, stdout: 'local-merge\n', stderr: '' }`.
- `Review Focus 3: a cwd outside any git repository reads that directory's policy.yml` — a temp dir that is not a repo (`fs.mkdtempSync` under `os.tmpdir()`, then assert `spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel']).status !== 0`, else skip the test with that reason) holding `.claude-tweaks/policy.yml` `autonomy: unattended\n`: stdout `'unattended\n'`, and the result deep-equals `spawnCli`'s for the same input.
- `two fixture repos back to back in one process each get their own answer` (`{ skip: STUB_SKIP }`) — repo 1 has a real `origin` (`git remote add origin https://github.com/o/r.git`) and `.claude-tweaks/policy.yml` `autonomy: trusted\n`; repo 2 has no remote and `autonomy: unattended\n`; an exit-0 `gh` stub is only on the injected `PATH`. `runCliSync(CLI, ['--values', 'autonomy', 'integration-model'], { cwd, env })` prints `'trusted\npr-first\n'` for repo 1, `'unattended\nlocal-merge\n'` for repo 2, then `'trusted\npr-first\n'` for repo 1 again, with no `fresh`.
- `a GitHub Enterprise origin reads hosts.yml under the injected HOME, in-process` (`{ skip: STUB_SKIP }`) — the GitHub Enterprise pair from Task 3 (rebuilt locally), a `$GH_HOST`-writing stub on the injected `PATH`, a temp `home` with `.config/gh/hosts.yml` naming `ghe.example.test:`, and `env = { ...ENV, GIT_DIR: gitDir, PATH: …, HOME: home, USERPROFILE: home }` with `GH_CONFIG_DIR` and `XDG_CONFIG_HOME` deleted. `runCliSync(CLI, ['--values', 'integration-model'], { cwd: a, env, fresh: true })` returns code 0, stdout `'pr-first\n'`, a stderr matching `/gh calls get GH_HOST=ghe\.example\.test/`, and the marker holds `ghe.example.test`. (Without the `homeDir` hand-off the leak guard rejects with `called os.homedir() while env.HOME was injected`.)
- Module state rule for this file and Task 5: `repo-resolve.js` memoizes the origin host per cwd and prints its GitHub Enterprise note once per process, so a test whose origin comes from an injected `GIT_DIR`, or that asserts that note, passes `fresh: true`.

Add to `tests/helpers-run-cli.test.js`:

- `fresh: true reloads the modules under plugin/bin` — `require(CLI).__marker = 1`; `runCliSync(CLI, ['--values', 'autonomy'], { cwd: repo, env: { ...process.env }, fresh: true })`; assert `require(CLI).__marker === undefined`; then set the marker again, call without `fresh`, and assert it is still `1`.

- [ ] **Step 2: Run the tests to verify the in-process ones fail**

Run: `node --test tests/resolve-policy-entry.test.js`
Expected: FAIL — every test whose name starts `AC5.1 script entry:` passes; every other test fails (`resolve-policy.js exports no realDeps`, or for AC6.1 a stdout that is not the pinned JSON).

- [ ] **Step 3: Commit the characterization tests on their own, then implement**

Commit `tests/resolve-policy-entry.test.js` now (`Pin resolve-policy.js's script output — five cases before the entry change`), so the five script-entry tests exist at a commit where the CLI is unchanged. Then make the changes listed under Produces and Decisions.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/resolve-policy-entry.test.js tests/helpers-run-cli.test.js tests/resolve-policy-cli.test.js tests/resolve-policy-control-mode.test.js tests/resolve-policy-run-dir-anchoring.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js`
Expected: PASS, 0 failures. Then list the other test files that name the CLI (`git grep -l resolve-policy.js -- tests`) and run each one not already run; all must pass unchanged.

- [ ] **Step 5: Prove the seams, then commit**

In turn, and restoring after each: make `realDeps.git` drop `cwd` (the two-repos test and AC4.1 go red); make it drop `env` (AC3.1 goes red); drop `homeDir` from the `computeDerivedDefaults` call (the GitHub Enterprise in-process test goes red); resolve the `--run` directory check against the raw value (Review Focus 3's first test goes red); drop `cwd` from the `resolvePolicyConfig` call (Review Focus 3's second test goes red); move the anchoring guard back into `run` (AC7.2 goes red). Quote the failing test name per mutation.

```bash
git add plugin/bin/resolve-policy.js tests/resolve-policy-entry.test.js tests/helpers-run-cli.test.js
git commit -F <message file>   # Split resolve-policy.js into a core and a printing run — exports resolvePolicy, run and realDeps behind a require.main guard
```

---

### Task 5: Move the two resolve-policy test files onto the helper

**Role:** integration

**Files:**
- Modify: `tests/resolve-policy-cli.test.js` (the `runCli` helper at line 47 and its callers)
- Modify: `tests/resolve-policy-control-mode.test.js` (`values` line 42, `cliJson` line 47, the direct spawns at lines 87 and 710)

**Interfaces:**
- Consumes: `runCliSync(cliPath, argv, { cwd, env })` and `spawnCli(cliPath, argv, { cwd, env })` from `tests/helpers/run-cli.js`; `tools/count-node-procs.js --files-from <list> --json <out>` (Task 2).
- Produces: nothing other tasks use.

Decisions:

- Each file keeps its own small adapter with the name and return shape its tests already use, so test bodies do not change: the adapter calls `runCliSync(CLI, args, { cwd, env: { ...(env || process.env) } })` and returns `{ status: res.code, stdout: res.stdout, stderr: res.stderr }`. In `tests/resolve-policy-cli.test.js` rename the local `runCli` to `runPolicy` (and its callers) so it cannot be confused with the helper's export.
- Each file keeps exactly one real-process smoke test, through `spawnCli`: in `tests/resolve-policy-cli.test.js` the existing test that covers the no-arguments usage error (assert the exit code 1 and the usage line on stderr); in `tests/resolve-policy-control-mode.test.js` the existing `--all` test at line 87. Name each with the prefix `smoke (real process): `.
- A test that fails in-process only because an earlier call left module state behind gets `fresh: true` on its call; say which tests needed it and what state it was. A test that fails for any other reason is a finding: report it, do not weaken the assertion.
- No assertion text changes. The only edits are the adapters, the two direct spawn sites, the two smoke tests, the `require` lines, and the rename.

- [ ] **Step 1: Record the before numbers**

Write a list file outside the repository (in the OS temp dir) naming `tests/resolve-policy-cli.test.js` and `tests/resolve-policy-control-mode.test.js`, one per line. Run: `node tools/count-node-procs.js --files-from <list> --json <before.json>` and quote the printed table. The two rows' `resolve-policy.js` counts must sum to 87; if they do not, report the numbers and continue.

- [ ] **Step 2: Run the two files to confirm the starting state**

Run: `node --test tests/resolve-policy-cli.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS, 0 failures (this task changes how the tests call the CLI, not what they assert). Record the `# tests` and `# pass` counts.

- [ ] **Step 3: Make the edits listed under Decisions**

- [ ] **Step 4: Run the two files and compare**

Run: `node --test tests/resolve-policy-cli.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS with the same `# tests` count as Step 2 and 0 failures, 0 newly skipped.

- [ ] **Step 5: Record the after numbers (AC8.1), then commit**

Run: `node tools/count-node-procs.js --files-from <list> --json <after.json>`. `AC8.1`: the two rows' `resolve-policy.js` counts must sum to at most 6 (expected 2). Quote both tables in the report.

```bash
git add tests/resolve-policy-cli.test.js tests/resolve-policy-control-mode.test.js
git commit -F <message file>   # Call resolve-policy.js in-process in its two largest test files — 87 spawned processes down to 2
```

Controller step after this task's review (not an implementer step): re-run both measurements centrally with `--json` written to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-13T170335-spec-5374/evidence/count-before.json` (at this task's parent commit, from a detached scratch checkout) and `…/evidence/count-after.json`, log one `AC evidence` decision naming AC8.1 with the command shape and both sums, and put the before/after table in the PR body.

---

### Task 6: The entry-conformance ratchet and the written contract

**Role:** integration

**Files:**
- Create: `tests/bin-lib/cli-entry-conformance.test.js`
- Modify: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`
- Modify: `tests/helpers/strip-comments.js` (header comment: add this suite's stem to the caller list)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15's caller list: add the same stem)

**Interfaces:**
- Consumes: `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES` from `tests/helpers/strip-comments.js`; `readText` from `tests/helpers/read-skill.js`. `tests/bin-lib/exit-code-conformance.test.js` is the sibling scan to model the layout on (its `guardBlankedByStripper` and its go-red tests).
- Produces: `checkEntry(rawText)` → `{ offences: string[] }`, local to the test file, used by the walk and by the self-tests.

Decisions:

- Scope: every `*.js` file directly in `plugin/bin` (a plain `fs.readdirSync(dir, { withFileTypes: true })`, files only, no recursion). Floor: `assert.ok(files.length >= 120, …)` with a message saying a lower count means the walk stopped seeing files.
- `checkEntry` normalises `\r\n` to `\n`, strips comments (literal-keeping mode), and reports:
  1. `exports no run` — unless the stripped text has `module.exports = { … }` whose braces contain `run` as a whole word (shorthand or `run:`), or `module.exports.run =`, or `exports.run =`.
  2. `no require.main === module guard` — unless the stripped text contains `require.main === module`.
  3. `process.exitCode above the guard (line N)` / `process.exit( above the guard (line N)` — for each occurrence of `process.exitCode` or `process.exit(` on a line before the line of the last `require.main === module`. With no guard, every occurrence is reported.
  4. The stripper's verdict: `misparsed` or `unparseable` is an offence with `STRIPPER_VERDICT_MESSAGES[verdict]` as its text; and a file whose raw text contains `require.main === module` while its stripped text does not is an offence (`guard blanked by the stripper`).
- `NOT_YET`: a `const NOT_YET = [` array, one file name per line, sorted, holding exactly the 27 names in the spec's Data / API Surface section (`blast-radius.js` … `wrap-up-state.js`; `resolve-policy.js` is not on it). A comment above it says the list only shrinks, that each sibling record of #5373 deletes its own lines, and that `hooks.js` leaves it through #5377 as a named exemption.
- The walk asserts, per file: listed in `NOT_YET` → `offences` is non-empty (message: `<file> now conforms — delete it from NOT_YET`); not listed → `offences` deep-equals `[]`.
- Also assert every `NOT_YET` entry names a file that exists, the list is sorted, has no duplicates, and `NOT_YET.length === 27`.
- If the walk disagrees with the spec's list at this commit (a file not on the list fails, or a listed file passes), stop and report the file names and offences; do not edit the list or the rules to make it pass.

Contract text, added to `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` as one new bullet directly after the first bullet ("Logic lives in an exported `run(argv, deps)` …"). It must state, in this file's existing voice: the CLI exports `run` and `realDeps`, `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one; the script entry is the file's last statement; the standard io keys, each present only when the CLI uses it — `stdout(text)`, `stderr(text)`, `cwd()`, `env` (a plain object, read-only), `stdin()`, `homeDir()`; above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`; a relative path is resolved against `deps.cwd()`; every child process is started with `cwd: deps.cwd()` and `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment; tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), which fails the test on a leaked `process.exitCode`, working directory, `process.env` key, signal listener, direct stdout/stderr write, or an `os.homedir()` call under an injected home; each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code; `tests/bin-lib/cli-entry-conformance.test.js` pins the three structural rules for every top-level `plugin/bin/*.js` with a `NOT_YET` list that only shrinks; `hooks.js` is the standing exception (its entry calls `process.exit(code)` and it has a require-time prefilter). Name `plugin/bin/resolve-policy.js` (#5374) as the worked example.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/cli-entry-conformance.test.js`

- `AC9.1: every top-level plugin/bin CLI meets the entry rules, except the files listed in NOT_YET` — the walk and the floor above.
- `AC9.4: NOT_YET holds 27 existing files, sorted, without duplicates`.
- `AC9.2: a conforming file listed in NOT_YET fails the walk` — factor the per-file assertion into `assertFile(name, rawText, notYet)`; call it with `resolve-policy.js`'s text and a list that includes `resolve-policy.js`; `assert.throws(…, /now conforms — delete it from NOT_YET/)`.
- `AC9.3: a non-conforming file missing from NOT_YET fails the walk` — `assertFile('verify.js', readText(verify.js path), [])` throws.
- `checkEntry: a conforming text has no offences` — a hand-built text: shebang, `'use strict'`, a `run` function, `module.exports = { run, realDeps };`, and the guard line.
- `checkEntry flags each rule on the exact line` — three hand-built texts, each asserting the exact offence strings: no `run` in exports; no guard; `process.exitCode = 1;` on line 4 above a guard on line 9 (`process.exitCode above the guard (line 4)`), and `process.exit(1)` likewise.
- `checkEntry ignores the tokens in comments, and allows them from the guard line down` — a text whose only `process.exit(` is inside a `//` comment above the guard, plus `process.exitCode = run(…)` on the guard line: no offences.
- `checkEntry reports a stripper mis-parse as an offence` — a planted text the stripper misreads (`if (x) /'/.test(y); const c = 'z';` placed above a real `process.exitCode = 1;` line; confirm with `stripperVerdict` that the verdict is not `ok` — if this planted line reads `ok` in literal-keeping mode, use the planted case from `tests/windows-hide-spawn-conformance.test.js`'s mis-parse self-test instead): `offences` includes `STRIPPER_VERDICT_MESSAGES[verdict]`.
- `Review Focus 5: a CRLF checkout gets the same verdict` — take `resolve-policy.js`'s text through `readText`, build `crlf = text.replace(/\n/g, '\r\n')`, assert `crlf.includes('\r\n')` and `checkEntry(crlf)` deep-equals `checkEntry(text)`; repeat with the hand-built `process.exitCode above the guard (line 4)` text and assert the same line number.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/bin-lib/cli-entry-conformance.test.js`
Expected: FAIL (the file does not exist yet: `Could not find` / no tests run with a non-zero exit).

- [ ] **Step 3: Write the test file's `checkEntry`, `assertFile`, `NOT_YET` and walk; add the contract bullet; add the stem to the two caller lists**

The stem is the test file's name as `tests/strip-comments-callers-twin.test.js` derives it; run that test to learn the exact spelling it expects.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/cli-entry-conformance.test.js tests/strip-comments-callers-twin.test.js tests/raw-markdown-read-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove the rules discriminate, then commit**

Delete each of the three structural rules from `checkEntry` in turn and confirm the matching `checkEntry flags each rule` assertion goes red; restore. Quote the failing test name per rule.

```bash
git add tests/bin-lib/cli-entry-conformance.test.js .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
git commit -F <message file>   # Pin the CLI entry contract — conformance ratchet with a NOT_YET list of 27, and the contract text
```

---

## Spec coverage map

| Criterion | Where it is verified |
|---|---|
| AC8.1 | Task 5 Step 5: `tools/count-node-procs.js` on the two converted files; the `resolve-policy.js` counts sum to at most 6, and Step 4 shows the same test count passing as Step 2 |

## Acceptance criteria not covered by a plan test step

Waived AC11.1: the full `npm test` suite and the Windows CI job are run centrally by the pipeline's final verification and a `windows-regression.yml` dispatch on the branch after the last code change, not by a task.

Spec-named paths this build reads and does not change:

Waived tools/run-tests.js: read by Task 2 Step 3, which spawns it; its CLI is unchanged.
Waived tools/test-impact/node-options.js: read by Task 2 Step 3, which imports `requireOption` from it.
Waived tools/test-impact/tracer.js: read by Task 2 Step 3 as the model for a preload that never throws.
Waived tests/bin-lib/exit-code-conformance.test.js: read by Task 6 Step 3 as the sibling scan, and run in Task 4 Step 4 and Task 6 Step 4.
Waived lib/wrap-up/facts.js: a shipped caller that spawns the script entry, which Task 4 leaves unchanged; Task 4 Step 4 runs every test file that names the CLI.
Waived lib/phase-exit/phase-exit.js: same as lib/wrap-up/facts.js, checked by Task 4 Step 4.
Waived lib/dispatch/queue-pull.js: same as lib/wrap-up/facts.js, checked by Task 4 Step 4.
Waived plugin/bin/lib/reconcile/index.js: a caller of `detectIntegrationModel` that passes no `env`; Task 3 Step 4 runs the existing suites that cover the unchanged default.
Waived plugin/bin/lib/hooks/pre-tool-use.js: same as plugin/bin/lib/reconcile/index.js, checked by Task 3 Step 4.
