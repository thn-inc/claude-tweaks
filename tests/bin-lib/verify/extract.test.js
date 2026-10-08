'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, stripAnsi, extractFailingFiles, countUnmatchedFailures, fileLevelFailures,
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

// #1837: vitest's default reporter summary — no colon, `Test Files` counts
// suites (never tests), the `Tests` line carries the parseable total.
const VITEST_FIXTURE = [
  ' Test Files  64 passed (64)',
  '      Tests  727 passed (727)',
].join('\n');

// The same shape wrapped in ANSI colour codes, as vitest emits by default on
// a colour-capable (even non-TTY) terminal — the reported repro shape.
const VITEST_COLOURED = [
  '\x1b[32m Test Files\x1b[39m  \x1b[1m\x1b[32m64 passed\x1b[39m\x1b[22m (64)',
  '\x1b[32m      Tests\x1b[39m  \x1b[1m\x1b[32m727 passed\x1b[39m\x1b[22m (727)',
].join('\n');

const VITEST_WITH_FAILURES = [
  ' Test Files  2 failed | 62 passed (64)',
  '      Tests  3 failed | 724 passed (727)',
].join('\n');

test('sniffs TAP from line-anchored markers', () => {
  assert.strictEqual(sniffFamily(TAP_FIXTURE), 'tap');
});

test('sniffs summary family for jest and pytest shapes', () => {
  assert.strictEqual(sniffFamily(JEST_FIXTURE), 'summary');
  assert.strictEqual(sniffFamily(PYTEST_FIXTURE), 'summary');
});

test('sniffs summary family for vitest (plain and ANSI-coloured), never generic (#1837)', () => {
  assert.strictEqual(sniffFamily(VITEST_FIXTURE), 'summary');
  assert.strictEqual(sniffFamily(stripAnsi(VITEST_COLOURED)), 'summary');
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

test('summary extraction carries a vitest ❯ failing-file line and the colon-free Tests/Test Files summary (#1837 review finding)', () => {
  const vitestFailure = [
    '❯ src/y.test.ts (3 tests | 1 failed)',
    '  × y > explodes',
    ' Test Files  1 failed | 62 passed (63)',
    '      Tests  1 failed | 724 passed (725)',
  ].join('\n');
  const region = extractFailingRegion(vitestFailure, 'summary');
  assert.ok(region.includes('❯ src/y.test.ts (3 tests | 1 failed)'), 'the ❯ failing-file line must be kept, not dropped');
  assert.ok(region.includes('Test Files  1 failed | 62 passed (63)'), 'the colon-free Test Files summary line must be kept');
  assert.ok(region.includes('Tests  1 failed | 724 passed (725)'), 'the colon-free Tests summary line must be kept');
});

test('summary extraction carries a leading-whitespace FAILED (pytest-shaped) line', () => {
  const region = extractFailingRegion('  FAILED tests/test_b.py::test_x - AssertionError', 'summary');
  assert.ok(region.includes('FAILED tests/test_b.py::test_x'), 'a leading-whitespace FAILED line must be kept, matching this file\'s own SUMMARY_FAIL_RE tolerance');
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

test('vitest counts parse from the Tests line, plain and ANSI-coloured (AC1, #1837)', () => {
  assert.deepStrictEqual(parseCounts(VITEST_FIXTURE, 'summary'), { tests: 727, pass: 727, fail: 0 });
  assert.deepStrictEqual(
    parseCounts(stripAnsi(VITEST_COLOURED), sniffFamily(stripAnsi(VITEST_COLOURED))),
    { tests: 727, pass: 727, fail: 0 },
  );
});

test('vitest counts with failures parse the | N failed segment (#1837)', () => {
  assert.deepStrictEqual(parseCounts(VITEST_WITH_FAILURES, 'summary'), { tests: 727, pass: 724, fail: 3 });
});

test('vitest Test Files line never feeds counts.tests — only the Tests line does (#1837 gotcha)', () => {
  // A 64-file suite must never be recorded as 64 tests.
  const counts = parseCounts(VITEST_FIXTURE, 'summary');
  assert.notStrictEqual(counts.tests, 64);
  assert.strictEqual(counts.tests, 727);
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

// #3043: the same failing file also appears in the TAP `location: '...'` line,
// YAML-quoted with a doubled backslash per separator — it must fold into the
// stack frame's entry, not list the file a second time as `C://repo//...`.
test('extractFailingFiles: a YAML-quoted Windows TAP location line (doubled backslashes) dedupes with the stack frame (#3043)', () => {
  const text = [
    'not ok 1 - a fails',
    '  ---',
    "  location: 'C:\\\\repo\\\\tests\\\\a.test.js:1:21'",
    '  stack: |-',
    '    TestContext.<anonymous> (C:\\repo\\tests\\a.test.js:12:5)',
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

const SPEC_LOG = [
  '✔ passes (1.2ms)',
  '✖ breaks (3.0ms)',
  'ℹ tests 4',
  'ℹ suites 0',
  'ℹ pass 2',
  'ℹ fail 2',
  'ℹ cancelled 0',
  '',
  '✖ failing tests:',
  '',
  'test at tests\\a.test.js:229:1',
  '✖ breaks (3.0ms)',
  '  AssertionError [ERR_ASSERTION]: nope',
  '      at TestContext.<anonymous> (C:\\repo\\plugin\\lib\\x.js:12:3)',
  '',
  'test at tests/sub/b.test.js:5:1',
  '✖ also breaks (1.0ms)',
  '',
  'test at tests\\a.test.js:300:1',
  '✖ second failure in a (1.0ms)',
].join('\n');

test('spec reporter: sniffed as its own family (#3043)', () => {
  assert.strictEqual(sniffFamily(SPEC_LOG), 'spec');
});

test('spec reporter: a stray `not ok` line a test printed to stdout still sniffs spec, not tap (#3043)', () => {
  assert.strictEqual(sniffFamily(`not ok 1 - printed by a test\n${SPEC_LOG}`), 'spec');
});

test('spec reporter: failing files come from the failing-tests section, forward-slash, deduped, log order — never a stack-frame source file (#3043)', () => {
  assert.deepStrictEqual(extractFailingFiles(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }), ['tests/a.test.js', 'tests/sub/b.test.js']);
});

test('spec reporter: CRLF-terminated lines still extract (#3043)', () => {
  const crlf = SPEC_LOG.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(extractFailingFiles(crlf, 'spec', { cwd: 'C:\\repo' }), ['tests/a.test.js', 'tests/sub/b.test.js']);
});

test('spec reporter: an absolute test-at path under cwd is relativized (#3043)', () => {
  const abs = SPEC_LOG.replace('test at tests\\a.test.js:229:1', 'test at C:\\repo\\tests\\c.test.js:1:1');
  assert.deepStrictEqual(extractFailingFiles(abs, 'spec', { cwd: 'C:\\repo' })[0], 'tests/c.test.js');
});

test('spec reporter: counts parse from the ℹ summary lines (#3043)', () => {
  assert.deepStrictEqual(parseCounts(SPEC_LOG, 'spec'), { tests: 4, pass: 2, fail: 2 });
});

test('spec reporter: missing ℹ fail line means counts null, never a guess (#3043)', () => {
  assert.strictEqual(parseCounts(SPEC_LOG.replace('ℹ fail 2\n', ''), 'spec'), null);
});

test('spec reporter: failing region starts at the failing-tests section (#3043)', () => {
  const region = extractFailingRegion(SPEC_LOG, 'spec');
  assert.ok(region.startsWith('✖ failing tests:'));
  assert.ok(region.includes('test at tests/sub/b.test.js:5:1'));
});

test('spec reporter: a passing spec log (no failing section) extracts no files (#3043)', () => {
  const passing = ['✔ ok (1ms)', 'ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'].join('\n');
  assert.strictEqual(sniffFamily(passing), 'spec');
  assert.deepStrictEqual(extractFailingFiles(passing, 'spec'), []);
});

test('countUnmatchedFailures: a spec test-at entry that names no test file is counted, never silently dropped (#3043)', () => {
  const log = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n');
  assert.strictEqual(countUnmatchedFailures(log, 'spec'), 1);
  assert.deepStrictEqual(extractFailingFiles(log, 'spec'), ['tests/a.test.js']);
});

test('countUnmatchedFailures: 0 when every spec entry is a test file, and 0 for every other family (#3043)', () => {
  assert.strictEqual(countUnmatchedFailures(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }), 0);
  assert.strictEqual(countUnmatchedFailures('not ok 1 - x\n  at tests/helper.js:2:1', 'tap'), 0);
});

const FILE_LEVEL_LOG = ['ℹ tests 3', 'ℹ pass 0', 'ℹ fail 3', '', '✖ failing tests:', '',
  'test at tests\\a.test.js:1:1', '✖ tests\\a.test.js (1231.6738ms)', "  'test failed'", '',
  'test at tests/b.test.js:1:1', '✖ tests/b.test.js (3ms)', "  'test failed'", '',
  'test at tests/b.test.js:9:1', '✖ a real failing test (1ms)', '',
  'test at C:\\repo\\tests\\c.test.js:1:1', '✖ C:\\repo\\tests\\c.test.js (2ms)'].join('\n');

test('fileLevelFailures: a file whose only entry is the file itself is file-level; one that also has a per-test entry is not (#3043)', () => {
  const set = fileLevelFailures(FILE_LEVEL_LOG, 'spec', { cwd: 'C:\\repo' });
  assert.deepStrictEqual([...set].sort(), ['tests/a.test.js', 'tests/c.test.js']);
});

test('fileLevelFailures: CRLF logs behave the same; a per-test entry is never file-level (#3043)', () => {
  const crlf = FILE_LEVEL_LOG.replace(/\n/g, '\r\n');
  assert.deepStrictEqual([...fileLevelFailures(crlf, 'spec', { cwd: 'C:\\repo' })].sort(), ['tests/a.test.js', 'tests/c.test.js']);
  assert.strictEqual(fileLevelFailures(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }).size, 0);
});

test('fileLevelFailures: every other family returns an empty set (#3043)', () => {
  assert.strictEqual(fileLevelFailures('not ok 1 - x\n  at tests/a.test.js:2:1', 'tap').size, 0);
  assert.strictEqual(fileLevelFailures(FILE_LEVEL_LOG, 'generic').size, 0);
});
