# Last Six CLIs Injectable Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `claude-tweaks-statusline.js`, `compose-subject.js`, `install-statusline-wrapper.js`, `reachability-audit.js`, `release-notes-publish.js` and `sweep-stray-run-dirs.js` the `run(argv, deps)` + `realDeps` entry contract, move their tests in-process, and drop them from `NOT_YET`.

**Architecture:** One CLI per task. Each task first pins the unconverted script's output with `spawnCli` smoke tests (committed before the split), then adds in-process `runCli` tests that fail, then converts the CLI so they pass and removes its `NOT_YET` line. Ambient reads (`process.cwd()`, `process.env`, `os.homedir()`, `Date.now()`, stdin/stdout) move to `deps`; library functions on the path take the value as an option defaulting to today's ambient value, so existing callers keep working.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `tests/helpers/run-cli.js` (`runCli`, `runCliSync`, `spawnCli`), `tools/count-node-procs.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T124917-spec-5386/work/5386-spec.md`

## Global Constraints

- No change to any CLI's stdout, stderr or exit code for any input (spec Non-Goals: "Any change to output or exit codes.").
- Out of scope: "The status line's rendering, caching or git calls (#5266 and its pull request #5298 own those)."
- Status line: "add no `require` to its start-up path, and keep `realDeps` a plain object literal." The script entry "must stay the last statement of the file" (`plugin/bin/lib/statusline-wrapper-source.js` starts it as a script, and requires it and calls `mod.main()` with no arguments — `main` stays exported and keeps working with zero arguments).
- The status line takes its working directory from the stdin payload, as today; `deps.cwd()` is used only where the payload carries no directory. State this choice in a comment beside the line that picks it.
- Entry contract, verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. The standard io keys, each present only when the CLI uses it, are `stdout(text)`, `stderr(text)`, `cwd()`, `env` (a plain object, read-only), `stdin()` (the whole input as a string) and `homeDir()`. Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs`: a file path the unconverted CLI handed to `fs` as written takes an unnormalized join (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`), so a trailing slash or a `..` after a symlink still reaches the kernel; `path.resolve(deps.cwd(), p)` only where the CLI already normalized or needs one absolute, normalized value, such as a root passed to `git -C` (#5380). Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`, and a library function on the CLI's path takes that `env` as an option whose default is the inherited environment, so a `gh` or `git` stub on an injected `PATH` is not skipped."
- Async entry form: `if (require.main === module) run(process.argv.slice(2), realDeps).then((code) => { process.exitCode = code; });`. `module.exports` moves above the guard.
- Same file, verbatim: "A converted CLI that prints an `fs` error's `err.message` for a relative path argument maps the resolved path back to the argument's spelling. … Swap it back before printing, `err.message.split(resolved).join(asTyped)`."
- Same file, verbatim: "Converting an existing CLI to the entry contract takes two proofs the tests-side journey does not cover. … (1) Pin the script's output with real-process tests committed before the split, so the split is checked against the old behavior and not against itself … (2) Prove that each `git` or `gh` child on the CLI's path got the injected `env` with an env-only fixture, not by reading the call … Strip `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_COMMON_DIR` from the fixture's own setup `git` calls … Delete the same four from the env a converted test hands the CLI whenever it merges `process.env` and its assertion depends on which repository git finds."
- Same file, verbatim: "The helper fails closed: after merging `realDeps` with the test's fakes, it replaces a key named in `FAIL_CLOSED_KEYS` (`runner`, `gh`, `ghAvailable`, `runHook`, `spawn`) that still holds the CLI's real value with a function that throws … a record converting a CLI whose `realDeps` holds such a seam under another name … adds that name to `FAIL_CLOSED_KEYS` in the same change. A git-only seam (`git`, `gitRunner`) is deliberately not on the list."
- `release-notes-publish.js` calls `gh release` through a runner: "Its tests fake the runner; never run it against the real repository." Its smoke tests use only `--help` and a bad argument.
- Home isolation passes the temp directory as both `HOME` and `USERPROFILE` (or goes through `deps.homeDir()` in-process). `.claude/skills/windows-checkout-test-parity/SKILL.md`: "Pointing a spawned child at a fixture home with `HOME` alone … `os.homedir()` reads `USERPROFILE` on win32."
- `.claude/skills/git-ground-truth-test-env/SKILL.md`, verbatim: "A reader call in a test passes an explicit env. Build it from `process.env` minus the variables the reader keys on. `READER_ENV` in `tests/statusline.test.js` drops every `GIT_CONFIG*` name" — keep `READER_ENV`/`DIFFERENT_OWNER_ENV` as they are when converting `runStatusline`.
- Source-scan suites over `plugin/bin`: no bare `fs.existsSync`/`fs.realpathSync` in new code (`tests/path-guard-conformance.test.js` — route through `plugin/bin/lib/path-guard`); every `execFileSync`/`spawn` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); git status calls keep `--no-optional-locks`; the status line passes no `shell` option and calls no `exec`/`execSync` (`tests/statusline-no-shell-conformance.test.js`); `tests/bin-lib/exit-code-conformance.test.js` reads each file's last `require.main` guard.
- `runCli` calls run one at a time (no `Promise.all`, no concurrent subtests). The `env` passed to `runCli` is the complete environment: pass `PATH`, `HOME`, `USERPROFILE`, `TMPDIR` (and `SystemRoot` on Windows) where the CLI or its children need them; give `runCli` and `spawnCli` the identical explicit `env` when comparing them. A converted file's local helper maps the helper's `code` onto the field name its assertions already use.
- Each test left on a real process carries a one-line comment naming the process property it proves.
- `NOT_YET_CEILING` in `tests/bin-lib/cli-entry-conformance.test.js` is not edited ("the sibling records of #5373 delete their own lines without ever editing this constant"). Each task deletes only its own CLI's `NOT_YET` line, in the same commit as the conversion (the walk fails a conforming file still listed).
- Waived `tests/gh-host-seam-behavior.test.js`: read only — Task 6 Step 4 runs it unchanged; its 9 real-process `compose-subject.js` tests are deliberate (spec Deliverables) and stay.
- Waived `tools/count-node-procs.js`: run only, in Task 1 Step 0 and the Post-task evidence section.
- Waived `plugin/bin/lib/statusline-wrapper-source.js`: read only — Task 1 Step 3's `main() with no arguments` test reads it to confirm it still calls `.main()` and starts the status line as a script.
- Waived `tests/bin-lib/exit-code-conformance.test.js`: read only — every task's guard must pass it unchanged; Common Step 5's full suite runs it.
- Waived `tests/helpers/run-cli.js`: read only; no task adds a `FAIL_CLOSED_KEYS` name unless a `realDeps` seam that starts `gh` or an arbitrary command is named outside the list (Task 6 Step 3 checks).

## Review Focus

- The generated wrapper calls `mod.main()` with zero arguments on every render: `main()` must still read the real stdin and write the real stdout and resolve (Task 1, test `main() with no arguments still renders through realDeps`).
- A payload carrying `workspace.current_dir` must keep winning over an injected `cwd` (Task 1, test `AC8.1: payload directory wins over deps.cwd()`).
- A relative path flag (`--skill`, `--mcp-server`, `--root`, `--log`) resolves against the injected `cwd`, and an unreadable one prints the path as typed (Tasks 3, 4, 5).
- The status line `run` never rejects: an internal throw prints nothing and returns 0, as `main().catch(() => process.stdout.write(''))` did (Task 1, test `run swallows a render throw and returns 0`).
- `NO_COLOR` passed only in an injected `env` must turn colour off in-process, where `lib/color.js` reads the real `process.env` today (Task 1, test `AC2.1`, which compares against a spawned run with the same `env`).

---

### Task 1: Status line entry, colour env scope, in-process status-line tests

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/claude-tweaks-statusline.js` (entry at lines 684-744; ambient reads at 96, 223, 323, 354, 454, 499, 637, 665, 693)
- Modify: `plugin/bin/lib/color.js` (`colorEnabled`, lines 4-11)
- Test: `tests/statusline.test.js` (helper `runStatusline`, lines 34-47; its 13 call sites at 1805-2011)
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete the `'claude-tweaks-statusline.js',` line)
- Read: `perf/statusline-render.test.js`, `plugin/bin/lib/statusline-wrapper-source.js`, `tests/install-statusline-wrapper.test.js`

**Interfaces:**
- Produces: `run(argv: string[], deps) -> Promise<0>`; `realDeps = { stdin, stdout, cwd, env, homeDir, now }` (plain object literal; `stdin` is today's `readStdin`, `now: () => Date.now()`); `main() -> Promise<0>` = `run([], realDeps)`. Exports keep every current name.
- Produces in `lib/color.js`: `colorEnabled(env = activeEnv) -> boolean` and `withEnv(env, fn) -> fn's return`, which sets the module's `activeEnv` (default `process.env`) for the synchronous call of `fn` and restores it in `finally`.

- [ ] **Step 0: Baseline measurements (before any edit)**

Run, from the worktree root, and save both outputs to `{run-dir}/procs-before.txt` and `{run-dir}/perf-before.txt` (`{run-dir}` = `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T124917-spec-5386`):

```
printf '%s\n' tests/statusline.test.js tests/install-statusline-wrapper.test.js tests/bin-lib/issues/reachability-audit.test.js tests/bin-lib/release-notes-publish.test.js tests/sweep-stray-run-dirs.test.js tests/bin-lib/compose-subject.test.js tests/gh-host-seam-behavior.test.js > {run-dir}/procs-files.txt
CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from {run-dir}/procs-files.txt
npm run test:perf
```

Expected: a per-file table; `tests/statusline.test.js` shows its status-line process count (the record's floor is 12).

- [ ] **Step 1: Pin the script (real-process tests, committed before the split)**

In `tests/statusline.test.js`, add two `spawnCli` tests with comments naming the process property:

```js
// Real process: proves the script entry, shebang and exit code (the wrapper starts this file as a script).
test('AC5.1 AC7.1: script renders the payload and exits 0', () => { /* spawnCli(STATUSLINE, [], { env, stdin: JSON.stringify(payload) }) → code 0, stdout === expected segments */ });
// Real process: proves malformed stdin still exits 0 with output — the status line has no refusal path, so no non-zero smoke test exists.
test('AC7.1: script given malformed JSON on stdin exits 0', () => { /* stdin 'not json' → code 0, stderr '' */ });
```

Use a payload with `model`, `workspace.current_dir` (a temp dir with no git), `NO_COLOR: '1'` and a temp `HOME`/`USERPROFILE`, and the same expected stdout literal an existing `runStatusline` test already asserts for that shape.

- [ ] **Step 2: Run them; they pass against the unconverted file. Commit.**

Run: `node --test tests/statusline.test.js`
Expected: PASS. Commit `tests/statusline.test.js` alone: `Pin statusline script output before the entry split — #5386`.

- [ ] **Step 3: Write the failing in-process tests**

In `tests/statusline.test.js`:

```js
test('AC2.1: in-process run returns the same stdout as the spawned script for the same payload and env', async () => {
  // env: { NO_COLOR: '1', HOME: home, USERPROFILE: home, PATH: process.env.PATH }, identical object to both calls
  // assert.strictEqual((await runCli(STATUSLINE, [], { env, stdin, cwd: dir })).stdout, spawnCli(STATUSLINE, [], { env, stdin, cwd: dir }).stdout)
});
test('AC8.1: payload directory wins over deps.cwd()', async () => { /* payload workspace.current_dir = A, runCli cwd = B → project segment names basename(A) */ });
test('AC8.1: deps.cwd() is used when the payload has no directory', async () => { /* payload {}, runCli cwd = A → project segment names basename(A); fails if run reads process.cwd() */ });
test('AC8.1: session segment reads the injected HOME through deps.homeDir()', async () => { /* seed <home>/.claude/statusline/segments/<id>.json; runCli env HOME=USERPROFILE=home → segment text present */ });
test('AC8.1: NO_COLOR in the injected env only turns colour off in-process', async () => { /* delete process.env.NO_COLOR is NOT allowed (leak guard) — assert output has no \x1b[ when env.NO_COLOR='1', and has one when env lacks it */ });
test('AC8.1: git child gets the injected env (env-only GIT_DIR fixture)', async () => { /* repo A (branch a-branch, no remote) as payload dir; repo B (branch b-branch); env GIT_DIR=<B>/.git only in the injected env; strip the four GIT_* vars from setup calls → git segment names b-branch. Pick the segment whose value comes from a git child (renderGit's `status --porcelain -b`) */ });
test('run swallows a render throw and returns 0', async () => { /* deps.stdin throws → code 0, stdout '' */ });
test('main() with no arguments still renders through realDeps', () => { /* assert.strictEqual(typeof sl.main, 'function'); assert.strictEqual(sl.main.length, 0); and that statusline-wrapper-source.js still contains 'mod\n      .main()' or '.main()' */ });
```

Then replace `runStatusline`'s body with a `runCli(STATUSLINE, [], { env: { ...fixtureHomeEnv(home), ...env }, stdin: JSON.stringify(input), cwd })` call (async — the 13 call sites become `await`, their tests `async`), returning `.stdout`.

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test tests/statusline.test.js`
Expected: FAIL — `runCli` reports the file exports no `run`.

- [ ] **Step 5: Implement**

- `lib/color.js`: `activeEnv` module variable, `colorEnabled(env = activeEnv)` reads `env.NO_COLOR`, `withEnv(env, fn)`. Every existing caller is unchanged.
- Status line: `async function run(argv, deps)` — `raw = await deps.stdin()`, parse as today, `cwd = payload dir || deps.cwd()` (comment the choice), `now = deps.now()`, then build the segments inside `color.withEnv(deps.env, () => [...])`, passing `{ env: deps.env }` to every function that reads `process.env` or starts `git` (`commonDirFromFs`, `originUrlFromConfig`, `renderGit`, `resolveMainProjectDir`/`readOriginRemote` as reached), `{ home: deps.homeDir() }` to `renderPorts`, `renderAccount`, `renderSessionSegment`. Each `execFileSync('git', …)` on the path takes `env` from that option (default `process.env`). Write `deps.stdout(segments.join(SEPARATOR))`; wrap the body in `try/catch` that writes `''` and returns 0; return 0.
- `realDeps` literal as in Interfaces; `main = () => run([], realDeps)`; `module.exports` above the guard; guard per Global Constraints async form, last statement.
- Delete `'claude-tweaks-statusline.js',` from `NOT_YET`.

- [ ] **Step 6: Run to verify they pass, and prove the env/cwd tests go red**

Run: `node --test tests/statusline.test.js tests/bin-lib/cli-entry-conformance.test.js tests/statusline-no-shell-conformance.test.js tests/install-statusline-wrapper.test.js`
Expected: PASS. Then revert each thread-through once (payload-dir fallback to `process.cwd()`, `homeDir`, `withEnv`, the git child's `env`) and confirm its AC8.1 test fails; restore.

- [ ] **Step 7: Perf and process count**

Run: `npm run test:perf` → within budget, save to `{run-dir}/perf-after.txt`. Run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from {run-dir}/procs-files.txt` → `tests/statusline.test.js` starts at most 2 status-line processes (**AC1.1**).

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/claude-tweaks-statusline.js plugin/bin/lib/color.js tests/statusline.test.js tests/bin-lib/cli-entry-conformance.test.js
git commit -m "Give the statusline an injectable entry — run(argv, deps), in-process tests (#5386)"
```

---

### Task 2: install-statusline-wrapper.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/install-statusline-wrapper.js`
- Test: `tests/install-statusline-wrapper.test.js`
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete its `NOT_YET` line)

**Interfaces:**
- Produces: `run(argv, deps) -> 0` (sync), `realDeps = { homeDir: () => os.homedir(), stdout: (t) => process.stdout.write(t) }`; `installWrapper(homedir = os.homedir())` and `buildWrapperSource()` keep their exports and signatures.

- [ ] **Step 1: Pin the script.** Add one `spawnCli` test — `// Real process: proves the script entry and exit code; no refusal path exists (argv is ignored).` — `test('AC5.1 AC7.1: script installs the wrapper under the injected home and prints its path', …)`: env `HOME=USERPROFILE=<tmp>`, `PATH`; assert code 0, stdout `<tmp>/.claude-tweaks/bin/statusline.js` (path.join), file exists with the template bytes, and the real `os.homedir()` wrapper file's mtime (or absence) is unchanged. Run, PASS, commit alone.
- [ ] **Step 2: Failing in-process test.** `test('AC8.1: run writes under deps.homeDir(), not the real home', …)` with `runCliSync(CLI, [], { env: { HOME: tmp, USERPROFILE: tmp } })` → code 0, stdout is the tmp path. Run → FAIL (no `run` export).
- [ ] **Step 3: Implement** `run` calling `installWrapper(deps.homeDir())` and `deps.stdout(targetPath)`; `realDeps`; exports above the guard; sync guard last; delete the `NOT_YET` line.
- [ ] **Step 4: Run** `node --test tests/install-statusline-wrapper.test.js tests/bin-lib/cli-entry-conformance.test.js` → PASS; revert `deps.homeDir()` to `os.homedir()` once → the AC8.1 test fails (leak guard reports the homedir call); restore.
- [ ] **Step 5: Commit** `Give install-statusline-wrapper.js an injectable entry (#5386)`.

---

### Task 3: reachability-audit.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/reachability-audit.js`
- Test: `tests/bin-lib/issues/reachability-audit.test.js`
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete its `NOT_YET` line)

**Interfaces:**
- Consumes: `resolveAgainst(cwd, p)` from `plugin/bin/lib/health-core/io.js`.
- Produces: `run(argv, deps) -> 0|1|2` (sync; `argv` no longer has the two leading entries — today's `main` does `argv.slice(2)`), `realDeps = { cwd, readFile, stdout, stderr }`, `USAGE`.

- [ ] **Step 1: Pin the script.** Two `spawnCli` tests, each with its process-property comment: `AC5.1 AC7.1: --skill on a clean fixture exits 0 with one JSON line` (write a minimal SKILL.md fixture; assert code 0, stdout parses with `clean: true`), and `AC7.1: no arguments exits 2 with the usage on stderr` (code 2, stdout '', stderr `reachability-audit: usage: …\n`). Run, PASS, commit alone.
- [ ] **Step 2: Failing in-process tests.**
  - `test('AC3.1: require() prints nothing and leaves process.exitCode undefined', …)` — spawn-free: `delete require.cache[CLI]`, capture `process.stdout.write`, `require(CLI)`, assert no write and `process.exitCode === undefined`.
  - `test('AC8.1: a relative --skill path resolves against deps.cwd()', …)` — fixture under tmp dir, `runCliSync(CLI, ['--skill', 'SKILL.md'], { cwd: tmp })` → code 0.
  - `test('a missing relative --skill path prints the path as typed', …)` → code 2, stderr names `nope/SKILL.md` exactly as typed in the `cannot read --skill path:` line, matching what the script printed before (compare against `spawnCli` with the same cwd).
  Run → FAIL.
- [ ] **Step 3: Implement** `run(argv, deps)`: today's `main` body with `fail(msg)` returning 2 after `deps.stderr`, reads via `deps.readFile(resolveAgainst(deps.cwd(), p))`, the error message's resolved path swapped back to the typed spelling (Global Constraints), `deps.stdout(JSON line)`, return `result.clean ? 0 : 1`. The `cannot read` message keeps printing `path.resolve(opts.skill)`-equivalent text exactly as today — compute it as `path.resolve(deps.cwd(), opts.skill)` so it matches the unconverted output under the same cwd. Delete the bare `main(process.argv);` call; sync guard last; delete the `NOT_YET` line.
- [ ] **Step 4: Run** `node --test tests/bin-lib/issues/reachability-audit.test.js tests/bin-lib/cli-entry-conformance.test.js` → PASS; revert `deps.cwd()` to `process.cwd()` once → AC8.1 fails; restore.
- [ ] **Step 5: Grep invocations.** `plugin/skills/assess-agent-autonomy/grant-check.md` calls the lib via `node -e`, not this CLI; confirm no skill, hook or workflow invokes `reachability-audit.js` by `require` expecting the old side effect. Note the scan root (the `--skill`/`--mcp-server` file only; no git child) for the PR body.
- [ ] **Step 6: Commit** `Give reachability-audit.js an injectable entry and a require guard (#5386)`.

---

### Task 4: release-notes-publish.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/release-notes-publish.js`
- Test: `tests/bin-lib/release-notes-publish.test.js`
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete its `NOT_YET` line)
- Read: `.github/workflows/mirror-marketplace.yml` (its invocation must keep working)

**Interfaces:**
- Consumes: `run` from `./lib/release-notes-publish.js` — import it as `publish` to free the name.
- Produces: `run(argv, deps) -> 0|1|2`, `realDeps = { cwd, env, stdout, stderr, gh: (args, input, { cwd, env }) => …, git: (args, { cwd, env }) => …, readFile: (abs) => string|null, writeFile: (abs, text) }`; `main(argv) = run(argv, realDeps)`; `parseArgs`, `USAGE` stay exported. `defaultDeps` stays exported only if Step 0's grep finds an importer; otherwise it is folded into `run`.

- [ ] **Step 0: Grep importers** of `main`, `defaultDeps`, `parseArgs` from this file (`tests/`, `plugin/`, `.github/`); record the result for the PR body.
- [ ] **Step 1: Pin the script.** Two `spawnCli` tests with process-property comments: `AC5.1 AC7.1: --help exits 0 and prints the usage` and `AC7.1: an unknown argument exits 2 with the usage on stderr`. Neither reaches `gh`. Run, PASS, commit alone.
- [ ] **Step 2: Failing in-process tests.** `test('AC8.1: a relative --root resolves against deps.cwd() for file reads and gh/git cwd', …)` — fakes `gh` and `git` record their `{ cwd, env }`; `readFile` records the absolute path; `runCliSync(CLI, ['--root', 'repo'], { cwd: tmp, env: { MARKER: '1' }, deps: { gh, git, readFile, writeFile } })`; assert every recorded cwd is `path.join(tmp, 'repo')`, every env is the injected object, and `readFile` saw `path.join(tmp, 'repo', 'CHANGELOG.md')` when the fake release list yields two releases. Run → FAIL.
- [ ] **Step 3: Implement** `run`: parse (usage error → stderr, 2; help → stdout, 0), `root = opts.root ? path.resolve(deps.cwd(), opts.root) : deps.cwd()`, then `return publish(argv, { gh: (a, i) => deps.gh(a, i, { cwd: root, env: deps.env }), git: (a) => deps.git(a, { cwd: root, env: deps.env }), readFile: (p) => deps.readFile(path.join(root, p)), writeFile: (p, t) => deps.writeFile(path.join(root, p), t), stdout: deps.stdout, stderr: deps.stderr })`. Real `gh` keeps `ghOptions(args, { …, timeout: GH_TIMEOUT_MS, windowsHide: true })` plus `cwd`/`env`; real `git` likewise. Exports above the guard; guard `process.exitCode = run(process.argv.slice(2), realDeps)` last; delete the `NOT_YET` line.
- [ ] **Step 4: Run** `node --test tests/bin-lib/release-notes-publish.test.js tests/bin-lib/release-notes.test.js tests/bin-lib/cli-entry-conformance.test.js` → PASS; revert the `root` derivation to `process.cwd()` once → AC8.1 fails; restore.
- [ ] **Step 5: Commit** `Give release-notes-publish.js an injectable entry (#5386)`.

---

### Task 5: sweep-stray-run-dirs.js

**Role:** integration

**Files:**
- Modify: `plugin/bin/sweep-stray-run-dirs.js`
- Modify (only if its git calls take no `env`): `plugin/bin/lib/reconcile/archive-merged.js` (`archiveRunDir`). `mainCheckoutRoot` (`plugin/bin/lib/hooks/worktree-detect.js:53`) walks the filesystem for `.git` and starts no child — it takes `deps.cwd()` only.
- Test: `tests/sweep-stray-run-dirs.test.js`
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete its `NOT_YET` line)

**Interfaces:**
- Produces: `run(argv, deps) -> 0|1` (sync), `realDeps = { cwd: () => process.cwd(), env: process.env, stdout }`; `sweep({ root, dryRun, logPath, env = process.env })`, `hasTrackedWork(root, runDir, env = process.env)` — `repoPinnedEnv(env)` instead of `repoPinnedEnv()`; existing exports keep working.

- [ ] **Step 1: Pin the script.** One `spawnCli` test — `// Real process: proves the script entry and exit code; the CLI has no argument refusal (unknown flags are ignored), so no non-zero smoke test.` — `AC5.1 AC7.1: --dry-run --root <fixture> prints the four summary lines and exits 0`. Run, PASS, commit alone.
- [ ] **Step 2: Failing in-process tests.**
  - `test('AC4.1: in-process with a fixture cwd sweeps only under that directory', …)` — two git fixtures each holding a stray run dir with a tracked `work/1-spec.md`; `runCliSync(CLI, [], { cwd: fixtureA, env })` (env from `process.env` minus the four `GIT_*` vars, plus `PATH`) → fixtureA's stray dir archived, fixtureB untouched, stdout `root: <fixtureA>`.
  - `test('AC8.1: a relative --root and --log resolve against deps.cwd()', …)`.
  - `test('AC8.1: git children get the injected env', …)` — env-only fixture: the injected env carries `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=core.excludesFile`… or another env-only switch that changes what `git ls-files` reports; the assertion fails when `hasTrackedWork` reads `process.env`. (`repoPinnedEnv` strips the four `GIT_*` location vars by design, so the probe must use a variable it keeps.)
  Run → FAIL.
- [ ] **Step 3: Implement** `run`: `parseArgs(argv)`, `root = args.root ? path.resolve(deps.cwd(), args.root) : (mainCheckoutRoot(deps.cwd()) || deps.cwd())`, `logPath` resolved against `deps.cwd()` when relative, `sweep({ …, env: deps.env })`, the four `console.log` lines and the failure lines through `deps.stdout(line + '\n')`, return 1 on failures else 0. Thread `env` into every git child on the path (`hasTrackedWork`, `archiveRunDir` — add an `env` option defaulting to `process.env` where one is missing). Exports above the guard; sync guard last; delete the `NOT_YET` line.
- [ ] **Step 4: Run** `node --test tests/sweep-stray-run-dirs.test.js tests/bin-lib/cli-entry-conformance.test.js tests/path-guard-conformance.test.js` plus the test files of any lib changed in Step 3 → PASS; revert the cwd and env thread-throughs once each → AC4.1 / AC8.1 fail; restore.
- [ ] **Step 5: Commit** `Give sweep-stray-run-dirs.js an injectable entry, cwd through deps (#5386)`.

---

### Task 6: compose-subject.js re-export and lib contract

**Role:** integration

**Files:**
- Modify: `plugin/bin/compose-subject.js`
- Modify: `plugin/bin/lib/compose-subject.js` (`realDeps` lines 278-297; `run` from line 301)
- Test: `tests/bin-lib/compose-subject.test.js`
- Test: `tests/bin-lib/cli-entry-conformance.test.js` (delete its `NOT_YET` line)

**Interfaces:**
- Produces: `plugin/bin/compose-subject.js` exports `{ run, realDeps }` (the lib's), guard last. Lib `realDeps` gains `cwd: () => process.cwd()` and `env: process.env`; `readCommitScope` / `readCommitScopePaths` become `(cwd) => …` and `run` calls them with `deps.cwd()`; `runner` and `gitRunner` real values pass `cwd`/`env` taken from `deps` via `run` (seams become `(args, { cwd, env } = {})`, real values defaulting to today's behaviour when the option is absent, so existing fakes keep working).

- [ ] **Step 1: Failing test.** `test('AC8.1: run reads commit-scope through deps.cwd()', …)` in `tests/bin-lib/compose-subject.test.js`: call the lib `run` directly with fakes (`ghAvailable: () => true`, a `runner` returning a fixture issue JSON) and `cwd: () => tmp`, and a `readCommitScope` spy; assert the spy received `tmp`. And one asserting `runner` received `{ cwd: tmp, env: injected }`. Run → FAIL.
- [ ] **Step 2: Implement** as in Interfaces; `plugin/bin/compose-subject.js` becomes `const { run, realDeps } = require('./lib/compose-subject'); module.exports = { run, realDeps }; if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. Delete the `NOT_YET` line.
- [ ] **Step 3: Check fail-closed names.** Confirm every lib `realDeps` key that starts `gh` is named `runner`, `ghAvailable` or another `FAIL_CLOSED_KEYS` name (`fetchIssueType` and `pinGhHost` start `gh` too — if a test of this CLI goes through `runCli`, add those names to `FAIL_CLOSED_KEYS` in `tests/helpers/run-cli.js` in this commit; if none does, record the reason in the PR body).
- [ ] **Step 4: Run** `node --test tests/bin-lib/compose-subject.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/cli-entry-conformance.test.js` → PASS. `tests/gh-host-seam-behavior.test.js`'s 9 real-process tests are compose-subject's script smoke tests (**AC5.1**, **AC7.1**) and stay unconverted. Revert the `deps.cwd()` thread-through once → AC8.1 fails; restore.
- [ ] **Step 5: Commit** `Re-export compose-subject's run and realDeps; thread cwd and env through the lib (#5386)`.

---

## Acceptance-criterion coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 7 (count-node-procs) and Post-task evidence |
| AC2.1 | Task 1 test `AC2.1` |
| AC3.1 | Task 3 test `AC3.1` |
| AC4.1 | Task 5 test `AC4.1` |
| AC5.1 | Each task's Step 1 pin test; Task 6 Step 4 |
| AC6.1 | Each task deletes its own `NOT_YET` line; `tests/bin-lib/cli-entry-conformance.test.js` passes |
| AC7.1 | Each task's Step 1 (two smoke tests where a refusal path exists, one otherwise with the reason) |
| AC8.1 | Each task's `AC8.1` tests, each shown red once by reverting its thread-through |
| AC9.1 | Post-task evidence |
| AC10.1 | Common Step 5 full verification and the PR's Windows CI job |

Waived AC6.2: `NOT_YET` holds 21 entries today and keeps 15 after this record (other sibling records own them), so the list is not empty and nothing is deleted.

## Post-task evidence (orchestrator, before the phase-exit push)

Re-run `CT_TEST_CONCURRENCY=6 node tools/count-node-procs.js --files-from {run-dir}/procs-files.txt` in the same hour as Step 0's run and put the before/after table in the PR body (**AC9.1**), with: every test left on a real process and its reason; each `plugin/bin/lib` file changed to pass an injected value (`lib/color.js`, `lib/compose-subject.js`, and `lib/reconcile/archive-merged.js` if Task 5 changed it); the scan root and git children of `reachability-audit.js` and `sweep-stray-run-dirs.js`; the importer greps (Tasks 3, 4); and any difference between #5374's merged helper/tool/test and the record's description of them.
