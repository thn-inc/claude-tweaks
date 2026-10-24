# Plan and review should enumerate failure branches of a fail-closed skill-prose guard (#3965) Implementation Plan

**Goal:** Make shaping (`specify/red-team.md`) and review (`review/step3-lens-dispatch.md` lens 3c) check that a fail-closed rule in skill prose states its outcome on empty, unreadable and malformed input.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T061057-record-3965/work/3965-spec.md` (materialized from GitHub issue #3965)

**Byte headroom (Byte-pin check):** `RAIL_BYTES` = 52,500. `plugin/skills/review/step3-lens-dispatch.md` is 50,756 B at the merge base (96.7%). The new lens 3c bullet adds about 330 B, which leaves about 1.4 KB of headroom. No cut is needed. If the edit ever breaches the rail, the remedy is to shorten the new bullet's trailing citation, never to drop its question. `plugin/skills/specify/red-team.md` is 16,489 B, far from the rail.

---

### Task 1: Add the fail-closed guard detection step and the lens 3c question, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/specify/red-team.md`: insert a new section between `## Cross-AC literal check (deterministic, runs before persona dispatch)` and `## Parallel dispatch`
- Modify: `plugin/skills/review/step3-lens-dispatch.md`: append one bullet to the end of the `### 3c: Error Handling` list, right after the "Before staging a fix for an asymmetry…" bullet
- Test: `tests/specify-review-fail-closed-guard-conformance.test.js` (new)

- [ ] **Step 1: Failing test.** Create `tests/specify-review-fail-closed-guard-conformance.test.js`:

```js
// tests/specify-review-fail-closed-guard-conformance.test.js
//
// Pins record #3965's prose wiring: specify/red-team.md carries a
// deterministic detection step for a prose guard that must fail closed,
// naming the three input classes (empty, unreadable, malformed), and
// review/step3-lens-dispatch.md's lens 3c asks whether an every/all
// quantifier in such a guard holds over an empty set and whether a failed
// read is a hold. Each pin has a go-red control that runs the same
// assertion against text with the sentence removed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const RED_TEAM = readText(path.join(ROOT, 'plugin/skills/specify/red-team.md'));
const LENS = readText(path.join(ROOT, 'plugin/skills/review/step3-lens-dispatch.md'));

const HEADING = '## Fail-closed guard detection (deterministic, runs before persona dispatch)';
const CLASS_BULLETS = ['- **Empty input set**', '- **Unreadable source**', '- **Malformed value**'];
const LENS_QUESTION =
  'does an `every`/`all` quantifier in its rule still hold over an empty set, and is a failed read a hold rather than a pass?';

function sliceSection(text, heading, nextMarker) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf(nextMarker, start + heading.length);
  return text.slice(start, next === -1 ? undefined : next);
}

function assertRedTeamStep(text) {
  const body = sliceSection(text, HEADING, '\n## ');
  assert.ok(body, `heading not found: ${HEADING}`);
  assert.ok(body.includes('fail closed'), 'section must name a guard whose job is to fail closed');
  assert.ok(body.includes('## Open Questions'), 'section must allow listing a missing class as an Open Question');
  for (const bullet of CLASS_BULLETS) {
    assert.ok(body.includes(bullet), `section must name the input class ${JSON.stringify(bullet)}`);
  }
}

function assertLensQuestion(text) {
  const body = sliceSection(text, '### 3c: Error Handling', '\n### ');
  assert.ok(body, 'lens 3c heading not found');
  assert.ok(body.includes(LENS_QUESTION), 'lens 3c must carry the fail-closed guard question');
}

test('AC1.1: red-team.md carries the fail-closed guard detection step', () => {
  assertRedTeamStep(RED_TEAM);
});

test('AC1.1: lens 3c carries the fail-closed guard question', () => {
  assertLensQuestion(LENS);
});

test('AC2.1: the red-team step names the three input classes: empty, unreadable, malformed', () => {
  const body = sliceSection(RED_TEAM, HEADING, '\n## ').toLowerCase();
  for (const word of ['empty', 'unreadable', 'malformed']) {
    assert.ok(body.includes(word), `section must name the ${word} input class`);
  }
});

test('the detection step sits between the Cross-AC literal check and Parallel dispatch', () => {
  const crossAcIdx = RED_TEAM.indexOf('## Cross-AC literal check');
  const stepIdx = RED_TEAM.indexOf(HEADING);
  const parallelIdx = RED_TEAM.indexOf('## Parallel dispatch');
  assert.ok(crossAcIdx !== -1 && stepIdx !== -1 && parallelIdx !== -1, 'all three headings must exist');
  assert.ok(crossAcIdx < stepIdx && stepIdx < parallelIdx, 'step must follow Cross-AC check and precede Parallel dispatch');
});

test('AC1.1 go-red: removing the red-team section fails the same assertion', () => {
  const body = sliceSection(RED_TEAM, HEADING, '\n## ');
  assert.throws(() => assertRedTeamStep(RED_TEAM.replace(body, '')));
});

test('AC2.1 go-red: removing any one input-class bullet fails the same assertion', () => {
  for (const bullet of CLASS_BULLETS) {
    assert.throws(() => assertRedTeamStep(RED_TEAM.split(bullet).join('- **Removed**')), `removing ${bullet} must fail`);
  }
});

test('AC1.1 go-red: removing the lens 3c question fails the same assertion', () => {
  assert.throws(() => assertLensQuestion(LENS.replace(LENS_QUESTION, '')));
});
```

  Run: `node --test tests/specify-review-fail-closed-guard-conformance.test.js`
  Expected: FAIL (the heading and the lens question do not exist yet; the go-red tests also fail because `RED_TEAM.replace('', '')` leaves the text unchanged and the assertion already throws, so `assert.throws` passes there. Only the first four tests are required to fail before Step 2).

- [ ] **Step 2: Implement.**

  (a) In `plugin/skills/specify/red-team.md`, insert this section verbatim immediately before the line `## Parallel dispatch`, after the Cross-AC check's `Why: #3311's …` paragraph, with one blank line on each side:

```markdown
## Fail-closed guard detection (deterministic, runs before persona dispatch)

Before dispatching the personas below, scan the sub-issue's composed Acceptance Criteria and Deliverables for a prose guard whose job is to fail closed: a rule in skill prose that holds, stops, or refuses unless a condition is met ("never arm unless", "hold when", "only when every … carries"). When one fires, the record must state the guard's outcome for each of three input classes, or list each missing one as an `## Open Questions` row:

- **Empty input set**: an `every`/`all` condition over zero items is vacuously true, so say whether an empty set holds or passes.
- **Unreadable source**: a failed label, comment, file, or API read. Say that it holds, never that it passes.
- **Malformed value**: present but unparseable or out of shape, including an undefined placeholder.

A missing class is a `critical` finding (persona column `Fail-Closed Guard Check`) and flows through the write-back procedure like a persona finding. Its resolution adds a branch to the guard's own test list, so it is decision-worthy: stage-or-ask per write-back step 5. With no fail-closed guard in the text, the check is a no-op.

Why: #3877's tidy `## Arm ready PR` guard pinned only that its rule text existed. Review then found an `every` quantifier vacuously true on an empty set and failed reads with no stated outcome, which cost a fix wave and six added pins.
```

  (b) In `plugin/skills/review/step3-lens-dispatch.md`, append this bullet as the last item of the `### 3c: Error Handling` list (directly after the bullet beginning `- Before staging a fix for an asymmetry`):

```markdown
- For a prose guard that must fail closed (hold, never pass), does an `every`/`all` quantifier in its rule still hold over an empty set, and is a failed read a hold rather than a pass? (#3965: #3877's guard was vacuously true on an empty set. `specify/red-team.md`'s fail-closed guard detection asks the same at shaping time.)
```

- [ ] **Step 3: Run.** `node --test tests/specify-review-fail-closed-guard-conformance.test.js`: PASS (7/7). Also run the neighbouring pins on both files: `node --test tests/specify-red-team-cross-ac-literal-check.test.js tests/subagent-contract-clauses.test.js tests/multi-agent-coordination.test.js tests/review-dispatch-composition.test.js`: PASS. Then `wc -c plugin/skills/review/step3-lens-dispatch.md` must stay under 52,500.

- [ ] **Step 4: Commit.** One commit: `Add fail-closed guard failure-branch checks to red-team and lens 3c — empty, unreadable, malformed`, body `refs #3965`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (red-team detection step that states the outcome for empty/unreadable/malformed or lists them as Open Questions) → Step 2(a). Deliverable 2 (lens 3c question on `every`/`all` over an empty set and a failed read as a hold) → Step 2(b). AC1.1 → tests `AC1.1: red-team.md carries…`, `AC1.1: lens 3c carries…`, and the two `AC1.1 go-red` controls (fails when either sentence is removed). AC2.1 → test `AC2.1: the red-team step names the three input classes…` and its go-red control. AC3.1 (`npm test` passes) → covered by `/build` Common Step 5 / `/test` full-suite verification, not by a test in this file.

Waived AC3.1: a suite-level outcome, verified by the full-suite runner rather than asserted by a pin.
- **Placeholders:** none.
