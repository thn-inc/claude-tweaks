---
files:
  - tools/run-tests.js
  - tools/direct-test-run-guard.js
  - tools/direct-test-run-guard.sh
  - .claude/settings.json
  - tests/direct-test-run-guard.test.js
  - tests/run-tests-isolation.test.js
---

# Run Several Test Files Through the Runner

**Persona:** A Claude agent session working on this repository for a claude-tweaks maintainer, alongside several sibling sessions on the same Mac. It wants a quick result from a handful of test files, or it is writing a mutation loop that re-runs the same files once per mutant.
**Goal:** Run exactly the test files it names, with node's own flags and output, without skipping what `tools/run-tests.js` gives a run.
**Entry point:** A Bash call holding a direct `node --test` over two or more files, a glob, a directory, a loop, or a scratch script that spawns `node --test` itself.
**Success state:** The same files run through `node tools/run-tests.js <flags> <files>` with the suite slot, a per-run `TMPDIR`, git auto-maintenance off and bounded concurrency. The session got there in one extra round trip, by pasting the line the deny gave it. A single-file run never saw the guard at all.

## Steps

### 1. Re-run one test file while iterating
- **URL:** the session's Bash tool.
- **Action:** Run `node --test tests/direct-test-run-guard.test.js`, or `node tests/direct-test-run-guard.test.js`.
- **Should feel:** Untouched. The run starts at once, with no warning and no added output.
- **Should understand:**
  - One literal test file outside a loop is allowed. It is the documented way to re-run a failing file in isolation.
  - The hook still ran. `.claude/settings.json` registers the guard for every Bash call, behind a sh prefilter (`tools/direct-test-run-guard.sh`): a call that names node, as this one does, costs one short node start, a call whose fragments all start with a plain command name (`ls`, `git status`) ends in the hook's own shell, and every path exits 0.
- **Red flags:**
  - A single-file run denied, or any line printed for an allowed call.
  - A command that has nothing to do with node (`ls`, `git -C … status`) being slowed noticeably or blocked.

### 2. Type a multi-file run and get the replacement
- **URL:** the Bash tool's deny reason.
- **Action:** Run node's test runner directly on two files in one call: the `--test` form with `--test-reporter=tap` and the operands `tests/a.test.js tests/b.test.js`. (The command is not written out here: `tests/direct-test-run-guard.test.js` checks that every direct test command in a journey is one the guard allows.)
- **Should feel:** Corrected, not stuck. The reason says why in one sentence and gives the line to run next.
- **Should understand:**
  - The reason opens `This repository's guard blocked a direct test run.` and names the four things a direct run skips: git auto-maintenance off for fixture repos, a per-run TMPDIR removed on exit, the machine-wide suite slot, and bounded file concurrency.
  - The replacement stands on its own line, here `node tools/run-tests.js --test-reporter=tap tests/a.test.js tests/b.test.js`. It keeps the typed flags, files, variable assignments and the rest of the pipeline.
  - A command typed after `cd tests &&` gets a replacement that keeps the `cd` and addresses the runner from there (`cd tests && node ../tools/run-tests.js a.test.js b.test.js`).
  - The same deny answers a glob, a directory, an unresolved `$(…)` or `$VAR` operand, no operand at all, and a run inside `for`, `while`, `until`, `xargs`, `find -exec` or `parallel`, including through `sh -c`, `timeout`, `env`, `nice`, `sudo` and similar prefixes.
  - The last two lines name `node tools/run-tests.js --files-from <list>` for a checkout older than the guard, and say a single test file outside a loop can still be run directly.
- **Red flags:**
  - A replacement line the runner then refuses with an argument error. When the runner would refuse the files as typed, the reason prints a placeholder and the runner's own message instead of a line to paste.
  - A deny for a run under `evals/` (its own Node project), or in a directory tree with no `tools/run-tests.js` above the files.
  - A deny for text that only mentions a test run: a quoted string, a heredoc body, a commit message.

### 3. Paste the replacement
- **URL:** the Bash tool; the runner's stderr.
- **Action:** Run the replacement line as given.
- **Should feel:** Like the command that was typed. Node's reporter output is on stdout and the exit code is the child's.
- **Should understand:**
  - The files run as an explicit subset: no impact selection, the subset slot lane, `--test-concurrency` at the runner's default unless `--test-concurrency=<n>` or `CT_TEST_CONCURRENCY` says otherwise.
  - Arguments starting `--test-` or `--experimental-test-` reach `node --test` unchanged, in both `--flag=value` and `--flag value` forms.
  - The runner's own lines are on stderr, so TAP read from stdout is exactly what node wrote.
  - When a sibling session holds the subset slot, the run waits and says so: `run-tests.js: waiting for a test-suite slot — held by pid N (cwd …)`.
  - A file that does not exist, sits outside the checkout or does not end in `.test.js`, files mixed with a directory root, `--files-from`, `--shard`, `--record-durations` or `--full`, and an unknown dash argument each exit 1 with one `run-tests.js:` line and start nothing.
- **Red flags:**
  - A `run-tests.js:` line inside the TAP stream.
  - The run taking the full-suite lane and queueing behind a sibling's whole-suite run.
  - `ct-*` fixture directories left directly under the real tmpdir after the run.

### 4. Write a mutation loop that calls the runner
- **URL:** a scratch script outside the checkout's `tools/`, `plugin/`, `tests/`, `perf/`, `evals/` and `scripts/` directories, started with `node /path/to/mutant-run.js` or `bash loop.sh`.
- **Action:** Start a script that spawns `node --test` for each mutant.
- **Should feel:** Caught at the Bash call, before the loop starts, with the spawn form to use instead.
- **Should understand:**
  - The guard reads the script the call names (at most 256 KB). A JavaScript file is matched when it refers to `child_process` and either holds a `--test` argument beside a node program reference or holds a string that runs `node --test` as a command. A shell file is matched when it holds a direct test run.
  - The reason opens `This repository's guard blocked a script that starts node --test itself`, quotes what matched, and gives the form: `spawnSync(process.execPath, ['tools/run-tests.js', ...flags, ...files], { cwd: checkoutRoot })`, called once per mutant from inside the mutant's own checkout.
  - Each call queues in the subset lane like any other subset run, so a loop on a busy machine waits its turn per mutant.
  - Repo tooling under the six skipped directories is never read, and an unreadable or missing script is allowed.
- **Red flags:**
  - A scratch script denied only because its text mentions the words, with no `child_process` reference.
  - A script that still spawns `node --test` over several files running unchallenged.
  - The loop producing nothing for minutes with no `waiting for a test-suite slot` line to explain it.

## Origin
- Created during build of #5547. The trigger was one session's scratch mutation script spawning direct multi-file runs for two hours on a 12-core Mac at load 50–94: 224 of 235 fixture commits sampled started `git maintenance`, and their fixtures landed directly under the top of `TMPDIR`.
- Steps 1–4 built in this session. The guard is a repo-local hook registered in `.claude/settings.json`; nothing under `plugin/` changed.
- Step 1 updated during build of #5794: the hook command sources a sh prefilter, so a Bash call the guard can never deny no longer starts node. Every deny and allow in steps 1–4 is unchanged.
- Related: `run-the-suite-alongside-sibling-sessions-3969.md` (the slot, temp root and git settings a runner-driven run gets), `verify-only-the-tests-a-change-can-affect-4024.md` (the `--files-from` subset route) and `prove-a-test-discriminates-in-a-scratch-checkout-4556.md` (single-file discrimination runs, which stay direct).
