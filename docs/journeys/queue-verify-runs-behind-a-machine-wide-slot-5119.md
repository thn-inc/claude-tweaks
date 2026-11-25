---
files:
  - plugin/bin/lib/suite-slot.js
  - plugin/bin/lib/verify/slot.js
  - plugin/bin/lib/verify/run.js
  - plugin/bin/lib/verify/baseline.js
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/skills/test/suite-slots.md
  - plugin/skills/test/verification.md
  - .claude-tweaks/verify-scope.json
---

# Queue Verify Runs Behind a Machine-Wide Slot

**Persona:** A developer running several `/claude-tweaks:flow` or `/claude-tweaks:dispatch` sessions at once on one machine, in any project. The project's suites share something finite: one database server, one device, a port range, or simply memory. Before #5119 every session's `verify.js` started its suites, its flaky retries and its `--baseline` adjudication reruns the moment it reached them. With enough sessions, the shared resource starved and the reruns made it worse.
**Goal:** Every session still gets a trustworthy verdict, but only as many suites run at once as the project says its shared resources can take.
**Entry point:** The verification procedure (`/claude-tweaks:test`, or `/claude-tweaks:build`'s Common Step 5). It runs `verify.js` with `--default-suite-slots {slots}`, the `verify-suite-slots` policy value. Optionally the project declares `concurrency.suiteSlots` in `.claude-tweaks/verify-scope.json`.
**Success state:** At most `suiteSlots` full suites (and, separately, `suiteSlots` subset or static runs) run at once machine-wide. Each waiting run says what it waits for and how to raise the limit, then runs in the order it arrived. An interrupted run lets its test runner tear down before the slot frees. A run nested inside a held one never deadlocks.

## Steps

### 1. A session reaches verification while nothing else is running
- **URL:** the session's verification output and `report.json`.
- **Action:** The verification procedure resolves `verify-suite-slots` with `resolve-policy.js`, then runs `verify.js … --default-suite-slots {slots}`.
- **Should feel:** Unchanged on the happy path. No prompt and no extra output.
- **Should understand:**
  - The run took a slot in the **full lane**, because a local suite ran its full command. Had every local suite run an impact-subset or tool-scoped command, a declared suite listed in `subsetLaneSuites` (step 6), or only `types`/`lint`, it would have taken the **subset lane**.
  - `report.json`'s `slot` records `lane`, `index`, `waitedMs`, `slots` and `source` (`declaration`, `flag` or `default`).
  - While the slot is held, every check sees `CT_TEST_SUITE_SLOT_HELD=1` and `CT_TEST_WORKERS` (about half the cores divided across the slots). A project that wires `CT_TEST_WORKERS` into its test command caps its own workers.
- **Red flags:**
  - A run with no local check, or one whose every suite CI answered with no local retry, recording a `slot`.
  - The project's test command failing outside verify.js because it uses `$CT_TEST_WORKERS` with no default. The variable is unset outside a held slot, so every use needs one, for example `${CT_TEST_WORKERS:-4}`.

### 2. A second session reaches verification while the first holds the slot
- **URL:** the second session's stderr.
- **Action:** Nothing. The run waits on its own.
- **Should feel:** Told, not stuck. One stderr line names the lane, the holder (or the run it queues behind) by pid and cwd, and how to raise the limit.
- **Should understand:**
  - The hint names whichever knob decides the count. With a declared `concurrency.suiteSlots` it names only that, because raising the policy key would change nothing.
  - The wait counts against the Bash call's timeout. A dispatched agent's call that comes back timed out or backgrounded while this line is showing was **queued, not hung**. Set the call's timeout to the Foreground rule's ceiling.
  - A dispatched subagent whose call comes back queued does not retry or start a second attempt. It ends its unit with `STATUS: BLOCKED`, quoting the waiting line, so the dispatcher re-runs it once the slot frees.
  - Waiting runs take the slot in arrival order. A dead holder's lock is reclaimed by the next waiter.
  - Queue time is not verification time. The verify event records the run's slot waits as `slotWaitedMs`, and the verify-minutes budget subtracts them, so a run that queued behind siblings is not flagged over budget for the wait. `report.json`'s `durationMs` stays wall-clock.
- **Red flags:**
  - Two full suites running at once with one slot.
  - A dispatched subagent retrying a queued call instead of ending `STATUS: BLOCKED`.
  - A subset-lane run waiting behind a full-lane holder.
  - A nested `verify.js` or `tools/run-tests.js` inside a held run waiting at all. It should see `CT_TEST_SUITE_SLOT_HELD=1` and skip the lock.

### 3. A failing scoped run adjudicates against its base
- **URL:** `report.json`'s `baselineAdjudicated`.
- **Action:** `--baseline` reruns the failing suites at the base and at HEAD.
- **Should feel:** Like a second, separate queue position. The checks' slot is released first, then adjudication takes its own full-lane slot.
- **Should understand:**
  - Adjudication always takes the full lane, whatever lane the checks used. Its reruns and its base-side full run queue behind every other full-lane holder.
  - `baselineAdjudicated.slot` records that hold. A CI-failed suite's local retry records its own hold as `checks.{suite}.retrySlot`.
  - Adjudication queues only once a rerun will actually spawn. One refused before any rerun (no `--baseline-cmd` for a failing check, an unparseable log, no failing file present at base) takes no slot and records no `baselineAdjudicated.slot`.
  - A lock dir verify.js cannot use at this point does not exit 2. The run reads `Baseline: not adjudicated — adjudication error: suite slot unavailable — {message}`.
- **Red flags:**
  - Adjudication reruns starting while another session's full suite is running on a one-slot machine.
  - An adjudication that refuses before any rerun still waiting behind full-lane holders.

### 4. Interrupt a run that holds a slot
- **URL:** the terminal.
- **Action:** Press Ctrl-C, or send SIGTERM or SIGHUP to verify.js.
- **Should feel:** Orderly. The test runner gets the same signal and a few seconds to clean up, then verify.js exits.
- **Should understand:**
  - verify.js forwards the signal to each running check's process group and waits up to 5 seconds. It then kills whatever is still alive, frees the slot, and exits 128 + the signal number. During `--baseline` adjudication, adjudication's own handler also removes its scratch worktree, and the slot is freed only after that removal, so the next holder of that slot never finds its per-slot scratch path mid-teardown (#5150).
  - The wait ends as soon as every check's group has exited (on Linux, a group whose processes have all exited but are not yet reaped counts as exited). One stderr line marks its start: `verify.js: {SIGNAL} sent — waiting up to 5s for {n} check process group(s) to finish their teardown before killing them`.
  - A check's output, teardown output included, goes straight to its log file, never through a pipe, so a noisy teardown cannot stall during the wait.
  - While a slot is held, each check runs in its own session (its own process group, with no controlling terminal). A SIGKILL sent to verify.js's process group therefore never reaches a running check. The orphan keeps running while its slot is reclaimed as a dead holder's.
- **Red flags:**
  - A test runner's teardown (containers, temp databases, workers) not running after Ctrl-C.
  - The slot still held after verify.js has exited.
  - The slot freed while an interrupted adjudication is still removing its per-slot scratch worktree.
  - verify.js waiting the full 5 seconds after every check has already exited.

### 5. Size the slot count for the project's shared resources
- **URL:** `plugin/skills/test/suite-slots.md`.
- **Action:** Declare `{ "concurrency": { "suiteSlots": N } }` in `.claude-tweaks/verify-scope.json`, or set `verify-suite-slots: N` in `.claude-tweaks/policy.yml`.
- **Should feel:** Like describing the project, not tuning the machine. The right number depends on what the suites share, not on how many cores there are.
- **Should understand:**
  - A declared `suiteSlots` wins over the policy key, which wins over 1. The same count applies to both lanes.
  - At one slot, a 30-minute suite with 9 sessions is a queue of about 4.5 hours. Raise the count until the shared resource, not the queue, is the limit.
  - An unknown key or a non-positive `suiteSlots` fails validation. Without `--scope`, that failure prints `verify.js: concurrency ignored — {error}`, and the declaration counts as undeclared.
  - verify.js ignores `tools/run-tests.js`'s own `CT_TEST_SUITE_SLOTS`/`CT_TEST_SUBSET_SLOTS`.
  - A lock dir verify.js cannot use exits 2 with `verify.js: suite slot unavailable — {message}`, never exit 1 (which reads as "checks failed").
  - When another user owns the lock dir (a shared `/tmp` on a multi-user host), the message also names the way out: set `CT_TEST_SUITE_SLOT_DIR` to a directory this user owns.
- **Red flags:**
  - Raising the count to make waits disappear while the shared resource is what the waits protected.

### 6. Keep a small declared suite out of the full lane
- **URL:** `.claude-tweaks/verify-scope.json`; `report.json`'s `slot.lane`.
- **Action:** List the small declared suite at the top level: `"subsetLaneSuites": ["journeys"]`. Then run the scoped verification on a change that selects it, for example one whose `tests` suite CI answers.
- **Should feel:** A one-second suite runs in about a second, not after minutes in the full-lane queue behind other projects' whole-suite runs.
- **Should understand:**
  - A listed suite running its declaration's own command does not count toward the full lane. A run whose only full-command local suites are listed takes the subset lane, and `slot.lane` says `subset`.
  - The exclusion is per suite. An unlisted declared suite in the same run still takes the full lane, and so does a `--cmd` under a listed name, because that command is the caller's, not the declaration's.
  - The key is an array of declared suite names. It can never name `impact.suite`, whose full command is the whole-suite run the full lane exists for. Each other mistake (not an array of strings, an undeclared suite, a repeated name) fails validation with its own error starting `subsetLaneSuites:`.
  - The key is top level, not in `concurrency`: a reader older than the key ignores it and keeps today's lane, so committing it never breaks a run in flight on the previous release.
- **Red flags:**
  - A CI-answered run whose only local suite is listed still waiting for a full-lane slot.
  - A listed suite beside an unlisted declared suite taking the subset lane.
  - Listing a large suite to dodge the queue: the list is the project vouching that each suite is small.

## Origin
- Created during build of #5119. A consumer project's parallel sessions starved a shared database server: every session's suites and baseline reruns ran at once, and timeouts amplified the reruns.
- Updated after #5119's review fixes: adjudication queues only once a rerun will spawn, the signal grace ends early and announces itself, slot waits no longer count toward the verify-minutes budget, a queued dispatched subagent ends `STATUS: BLOCKED`, and an other-user lock dir names `CT_TEST_SUITE_SLOT_DIR`.
- Step 4 extended by #5150: on a signal during adjudication the slot is freed only after the per-slot scratch is removed (`holdSlot` releases in-handler only as the last signal listener). The same `concurrency` block also takes `reruns` and `timeoutPatterns`, walked in `run-a-deterministic-verification-check.md` Step 11.
- Step 6 added during build of #5368: CI-answered runs waited 447 to 954 s in the full lane to run the one-second `journeys` suite, so a declaration can now list small suites under `subsetLaneSuites`.
- Related: `run-the-suite-alongside-sibling-sessions-3969.md` (the same lock as `tools/run-tests.js` holds it in this repo) and `run-parallel-pipelines-without-per-task-full-suites-5117.md` (fewer full-suite runs per pipeline, the other half of the load problem).
