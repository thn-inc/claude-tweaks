# Impact-map drift refresh Implementation Plan (#5947)

**Goal:** `loadImpactContext` runs the declared `impact.fetch` once when a usable map's drift-selected test files exceed a threshold, so scoped verify stops re-running ~75% drift. The 200-commit `maxAgeCommits` limit stays the backstop.

**Architecture:** In `plugin/bin/lib/verify/impact.js`, after the map has no problem and drift is listed, if `drift.length > DRIFT_REFRESH_TESTS` (50) and `decl.impact.fetch` and `runFetch` exist, no fetch ran yet in this load, and no refresh attempt marker younger than `REFRESH_WINDOW_MS` (10 min) exists in the shared git common dir: write the marker, run the fetch once, and on exit 0 re-read the map; adopt the reloaded state only if it has no problem and its drift is readable and no larger. Any other outcome keeps the prior map and drift (the pre-fetch state is held in memory). REST only: the fetch command is unchanged.

**Scope keywords:** DRIFT_REFRESH_TESTS, REFRESH_WINDOW_MS, refresh-attempt

### Task 1: Drift-triggered refresh in loadImpactContext

**Files:**
- Modify: `plugin/bin/lib/verify/impact.js`
- Create: `tests/bin-lib/verify/impact-refresh.test.js`

- [ ] **Step 1: Write the failing tests** (a new file, with its own small git/fs fakes mirroring `impact.test.js`'s, the fs fake adding `statSync`/`writeFileSync`). Covers the ACs: a drift above the threshold triggers exactly one `runFetch` call and the reloaded map's drift is what selection uses; drift at or below the threshold triggers no fetch; a marker present within the window blocks the fetch and an expired one allows it; a failing fetch (non-zero exit, timeout) falls back to the original map and drift with no second attempt in the window; the existing stale path is unchanged and still fetches regardless of the marker. Plan lines (before/after counts reported in the PR) are a PR-description task, not code: high drift triggers exactly one fetch and adopts the reloaded smaller-drift map; drift at or below threshold never fetches; a marker younger than the window blocks the fetch, an older one allows it; failed fetch (exit 3, or timed out) keeps the original map and drift and writes the marker; a reloaded map with a problem or larger drift is not adopted; a hard-stale map still fetches regardless of the marker; no `fetch` command or no `runFetch` never fetches.
- [ ] **Step 2: Run, confirm failing**
Run: `node tools/run-tests.js tests/bin-lib/verify/impact-refresh.test.js`
Expected: FAIL
- [ ] **Step 3: Implement** as in the Architecture paragraph.
- [ ] **Step 4: Run, confirm passing**
Run: `node tools/run-tests.js tests/bin-lib/verify/impact-refresh.test.js`
Expected: PASS
- [ ] **Step 5: Commit**

### Task 2: Document the trigger

**Files:**
- Modify: `plugin/skills/test/impact-selection.md`
- Modify: `docs/plugin-structure.md` (its impact.js entry's loadImpactContext clause)

- [ ] **Step 1:** Add a paragraph after the drift paragraph in "The map" Selection section stating the trigger, window, marker and fallback; reword `maxAgeCommits`'s "most commits a map may trail" row only if it now misleads.
- [ ] **Step 2: Run the skill-prose and size conformance tests**
Run: `node tools/run-tests.js tests/bin-lib/skill-audit`
Expected: PASS
- [ ] **Step 3: Commit**
