---
files:
  - tools/run-tests.js
  - tests/run-tests-isolation.test.js
  - plugin/bin/lib/deps.js
  - docs/plugin-structure.md
---

# Run the Suite Alongside Sibling Sessions

**Persona:** A claude-tweaks maintainer with several Claude sessions open on this repo. Each session's pipeline runs `npm test` through `plugin/bin/verify.js`, and the maintainer also runs it by hand.
**Goal:** Every session gets a trustworthy suite result without the machine becoming unusable or `$TMPDIR` filling with leaked fixtures.
**Entry point:** `npm test` (`node tools/run-tests.js`), run directly or as a `verify.js --cmd tests="npm test"` check.
**Success state:** One full suite runs at a time machine-wide, at about half the cores. Any other run says plainly that it is waiting and for whom, then runs. Each run's temp files live under one per-run directory that is gone when the run ends, whether by exit, Ctrl-C, or a kill.

## Steps

### 1. Start a run while no other suite is running
- **URL:** the terminal or the verify.js check log.
- **Action:** Run `npm test`.
- **Should feel:** Like before, just slower to saturate the machine. No new prompts and no new output on the happy path.
- **Should understand:**
  - The run holds a lock in `<tmpdir>/ct-test-suite-slots/` for its duration.
  - Its tests see `TMPDIR` pointing at `<tmpdir>/ct-test-runs/ct-testrun-<pid>-XXXXXX/`.
  - `node --test` runs with `--test-concurrency` set to half the cores, or cores minus 1 when `CI` is set.
- **Red flags:**
  - New `ct-wtd-*`, `verify-cli-test-*` and similar fixture dirs appearing directly in the real tmpdir after the run. They should exist only inside the run's own root.

### 2. Start a second run while one is already running
- **URL:** the second session's output.
- **Action:** Run `npm test` again from another session or terminal.
- **Should feel:** Told, not stuck. One line explains the wait.
- **Should understand:** The line reads `run-tests.js: waiting for a test-suite slot — held by pid N (cwd …) since …; set CT_TEST_SUITE_SLOTS to raise the limit`, followed by the lock path. The run starts on its own once the holder finishes. A `verify.js --cmd-timeout` counts the wait against its bound.
- **Red flags:**
  - Two full suites running at once with the default settings.
  - A wait that never ends while the named pid is gone. A holder already dead when the run starts loses its lock at once; one that dies mid-wait loses it on the next 2-second poll.

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
  - Nested runs (a test that itself spawns `run-tests.js`) skip the slot via `CT_TEST_SUITE_SLOT_HELD=1`, so they never deadlock on the parent's lock.
  - The suite's own slot tests still pass with a raised knob. Their sandboxed runner children start without `CT_TEST_SUITE_SLOTS` or `CT_TEST_SUBSET_SLOTS`, so they always measure the default of one slot.
- **Red flags:**
  - Raising `CT_TEST_SUITE_SLOTS` globally to make waits go away, when the waits were protecting the machine.
  - A suite run with `CT_TEST_SUITE_SLOTS=2` failing `run-tests.js waits for a slot held by a live pid` with a 60-second timeout — the knob leaked into the test's sandboxed child.

### 5. Start a Claude session (plugin user)
- **URL:** any project with claude-tweaks installed.
- **Action:** Open a session; the SessionStart hook runs.
- **Should feel:** Instant. Session start no longer pauses to launch `npx` to look for `playwright-cli`.
- **Should understand:**
  - The check looks for `playwright-cli` in `<cwd>/node_modules/.bin` and on PATH, with PATHEXT on Windows.
  - When it is absent, the same optional install hint appears.
- **Red flags:**
  - The install hint appearing even though `playwright-cli` is on PATH.
  - Session start still spawning `npm exec playwright-cli --version`.

## Origin
- Created during build of #3969. The trigger was a Mac made unusable by stacked concurrent suites (load average 98–176 on 12 cores) and about 3.9 million leaked fixture entries in `$TMPDIR`.
- Updated during build of #4336: step 4 now covers the slot tests passing under a raised slot knob.
- Related: `act-on-a-red-wall-clock-budget-scan-3491.md` (another constraint on tests that run under load).
