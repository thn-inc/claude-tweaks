## Review: #4725 — Windows regression: hooks-gate-coverage.test.js (draft PR #6203, branch drive-record-4725 @ 29071fce7d)

**Review effort:** low (derived from record labels: risk:low × size:low; diff heuristic agrees: 1 test file, 1+/1−, no merge-sensitive paths; no `review-effort-floor` set). Moot: the Step 1 gate blocked before any lens was dispatched.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. `tests/hooks-gate-coverage.test.js` passes on Windows | done, **but not by this PR.** #5694 (`e3f947486d`, merged 2026-11-16, already in this branch's base) changed this exact assertion's expected value to `[path.resolve('/main'), '/r']`. Main's latest Windows run, 45372736400 at `88cdbe82`, does not list `tests/hooks-gate-coverage.test.js` in `verify-report.json`'s `baselineAdjudicated.failingFiles` (16 other files are listed). The record's Gotcha ("check that the failure still reproduces on current `main` before building") was not acted on. |
| 2. The cause is named in the PR, including whether other tests share it | **missing.** The PR body names a cause the code does not support: "'gitTargets' resolves base-view readings natively (git-command.js:1287), so on Windows that dir becomes 'D:\r'". Line 1287 runs only when a walk lost its cwd (`segments.some((s) => s.lost)`). `case x in a\|x) cd /main;; esac; git commit -m x` never loses its cwd, so `/r` is an ordinary known segment and is returned raw. Under a `path.win32` preload, `gitTargets(...)` returns `[{"dir":"D:\\main"},{"dir":"/r"}]`, with no `lost` or `reading` flag on either. The original ab2f50978 failure was the opposite of the PR's story: the test expected `path.resolve('/r')` (`D:\r`), but the code returned raw `/r`. The body also says "I didn't search the other tests for the same hard-coded '/r' pattern", so the other-tests half is unanswered. |

| Acceptance Criterion | Status |
|---------------------|--------|
| 1. Passes in the Windows workflow on the fixing branch, proven by a run dispatched after the last code change | **not met.** `gh run list --workflow windows-regression.yml --branch drive-record-4725` returns `[]`. No Windows run exists for this branch. |
| 2. The same file still passes on Linux and macOS | met. PR CI `test` shards 1-4 are green on Linux. A local macOS run of `node --test tests/hooks-gate-coverage.test.js` gave tests 941, pass 941, fail 0. |
| 3. `npm test` passes | met. `verify.js --stamp-status` reports `verifiedHead: true` (a scoped run at `29071fce7d`, anchored on full-pass `fullSha 15af9f65f8`), and the PR CI full suite is green. |

| Risk marker | Status |
|-------------|--------|
| Gotcha: "Check that the failure still reproduces on current `main` before building" | verified against ground truth, and the answer is **no**. It stopped reproducing once #5694 landed. Two pieces of evidence: under a `path.win32` preload, main's version of the test passes (1/1), and main's real Windows run 45372736400 does not list the file as failing. |

**Current-State outcome reach:** partial. The Windows failure the record names was already fixed on main by #5694 before this branch was cut, so this diff fixes nothing that was still broken.

### Gap analysis (why BLOCKED)

Both Critical findings from the driver's whole-branch review are **confirmed**:

1. **The cause the PR names does not match the code path.** See Deliverable 2. `pathImpl.resolve` at `plugin/bin/lib/hooks/git-command.js:1287` applies only to base-view readings of a walk that lost its cwd, and this command never loses its cwd.
2. **No Windows run proves the fix.** See AC1. A Windows run of this branch would also prove nothing about the record, because main already passes this file on Windows without the change.

A third issue comes from the same evidence. **The change weakens the assertion (test quality, high).** The new line maps the *actual* dirs through `path.resolve`:

```js
gitTargets(...).map((t) => path.resolve(t.dir))  // vs [path.resolve('/main'), path.resolve('/r')]
```

That masks the exact Windows bug class this #4303 test guards: a raw POSIX `/main` returned where a resolved `D:\main` is required (the #4303 lost-cwd root defect). A win32 check shows it. With a regressed actual of `["/main","/r"]`, the PR's assertion **passes** (`true`) and main's #5694 assertion **fails** (`false`). The change also deletes #5694's deliberately pinned contract, "the cd target is resolved, the base cwd is not." Merging it would replace a discriminating test with one that cannot fail on the Windows path defect it exists to catch.

**Remedy:** no code fix to this branch is correct. The record is already satisfied on main by #5694, and the branch's only change is a regression in test strength. The right resolution is to close PR #6203 unmerged and close #4725 as fixed by #5694 (`e3f947486d`). Both are human decisions, and both are outside what this review may do.

### Verification (from /test)
- Type check: n/a (no type-check configured for this test file)
- Lint: pass (PR CI)
- Tests: pass. Runner stamp `verifiedHead: true`, PR CI 4/4 shards green, and the target file locally gave 941/941.

### QA Validation (from /test)
- **Status:** Skipped — no stories (backend-only record, `Surface: backend`)

### Code Review Findings (confirmed)
Not run. The Step 1 gate is BLOCKED, so Steps 1.6-6.7 are skipped per `code-mode-steps.md` ("If blocked, skip the rest of the review"). The findings above come from the Step 1 gap analysis, with the evidence cited inline. They did not go through lens or tiebreak routing.

### Implementation Hindsight
Not run (blocked at Step 1). The approach was wrong at its root: the build started without the reproduce-first check the record's Gotcha required, and that check would have shown the failure was already gone.

### Tradeoffs Accepted
No tradeoffs.

### Visual Review
- **Status:** Skipped — no UI changes (`Surface: backend`, test-only diff)

### Code Simplification
- Not run (blocked at Step 1)

### Skill Load Delta
Not run (blocked at Step 1)

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | Close PR #6203 unmerged. Its change weakens the #4303 assertion, and #5694 already fixed the failure. | GitHub PR #6203 |
| 2 | Close #4725 as already fixed by #5694 (`e3f947486d`, verified on Windows run 45372736400), and clear its `bot:in-progress` claim. | GitHub issue #4725 |

### Verdict
**BLOCKED.** The cause named in the PR body is wrong, no Windows run exists for this branch, and the change makes the assertion weaker. The record is already fixed on main by #5694.

No fixes were applied and nothing was committed or pushed. No PR verdict comment was posted: this was a standalone review with no `$PIPELINE_RUN_DIR`.

### Key Learnings
1. The driver built a Windows-regression record without running the record's own "does it still reproduce on main" Gotcha. #5694 had fixed the same assertion eight days earlier. A filed Windows-regression record needs a mechanical still-failing check (the file's presence in main's latest `windows-regression` `failingFiles`) before build, not just a Gotcha line.
2. Wrapping the *actual* side of a path assertion in `path.resolve` hides the raw-POSIX-string defect class that Windows path tests exist to catch. Normalize only the expected side, or pin the raw value deliberately as #5694 did.
3. A green express-lane build with an unverified, plausible-sounding cause shows why the whole-branch review's two Criticals were right to stop it: the stated cause was checkable against line 1287's `lost` guard in one call.

### Next Actions
**`gh pr close 6203 --comment "Superseded: #5694 (e3f947486d) already fixed this assertion; this change would weaken it."`**: close the PR unmerged (recommended; human decision)
**`gh issue close 4725 --comment "Fixed by #5694 (e3f947486d); Windows run 45372736400 no longer lists tests/hooks-gate-coverage.test.js as failing."`**: close the record as already fixed (recommended; human decision)
`/claude-tweaks:build 4725`: the template's default for a BLOCKED review. Not recommended here, because there is nothing left to build.
