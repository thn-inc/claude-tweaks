# Windows regression: 1 test file(s) newly failing after 8b610e3ec (#4738) Implementation Plan

**Goal:** Make `tests/bin-lib/dispatch/dispatch-resume-cli.test.js` pass on Windows. 53 of its tests fail there because the test's fake filesystem and expected values are keyed on POSIX path strings.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191429-spec-4738/work/4738-spec.md` (materialized from GitHub issue #4738)

**Cause (confirmed at build):** `plugin/bin/dispatch-resume.js` builds every lookup path with `path.join`/`path.resolve`, for example `path.join(mainRoot, '.claude-tweaks', 'pipelines')` and `path.join(archiveDir, 'run-state.json')`. On Windows those produce `\repo\.claude-tweaks\pipelines\...`. The test's fake world hard-codes forward slashes: `ROOT = '/repo/.claude-tweaks/pipelines'`, `WT = '/repo/.claude/worktrees/dispatch-record-4589'`, keys like `` `${ARCH}/run-state.json` ``, and literals at lines ~1078, 1186, 1284 and 1340. So every fake `exists`/`readFile`/`readdir` lookup misses, and every expected `line` containing a path differs. Running the file with a `path.win32` preload reproduces exactly the 53 failing tests the Windows CI run reported (run 41285107242, isolated log). That includes #4761's own-session test, absorbed from #4825. The product code is correct for Windows; the test is the defect.

---

### Task 1: Build the test's fake-world paths with the platform's own `path` module

**Files:**
- Test: `tests/bin-lib/dispatch/dispatch-resume-cli.test.js`
- Waived `plugin/bin/dispatch-resume.js`: the CLI under test. It was confirmed at build to build native paths correctly, so it is not modified.

- [ ] **Step 1: Failing test.** Run the file under the `path.win32` preload and confirm 53 failures, matching the CI set exactly. Done at plan time: `node --require <preload> --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js` gives 53 failures, the same 53 names as CI.
- [ ] **Step 2: Implement.** Derive `ROOT`, `ARCH`, `RUNDIR` and `WT` from `MAIN` with `path.join`. Replace every `` `${X}/file` `` fake-fs key and every other hard-coded `/repo/...` path with `path.join(...)` built from those constants, so the fake world and the expected strings use the same separators the CLI produces. Leave `MAIN` as given (the CLI receives it from `deps.mainRoot()` verbatim). Leave non-path text alone: git porcelain lines keep their `worktree {path}` shape, built from the joined constant. Change no assertion's meaning; this is a separator-only change.
- [ ] **Step 3: Run.** The file passes natively (`node --test tests/bin-lib/dispatch/dispatch-resume-cli.test.js`, 112/112) and under the `path.win32` preload, with 0 failures. Remove any backslash-named litter the simulated run leaves in the worktree root, and confirm `git status` is clean.
- [ ] **Step 4: Commit.** One commit, `Build dispatch-resume CLI test paths with path.join — refs #4738`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 and AC 2 are covered by Task 1, Steps 2-3.
  - AC 1 is the Windows-workflow run dispatched after the last code change, which the flow's verification owns.
  - AC 3 (`npm test`) is covered by Common Step 5.
  - Deliverable 2 (name the cause, and whether other tests share it) goes in the PR description, with the per-file simulation check from wrap-up.
- **Placeholders:** none.
