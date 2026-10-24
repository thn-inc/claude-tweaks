---
files:
  - plugin/bin/verify.js
  - plugin/bin/lib/verify/impact.js
  - plugin/bin/lib/verify/scope.js
  - plugin/bin/lib/verify/declaration.js
  - tools/test-impact.js
  - tools/test-impact/tracer.js
  - tools/test-impact/build-map.js
  - tools/run-tests.js
  - .claude-tweaks/verify-scope.json
  - .github/workflows/test-impact-map.yml
---

# Verify Only the Tests a Change Can Affect

**Persona:** A claude-tweaks maintainer whose pipeline runs re-verify a two-line skill-prose edit. Until now each re-verify paid an eight-minute full `npm test` run, queued behind sibling sessions for the single suite slot.
**Goal:** A scoped verify runs only the test files that actually read what the branch changed. Whenever that answer can't be trusted, it runs the whole suite and says why.
**Entry point:** `node plugin/bin/verify.js --run "$PIPELINE_RUN_DIR" --scope .claude-tweaks/verify-scope.json --integration-branch main --cmd tests="npm test"`. This is the scoped invocation every pipeline re-verify site already runs.
**Success state:** A docs-only or skill-prose delta finishes in seconds. Stdout shows one `Impact:` line naming the selected count and the map's commit, and `report.json`'s `scope.impact` lists exactly which test files ran. A missing, stale, red or non-ancestor map, or a path no traced read covers, runs the full suite with the reason named.

## Steps

### 1. Get a map without tracing locally
- **URL:** `.github/workflows/test-impact-map.yml`'s post-merge run on main, and `{git-common-dir}/claude-tweaks-test-impact.json`.
- **Action:** Do nothing. When the scoped run finds no usable map, it runs the declaration's `fetch` command (`node tools/test-impact.js fetch`) once. That downloads the newest successful main map whose commit is an ancestor of HEAD. `node tools/test-impact.js trace` builds one by hand: it runs the full suite under the read tracer.
- **Should feel:** Invisible. The map refreshes off the hot path, and no build ever traces.
- **Should understand:**
  - The map is stamped with its commit and the traced run's exit code.
  - Every worktree of the checkout shares one map under the git common dir.
  - A map from a red suite is never served, and neither is a map built by a pull-request run: only `push` and dispatch runs on main count.
  - The map is read only when selection needs it. A delta that no impact rule matches never reads the map or runs `fetch`.
- **Red flags:**
  - A build step that starts a traced full-suite run.
  - A fetch that replaces the cache with a map whose commit is not an ancestor of HEAD.

### 2. Re-verify a skill-prose edit
- **URL:** the verify output, and `{git-dir}/claude-tweaks-verify/report.json`.
- **Action:** Edit a skill file, commit it, and let the pipeline's scoped re-verify run.
- **Should feel:** Fast and accountable. The output reads `Impact: N of M test file(s) selected (map abc123def, K commit(s) old)` and the run ends in seconds rather than minutes.
- **Should understand:**
  - The run selects the tests that read the edited file. It also selects the tests whose recorded `git` call covers the repo, and every test file the map has never seen.
  - The stamp it writes is `scoped`: `verifiedHead` is true and `match` is false. The next gate does not re-run the suite, and CI's full suite stays the merge gate.
- **Red flags:**
  - An `Impact:` line selecting 0 tests for a path that a test reads.
  - A scoped run that writes a `full` stamp.

### 3. Add a file, or change a test
- **URL:** the same report's `scope.impact.selectedFiles`.
- **Action:** Add `plugin/skills/new-skill/SKILL.md`, or edit a test file.
- **Should feel:** Like the right tests woke up. The corpus-sweeping tests, which list `plugin/skills/`, are selected for the new file, and the meta-tests that read every test file are selected for the test edit.
- **Should understand:** A directory listing matches only an added or deleted path beneath it, because modifying a file does not change a listing. A probe of an ancestor directory also matches an add or a delete.
- **Red flags:**
  - A new file under a listed directory selecting only the tests that read it directly.
  - A changed test file running alone, without the guard tests that read it.

### 4. Hit a fallback
- **URL:** the verify stdout and `scope.impact.fallback`.
- **Action:** Verify on a branch that has drifted far behind, from a checkout with no map, or after changing a path no test reads.
- **Should feel:** Safe, not mysterious. The output reads `Impact: full tests — {reason}`, for example `map-missing`, `map-stale: 240 commits > 200`, `map-not-ancestor` or `untraced-path: docs/new.md`.
- **Should understand:**
  - An unknown never selects fewer tests.
  - Changing `tools/run-tests.js` or the tracer always runs the whole suite through its own `"suites": "*"` rule.
  - Standalone `/claude-tweaks:test` and a standalone `/build` stay full.
- **Red flags:**
  - A fallback with no named reason.
  - A subset run while the map's traced suite was red.

## Origin
- Created during the build of #4024. A 14-day transcript analysis found verify and `npm test` consumed about 78 hours of tool time, roughly a quarter of dispatch-agent wall time. #3968, a two-line markdown change, still paid a 476-second full run.
- Related: `declare-a-verify-scope-1924.md` (the declaration this extends) and `run-the-suite-alongside-sibling-sessions-3969.md` (the suite slot a subset run holds for less time).
