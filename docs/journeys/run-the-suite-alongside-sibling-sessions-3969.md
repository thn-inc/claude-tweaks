---
files:
  - tools/run-tests.js
  - plugin/bin/lib/suite-slot.js
  - tests/run-tests-isolation.test.js
  - plugin/bin/lib/deps.js
  - tests/helpers/git-template.js
  - tests/helpers/git-fixtures.js
  - docs/plugin-structure.md
---

# Run the Suite Alongside Sibling Sessions

**Persona:** A claude-tweaks maintainer with several Claude sessions open on this repo. Each session's pipeline runs `npm test` through `plugin/bin/verify.js`, and the maintainer also runs it by hand.
**Goal:** Every session gets a trustworthy suite result without the machine becoming unusable or `$TMPDIR` filling with leaked fixtures.
**Entry point:** `npm test -- --full` (`node tools/run-tests.js --full`), run directly, or as a `verify.js --cmd tests="npm test"` check. A plain `npm test` typed at the top level now runs only the impact-selected subset (`run-a-plain-npm-test-on-the-impact-subset-5319.md`). It takes the same slot as described below, from the subset lane instead of the whole-suite lane.
**Success state:** One full suite runs at a time machine-wide, at about half the cores. Any other run says plainly that it is waiting and for whom, then runs in the order it arrived. Each run's temp files live under one per-run directory that is gone when the run ends, whether by exit, Ctrl-C, or a kill.

## Steps

### 1. Start a run while no other suite is running
- **URL:** the terminal or the verify.js check log.
- **Action:** Run `npm test -- --full`.
- **Should feel:** Like before, just slower to saturate the machine. No new prompts and no new output on the happy path.
- **Should understand:**
  - A plain `npm test` with no arguments prints its one impact-selection line first and runs only the selected files. The slot, the per-run temp directory and the concurrency below are unchanged. Only the lane differs: a subset takes the subset lane (`CT_TEST_SUBSET_SLOTS`), so it does not queue behind a sibling's whole-suite run, and a run with nothing selected takes no slot.
  - Test files named on the command line (`node tools/run-tests.js tests/a.test.js tests/b.test.js`) run as an explicit subset from the subset lane too, with the same temp directory, git settings and concurrency (`run-several-test-files-through-the-runner-5547.md`).
  - The run holds a lock in `<tmpdir>/ct-test-suite-slots/` for its duration.
  - Its tests see `TMPDIR` pointing at `<tmpdir>/ct-test-runs/ct-testrun-<pid>-XXXXXX/`.
  - `node --test` runs with `--test-concurrency` set to half the cores, or cores minus 1 when `CI` is set.
  - Its tests' git sees `maintenance.auto=false` and `gc.auto=0`, appended as `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` after any `GIT_CONFIG_COUNT` entries the caller already exported.
  - Its tests' hooks see `CT_HOOKS_REPO_INFO_STORE` pointing at `repo-info-cache.json` inside that same run root, so fixture repos never land in the user's real `~/.claude-tweaks/repo-info-cache.json`. A bare `node --test` run of a suite that loads `tests/helpers/git-template.js` gets a fresh temp store instead, when the variable is unset.
  - Its tests never see the developer's factory policy layer: the runner drops `CLAUDE_TWEAKS_FACTORY_POLICY` and points `CT_FACTORY_POLICY_FILE` at a path inside the run root that never exists, so `~/.claude-tweaks/factory-policy.yml` is not read (#6006).
  - The common fixture repos are built once per test process and copied per test (`tests/helpers/git-template.js`), so a copy starts no git process.
  - Env config does not reach the receiving side of a local push (git's local transport strips `GIT_CONFIG_*`), so the runner also exports `GIT_TEMPLATE_DIR` pointing at a template in the run root. Every repo a test creates with `git init` or `git clone`, a bare origin included, carries `maintenance.auto=false`, `gc.auto=0` and `receive.autogc=false` in its own config, and `git-receive-pack` starts no maintenance.
  - That template ships an empty `hooks/` (no `*.sample` files) and keeps `info/` and `description`, so an init copies no sample hooks. A bare `node --test` run of a suite that loads `tests/helpers/git-template.js` builds the same template for itself at load, one `git init`, unless it is a runner child that already has one.
  - Fixture repos write their committer identity straight into `.git/config` (`initRepo` / `writeIdentity` in `tests/helpers/git-fixtures.js`), so no fixture spends a `git config user.name`/`user.email` process; `tests/fixture-identity-config-scan.test.js` fails on a new one outside its allowlist.
- **Red flags:**
  - New `ct-wtd-*`, `verify-cli-test-*` and similar fixture dirs appearing directly in the real tmpdir after the run. They should exist only inside the run's own root.
  - `git maintenance run --auto` processes showing up under the run in a process capture. Check first for a test that builds its repos with `GIT_TEMPLATE_DIR` dropped or overridden in its env, so they miss the runner's template keys.
  - Temp fixture directories appearing as entries in the real `~/.claude-tweaks/repo-info-cache.json` after a runner-driven run.

### 2. Start a second run while one is already running
- **URL:** the second session's output.
- **Action:** Run `npm test -- --full` again from another session or terminal.
- **Should feel:** Told, not stuck. One line explains the wait.
- **Should understand:**
  - When it is first in line, the line reads `run-tests.js: waiting for a test-suite slot — held by pid N (cwd …) since …; set CT_TEST_SUITE_SLOTS to raise the limit`, followed by the lock path.
  - When an earlier run is already waiting, it reads `… — queued behind pid N (cwd …) since …; set CT_TEST_SUITE_SLOTS to raise the limit`, followed by that run's ticket path (`ticket-<n>.json` in the slot directory).
  - Waiting runs take the slot in the order they arrived, never by whichever polls first. A run with a higher `CT_TEST_SUITE_SLOTS` limit may still take a slot that the runs ahead of it are not allowed to use.
  - The run starts on its own once its turn comes. A `verify.js --cmd-timeout` counts the wait against its bound.
- **Red flags:**
  - Two full suites running at once with the default settings.
  - A run that started later taking the slot ahead of one already waiting.
  - A wait that never ends while the named pid is gone. A holder or queued run already dead when the run starts loses its place at once; one that dies mid-wait loses it on the next 2-second poll. A ticket whose pid was reused by another process, or whose run is stopped (not dead), blocks the queue until someone deletes the ticket file the line names.

### 3. Stop a run early
- **URL:** the terminal, or a CI cancel or `timeout` wrapper.
- **Action:** Press Ctrl-C, or send SIGTERM or SIGHUP to the runner pid.
- **Should feel:** Prompt. The runner forwards the signal to `node --test`, which stops its workers, and the runner exits with 128+signal.
- **Should understand:**
  - The run root and the slot lock are removed on the way out.
  - A run killed with SIGKILL leaves both behind. The next run's stale-pid sweep reclaims them.
- **Red flags:**
  - A runner that keeps the slot after being told to stop.
  - Orphaned `node --test` workers still running after the runner exits.

### 4. Tune the limits for an unusual machine
- **URL:** `docs/plugin-structure.md`'s `tools/` and `npm test` entries.
- **Action:** Set `CT_TEST_SUITE_SLOTS=2` to let two suites run together, or `CT_TEST_CONCURRENCY=N` to choose the worker count.
- **Should feel:** Like an override, not a requirement. The defaults are meant for a shared developer machine.
- **Should understand:**
  - An invalid `CT_TEST_SUITE_SLOTS` falls back to 1 and prints one line naming it.
  - For one run only, pass `--test-concurrency=<n>` (a positive integer) on the runner's command line, as in `npm test -- --full --test-concurrency=4`. It replaces the computed worker count for that run and wins over `CT_TEST_CONCURRENCY`; a value that is not a positive integer exits 1 with one `run-tests.js:` line.
  - Nested runs (a test that itself spawns `run-tests.js`) skip the slot via `CT_TEST_SUITE_SLOT_HELD=1`, so they never deadlock on the parent's lock. A bare nested run, and a bare `npm test` that `verify.js` spawns, also run the whole set and never consult the impact map, because a child does what its parent asked.
  - Under a pipeline, `verify.js` now takes the slot itself and runs `npm test` with `CT_TEST_SUITE_SLOT_HELD=1`, so that child skips the lock. An exported `CT_TEST_SUITE_SLOTS` then governs only direct `npm test` runs. verify.js's own count comes from `concurrency.suiteSlots` or the `verify-suite-slots` policy key (`queue-verify-runs-behind-a-machine-wide-slot-5119.md`).
  - The suite's own slot tests still pass with a raised knob. Their sandboxed runner children start without `CT_TEST_SUITE_SLOTS` or `CT_TEST_SUBSET_SLOTS`, so they always measure the default of one slot.
- **Red flags:**
  - Raising `CT_TEST_SUITE_SLOTS` globally to make waits go away, when the waits were protecting the machine.
  - A suite run with `CT_TEST_SUITE_SLOTS=2` failing `run-tests.js waits for a slot held by a live pid` with a 60-second timeout — the knob leaked into the test's sandboxed child.

### 5. Start a Claude session (plugin user)
- **URL:** any project with claude-tweaks installed.
- **Action:** Open a session; the SessionStart hook runs.
- **Should feel:** Instant. Session start no longer pauses to launch `npx` to look for `playwright-cli`, or a shell to run `git --version`.
- **Should understand:**
  - The check looks for `playwright-cli` in `<cwd>/node_modules/.bin` and on PATH, with PATHEXT on Windows.
  - When it is absent, the same optional install hint appears.
  - The git check is a PATH scan too. On macOS, `/usr/bin/git` is the xcode-select shim, so it counts only when the active developer dir holds `usr/bin/git`. The check follows xcode-select's order without spawning: `DEVELOPER_DIR`, then the `/var/db/xcode_select_link` target, then `/Applications/Xcode.app`, then the Command Line Tools. A Mac with only the shim still gets the "git not found" hint.
- **Red flags:**
  - The install hint appearing even though `playwright-cli` is on PATH.
  - Session start still spawning `npm exec playwright-cli --version` or `sh -c git --version`.
  - A Mac with working git (Xcode or the Command Line Tools) told git is missing.

## Origin
- Created during build of #3969. The trigger was a Mac made unusable by stacked concurrent suites (load average 98–176 on 12 cores) and about 3.9 million leaked fixture entries in `$TMPDIR`.
- Updated during build of #4336: step 4 now covers the slot tests passing under a raised slot knob.
- Updated during build of #4333: step 2 now covers arrival-order waiting and the queued form of the wait line. A waiter stopped with Ctrl-C leaves only its ticket, and the next waiter removes it once the pid is gone. A `run-tests.js` checkout older than this change ignores tickets and can still jump the queue until it catches up.
- Updated during build of #5119: the lock moved into `plugin/bin/lib/suite-slot.js`, shared with `verify.js`. Step 4 now covers a verify.js-driven `npm test` skipping the lock, with verify.js's own slot count governing instead of `CT_TEST_SUITE_SLOTS`.
- Updated during build of #5297: step 1 now covers git auto-maintenance turned off for the suite and template-copied fixture repos. Step 5 covers the spawn-free git check and its macOS shim rule. The trigger was one run spawning 1,300–2,100 processes per second.
- Updated during build of #5319: a plain top-level `npm test` now runs the impact-selected subset from the subset lane. The entry point and steps 1 and 2 name `npm test -- --full` for the whole-suite run these steps describe, and step 4 says a bare child of `verify.js` or of another run also runs the whole set.
- Updated during build of #5294: step 1 now covers the hooks' repoInfo store pointed into the run root, so a suite run never writes fixture answers into the user's real store.
- Updated during build of #5547: step 1 now covers test files named on the runner's command line, which a repo-local guard steers multi-file direct runs to.
- Updated at wrap-up of #5547: step 4 now covers a per-run `--test-concurrency=<n>` on the runner's command line.
- Updated during build of #5768: step 1 now covers the runner's per-run git template (`GIT_TEMPLATE_DIR`), which carries the maintenance-off keys and `receive.autogc=false` into every repo a test creates. Step 1's maintenance red flag now points at a test that drops or overrides the template. A traced full run went from 759 maintenance processes to 0.
- Updated during build of #5771: step 1 now covers the sample-free runner template, the same template for a bare `node --test` run, and fixture identities written without a `git config` process.
- Related: `act-on-a-red-wall-clock-budget-scan-3491.md` (another constraint on tests that run under load).
