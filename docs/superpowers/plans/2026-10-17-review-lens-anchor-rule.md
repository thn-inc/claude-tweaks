# Review Lens Anchor Rule — One Anchor for Weak-Assertion Findings (#3398) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/claude-tweaks:review`'s lens-agent anchor rule put a weak or non-discriminating test finding on exactly one anchor (the production line), so both agents of a reproduction pair report the same `path`.

**Architecture:** Prose-only change to the two restatements of the rule in `plugin/skills/review/step3-lens-dispatch.md`: the dispatch-prompt paragraph (line 78) and lens 3f's bullet (line 228). Move "an existing test whose assertions cannot catch the regression it guards" (weak/missing assertion, non-discriminating fixture) into the production-line list, narrow the test-line list to construction defects (refactor-coupled, polluting shared state), and add one tie-break: a finding that fits both readings is a coverage gap. Extend the existing #3049 conformance suite to pin the two lists as disjoint in both restatements.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite (built-in `node:test` + `node:assert/strict`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183851-record-3398/work/3398-spec.md` (materialized from GitHub issue #3398)

## Global Constraints

- The rule stays outside the byte-identical `CALIBRATION (required):` block (`tests/code-health-misc/criteria-fragments.test.js` byte-pins that block; `tests/review-coverage-anchor-conformance.test.js` asserts the rule text is absent from it).
- Every existing assertion in `tests/review-coverage-anchor-conformance.test.js` (#3049) must keep passing unchanged. The new wording below is shaped to satisfy them: in the dispatch paragraph, sentence 1 must not contain the word "defect", and the test-quality sentence must not contain "production line". In the 3f bullet, everything after the single `;` / `when it's a` split must not contain "production line" or "code … under test".
- `step3-lens-dispatch.md` is 44,920 B against the shared 51,200 B skill-file ceiling (no file-specific or per-skill `review` pin exists: `git grep step3-lens-dispatch -- tests` near `byteLength`/`CEILING` finds only the Calibration byte-identity and the review-dispatch composed bundle, which does not include this file). The change adds about 450 B, which leaves about 5.8 KB of headroom.
- Commit message style: `{Verb} {what} — {detail}`, body `refs #3398` (never `closes`/`fixes`).

## Review Focus

- A future edit re-adds "non-discriminating" (or "weak") to the test-line list. The disjointness test must go red. Covered by Task 1's go-red control.
- The two restatements drift apart: one says production line for the weak-assertion case and the other doesn't. Covered by the per-restatement loop in `assertDisjointAnchorRule`.
- A finding phrased as "this test is non-discriminating", the exact #3351 shape. The production-line list names `non-discriminating` verbatim, so an agent matching on the word lands on the production line.
- A vacuity finding ("this test cannot fail") fits "cannot catch the regression it guards", so it also anchors at the production line. No separate test: the lens 3f vacuity downgrade keys on substance and `{path}:{line}` without naming a file, so it is unaffected. Stated here so a reviewer doesn't read it as an omission.
- Slicing anchors silently widen if an end anchor is missing. The existing `between()` helper asserts both anchors resolve; reuse it.

---

### Task 1: Disjoint anchor lists in both restatements, pinned by the #3049 suite

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:78` (dispatch-prompt paragraph)
- Modify: `plugin/skills/review/step3-lens-dispatch.md:228` (lens 3f bullet)
- Test: `tests/review-coverage-anchor-conformance.test.js` (append; reuse its `read` and `between` helpers)

**Interfaces:**
- Consumes: `read(...p)` and `between(text, startAnchor, endAnchor)` already defined at the top of `tests/review-coverage-anchor-conformance.test.js`.
- Produces: `anchorLists(d)` → `{ dispatch: {production, test, whole}, lens3f: {production, test, whole} }`, and `assertDisjointAnchorRule(d)` (throws on violation). Both are local to the test file.

- [ ] **Step 1: Write the failing tests** (append to `tests/review-coverage-anchor-conformance.test.js`)

`anchorLists(d)` slices, using `between()`:
- `dispatch.whole` = `between(d, '> **Coverage findings anchor at the code under test.**', '> **Scratch path')`; `dispatch.production` = `between(whole, 'when reporting a coverage gap', 'never at the test file itself')`; `dispatch.test` = `between(whole, 'When reporting a test-quality defect', 'anchor that finding at the test line')`.
- `lens3f.whole` = the single line of `between(d, '### 3f: Test Quality', '### 3g:')` matching `/\*\*Coverage findings anchor at the code under test:\*\*/` (assert it exists); `lens3f.production` = `between(whole, 'When a finding is a coverage gap', 'anchor it at the production line')`; `lens3f.test` = `between(whole, "when it's a test-quality defect", 'anchor at the test line')`.

`assertDisjointAnchorRule(d)`: for each of the two restatements:
- each of `PRODUCTION_LINE_TERMS = [/weak/i, /assertion/i, /non-discriminating/i, /cannot catch the regression/i]` matches `production` and does NOT match `test`;
- each of `TEST_LINE_TERMS = [/refactor-coupled/i, /polluting/i]` matches `test` and does NOT match `production`;
- `whole` matches `/a finding that fits both readings is a coverage gap/i`.
Every assertion message names the restatement (`dispatch` / `lens3f`) and the term.

Tests:
```js
test('AC1.1 AC1.2 AC2.1: the production-line and test-line anchor lists share no term, in both restatements', () => {
  assertDisjointAnchorRule(read('review', 'step3-lens-dispatch.md'));
});

test('AC1.2 AC2.1: a weak-assertion finding names one anchor — the production line — in the dispatch prompt and lens 3f alike', () => {
  const { dispatch, lens3f } = anchorLists(read('review', 'step3-lens-dispatch.md'));
  for (const [name, r] of [['dispatch', dispatch], ['lens3f', lens3f]]) {
    assert.match(r.production, /an existing test whose assertions cannot catch the regression it guards/i, `${name}: weak-assertion case must sit in the production-line list`);
    assert.doesNotMatch(r.test, /assertion|weak|non-discriminating/i, `${name}: weak-assertion case must not sit in the test-line list`);
  }
});

test('go-red control: re-adding non-discriminating to the test-line list fails the disjointness check', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const mutated = d.replace('a test that is refactor-coupled or polluting shared state', 'a test that is refactor-coupled, non-discriminating, or polluting shared state');
  assert.notEqual(mutated, d, 'mutation anchor not found — the control would be vacuous');
  assert.throws(() => assertDisjointAnchorRule(mutated));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/review-coverage-anchor-conformance.test.js`
Expected: FAIL — the three new tests fail (the current text has no `cannot catch the regression` phrase and lists `non-discriminating` on the test-line side; the go-red control fails on `mutation anchor not found`). The five existing #3049 tests pass.

- [ ] **Step 3: Rewrite the two restatements in `plugin/skills/review/step3-lens-dispatch.md`**

Replace line 78 in full with this exact text (one line):

```
> **Coverage findings anchor at the code under test.** Tell each dispatched agent explicitly: when reporting a coverage gap — a missing test, a missing case, or an existing test whose assertions cannot catch the regression it guards (a weak or missing assertion, a non-discriminating fixture) — anchor the finding at the production line the test should pin, never at the test file itself. When reporting a test-quality defect — a flaw in how the test is built that holds whatever it catches: a test that is refactor-coupled or polluting shared state — anchor that finding at the test line. A finding that fits both readings is a coverage gap and anchors at the production line, so both agents of a reproduction pair report the same `path` and `categorise-reproduction` can pair them. This rule goes in the dispatch prompt alongside the scope and the `Path:Line` instruction, outside the byte-identical Calibration/Output-template block below.
```

Replace line 228 in full with this exact text (one line):

```
- **Coverage findings anchor at the code under test:** When a finding is a coverage gap (missing test, missing case, or an existing test whose assertions cannot catch the regression it guards: a weak or missing assertion, a non-discriminating fixture), anchor it at the production line under test — a finding that fits both readings is a coverage gap; when it's a test-quality defect that holds whatever the test catches (refactor-coupled, or polluting shared state), anchor at the test line.
```

No other line in the file changes. Line 224's Discrimination diagnostic keeps its own "non-discriminating" wording. It describes the check, not an anchor list, and under the new rule its findings anchor at the production line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-coverage-anchor-conformance.test.js`
Expected: PASS — all 8 tests (5 existing #3049 + 3 new).

Also run the neighbouring suites that read this file:
Run: `node --test tests/code-health-misc/criteria-fragments.test.js tests/review-lens-no-suites-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/review-dispatch-composition.test.js tests/multi-agent-coordination.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md tests/review-coverage-anchor-conformance.test.js
git commit -m "Unify review lens anchor rule — weak-assertion findings anchor at the production line in both restatements

refs #3398"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (unambiguous rule, single anchor for weak assertion, non-discriminating removed from the test-line list) → Step 3, line 78. Deliverable 2 (same wording in lens 3f's bullet) → Step 3, line 228. AC1 (exactly one anchor, no shared term, weak assertion names one anchor) → tests 1–2. AC2 (conformance test pins disjoint lists and the same anchor in both restatements) → tests 1–3.
- **Placeholders:** none.
- **Inline self-consistency (authoring-time scratch run):** these Step 1 tests, appended to the current suite, ran against the Step 3 text in a scratch tree: 8/8 pass, file 45,426 B. Against the unchanged text they gave 5 pass / 3 fail, the three new tests being the failures, so Step 2's expected-FAIL holds and the go-red control is discriminating.
- **Pins checked:** `git grep -F` over `tests plugin` for "non-discriminating, or polluting", "insufficient case coverage", "a weak test, a missing assertion", "missing test, weak test", "Coverage findings anchor" → only `step3-lens-dispatch.md` itself and `tests/review-coverage-anchor-conformance.test.js` hit. No other prose-held pin.
