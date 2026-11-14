---
files:
  - tools/run-tests.js
  - .claude-tweaks/verify-scope.json
  - plugin/bin/lib/verify/scope.js
  - plugin/bin/lib/verify/impact.js
  - tests/run-tests-default-run.test.js
---

# Run a Plain `npm test` on the Impact Subset

**Persona:** A claude-tweaks maintainer, or an agent working in this repo, who has just changed a skill file or a `plugin/bin` module and types `npm test` to see whether it broke anything. The suite holds more than 1,100 test files, and a full local run queues behind sibling sessions for the machine's suite slot.
**Goal:** Get a fast, relevant local answer without running every test file, and know the one command that runs the whole suite.
**Entry point:** `npm test` (`node tools/run-tests.js`) typed with no arguments, in a checkout that has changes since its merge-base with `origin/main`.
**Success state:** The run prints one stderr line naming how many test files it selected and for which base commit, runs only those files, and exits with their result. When the selection cannot be trusted, the run says why and runs the whole suite instead. `npm test -- --full` runs the whole suite on request, and CI runs it on every PR.

## Steps

### 1. Type `npm test` after a change
- **URL:** the terminal.
- **Action:** Edit a file, then run `npm test` with no arguments. `CI` is unset or empty, and the run is not a child of `verify.js` or of another test run.
- **Should feel:** Proportionate. A skill-prose edit finishes in seconds, and the first stderr line says it ran a subset: ``run-tests.js: impact-selected {k} of {n} test files for changes since {base9} — `npm test -- --full` runs the whole suite here; CI runs it on every PR``.
- **Should understand:**
  - The selection covers every change since the checkout's merge-base with `origin/main`: committed, staged, unstaged and untracked. `{base9}` is the first nine characters of that merge-base.
  - It uses the same selection code as `verify.js --scope`, so a plain run and a scoped verify pick the same files for the same changes (`verify-only-the-tests-a-change-can-affect-4024.md`).
  - The subset takes the subset slot lane, so it does not queue behind a sibling's whole-suite run (`run-the-suite-alongside-sibling-sessions-3969.md`).
  - `tests/run-tests-default-run.test.js` pins this line, the nothing-selected line and the whole-suite line in steps 2 and 3.
  - The exit code is the selected files' result. A green subset says the tests that read your change pass. It does not say the whole suite passes.
- **Red flags:**
  - A plain run that prints no selection line.
  - A run that selects a test that reads nothing you changed, or misses one that reads a file you changed.
  - A subset run that reads as a whole-suite pass in a report or a commit message.

### 2. Change something no test reads
- **URL:** the terminal.
- **Action:** Edit only a file that no test file reads and that the declaration maps to no suite, such as a pipeline ledger file matching `docs/plans/*-ledger.md`. Run `npm test`.
- **Should feel:** Instant and unambiguous. One stderr line, ``run-tests.js: no test file selected for changes since {base9} — nothing to run; `npm test -- --full` runs the whole suite here``, then exit 0.
- **Should understand:**
  - Nothing was run. The selection happens before the run takes a slot, so this case never queues behind a sibling.
  - Exit 0 here means "no test reads this change", which is a different claim from "the suite passed".
- **Red flags:**
  - A silent exit 0 with no line.
  - A run that waits for a suite slot before it says nothing was selected.

### 3. Hit the whole-suite fallback
- **URL:** the terminal.
- **Action:** Run `npm test` with no usable test-impact map in the checkout, or after changing `tools/run-tests.js`, or after changing a path that no impact rule covers.
- **Should feel:** Safe, not mysterious. The run says plainly that it is running everything and why: `run-tests.js: running the whole suite — impact selection could not narrow it: {reason}`. When it first has to download a map, it prints `run-tests.js: fetching the test-impact map (up to 120 s)` before that.
- **Should understand:**
  - The reasons are the ones the scoped verify names: no map, a stale map, a changed path no impact rule covers, a whole-suite rule such as a change to `tools/run-tests.js`, no merge-base, or any error while selecting.
  - An error while selecting only widens the run. It never throws and never produces a smaller run than the map justified.
  - This run is a whole-suite run, so it takes the whole-suite slot lane and may wait behind a sibling's run, with the wait line described in `run-the-suite-alongside-sibling-sessions-3969.md`.
- **Red flags:**
  - A fallback with no stated reason.
  - A failure to select that ends in a smaller run or in an exception instead of the whole suite.
  - A map fetch that runs without the `fetching the test-impact map` line, or that runs longer than its 120-second bound.

### 4. Ask for the whole suite
- **URL:** the terminal, and the PR's checks.
- **Action:** Run `npm test -- --full`, for example before pushing a change to a shared helper that you want proven locally.
- **Should feel:** Like the old `npm test`: the whole suite, with no selection line and no map read.
- **Should understand:**
  - `--full` runs every test file here. So do `--shard i/n` and `--record-durations`, and so does any run where `CI` is set to a non-empty value.
  - `--full` together with `--files-from` is refused, because a list already names its files.
  - CI runs the whole suite on every PR, and that run is what catches a test the map failed to select. A green local subset is a fast check, and CI stays the merge gate.
  - A failure CI reports in a file your plain run did not select reproduces with `npm test -- --full` or `node --test {file}`.
- **Red flags:**
  - `--full` printing an `impact-selected` line.
  - A plain `npm test` presented as the proof that the suite is green.
  - `--full` accepted together with `--files-from`.

### 5. See which other suites the change selects
- **URL:** the terminal.
- **Action:** Change a file under `docs/journeys/` together with a file a test reads, then run `npm test`.
- **Should feel:** Honest about what it skipped. The subset line, or the nothing-selected line, ends with ``— also selected: journeys (not run here; `node plugin/bin/verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main` runs them)``.
- **Should understand:**
  - `.claude-tweaks/verify-scope.json` declares more than one suite. In this repo the `journeys` suite reads the live journey tree, and `docs/journeys/**` selects it.
  - A plain `npm test` runs only the `tests` suite. The named `verify.js` command runs every selected suite.
- **Red flags:**
  - A journey edit that selects the `journeys` suite and says nothing about it.
  - The also-selected hint naming a command that does not run the suite.

### 6. Run `npm test` from a pipeline or from a test
- **URL:** a `verify.js --cmd tests="npm test"` check log, or a test that spawns `run-tests.js`.
- **Action:** Let `verify.js` run its `tests` check, or run a test that itself runs `tools/run-tests.js` with no arguments.
- **Should feel:** Unsurprising. The child does what its parent asked: it runs the whole set, prints no selection line, and does not read the map.
- **Should understand:**
  - A run is a child when `CT_TEST_SUITE_SLOT_HELD=1` is set, which `verify.js` and every `run-tests.js` run set for what they spawn. Only a top-level plain run selects.
  - `verify.js` makes its own selection for a scoped run and passes the chosen files with `--files-from`. For a full run it passes the declared command, which `.claude-tweaks/verify-scope.json` now spells `node tools/run-tests.js --full`.
  - The test-impact tracer and the Windows regression workflow also pass `--full`, so neither traces or verifies a subset.
- **Red flags:**
  - A `verify.js` check that runs a smaller set than the one it selected.
  - A nested run that consults the map, or that tries to take the slot its parent already holds.

## Origin
- Created during build of #5319. A plain `npm test` had always run every test file, so a skill-prose edit paid a whole-suite run and a wait for the suite slot, while `verify.js --scope` already knew which files could be affected. The build gave the plain run the same selection, with the whole suite one flag away and on every PR.
- Related: `verify-only-the-tests-a-change-can-affect-4024.md` (the selection this run reuses) and `run-the-suite-alongside-sibling-sessions-3969.md` (the slot lanes the subset and the whole suite take).
