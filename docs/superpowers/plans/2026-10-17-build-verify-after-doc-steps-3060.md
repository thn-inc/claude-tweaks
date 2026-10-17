# Build Verify After Doc Steps (#3060) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/claude-tweaks:build`'s Common Step 5 (Final Verification) the last tree change before `/test`, by running Common Steps 6 (journeys) and 6.5 (docs sync) before it.

**Architecture:** Prose reorder inside `plugin/skills/build/SKILL.md` — step numbers are kept, the `### Common Step 6` and `### Common Step 6.5` sections physically move to sit between Common Step 4.5 and Common Step 5, order-bearing lead-ins are reworded, and a new `node --test` conformance suite pins the order.

**Tech Stack:** Markdown skill prose; `node --test` (built-in runner).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T212522-record-3060/work/3060-spec.md`

Scope keywords: Common Step 6, Common Step 6.5, After verification passes

## Global Constraints

- Step numbers stay unchanged (5, 5.5, 6, 6.5, 7) — external citations and test literals depend on them.
- Resulting file order: 4.5 → 6 → 6.5 → 5 → 5.5 → 7.
- Step 5.5 keeps "After verification passes" (still true).
- Size: `build/SKILL.md` stays under `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`), enforced by `tests/bin-lib/skill-audit/context-cost.test.js`. Premise correction: the spec's `CEILING_BYTES` 46,080 B was decommissioned by #3311; the file is already 46,492 B before this change.
- No new step is added; the Step 5 fix-guidance addition is one clause.

## Review Focus

1. A heading renamed later (e.g. `### Common Step 6:` reworded) — the order test must fail loudly (index `-1`), never pass vacuously. Covered by the `> -1` assertions in Task 1.
2. Section slicing bleeding into the next section — Step 6's "does not contain" check must slice only up to the next `### ` heading, so Step 5.5's legitimate "After verification passes" never counts. Covered by the slice helper in Task 1.
3. Prose elsewhere in `build/SKILL.md` that still implies verification precedes journeys (Workflow diagram, Steps 3 + 4.5 paragraph). Covered by Task 1 Step 3's order note and Step 6's sweep.
4. Existing pins on the moved text (`tests/build-skip-degrade-trace-adoption.test.js`'s Step 6.5 skip sentence) — moved bytes must be unchanged. Covered by Task 1 Step 5.
5. Size rail breach from the added note/clause. Covered by Task 1 Step 5 (`context-cost.test.js`).

Moved-prose pin discovery (run during authoring): `git grep -n -F` over `tests plugin` for "After verification passes", "After code simplification", "Common Steps 1-7", "the journeys skill documents it", "condition: no `docs/REGISTRY.md`" returned no hits outside `build/SKILL.md` except `plugin/skills/build/docs-sync.md:1`'s own title (no test reads its position). Position-independent pins: `tests/build-skip-degrade-trace-adoption.test.js:68-69`, `tests/test-skill-affected-conformance.test.js:49`, `tests/ceremony-profile-roster.test.js:52`.

Plan-audit Check B (scope-keyword sweep) hits, reviewed and needing no edit — each cites a step by number or carries a `Common Step 6.5 (skipped)` fixture literal, none states an order between Steps 5 and 6/6.5: `docs/getting-started.md`, `plugin/skills/build/docs-sync.md`, `plugin/skills/flow/SKILL.md`, `plugin/skills/journeys/SKILL.md`, `tests/bin-lib/flow/pr-body-premise-reversal.test.js`, `tests/bin-lib/log-decision/append.test.js`, `tests/bin-lib/log-decision/cli.test.js`, `tests/wrap-up-console-fast-path-scanned-exclusion.test.js`, `docs/superpowers/plans/2026-10-17-verify-scope-journeys-3337.md` (closed #3337's plan — the verify-scope alternative).

---

### Task 1: Reorder Common Steps 6/6.5 ahead of Step 5 and pin the order

**Files:**
- Create: `tests/build-verify-after-doc-steps.test.js`
- Modify: `plugin/skills/build/SKILL.md` (Workflow diagram ~:59; sections `### Common Step 5` through `### Common Step 6.5` ~:266-294)
- Test: `tests/build-skip-degrade-trace-adoption.test.js`, `tests/ceremony-profile-roster.test.js`, `tests/test-skill-affected-conformance.test.js`, `tests/build-common-step7-bookkeeping-assertion.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** `tests/build-verify-after-doc-steps.test.js` — reads `plugin/skills/build/SKILL.md`; helper `section(heading)` returns the text from `heading`'s index up to the next `\n### ` (or EOF). Tests:
  - `AC1.1: Common Step headings appear in execution order 4.5 < 6 < 6.5 < 5 < 5.5 < 7` — indices of `'### Common Step 4.5'`, `'### Common Step 6:'`, `'### Common Step 6.5:'`, `'### Common Step 5:'`, `'### Common Step 5.5:'`, `'### Common Step 7:'`; assert each `> -1` and strictly increasing.
  - `AC1.2: Common Step 6 section does not contain "After verification passes"` — `assert.ok(!section('### Common Step 6:').includes('After verification passes'))`.
  - `AC1.3: Common Step 5 section names Common Steps 6 and 6.5` — `assert.match(section('### Common Step 5:'), /Common Steps 6 and 6\.5/)`.

- [ ] **Step 2: Run test to verify it fails (AC2.1)**

Run: `node --test tests/build-verify-after-doc-steps.test.js`
Expected: FAIL — all three of AC1.1, AC1.2, AC1.3 red against the unedited file (byte-identical to `origin/main`'s).

- [ ] **Step 3: Edit `plugin/skills/build/SKILL.md`**
  - Cut the `### Common Step 6: User Journey Capture` and `### Common Step 6.5: Documentation Sync` sections (heading through the line before `### Common Step 7`) and paste them, bytes unchanged, immediately before `### Common Step 5: Final Verification`.
  - Step 6 lead-in: replace `After verification passes, run` with `After simplification and alignment (Common Steps 3 + 4.5), run`.
  - Step 5 lead-in: replace `After code simplification, run the shared verification procedure` with `After Common Steps 6 and 6.5, so the verified tree is the final one (journeys and synced docs included), run the shared verification procedure`.
  - Step 5 fix guidance: append to the sentence `If anything fails, fix it and commit the fix.` the clause ` If a fix changes behavior, re-check any journey or doc Common Steps 6/6.5 wrote that the fix now contradicts.`
  - Workflow diagram: on the line after the closing fence of the Workflow code block, add `Common Steps run in file order: 6 and 6.5 precede 5, so the final verification covers journeys and synced docs.`
  - Step 5.5 keeps `After verification passes` unchanged.
  - Added at the final whole-branch review (Common Step 4.5 Beneficial deviation, commit c570bcd6b): the intro (:9) now lists "capture the journeys it enables, and verify it"; the Steps 3 + 4.5 paragraph ends "Common Steps 6 and 6.5, then Common Step 5 (Final Verification), follow once both are done."; the Step 5 re-check clause says "before re-running verification".

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/build-verify-after-doc-steps.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run existing pins and the size rail (AC3.1, AC4.1 — re-read as RAIL_BYTES per the premise correction)**

Run: `node --test tests/build-skip-degrade-trace-adoption.test.js tests/ceremony-profile-roster.test.js tests/test-skill-affected-conformance.test.js tests/build-common-step7-bookkeeping-assertion.test.js tests/working-approach-scope-discipline.test.js tests/cherry-pick-provenance-prose-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, 0 failures. Also `wc -c plugin/skills/build/SKILL.md` < 52500.

- [ ] **Step 6: Citation sweep (Deliverable 4)**

Run: `git grep -nE "Common Steps? (5|6)|Step 6\.5" -- plugin/skills docs/skill-graph.md`
Expected: no hit outside `build/SKILL.md` states journeys or docs sync run after verification (authoring-time run confirmed this; `docs/skill-graph.md` needs no change — state that in the PR body).

- [ ] **Step 7: Commit**

```bash
git add tests/build-verify-after-doc-steps.test.js plugin/skills/build/SKILL.md
git commit -m "Run build's journeys and docs sync before final verification — refs #3060"
```

Then the full suite (`npm test`, AC5.1) runs centrally at Common Step 5.
