'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  extractFileEntries, extractScopeKeywords, extractTaskBlocks,
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
