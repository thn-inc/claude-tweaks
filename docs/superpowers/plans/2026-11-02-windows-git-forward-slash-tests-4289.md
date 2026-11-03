# Windows: tests expect native paths where git prints forward-slash paths (#4289) Implementation Plan

**Goal:** Make 8 tests in 5 files stop comparing git-printed paths against native `path.join` values, so they pass on win32 with no platform branch and no production change.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T220707-record-4289/work/4289-spec.md` (materialized from GitHub issue #4289)

---

### Task 1: Derive expected paths from git's own spelling in the five test files

**Files:**
- Test: `tests/bin-lib/verify/baseline.test.js`
- Test: `tests/hooks-git-exec.test.js`
- Test: `tests/run-integrity.test.js`
- Test: `tests/teardown-gate.test.js`
- Test: `tests/tidy-residue-markers.test.js`

Line numbers below are as of `02f25d8c9`; they moved from the spec's `988cc584d` numbers. Test names are the stable identifiers. The shape to follow is `tests/bin-lib/verify/cli.test.js:3443-3451` (#4222). No `process.platform` branch anywhere.

- [ ] **Step 1: Failing test** — every target test is green on this POSIX host at base and stays green after the fix, because the failure is win32-only: `path.join` and git's spelling are identical here. No assertion can go red on this host for the win32 reason. Say so in the report. The discrimination proof is Step 3's AC2 probe, and AC3's `windows-regression.yml` dispatch is the win32 proof, which `/build`'s controller runs after this task.
- [ ] **Step 2: Implement** — each edit below replaces only the expected value:
  - `tests/hooks-git-exec.test.js`, three tests: `runGit: success returns trimmed stdout and a null failure` (line 28), `runGitAsync: success returns trimmed stdout and a null failure` (line 129), `runGit: a non-numeric or non-positive CT_HOOKS_GIT_TIMEOUT_MS falls back to DEFAULT_TIMEOUT_MS` (line 283). Replace `fs.realpathSync(dir)` with `gitRevParse(dir, '--show-toplevel')`, the helper already at line 20. Leave the `CT_HOOKS_GIT_TIMEOUT_MS` loop as it is, and line 283 only compares; do not touch any other `realpathSync` in the file.
  - `tests/bin-lib/verify/baseline.test.js`, test `realGit.listWorktrees reads real ...` (line 913): keep `all.length === 3`. Replace `all.includes(normalWt)`, `all.includes(staleWt)` and the `[staleWt]` expectation with entries taken from `all`: the one whose forward-slash spelling (`p.replace(/\\/g, '/')`) ends in `/${path.basename(normalWt)}`, and the one ending in `/${path.basename(staleParent)}/wt`. `assert.ok` each was found, then `assert.deepStrictEqual(findStaleBaselineWorktrees(() => all), [listedStale])`.
  - `tests/run-integrity.test.js`, test `worktreePathForBranch: finds the live linked worktree checked out on the given branch` (line 176): read `git worktree list --porcelain` in the test with the file's existing `execFileSync` shape (`{ cwd: root, encoding: 'utf8' }`), take the `worktree ` line whose forward-slash spelling ends in `/.claude/worktrees/feat`, `assert.ok` it was found, and compare `worktreePathForBranch(root, 'feat-branch')` with it.
  - `tests/teardown-gate.test.js`, test `AC5: a foreign-owned run warns instead of denying, and logs wd-foreign-teardown` (line 567, assertion line 586): take the expected value the same way from `git worktree list --porcelain` run in `root`, the entry ending in `/${path.basename(path.dirname(wt))}/wt`. Use the file's `fixtureGit` or `sh` helper; read its return shape at line 19 first. Compare `last.path` with that entry.
  - `tests/tidy-residue-markers.test.js`, tests `#1493 C1: ...` (line 305) and `#1494 review fix: ...` (line 344): build only the `expected` arrays (lines 334-336 and 368-370) with `path.posix.join('.claude-tweaks', 'pipelines', runId, ...)`. Keep the native `runRel`/`runDir` and the `git add` arguments.
- [ ] **Step 3: Run** — `node --test tests/bin-lib/verify/baseline.test.js tests/hooks-git-exec.test.js tests/run-integrity.test.js tests/teardown-gate.test.js tests/tidy-residue-markers.test.js`: PASS, with the same test count per file as at base (AC1). Record both counts from raw output. Then the AC2 probe, in a scratch copy of `tests/hooks-git-exec.test.js` or a scratch checkout, never committed and never an in-place edit left behind: point the expected value of the `runGit: success` test at a second `gitRepo()`, and show the test fail.
- [ ] **Step 4: Commit** — one commit, subject `Derive expected paths from git's spelling in five test files — refs #4289`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (absolute paths git printed) is the hooks-git-exec, baseline and run-integrity edits. Deliverable 2 (repo-relative IDs) is the tidy-residue-markers edit. Deliverable 3 (`wd-foreign-teardown`) is the teardown-gate edit. AC1 and AC2 are Step 3. AC3 is the `windows-regression.yml` dispatch `/build`'s controller runs on the branch.
- **Placeholders:** none.
