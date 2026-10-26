# Windows: #3064 stale-worktree test expects a native path where git prints forward slashes (#4222) Implementation Plan

**Goal:** Make the #3064 stale-worktree test in `tests/bin-lib/verify/cli.test.js` expect the stale worktree path exactly as `git worktree list --porcelain` reports it, so the test passes on Windows, where Git for Windows prints forward slashes.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T080724-spec-4222/work/4222-spec.md` (materialized from GitHub issue #4222)

---

### Task 1: Derive the #3064 test's expected worktree path from git's porcelain listing

**Files:**
- Test: `tests/bin-lib/verify/cli.test.js` (the test at line 3425, "--baseline: a stale ct-verify-base-* scratch worktree from an earlier interrupted run is named on stderr, and left alone (#3064)")

- [ ] **Step 1: Failing test.** This is a test-only change. Its RED proof is AC2: with the stderr write at `plugin/bin/verify.js:437` temporarily removed, the rewritten test must fail. Run it after Step 2.
- [ ] **Step 2: Implement.**
  - Before calling `runCli`, read `r.git('worktree', 'list', '--porcelain')`.
  - Take the `worktree <path>` entry whose last two path segments, split on either `/` or `\`, are `path.basename(staleParent)` then `wt`. That entry is `listedWt`. Assert it was found (`assert.ok(listedWt, list)`).
  - Use `listedWt` in place of `staleWt` in the `stderr.includes(...)` expected message, in both the "registered at" and the `git worktree remove --force` positions.
  - Keep `staleWt` (the native path) for `fs.existsSync`, and keep the "exactly two worktrees" assertion unchanged.
  - No `process.platform` branch.
- [ ] **Step 3: Run.**
  - `node --test tests/bin-lib/verify/cli.test.js`, with output redirected to a `.txt` file: 192 tests, 0 fail (AC1).
  - Then the AC2 go-red probe: remove the `process.stderr.write` at `plugin/bin/verify.js:437`, run `node --test --test-name-pattern="#3064\)" tests/bin-lib/verify/cli.test.js`, and see the #3064 test fail. Restore `verify.js` byte-identical and confirm `git diff --stat -- plugin/bin/verify.js` is empty.
- [ ] **Step 4: Commit.** One commit, `Derive the #3064 stale-worktree test's expected path from git's porcelain listing — Git for Windows prints forward slashes`, body `Refs #4222`, trailer `Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL`. Stage `tests/bin-lib/verify/cli.test.js` only.

AC3 (a `windows-regression.yml` dispatch on the branch showing `cli.test.js` at 0 Windows failures) is a verification step after this task, not part of it.

---

## Self-review

- **Spec coverage:** Deliverable 1 is Step 2's porcelain-derived expected path with no platform branch. Deliverable 2 is Step 2's unchanged `existsSync` and worktree-count assertions. AC1 and AC2 are covered by Step 3. AC3 is the post-task Windows dispatch.
- **Placeholders:** none.
