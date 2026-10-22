# Dispatched-Reviewer Degrade (#3817) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dispatched-reviewer lens degrade explicit at every effort tier, and pin its `decisions.md` line shape and coverage caveat so they cannot silently vanish.

**Architecture:** #3078 already gave a dispatched `/review` a path: it dispatches its own lens agents under the nested keep-alive rule, and a lens whose agents are unavailable, time out, or lose a partner gets the partner-died single-read treatment. A test forbids bringing back the old "skip dispatch, judge directly" carve-out. This plan does not change that design. It names every tier on that sentence, gives the coverage caveat a slot in the two places it must render (the review summary and the PR verdict comment), cross-references it from `dispatch/task-prompt.md` item 7, and pins all of it with one new conformance suite.

**Tech Stack:** Markdown skill prose; `node --test` conformance tests (no external deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-22T110840-spec-3926-3817-3945-3947/spec-3817/work/3817-spec.md` — premise corrected at build (the decision log has a `premise reversed:` line). Deliverable 1's "judge every lens directly" is superseded by #3078's keep-alive design. Every acceptance criterion still applies.

## Global Constraints

- `plugin/skills/review/step3-lens-dispatch.md` is 51,044 B against `RAIL_BYTES` 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). This plan may add **at most 80 B** to it, because #3947 needs about 400 B later in this same run. Measure with `wc -c` before and after.
- Never reinsert the deleted carve-out wording "cannot safely wait" or "skip the Task-tool dispatch for this tier entirely". `tests/foreground-execution-instruction.test.js` `CARVE_OUT` fails if either phrase returns.
- The edited Foreground-note sentence must still match that suite's `LENS_NOTE_SENTENCE` (`/When the reviewer is itself a dispatched agent,.*?\(findings \`unconfirmed\`, logged\)\./`) and all of its `LENS_NOTE` patterns.
- State the line shape once. The literal `single-read coverage. Reversibility: high.` lives only in `step3-lens-dispatch.md`'s partner-died paragraph. The summary template, `code-mode-steps.md` and `task-prompt.md` cite that paragraph and never restate the literal.
- A skill reference inside instruction text uses the fully-qualified `/claude-tweaks:review` form.
- Read every skill file through `tests/helpers/read-skill.js`'s `readText`, which normalizes EOLs.
- Commits use `{Verb} {what} — {detail}` and end with `refs #3817` plus the session trailer. Never write "closes".

## Review Focus

- A tier-name insertion that breaks `LENS_NOTE_SENTENCE` (the regex is non-greedy across the sentence). Task 1 runs the neighbor suite.
- The compact clean-PASS form dropping the caveat because it shows no section headers. Task 2 pins the slot inside the compact block, not only the full template.
- The line shape restated in a second file, which drifts later. Task 1 pins exactly one occurrence repo-wide under `plugin/skills/`.
- The verdict comment rewording the caveat instead of copying the summary line. Task 2 pins "verbatim".
- `task-prompt.md`'s line wrapping inside numbered item 7 (3-space indent). Task 2's pin reads the item-7 block with the same boundary logic as the neighbor suite.

---

### Task 1: Name every tier on the degrade and pin its line shape

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md:60` (the Foreground Execution Discipline note)
- Create: `tests/review-dispatched-reviewer-degrade-conformance.test.js`
- Test: `tests/foreground-execution-instruction.test.js` (neighbor suite, run unchanged)

**Interfaces:**
- Produces: the test-file helpers `missingFactsOf(patterns) -> (text) -> string[]` and `assertEachPatternGoesRed(text, patterns, missingOf)`. Copy both from `tests/foreground-execution-instruction.test.js:53-63`, because that file exports nothing. Also produces `const STEP3`, the `step3-lens-dispatch.md` absolute path. Task 2 appends to this file and reuses all three.

- [ ] **Step 1: Write the failing tests** in `tests/review-dispatched-reviewer-degrade-conformance.test.js`:
  - `foreground note names every effort tier on the dispatched-reviewer degrade (#3817 AC1.1)`: take the `step3-lens-dispatch.md` line starting `> **Foreground Execution Discipline:**`, then the match of `/When the reviewer is itself a dispatched agent,.*?\(findings \`unconfirmed\`, logged\)\./`. Assert each of `` `low` ``, `` `medium` ``, `` `high` ``, `` `xhigh` ``, `` `max` `` appears in that sentence, as `TIERS` fact patterns checked through `missingFactsOf` (expect `[]`).
  - `the tier assertion can go red`: `assertEachPatternGoesRed(sentence, TIERS, tiersMissing)`.
  - `partner-died paragraph states the degrade line shape and caveat once (#3817 AC2.1)`: find the line starting `> **Reproduction-pair partner dies or is unavailable.**`. Assert it contains the exact literal ``Log `STAGED {HH:MM:SS} — Reproduction: lens "{lens}" {session limit twice | unavailable | timed out}; single-read coverage. Reversibility: high.` to `decisions.md` `` and matches `/carry a one-line coverage-caveat into the Step 7 summary and the PR verdict comment naming the affected lens/`. Then assert the substring `single-read coverage. Reversibility: high.` occurs exactly once across every `plugin/skills/**/*.md` file. Walk the tree with `fs.readdirSync(..., { recursive: true })` and read through `readText`.
  - `removing the partner-died paragraph turns the AC2.1 pin red`: build the step3 text with that paragraph line removed, and assert the same predicate (a `partnerDiedMissing(text) -> string[]` function covering paragraph present, literal present and caveat present) returns a non-empty list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: FAIL. The AC1 tier test reports `low`, `medium`, `high`, `xhigh` and `max` missing. The AC2 tests already pass, because they pin existing text.

- [ ] **Step 3: Edit `step3-lens-dispatch.md:60`.** Change `When the reviewer is itself a dispatched agent, its own lens dispatches follow` to `When the reviewer is itself a dispatched agent, at every tier (` + "`low`, `medium`, `high`, `xhigh`, `max`" + `), its own lens dispatches follow`. Change nothing else on the line. Run `wc -c` to confirm the file grew by no more than 80 B.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js tests/foreground-execution-instruction.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md tests/review-dispatched-reviewer-degrade-conformance.test.js
git commit -m "Name every tier on the dispatched-reviewer degrade — pin its line shape and caveat, refs #3817"
```

### Task 2: Give the coverage caveat its render slots and cross-reference it

**Files:**
- Modify: `plugin/skills/review/review-summary-template.md` (compact block near line 18; full template near line 37)
- Modify: `plugin/skills/review/code-mode-steps.md:371-382` (Step 7 "Verdict comment" paragraph)
- Modify: `plugin/skills/dispatch/task-prompt.md:40-70` (item 7 "Async-wait discipline")
- Test: `tests/review-dispatched-reviewer-degrade-conformance.test.js` (append)

**Interfaces:**
- Consumes: `missingFactsOf`, `assertEachPatternGoesRed` and `STEP3` from Task 1.

- [ ] **Step 1: Append the failing tests.**
  - `summary template carries a Coverage caveat slot in the compact and full forms (#3817)`: split `review-summary-template.md` at `## Full template`. Assert that each half matches `/\*\*Coverage caveat:\*\*/` and contains `` `step3-lens-dispatch.md` ``, and that neither half contains `single-read coverage. Reversibility`.
  - `verdict comment copies the summary's Coverage caveat line (#3817)`: take the `code-mode-steps.md` paragraph starting `**Verdict comment (`, which ends at the next blank line. Assert it matches `/Coverage caveat:\*\* line verbatim/`.
  - `task-prompt item 7 cross-references the review degrade (#3817)`: extract the item-7 block with the neighbor suite's `item7Block` logic (copied: from `7. **Async-wait discipline**` to the next `\n8. ` or `\n## `). Assert that it contains `/claude-tweaks:review` and `` `review/step3-lens-dispatch.md` ``.
  - One go-red test per pin above, each using `assertEachPatternGoesRed` over its own pattern list.
  - AC3.1 (`npm test` passes) is not a test in this file — it is proven by the build's Common Step 5 full-suite run.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js`
Expected: FAIL. The three new pins report their facts missing, and Task 1's tests still pass.

- [ ] **Step 3: Edit the three files.**
  - `review-summary-template.md`, compact block: after the `{only when 3j printed a table:} **Skill load delta:**` line, add `{only when a lens fell back to single-read coverage — step3-lens-dispatch.md's partner-died paragraph:} **Coverage caveat:** {one line per affected lens}`. Write the file name in backticks.
  - `review-summary-template.md`, full template: add the same line directly under the `**Review effort:**` line.
  - `code-mode-steps.md`: in the Verdict comment paragraph, after `(stale-QA qualifier included — no separate wording),` insert `then the summary's **Coverage caveat:** line verbatim when it rendered,`.
  - `task-prompt.md` item 7 only (lines 60-61; the same sentence also appears inside the two fenced templates at ~161 and ~328 — leave those untouched, the dispatched reviewer reads `step3-lens-dispatch.md` itself): after the sentence ending `otherwise judge that unit yourself.`, add `For a /claude-tweaks:review lens unit, that downgrade is the single-read coverage line and caveat in` + " `review/step3-lens-dispatch.md`'s partner-died paragraph." Write `/claude-tweaks:review` in backticks, and keep the item's 3-space continuation indent and ~100-column wrap.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/review-dispatched-reviewer-degrade-conformance.test.js tests/foreground-execution-instruction.test.js tests/multispec-ephemeral-server-record-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/review-summary-template.md plugin/skills/review/code-mode-steps.md plugin/skills/dispatch/task-prompt.md tests/review-dispatched-reviewer-degrade-conformance.test.js
git commit -m "Give the review coverage caveat its summary and verdict-comment slots — cross-reference from task-prompt item 7, refs #3817"
```

Acceptance-criteria coverage: AC1.1 is Task 1's tier test. AC2.1 is Task 1's line-shape and caveat pin, its removal go-red proof, and Task 2's slot pins. AC3.1 (`npm test` passes) is the build's Common Step 5 full-suite verification.
