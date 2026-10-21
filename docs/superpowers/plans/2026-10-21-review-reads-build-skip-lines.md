# /review reads /build's not-run plan steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/review` code mode lists the plan steps `/build` logged as not run (`(skipped)` or `(degraded)`, marked `surfaced for /review`) in a "Not run by /build" summary section, so the promise in `build/dispatch.md` is true.

**Architecture:** Prose-only change in the skill payload. The selection rule lives in `review/review-summary-template.md`'s new section, which states its Include/Omit condition. `review/code-mode-steps.md` Step 7 gets a one-sentence pointer that tells the reviewer to collect the lines. The pointer stays short because that file is at 91.5% of `RAIL_BYTES`. `build/dispatch.md` states that a `(degraded)` line keeps the marker tail. `docs/skill-graph.md`'s `/build` → `/review` row records the new edge. One new conformance suite pins all four places and twin-pins the writer's marker against the reader's selector.

**Tech Stack:** Markdown skill files; `node --test` conformance suite using `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T231737-record-3767/work/3767-spec.md`

## Global Constraints

- Selector marker, copied verbatim from `build/dispatch.md`'s SKIP template: `not run by /build; surfaced for /review`
- Section heading, verbatim from the spec: `Not run by /build`
- Byte headroom (`RAIL_BYTES` = 52,500): `review/code-mode-steps.md` is 48,036 B, leaving 4,464 B. This task adds at most ~400 B there, so it stays under 93%. `review/review-summary-template.md` is 17,076 B and `build/dispatch.md` is 27,128 B, so both have ample headroom.
- Commit style: `{Verb} {what} — {detail}`, message says `refs #3767`, never `closes`/`fixes`.

## Scope decision (logged to decisions.md)

The record's Deliverable says "`/build`-section `SKIP` and `(degraded)` lines". A real archived run (`.claude-tweaks/pipelines/archive/2026-10-17T194033-record-3118/decisions.md`) carries many `/build`-section `SKIP … (skipped)` lines that trace pipeline steps, such as `Spec Step 2.5 … (skipped)` and `Common Step 5.5 … (skipped)`, not plan verification. Listing every one of them under "Not run by /build" would bury the real gap. So the selector is the marker the Folded verification task rule writes, `not run by /build; surfaced for /review`, on a line under `## /build` that begins `- SKIP`. That covers both `(skipped)` and `(degraded)`, because the `(degraded)` variant keeps the tail.

## Review Focus

1. A `/build` `SKIP` line that is a pipeline-step degrade trace (no marker) must not be listed. Pinned by the selector test's frozen real negative line.
2. A line elsewhere in `decisions.md` that quotes the marker (the 3118 run's `/review` STAGED line quotes `'surfaced for /review'`) must not be listed. Pinned by requiring the `- SKIP` prefix under `## /build`.
3. A `(degraded)` line must be listed, not only `(skipped)`. Pinned by the selector test's degraded variant.
4. A clean review with a not-run step must not render the compact clean-PASS form. Pinned by the compact-form bullet fact.
5. No run dir (standalone `/review`) renders no section. Pinned by the Omit fact.

---

### Task 1: Wire the "Not run by /build" reader and section

**Files:**
- Test (create): `tests/review-build-not-run-conformance.test.js`
- Modify: `plugin/skills/review/review-summary-template.md` (new section between `### Verification (from /test)` and `### QA Validation (from /test)`; one new bullet in the compact-form list)
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 7, one new paragraph directly after the first paragraph, which ends `…read \`review-summary-template.md\` in this skill's directory.`)
- Modify: `plugin/skills/build/dispatch.md` (Folded verification task paragraph, the `(degraded)` sentence)
- Modify: `docs/skill-graph.md` (`/build` section's `/review` row, append one sentence)

**Interfaces:**
- Consumes: `build/dispatch.md`'s existing SKIP template `SKIP {time} — {plan task} step "{step}" (skipped): {condition} → not run by /build; surfaced for /review. Reversibility: n/a.` (pinned by `tests/build-skip-degrade-trace-adoption.test.js`; must stay byte-identical)
- Produces: the template section heading `### Not run by /build`, and the selector wording below, which the test extracts

- [ ] **Step 1: Write the failing test** `tests/review-build-not-run-conformance.test.js`

Read the files with `readText`, then slice the regions with a `between(text, start, end)` helper that asserts both anchors resolve (`!== -1`) before slicing:
- `section` = template from `### Not run by /build` to `### QA Validation (from /test)`
- `compact` = template from `## Compact form — clean PASS` to the first "```markdown" after it
- `step7` = code-mode-steps from `## Step 7: Present Review Summary` to `### Key Learnings for Wrap-Up`
- `folded` = dispatch from `**Folded verification task (#3118).**` to `**Single-task fast-lane skip`

Define a missing-facts predicate `missing(region, facts)` that returns the names whose regex no longer matches. Use non-global regexes, each matching exactly once in its region. The facts:
- `AC1.1 step7 pointer` (step7): `/When `\$PIPELINE_RUN_DIR` is set, collect the plan steps `\/build` logged as not run from its `decisions\.md` per `review-summary-template\.md`'s "Not run by \/build" section/`
- `AC1.1 include` (section): `/Include when `\$PIPELINE_RUN_DIR\/decisions\.md` holds at least one line under its `## \/build` heading that begins `- SKIP` and carries `not run by \/build; surfaced for \/review`/`
- `AC1.1 both shapes` (section): `/could not run \(`\(skipped\)`\) or ran only in part \(`\(degraded\)`\)/`
- `AC1.1 table` (section): `/\| Plan step \| Outcome \| Condition \|/`
- `AC2.1 omit` (section): `/Omit otherwise: no run dir, or no such line\./`
- `AC2.1 exclusion` (section): `/Other `\/build` `SKIP` lines trace skipped pipeline steps, not plan verification/`
- `AC2.1 compact` (compact): `/No `\/build` plan step left not run/`
- `AC3.1 degraded keeps tail` (folded): `/logs `\(degraded\)` in place of `\(skipped\)`, keeps the rest of the line,/`
- `AC3.1 reader pointer` (folded): `/`review\/review-summary-template\.md`'s "Not run by \/build" section reads both/`

Tests:
- `test('AC1.1/AC2.1/AC3.1: every fact is present', …)`: `missing(...)` returns `[]` for each region.
- `test('go-red: stripping each fact reports exactly that fact', …)`: for each fact, replace its first match in its region with `''`, `assert.notEqual` the result against the original, and assert `missing` returns exactly `[name]`.
- `test('AC1.1/AC3.1 twin: the reader selector picks both writer shapes and nothing else', …)`:
  - Extract the prefix and marker from `section` with `/begins `([^`]+)` and carries `([^`]+)`/`, and the heading with `/under its `([^`]+)` heading/`.
  - Extract the writer template from `folded` with `/writes `(SKIP \{time\} — [^`]+)`/`.
  - Build two writer lines: `'- ' + template` with `{time}` → `01:02:03`, and the same with `(skipped)` → `(degraded)`.
  - Build a fixture `decisions.md` string that holds both writer lines plus these frozen real lines from the 3118 archive:
    - Negative, under `## /build`: `- SKIP 23:43:17 — Spec Step 2.5 Manual Steps classification (skipped): condition: no Manual Steps section in record #1796 -> fallback: nothing probed. Reversibility: n/a.`
    - Negative, under `## /review`: `- STAGED 23:12:18 — log-decision: Reproduction: lens 3c finding plugin/skills/build/dispatch.md:19 ('surfaced for /review' in the spec-fixed SKIP text — …) not reproduced. Staged to Review Console as low-confidence. Reversibility: high.`
  - Also put a writer line under `## /test`. It must not be selected, which proves the section scoping.
  - Apply the selector: take lines inside the extracted heading's section that start with the prefix and include the marker. Assert it selects exactly the two writer lines under `## /build`.
- `test('twin go-red: a reworded marker in the template stops matching the writer', …)`: replace the marker in `section` with `surfaced for review`, re-extract it, and assert the selection is `[]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-build-not-run-conformance.test.js`
Expected: FAIL — `between` throws `anchor missing: ### Not run by /build`

- [ ] **Step 3: Make the prose edits**

`review-summary-template.md`: insert after the Verification block's `- Tests: {pass/fail}` line and its blank line, before `### QA Validation (from /test)`:

```
### Not run by /build

{Include when `$PIPELINE_RUN_DIR/decisions.md` holds at least one line under its `## /build` heading that begins `- SKIP` and carries `not run by /build; surfaced for /review` — the line `build/dispatch.md`'s Folded verification task rule writes for a plan step `/build` could not run (`(skipped)`) or ran only in part (`(degraded)`). Omit otherwise: no run dir, or no such line. Other `/build` `SKIP` lines trace skipped pipeline steps, not plan verification — never list them here.}

| Plan step | Outcome | Condition |
|-----------|---------|-----------|
| {plan task} step "{step}" | {skipped/degraded} | {condition — for degraded, what did not run} |

> Each row is a verification the plan required that no phase ran. It is reported for a human to run or accept — not by itself a BLOCKED finding.
```

Compact-form list: add after the `- No manual steps required` bullet:
`- No `/build` plan step left not run (the full template's "Not run by /build" section would be omitted)`

`code-mode-steps.md` Step 7: new paragraph after the first paragraph:
`**Not run by /build (#3767).** When `$PIPELINE_RUN_DIR` is set, collect the plan steps `/build` logged as not run from its `decisions.md` per `review-summary-template.md`'s "Not run by /build" section, before choosing the compact or full form.`

`build/dispatch.md`: replace `one that ran only in part (a dev server dying mid-pass) logs `(degraded)` in place of `(skipped)` and names what did not run.` with `one that ran only in part (a dev server dying mid-pass) logs `(degraded)` in place of `(skipped)`, keeps the rest of the line, and names what did not run in `{condition}`; `review/review-summary-template.md`'s "Not run by /build" section reads both.`

`docs/skill-graph.md`: in the `/build` section's `| /review |` row, append before the closing ` |`:
` Since #3767, `/review` Step 7 lists `build/dispatch.md`'s Folded verification task `SKIP` lines — `(skipped)` or `(degraded)`, marked `surfaced for /review` — in its summary's "Not run by /build" section (`review/review-summary-template.md`).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-build-not-run-conformance.test.js tests/build-skip-degrade-trace-adoption.test.js tests/review-qa-rerun-after-fix-wave-conformance.test.js`
Expected: PASS, 0 fail

Real-input probe: with the archived 3118 `decisions.md` as input, the selector picks 0 lines, even though that file holds `/build` `SKIP … (skipped)` lines and one `/review` line that quotes the marker. Record the count in the commit body.

- [ ] **Step 5: Commit**

```bash
git add tests/review-build-not-run-conformance.test.js plugin/skills/review/review-summary-template.md plugin/skills/review/code-mode-steps.md plugin/skills/build/dispatch.md docs/skill-graph.md
git commit -m "Wire /review's Not run by /build section — reads /build's folded-verification SKIP lines (refs #3767)"
```

## Spec coverage

| Spec item | Covered by |
|---|---|
| Deliverable 1 (reader + summary listing) | Step 3 code-mode-steps + template; facts `AC1.1 *` |
| Deliverable 2 (template section, Include/Omit) | Step 3 template; facts `AC1.1 include`, `AC2.1 omit` |
| Deliverable 3 (a test pins reader + section) | Step 1 suite |
| AC1.1 (SKIP line → summary names step + condition) | `AC1.1 table`, twin test |
| AC2.1 (no line → no section) | `AC2.1 omit`, `AC2.1 compact` |
| AC3.1 (`surfaced for /review` is now true) | `AC3.1 reader pointer`, `AC3.1 degraded keeps tail`, twin test |
