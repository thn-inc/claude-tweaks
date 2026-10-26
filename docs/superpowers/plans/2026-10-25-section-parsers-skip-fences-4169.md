# Section Parsers Skip Fenced Code Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `extractSection` and `sectionText` stop treating `## Heading` lines inside fenced code blocks as the record's own section headings, so `shapeGate` judges a record by its own sections, not by a quoted document's.

**Architecture:** Lift the fence-detection loop out of `stripCodeSpans` (`materialize-format.js`) into one helper, `fencedLineRanges(lines)`, placed beside `fenceFor` in `record-payload.js` (the module that writes fences). `stripCodeSpans` keeps its output byte-identical by iterating the helper's ranges; `extractSection` skips heading/stop matches on fenced lines; `sectionText` skips heading and `\n## ` matches whose offset falls inside a fenced range. `materialize-format.js` requires `./record-payload` (no cycle: `record-payload.js` requires only `./record-vocabulary`).

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T192948-record-4169/work/4169-spec.md`

Scope keywords: extractSection, sectionText, stripCodeSpans

## Global Constraints

- Fence rule (from the spec, "matching the fence-length rule `fenceFor` writes"): a fence opens on a line starting (column 0) with 3+ backticks or 3+ tildes; it closes on the first later line that is the same character repeated at least the opening length, optionally followed by whitespace only (`^{char}{len,}\s*$`). An unclosed fence runs to end of text. This is exactly `stripCodeSpans`' existing rule — reuse it, do not invent a second one.
- Every existing caller's tests still pass (`npm test`) — AC3.
- `stripCodeSpans`' output must stay byte-identical for every input (it pushes exactly one `''` per fenced block, opener through closer/end).
- Surgical: no other behavior of either parser changes (`sectionText` keeps its substring `indexOf` heading match and `.trim()`; `extractSection` keeps its options, CRLF normalization and `''`-when-absent return).

## Review Focus

1. A quoted heading that appears *before* the real one with the same name (a fenced copy's `## Release Note` above the record's own) — the real section must win. Pinned in Task 2 (`sectionText`) and Task 1 (`extractSection`).
2. A 4-backtick fence whose content contains a 3-backtick line (the shape `fenceFor` emits around content carrying ```) — the inner ``` must not close the fence. Pinned in Task 1.
3. A tilde fence (`~~~`) — skipped the same way as backticks. Pinned in Task 1.
4. CRLF bodies (`extractSection` normalizes; `sectionText` does not) — a CRLF fenced quote still skips. Pinned in Task 2 (`sectionText` with `\r\n`).
5. An unclosed fence before the record's later real headings hides them (CommonMark semantics, the safer direction for the shape gate — the record fails the gate rather than passing on quoted text). Pinned in Task 2 so the behavior is deliberate, not accidental.

Consumer enumeration (all *pick-one* heading finders; each now sees only the record's own sections — none lists-all): `extractSection` — `plugin/bin/lib/compose-subject.js` (Release Note / Breaking Change / Overview / Current State), `plugin/bin/lib/issues/grouping.js` (Key Files), `plugin/bin/lib/issues/decomposition-crossref.js` (Gotchas / Prerequisites); `sectionText` — `shapeGate`, `plugin/bin/lib/compose-record/compose.js`, `plugin/bin/lib/release-note-repair/apply.js` and `detect.js`. Sole-site proof: `grep -rn -e extractSection -e sectionText plugin/bin` (run at authoring time; those seven files plus the two defining modules and `record.js`'s re-export are every hit).

---

### Task 1: Shared fence helper + `extractSection` skips fenced headings

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (add `fencedLineRanges` beside `fenceFor` ~line 81; change `extractSection` ~line 250; export `fencedLineRanges` from this module's `module.exports` ~line 410 — NOT from `record.js`, which stays unchanged)
- Test: `tests/bin-lib/issues/record.test.js`

**Interfaces:**
- Produces: `fencedLineRanges(lines: string[]) -> Array<[start: number, end: number]>` — inclusive line-index ranges, each from the opening fence line through its closing fence line (or `lines.length - 1` when unclosed), in ascending order, non-overlapping. Exported from `plugin/bin/lib/issues/record-payload.js`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/record.test.js`; `extractSection` is already imported there)

```js
// ---- extractSection skips fenced headings (#4169) ----
const QUOTED_COPY_BODY = [
  '## Current State',
  '',
  'The staged copy follows verbatim.',
  '',
  '````',
  '## Current State',
  'quoted state',
  '## Deliverables',
  '- [ ] quoted deliverable',
  '```',
  '## Acceptance Criteria',
  '```',
  '1. quoted AC',
  '## Release Note',
  'quoted note',
  '````',
  '',
  '~~~',
  '## Open Question',
  'tilde-quoted',
  '~~~',
  '',
  '## Deliverables',
  '- [ ] real deliverable',
  '',
  '## Open Question',
  'Is it still wanted?',
  '',
  '## Release Note',
  'No user-visible change.',
].join('\n');

test('AC1.1: extractSection returns empty for a heading that exists only inside a fence', () => {
  assert.strictEqual(extractSection(QUOTED_COPY_BODY, 'Acceptance Criteria'), '');
});

test('AC1.1: extractSection returns the whole Current State, fenced blocks included', () => {
  const cs = extractSection(QUOTED_COPY_BODY, 'Current State', { trim: true });
  assert.ok(cs.startsWith('The staged copy follows verbatim.'));
  assert.ok(cs.includes('## Acceptance Criteria\n```\n1. quoted AC'), 'the inner ``` does not close the 4-backtick fence');
  assert.ok(cs.endsWith('~~~'), 'runs through the tilde fence up to the real ## Deliverables');
  assert.ok(!cs.includes('real deliverable'));
});

test('extractSection: the record\'s own section wins over a fenced quote of the same heading', () => {
  assert.strictEqual(extractSection(QUOTED_COPY_BODY, 'Deliverables', { trim: true }), '- [ ] real deliverable');
  assert.strictEqual(extractSection(QUOTED_COPY_BODY, 'Release Note', { levelPattern: '2', stopPattern: '2', trim: true }), 'No user-visible change.');
  assert.strictEqual(extractSection(QUOTED_COPY_BODY, 'Open Question', { trim: true }), 'Is it still wanted?');
});

test('extractSection: CRLF fenced quote is skipped too', () => {
  assert.strictEqual(extractSection(QUOTED_COPY_BODY.replace(/\n/g, '\r\n'), 'Acceptance Criteria'), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: FAIL — `AC1.1` gets `'```\n1. quoted AC'` instead of `''`; the whole-Current-State test fails because Current State stops at the quoted `## Current State`.

- [ ] **Step 3: Implement**

`fencedLineRanges(lines)` in `record-payload.js`: the loop currently at the top of `stripCodeSpans` (`materialize-format.js` lines ~42-66), returning ranges instead of building output — open on `/^(`{3,}|~{3,})/`, close on `new RegExp(`^${char}{${len},}\\s*$`)`, unclosed → end `lines.length - 1`, resume scanning at `end + 1`. Comment it as the one fence rule shared by `stripCodeSpans`, `sectionText` and `extractSection` (#4169), matching what `fenceFor`/`fencedBlock` write.

`extractSection`: build a per-line `fenced` boolean array from `fencedLineRanges(lines)` (lines after CRLF normalization); `findIndex` for the heading skips fenced lines; the stop test (`stopRe`) is ignored on fenced lines (fenced lines are still pushed into the section). Add one sentence to its header comment saying headings inside fenced blocks are quoted content and never match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/compose-subject.test.js tests/bin-lib/issues/decomposition-crossref.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js tests/bin-lib/issues/record.test.js
git commit -m "Skip fenced headings in extractSection — refs #4169"
```

### Task 2: `sectionText` skips fenced headings; `stripCodeSpans` reuses the helper; shape gate judges the record's own shape

**Files:**
- Modify: `plugin/bin/lib/issues/materialize-format.js` (require `fencedLineRanges` from `./record-payload`; `stripCodeSpans` ~line 41; `sectionText` ~line 88)
- Test: `tests/bin-lib/issues/materialize-format.test.js`, `tests/bin-lib/console/shadow-dup-proposal.test.js`

**Interfaces:**
- Consumes: `fencedLineRanges(lines: string[]) -> Array<[number, number]>` from `plugin/bin/lib/issues/record-payload.js` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/issues/materialize-format.test.js`:

```js
// ---- sectionText skips fenced headings (#4169) ----
const QUOTED_BODY = [
  '## Current State',
  'The copy follows.',
  '',
  '````',
  '## Deliverables',
  '- [ ] quoted deliverable',
  '```',
  '## Acceptance Criteria',
  '```',
  '1. quoted AC',
  '## Release Note',
  'quoted note',
  '````',
  '',
  '## Deliverables',
  '- [ ] real deliverable',
  '',
  '## Open Question',
  'Is it wanted?',
  '',
  '## Release Note',
  'Real note.',
].join('\n');

test('AC1.1: sectionText returns null for a heading that exists only inside a fence', () => {
  assert.equal(sectionText(QUOTED_BODY, 'Acceptance Criteria'), null);
});

test('AC1.1: sectionText returns the whole Current State, fenced block included', () => {
  const cs = sectionText(QUOTED_BODY, 'Current State');
  assert.ok(cs.startsWith('The copy follows.'));
  assert.ok(cs.endsWith('quoted note\n````'));
});

test('sectionText: the record\'s own section wins over an earlier fenced quote of the same heading', () => {
  assert.equal(sectionText(QUOTED_BODY, 'Deliverables'), '- [ ] real deliverable');
  assert.equal(sectionText(QUOTED_BODY, 'Release Note'), 'Real note.');
});

test('sectionText: a CRLF fenced quote is skipped too', () => {
  assert.equal(sectionText(QUOTED_BODY.replace(/\n/g, '\r\n'), 'Acceptance Criteria'), null);
});

test('shapeGate: a fenced quote of a spec-shaped document does not supply the record\'s missing sections', () => {
  assert.deepEqual(shapeGate(QUOTED_BODY), { ok: false, missing: ['Acceptance Criteria'] });
});

test('sectionText: an unclosed fence hides every later heading (CommonMark: it runs to end of text)', () => {
  const body = '## Current State\nx\n\n```\nnever closed\n\n## Deliverables\n- [ ] d';
  assert.equal(sectionText(body, 'Deliverables'), null);
  assert.ok(sectionText(body, 'Current State').endsWith('- [ ] d'));
});
```

Append to `tests/bin-lib/console/shadow-dup-proposal.test.js` (add `const { shapeGate } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'materialize-format'));` beside the other requires):

```js
const LEFTOVER_COPY = [
  'Title: Leftover thing',
  'Type: task',
  '',
  '## Current State',
  'copy state',
  '',
  '## Deliverables',
  '- [ ] copy deliverable',
  '',
  '## Acceptance Criteria',
  '1. copy AC',
  '',
  '## Release Note',
  'copy note',
].join('\n');

test('AC2.1: shapeGate on a proposal quoting a spec-shaped copy reports the record\'s own shape (Open Question, not Acceptance Criteria)', () => {
  for (const anchorText of ['a different anchor', undefined]) {
    const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: LEFTOVER_COPY, anchorText, runId: 'run-1' });
    assert.equal(r.ok, true);
    assert.match(r.proposal, /^## Open Question$/m);
    assert.deepEqual(shapeGate(r.proposal), { ok: false, missing: ['Acceptance Criteria'] });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/console/shadow-dup-proposal.test.js`
Expected: FAIL — `AC1.1` gets `'```\n1. quoted AC'` instead of `null`; `AC2.1` gets `{ ok: true, missing: [] }`.

- [ ] **Step 3: Implement**

`stripCodeSpans(text)`: replace its inline fence loop with a walk over `fencedLineRanges(lines)` — copy unfenced lines through, push exactly one `''` per range — so output is byte-identical to today; keep the inline-code-span `replace` and its comment unchanged.

`sectionText(body, name)`: compute fenced character ranges from `fencedLineRanges(body.split('\n'))` (line start offsets = cumulative `length + 1`; a range spans from its first line's start to its last line's end). Find the first `indexOf(heading)` occurrence whose offset is outside every fenced range (loop with `indexOf(heading, from + 1)`); find the end as the first `indexOf('\n## ', afterHeading)` whose `## ` (offset + 1) is outside every fenced range. Everything else (null when absent, `.trim()`) unchanged. Update its header comment: "…up to the next `## ` heading outside a fenced block (or end of body). null when the heading is absent outside fences."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/console/shadow-dup-proposal.test.js tests/bin-lib/issues/record.test.js`
Expected: PASS, 0 failures (includes every pre-existing `stripCodeSpans` / `shapeGate` test).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/materialize-format.js tests/bin-lib/issues/materialize-format.test.js tests/bin-lib/console/shadow-dup-proposal.test.js
git commit -m "Skip fenced headings in sectionText and share the fence rule — refs #4169"
```

### Task 3: Consumer regression run (read-only — added by Check B, scope-creep=add-to-plan)

Plan-audit Check B matched these files on the scope keywords. None needs a code change — each is a pick-one consumer (see Review Focus's consumer enumeration) or a historical doc — so this task adds them to the plan as a verification step rather than as edits:

**Files** (every path read-only — verified, never edited):
- Test: `plugin/bin/lib/compose-subject.js`
- Test: `plugin/bin/lib/issues/grouping.js`
- Test: `plugin/bin/lib/issues/decomposition-crossref.js`
- Test: `plugin/bin/lib/compose-record/compose.js`
- Test: `plugin/bin/lib/release-note-repair/apply.js`
- Test: `plugin/bin/lib/release-note-repair/detect.js`
- Test: `plugin/bin/lib/issues/record.js`
- Test: `plugin/bin/lib/issues/ambiguity-resolve.js`
- Test: `tests/bin-lib/compose-subject.test.js`
- Test: `tests/bin-lib/issues/decomposition-crossref.test.js`
- Test: `tests/health-filing-parity.test.js`
- Test: `tests/ceremony-profile-roster.test.js`
- Test: `tests/help-acceptance-queue-local-files.test.js`
- Test: `tests/review-build-not-run-conformance.test.js`
- Test: `tests/specify-red-team-cross-ac-literal-check.test.js`
- Test: `docs/plans/2026-10-23-spec-3946-3949-3816-3950-ledger.md`
- Test: `docs/superpowers/plans/2026-10-24-compose-subject-filed-by-footer-4014.md`

(`record.js` is a re-export only; `ambiguity-resolve.js` and the two docs only mention a keyword in prose.)

- [ ] **Step 1: Run the consumer suites**

Run: `node --test tests/bin-lib/compose-subject.test.js tests/bin-lib/issues/decomposition-crossref.test.js tests/bin-lib/issues/grouping.test.js tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js tests/bin-lib/release-note-repair/apply.test.js tests/bin-lib/release-note-repair/detect.test.js tests/bin-lib/release-note-repair/cli.test.js tests/health-filing-parity.test.js tests/ceremony-profile-roster.test.js tests/help-acceptance-queue-local-files.test.js tests/review-build-not-run-conformance.test.js tests/specify-red-team-cross-ac-literal-check.test.js`
Expected: PASS, 0 failures. No commit (nothing changes).

Waived AC3.1: the full `npm test` run is `/claude-tweaks:build` Common Step 5's verification (and `/claude-tweaks:test`'s gate), not a task step; Task 3 runs the targeted consumer suites ahead of it.
