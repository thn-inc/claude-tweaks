---
files:
  - tests/helpers/run-cli.js
  - tools/count-node-procs.js
  - tools/count-node-procs-preload.js
  - plugin/bin/resolve-policy.js
  - .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md
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

### 2. Swap the file's spawn helper for an adapter over `runCliSync`
- **URL:** the test file's local helper, and `tests/helpers/run-cli.js`.
- **Action:** Require `runCliSync` and `spawnCli`, and make the local helper call `runCliSync(CLI, args, { cwd, env: { ...(env || process.env) } })`, returning the shape the tests already read (for example `{ status: res.code, stdout: res.stdout, stderr: res.stderr }`). Use `runCli` and `await` only when the CLI's `run` is async.
- **Should feel:** Like changing one function. The test bodies and their assertions stay as they were.
- **Should understand:**
  - `cliPath` must be absolute.
  - `env` is the complete environment the CLI sees and defaults to `{}`. A CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in it, so a test that relied on the inherited environment passes `{ ...process.env }`.
  - The helper merges `{ ...realDeps, ...fakes, ...deps }`. The fakes collect stdout and stderr and supply `cwd`, a frozen `env`, `stdin` and `homeDir`.
- **Red flags:**
  - `runCli: … exports no realDeps` or `exports no run`. The CLI does not meet the entry contract yet. Convert the CLI first; that is a change to `plugin/bin`, with its own script-output tests.
  - A failure that reads `git not found`. The test passed a partial `env` without `PATH`.

### 3. Read what the leak guard and the fail-closed rule tell you
- **URL:** the error text of a test that now throws.
- **Action:** Run the file (`node --test <file>`) and read each new failure.
- **Should feel:** Specific. Each message names the one thing the CLI did to the process.
- **Should understand:**
  - `leaked process state: …` names a leak: `process.exitCode changed`, a changed working directory, a `process.env.<KEY> changed`, a listener added or removed, `wrote to process.stdout directly` (or stderr), or an `os.homedir()` call under an injected home. The helper has already put the state back, so later tests are not affected. The fix is in the CLI or a library on its path: send that write or read through `deps`.
  - `runCli: real <key> reached — pass a fake in deps or allowRealRunner: true` means the CLI called a real seam named `runner`, `gh` or `spawn`. Pass a fake for it in `deps`. A git-only seam (`git`, `gitRunner`) stays real on purpose and runs against the injected `cwd` and `env`.
  - A test that gets an earlier test's answer depends on module-level state under `plugin/bin`. Give that call `fresh: true`.
- **Red flags:**
  - Catching the helper's throw in the test, or loosening an assertion, to get back to green. A leak is a defect in the CLI's path, and the test just found it.
  - A CLI whose `realDeps` holds a seam that can start `gh` or an arbitrary command under another name (`execFileSync`, `runPremiseCheck`). Add that name to `FAIL_CLOSED_KEYS` in the helper in the same change, or the test can reach the real tool.
  - A stub on an injected `PATH` that never runs. A child on the CLI's path is started without `env: deps.env`, so it inherits the test runner's environment.

### 4. Keep the script entry covered by real processes
- **URL:** the same test file.
- **Action:** Leave one or two tests on `spawnCli(CLI, args, { cwd, env })`, named with the prefix `smoke (real process): `, covering the script entry and the exit code (a usage error with exit 1 is a good one). Also keep on `spawnCli` any test whose claim is about the whole process environment, such as "this variable is never read".
- **Should feel:** Deliberate. A handful of real processes stay, each for a stated reason.
- **Should understand:** In-process, a test only proves the CLI reads the injected `env`. The leak guard reports writes to `process.env`, never reads, so a direct read in a library would pass unseen. The process-wide timeout knobs (`CLAUDE_TWEAKS_GH_TIMEOUT_MS`, `CLAUDE_TWEAKS_GIT_TIMEOUT_MS`, `CT_HOOKS_GIT_TIMEOUT_MS`) are read from the real process by design, so a test of those is a `spawnCli` test too.
- **Red flags:** A converted file with no real-process test left. Nothing then proves the shebang, the `require.main` guard or the process exit code.

### 5. Measure again and report the difference
- **URL:** `node tools/count-node-procs.js --files-from <list> --json <after.json>`
- **Action:** Run it at the converted commit and put the two tables side by side in the pull request.
- **Should feel:** Like the receipt from step 1 with smaller numbers. For `plugin/bin/resolve-policy.js` (#5374) the two converted files went from 87 CLI processes to 4.
- **Should understand:** Wall time falls by the process starts saved, not by time the tests spend waiting. A test that waits on a stubbed tool's timeout takes just as long in-process.
- **Red flags:**
  - The same CLI count as before. The adapter still spawns, or a second local helper in the file was missed.
  - A different test count from step 1. A test was dropped or skipped during the conversion.

## Origin
- Created during build of #5374, which added `tests/helpers/run-cli.js` and `tools/count-node-procs.js`, converted `plugin/bin/resolve-policy.js` to the entry contract and moved `tests/resolve-policy-cli.test.js` and `tests/resolve-policy-control-mode.test.js` onto the helper.
- Related: `act-on-a-red-cli-entry-conformance-scan-5374.md` (the scan that pins the entry contract), `resolve-a-policy-key.md` (the CLI used as the worked example).
