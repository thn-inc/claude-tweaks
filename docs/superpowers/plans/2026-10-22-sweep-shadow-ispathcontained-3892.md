# Route sweep-shadow's run-dir containment check through isPathContained (#3892) Implementation Plan

**Goal:** `plugin/bin/lib/hooks/sweep-shadow.js` decides run-dir containment with a hand-rolled `runDir.startsWith(rootWithSep)` guard that the path-containment conformance scan cannot see; route it through `isPathContained` and widen the scan so a `startsWith(<variable built from path.sep>)` containment test is flagged.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T140850-record-3892/work/3892-spec.md` (materialized from GitHub issue #3892)

**Scope note (scope-creep `add-to-plan`):** a pre-plan grep found a second variable-mediated copy of the same idiom the widened scan will flag — `plugin/bin/lib/timing/transcript.js:52` builds `projectsResolved = path.resolve(projects) + path.sep` and line 66 tests `path.resolve(p).startsWith(projectsResolved)`. The widened scan's real-tree assertion cannot pass while it remains, so it is migrated in this same task. Two maintainer-side skill files state the sweep-shadow copy is still outstanding ("tracked separately" / "tracked as a follow-up record"); their parentheticals are updated to the as-built state.

---

### Task 1: Migrate both variable-mediated containment guards to isPathContained and widen the scan

**Files:**
- Test: `tests/path-containment-conformance.test.js`
- Modify: `plugin/bin/lib/hooks/sweep-shadow.js`
- Modify: `plugin/bin/lib/timing/transcript.js`
- Modify: `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` (line 20's "`hooks/sweep-shadow.js` still carries one pre-#3498 `startsWith(rootWithSep)` copy … tracked separately" parenthetical)
- Modify: `.claude/skills/bin-source-scan-conformance/SKILL.md` (line 60's paragraph — "the copy is tracked as a follow-up record" — and the line 16 overview bullet, to name the variable-mediated form the scan now also flags)

- [ ] **Step 1: Failing test** — in `tests/path-containment-conformance.test.js`, add a matcher (e.g. `scanVariableHandRolled(src, rel)`) over the comment-stripped text (`stripComments`, already imported) that (a) collects every identifier bound to an expression containing `path.sep` — `const`/`let`/`var` declarations and plain reassignments, including a ternary RHS (`root.endsWith(path.sep) ? root : root + path.sep`), a concatenation (`path.resolve(p) + path.sep`) and a template literal (`` `${root}${path.sep}` ``) — and (b) flags each line with `.startsWith(<that identifier>)`. Grep `plugin/bin` for each syntactic variant before finalizing the matcher (`.claude/skills/bin-source-scan-conformance/SKILL.md`'s "Match every call shape" section), and plant one self-test line per variant. Add:
  - a self-test asserting exact flagged `file:line` IDs for each planted variant, plus negative cases: the idiom inside a comment, a variable built from `path.sep` used only with `indexOf`/`split` (e.g. `worktree-detect.js`'s `WORKTREE_ADMIN_MARKER`), and `startsWith(x)` where `x` was not built from `path.sep`;
  - a planted go-red test (the `#3642 AC3.1` shape) feeding the **old** sweep-shadow guard verbatim — `const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;` then `if (!runDir.startsWith(rootWithSep)) {` — and asserting the scan flags the `startsWith` line (AC: "The widened scan fails when the old `rootWithSep` guard is restored");
  - a real-tree assertion over `listJs(BIN_ROOT)` with the per-file `stripperVerdict === 'ok'` check the existing AC1.1 test uses, asserting zero hits.
  Run `node --test tests/path-containment-conformance.test.js` — Expected: FAIL (the real-tree assertion flags `plugin/bin/lib/hooks/sweep-shadow.js:115` and `plugin/bin/lib/timing/transcript.js:66`).
- [ ] **Step 2: Implement** —
  - `sweep-shadow.js`: `require('../shared-primitives')` for `isPathContained`; replace lines 113-119 with `if (!isPathContained(runDir, root)) { …same diagnostic line… }` and `const rel = path.relative(root, runDir);`. Keep the strict (root-excluded) semantics — no `orEqual`. Keep the existing diagnostic wording byte-identical.
  - `transcript.js`: drop `projectsResolved`; replace line 66's guard with `if (!isPathContained(path.resolve(p), path.resolve(projects))) return;` (strict — the old `+ path.sep` prefix excluded the root itself). Keep the explanatory comment above `push` accurate.
  - Update the two skill-file parentheticals to the as-built state (no copy outstanding; the scan now flags the variable-mediated form). Keep `tests/path-containment-conformance.test.js`'s AC3.1 assertions on `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md` passing (the bullet must still start `- **A containment check` and still name `isAncestorOrSelf`).
  - Update the header comment of `tests/path-containment-conformance.test.js` to say the scan also flags the variable-mediated form.
- [ ] **Step 3: Run** — `node --test tests/path-containment-conformance.test.js tests/bin-lib/hooks/sweep-shadow.test.js tests/bin-lib/hooks/sweep-shadow-claim-concurrency.test.js tests/bin-lib/timing/transcript.test.js tests/path-guard-conformance.test.js` — PASS, with `tests/bin-lib/hooks/sweep-shadow.test.js` unmodified. Then prove discrimination: restore the old sweep-shadow guard in a scratch copy (never in this shared tree — `git show HEAD~:plugin/bin/lib/hooks/sweep-shadow.js` into a scratch `git worktree add`, or rely on the planted go-red test) and confirm the widened scan goes red.
- [ ] **Step 4: Commit** — one commit, `Route sweep-shadow's run-dir containment check through isPathContained — widen the path-containment scan to the variable-mediated form`, body `refs #3892`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (sweep-shadow guard → `isPathContained`, `rel` via `path.relative`) — Step 2. Deliverable 2 (widen `HAND_ROLLED` or add a sibling scan for `startsWith(<variable built from path.sep>)`) — Step 1. AC 1 (`sweep-shadow.test.js` passes unmodified) — Step 3. AC 2 (widened scan fails when the old guard is restored) — Step 1's planted go-red test plus Step 3's discrimination check.
- **Placeholders:** none.
