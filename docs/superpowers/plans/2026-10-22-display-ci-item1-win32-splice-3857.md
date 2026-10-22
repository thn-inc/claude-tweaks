# Windows regression: 1 test file(s) newly failing after 8da6efddc (#3857) Implementation Plan

**Goal:** The display CI-reader conformance test's item 1 script splice (`$PR_SCAN_OPEN`) forward-slashes its temp path through `toPosix`, the same way item 9's `$PR_SCAN_UNARMED_CANDIDATES` splice already does (#3699), so the test passes on a Windows checkout.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220207-record-3857/spec-3857/work/3857-spec.md` (materialized from GitHub issue #3857)

---

### Task 1: Route the item 1 `$PR_SCAN_OPEN` splice through `toPosix` and pin it with a win32 simulation

**Files:**
- Modify: `tests/display-ci-readers-conformance.test.js`
- Read-only: `plugin/bin/lib/shared-primitives.js` (`toPosix(path, sep)` reused, not modified)

- [ ] **Step 1: Failing test** — add an item-1 counterpart to the existing `#3699 AC1.1` test (line 231): splice `path.win32.join('D:\\a\\_temp', 'ct-display-ci-x', 'open-prs.json')` into the item 1 script (`nodeEScripts(repoWideItem1Slice())[0]`) with `path.win32.sep`, through the same substitution helper the item 1 behavioral test (line 181) uses, and assert the spliced literals (`spliceLiterals`) contain `D:/a/_temp/ct-display-ci-x/open-prs.json` and no literal contains a backslash. Before Step 2 the helper does not exist / the splice is raw, so this fails.
- [ ] **Step 2: Implement** — generalize `substituteCandidates` (lines 83-89) into one substitution helper that takes the placeholder name (e.g. `substitutePath(script, placeholder, file, sep = path.sep)`, keeping the function-replacement form so `$&`/`$'`/`` $` `` in a path are never expanded, and every `toPosix` conversion), migrate the item 9 call sites (line 121, line 233) to it, and replace line 209's raw `scripts[0].replace(/\$PR_SCAN_OPEN/g, prsFile)` with the helper. Afterwards no `.replace(/\$PR_SCAN_…/g, …)` in the file splices an unconverted path. Do not escape backslashes instead of forward-slashing (spec Gotchas).
- [ ] **Step 3: Run** `node --test tests/display-ci-readers-conformance.test.js` — PASS (all tests, including the new one). Prove the new test discriminates: temporarily make the helper splice the raw path (no `toPosix`) and confirm the new test fails, then restore.
- [ ] **Step 4: Commit** — one commit, `Fix item 1 win32 temp-path splice in display CI-reader test — route $PR_SCAN_OPEN through toPosix, refs #3857`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (toPosix splice, shared helper) → Step 2; Deliverable 2 (item-1 win32 simulation test) → Step 1. AC1 (no unconverted splice) → Step 2; AC2 (win32 literal forward-slashed, fails on revert) → Steps 1 and 3; AC3 (green on Linux/macOS) → Step 3; AC4 (next post-merge Windows check) is post-merge evidence, not buildable here.
- **Placeholders:** none.
