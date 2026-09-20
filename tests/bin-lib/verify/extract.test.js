'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, stripAnsi, extractFailingFiles,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'extract.js'));

const TAP_FIXTURE = [
  'ok 1 - passes fine',
  'not ok 2 - fails badly',
  '  ---',
  '  error: boom',
  "  stack: at Object.<anonymous>",
  '  ...',
  'ok 3 - another pass',
  '# tests 3',
  '# pass 2',
  '# fail 1',
].join('\n');

const JEST_FIXTURE = [
  'PASS src/a.test.js',
  'FAIL src/b.test.js',
  '  ● b > explodes',
  '    Error: kaboom',
  'Tests:       1 failed, 4 passed, 5 total',
].join('\n');

const PYTEST_FIXTURE = [
  'collected 5 items',
  'FAILED tests/test_b.py::test_x - AssertionError',
  '=========== 1 failed, 4 passed in 0.21s ===========',
].join('\n');

const GENERIC_FIXTURE = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');

test('sniffs TAP from line-anchored markers', () => {
  assert.strictEqual(sniffFamily(TAP_FIXTURE), 'tap');
});

test('sniffs summary family for jest and pytest shapes', () => {
  assert.strictEqual(sniffFamily(JEST_FIXTURE), 'summary');
  assert.strictEqual(sniffFamily(PYTEST_FIXTURE), 'summary');
});

test('TAP precedence beats summary markers in the same text (AC5 precedence)', () => {
  assert.strictEqual(sniffFamily(`${JEST_FIXTURE}\nnot ok 1 - tap wins\n# tests 1`), 'tap');
});

test('no markers sniffs generic', () => {
  assert.strictEqual(sniffFamily(GENERIC_FIXTURE), 'generic');
});

test('a mid-line "not ok" does not trigger TAP (line-anchored)', () => {
  assert.strictEqual(sniffFamily('the result was not ok today\nplain text'), 'generic');
});

test('TAP extraction carries the not-ok line with trailing diagnostics', () => {
  const region = extractFailingRegion(TAP_FIXTURE, 'tap');
  assert.ok(region.includes('not ok 2 - fails badly'));
  assert.ok(region.includes('error: boom'));
  assert.ok(!region.includes('ok 1 - passes fine'));
});

test('summary extraction carries FAIL region and trailing summary block', () => {
  const region = extractFailingRegion(JEST_FIXTURE, 'summary');
  assert.ok(region.includes('FAIL src/b.test.js'));
  assert.ok(region.includes('Tests:       1 failed, 4 passed, 5 total'));
});

test('generic extraction is the last GENERIC_TAIL_LINES lines', () => {
  const region = extractFailingRegion(GENERIC_FIXTURE, 'generic');
  const lines = region.split('\n');
  assert.strictEqual(lines.length, GENERIC_TAIL_LINES);
  assert.strictEqual(lines[lines.length - 1], 'line 50');
});

test('every branch caps at MAX_REGION_LINES', () => {
  const bigTap = Array.from({ length: 400 }, (_, i) => `not ok ${i + 1} - f${i}`).join('\n');
  assert.ok(extractFailingRegion(bigTap, 'tap').split('\n').length <= MAX_REGION_LINES);
  const bigSummary = Array.from({ length: 400 }, (_, i) => `FAIL src/f${i}.test.js`).join('\n');
  assert.ok(extractFailingRegion(bigSummary, 'summary').split('\n').length <= MAX_REGION_LINES);
});

test('TAP counts parse from the # tests/# pass/# fail block', () => {
  assert.deepStrictEqual(parseCounts(TAP_FIXTURE, 'tap'), { tests: 3, pass: 2, fail: 1 });
});

test('jest counts parse from the Tests: line', () => {
  assert.deepStrictEqual(parseCounts(JEST_FIXTURE, 'summary'), { tests: 5, pass: 4, fail: 1 });
});

test('pytest counts parse from the === summary line', () => {
  assert.deepStrictEqual(parseCounts(PYTEST_FIXTURE, 'summary'), { tests: 5, pass: 4, fail: 1 });
});

test('incomplete TAP count block yields null, never a guess', () => {
  assert.strictEqual(parseCounts('not ok 1 - x\n# tests 3\n# pass 2', 'tap'), null);
});

test('summary with no parseable numbers yields null', () => {
  assert.strictEqual(parseCounts('FAIL src/b.test.js\nno numbers here', 'summary'), null);
});

test('summary line with only a failed count (no passed count) yields null, never a guessed pass=0', () => {
  assert.strictEqual(parseCounts('FAIL src/b.test.js\nTests: 3 failed', 'summary'), null);
});

test('a green summary line with total derives the missing failed=0, never nulling out a clean run (I2)', () => {
  assert.deepStrictEqual(parseCounts('Tests: 5 passed, 5 total', 'summary'), { tests: 5, pass: 5, fail: 0 });
});

test('a green jest line with a skip does not fabricate a fail count from the skipped tests (I2 regression)', () => {
  assert.deepStrictEqual(
    parseCounts('Tests:       1 skipped, 4 passed, 5 total', 'summary'),
    { tests: 5, pass: 4, fail: 0 },
  );
});

test('an unrecognized numeric-word phrase on the summary line blocks derivation rather than fabricating a count (security)', () => {
  assert.strictEqual(
    parseCounts('Tests:       1 failed, 1 warning, 10 total', 'summary'),
    null,
  );
});

test('a summary line with passed but no failed and no total still yields null (nothing to derive from)', () => {
  assert.strictEqual(parseCounts('Tests: 5 passed', 'summary'), null);
});

test('generic family never yields counts', () => {
  assert.strictEqual(parseCounts('# tests 3\n# pass 3\n# fail 0', 'generic'), null);
});

test('summaryLine is one bounded line', () => {
  const line = summaryLine(TAP_FIXTURE, 'tap');
  assert.ok(!line.includes('\n'));
  assert.ok(line.length <= 200);
  const long = summaryLine('x'.repeat(5000), 'generic');
  assert.ok(long.length <= 200);
});

test('extractFailingFiles: a node --test log with one failing frame yields that test file (AC1)', () => {
  const text = [
    'not ok 1 - a fails',
    '  ---',
    '  stack: |-',
    '    at TestContext.<anonymous> (tests/a.test.js:12:5)',
    '    at Test.runInAsyncScope (node:async_hooks:206:9)',
    '  ...',
    '# tests 1', '# pass 0', '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap'), ['tests/a.test.js']);
});

test('extractFailingFiles: node frames name only test files — source files under test and node internals are never returned', () => {
  const text = [
    'not ok 1 - x',
    '  stack: |-',
    '    at readStamp (plugin/bin/lib/verify/stamp.js:75:3)',
    '    at TestContext.<anonymous> (tests/bin-lib/verify/stamp.test.js:40:5)',
    '    at node:internal/test_runner/test:1:1',
    '  ...',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap'), ['tests/bin-lib/verify/stamp.test.js']);
});

test('extractFailingFiles: absolute paths under cwd are relativized; the `location:` diagnostic counts too; order is log order and deduped', () => {
  const text = [
    'not ok 1 - first',
    "  location: '/repo/tests/z.test.js:3:1'",
    'not ok 2 - second',
    '    at TestContext.<anonymous> (/repo/tests/a.test.js:12:5)',
    'not ok 3 - third (same file again)',
    '    at TestContext.<anonymous> (/repo/tests/z.test.js:30:5)',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap', { cwd: '/repo' }), ['tests/z.test.js', 'tests/a.test.js']);
});

test('extractFailingFiles: frames outside failure blocks are ignored (a passing test that printed a stack is not a failing file)', () => {
  const text = [
    'ok 1 - logs a stack on purpose',
    '    at TestContext.<anonymous> (tests/noisy.test.js:5:5)',
    'not ok 2 - really fails',
    '    at TestContext.<anonymous> (tests/bad.test.js:5:5)',
    '# tests 2', '# pass 1', '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap'), ['tests/bad.test.js']);
});

test('extractFailingFiles: vitest FAIL line wrapped in ANSI colour yields the file (AC1, the #1837 lesson)', () => {
  const text = '\x1b[31m FAIL \x1b[0m src/x.test.ts > suite > case\n\x1b[31mAssertionError\x1b[0m\n';
  assert.deepStrictEqual(extractFailingFiles(text, 'summary'), ['src/x.test.ts']);
});

test('extractFailingFiles: vitest ❯ file lines and jest FAIL lines both parse', () => {
  const text = ['❯ src/y.test.ts (3 tests | 1 failed)', 'FAIL src/b.test.js', '  ● b > explodes', 'Tests:       2 failed, 4 passed, 6 total'].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'summary'), ['src/y.test.ts', 'src/b.test.js']);
});

test('extractFailingFiles: pytest FAILED path::name yields the path', () => {
  assert.deepStrictEqual(extractFailingFiles(PYTEST_FIXTURE, 'summary'), ['tests/test_b.py']);
});

// Review finding (pre-v6.119.0 whole-branch review): node --test's Windows
// stack frames use a drive-letter colon and backslash separators — the old
// PATH class excluded both, so a Windows failing frame never matched and the
// #1925 flaky-retry allowlist silently never engaged on this repo's own
// (Windows) CI-less local runs.
test('extractFailingFiles: a Windows-native node --test frame (drive letter + backslashes) is relativized to a repo-relative posix path', () => {
  const text = [
    'not ok 1 - a fails',
    '  stack: |-',
    '    at TestContext.<anonymous> (C:\\repo\\tests\\a.test.js:12:5)',
    '  ...',
    '# tests 1', '# pass 0', '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap', { cwd: 'C:\\repo' }), ['tests/a.test.js']);
});

test('extractFailingFiles: generic family and a log with nothing parseable yield [] — no parse, no retry (AC1)', () => {
  assert.deepStrictEqual(extractFailingFiles(GENERIC_FIXTURE, 'generic'), []);
  assert.deepStrictEqual(extractFailingFiles('not ok 1 - fails with no frame\n# fail 1', 'tap'), []);
});

test('stripAnsi removes ESC-anchored colour sequences and nothing else', () => {
  assert.strictEqual(stripAnsi('\x1b[31mred\x1b[0m [1m not a code'), 'red [1m not a code');
});
