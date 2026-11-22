'use strict';

// plan-audit.js --surface-diff (#6059): did an amend change the plan's file list or AC coverage?
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { surfaceDiff } = require('../../../plugin/bin/lib/plan-audit/checks');
const { parseArgs, UsageError } = require('../../../plugin/bin/lib/plan-audit/args');
const { runCliSync } = require('../../helpers/run-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'plan-audit.js');

const SPEC = [
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row.',
  '',
].join('\n');

function plan({ files = ['- Modify: `plugin/a.js`', '- Test: `tests/a.test.js`'], testLines = ['AC1.1 AC2.1'], extra = [] } = {}) {
  return [
    '### Task 1: Build it',
    '',
    '**Files:**',
    ...files,
    '',
    '- [ ] **Step 1: Write the failing test**',
    '',
    ...testLines,
    '',
    ...extra,
  ].join('\n');
}

test('AC2.1: an amend that keeps the file list and AC coverage is unchanged', () => {
  const p = plan();
  assert.deepStrictEqual(surfaceDiff(SPEC, p, p), {
    changed: false, files: { added: [], removed: [] }, acCoverage: [],
  });
});

test('a new Modify: path is a file-list change', () => {
  const after = plan({ files: ['- Modify: `plugin/a.js`', '- Modify: `plugin/b.js`', '- Test: `tests/a.test.js`'] });
  const r = surfaceDiff(SPEC, plan(), after);
  assert.deepStrictEqual(r.files, { added: ['plugin/b.js'], removed: [] });
  assert.strictEqual(r.changed, true);
});

test('a removed Test: path is a file-list change', () => {
  const after = plan({ files: ['- Modify: `plugin/a.js`'] });
  const r = surfaceDiff(SPEC, plan(), after);
  assert.deepStrictEqual(r.files, { added: [], removed: ['tests/a.test.js'] });
  assert.strictEqual(r.changed, true);
});

test('D9: an amend that newly waives an AC clause changes coverage', () => {
  const after = plan({ testLines: ['AC1.1', 'Waived AC2.1: out of scope here'] });
  const r = surfaceDiff(SPEC, plan(), after);
  assert.deepStrictEqual(r.acCoverage, [{ id: 'AC2.1', before: 'covered', after: 'waived' }]);
  assert.strictEqual(r.changed, true);
});

test('an amend that drops a citation reports the clause as uncovered', () => {
  const after = plan({ testLines: ['AC1.1'] });
  const r = surfaceDiff(SPEC, plan(), after);
  assert.deepStrictEqual(r.acCoverage, [{ id: 'AC2.1', before: 'covered', after: 'uncovered' }]);
  assert.strictEqual(r.changed, true);
});

test('a reworded task with the same paths and citations is unchanged', () => {
  const after = plan({ testLines: ['Reworded: AC1.1 AC2.1 still asserted here'], extra: ['New prose paragraph.'] });
  assert.strictEqual(surfaceDiff(SPEC, plan(), after).changed, false);
});

test('files lists are sorted and deduped', () => {
  const after = plan({ files: ['- Modify: `plugin/z.js`', '- Modify: `plugin/b.js`', '- Test: `plugin/z.js`'] });
  const r = surfaceDiff(SPEC, plan({ files: [] }), after);
  assert.deepStrictEqual(r.files.added, ['plugin/b.js', 'plugin/z.js']);
});

test('parseArgs: --surface-diff with --spec parses to surfaceDiff', () => {
  const a = parseArgs(['after.md', '--surface-diff', 'before.md', '--spec', 's.md']);
  assert.strictEqual(a.surfaceDiff, 'before.md');
  assert.strictEqual(a.spec, 's.md');
  assert.strictEqual(parseArgs(['after.md']).surfaceDiff, null);
});

test('parseArgs: --surface-diff refusals throw UsageError', () => {
  const cases = [
    [['p.md', '--surface-diff'], /--surface-diff requires a value/],
    [['p.md', '--surface-diff', 'b.md'], /--surface-diff requires --spec/],
    [['p.md', '--surface-diff', 'b.md', '--spec', 's.md', '--count-tasks'], /--surface-diff cannot be combined/],
    [['p.md', '--surface-diff', 'b.md', '--spec', 's.md', '--bytes'], /--surface-diff cannot be combined/],
    [['p.md', '--surface-diff', 'b.md', '--spec', 's.md', '--task-markers'], /--surface-diff cannot be combined/],
    [['p.md', '--surface-diff', 'b.md', '--spec', 's.md', '--risk-proofs'], /--surface-diff cannot be combined/],
  ];
  for (const [argv, re] of cases) {
    assert.throws(() => parseArgs(argv), (err) => err instanceof UsageError && re.test(err.message), argv.join(' '));
  }
});

test('CLI: prints {"surfaceDiff": ...} on one line and exits 0; an unreadable before-plan exits 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-diff-'));
  try {
    const spec = path.join(dir, 'spec.md');
    const before = path.join(dir, 'before.md');
    const after = path.join(dir, 'after.md');
    fs.writeFileSync(spec, SPEC);
    fs.writeFileSync(before, plan());
    fs.writeFileSync(after, plan({ files: ['- Modify: `plugin/a.js`'] }));
    const r = runCliSync(CLI, [after, '--surface-diff', before, '--spec', spec], { env: { ...process.env } });
    assert.strictEqual(r.code, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), {
      surfaceDiff: { changed: true, files: { added: [], removed: ['tests/a.test.js'] }, acCoverage: [] },
    });
    assert.strictEqual(r.stdout.trim().split('\n').length, 1);
    const missing = runCliSync(CLI, [after, '--surface-diff', path.join(dir, 'nope.md'), '--spec', spec], { env: { ...process.env } });
    assert.strictEqual(missing.code, 2);
    assert.match(missing.stderr, /cannot read before-plan file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --surface-diff without --spec is refused with exit 2 and prints no JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-diff-'));
  try {
    const before = path.join(dir, 'before.md');
    const after = path.join(dir, 'after.md');
    fs.writeFileSync(before, plan());
    fs.writeFileSync(after, plan());
    const r = runCliSync(CLI, [after, '--surface-diff', before], { env: { ...process.env } });
    assert.strictEqual(r.code, 2);
    assert.match(r.stderr, /--surface-diff requires --spec/);
    assert.strictEqual(r.stdout, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
