'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  extractFileEntries, extractScopeKeywords, extractPremiseRefs, extractTaskBlocks,
  extractStep2Verification, extractVerificationChecks, extractUnparseableStep2s, countTasks,
} = require('../../../plugin/bin/lib/plan-audit/parser');

test('extractFileEntries reads Create/Modify/Delete/Test bullets, backticked and bare', () => {
  const text = [
    '**Files:**',
    '- Create: `tests/foo.test.js`',
    '- Modify: `plugin/bin/lib/foo.js`',
    '- Delete: plugin/bin/lib/old.js',
    '- Test: `tests/bar.test.js`',
  ].join('\n');
  const entries = extractFileEntries(text);
  assert.deepStrictEqual(entries, [
    { type: 'Create', path: 'tests/foo.test.js' },
    { type: 'Modify', path: 'plugin/bin/lib/foo.js' },
    { type: 'Delete', path: 'plugin/bin/lib/old.js' },
    { type: 'Test', path: 'tests/bar.test.js' },
  ]);
});

test('extractFileEntries strips a trailing line-range suffix', () => {
  const text = '- Modify: `plugin/skills/flow/materialize.md:142-147` (the example block)';
  assert.deepStrictEqual(extractFileEntries(text), [
    { type: 'Modify', path: 'plugin/skills/flow/materialize.md' },
  ]);
});

test('extractFileEntries collects bullets across multiple per-task Files: sections', () => {
  const text = [
    '### Task 1: First',
    '**Files:**',
    '- Modify: `a.js`',
    '',
    '### Task 2: Second',
    '**Files:**',
    '- Create: `b.js`',
  ].join('\n');
  assert.deepStrictEqual(extractFileEntries(text), [
    { type: 'Modify', path: 'a.js' },
    { type: 'Create', path: 'b.js' },
  ]);
});

test('extractFileEntries returns empty for "Files:** none"', () => {
  assert.deepStrictEqual(extractFileEntries('**Files:** none (verification only).'), []);
});

test('extractScopeKeywords parses a comma-separated list, trimmed and de-duplicated', () => {
  const text = 'Some prose.\nScope keywords: playwright-cli, claude_in_chrome , playwright-cli\nMore prose.';
  assert.deepStrictEqual(extractScopeKeywords(text), ['playwright-cli', 'claude_in_chrome']);
});

test('extractScopeKeywords returns empty when the field is absent', () => {
  assert.deepStrictEqual(extractScopeKeywords('No such field here.'), []);
});

test('extractPremiseRefs parses a comma-separated list of paths/URLs, trimmed and de-duplicated', () => {
  const text = 'Some prose.\nPremise-refs: db/migrations/001.sql, https://example.com/spec , db/migrations/001.sql\nMore prose.';
  assert.deepStrictEqual(
    extractPremiseRefs(text),
    ['db/migrations/001.sql', 'https://example.com/spec'],
  );
});

test('extractPremiseRefs returns empty when the field is absent', () => {
  assert.deepStrictEqual(extractPremiseRefs('No such field here.'), []);
});

test('extractTaskBlocks splits on ### Task N: headings', () => {
  const text = '### Task 1: A\nbody1\n### Task 2: B\nbody2\n';
  const tasks = extractTaskBlocks(text);
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].taskNumber, '1');
  assert.match(tasks[0].body, /body1/);
  assert.strictEqual(tasks[1].taskNumber, '2');
  assert.match(tasks[1].body, /body2/);
});

test('extractStep2Verification matches by step NUMBER, not by wording', () => {
  const body = [
    '- [ ] **Step 1: Write the failing test**',
    '',
    'some setup',
    '',
    '- [ ] **Step 2: Run the new tests to verify they fail**',
    '',
    'Run: `node --test tests/foo.test.js`',
    'Expected: FAIL — assertion not yet true',
    '',
    '- [ ] **Step 3: Implement**',
  ].join('\n');
  const result = extractStep2Verification(body);
  assert.deepStrictEqual(result, {
    command: 'node --test tests/foo.test.js',
    expected: 'FAIL — assertion not yet true',
  });
});

test('extractStep2Verification returns null when the task has no Step 2 Run:/Expected: pair', () => {
  const body = '- [ ] **Step 1: Update the docs**\n\nNo run/expected pair here.\n';
  assert.strictEqual(extractStep2Verification(body), null);
});

test('extractVerificationChecks only returns tasks whose Expected starts with FAIL', () => {
  const text = [
    '### Task 1: Code task',
    '- [ ] **Step 2: Run test to verify it fails**',
    '',
    'Run: `node --test a.test.js`',
    'Expected: FAIL with "not defined"',
    '',
    '### Task 2: Doc-only task',
    '- [ ] **Step 1: Update the doc**',
    '',
    'No verification command here.',
    '',
    '### Task 3: Post-implementation check (not Check C scope)',
    '- [ ] **Step 4: Run test to verify it passes**',
    '',
    'Run: `node --test a.test.js`',
    'Expected: PASS',
  ].join('\n');
  const checks = extractVerificationChecks(text);
  assert.strictEqual(checks.length, 1);
  assert.strictEqual(checks[0].taskNumber, '1');
  assert.strictEqual(checks[0].command, 'node --test a.test.js');
});

test('extractUnparseableStep2s: absent when a task has no Step 2 checkbox line at all', () => {
  const text = [
    '### Task 1: Doc-only task',
    '- [ ] **Step 1: Update the doc**',
    '',
    'No Step 2 here at all.',
  ].join('\n');
  assert.deepStrictEqual(extractUnparseableStep2s(text), []);
});

test('extractUnparseableStep2s: absent when Step 2 parses cleanly', () => {
  const text = [
    '### Task 1: Clean task',
    '- [ ] **Step 2: Run the new tests to verify they fail**',
    '',
    'Run: `node --test tests/foo.test.js`',
    'Expected: FAIL — assertion not yet true',
  ].join('\n');
  assert.deepStrictEqual(extractUnparseableStep2s(text), []);
});

test('extractUnparseableStep2s: flags a Step 2 whose command sits in a fenced code block with no Run: label (real drift shape, #1594)', () => {
  const text = [
    '### Task 1: Add the needs:decision label',
    '**Files:**',
    '- Modify: `work-record.md`',
    '',
    '- [ ] **Step 2: Run it to confirm FAIL**',
    '',
    '```bash',
    'node --test tests/work-record-needs-decision-conformance.test.js',
    '```',
    '',
    'Expected: FAIL on the first four tests (the go-red control test passes immediately).',
    '',
    '- [ ] **Step 3: Add the row**',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '1');
  assert.strictEqual(result[0].title, 'Add the needs:decision label');
  assert.ok(result[0].raw.includes('Step 2: Run it to confirm FAIL'), `raw excerpt should include the Step 2 heading, got: ${result[0].raw}`);
});

test('extractUnparseableStep2s: flags a non-bold Step 2 checkbox line the strict extractor cannot see at all', () => {
  const text = [
    '### Task 1: Unusual formatting',
    '- [ ] Step 2: verify the fix fails without it',
    '',
    'some prose with no Run:/Expected: pair',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '1');
});

test('extractUnparseableStep2s: scans every task in a multi-task plan independently', () => {
  const text = [
    '### Task 1: Clean',
    '- [ ] **Step 2: Run test to verify it fails**',
    '',
    'Run: `node --test a.test.js`',
    'Expected: FAIL',
    '',
    '### Task 2: Unparseable',
    '- [ ] **Step 2: Confirm it fails**',
    '',
    '```bash',
    'node --test b.test.js',
    '```',
    '',
    'Expected: FAIL',
  ].join('\n');
  const result = extractUnparseableStep2s(text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].taskNumber, '2');
});

test('extractVerificationChecks captures step1Text, taskFileEntries, and appendMarker (#1999)', () => {
  const text = [
    '### Task 1: Append tests',
    '**Files:**',
    '- Modify: `tests/existing.test.js`',
    '',
    '- [ ] **Step 1: Append the new cases**',
    '',
    'Append three new `test(...)` blocks to `tests/existing.test.js`.',
    '',
    '- [ ] **Step 2: Run test to verify it fails**',
    '',
    'Run: `node --test tests/existing.test.js`',
    'Expected: FAIL — new cases not yet true',
  ].join('\n');
  const checks = extractVerificationChecks(text);
  assert.strictEqual(checks.length, 1);
  assert.match(checks[0].step1Text, /Append three new/);
  assert.deepStrictEqual(checks[0].taskFileEntries, [{ type: 'Modify', path: 'tests/existing.test.js' }]);
  assert.strictEqual(checks[0].appendMarker, false);
});

test('extractVerificationChecks detects the "FAIL after Step 1" marker (#1999)', () => {
  const text = [
    '### Task 1: Marked append',
    '- [ ] **Step 2: Run test to verify it fails**',
    '',
    'Run: `node --test tests/existing.test.js`',
    'Expected: FAIL after Step 1 appends the new cases',
  ].join('\n');
  const checks = extractVerificationChecks(text);
  assert.strictEqual(checks[0].appendMarker, true);
});

test('countTasks counts ### Task N: headings and reports batched=false by default (#1926)', () => {
  assert.deepStrictEqual(countTasks('### Task 1: Only\nbody\n'), { tasks: 1, batched: false });
  assert.deepStrictEqual(countTasks('# Plan\n\n### Task 1: A\n\n### Task 2: B\n\n### Task 3: C\n'), { tasks: 3, batched: false });
  assert.deepStrictEqual(countTasks('# Plan with no tasks\n'), { tasks: 0, batched: false });
});

test('countTasks flags a batched plan by the header marker or a [batch] task title (#1926)', () => {
  assert.deepStrictEqual(countTasks('# Plan\n\n**Execution:** batched\n\n### Task 1: A\n'), { tasks: 1, batched: true });
  assert.deepStrictEqual(countTasks('# Plan\n\n### Task 1: Same one-line fix across files [batch]\n'), { tasks: 1, batched: true });
  // The marker only counts in the header — a task BODY mentioning it is prose, not a marker.
  assert.deepStrictEqual(countTasks('# Plan\n\n### Task 1: A\n\nSee **Execution:** batched in another plan.\n'), { tasks: 1, batched: false });
});

test('countTasks ignores an **Execution:** batched line inside a fenced code block in the header (#1926)', () => {
  const text = '# Plan\n\n```\n**Execution:** batched\n```\n\n### Task 1: A\n';
  assert.deepStrictEqual(countTasks(text), { tasks: 1, batched: false });
  // Tilde fences are CommonMark fences too (review 3f, #1926).
  const tilde = '# Plan\n\n~~~\n**Execution:** batched\n~~~\n\n### Task 1: A\n';
  assert.deepStrictEqual(countTasks(tilde), { tasks: 1, batched: false });
});

const FOUR_TASKS = ['### Task 1: A', '', '### Task 2: B', '', '### Task 3: C', '', '### Task 4: D', ''];

test('AC1.1: countTasks reads the marker plus a separate batch-instruction line as batched (#3123)', () => {
  const text = [
    '# Plan', '',
    '**Execution:** batched',
    '**Batch:** send every task to one implementer as a single brief; review the combined diff once.',
    '',
    ...FOUR_TASKS,
  ].join('\n');
  assert.deepStrictEqual(countTasks(text), { tasks: 4, batched: true });
});

test('AC2.1: an instruction appended to the marker line reads batched: false — the two lines must stay separate (#3123)', () => {
  // The marker regex anchors at end of line; trailing text silently drops the marker.
  const text = [
    '# Plan', '',
    '**Execution:** batched — send every task to one implementer as a single brief; review the combined diff once.',
    '',
    ...FOUR_TASKS,
  ].join('\n');
  assert.deepStrictEqual(countTasks(text), { tasks: 4, batched: false });
});

test('AC2.2: a plan with two adjacent tasks merged into one counts one fewer task and stays batched: false without a marker (#3379)', () => {
  const separate = '### Task 1: Add a column\n\n### Task 2: Expose it as a constant\n\n### Task 3: Wire the reader\n';
  const merged = '### Task 1: Add a column and expose it as a constant\n\n### Task 2: Wire the reader\n';
  assert.deepStrictEqual(countTasks(`# Plan\n\n${separate}`), { tasks: 3, batched: false });
  assert.deepStrictEqual(countTasks(`# Plan\n\n${merged}`), { tasks: 2, batched: false });
  assert.deepStrictEqual(countTasks(`# Plan\n\n**Execution:** batched\n\n${merged}`), { tasks: 2, batched: true });
});

// ── #3099 Check E — acceptance-criterion clause splitter ────────────────────
const { extractAcceptanceClauses, splitClauses } = require('../../../plugin/bin/lib/plan-audit/parser');

const INCIDENT_SPEC = [
  '# 1: Example',
  '',
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '3. `npm test` passes.',
  '',
  '## Release Note',
  '',
  '1. Not a criterion.',
].join('\n');

test('AC1.1 (#3099): a three-clause item splits on the sentence end and the semicolon into AC2.1-AC2.3', () => {
  const { clauses, unparsed } = extractAcceptanceClauses(INCIDENT_SPEC);
  assert.deepStrictEqual(unparsed, []);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC2.1', 'AC2.2', 'AC2.3', 'AC3.1']);
  assert.deepStrictEqual(clauses.filter((c) => c.item === 2).map((c) => c.text), [
    'Each recipient gets one row.',
    'A recipient with several instances counts once',
    'the total equals the recipient count.',
  ]);
});

test('#3099: the section ends at the next ## heading — a later section\'s list is never read', () => {
  const { clauses } = extractAcceptanceClauses(INCIDENT_SPEC);
  assert.ok(!clauses.some((c) => /Not a criterion/.test(c.text)));
});

test('#3099: splitClauses never cuts inside a code span, after e.g., before a lowercase word, or inside parentheses', () => {
  assert.deepStrictEqual(splitClauses('Run `a; b. C` first.'), ['Run `a; b. C` first.']);
  assert.deepStrictEqual(splitClauses('Use a flag, e.g. `--spec`, to opt in.'), ['Use a flag, e.g. `--spec`, to opt in.']);
  assert.deepStrictEqual(splitClauses('Version 6.4.1 ships it. then more.'), ['Version 6.4.1 ships it. then more.']);
  assert.deepStrictEqual(splitClauses('Both shapes (one; two) pass.'), ['Both shapes (one; two) pass.']);
  assert.deepStrictEqual(splitClauses('One holds. Two holds!'), ['One holds.', 'Two holds!']);
});

test('#3099: splitClauses masks HTML entities so a `;` ending one is never a cut (spec #272 AC4 regression)', () => {
  assert.deepStrictEqual(
    splitClauses("the judge&#39;s material is the evidence string."),
    ["the judge&#39;s material is the evidence string."],
  );
  assert.deepStrictEqual(
    splitClauses('Escaped &amp; kept whole; a real clause follows.'),
    ['Escaped &amp; kept whole', 'a real clause follows.'],
  );
  assert.deepStrictEqual(
    splitClauses('A hex entity &#x27;here&#x27; stays put.'),
    ['A hex entity &#x27;here&#x27; stays put.'],
  );
});

test('#3099: splitClauses does not cut a sentence-end right after an in-item sub-label like "3a." (spec #287 regression)', () => {
  assert.deepStrictEqual(
    splitClauses('Not deleted outright. 3a. `grep -c "x" f.md` returns at least 1. 3b. Next thing here.'),
    [
      'Not deleted outright.',
      '3a. `grep -c "x" f.md` returns at least 1.',
      '3b. Next thing here.',
    ],
  );
});

test('#3099: an odd backtick count makes splitClauses refuse (null), never guess', () => {
  assert.strictEqual(splitClauses('A `broken span; still here.'), null);
});

test('#3099: an unbalanced paren or bracket makes splitClauses refuse (null), never guess', () => {
  assert.strictEqual(splitClauses('This (never closes. Another clause follows.'), null);
  assert.strictEqual(splitClauses('This [never closes. Another clause follows.'), null);
});

test('#3099: balanced parens still do not split inside them', () => {
  assert.deepStrictEqual(
    splitClauses('Both shapes (one; two) pass. Done.'),
    ['Both shapes (one; two) pass.', 'Done.'],
  );
});

test('#3099: ids follow item position, and a leading [ ] checkbox is stripped from a - bullet', () => {
  const spec = '## Acceptance Criteria\n\n- [ ] First holds.\n- [x] Second holds; third holds.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses, [
    { id: 'AC1.1', item: 1, text: 'First holds.' },
    { id: 'AC2.1', item: 2, text: 'Second holds' },
    { id: 'AC2.2', item: 2, text: 'third holds.' },
  ]);
});

test('#3099: an indented continuation line joins its item', () => {
  const spec = '## Acceptance Criteria\n\n- First part\n  continues here. Second sentence.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses.map((c) => c.text), [
    'First part continues here.',
    'Second sentence.',
  ]);
});

test('#3099: a nested sub-bullet under an AC item is a continuation, never a new item (ids stay stable)', () => {
  const spec = '## Acceptance Criteria\n\n- Parent item.\n  - Nested detail.\n- Third item.\n';
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(unparsed, []);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC1.2', 'AC2.1']);
  assert.deepStrictEqual(clauses.map((c) => c.text), ['Parent item.', 'Nested detail.', 'Third item.']);
});

test('#3099: a flat list (no nesting) still numbers items AC1..AC3', () => {
  const spec = '## Acceptance Criteria\n\n- First.\n- Second.\n- Third.\n';
  const { clauses } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC2.1', 'AC3.1']);
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section is unparsed, never an empty clause list', () => {
  const result = extractAcceptanceClauses('# 1: X\n\n## Deliverables\n\n- Do it.\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.strictEqual(result.unparsed.length, 1);
  assert.strictEqual(result.unparsed[0].item, null);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
});

test('#3099: a heading inside a fenced block is not the section', () => {
  const result = extractAcceptanceClauses('```\n## Acceptance Criteria\n- Quoted.\n```\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.match(result.unparsed[0].raw, /no "## Acceptance Criteria" section/);
});

test('#3099: an empty section is unparsed', () => {
  const result = extractAcceptanceClauses('## Acceptance Criteria\n\n## Gotchas\n');
  assert.deepStrictEqual(result.clauses, []);
  assert.deepStrictEqual(result.unparsed, [{ item: null, raw: 'empty "## Acceptance Criteria" section' }]);
});

test('#3099: an item the splitter refuses lands in unparsed with its item number; its neighbours still split', () => {
  const spec = '## Acceptance Criteria\n\n- Fine one.\n- A `broken span here.\n- Fine three.\n';
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1', 'AC3.1']);
  assert.deepStrictEqual(unparsed, [{ item: 2, raw: 'A `broken span here.' }]);
});

test('#3099: a fenced block inside an item makes that item unparsed', () => {
  const spec = '## Acceptance Criteria\n\n- Runs this:\n```\nnpm test\n```\n- Fine two.\n';
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC2.1']);
  assert.strictEqual(unparsed.length, 1);
  assert.strictEqual(unparsed[0].item, 1);
});

test('#3099: a prose-only section makes each paragraph one item', () => {
  const spec = '## Acceptance Criteria\n\nThe row matches the repo. It names the producer.\n\nThe docs agree.\n';
  assert.deepStrictEqual(extractAcceptanceClauses(spec).clauses.map((c) => [c.id, c.text]), [
    ['AC1.1', 'The row matches the repo.'],
    ['AC1.2', 'It names the producer.'],
    ['AC2.1', 'The docs agree.'],
  ]);
});

test('#3099: stray prose beside list items is unparsed (item null); a one-line italic footer is ignored', () => {
  const spec = [
    '## Acceptance Criteria',
    '',
    'All of these hold:',
    '',
    '- [ ] One holds.',
    '',
    '_Filed by `review` via specShapedBody._',
  ].join('\n');
  const { clauses, unparsed } = extractAcceptanceClauses(spec);
  assert.deepStrictEqual(clauses.map((c) => c.id), ['AC1.1']);
  assert.deepStrictEqual(unparsed, [{ item: null, raw: 'All of these hold:' }]);
});

test('#3099: a CRLF spec yields exactly the LF result', () => {
  assert.deepStrictEqual(
    extractAcceptanceClauses(INCIDENT_SPEC.replace(/\n/g, '\r\n')),
    extractAcceptanceClauses(INCIDENT_SPEC),
  );
});

// ── #3099 Check E — plan coverage sources ───────────────────────────────────
const { extractCoverageSources } = require('../../../plugin/bin/lib/plan-audit/parser');

const COVERAGE_PLAN = [
  '# Plan',
  '',
  '| Clause | Task |',
  '|---|---|',
  '| AC1.1 | Task 1 |',
  '',
  'Waived AC3.1: verified by hand at review',
  '',
  '### Task 1: Thing',
  '',
  '- [ ] **Step 1: Write the failing test**',
  '',
  'Cites AC2.1 in the test step.',
  '',
  '```js',
  '## not a heading inside a fence',
  '| not a row inside a fence |',
  'Waived AC9.9: not a waiver inside a fence',
  '```',
  '',
  'Still Step 1 after the fence: AC2.2.',
  '',
  '- [ ] **Step 3: Write minimal implementation**',
  '',
  'Mentions AC2.3 outside any test step.',
  '',
  '- [ ] **Step 4: Run tests to verify they pass**',
  '',
  '## Self-Review',
  '',
  '- [ ] **Step 9: Run the test**',
  '',
  'AC5.1 outside any task block.',
].join('\n');

test('#3099: extractCoverageSources reads waiver lines and consumes them', () => {
  const { waivers, testSteps } = extractCoverageSources(COVERAGE_PLAN);
  assert.deepStrictEqual(waivers, [{ id: 'AC3.1', reason: 'verified by hand at review' }]);
  assert.ok(!testSteps.join('\n').includes('Waived AC3.1'));
});

test('#3099: test steps are the Step sub-steps whose title names a test or verification, inside a Task block', () => {
  const { testSteps } = extractCoverageSources(COVERAGE_PLAN);
  assert.strictEqual(testSteps.length, 2);
  assert.match(testSteps[0], /Cites AC2\.1 in the test step/);
  assert.match(testSteps[0], /Still Step 1 after the fence: AC2\.2/);
  assert.ok(!testSteps.join('\n').includes('AC2.3'), 'an implementation step is not a test step');
  assert.ok(!testSteps.join('\n').includes('AC5.1'), 'a step after the task block ends is not read');
});

test('#3099: a fenced line is step content, never a heading, table row, or waiver', () => {
  const { testSteps, mapRows, waivers } = extractCoverageSources(COVERAGE_PLAN);
  assert.match(testSteps[0], /## not a heading inside a fence/);
  assert.ok(!waivers.some((w) => w.id === 'AC9.9'));
  assert.ok(!mapRows.some((r) => r.includes('not a row inside a fence')));
});

test('#3099: every table row outside a fence is a coverage-map source', () => {
  assert.deepStrictEqual(extractCoverageSources(COVERAGE_PLAN).mapRows, [
    '| Clause | Task |',
    '|---|---|',
    '| AC1.1 | Task 1 |',
  ]);
});

test('#3099: a CRLF plan yields exactly the LF result', () => {
  assert.deepStrictEqual(
    extractCoverageSources(COVERAGE_PLAN.replace(/\n/g, '\r\n')),
    extractCoverageSources(COVERAGE_PLAN),
  );
});

// ── Check F inputs (#3602) ──────────────────────────────────────────────

const {
  looksLikeRepoPath, normalizeRepoPath, extractSpecPaths, extractPathWaivers,
} = require('../../../plugin/bin/lib/plan-audit/parser');

const F_SPEC = [
  '# 1: X', '',
  '## Deliverables', '', '1. Change `src/deliv.js`.', '',
  '## Acceptance Criteria', '', '1. `src/ac.js` works.', '',
  '## Technical Approach', '', 'Read `src/a.js` back; change `./src/b.js:88` only if it breaks.', '',
  '### Key Files', '', '- `src/a.js` — reader', '- `plugin/skills/_shared/x.md` — read only', '',
  '## Gotchas', '', '- Verify `lib/c.js` against `src/a.js`.', '',
  '## Release Note', '', 'Mentions `src/note.js`.', '',
].join('\n');

test('AC2.1 (#3602): extractSpecPaths reads only Technical Approach (with Key Files) and Gotchas — deduped, first section wins, normalized', () => {
  assert.deepStrictEqual(extractSpecPaths(F_SPEC), {
    paths: [
      { path: 'src/a.js', section: 'Technical Approach' },
      { path: 'src/b.js', section: 'Technical Approach' },
      { path: 'plugin/skills/_shared/x.md', section: 'Technical Approach' },
      { path: 'lib/c.js', section: 'Gotchas' },
    ],
    unparsed: [],
  });
});

test('#3602: looksLikeRepoPath accepts repo-relative file paths and rejects every non-path span', () => {
  for (const p of ['src/a.js', './src/a.js', 'src/b.js:88', 'src/b.js:12-20', '.claude/skills/x/SKILL.md', 'docs/plans/2026-10-20-x-ledger.md']) {
    assert.ok(looksLikeRepoPath(p), p);
  }
  for (const p of ['AC_HEADING_RE', 'parser.js', '--spec', 'src/*.js', 'work/{n}-spec.md', 'https://x.io/a.js',
    '.claude/skills/x/', 'origin/main', 'plan-audit.js {plan} --spec {spec}', '/abs/path.js', 'node:fs', '~/.claude/x.md']) {
    assert.ok(!looksLikeRepoPath(p), p);
  }
});

test('#3602: normalizeRepoPath drops a leading ./ and a :NN or :NN-MM line suffix', () => {
  assert.strictEqual(normalizeRepoPath('./src/b.js:88'), 'src/b.js');
  assert.strictEqual(normalizeRepoPath('src/b.js:12-20'), 'src/b.js');
  assert.strictEqual(normalizeRepoPath('src/a.js'), 'src/a.js');
});

test('AC4.1 (#3602): a line with an unbalanced code span is unparsed with its section; its neighbours still extract', () => {
  const spec = '## Technical Approach\n\nRead `src/a.js and stop.\nThen `src/b.js`.\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [{ path: 'src/b.js', section: 'Technical Approach' }],
    unparsed: [{ section: 'Technical Approach', raw: 'Read `src/a.js and stop.' }],
  });
});

test('AC4.1 (#3602): a line with a double-backtick run is unparsed, never a silent drop; its neighbours still extract', () => {
  const spec = '## Technical Approach\n\nUse `` `x` `` and read `src/k.js`.\nThen `src/b.js`.\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [{ path: 'src/b.js', section: 'Technical Approach' }],
    unparsed: [{ section: 'Technical Approach', raw: 'Use `` `x` `` and read `src/k.js`.' }],
  });
});

test('AC4.1 (#3602): an unclosed fence makes the section one unparsed entry, never an empty, clean result', () => {
  const spec = '## Technical Approach\n\n```js\nrequire(`src/a.js`)\n\n## Gotchas\n\n- `src/g.js`\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [],
    unparsed: [
      { section: 'Technical Approach', raw: 'unclosed code fence in "## Technical Approach"' },
      { section: 'Gotchas', raw: 'unclosed code fence before "## Gotchas"' },
    ],
  });
});

test('AC4.1 (#3602): an unclosed fence in an earlier section swallows both headings — each is unparsed, never a clean empty result', () => {
  const spec = '## Deliverables\n\n```js\nconst x = 1;\n\n## Technical Approach\n\nRead `src/a.js`.\n\n## Gotchas\n\n- `lib/c.js`\n';
  assert.deepStrictEqual(extractSpecPaths(spec), {
    paths: [],
    unparsed: [
      { section: 'Technical Approach', raw: 'unclosed code fence before "## Technical Approach"' },
      { section: 'Gotchas', raw: 'unclosed code fence before "## Gotchas"' },
    ],
  });
});

test('#3602: a path inside a balanced fenced block is not extracted; one after the fence is', () => {
  const spec = '## Gotchas\n\n```\nsee `src/in-fence.js`\n```\n\n- `src/after.js`\n';
  assert.deepStrictEqual(extractSpecPaths(spec).paths, [{ path: 'src/after.js', section: 'Gotchas' }]);
});

test('#3602: a spec with neither section yields no paths and no unparsed entry (an optional section left out is nothing here)', () => {
  assert.deepStrictEqual(extractSpecPaths('## Acceptance Criteria\n\n1. `src/a.js` works.\n'), { paths: [], unparsed: [] });
});

test('#3602: a CRLF spec yields exactly the LF result', () => {
  assert.deepStrictEqual(extractSpecPaths(F_SPEC.replace(/\n/g, '\r\n')), extractSpecPaths(F_SPEC));
});

test('AC1.2 (#3602): extractPathWaivers reads Waived {path}: {reason} lines, normalized, skipping AC waivers and fenced lines', () => {
  const plan = ['Waived src/b.js: read-only', '- Waived `lib/c.js:12`: covered upstream', 'Waived AC2.3: not a path',
    '```', 'Waived src/fenced.js: inside a fence', '```'].join('\n');
  assert.deepStrictEqual(extractPathWaivers(plan), [
    { path: 'src/b.js', reason: 'read-only' },
    { path: 'lib/c.js', reason: 'covered upstream' },
  ]);
});
