# Windows regression: 1 test file(s) newly failing after 5fe0d5329 (#3509) Implementation Plan

**Goal:** Make `tests/specify-crossref-manifest-resolve.test.js` pass on `windows-latest` by handing the bash fences a forward-slash `CLAUDE_PLUGIN_ROOT`, and make its go-red control prove the cross-reference fence (not the init/accumulate fence) is the one that failed.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T100244-record-3507/spec-3509/work/3509-spec.md` (materialized from GitHub issue #3509)

---

### Task 1: Forward-slash plugin root for the fences + step-named go-red control

**Files:**
- Modify: `tests/specify-crossref-manifest-resolve.test.js`
- Test: `tests/specify-crossref-manifest-resolve.test.js`

- [ ] **Step 1: Failing test** — tighten the go-red control (test 3) so its regex anchors on the cross-reference step's name (e.g. `/cross-reference fence exited 1: [\s\S]*ENOENT/`). Against the current unlabeled `fence exited 1:` message it fails.
- [ ] **Step 2: Implement** — (a) pass `CLAUDE_PLUGIN_ROOT` to the fences with forward slashes: either define `PLUGIN_ROOT` at line 15 as `path.join(REPO_ROOT, 'plugin').split(path.sep).join('/')` (as `tests/backlog-refine-foldin-no-truncation.test.js:26` does) or keep line 15 native and normalize only the env value at line 51 — with a one-line comment naming the JS-string-literal reason, as `tests/dispatch-not-spec-shaped-exclusion-fixture.test.js:67-68` does; (b) thread a step label through `run`/`expectOk` in `assertCrossrefFenceRunsStandalone` so each failure message names its step (`init fence exited …`, `accumulate fence exited …`, `cross-reference fence exited …`). Do not change any file under `plugin/`. Keep the string-pin test (test 1) as it is.
- [ ] **Step 3: Run** `node --test tests/specify-crossref-manifest-resolve.test.js` — PASS, all three tests run, none skipped. Discrimination checks (each restored in the same command, never left modified): (AC3) run the control with the **init** fence's `SPECIFY_DECOMP_MANIFEST=$(…)` assignment stripped instead of the cross-reference fence's — the control must go red because the failure names the init step; (AC4) delete the `SPECIFY_DECOMP_MANIFEST=$(...)` assignment from the cross-reference fence in `plugin/skills/specify/record-creation-subissues.md` — test 2 must go red; restore the file.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3509`.

---

## Self-review

- **Spec coverage:** Deliverables 1 (forward-slash root + comment) and 2 (step-named failures, cross-reference-anchored go-red) and ACs 1, 3, 4, 5 are Task 1's Steps; AC 2 (`windows-latest` proof via `gh workflow run windows-regression.yml --ref {branch}`) runs after the commit is pushed; AC 6 (`npm test`) is `/build` Common Step 5. Gotcha: `tests/specify-ceremony-tally-prose.test.js`'s same unnormalized root stays out of this PR — checked for an existing record during the build, captured if none.
- **Placeholders:** none.
