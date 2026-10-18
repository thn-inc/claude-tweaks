# Reader-inventory derivation check (#3397) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:build`'s plan-authoring checks tell a plan to derive an "every reader of X" inventory from the value's read call sites, with literal-text greps a supplement only.

**Architecture:** One new bold-paragraph check in `plugin/skills/build/plan-authoring-checks.md`, inserted directly after the Dependency-caller enumeration check (it extends the Consumer-enumeration check, its nearest neighbour), plus one live-corpus prose conformance test modelled on `tests/plan-authoring-ac-clause-ids-prose.test.js`.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T214423-record-3397/work/3397-spec.md` (materialized from GitHub issue #3397)

## Global Constraints

- The check is one bold paragraph (`**{label}:** …`), in the neighbouring checks' voice: rule, why a task-level review misses it, the motivating incident and its cost.
- #3358's six missed readers are cited in one sentence.
- Commit messages say `refs #3397`, never `closes`/`fixes`.
- `plan-authoring-checks.md` stays under `RAIL_BYTES` (52,500 B); it is 33,732 B on the merge base and grows by ~1.4 KB.

## Review Focus

- A paragraph that matches the label twice (copy-paste) — the test asserts exactly one hit.
- A paraphrased call-site list that drops a member — the test pins each call-site form as a literal (Dispatcher-voice check's "pin each member as a literal").
- A negative control that cannot fail (Go-red control check) — both controls call the same `assertReaderInventoryCheck` the positive test calls and expect it to throw.
- CRLF checkout — paragraphs split on `/\r?\n\r?\n/`, same as the sibling test.

---

### Task 1: Add the Reader-inventory derivation check and its conformance test

**Files:**
- Modify: `plugin/skills/build/plan-authoring-checks.md` (insert a new paragraph between the `**Dependency-caller enumeration check (extends the Consumer-enumeration check):**` paragraph and the `**Acceptance-criterion clause-id check:**` paragraph, separated by blank lines)
- Test: `tests/plan-authoring-reader-inventory-prose.test.js` (Create)

**Interfaces:**
- Produces: the paragraph whose first characters are `**Reader-inventory derivation check (extends the Consumer-enumeration check):**`.

- [ ] **Step 1: Write the failing test** — create `tests/plan-authoring-reader-inventory-prose.test.js` exactly:

```js
// tests/plan-authoring-reader-inventory-prose.test.js — pins #3397's
// plan-authoring rule: plugin/skills/build/plan-authoring-checks.md tells
// plan authors to derive an "every reader of X" inventory from the value's
// read call sites, with literal-text greps a supplement only. Reads the live
// skill file (prose we just wrote — the skill-prose-conformance-tests
// live-vs-fixture distinction). The paragraph is located by its bold label
// and every assertion runs on that paragraph alone. Both negative controls
// run the same assertion function the positive test runs and expect it to
// throw: one against the pre-change file shape (this paragraph absent), one
// against the paragraph with its key phrase reworded.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEXT = fs.readFileSync(
  path.join(__dirname, '..', 'plugin', 'skills', 'build', 'plan-authoring-checks.md'),
  'utf8',
);

const LABEL = '**Reader-inventory derivation check (extends the Consumer-enumeration check):**';
const KEY_PHRASE = "derive the plan's reader inventory from the value's read call sites";

const CALL_SITES = [
  '`--json comments`',
  '`/comments` REST paths',
  '`issue_read`/`get_comments`',
  '`.comments[]`',
  '`listComments`',
];

const MISSED_READERS = [
  '`tidy/SKILL.md`',
  '`release/bookkeeping.md`',
  '`_shared/headless-self-report.md`',
  '`assess-agent-autonomy/failure-check.md`',
  '`dispatch/settle-and-merge.md`',
  '`health-core/materiality-digest.js`',
];

function assertReaderInventoryCheck(text) {
  const hits = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith(LABEL));
  assert.strictEqual(hits.length, 1, 'expected exactly one Reader-inventory derivation check paragraph');
  const p = hits[0];
  assert.ok(p.includes('"at every reader of"'), 'names the "at every reader of" trigger');
  assert.ok(p.includes(KEY_PHRASE), 'names read-call-site derivation');
  for (const site of CALL_SITES) assert.ok(p.includes(site), `names call-site form ${site}`);
  assert.ok(p.includes('classify each hit'), 'tells the plan to classify each hit');
  assert.ok(p.includes('a supplement, never the source'), 'demotes literal-text greps');
  assert.ok(p.includes("#3358's plan"), 'cites #3358');
  for (const reader of MISSED_READERS) assert.ok(p.includes(reader), `names missed reader ${reader}`);
}

test('AC1.1 + AC2.1 (#3397): plan-authoring-checks.md carries the Reader-inventory derivation check', () => {
  assertReaderInventoryCheck(TEXT);
});

test('AC2.1 (#3397): negative control — the pre-change file (paragraph absent) fails the pin', () => {
  const preChange = TEXT.split(/\r?\n\r?\n/).filter((p) => !p.startsWith(LABEL)).join('\n\n');
  assert.notStrictEqual(preChange, TEXT, 'control must actually remove the paragraph');
  assert.throws(() => assertReaderInventoryCheck(preChange));
});

test('AC2.1 (#3397): negative control — rewording the key phrase fails the pin', () => {
  const mutated = TEXT.replace(KEY_PHRASE, "derive the plan's reader inventory from literal greps");
  assert.notStrictEqual(mutated, TEXT, 'control must actually reword the phrase');
  assert.throws(() => assertReaderInventoryCheck(mutated));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan-authoring-reader-inventory-prose.test.js`
Expected: FAIL — the positive test fails with "expected exactly one Reader-inventory derivation check paragraph", and the "pre-change" control fails with "control must actually remove the paragraph" (nothing to remove yet).

- [ ] **Step 3: Insert the paragraph** into `plugin/skills/build/plan-authoring-checks.md` at the position named in Files, exactly this copy (one line):

```markdown
**Reader-inventory derivation check (extends the Consumer-enumeration check):** when a spec's deliverables say to apply something "at every reader of" a value — comments, markers, labels, files — derive the plan's reader inventory from the value's read call sites, never from its literal text: find every place code or skill prose reads that kind of value (`--json comments`, `/comments` REST paths, `issue_read`/`get_comments`, `.comments[]`, `listComments`, and so on), then classify each hit as a reader of this value or not, and record the classification in the task's Files block. A grep for the value's literal text (a marker prefix, a heading) is a supplement, never the source: a reader that matches on a plain sentence, or on a prefix the grep never named, still sits on one of those read call sites but is invisible to the literal grep, and a task-level review that compares the plan's inventory against the implemented diff finds the two consistent. #3358's plan derived its marker-reader inventory from greps for marker literals and missed six readers that match on plain sentences or unnamed prefixes — `tidy/SKILL.md`'s parent-gate re-query, `release/bookkeeping.md`'s `Shipped in v…` check, `_shared/headless-self-report.md`'s `Resolved build:` check, the retry-marker prose callers `assess-agent-autonomy/failure-check.md` and `dispatch/settle-and-merge.md`, and `health-core/materiality-digest.js` — of which the whole-branch review caught four and `/claude-tweaks:review`'s lens 3b one more, at the cost of an extra fix wave, a re-review and two PR-body inventory rewrites.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plan-authoring-reader-inventory-prose.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the sibling pin to confirm the insertion did not disturb it**

Run: `node --test tests/plan-authoring-ac-clause-ids-prose.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/plan-authoring-checks.md tests/plan-authoring-reader-inventory-prose.test.js
git commit -m "Add reader-inventory derivation check to /build plan-authoring checks — refs #3397"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (the check, its call-site list, classify-each-hit, literal greps as supplement) → Step 3 paragraph, pinned by `assertReaderInventoryCheck`. Deliverable 2 (#3358's six readers in one sentence) → the paragraph's final sentence, pinned by `MISSED_READERS`. AC1.1 → positive test. AC2.1 → positive test plus two negative controls that call the same assertion function.
- **Placeholders:** none.
