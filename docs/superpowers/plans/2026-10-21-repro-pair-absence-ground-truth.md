# Reproduction-pair absence-claim ground-truth check (#3329) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Review's lens dispatch warns agents off inferring code state from a plan's code listings, and a reproduction-pair disagreement whose unpaired side claims code is absent gets one `grep -n`/`Read` check against the live file before it is staged, so a refuted absence claim is dropped instead of reaching the Review Console as low-confidence.

**Architecture:** Two prose insertions into one skill sub-file, `plugin/skills/review/step3-lens-dispatch.md`, plus one new `node --test` conformance suite that pins both and proves each pin can go red. No code under `plugin/bin/` changes. `categorise-reproduction` is untouched: the check runs in the reviewing agent's own thread after it returns, before the STAGED write.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-20T215906-record-3329/work/3329-spec.md` (materialized from GitHub issue #3329)

## Global Constraints

- Both insertions sit **outside** the byte-identical `CALIBRATION (required):` ... `Self-check before sending` block (it must stay byte-identical to `_shared/criteria-review-quality.md`).
- Rail: `plugin/skills/review/step3-lens-dispatch.md` is 49,058 B at the merge base `cd9545839` against `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`) — 93.4%, already `nearCeiling`. The two insertions below add ~1,950 B, which leaves ~1,500 B of headroom. Remedy if a later edit breaches: move the Low-tier single-read paragraphs (lines 50-52) into a cited lazy file — not needed by this plan.
- Commit message style: `{Verb} {what} — {detail}`, body carries `refs #3329` (never `closes`/`fixes`).

## Review Focus

- An absence claim that arrives as a `BLOCKED` reply's reason, not a findings-table row (the #3249 shape) — Task 1's bullet names `BLOCKED`/`NEEDS_CONTEXT` replies explicitly; the test pins the `BLOCKED` literal.
- A check run against the plan/spec/bundle instead of the live file reproduces the very misread — the bullet says "live target file"; the test pins it.
- The `medium` tier defers STAGED writes until the cross-lens pass — the bullet orders the check before that pass; the test pins "before the cross-lens pass".
- Non-absence disagreements must keep the `unconfirmed` default — the bullet says so; the test pins "Any other disagreement keeps the `unconfirmed` default".
- Adjacent conformance suites slice this region by anchors (`review-coverage-anchor-conformance` slices Coverage note → `> **Scratch path`; `review-defect-anchor-conformance` slices defect note → Coverage note; `review-cross-lens-corroboration-conformance` requires exactly one line containing `Findings present in only one`; `multi-agent-coordination`'s `decisionLogPattern` requires unique lines for `['refuted —', 'Downgraded to unconfirmed']`) — both insertions are placed outside those slices and use none of those phrases; Step 4 runs those four suites.

---

### Task 1: Pin and add both rules [batch]

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (insert note A after the `> **Scratch path (per dispatch).**` paragraph and its `>` separator, before `> Do **not** \`Read\` the changed files`; insert bullet B directly after the `> - Findings present in only one agent's output` bullet, before `> - **Lens 3f vacuity findings need execution evidence`)
- Test: `tests/review-absence-claim-ground-truth-conformance.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: anchor literals `> **Code state comes from the live file, never from a plan's code listing.**` (note A) and `> - **An unpaired absence claim gets a ground-truth check before it is staged.**` (bullet B).

- [ ] **Step 1: Write the failing test** — create `tests/review-absence-claim-ground-truth-conformance.test.js`:

```js
// tests/review-absence-claim-ground-truth-conformance.test.js — pins #3329: review Step 3's lens
// dispatch warns agents not to infer code state from a plan/spec's own code listings, and a
// reproduction-pair disagreement whose unpaired side claims code is absent gets one grep/Read
// check against the live file before staging — a refuted claim is dropped, not staged.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-lens-dispatch.md');
const read = () => fs.readFileSync(FILE, 'utf8');

function between(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  assert.notEqual(start, -1, `missing start anchor: ${startAnchor}`);
  const end = text.indexOf(endAnchor, start);
  assert.notEqual(end, -1, `missing end anchor: ${endAnchor}`);
  return text.slice(start, end);
}

const NOTE = "> **Code state comes from the live file, never from a plan's code listing.**";
const NOTE_END = '> Do **not** `Read` the changed files';
const BULLET = '> - **An unpaired absence claim gets a ground-truth check before it is staged.**';
const ONLY_ONE = "> - Findings present in only one agent's output";
const VACUITY = '> - **Lens 3f vacuity findings need execution evidence';

function assertNote(text) {
  const sec = between(text, NOTE, NOTE_END);
  assert.match(sec, /Tell each dispatched agent explicitly/);
  assert.match(sec, /plan or spec document's code blocks show code to add, not code that exists/);
  assert.match(sec, /never infer that a function, export, or parameter is missing/);
  assert.match(sec, /`Read` or `grep -n` the actual target file/);
  assert.match(sec, /dispatch prompt/);
}

function assertBullet(text) {
  const sec = between(text, BULLET, VACUITY);
  assert.match(sec, /asserts that code is absent/);
  assert.match(sec, /function, export, parameter, or file/);
  assert.match(sec, /`BLOCKED`/);
  assert.match(sec, /one `grep -n` or `Read`/);
  assert.match(sec, /live target file/);
  assert.match(sec, /before the STAGED write/);
  assert.match(sec, /refuted by ground-truth check/);
  assert.match(sec, /Not staged\./);
  assert.match(sec, /stays `unconfirmed`/);
  assert.match(sec, /Any other disagreement keeps the `unconfirmed` default/);
  assert.match(sec, /before the cross-lens pass/);
}

test('AC2.1: the lens prompt warns against inferring code state from a plan/spec code listing', () => {
  assertNote(read());
});

test('AC2.1 go-red: dropping the never-infer clause fails the same assertions', () => {
  const mutated = read().replace(/never infer that/g, 'you may infer that');
  assert.throws(() => assertNote(mutated));
});

test('AC1.1: an unpaired absence claim is ground-truth-checked and a refuted one is not staged', () => {
  assertBullet(read());
});

test('AC1.1 go-red: dropping the not-staged outcome fails the same assertions', () => {
  const mutated = read().replace(/Not staged\./g, 'Staged.');
  assert.throws(() => assertBullet(mutated));
});

test('placement: note after Scratch path, bullet between only-one and vacuity bullets, both outside Calibration', () => {
  const d = read();
  const scratch = d.indexOf('> **Scratch path (per dispatch).**');
  const note = d.indexOf(NOTE);
  const onlyOne = d.indexOf(ONLY_ONE);
  const bullet = d.indexOf(BULLET);
  const vacuity = d.indexOf(VACUITY);
  const calib = d.indexOf('CALIBRATION (required):');
  for (const [name, i] of Object.entries({ scratch, note, onlyOne, bullet, vacuity, calib })) {
    assert.notEqual(i, -1, `${name} anchor not found`);
  }
  assert.ok(scratch < note, 'note must follow the Scratch path note');
  assert.ok(onlyOne < bullet && bullet < vacuity, 'bullet must sit between the only-one and vacuity bullets');
  assert.ok(bullet < calib, 'bullet must precede the Calibration block');
  const cal = between(d, 'CALIBRATION (required):', 'Self-check before sending');
  assert.doesNotMatch(cal, /code listing|ground-truth/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-absence-claim-ground-truth-conformance.test.js`
Expected: FAIL — `missing start anchor` (neither anchor exists at the merge base).

- [ ] **Step 3: Implement** — two insertions in `plugin/skills/review/step3-lens-dispatch.md`, exact text:

Note A — insert after the `> **Scratch path (per dispatch).** ...` paragraph line, as `>` + newline + this line (so the existing `>` separator before `> Do **not** ...` stays):

```
> **Code state comes from the live file, never from a plan's code listing.** Tell each dispatched agent explicitly: a plan or spec document's code blocks show code to add, not code that exists, so never infer that a function, export, or parameter is missing (or present) from one — before reporting any claim about current code, `Read` or `grep -n` the actual target file in the tree under review. On #3249's review, one agent of lens 3a's pair returned `BLOCKED`, naming functions and exports as missing at line numbers taken from the record's own materialized plan; every one already existed in the live files. This rule goes in the dispatch prompt alongside the scope and the `Path:Line` instruction, outside the byte-identical Calibration/Output-template block below.
```

Bullet B — insert as its own line directly after the `> - Findings present in only one agent's output ...` bullet:

```
> - **An unpaired absence claim gets a ground-truth check before it is staged.** When the side of a disagreement the other agent did not reproduce — a finding, or a `BLOCKED`/`NEEDS_CONTEXT` reply's stated reason — asserts that code is absent (a named function, export, parameter, or file does not exist at a named `path:line` or symbol), the reviewing agent runs one `grep -n` or `Read` for that name against the live target file, never the plan, spec, or bundle, before the STAGED write above, in every mode. This check only refutes; elevating stays the Direct-verification override's job. Found → the claim is refuted: drop it and stage nothing. Write `AUTO {HH:MM:SS} — Reproduction: lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {path}:{line}). Not staged. Reversibility: high.` Not found → it stays `unconfirmed` and is staged as above. Any other disagreement keeps the `unconfirmed` default. At `medium`, run the check before the cross-lens pass, so a refuted claim never reaches it.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-absence-claim-ground-truth-conformance.test.js tests/review-coverage-anchor-conformance.test.js tests/review-defect-anchor-conformance.test.js tests/review-cross-lens-corroboration-conformance.test.js tests/review-vacuity-evidence-conformance.test.js tests/multi-agent-coordination.test.js tests/subagent-contract-clauses.test.js`
Expected: PASS, 0 failures. Then `wc -c plugin/skills/review/step3-lens-dispatch.md` — Expected: under 52500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/review/step3-lens-dispatch.md tests/review-absence-claim-ground-truth-conformance.test.js
git commit -m "Ground-truth-check reproduction-pair absence claims — refuted 'code is missing' claims drop instead of staging (refs #3329)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (prompt warning) → note A, AC2.1 tests. Deliverable 2 (mechanical escape hatch, refuted → not staged) → bullet B, AC1.1 tests. Both ACs cited by id.
- **Placeholders:** none.
- **Proportion:** one task, two inlined insertions plus their test — transcription-only, hence `**Execution:** batched`.
