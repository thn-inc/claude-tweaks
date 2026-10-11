# plugin-structure.md Build/Dispatch Rows and Not-Spec-Shaped Remedy Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/plugin-structure.md`'s build and dispatch rows list every sub-file (pinned by a completeness test, as the flow and tidy rows already are), the not-spec-shaped report's remedy selection is pinned by a test, and `tests/dispatch-named-form-exclusion-reasons.test.js` derives its reason list from `queue-pull-script.md` instead of hand-copying it.

**Architecture:** Task 1 adds the missing file names (and a one-clause description each) to the two table rows, plus `tests/build-dispatch-subfile-table-completeness.test.js` modeled on `tests/flow-subfile-table-completeness.test.js`. Task 2 edits `tests/dispatch-named-form-exclusion-reasons.test.js` only: a derived `REMOVING_REASONS`, a remedy-rule test, and a behavior-level no-entry assertion.

**Tech Stack:** Markdown, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-10T143833-spec-3093-3094-3087/spec-3087/work/3087-spec.md` (including its two `## Absorbed:` sections — review-6 of v6.139.1 and review-5 of v6.139.2)

## Global Constraints

- The completeness test reads row column 1 the same way the flow test does: `/^\| {skill} \| ([^|]+) \|/m`, names split on `,` and trimmed — so each added name must appear inside column 1, comma-separated, with no `|`.
- `docs/plugin-structure.md` is maintainer-side (not shipped); no byte ceiling applies.
- Commit style `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa`.

## Review Focus

- **The derivation must not go vacuous** — if the bullet pattern stops matching, `REMOVING_REASONS` becomes `[]` and every per-reason loop passes. Pinned by a non-empty + `not-spec-shaped`-present assertion.
- **`oversized` must stay out** — it is the one reason whose entries stay in `dispatch-groups.json`. Pinned by an explicit assertion.

---

### Task 1: List every build and dispatch sub-file and pin both rows

**Files:**
- Modify: `docs/plugin-structure.md:87` (build row) and `:105` (dispatch row)
- Create: `tests/build-dispatch-subfile-table-completeness.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/build-dispatch-subfile-table-completeness.test.js`:

```js
'use strict';

// Build and dispatch sub-file table completeness guard (#3087).
//
// The same drift tests/flow-subfile-table-completeness.test.js (#1136) and
// tests/tidy-subfile-table-completeness.test.js close for their rows: a new
// plugin/skills/{skill}/*.md file that never lands in docs/plugin-structure.md's
// `| {skill} | ... |` row. Two release reviews in a row (v6.139.0 review-12,
// v6.139.1 review-6) found build and dispatch files missing from theirs.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const STRUCTURE = readText(path.join(ROOT, 'docs/plugin-structure.md'));

for (const skill of ['build', 'dispatch']) {
  test(`every plugin/skills/${skill}/*.md sibling file appears in the ${skill} row of docs/plugin-structure.md`, () => {
    const siblingFiles = fs.readdirSync(path.join(ROOT, 'plugin/skills', skill))
      .filter((name) => name.endsWith('.md') && name !== 'SKILL.md');
    assert.ok(siblingFiles.length > 0, `expected at least one ${skill} sub-file -- a glob/path mistake would make this test vacuous`);

    const rowMatch = STRUCTURE.match(new RegExp(`^\\| ${skill} \\| ([^|]+) \\|`, 'm'));
    assert.ok(rowMatch, `docs/plugin-structure.md is missing a '| ${skill} | ... |' row`);
    const listedFiles = new Set(rowMatch[1].split(',').map((s) => s.trim()));

    for (const file of siblingFiles) {
      assert.ok(listedFiles.has(file), `docs/plugin-structure.md's ${skill} row is missing ${file}`);
    }
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/build-dispatch-subfile-table-completeness.test.js`
Expected: FAIL — build row missing `adopted-branch-collision-check.md`, `cherry-pick-provenance-check.md`, `execution-mode-policy.md`, `micro-plan.md` (the assertion names the first one it hits); dispatch row missing `not-spec-shaped-exclusion-report.md`.

- [ ] **Step 3: Add the missing names and descriptions**

In `docs/plugin-structure.md`:

- Build row (line 87), column 1: append `, adopted-branch-collision-check.md, cherry-pick-provenance-check.md, execution-mode-policy.md, micro-plan.md` after `already-shipped-assessment.md`. Column 2: append before the closing ` |` of the row:
  `; adopted-branch-collision-check.md holds the remote-only collision check run when Common Step 1 skips worktree creation (a dispatched group, a multi-spec shared worktree, an adopted session worktree) — classifies a same-name origin branch as absent / mine / foreign / unreachable and stops the build on a foreign or relation-unknown one (#2844); cherry-pick-provenance-check.md holds Common Step 2's per-commit stop for a cherry-pick whose source is still backing another record's open PR (#1957); execution-mode-policy.md records why subagent and batched are the only licensed execution strategies (#491); micro-plan.md holds Spec Step 3's micro-plan path, composing a one-task plan for a fast-lane size:low record whose Key Files name at most one implementation file instead of invoking /superpowers:writing-plans (#1911)`
- Dispatch row (line 105), column 1: append `, not-spec-shaped-exclusion-report.md` after `close-out-confirmation.md`. Column 2: append before the closing ` |`:
  `; not-spec-shaped-exclusion-report.md holds Step 3's per-record not-spec-shaped exclusion line and its remedy selection (a missing Release Note alone → /claude-tweaks:tidy, anything else → /claude-tweaks:specify #N; #2829), and is cited by the #N / #N,#M bullets (#3084)`

Each row stays one physical line.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test tests/build-dispatch-subfile-table-completeness.test.js tests/flow-subfile-table-completeness.test.js tests/tidy-subfile-table-completeness.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/plugin-structure.md tests/build-dispatch-subfile-table-completeness.test.js
git commit -m "List every build and dispatch sub-file in plugin-structure.md — and pin both rows with a completeness test (#3087)

Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa"
```

### Task 2: Pin the remedy rule and derive the removing-reason list

**Files:**
- Modify: `tests/dispatch-named-form-exclusion-reasons.test.js` (lines 15-22 and 41; append one test)

- [ ] **Step 1: Write the failing changes**

Replace lines 21-22:

```js
// Every reason queue-pull-script.md's passes drop a candidate from dispatch-groups.json for.
const REMOVING_REASONS = ['blocked', 'open-pr', 'not-spec-shaped', 'target-missing', 'shipped'];
```

with

```js
const QUEUE_PULL = readText(path.join(DISPATCH, 'queue-pull-script.md'));
const NOT_SPEC_SHAPED_REPORT = readText(path.join(DISPATCH, 'not-spec-shaped-exclusion-report.md'));

// Every reason queue-pull-script.md's passes drop a candidate from dispatch-groups.json for, read from
// its own `- \`reason: '...'\`` bullets (#3087): a bullet whose entries stay IN dispatch-groups.json
// (today `oversized`) is not a removing reason. A reason added to the script is checked here unedited.
const REMOVING_REASONS = QUEUE_PULL.split('\n')
  .map((line) => ({ line, m: line.match(/^- `reason: '([a-z-]+)'`/) }))
  .filter(({ m }) => m)
  .filter(({ line }) => !line.includes('stay IN `dispatch-groups.json`'))
  .map(({ m }) => m[1]);

test('REMOVING_REASONS is derived from queue-pull-script.md, non-empty, and excludes oversized (#3087)', () => {
  assert.ok(REMOVING_REASONS.length >= 5, `derived only ${JSON.stringify(REMOVING_REASONS)} -- the bullet pattern no longer matches queue-pull-script.md`);
  assert.ok(REMOVING_REASONS.includes('not-spec-shaped'));
  assert.ok(!REMOVING_REASONS.includes('oversized'), 'oversized groups stay in dispatch-groups.json; it is not a removing reason');
});
```

Replace line 41's assertion:

```js
  assert.ok(SINGLE.includes('no entry at all as absent from this firing\'s queue'), '#N bullet must say what to report when no exclusion entry names the record');
```

with

```js
  assert.match(SINGLE, /no entry at all/, '#N bullet must say what to report when no exclusion entry names the record');
```

Append:

```js
test('not-spec-shaped-exclusion-report.md routes a lone missing Release Note to /claude-tweaks:tidy and anything else to /claude-tweaks:specify #N (#3087)', () => {
  const start = NOT_SPEC_SHAPED_REPORT.indexOf('**Remedy selection:**');
  assert.notStrictEqual(start, -1, 'Remedy selection paragraph not found -- anchor out of sync with the live file');
  const rule = NOT_SPEC_SHAPED_REPORT.slice(start, NOT_SPEC_SHAPED_REPORT.indexOf('\n\n', start)).replace(/\s+/g, ' ');
  assert.match(rule, /when `missing` is exactly `\["Release Note"\]`, the remedy is `` `\/claude-tweaks:tidy` ``/);
  assert.match(rule, /Any other `missing` set .* gets `` `\/claude-tweaks:specify #\{number\}` ``/);
  assert.ok(NOT_SPEC_SHAPED_REPORT.includes('`#{number} excluded — not spec-shaped (missing: {missing, comma-joined}). Run {remedy}.`'),
    'the per-record line the remedy is spliced into is missing');
});
```

- [ ] **Step 2: Run to verify the new tests behave**

Run: `node --test tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: PASS. (This task pins existing prose — the RED evidence is a scratch mutation: temporarily edit a copy of the remedy paragraph's `["Release Note"]` to `["Deliverables"]` in a scratch checkout, or reason it through, and confirm the remedy test fails; and replace the oversized bullet's "stay IN" phrase in a scratch copy and confirm the derivation test fails. Do not commit either mutation.)

- [ ] **Step 3: Commit**

```bash
git add tests/dispatch-named-form-exclusion-reasons.test.js
git commit -m "Pin the not-spec-shaped remedy rule and derive REMOVING_REASONS from queue-pull-script.md (#3087)

Claude-Session: https://claude.ai/code/session_01TTWaqgMumX4GGXgtA8CkKa"
```
