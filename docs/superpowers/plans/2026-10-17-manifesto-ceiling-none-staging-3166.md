# Manifesto ceiling `none` row stages, not auto-applies (#3166) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plugin/skills/flow/manifesto-overrides.md`'s `review-auto-apply-ceiling` rows say what `plugin/skills/review/step3-routing.md`'s ceiling-keyed routing table actually does, and pin that with a conformance test.

**Architecture:** Two prose rows in one Markdown table are reworded. A new `node --test` suite reads both files, checks the routing table's premise (the `none` and `medium` columns), and asserts the override rows agree with it.

**Tech Stack:** Markdown skill prose; `node --test` (built-in `node:test` + `node:assert`).

**Spec:** `.claude-tweaks/pipelines/2026-10-17T194027-record-3166/work/3166-spec.md` (materialized from GitHub issue #3166)

## Global Constraints

- Touch only `plugin/skills/flow/manifesto-overrides.md` lines 15-16 (the two `Review auto-apply ceiling` rows) and the new test file. Do not edit `plugin/skills/review/step3-routing.md` or `plugin/skills/flow/manifesto.md`.
- Commit message style: `{Verb} {what} — {detail}`, with `refs #3166` (never `closes`/`fixes`).
- Test style matches neighbouring prose-conformance suites (e.g. `tests/step3-routing-prose-exempt-conformance.test.js`): `'use strict'`, `node:test`, `node:assert`, `fs.readFileSync` of the live skill file.

## Review Focus

1. The prose-exempt bump (`step3-routing.md`: `none`→`low` for a Low fix whose every `Target:` is `skills/**/*.md` / `docs/**/*.md`, when `review-auto-apply-prose-exempt` is true, its default) means "nothing auto-applies under `none`" is not literally true. The `none` row must name that exception, or it trades one false claim for another. Pinned by `none row names the prose-exempt exception` below.
2. The current `medium` row says "only HIGH prompts", but the routing table's High cell is STAGED at every ceiling and Critical is the only KEPT-PROMPT. Pinned by the `medium` test below.
3. The routing table itself could change later (e.g. a ceiling that auto-applies High). The test reads the table's cells first, so a table change fails a premise assertion with a clear message instead of silently passing.
4. A negative control that only re-checks its own mutated string cannot fail. The controls below run the same assertion functions against the old line-15/16 wording.

---

### Task 1: Correct the ceiling override rows and pin them against the routing table

**Files:**
- Modify: `plugin/skills/flow/manifesto-overrides.md:15-16`
- Test: `tests/manifesto-overrides-ceiling-conformance.test.js` (Create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** at `tests/manifesto-overrides-ceiling-conformance.test.js`.

Helpers (module-level, in the test file):
- `routingColumns(md)` parses the `| Severity | \`none\` | \`low\` | \`medium\` |` table in `step3-routing.md` and returns `{ Critical: {none, low, medium}, High: {...}, Medium: {...}, Low: {...} }` (cell text, trimmed).
- `ceilingRow(md, value)` returns the third cell of the `| Review auto-apply ceiling | \`{value}\` | … |` row in `manifesto-overrides.md`, or throws when absent.
- `assertNoneRow(text)`: `assert.match(text, /every non-critical finding staged/i)`, `assert.doesNotMatch(text, /all findings auto-applied/i)`, `assert.match(text, /highest friction, lowest revert load/i)`, `assert.match(text, /prose-exempt/i)`.
- `assertMediumRow(text)`: `assert.doesNotMatch(text, /only HIGH prompts/i)`, `assert.match(text, /LOW \+ MED auto-applied/)`, `assert.match(text, /HIGH staged/)`, `assert.match(text, /Critical prompts/i)`.

Tests:
- `'premise: step3-routing none column stages every non-critical severity'` — for `High`, `Medium`, `Low`: `assert.ok(cols[sev].none.startsWith('STAGED'))`; `assert.strictEqual(cols.Critical.none, 'KEPT-PROMPT')`.
- `'premise: step3-routing medium column auto-applies Low and Medium, stages High, prompts Critical'` — `cols.Low.medium === 'AUTO'`, `cols.Medium.medium === 'AUTO'`, `cols.High.medium === 'STAGED'`, `cols.Critical.medium === 'KEPT-PROMPT'`.
- `'AC1.1 + AC2.1: none override row describes staging, not auto-apply'` — `assertNoneRow(ceilingRow(overrides, 'none'))`.
- `'none row names the prose-exempt exception'` — covered inside `assertNoneRow` (the `/prose-exempt/i` match); state it in the test name above or as its own `test` calling `assertNoneRow`.
- `'medium override row matches the routing table (HIGH staged, only Critical prompts)'` — `assertMediumRow(ceilingRow(overrides, 'medium'))`.
- `'go-red control: the pre-#3166 none wording fails assertNoneRow'` — `assert.throws(() => assertNoneRow('All findings auto-applied (lowest friction, highest revert load)'))`.
- `'go-red control: the pre-#3166 medium wording fails assertMediumRow'` — `assert.throws(() => assertMediumRow('LOW + MED auto-applied; only HIGH prompts'))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/manifesto-overrides-ceiling-conformance.test.js`
Expected: FAIL — the `AC1.1 + AC2.1` and `medium override row` tests fail on the current lines 15-16; both premise tests and both go-red controls pass.

- [ ] **Step 3: Reword `plugin/skills/flow/manifesto-overrides.md` lines 15-16**

Replace the two rows' third cell with exactly:
- `none`: `Every non-critical finding staged for the Review Console, nothing auto-applied (highest friction, lowest revert load); Critical still prompts. One exception: with \`review-auto-apply-prose-exempt\` on (the default), a Low fix touching only prose files routes at \`low\` and auto-applies`
- `medium`: `LOW + MED auto-applied; HIGH staged; only Critical prompts`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/manifesto-overrides-ceiling-conformance.test.js`
Expected: PASS, all tests.

Also run: `node --test tests/run-dir-timestamp-utc.test.js` (it reads `manifesto-overrides.md`)
Expected: PASS.

AC1.1 check: `grep -n 'none' plugin/skills/flow/manifesto-overrides.md` — the `Review auto-apply ceiling | \`none\`` line reads "Every non-critical finding staged".

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/manifesto-overrides.md tests/manifesto-overrides-ceiling-conformance.test.js
git commit -m "Correct Manifesto ceiling override rows — none stages every non-critical finding, medium stages HIGH (refs #3166)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 3 `none` row. Deliverable 2 → Step 3 `medium` row (the only other ceiling row; it said "only HIGH prompts", but High is STAGED). Deliverable 3 → Step 1 test. AC1.1 → `AC1.1 + AC2.1` test plus Step 4 grep. AC2.1 → Step 2 expected FAIL and Step 4 PASS.
- **Out of scope, routed to the ledger:** `plugin/skills/flow/manifesto.md`'s lever-7 "Effect if approved" cell says "`low` — … HIGH prompts" (same mismatch, different file). The Override table also has no `low` row, though `low` is a real override when the recommendation is `medium` (unattended autonomy).
- **Placeholders:** none.
