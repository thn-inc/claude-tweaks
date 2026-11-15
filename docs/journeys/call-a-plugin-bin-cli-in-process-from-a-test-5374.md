---
files:
  - tests/helpers/run-cli.js
  - tools/count-node-procs.js
  - tools/count-node-procs-preload.js
  - plugin/bin/resolve-policy.js
  - plugin/bin/harness-health.js
  - plugin/bin/journey-health.js
  - plugin/bin/lib/health-core/io.js
  - tests/helpers/health-sweep-cli.js
  - .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
  - plugin/bin/hooks.js
  - docs/hooks.md
---

# Call a plugin/bin CLI In-Process From a Test

**Persona:** A claude-tweaks plugin maintainer working one of the sibling records of #5373, who owns a test file that starts `node plugin/bin/<cli>.js` once per test case and wants those calls to run inside the test process.
**Goal:** Move the file's CLI calls onto `tests/helpers/run-cli.js` without changing what any test asserts, and show how many processes and how much wall time the change saved.
**Entry point:** A test file under `tests/` whose helper calls `spawnSync(process.execPath, [CLI, ...args])` (or `execFileSync`), and a CLI that already meets the entry contract in `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` (it exports `run(argv, deps)` and `realDeps`).
**Success state:** Every test in the file passes with the same test count as before, one or two tests still run the real script through `spawnCli`, and a before/after table from `tools/count-node-procs.js` shows the drop in CLI processes.

## Steps

### 1. Measure the file before touching it
- **URL:** `node tools/count-node-procs.js --files-from <list> --json <before.json>`, where `<list>` is a text file naming the test files, one repo-relative path per line.
- **Action:** Run it from the checkout root and keep the printed table.
- **Should feel:** Like reading a receipt. One row per test file: node processes, `plugin/bin` CLI processes, wall time in milliseconds.
- **Should understand:**
  - The tool runs the listed files through `tools/run-tests.js` with a preload (`tools/count-node-procs-preload.js`) carried in `NODE_OPTIONS`, and exits with the test run's exit code.
  - The counts are a floor, and the note above the table says why: a child started with a replaced env drops the preload, a node started through a shell is not attributed, and the `node --test` runner counts as unattributed.
  - `--json` writes the same rows, each with `nodeProcs`, `wallMs` and `cliProcs` keyed by CLI file name.
- **Red flags:**
  - `listed entry "…" is not a repo-relative path`. The list file holds an absolute path. Write paths relative to the checkout root.
  - A row for a file you did not list, or the whole run attributed to the first file. The runner is being counted as a test file, which the tool's own tests rule out.
  - `count-node-procs: test run failed to start: …` or `count-node-procs: test run was killed by <signal>` on stderr. The test run itself did not finish, the tool exits 1, and the table's counts are not a measurement of the file. Fix the run and measure again.

### 2. Swap the file's spawn helper for an adapter over `runCliSync`
- **URL:** the test file's local helper, and `tests/helpers/run-cli.js`.
- **Action:** Require `runCliSync` and `spawnCli`, and make the local helper call `runCliSync(CLI, args, { cwd, env: { ...(env || process.env) } })`, returning the shape the tests already read (for example `{ status: res.code, stdout: res.stdout, stderr: res.stderr }`). Use `runCli` and `await` only when the CLI's `run` is async.
- **Should feel:** Like changing one function. The test bodies and their assertions stay as they were.
- **Should understand:**
  - `cliPath` must be absolute.
  - `env` is the complete environment the CLI sees and defaults to `{}`. A CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in it, so a test that relied on the inherited environment passes `{ ...process.env }`.
  - The helper merges `{ ...realDeps, ...fakes, ...deps }`. The fakes collect stdout and stderr and supply `cwd`, a frozen `env`, `stdin` and `homeDir`.
  - When several test files drive the same family of CLIs, give them one shared adapter instead of a copy per file. The four health sweeps' twenty-one files (ten from #5380, eleven from #5381) all call `sweepCli` from `tests/helpers/health-sweep-cli.js`. Its `opts.deps` reaches `runCliSync`, so a test that needs a fake seam passes it there (#5381's counting `lock`).
- **Red flags:**
  - `runCli: … exports no realDeps` or `exports no run`. The CLI does not meet the entry contract yet. Convert the CLI first; that is a change to `plugin/bin`, with its own script-output tests. Look for every write the script awaits before it exits, on stdout and on stderr: each one needs an awaitable seam. `plugin/bin/hooks.js` (#5375) had three on stdout and one on stderr, which the plan missed. Its `realDeps` gives a Promise-returning `stdout` awaited at those sites and a non-throwing full-write `stderr`, because a single `fs.writeSync(2, …)` silently short-writes on a non-blocking fd 2. `docs/hooks.md`'s In-process entry section records the shape.
  - A failure that reads `git not found`. The test passed a partial `env` without `PATH`.

### 3. Read what the leak guard and the fail-closed rule tell you
- **URL:** the error text of a test that now throws.
- **Action:** Run the file (`node --test <file>`) and read each new failure.
- **Should feel:** Specific. Each message names the one thing the CLI did to the process.
- **Should understand:**
  - `leaked process state: …` names a leak: `process.exitCode changed`, a changed working directory, a `process.env.<KEY> changed`, a listener added or removed, `wrote to process.stdout directly` (or stderr), or an `os.homedir()` call under an injected home. The helper has already put the state back, so later tests are not affected. The fix is in the CLI or a library on its path: send that write or read through `deps`.
  - `runCli: real <key> reached — pass a fake in deps or allowRealRunner: true` means the CLI called a real seam named `runner`, `gh`, `ghAvailable`, `runHook`, `spawn` or `runSuite`. Pass a fake for it in `deps`. A git-only seam (`git`, `gitRunner`) stays real on purpose and runs against the injected `cwd` and `env`.
  - A test that gets an earlier test's answer depends on module-level state under `plugin/bin`. Give that call `fresh: true`.
- **Red flags:**
  - Catching the helper's throw in the test, or loosening an assertion, to get back to green. A leak is a defect in the CLI's path, and the test just found it.
  - A CLI whose `realDeps` holds a seam that can start `gh` or an arbitrary command under another name (`execFileSync`, `runPremiseCheck`). Add that name to `FAIL_CLOSED_KEYS` in the helper in the same change, or the test can reach the real tool.
  - A stub on an injected `PATH` that never runs. A child on the CLI's path is started without `env: deps.env`, so it inherits the test runner's environment.
  - A CLI that commits or pushes (the health sweeps' durable state runs real `git fetch` and `git push origin`) tested in-process from inside a checkout. If it ignores its injected `cwd`, it falls back to the test process's real directory, commits to a git ref every worktree shares, and a later push publishes it: #5380's unguarded mutation runs pushed six real commits to `origin` this way. Run such a CLI through an adapter that moves the real cwd to an empty temp directory outside any repo for the call and sets `GIT_ALLOW_PROTOCOL=file` last in `env`, as `sweepCli` does, and run mutation probes in a `git archive` extract, never a linked worktree.
  - A relative-path error message or output that changed spelling after the conversion. `path.resolve(deps.cwd(), p)` normalizes (`results.json/`, `link/../x`), so it can change the outcome as well as the text. Where the old behavior must stay byte-identical, join without normalizing, as `plugin/bin/lib/health-core/io.js`'s `resolveAgainst` does.
  - An error line that prints Node's `err.message` now shows an absolute path where the script printed the relative one the user typed (`cannot read plan file missing.md: ENOENT: …, open '/abs/cwd/missing.md'` instead of `open 'missing.md'`). Node's message embeds whatever path `fs` was handed, and `resolveAgainst` hands it the joined absolute path. Map it back where the message is built, `err.message.split(resolved).join(asTyped)` (a no-op for an absolute argument), and pin the old bytes with an in-process case under an injected `cwd`; #5382 did this in `plan-audit.js` and `resolve-profile.js`. A test matching only `/cannot read plan file/` misses it.
  - `process.cwd() could not be read or restored (…)` in the leak list. The CLI removed its own working directory, or the directory the test started in, so the helper could not put the cwd back. It still restored the env and the listeners. Work from `deps.cwd()` instead of changing or removing the process's directory.
  - A relative path argument (`--run`, `--body-file`, an input JSON) that the CLI reads or writes against the test runner's directory instead of the injected `cwd`: a `cannot read` failure, or an output file that lands in the checkout. The leak guard stays silent, because nothing about the process changed. Resolve the argument where `run` uses it, `path.isAbsolute(p) ? p : path.resolve(deps.cwd(), p)`; #5383 fixed five CLIs this way.
  - A CLI that worked from a deleted working directory and now fails there with `ENOENT: process.cwd failed` or `uv_cwd`. `realDeps.cwd()` is `process.cwd()`, which throws once the directory is gone, so calling `deps.cwd()` up front turns an absolute-path or no-path invocation into a failure. Read it only where a relative path or a child process needs it, and pin the old result with an in-process test whose injected `cwd()` throws; #5385 found four CLIs doing this at final review. `plugin/bin/lib/health-core/io.js` has both lazy forms: `fsPath(deps, p)` joins a relative `p` as `resolveAgainst` does and never reads the cwd for a rooted one, and `cwdOrUndefined(deps)` gives `undefined` instead of throwing, for a CLI that carries on without a cwd. Use them rather than writing the check inline; #5385's review found `release-bootstrap.js` had re-written `fsPath`.
  - An env-only `GIT_DIR` proof that stays green whether or not `env` is threaded. The git child runs through `plugin/bin/lib/hooks/git-exec.js`'s `repoPinnedEnv`, which strips the four `GIT_*` discovery variables by design (#4178), so the A/B fixture cannot discriminate there. Prove the injected env with a variable git honours that `repoPinnedEnv` keeps instead: `GIT_AUTHOR_NAME`, read back as the commit's `%an`, or `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`. `tests/archive-run-verb.test.js` does this (#5375).
  - A verb whose library starts children that take no `env` (`hooks.js reconcile` and `reconcile-background`). In-process, those children would run with the test runner's environment. If the test's subject is the CLI's own logic (flag strictness, dispatch), stub the library functions on their module object around the `runCli` call and restore them in `finally`. Assert the stub got the parsed options in place of the real pass's side effect, as `tests/hooks-js-flag-strict.test.js` does. The stub reaches the CLI only if it looks the function up on the module at call time.
  - A CLI that writes run files (`hooks.js archive-run`) tested in-process. A regression from `deps.cwd()` to `process.cwd()` would write into the test runner's real checkout before any git step. The spawned tests never had that exposure. Keep every call's `cwd` and `--run` inside a temp fixture.
  - A CLI that registers `SIGTERM`/`SIGINT` handlers or keeps a server open (`visual-decide`'s daemon). An in-process `run` must resolve only after the server has closed and its handlers are removed. A server that records `process.pid` makes a later `stop` signal the test runner, so route the signal through a `deps.kill` seam whose fake calls the in-process `stop`; `process.kill(process.pid, …)` must never be reachable (#5385).

### 4. Keep the script entry covered by real processes
- **URL:** the same test file.
- **Action:** Leave one or two tests on `spawnCli(CLI, args, { cwd, env })`, named with the prefix `smoke (real process): `, covering the script entry and the exit code (a usage error with exit 1 is a good one). Also keep on `spawnCli` any test whose claim is about the whole process environment, such as "this variable is never read".
- **Should feel:** Deliberate. A handful of real processes stay, each for a stated reason.
- **Should understand:** In-process, a test only proves the CLI reads the injected `env`. The leak guard reports writes to `process.env`, never reads, so a direct read in a library would pass unseen. The process-wide timeout knobs (`CLAUDE_TWEAKS_GH_TIMEOUT_MS`, `CLAUDE_TWEAKS_GIT_TIMEOUT_MS`, `CT_HOOKS_GIT_TIMEOUT_MS`, `CLAUDE_TWEAKS_LOCK_WAIT_MS`) are read from the real process by design, so a test of those is a `spawnCli` test too.
- **Red flags:**
  - A converted file with no real-process test left. Nothing then proves the shebang, the `require.main` guard or the process exit code.
  - A refusal smoke that asserts "non-zero and stderr" against a verb whose own refusal exits 0 or prints on stdout (`hooks.js archive-run` on an active run, `close-run`, `record-worktree` without `--run`). Spawn that verb's unknown-flag refusal instead (exit 1, stderr), and pin the natural refusal's exact bytes in-process (#5375).
  - A closed-stderr test that patches `fs.writeSync` in-process. It proves less than the claim: run it as a real process whose fd 2 is a read-only file descriptor (`stdio: ['ignore', 'pipe', fd]`). `tests/hooks-js-flag-strict.test.js`'s `#4834` test does this.
  - A smoke that passes an explicit `env` without `NODE_OPTIONS` and `CT_COUNT_NODE_LOG`. Step 1's counter never sees it, and the after-table undercounts. Copy both keys into the smoke's `env` when they are present.

### 5. Measure again and report the difference
- **URL:** `node tools/count-node-procs.js --files-from <list> --json <after.json>`
- **Action:** Run it at the converted commit and put the two tables side by side in the pull request.
- **Should feel:** Like the receipt from step 1 with smaller numbers. For `plugin/bin/resolve-policy.js` (#5374) the two converted files went from 87 CLI processes to 4. For `harness-health.js` and `journey-health.js` (#5380) the ten converted files went from 120 to 5. For `plan-audit.js`, `phase-timing.js`, `resolve-profile.js` and `calibration-report.js` (#5382) the five converted files went from 189 CLI processes to 8, and from 19 nested `resolve-policy.js` processes to 0 once `calibration-report.js` called that CLI's exported core instead of spawning it. For `code-health.js`, `docs-health.js` and `design-detect.js` (#5381) the eleven converted files went from 112 CLI processes to 8. For eight small CLIs (#5385) the eight converted files went from 116 to 19, of which visual-decide's real daemon smoke accounts for 2. For the `plugin/bin/hooks.js` dispatcher (#5375), its four heaviest verb-test files went from 267 `hooks.js` processes to 17.
- **Should understand:** Wall time falls by the process starts saved, not by time the tests spend waiting. A test that waits on a stubbed tool's timeout takes just as long in-process.
- **Red flags:**
  - The same CLI count as before. The adapter still spawns, or a second local helper in the file was missed.
  - A different test count from step 1. A test was dropped or skipped during the conversion.

## Origin
- Updated during build of #5375, which gave `plugin/bin/hooks.js` `run(argv, deps)` and `realDeps` and moved `tests/hooks-help-guard.test.js`, `tests/hooks-js-flag-strict.test.js`, `tests/hooks-ledger-row.test.js` and `tests/archive-run-verb.test.js` onto the helper. It added the awaited-flush-site note in step 2, the `repoPinnedEnv`, module-stub and run-file red flags in step 3, the refusal-smoke and closed-stderr red flags in step 4, and the dispatcher measurement in step 5.
- Updated during build of #5381, which converted `plugin/bin/code-health.js`, `docs-health.js` and `design-detect.js` and their eleven test files: the shared-adapter count and the `opts.deps` note in step 2, and the fourth measurement in step 5.
- Updated during build of #5382, which converted `plugin/bin/plan-audit.js`, `phase-timing.js`, `resolve-profile.js` and `calibration-report.js` and their five test files: the `err.message` red flag in step 3 and the third measurement in step 5.
- Updated during build of #5380, which converted `plugin/bin/harness-health.js` and `plugin/bin/journey-health.js` and their ten test files: the shared-adapter note in step 2, the git-writing-CLI and path-normalization red flags in step 3, and the second measurement in step 5.
- Created during build of #5374, which added `tests/helpers/run-cli.js` and `tools/count-node-procs.js`, converted `plugin/bin/resolve-policy.js` to the entry contract and moved `tests/resolve-policy-cli.test.js` and `tests/resolve-policy-control-mode.test.js` onto the helper.
- Step 3 updated during build of #5383, which added `ghAvailable` (the gh-on-PATH probe) and `runHook` (release-local's hook runner) to the helper's fail-closed seams.
- Updated during build of #5385, which converted `record-graph`, `blast-radius`, `init-verify-scope`, `release-bootstrap`, `session-tmp-resolve`, `declined-learning`, `residue` and `visual-decide`. It added the `runSuite` seam, the deleted-cwd and signal-handler red flags in step 3, the lock-wait knob and the smoke-env red flag in step 4, and the fourth measurement in step 5.
- Related: `act-on-a-red-cli-entry-conformance-scan-5374.md` (the scan that pins the entry contract), `resolve-a-policy-key.md` (the CLI used as the worked example).
