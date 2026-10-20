# verify.js stamps the HEAD it reads after the checks finish, so a mid-run commit gets a pass it never had (#3757) Implementation Plan

**Goal:** `plugin/bin/verify.js` reads `const git = gitInfo()` only after `runChecks` returns, so the pass stamp names whatever HEAD exists when the checks finish — not the commit the checks ran against.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T173132-record-3757/work/3757-spec.md` (materialized from GitHub issue #3757)

---

### Task 1: Snapshot HEAD before the checks run and refuse a moved-HEAD stamp

**Files:**
- Modify: `plugin/bin/verify.js`
- Test: `tests/bin-lib/verify/cli.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/verify/cli.test.js`, add a case (reusing the file's existing fixture-repo helpers, the way the `--stamp-status` / `#1921` cases do) whose fake check command (`--cmd tests="..."`) makes a commit inside the fixture repo while the run is in flight. Assert: the written stamp's `sha` (and `fullSha`) is NOT the new HEAD; `--stamp-status` afterwards reports `verifiedHead: false` (and `match: false`); the runner's stdout names that the tree moved during the run. Run: `node --test tests/bin-lib/verify/cli.test.js` — Expected: FAIL (today the stamp names the post-commit HEAD and `--stamp-status` reports `verifiedHead: true`).
- [ ] **Step 2: Implement** — in `plugin/bin/verify.js`:
  - Take one `gitInfo()` snapshot (sha + dirty) **before** `runChecks` — and before the `--scope` changed-file selection, so the selected file set, the checks, and the stamp all describe the same commit. Every place that names "the commit this run verified" reads that start snapshot: the report passed to `composeReport` (`git`), the count-stamp `sha`, the verify event's `sha`, the `unchangedHeadNoop` comparison, the stamp-write gate's `git.sha`, and `fullSha` for a full run.
  - After the checks finish (where `const git = gitInfo()` sits today), read HEAD + dirty again. If the sha differs from the start snapshot, or the dirty flag differs, the tree moved: write **no** pass stamp (neither the JSON stamp nor the legacy bare-SHA twin), and print one stdout line saying the tree moved during the run (start sha → end sha, short form) so no stamp was written. The run's exit code and report verdict are unchanged — this only withholds the stamp.
  - With HEAD and dirty unchanged across the run, the stamp is byte-identical in shape to today's (same fields, same values).
- [ ] **Step 3: Run** `node --test tests/bin-lib/verify/cli.test.js` and `node --test tests/bin-lib/verify/` — PASS (the new case and every existing stamp test, unchanged).
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3757`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (snapshot before `runChecks`, used for every field naming the verified commit) → Step 2 bullet 1. Deliverable 2 (moved HEAD/tree → no full-pass stamp for the new HEAD + one stdout line) → Step 2 bullet 2. AC1 (cli.test.js case committing inside the fixture repo; stamp does not name the new HEAD; `--stamp-status` reports `verifiedHead: false`) → Step 1. AC2 (unchanged HEAD stamps exactly as today; existing stamp tests pass unchanged) → Step 2 bullet 3 + Step 3.
- **Placeholders:** none.
