# hooks.js Injectable Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `plugin/bin/hooks.js` a `run(argv, deps)` entry and `realDeps`, thread injected io through the dispatcher and every `VERBS` handler, and move four test files onto `tests/helpers/run-cli.js` so they start at most 20 `hooks.js` processes instead of 267.

**Architecture:** Today's `main(argv)` body becomes `run(argv, deps)` with `argv = process.argv.slice(2)`; `main` stays as `(argv) => run(argv.slice(2), realDeps)` and the script entry (`main(process.argv).then(process.exit).catch(() => process.exit(0))`) is unchanged. Every verb handler takes `(argv, deps)` and reaches stdout, stderr, the working directory and the environment only through `deps`. The four test files then call `runCli`, keeping a counted set of `spawnCli`/`spawnSync` tests for real-process behavior.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `tests/helpers/run-cli.js` (#5374), `tools/count-node-procs.js` (#5374).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T123842-spec-5375/work/5375-spec.md` (record #5375)

## Global Constraints

- Ceiling: the four converted files together start **at most 20** `hooks.js` processes (baseline measured 2026-11-15 on this branch at `6a43cd434`, `CT_TEST_CONCURRENCY=6`: archive-run-verb 56, hooks-help-guard 66, hooks-js-flag-strict 52, hooks-ledger-row 93 = **267**; evidence `{run-dir}/evidence/baseline-procs.txt`). Every `spawnCli`/`spawnSync` of `hooks.js` that stays counts toward the 20, and the 20 is binding.
- No verb's output text, exit code or flag handling changes. Byte-for-byte.
- The require-time prefilter (`EARLY`, top of `hooks.js`) and the script entry line stay exactly as they are; `run` does not catch on the event path, and the VERBS try/catch (exit 1, #4932) stays where `main` has it today.
- `hooks.js` stays on `NOT_YET` in `tests/bin-lib/cli-entry-conformance.test.js`; no other CLI is converted.
- Event modules under `plugin/bin/lib/hooks/` are untouched (#5377). In-process event calls are not supported by this record.
- `plugin/bin/lib` edits are in scope only where a converted test shows a global read on a path this record exercises; each such file is named in the PR body.
- Tests run one `runCli` at a time per file (no `Promise.all`, no concurrent subtests). The `env` given to `runCli` is complete: build it from the file's existing env helper (`hookEnv()` / `{ ...process.env, PIPELINE_RUN_DIR: '', ... }`), never `{}`.
- A test left on a real process carries a one-line comment naming the process property it proves (closed stderr, cross-process lock, script entry/exit code, a child started with an env the CLI cannot thread).
- Never invoke a real verb against this checkout. Mutation/revert proofs run in a `git archive` extract in the session scratchpad (`git init` + one snapshot commit), never in a linked worktree.
- Quoted from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (governs every `plugin/bin` CLI meeting the entry contract), verbatim: "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped." / "Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call: two repos, A with no remote and B with an `origin` and a recorded `origin/HEAD`, the CLI's `cwd` in A and `GIT_DIR=<B>/.git` only in the injected `env`, so a child that inherits the real environment reads A and a child that got `env: deps.env` reads B's remote" / "Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls" / "Find the ambient reads on a CLI's path by running each documented invocation through `runCliSync` and through `spawnCli` against the same fixture, with an injected `cwd`, `env` and `HOME` that differ from the real ones, and comparing the two results, not by reading the code". Also its process-wide timeout carve-out: "`plugin/bin/lib/hooks/git-exec.js`'s `runGit` reads `CT_HOOKS_GIT_TIMEOUT_MS` from the real `process.env`, by design; an in-process test cannot set them through `env`, so a test of those knobs is a `spawnCli` test."
- Quoted from `.claude/skills/hooks-js-verb-registration/SKILL.md` (governs `VERBS`/`KNOWN_FLAGS`/handlers), verbatim: "A guard regression must never reach a mutating handler against the developer's checkout (#4834)." Its row 3 and decision 5 describe the handler signature and `main()`; Task 1 updates them.
- Quoted from `.claude/skills/git-ground-truth-test-env/SKILL.md` (governs tests of code whose `env` defaults to `process.env`, and `repoInfo`), verbatim: "**A reader call in a test passes an explicit env.** Build it from `process.env` minus the variables the reader keys on." / "**Prove both under the runner.** Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`: the runner's env is part of the test's input." / "**Prove a fallback test with a mutation.** Remove the check its trigger depends on and see the test go red under the runner." Each task's run step therefore runs its file both ways: `node --test {file}` and `node tools/run-tests.js --files-from {list-with-that-file}`.
- `.claude/skills/suite-slot-test-env` does not apply: no converted test spawns `verify.js` or `tools/run-tests.js`.
- `repoInfo` cache (#5294): its memo key is `uid + dir + envFingerprint` with a per-entry signature check, so two in-process calls with different `cwd` values never share an answer (confirmed by source read, `decisions.md` 13:45:48). `worktree-detect.js` passes `process.env`, not an injected env, and `storePath()` falls back to `os.homedir()`: an in-process test that injects a different `HOME` must also carry `CT_HOOKS_REPO_INFO_STORE` (absolute) in its `env`, or the helper's homedir guard fires.

## Review Focus

1. A verb that prints and returns without awaiting, run in-process: the three flush-before-exit sites (`runResolveLedger`'s, `runLedgerRow`'s and `runCheckPassReentry`'s `await new Promise(... process.stdout.write(text, resolve))`, lines ~1235/1369/1739) must `await deps.stdout(text)`, and `realDeps.stdout` must resolve only after the write callback — a piped `ledger-row` reader expects its JSON line before exit. Task 1's spawned suites cover this; the reviewer checks the three sites by name.
2. A closed or unwritable stderr on a refusal: exit stays 1, never 0 (#4834). Task 3 adds the real-process read-only-fd-2 test.
3. A handler exception: still exit 1 with `claude-tweaks: {verb}: {message}` on stderr, and a hook event exception still exit 0 through the entry catch (`tests/hooks-verb-exception-exit.test.js`, run unchanged in Task 1).
4. A test env that carries `GIT_DIR`/`GIT_WORK_TREE` from the runner (a git hook running the suite): git children on the converted paths must read the injected env, not the runner's — each converted file's env-only test (Tasks 4–5) pins it.
5. An in-process `reconcile` or `reconcile-background` call: it would start real `gh`/`git` children and a detached `hooks.js reconcile-background` with the runner's environment (neither `reconcile()` nor `spawnBackgroundIfStale` takes an `env`). Task 3 keeps every test whose subject runs reconcile for real on a real process unless an `env` option is threaded and proven.

---

### Task 1: `run(argv, deps)` and `realDeps`; deps threaded through the dispatcher and every verb handler

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` (dispatcher `main` lines ~2100–2238; every `run{Verb}` handler lines ~683–2097; `pluginRoot()` line ~106; comments at lines ~24, ~26, ~111–113, ~164–166, ~217, ~250 that say `main()` or `run(argv)`; `module.exports`)
- Modify: `docs/hooks.md` (new `## In-process entry (#5375)` section after `## repoInfo cache (#5294)`)
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md` (row 3 at line 18; decision 3 at line 31; decision 5 at line 33)
- Test: `tests/hooks-help-guard.test.js` (one new test; the rest of the file converts in Task 2)
- Test: `tests/hooks-verb-exception-exit.test.js` (run unchanged in Step 6: both entry catches)
- Test: `tests/bin-lib/exit-code-conformance.test.js` (run unchanged in Step 6: reads the last `require.main` guard)

**Interfaces:**
- Produces: `async function run(argv: string[], deps: Deps): Promise<number>` — `argv` is `process.argv.slice(2)`, verb at `argv[0]`.
- Produces: `realDeps: Deps` with exactly these keys:
  - `stdout(text): Promise<void>` — `new Promise((resolve) => { process.stdout.write(text, () => resolve()); })`; awaited only at the three flush sites, called without `await` everywhere else (today's timing).
  - `stderr(text): void` — `try { fs.writeSync(2, text); } catch { /* unusable stderr: the exit code carries the refusal */ }`, calling `fs.writeSync` through the `fs` module object at call time (the in-process #4834 test patches `fs.writeSync`).
  - `stdoutSync(text): void` — `fs.writeSync(1, text)`, used only by the event tail's JSON; it may throw, which reaches the entry catch (exit 0) exactly as today.
  - `cwd(): string` — `process.cwd()`; `env` — `process.env`; `stdin(): string` — `EARLY ? EARLY.raw : ctxLib.readStdin()`.
- Produces: every handler `async function run{Verb}(argv, deps)` where `argv` is `run`'s argv (verb at `[0]`): each `argv.slice(3)` becomes `argv.slice(1)`; `argv.includes(...)` scans stay. `VERBS` entries keep `{ usage, run }`.
- Produces: `main(argv) => run(argv.slice(2), realDeps)`; `module.exports = { main, run, realDeps, BACKGROUND_CHECKS, CLI_DEFERRED_CHECKS, KNOWN_FLAGS, USAGE, VALUE_FLAGS, VERBS }`.
- Produces: `pluginRoot(env)` reads `env.CLAUDE_PLUGIN_ROOT`.

- [ ] **Step 1: Write the failing test** in `tests/hooks-help-guard.test.js` (require `runCli` from `./helpers/run-cli`; `HOOKS` is already absolute):

```js
test('AC2.1 AC4.1: runCli(hooks, [verb, "--help"]) resolves to the usage line for every VERBS verb', async () => {
  for (const verb of Object.keys(VERBS)) {
    const r = await runCli(HOOKS, [verb, '--help'], {
      cwd: HOOK_SANDBOX,
      env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' },
    });
    assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: usage: ${VERBS[verb].usage}\n`, stderr: '' }, verb);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test tests/hooks-help-guard.test.js`
Expected: FAIL with `runCli: hooks.js exports no run`

- [ ] **Step 3: Implement `run`, `realDeps`, and the deps thread-through in `plugin/bin/hooks.js`**

Move `main`'s body into `run` (`cmd = argv[0]`, `argsAfterCmd = argv.slice(1)`, `return await verb.run(argv, deps)` — keep the `await` and its comment). In `run` and every handler replace: `process.stdout.write(x)` → `deps.stdout(x)` (the three `await new Promise(...)` flush sites → `await deps.stdout(x)`); `process.stderr.write(x)` and each `try { fs.writeSync(2, x) } catch {}` → `deps.stderr(x)` (same bytes, one call per former write); `process.cwd()` → `deps.cwd()`; `process.env` → `deps.env` (including `resolveRunArg(args, deps.cwd(), deps.env, …)`, `ctxLib.resolveRunDir(cwd, deps.env)`, `ctxLib.resolveRun(cwd, deps.env, …)`, `pluginRoot(deps.env)`, session-id reads). Event tail: `ctxLib.parseInput(deps.stdin())`, attribution diagnostic → `deps.stderr`, JSON → `deps.stdoutSync`. A child process `hooks.js` itself starts (`execFile` in `runResolveConsole`, the reconcile handlers) gets `{ cwd: deps.cwd(), env: deps.env }` where the call takes options; a lib call with no `env` option is left as is here (Tasks 3–5 decide it). Then update the comments listed in Files to say `run()` / `run(argv, deps)`.

- [ ] **Step 4: Write `docs/hooks.md`'s `## In-process entry (#5375)` section** — state: `run(argv, deps)` with `argv = process.argv.slice(2)`; `main` delegates; the `realDeps` keys above and why each exists (Promise-returning `stdout` awaited at the flush sites — the shape #5376 and #5377 reuse; non-throwing `stderr` for #4834; `stdoutSync` for the event tail so a failed write still reaches the entry catch); the script entry and the prefilter are unchanged; event modules still read process globals until #5377.

- [ ] **Step 5: Update `.claude/skills/hooks-js-verb-registration/SKILL.md`** — row 3: handler is `async function run{Verb}(argv, deps)`, `argv` is `run`'s argv (verb at `[0]`, flags from `argv.slice(1)`), output and cwd/env only through `deps`; decision 3: "`run()` catches whatever a handler throws…"; decision 5: an in-process test calls `run` through `runCli` with an injected `cwd`/`env` (patching `fs` still needs `main()` with the runner's cwd and a read-only verb).

- [ ] **Step 6: Run the new test and every spawned suite that pins today's behavior**

Run: `node --test tests/hooks-*.test.js tests/archive-run-verb.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/hooks/*.test.js`
Expected: PASS, 0 failures — the spawned files prove no output, exit-code or flag change; `tests/hooks-verb-exception-exit.test.js` proves both catches; `cli-entry-conformance` passes unchanged with `hooks.js` still on `NOT_YET` (AC8.1, AC8.2).

- [ ] **Step 7: Confirm no process global is left in a handler**

Run: `grep -n -E 'process\.(stdout|stderr)\.write|process\.cwd\(\)' plugin/bin/hooks.js`
Expected: no line between the `VERBS` table and the `require.main` guard except inside `realDeps`. Control: the same grep at `6a43cd434` (`git show 6a43cd434:plugin/bin/hooks.js | grep -c -E 'process\.(stdout|stderr)\.write|process\.cwd\(\)'`) prints `180` (run 2026-11-15 at plan time).

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/hooks.js docs/hooks.md .claude/skills/hooks-js-verb-registration/SKILL.md tests/hooks-help-guard.test.js
git commit -m "Give hooks.js run(argv, deps) and realDeps — thread io through the dispatcher and every verb (#5375)"
```

---

### Task 2: Convert `tests/hooks-help-guard.test.js`

**Role:** integration

**Files:**
- Modify: `tests/hooks-help-guard.test.js`

**Interfaces:**
- Consumes: Task 1's `run`/`realDeps`; `runCli`, `spawnCli` from `tests/helpers/run-cli.js`.

- [ ] **Step 1: Convert the file's local `runHook(args, { input, cwd, env })` to `runCli`** keeping its `{ code, stdout, stderr }` return and its env (`{ ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', ...env }`) as the complete `env`; `input` goes to `stdin`. Replace the spawned `--help`/`-h` loops with Task 1's table-driven test plus an `-h` twin. Tests that run a hook event (`--help` on a non-USAGE command) stay on `spawnCli` with a comment ("an event reads process globals until #5377").

- [ ] **Step 2: Write the real-process smoke tests (AC5.1, AC7.1)**

```js
// script entry: the shebang file, exit code and bytes of a real process
test('AC5.1: node hooks.js ledger-row --help prints the usage line and exits 0', () => {
  const r = spawnCli(HOOKS, ['ledger-row', '--help'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.deepStrictEqual(r, { code: 0, stdout: `claude-tweaks: usage: ${VERBS['ledger-row'].usage}\n`, stderr: '' });
});
// script entry: an unknown verb's exit 1 through process.exit
test('AC5.1: node hooks.js no-such-verb exits 1 with the unrecognized line and the usage text', () => {
  const r = spawnCli(HOOKS, ['no-such-verb'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: unrecognized hooks\.js subcommand 'no-such-verb'/);
});
// hook event: the event path still exits 0 through the entry catch
test('AC7.1: echo {} | node hooks.js session-end exits 0 with empty stdout', () => {
  const r = spawnCli(HOOKS, ['session-end'], { cwd: HOOK_SANDBOX, stdin: '{}', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' } });
  assert.deepStrictEqual({ code: r.code, stdout: r.stdout }, { code: 0, stdout: '' });
});
```

(Probed 2026-11-15 against the unconverted file: `session-end` with stdin `{}` in a sandbox printed `status 0 stdout "" stderr ""`.)

- [ ] **Step 3: Write the injected-env test**

```js
test('AC10.1: log-decision names the injected CLAUDE_PLUGIN_ROOT, not the runner\'s', async () => {
  const r = await runCli(HOOKS, ['log-decision'], { cwd: HOOK_SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '', CLAUDE_PLUGIN_ROOT: '/ct-injected-plugin-root' } });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /node "\/ct-injected-plugin-root\/bin\/log-decision\.js"/);
});
```

- [ ] **Step 4: Run**

Run: `node --test tests/hooks-help-guard.test.js`
Expected: PASS, same test titles as before plus the new ones.

- [ ] **Step 5: Commit** — `git add tests/hooks-help-guard.test.js` and `git commit -m "Run hooks-help-guard in-process through runCli (#5375)"`

---

### Task 3: Convert `tests/hooks-js-flag-strict.test.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/hooks-js-flag-strict.test.js`
- Modify (only if a converted test shows a global read, each named in the PR body): `plugin/bin/lib/**`

**Interfaces:**
- Consumes: Task 1's `run`/`realDeps`/`main`; `runCli`, `spawnCli`.

- [ ] **Step 1: Convert `runHook(args, { cwd, env })` to `runCli`** with the complete env `{ ...process.env, PIPELINE_RUN_DIR: '', ...OFFLINE_GH, ...env }` (delete `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` from it). A test whose subject runs `reconcile` or `reconcile-background` for real (the `--json` positive control, `reconcile-background ... writes its status file`, and any other that reaches `reconcileLib.reconcile` or `spawnBackgroundIfStale`) stays on `spawnCli` with the comment "reconcile starts gh/git children and a detached reconcile-background with the inherited env; reconcile() takes no env option" — unless the implementer threads an `env` option through that path with an env-only test, in which case convert it. Refusal tests that stop at the unknown-flag guard convert (they never reach a handler).

- [ ] **Step 2: Write the real-process unusable-stderr test, keeping the in-process `#4834` test**

```js
// closed stderr: a real fd 2 that refuses writes
test('AC6.1: an unusable stderr still refuses with exit 1 in a real process', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ro-')), 'ro');
  fs.writeFileSync(f, '');
  const fd = fs.openSync(f, 'r');
  try {
    const r = spawnSync(process.execPath, [HOOKS, 'resolve-run-dir', '--bogus'], { cwd: HOOK_SANDBOX, stdio: ['ignore', 'pipe', fd], encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
  } finally { fs.closeSync(fd); }
});
```

(Probed 2026-11-15 against the unconverted file: `status 1 stdout ""`. An unguarded fd-2 write would reject into the entry catch and exit 0.)

- [ ] **Step 3: Write the dispatcher-family smoke test and the injected-cwd test**

```js
// script entry: success exit code and stdout of a real process
test('AC9.1: node hooks.js resolve-run-dir --root-only prints the repo root and exits 0', () => {
  const root = freshRepo();
  const r = spawnCli(HOOKS, ['resolve-run-dir', '--root-only'], { cwd: root, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), fs.realpathSync(root));
});
test('AC10.1: resolve-run-dir --root-only resolves the injected cwd, not the runner\'s', async () => {
  const root = freshRepo();
  const r = await runCli(HOOKS, ['resolve-run-dir', '--root-only'], { cwd: root, env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), fs.realpathSync(root));
});
```

The refusal half of AC9.1 is the existing `#4834: a captured resolve-run-dir --root-only with a typo yields an empty value and exit 1`, kept on `spawnCli`. If `--root-only` prints a path other than the realpath'd root (check the first green run), assert the value the spawned call printed before Task 1 — `git stash`-free: run the test body against `6a43cd434` in the scratch extract.

- [ ] **Step 4: Run** — `node --test tests/hooks-js-flag-strict.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add tests/hooks-js-flag-strict.test.js {any lib file}` and `git commit -m "Run hooks-js-flag-strict in-process through runCli (#5375)"`

---

### Task 4: Convert `tests/hooks-ledger-row.test.js` (`ledger-row`, `record-worktree`)

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/hooks-ledger-row.test.js`
- Modify (only where a converted test shows a global read, each named in the PR body): e.g. `plugin/bin/lib/file-lock.js` (`resolveLockWaitMs` reads `process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS`), the `origin` URL reader behind the `/pull/N` check, `plugin/bin/lib/hooks/worktree-detect.js` (`repoInfo` passes `process.env`)

**Interfaces:**
- Consumes: Task 1's `run`/`realDeps`; `runCli`, `spawnCli`.
- Produces (when threaded): each lib function takes `env` as an option defaulting to `process.env` (e.g. `acquireLock(lockPath, { env = process.env } = {})`).

- [ ] **Step 1: Convert `runHook(args, { cwd, env })` to `runCli`** with `env: hookEnv(env)` (complete; delete the four `GIT_*` discovery vars) and the injected `cwd`; `stampedRun` converts too. `AC3.1: two concurrent appends from two child processes take distinct row numbers` stays on two real processes with the comment "a lock held across processes". `AC1.1 lock: a held ledger lock refuses and writes nothing` must honor its injected `CLAUDE_TWEAKS_LOCK_WAIT_MS: '30'`: thread `env` into the lock wait, or keep that test on `spawnCli` with the reason.

- [ ] **Step 2: Write the env-only git child test** (per the Global Constraints quote): two repos, A (no remote, the `cwd`) and B (`origin` = `https://github.com/ct-env-only/fixture.git`, recorded `origin/HEAD`), `GIT_DIR=<B>/.git` only in the injected env. `test('AC10.1: ledger-row --status fixed accepts B\'s /pull/N URL only when the git child reads the injected env', …)` — `--resolution https://github.com/ct-env-only/fixture/pull/7` exits 0 in-process. If the origin read cannot take `env` without a wider change, keep `answer 6` on `spawnCli` and list it.

- [ ] **Step 3: Write the two family smoke tests** — `AC3.1 AC9.1: ledger-row append through runCli and spawnCli returns the same code and stdout` (twin fixtures from `fixture()`, `assert.deepStrictEqual` on `{ code, stdout }` with the ledger path normalized) and the refusal `AC9.1: node hooks.js ledger-row --status resolved exits 1 naming the enum` (spawned); same pair for `record-worktree` (success: `claude-tweaks: worktree recorded for {id}`; refusal: no `--run` → `claude-tweaks: record-worktree requires --run — worktree not recorded`).

- [ ] **Step 4: Run** — `node --test tests/hooks-ledger-row.test.js` → PASS, every prior test title still present.

- [ ] **Step 5: Commit** — `git add tests/hooks-ledger-row.test.js {lib files}` and `git commit -m "Run hooks-ledger-row in-process through runCli (#5375)"`

---

### Task 5: Convert `tests/archive-run-verb.test.js` (`archive-run`, `close-run`)

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/archive-run-verb.test.js`
- Modify (only where a converted test shows a global read, each named in the PR body): the archive path's git callers under `plugin/bin/lib/`

**Interfaces:**
- Consumes: Task 1's `run`/`realDeps`; `runCli`, `spawnCli`.

- [ ] **Step 1: Convert `runHook(args, { cwd, env })` (today `execFileSync`, `{ code: 0, stdout }` on success, `{ code, stdout, stderr }` on failure) to `runCli`**, mapping onto the same fields so test bodies do not change; env `{ ...process.env, PIPELINE_RUN_DIR: '', ...env }` with the four `GIT_*` vars deleted. The `console-residue.js` `execFileSync` stays (not `hooks.js`).

- [ ] **Step 2: Write the env-only git child test** — the `#3721` push-state tests read the branch through git: `test('AC10.1: archive-run reports the injected-env repo\'s branch, not the cwd repo\'s', …)` with the A/B fixture (B on branch `ct-env-only`, `GIT_DIR=<B>/.git` only in env); or, if the archive path's git calls cannot take `env` without a wider change, keep the `#3721` tests on `spawnCli` with the reason and pin AC10.1 with an injected-`cwd` test instead (run fixture in a temp repo, `cwd` = that repo, assert the `committed` line names its branch).

- [ ] **Step 3: Write the family smoke tests** — archive-run: `AC3.1 AC9.1: archive-run on a clean fixture through runCli and spawnCli prints the same moved: lines and exit 0` (twin fixtures) plus the spawned refusal `AC9.1: node hooks.js archive-run on an active run exits non-zero naming close-run`. close-run has no fixture in the four files today: add `AC3.1 AC9.1: close-run on a recorded run through runCli and spawnCli returns the same code and stdout` (twin fixtures stamped by `record-worktree`) and a spawned refusal (an unusable `--run`).

- [ ] **Step 4: Run** — `node --test tests/archive-run-verb.test.js` → PASS.

- [ ] **Step 5: Commit** — `git add tests/archive-run-verb.test.js {lib files}` and `git commit -m "Run archive-run-verb in-process through runCli (#5375)"`

---

### Task 6: Measure, prove the thread-throughs, record the evidence

**Role:** integration

**Files:**
- Waived `tests/bin-lib/cli-entry-conformance.test.js`: no change in this record; Task 1 Step 6 runs it.

- [ ] **Step 1: Verify the process ceiling (AC1.1)** (same hour as the baseline when possible; otherwise re-measure the baseline at `6a43cd434` in the scratch extract back to back)

Run: `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from {scratchpad}/converted-files.txt --json {run-dir}/evidence/after-procs.json > {run-dir}/evidence/after-procs.txt 2>&1`
Expected: all tests pass; `hooks.js` processes summed over the four files ≤ 20 (AC1.1); every test title present at baseline still present.

- [ ] **Step 2: Ambient-read audit (scratch, uncommitted)** — for each converted verb (`record-worktree`, `ledger-row`, `archive-run`, `close-run`, `resolve-run-dir`), run one documented invocation through `runCli` and `spawnCli` against the same fixture with an injected `cwd`, `env` and `HOME` (plus `CT_HOOKS_REPO_INFO_STORE`) that differ from the real ones, and compare; full output to `{run-dir}/evidence/ambient-read-audit.txt`.

- [ ] **Step 3: Revert proofs (AC10.1)** — in a `git archive HEAD` extract (git init + snapshot commit), revert each thread-through an AC10.1 test covers (`pluginRoot(deps.env)`, the `deps.cwd()` in `resolve-run-dir`, each lib `env` option) one at a time, run that test file, see it red, restore. Output to `{run-dir}/evidence/revert-proofs.txt`.

- [ ] **Step 4: Log the evidence** — one `log-decision.js --status AUTO --step "AC evidence" --text-file {file}` entry per item: AC1.1 (before/after totals), AC4.1 (four files green under `runCli`, whose leak guard rejects on any leak), AC10.1 (each revert proof red→green), each citing its evidence path.

- [ ] **Step 5: Write and verify the PR body table (AC11.1)** — add to the PR description: the before/after table from `count-node-procs` (file, `hooks.js` before, after, wall-ms before/after; `CT_TEST_CONCURRENCY=6`, same machine, timestamps), the measured baseline (267), every test left on a real process with its reason, and every `plugin/bin/lib` file changed to pass an injected value.

- [ ] **Step 6: Verification — full suite and Windows (AC12.1)** — owned by `/claude-tweaks:build` Common Step 5 (`verify.js` full run) and the review phase's Windows CI dispatch (AC12.1); this task only records that they are pending.
