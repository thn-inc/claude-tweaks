# wrap-up: render the phase-trace report after the execute step (#3672) Implementation Plan

**Goal:** `wrap-up/SKILL.md` lists the phase-trace report before "Execute approved actions", yet the report's Verdict names facts only that execute step produces. Pick one order (the report renders last, after Execute approved actions and its Verify execution), state it, and make every dependent rule and hand-off pointer agree with it.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T042332-record-3672/work/3672-spec.md` (materialized from GitHub issue #3672)

**Decision (option 1 of the spec's two):** render the report after Execute approved actions and Verify execution. The template already describes executed state (Actions Performed lists "cleanup actions executed in Phase 4" and "Removed worktree"; the closure line is gated on Verify execution; the #2550 carve-out reads `verify` rows). A second render pass would split one report into two and add machinery the content does not need.

**Scope keywords:** phase-trace report

---

### Task 1: State the Phase 4 order, move the execute section ahead of the report, and align the Verdict rules and hand-off pointers

**Files:**
- Modify: `plugin/skills/wrap-up/SKILL.md`
- Modify: `plugin/skills/wrap-up/summary-template.md`
- Modify: `plugin/skills/wrap-up/execution-and-verification.md`
- Modify: `plugin/skills/wrap-up/review-console.md`
- Modify: `plugin/skills/wrap-up/review-console-interactive.md`
- Modify: `plugin/skills/wrap-up/review-console-appendix.md`
- Modify: `plugin/skills/wrap-up/standalone-fast-path.md`
- Modify: `tests/wrap-up-ledger-delete-before-merge.test.js` (its `STEP14` constant pins the review-console hand-off text this task changes)
- Test: `tests/wrap-up-phase4-report-order-conformance.test.js` (new)

Every edit below is an exact string replacement. Use the Edit tool with the quoted `old` text (it matches the file exactly, line breaks included) and the quoted `new` text. Do not reflow or reword anything else.

- [ ] **Step 1: Failing test.** Create `tests/wrap-up-phase4-report-order-conformance.test.js` with exactly this content:

```js
'use strict';
// #3672: wrap-up's Phase 4 renders the phase-trace report after Execute approved actions and its
// Verify execution, because the report's Verdict names facts only execution produces. These pins
// keep SKILL.md's order sentence, the section order, the two dependent Verdict rules (#2550's
// carve-out and #3483's leave-open mergeability), and the console hand-off pointers in agreement.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const WRAP_UP = path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up');
const read = (name) => readText(path.join(WRAP_UP, name));
const flatten = (text) => text.replace(/\s+/g, ' ');

const SKILL = read('SKILL.md');
const TEMPLATE = read('summary-template.md');
const EXEC = read('execution-and-verification.md');
const POINTER_FILES = ['review-console.md', 'review-console-interactive.md', 'review-console-appendix.md', 'standalone-fast-path.md'];

const ORDER = '**Order (#3672).**';
const PLAN_H = '### Plan cleanup actions';
const CONSOLE_H = '### Wrap-Up Review Console';
const EXECUTE_H = '### Execute approved actions';
const REPORT_H = '### The phase-trace report';
const AFTER_PHASE4 = '## Important Notes';

// Go-red controls: a mutation that changes nothing would prove nothing.
function assertMutated(original, mutated) {
  assert.ok(mutated !== original, 'the control must actually mutate the text');
  return mutated;
}

function assertSkillOrder(text) {
  const phase4 = text.indexOf('## Phase 4: CLOSE');
  const order = text.indexOf(ORDER);
  const planAt = text.indexOf(PLAN_H);
  const consoleAt = text.indexOf(CONSOLE_H);
  const executeAt = text.indexOf(EXECUTE_H);
  const reportAt = text.indexOf(REPORT_H);
  assert.ok(phase4 !== -1 && order > phase4 && order < planAt, 'order: the order paragraph opens Phase 4, before its first step');
  assert.ok(planAt < consoleAt && consoleAt < executeAt, 'order: Execute approved actions follows the Review Console');
  assert.ok(executeAt < reportAt, 'order: the phase-trace report follows Execute approved actions');
  const para = flatten(text.slice(order, planAt));
  for (const needle of [
    'plan cleanup, the Wrap-Up Review Console, Execute approved actions (its Verify execution included), then the phase-trace report',
    "the Leave-open mergeability re-check's `mergeability:` line in `decisions.md`",
    'the `wrap-up-engine.js verify` rows the #2550 carve-out reads',
    'A verify exit 3 still renders the report',
  ]) assert.ok(para.includes(needle), `order sentence: missing ${JSON.stringify(needle)}`);
}

function verdictSection(text) {
  const flat = flatten(text);
  const start = flat.indexOf('### Verdict');
  const end = flat.indexOf('### State', start);
  assert.ok(start !== -1 && end > start, 'the ### Verdict section must exist');
  return flat.slice(start, end);
}

function assertVerdictRules(text) {
  const header = flatten(text.slice(0, text.indexOf('```')));
  assert.ok(header.includes('and runs last: after Execute approved actions and its Verify execution'),
    "template header: names the report as Phase 4's last step");
  const verdict = verdictSection(text);
  const carve = verdict.indexOf('(#2550)');
  const leave = verdict.indexOf('(#3483)');
  assert.ok(carve !== -1 && leave > carve, 'both Verdict rules are present, #2550 before #3483');
  const carveRule = verdict.slice(carve, leave);
  const leaveRule = verdict.slice(leave);
  assert.ok(carveRule.includes("These rows come from the Verify execution table that Phase 4's execution step inserted just before this report renders"),
    '#2550: the carve-out reads verify rows that execution produced before the report');
  assert.ok(leaveRule.includes("one `mergeability:` outcome in Phase 4's execution step, which completes before this report renders"),
    '#3483: the mergeability line exists by the time the report renders');
  assert.ok(leaveRule.includes('holds no `mergeability:` line — the re-check did not run — reads "mergeability not re-checked"'),
    '#3483: an absent line means the re-check did not run, not that it has not run yet');
}

function assertExecBlocked(text) {
  assert.ok(flatten(text).includes("surface `BLOCKED — {failing check row(s), verbatim}` in the phase-trace report's Verdict (which renders next, per `SKILL.md`'s Phase 4 order"),
    'verify exit 3: BLOCKED surfaces in the report that renders next, not instead of it');
}

function assertPointer(name, text) {
  assert.doesNotMatch(flatten(text), /(?<!not )proceed (directly )?to the phase-trace report/i,
    `${name}: a console hand-off proceeds to Phase 4's execution step, never straight to the report`);
}

test("AC1: SKILL.md states one Phase 4 order and its sections follow it", () => {
  assertSkillOrder(SKILL);
});

test('AC1: the #2550 and #3483 Verdict rules read facts execution has already produced', () => {
  assertVerdictRules(TEMPLATE);
});

test("AC1: a verify exit 3 surfaces BLOCKED in the report that renders after it", () => {
  assertExecBlocked(EXEC);
});

test("AC1: no console hand-off skips Phase 4's execution step", () => {
  for (const name of POINTER_FILES) assertPointer(name, read(name));
});

test('go-red control: the report moved back ahead of Execute approved actions fails the order pin', () => {
  const executeAt = SKILL.indexOf(EXECUTE_H);
  const reportAt = SKILL.indexOf(REPORT_H);
  const endAt = SKILL.indexOf(AFTER_PHASE4);
  assert.ok(executeAt !== -1 && reportAt > executeAt && endAt > reportAt);
  const swapped = assertMutated(SKILL, SKILL.slice(0, executeAt) + SKILL.slice(reportAt, endAt) + SKILL.slice(executeAt, reportAt) + SKILL.slice(endAt));
  assert.throws(() => assertSkillOrder(swapped), /phase-trace report follows/);
});

test('go-red control: dropping either Verdict anchor fails its own pin', () => {
  const noLeave = assertMutated(TEMPLATE, TEMPLATE.replace('which completes\nbefore this report renders', 'which may run\nafter this report renders'));
  assert.throws(() => assertVerdictRules(noLeave), /#3483/);
  const noCarve = assertMutated(TEMPLATE, TEMPLATE.replace('These rows come from the Verify execution table', 'These rows may come from a later table'));
  assert.throws(() => assertVerdictRules(noCarve), /#2550/);
});

test('go-red control: the old step-14 hand-off fails the pointer pin', () => {
  const original = read('review-console.md');
  const reverted = assertMutated(original, original.replace("14. Proceed to Phase 4's execution step, then the phase-trace report", '14. Proceed to the phase-trace report'));
  assert.throws(() => assertPointer('review-console.md', reverted), /never straight to the report/);
});
```

- [ ] **Step 2: Run it — FAIL.**
  Run: `node --test tests/wrap-up-phase4-report-order-conformance.test.js`
  Expected: FAIL (the four AC tests fail; the go-red controls also fail because the anchors they mutate do not exist yet).

- [ ] **Step 3: Implement — `plugin/skills/wrap-up/SKILL.md`.**

  3a. Insert the order paragraph. old:
  ```
  ## Phase 4: CLOSE — decide, execute, hand off

  ### Plan cleanup actions (formerly Step 5)
  ```
  new:
  ```
  ## Phase 4: CLOSE — decide, execute, hand off

  **Order (#3672).** Phase 4's steps run in the order below: plan cleanup, the Wrap-Up Review Console, Execute approved actions (its Verify execution included), then the phase-trace report. The report renders last because its Verdict names facts only execution produces — the Leave-open mergeability re-check's `mergeability:` line in `decisions.md`, and the `wrap-up-engine.js verify` rows the #2550 carve-out reads — so a report rendered earlier would call a re-checked PR "mergeability not re-checked". A verify exit 3 still renders the report, its Verdict reading `BLOCKED`; only the closure line is withheld.

  ### Plan cleanup actions (formerly Step 5)
  ```

  3b. Move the whole `### Execute approved actions (formerly Step 10)` section (its heading line through the end of its `**Gate the read.**` paragraph, i.e. up to but not including the blank line before `## Important Notes`) so it sits immediately before `### The phase-trace report (formerly Step 9)`. Move it byte-for-byte: no wording change inside it. After the move the Phase 4 heading order is: `### Plan cleanup actions`, `### Wrap-Up Review Console`, `### Execute approved actions`, `### The phase-trace report`, then `## Important Notes`. Keep exactly one blank line between sections.

- [ ] **Step 4: Implement — `plugin/skills/wrap-up/summary-template.md`.**

  4a. old:
  ```
  Loaded by `/claude-tweaks:wrap-up` Phase 4's "The phase-trace report", which always runs. Holds
  ```
  new:
  ```
  Loaded by `/claude-tweaks:wrap-up` Phase 4's "The phase-trace report", which always runs, and runs last: after Execute approved actions and its Verify execution (`SKILL.md`'s Phase 4 order, #3672). Holds
  ```

  4b. old:
  ```
  evidence the run is blocked. This reach-limited reading applies to
  ```
  new:
  ```
  evidence the run is blocked. These rows come from the Verify execution table
  that Phase 4's execution step inserted just before this report renders
  (`SKILL.md`'s Phase 4 order). This reach-limited reading applies to
  ```

  4c. old:
  ```
  one `mergeability:` outcome — read it from that `decisions.md` line (at
  ```
  new:
  ```
  one `mergeability:` outcome in Phase 4's execution step, which completes
  before this report renders (`SKILL.md`'s Phase 4 order) — read it from that `decisions.md` line (at
  ```

  4d. old:
  ```
  read) adds nothing to the Verdict. A leave-open run whose `decisions.md`
  holds no `mergeability:` line reads "mergeability not re-checked" in the
  Verdict — never as clean.
  ```
  new:
  ```
  read) adds nothing to the Verdict. A leave-open run whose `decisions.md`
  holds no `mergeability:` line — the re-check did not run — reads "mergeability not re-checked" in the
  Verdict — never as clean.
  ```

  Do not touch the two line breaks the #2550 suite pins (`it already` / `reports \`skip\`` and `is never` / `carved out`).

- [ ] **Step 5: Implement — `plugin/skills/wrap-up/execution-and-verification.md`.** old:
  ```
  On exit code 3, do NOT emit the closure line: surface `BLOCKED — {failing check row(s), verbatim}` and stop.
  ```
  new:
  ```
  On exit code 3, do NOT emit the closure line: surface `BLOCKED — {failing check row(s), verbatim}` in the phase-trace report's Verdict (which renders next, per `SKILL.md`'s Phase 4 order — `summary-template.md`'s #2550 carve-out still applies) and stop after the report.
  ```

- [ ] **Step 6: Implement — the console hand-off pointers.**

  6a. `plugin/skills/wrap-up/review-console.md`, old: `After resolving, proceed directly to the phase-trace report — skip` new: `After resolving, proceed directly to Phase 4's execution step — skip`

  6b. `plugin/skills/wrap-up/review-console.md`, old: `14. Proceed to the phase-trace report` new: `14. Proceed to Phase 4's execution step, then the phase-trace report`

  6c. `plugin/skills/wrap-up/review-console.md`, old: `Log "Review Console: nothing to review" and proceed to the phase-trace report.` new: `Log "Review Console: nothing to review" and proceed to Phase 4's execution step.`

  6d. `plugin/skills/wrap-up/review-console-interactive.md`, old: `6. Commit, then proceed to the phase-trace report` new: `6. Commit, then proceed to Phase 4's execution step`

  6e. `plugin/skills/wrap-up/review-console-appendix.md`, old: `5. Proceed to the phase-trace report — the per-spec summary still renders,` new: `5. Proceed to Phase 4's execution step, then the phase-trace report — the per-spec summary still renders,`

  6f. `plugin/skills/wrap-up/standalone-fast-path.md`, old: `Proceed to \`SKILL.md\`'s phase-trace report and "Execute approved actions" step as normal —` new: `Proceed to \`SKILL.md\`'s "Execute approved actions" step and phase-trace report as normal —`

  6g. `tests/wrap-up-ledger-delete-before-merge.test.js`, old: `const STEP14 = '14. Proceed to the phase-trace report';` new: `const STEP14 = "14. Proceed to Phase 4's execution step, then the phase-trace report";` — leave its frozen `PRE_FIX` fixture (line `'13. Proceed to the phase-trace report',`) unchanged: it is historical text.

  Leave `review-console.md`'s dry-run line ("do not proceed to the phase-trace report or Phase 4's real execution step") unchanged.

- [ ] **Step 7: Run — PASS.** Each as its own command:
  - `node --test tests/wrap-up-phase4-report-order-conformance.test.js`
  - `node --test tests/wrap-up-ledger-delete-before-merge.test.js`
  - `node --test tests/wrap-up-leave-open-mergeability-conformance.test.js`
  - `node --test tests/wrap-up-summary-template-standalone-conformance.test.js`
  Expected: all PASS.

- [ ] **Step 8: Commit** — stage the nine files by explicit path, one commit: `Render wrap-up's phase-trace report after the execute step — state the Phase 4 order` with body `refs #3672`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (decide and state the order) — Step 3. Deliverable 2 (align the #2550 carve-out and the #3483 leave-open rule) — Step 4. AC1 (one order, every Verdict rule that reads an execution-logged line consistent with it) — Steps 3-6; the hand-off pointers (Step 6) and the verify exit-3 line (Step 5) are included because, left alone, they contradict the stated order. AC2 (a conformance test pins the order sentence and the two Verdict rules) — Step 1.
- **Placeholders:** none.
