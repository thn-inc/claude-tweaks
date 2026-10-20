'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, stripAnsi, extractFailingFiles, countUnmatchedFailures, unattributedFailureCount, fileLevelFailures, specEntryCount,
  failingTestsByFile, cancelledCount, testTree, tapLines, summaryDialect,
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

// #3155: a checkout path containing a space (e.g. this repo's own
// `/Users/.../Code Workspaces/claude-tweaks`) truncated the extracted path
// at the space under the old bare-whitespace-anchored regex, so a file
// failing at both base and HEAD was never recognized as the same file and
// misclassified `attributable`.
test('extractFailingFiles: a TAP location line and stack frame naming a space-containing absolute path relativize intact (#3155 AC1)', () => {
  const text = [
    'not ok 1 - a fails',
    '  ---',
    "  location: '/tmp/a b/repo/tests/x.test.js:1:21'",
    '  stack: |-',
    '    at TestContext.<anonymous> (/tmp/a b/repo/tests/x.test.js:1:21)',
    '  ...',
    '# tests 1', '# pass 0', '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap', { cwd: '/tmp/a b/repo' }), ['tests/x.test.js']);
});

test('extractFailingFiles: a bare `at path:L:C` frame (no parens) with a space-containing path relativizes intact (#3155)', () => {
  const text = [
    'not ok 1 - a fails',
    '  at /tmp/a b/repo/tests/x.test.js:1:21',
    '# tests 1', '# pass 0', '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'tap', { cwd: '/tmp/a b/repo' }), ['tests/x.test.js']);
});

test('failingTestsByFile, fileLevelFailures, and countUnmatchedFailures all return the same intact relative path for a space-containing cwd (#3155 AC2)', () => {
  const text = [
    'not ok 1 - a fails',
    '  ---',
    "  location: '/tmp/a b/repo/tests/x.test.js:1:21'",
    '  ...',
    '# tests 1', '# pass 0', '# fail 1',
  ].join('\n');
  const opts = { cwd: '/tmp/a b/repo' };
  assert.deepStrictEqual([...failingTestsByFile(text, 'tap', opts).keys()], ['tests/x.test.js']);
  assert.deepStrictEqual([...fileLevelFailures(text, 'tap', opts)], []);
  assert.strictEqual(countUnmatchedFailures(text, 'tap', opts), 0);
});

test('extractFailingFiles: a vitest/jest summary FAIL line with a space-containing path stops at the `>`/`(` terminator, not the internal space (#3155)', () => {
  const text = [
    'FAIL tests/a b/x.test.js > suite > case',
    '❯ tests/a b/y.test.ts (3 tests | 1 failed)',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(text, 'summary'), ['tests/a b/x.test.js', 'tests/a b/y.test.ts']);
});

test('extractFailingFiles: pytest FAILED path::name with a space-containing path still stops at `::` (#3155)', () => {
  const text = 'FAILED tests/a b/test_b.py::test_x - AssertionError';
  assert.deepStrictEqual(extractFailingFiles(text, 'summary'), ['tests/a b/test_b.py']);
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

test('spec reporter: with no failing-tests section the region falls through to the generic tail (#3043)', () => {
  const lines = Array.from({ length: GENERIC_TAIL_LINES + 5 }, (_, i) => `line ${i}`).concat(['ℹ tests 1', 'ℹ fail 1']);
  const region = extractFailingRegion(lines.join('\n'), 'spec');
  assert.strictEqual(region.split('\n').length, GENERIC_TAIL_LINES);
  assert.ok(region.endsWith('ℹ fail 1'));
  assert.ok(!region.includes('line 0'));
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

test('countUnmatchedFailures: 0 when every spec entry is a test file, and 0 for the summary and generic families (#3043)', () => {
  assert.strictEqual(countUnmatchedFailures(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }), 0);
  assert.strictEqual(countUnmatchedFailures(PYTEST_FIXTURE, 'summary'), 0);
  assert.strictEqual(countUnmatchedFailures(GENERIC_FIXTURE, 'generic'), 0);
});

test('unattributedFailureCount: a spec log with one allowlisted-shaped failing file plus one entry naming no test file is unattributed (#3066)', () => {
  const log = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'spec'), 1);
});

test('unattributedFailureCount: every spec entry naming a test file and entries == fail + cancelled is fully accounted — 0 (#3066)', () => {
  // Deliberately NOT SPEC_LOG above: that fixture's own pinned test
  // (specEntryCount(SPEC_LOG) === 3) has 3 entries against ℹ fail 2 — it is
  // not accounted either, by the same `baseline.js` accounting this
  // function mirrors, so it would be the wrong fixture to assert 0 on.
  const log = ['ℹ tests 2', 'ℹ pass 0', 'ℹ fail 2', 'ℹ cancelled 0', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/sub/b.test.js:5:1', '✖ y (1ms)'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'spec'), 0);
});

test('unattributedFailureCount: every entry names a test file, but the entry count does not add up to ℹ fail + ℹ cancelled — unattributed (#3066)', () => {
  const log = ['ℹ tests 4', 'ℹ pass 1', 'ℹ fail 3', 'ℹ cancelled 0', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/b.test.js:2:1', '✖ y (1ms)'].join('\n');
  assert.strictEqual(countUnmatchedFailures(log, 'spec'), 0, 'both entries do name a test file');
  assert.strictEqual(unattributedFailureCount(log, 'spec'), 1, 'but the entry count (2) undercounts ℹ fail (3)');
});

test('unattributedFailureCount: TAP with a stack frame naming no retryable file is unattributed (1) via countUnmatchedFailures, and a pytest summary log and a generic log are null (#3066, #3204, #3480)', () => {
  // "tests/helper.js" matches no retryable-file pattern (no .test./.spec.
  // suffix), so countUnmatchedFailures alone — before any counts-parsed
  // check is reached — already flags this block as unmatched.
  assert.strictEqual(unattributedFailureCount('not ok 1 - x\n  at tests/helper.js:2:1', 'tap'), 1);
  assert.strictEqual(unattributedFailureCount(PYTEST_FIXTURE, 'summary'), null);
  assert.strictEqual(unattributedFailureCount(GENERIC_FIXTURE, 'generic'), null);
});

test('unattributedFailureCount: TAP whose summary counts never parsed (truncated log) is unattributed even when every failing block names a file (#3066)', () => {
  // Review finding (3a/3b/3c lenses): the TAP branch used to return 0 as
  // soon as countUnmatchedFailures was 0, without ever checking that `#
  // tests`/`# pass`/`# fail` parsed — the exact gap `baseline.js`'s
  // `adjudicate` closes for both families. A log cut off before its
  // summary line must not read as fully accounted.
  const log = ['not ok 1 - a flaky one', '  ---', '  stack: |-', '    at tests/a.test.js:12:5', '  ...'].join('\n');
  assert.strictEqual(countUnmatchedFailures(log, 'tap'), 0, 'the one block does name a test file');
  assert.strictEqual(parseCounts(log, 'tap'), null, 'no # tests/# pass/# fail line at all');
  assert.strictEqual(unattributedFailureCount(log, 'tap'), 1);
});

test('unattributedFailureCount: TAP with every block naming a file, but the block count does not add up to # fail — unattributed (#3066)', () => {
  const log = ['not ok 1 - a flaky one', '  ---', '  stack: |-', '    at tests/a.test.js:12:5', '  ...',
    '# tests 2', '# pass 0', '# fail 2'].join('\n');
  assert.strictEqual(countUnmatchedFailures(log, 'tap'), 0, 'the one block does name a test file');
  assert.strictEqual(unattributedFailureCount(log, 'tap'), 1, 'but the block count (1) undercounts # fail (2)');
});

test('unattributedFailureCount: TAP with cancelled > 0 and block count == fail + cancelled is fully accounted — 0 (#3066)', () => {
  const log = ['not ok 1 - a', '  ---', '  stack: |-', '    at tests/a.test.js:12:5', '  ...',
    'not ok 2 - b', '  ---', '  stack: |-', '    at tests/b.test.js:12:5', '  ...',
    '# tests 2', '# pass 0', '# fail 1', '# cancelled 1'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'tap'), 0);
});

test('unattributedFailureCount: a spec log with ℹ cancelled > 0 correctly adds it into the expected total — 0 when entries == fail + cancelled (#3066)', () => {
  // Discrimination: dropping "+ cancelled" from `expected` would make this
  // 2 !== 1 and return 1 instead of 0.
  const log = ['ℹ tests 3', 'ℹ pass 0', 'ℹ fail 1', 'ℹ cancelled 1', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/b.test.js:2:1', '✖ y (1ms)'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'spec'), 0);
});

test('unattributedFailureCount: a spec log whose summary counts never parsed fails closed to unattributed (1), not accounted (#3066)', () => {
  const log = ['', '✖ failing tests:', '', 'test at tests/a.test.js:1:1', '✖ x (1ms)'].join('\n');
  assert.strictEqual(parseCounts(log, 'spec'), null, 'no ℹ tests/ℹ pass/ℹ fail line at all');
  assert.strictEqual(unattributedFailureCount(log, 'spec'), 1);
});

// Real jest 29.7.0 / vitest 1.6.0 / pytest 8.3.3 output (#3480), copied
// byte-for-byte; the dialect fixtures below are the ground truth the summary
// family's per-dialect accounting is pinned against.
const readDialect = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'verify-dialects', name), 'utf8');

const DIALECT_ROWS = [
  ['jest-attributed.txt', 0, ['tests/flaky.test.js']],
  ['jest-suite-failed-to-run.txt', 0, ['tests/broken.test.js', 'tests/flaky.test.js']],
  ['jest-coverage-threshold.txt', 1, ['tests/flaky.test.js']],
  ['vitest-attributed.txt', 0, ['tests/flaky.test.js']],
  ['vitest-failed-suite.txt', 0, ['tests/flaky.test.js', 'tests/broken.test.js']],
  ['vitest-unhandled-error.txt', 1, ['tests/flaky.test.js']],
  ['vitest-coverage-threshold.txt', 1, ['tests/flaky.test.js']],
  ['jest-obsolete-snapshot.txt', 1, ['tests/flaky.test.js']],
  ['jest-obsolete-snapshot-file.txt', 1, ['tests/flaky.test.js']],
  ['jest-bail.txt', 1, ['tests/a-flaky.test.js']],
  ['jest-skipped-suite.txt', 0, ['tests/flaky.test.js']],
  ['jest-global-teardown.txt', 1, ['tests/known.test.js']],
  ['jest-global-teardown-typeerror.txt', 1, ['tests/flaky.test.js']],
  ['jest-teardown-rejection.txt', 1, ['tests/flaky.test.js']],
  ['vitest-bail.txt', 1, ['tests/a-flaky.test.js']],
  ['vitest-skipped-file.txt', 1, ['tests/a-flaky.test.js']],
  ['vitest-global-teardown.txt', 1, ['tests/known.test.js']],
  ['vitest-teardown-rejection.txt', 1, ['tests/flaky.test.js']],
  ['vitest-unhandled-rejection.txt', 1, ['tests/flaky.test.js']],
  ['vitest-multi-project.txt', 0, ['tests/flaky.test.js']],
  ['pytest-attributed.txt', null, ['tests/test_flaky.py']],
  ['pytest-collection-error.txt', null, ['tests/test_flaky.py']],
];

for (const [name, count, files] of DIALECT_ROWS) {
  test(`captured ${name}: summary family, unattributedFailureCount ${count}, failing files ${JSON.stringify(files)} (#3480)`, () => {
    const log = readDialect(name);
    assert.strictEqual(sniffFamily(log), 'summary');
    assert.strictEqual(unattributedFailureCount(log, 'summary'), count);
    assert.deepStrictEqual(extractFailingFiles(log, 'summary'), files);
  });
}

test('summaryDialect: jest from Test Suites:/Tests:, vitest from colon-free Test Files, pytest and mixed are null (#3480)', () => {
  assert.strictEqual(summaryDialect(readDialect('jest-attributed.txt')), 'jest');
  assert.strictEqual(summaryDialect(readDialect('vitest-attributed.txt')), 'vitest');
  assert.strictEqual(summaryDialect(readDialect('pytest-collection-error.txt')), null);
  const mixed = `${readDialect('jest-attributed.txt')}\n Test Files  1 failed (1)`;
  assert.strictEqual(summaryDialect(mixed), null);
  assert.strictEqual(unattributedFailureCount(mixed, 'summary'), null);
  // A jest or vitest run followed by a pytest run in one log: pytest's failures
  // match no FAIL line, so accounting against the first runner would read 0.
  for (const name of ['jest-attributed.txt', 'vitest-attributed.txt']) {
    const both = `${readDialect(name)}\n${readDialect('pytest-collection-error.txt')}`;
    assert.strictEqual(summaryDialect(both), null, name);
    assert.strictEqual(unattributedFailureCount(both, 'summary'), null, name);
  }
});

test('unattributedFailureCount: a jest log with no Test Suites: line fails closed to 1, never null or 0 (#3480)', () => {
  const log = ['FAIL tests/flaky.test.js', '  ● flaky › sometimes fails', 'Tests:       1 failed, 2 passed, 3 total'].join('\n');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
});

test('unattributedFailureCount: a jest Test Suites count above the distinct FAIL files is unattributed by the difference (#3480)', () => {
  const log = readDialect('jest-attributed.txt').replace('Test Suites: 1 failed', 'Test Suites: 3 failed');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 2);
});

test('unattributedFailureCount: jest repeating a FAIL line in its failing-tests summary counts the file once (#3480)', () => {
  const log = readDialect('jest-attributed.txt').replace('Test Suites:', 'Summary of all failing tests\nFAIL tests/flaky.test.js\n  ● flaky › sometimes fails\n\nTest Suites:');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 0);
});

test('unattributedFailureCount: a jest FAIL line naming a non-test file is unattributed (#3480)', () => {
  // The summary's failed total stays 1 and one test file is named, so the
  // total-vs-named difference alone is 0 — only the non-test FAIL line makes
  // this 1.
  const log = readDialect('jest-attributed.txt').replace('PASS tests/ok.test.js', 'FAIL src/setup.js\n  ● Test suite failed to run');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
});

test('unattributedFailureCount: a vitest Errors count is read on its own, and the larger of it and the banner counts, never their sum (#3480)', () => {
  const attributed = readDialect('vitest-attributed.txt');
  const errorsLine = '     Errors  2 errors\n';
  const bare = attributed.replace('   Start at', `${errorsLine}   Start at`);
  assert.notStrictEqual(bare, attributed, 'the Errors line was inserted');
  assert.strictEqual(unattributedFailureCount(bare, 'summary'), 2);
  const banner = '⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\n';
  assert.strictEqual(unattributedFailureCount(attributed.replace(' RUN ', `${banner} RUN `), 'summary'), 1);
  assert.strictEqual(unattributedFailureCount(bare.replace(' RUN ', `${banner} RUN `), 'summary'), 2);
});

test('unattributedFailureCount: a vitest typecheck Source Errors banner (errors outside every test file) is unattributed (#3480)', () => {
  // Wording from vitest 1.6's reporter source: `divider(" Source Errors ")`, "Vitest found N
  // error(s) not related to your test files."
  const attributed = readDialect('vitest-attributed.txt');
  const log = attributed.replace(' RUN ', '⎯⎯⎯⎯⎯⎯ Source Errors ⎯⎯⎯⎯⎯⎯\nVitest found 1 error not related to your test files.\n\n RUN ');
  assert.notStrictEqual(log, attributed, 'the banner was inserted');
  assert.strictEqual(unattributedFailureCount(log, 'summary'), 1);
});

test('unattributedFailureCount: a CRLF jest or vitest log is accounted the same as its LF twin (#3480)', () => {
  for (const name of ['jest-attributed.txt', 'vitest-attributed.txt']) {
    const lf = readDialect(name);
    const crlf = lf.replace(/\n/g, '\r\n');
    assert.strictEqual(unattributedFailureCount(crlf, 'summary'), 0, name);
    assert.deepStrictEqual(extractFailingFiles(crlf, 'summary'), extractFailingFiles(lf, 'summary'), name);
  }
});

for (const line of [
  'Jest: Uncovered count for lines (5) exceeds global threshold (2)',
  'Jest: Coverage data for ./src/utils/ was not found.',
  'DbFailure: Jest: Got error running globalTeardown - /repo/teardown.js, reason: teardown leaked a db handle',
]) {
  test(`unattributedFailureCount: a fully attributed jest log plus "${line}" is unattributed (#3480)`, () => {
    assert.strictEqual(unattributedFailureCount(`${readDialect('jest-attributed.txt')}\n${line}\n`, 'summary'), 1);
  });
}

// A throwing global setup exits before any summary prints, so the captured
// log is refused without accounting; its wording, spliced into an attributed
// log, still counts on its own.
for (const [name, attributed, wording] of [
  ['jest-global-setup.txt', 'jest-attributed.txt', 'Error: Jest: Got error running globalSetup'],
  ['vitest-global-setup.txt', 'vitest-attributed.txt', '⎯ Error during global setup ⎯'],
]) {
  test(`captured ${name}: no summary, so never accounted; its global-setup line alone is unattributed (#3480)`, () => {
    const log = readDialect(name);
    assert.strictEqual(sniffFamily(log), 'generic');
    assert.strictEqual(unattributedFailureCount(log, 'summary'), null);
    const line = log.split('\n').find((l) => l.startsWith(wording));
    assert.ok(line, `${name} carries "${wording}"`);
    assert.strictEqual(unattributedFailureCount(`${readDialect(attributed)}\n${line}\n`, 'summary'), 1);
  });
}

test('unattributedFailureCount: a concatenated multi-run jest or vitest log (more than one summary line) is unattributed (#3480)', () => {
  for (const name of ['jest-attributed.txt', 'vitest-attributed.txt']) {
    assert.strictEqual(unattributedFailureCount(`${readDialect(name)}${readDialect(name)}`, 'summary'), 1, name);
  }
});

test('unattributedFailureCount: an ANSI-coloured vitest log is accounted the same as its plain twin (#3480)', () => {
  const plain = readDialect('vitest-attributed.txt');
  const coloured = plain.replace(' FAIL ', ' \x1b[31mFAIL\x1b[39m ').replace(' Test Files ', '\x1b[2m Test Files \x1b[22m');
  assert.strictEqual(unattributedFailureCount(coloured, 'summary'), 0);
});

// node --test's real TAP shape (Node 20 and 24 alike): a failing subtest is an
// indented `not ok` block, and its suite's own `not ok` follows at column 0.
const NESTED_TAP = [
  '# Subtest: grp',
  '    # Subtest: inner',
  '    not ok 1 - inner',
  '      ---',
  "      location: '/repo/tests/nested.test.js:2:25'",
  '      stack: |-',
  '        TestContext.<anonymous> (/repo/tests/nested.test.js:2:51)',
  '      ...',
  '    # Subtest: fine',
  '    ok 2 - fine',
  '    1..2',
  'not ok 1 - grp',
  '  ---',
  "  type: 'suite'",
  "  location: '/repo/tests/nested.test.js:2:1'",
  '  ...',
  '# tests 2', '# pass 1', '# fail 1',
].join('\n');

test('countUnmatchedFailures: a TAP `not ok` block, at any indentation, whose frames name no test file is counted (#3043)', () => {
  assert.strictEqual(countUnmatchedFailures('not ok 1 - x\n  at tests/helper.js:2:1', 'tap'), 1);
  assert.strictEqual(countUnmatchedFailures(NESTED_TAP, 'tap', { cwd: '/repo' }), 0);
  const frameless = NESTED_TAP.replace("      location: '/repo/tests/nested.test.js:2:25'\n", '')
    .replace('        TestContext.<anonymous> (/repo/tests/nested.test.js:2:51)\n', '');
  assert.strictEqual(countUnmatchedFailures(frameless, 'tap', { cwd: '/repo' }), 1, 'the indented block is unaccounted for even though its suite names the file');
  assert.deepStrictEqual(extractFailingFiles(NESTED_TAP, 'tap', { cwd: '/repo' }), ['tests/nested.test.js']);
});

test('specEntryCount: every failing-section entry, a test file or not (#3043)', () => {
  assert.strictEqual(specEntryCount(SPEC_LOG), 3);
  assert.strictEqual(specEntryCount(['ℹ fail 2', '✖ failing tests:', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n')), 1);
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

test('fileLevelFailures: a per-test TAP failure is not file-level, and the summary/generic families return an empty set (#3043)', () => {
  assert.strictEqual(fileLevelFailures('not ok 1 - x\n  at tests/a.test.js:2:1', 'tap').size, 0);
  assert.strictEqual(fileLevelFailures(FILE_LEVEL_LOG, 'generic').size, 0);
  assert.strictEqual(fileLevelFailures(PYTEST_FIXTURE, 'summary').size, 0);
});

// The real node --test TAP shape of a test file that fails to load: the
// block's name is the path, YAML-escaped (`\\` per separator) on Windows.
const TAP_FILE_LEVEL = ['not ok 1 - tests\\\\broken.test.js', '  ---',
  "  location: 'C:\\\\repo\\\\tests\\\\broken.test.js:1:1'", "  error: 'test failed'", '  ...',
  '# tests 1', '# pass 0', '# fail 1'].join('\n');

test('fileLevelFailures: a TAP block named by its own file is file-level (#3043)', () => {
  assert.deepStrictEqual([...fileLevelFailures(TAP_FILE_LEVEL, 'tap', { cwd: 'C:\\repo' })], ['tests/broken.test.js']);
});

test('failingTestsByFile: spec names per file as a multiset, duration stripped, file-level names normalized to the path (#3043)', () => {
  const got = failingTestsByFile(FILE_LEVEL_LOG, 'spec', { cwd: 'C:\\repo' });
  assert.deepStrictEqual([...got], [
    ['tests/a.test.js', ['tests/a.test.js']],
    ['tests/b.test.js', ['tests/b.test.js', 'a real failing test']],
    ['tests/c.test.js', ['tests/c.test.js']],
  ]);
  assert.deepStrictEqual(failingTestsByFile(SPEC_LOG, 'spec', { cwd: 'C:\\repo' }).get('tests/a.test.js'), ['breaks', 'second failure in a']);
});

test('failingTestsByFile: an entry whose name line does not parse is null, never a guessed name (#3043)', () => {
  const log = ['ℹ fail 1', '✖ failing tests:', 'test at tests/a.test.js:1:1', 'garbled'].join('\n');
  assert.deepStrictEqual(failingTestsByFile(log, 'spec').get('tests/a.test.js'), [null]);
});

test('failingTestsByFile: TAP names come from every `not ok` block at any indentation; a SKIP/TODO block names nothing (#3043)', () => {
  assert.deepStrictEqual([...failingTestsByFile(NESTED_TAP, 'tap', { cwd: '/repo' })], [['tests/nested.test.js', ['inner', 'grp']]]);
  const todo = 'not ok 1 - known # TODO fix later\n  at tests/a.test.js:2:1\nnot ok 2 - real\n  at tests/a.test.js:5:1\n# fail 1';
  assert.deepStrictEqual(failingTestsByFile(todo, 'tap').get('tests/a.test.js'), ['real']);
  assert.deepStrictEqual([...failingTestsByFile(TAP_FILE_LEVEL, 'tap', { cwd: 'C:\\repo' })], [['tests/broken.test.js', ['tests/broken.test.js']]]);
});

test('failingTestsByFile: summary and generic families return an empty Map (#3043)', () => {
  assert.strictEqual(failingTestsByFile(PYTEST_FIXTURE, 'summary').size, 0);
  assert.strictEqual(failingTestsByFile(GENERIC_FIXTURE, 'generic').size, 0);
});

// Two tests sharing the leaf name `works` (different describes), one timed out, one file-level.
const LOCATED_SPEC = ['ℹ tests 4', 'ℹ pass 0', 'ℹ fail 4', 'ℹ cancelled 0', '', '✖ failing tests:', '',
  'test at tests/a.test.js:3:3', '✖ works (1ms)', '  AssertionError', '',
  'test at tests/a.test.js:9:3', '✖ works (1ms)', '  AssertionError', '',
  'test at tests/a.test.js:12:1', '✖ slow (100ms)', "  'test timed out after 100ms'", '',
  'test at tests/b.test.js:1:1', '✖ tests/b.test.js (5ms)', "  'test failed'", ''].join('\n');

test('failingTestsByFile: located keys carry the failing site — file-level ones too, so a load failure and a hook failure differ (#3043)', () => {
  assert.deepStrictEqual(failingTestsByFile(LOCATED_SPEC, 'spec', { cwd: '/r', located: true }).get('tests/a.test.js'), ['works@3:3', 'works@9:3', 'slow@12:1']);
  assert.deepStrictEqual(failingTestsByFile(LOCATED_SPEC, 'spec', { cwd: '/r', located: true }).get('tests/b.test.js'), ['tests/b.test.js@1:1']);
  const tap = "not ok 1 - works\n  ---\n  location: '/r/tests/a.test.js:9:3'\n  ...\nnot ok 2 - bare\n  at tests/a.test.js:4:1\n# fail 2";
  assert.deepStrictEqual(failingTestsByFile(tap, 'tap', { cwd: '/r', located: true }).get('tests/a.test.js'), ['works@9:3', null]);
});

test('failingTestsByFile: conclusiveOnly drops entries that timed out or were cancelled (#3043)', () => {
  assert.deepStrictEqual(failingTestsByFile(LOCATED_SPEC, 'spec', { cwd: '/r', conclusiveOnly: true }).get('tests/a.test.js'), ['works', 'works']);
  const tap = "not ok 1 - slow\n  ---\n  location: 'tests/a.test.js:4:1'\n  failureType: 'testTimeoutFailure'\n  ...\nnot ok 2 - real\n  at tests/a.test.js:5:1\n# fail 2";
  assert.deepStrictEqual(failingTestsByFile(tap, 'tap').get('tests/a.test.js'), ['slow', 'real'], 'the timed-out block names the file');
  assert.deepStrictEqual(failingTestsByFile(tap, 'tap', { conclusiveOnly: true }).get('tests/a.test.js'), ['real']);
});

test('#3153: conclusiveOnly reads only a TAP block\'s own top-level keys — a quoted child timeout does not make the parent inconclusive', () => {
  const quoted = NESTED_CHILD_TAP
    .replace("      failureType: 'testCodeFailure'", "      failureType: 'testTimeoutFailure'")
    .replace("      error: 'nope'", "      error: 'test timed out after 100ms'");
  assert.notStrictEqual(quoted, NESTED_CHILD_TAP);
  assert.deepStrictEqual(failingTestsByFile(quoted, 'tap', { cwd: '/repo', conclusiveOnly: true }).get('tests/meta.test.js'),
    ['meta: a spawned fixture run must pass']);
});

test('specEntryCount still counts back-to-back test at lines (#3043)', () => {
  assert.strictEqual(specEntryCount(['✖ failing tests:', 'test at tests/a.test.js:1:1', 'test at tests/b.test.js:2:1', '✖ x (1ms)'].join('\n')), 2);
});

test('cancelledCount reads ℹ cancelled / # cancelled, null when absent (#3043)', () => {
  assert.strictEqual(cancelledCount(LOCATED_SPEC, 'spec'), 0);
  assert.strictEqual(cancelledCount('ℹ tests 2\nℹ cancelled 1', 'spec'), 1);
  assert.strictEqual(cancelledCount('# tests 2\n# cancelled 3', 'tap'), 3);
  assert.strictEqual(cancelledCount('ℹ tests 2', 'spec'), null);
});

test('testTree counts every test point by name and the ones that passed — skips and the failing section excluded (#3043)', () => {
  const spec = ['▶ grp', '  ✔ works (1ms)', '  ✖ works (2ms)', '▶ grp', '✔ quick (1ms)', '﹣ later (0.1ms) # SKIP', 'ℹ tests 4', '✖ failing tests:', 'test at tests/a.test.js:3:3', '✖ works (2ms)'].join('\n');
  const t = testTree(spec, 'spec');
  assert.strictEqual(t.all.get('works'), 2);
  assert.strictEqual(t.passed.get('works'), 1);
  assert.strictEqual(t.passed.get('quick'), 1);
  assert.strictEqual(t.all.get('later'), 1);
  assert.strictEqual(t.passed.get('later'), undefined);
  const tap = testTree('ok 1 - a\nnot ok 2 - b\n    ok 1 - c # SKIP\nok 3 - d # TODO', 'tap');
  assert.deepStrictEqual([...tap.passed], [['a', 1]]);
  assert.strictEqual(tap.all.get('c'), 1);
});

test('testTree qualifies failing points by suite path — spec `▶` nesting and tap `# Subtest:` nesting (#3043)', () => {
  const spec = testTree(['▶ X', '  ✖ works (1ms)', '✖ X (2ms)', '▶ Y', '  ✔ works (1ms)', '✔ Y (2ms)', 'ℹ tests 2'].join('\n'), 'spec');
  assert.deepStrictEqual(spec.failed, ['["X","works"]'], 'X only inherits its child failure — it has no failing-section entry of its own');
  assert.strictEqual(spec.paths.get('["Y","works"]'), 1);
  assert.strictEqual(spec.all.get('works'), 2);
  assert.strictEqual(spec.wellFormed, true);
  const tap = testTree(['# Subtest: X', '    # Subtest: works', '    not ok 1 - works', '    1..1', 'not ok 1 - X', '# Subtest: Y', 'ok 2 - Y'].join('\n'), 'tap');
  assert.deepStrictEqual(tap.failed, ['["X","works"]', '["X"]']);
  assert.deepStrictEqual([...tap.passed], [['Y', 1]]);
  assert.strictEqual(tap.wellFormed, true);
  // A name containing the old ` > ` separator cannot fake a nesting level.
  assert.notStrictEqual(testTree('▶ a > b\n  ✖ c (1ms)\n✖ a > b (1ms)', 'spec').failed[0], testTree('▶ a\n  ▶ b\n    ✖ c (1ms)\n  ✖ b (1ms)\n✖ a (1ms)', 'spec').failed[0]);
});

test('testTree reads suite names byte-for-byte and marks unclosed or mismatched nesting malformed (#3043)', () => {
  // ` setup` (leading space) opens and closes under the same name — later siblings are top-level again.
  const spaced = testTree(['▶  setup', '  ✖ a (1ms)', '✖  setup (2ms)', '✖ works (1ms)'].join('\n'), 'spec');
  assert.strictEqual(spaced.wellFormed, true);
  assert.deepStrictEqual(spaced.failed, ['[" setup","a"]', '["works"]']);
  // A suite name with a newline prints across lines: its closer never parses, so the tree is no evidence.
  assert.strictEqual(testTree(['▶ multi', 'line', '  ✖ a (1ms)', '✖ multi', 'line (2ms)', '✖ works (1ms)'].join('\n'), 'spec').wellFormed, false);
  // A point at the open suite's indent that is not its closer.
  assert.strictEqual(testTree(['▶ X', '✖ works (1ms)'].join('\n'), 'spec').wellFormed, false);
  const tapSpaced = testTree(['# Subtest:  setup', '    # Subtest: a', '    not ok 1 - a', 'not ok 1 -  setup', 'not ok 2 - works'].join('\n'), 'tap');
  assert.strictEqual(tapSpaced.wellFormed, true);
  assert.deepStrictEqual(tapSpaced.failed, ['[" setup","a"]', '[" setup"]', '["works"]']);
});

test('testTree reads a name that itself contains ` (Nms)` whole, never its prefix (#3043)', () => {
  const t = testTree('✔ foo (1ms) bar (0.34ms)', 'spec');
  assert.strictEqual(t.passed.get('foo (1ms) bar'), 1);
  assert.strictEqual(t.passed.get('foo'), undefined);
});

test('testTree keeps a parent only when it failed in its own right — spec listing, tap failureType (#3043)', () => {
  // spec: P is listed in the failing section (its own error); S only inherits from its child.
  const spec = testTree(['▶ P', '  ✖ child (1ms)', '✖ P (2ms)', '▶ S', '  ✖ inner (1ms)', '✖ S (2ms)', 'ℹ tests 3', '', '✖ failing tests:', '',
    'test at tests/a.test.js:5:3', '✖ child (1ms)', '', 'test at tests/a.test.js:4:1', '✖ P (2ms)', '', 'test at tests/a.test.js:9:3', '✖ inner (1ms)'].join('\n'), 'spec');
  assert.deepStrictEqual(spec.failed, ['["P","child"]', '["P"]', '["S","inner"]']);
  // tap: P's block says subtestsFailed (inherited); S's says hookFailed (its own).
  const tap = testTree(['# Subtest: P', '    # Subtest: child', '    not ok 1 - child', '    1..1', 'not ok 1 - P', '  ---', "  failureType: 'subtestsFailed'", '  ...',
    '# Subtest: S', '    # Subtest: inner', '    ok 1 - inner', '    1..1', 'not ok 2 - S', '  ---', "  failureType: 'hookFailed'", '  ...'].join('\n'), 'tap');
  assert.deepStrictEqual(tap.failed, ['["P","child"]', '["S"]']);
});

test('testTree: a failing leaf keeps its own listing — it never vouches for a same-named parent elsewhere (#3043)', () => {
  // A > P is a failing leaf (listed once); B > P is a suite failing only through its child c.
  const lines = ['▶ A', '  ✖ P (1ms)', '✖ A (2ms)', '▶ B', '  ▶ P', '    ✖ c (1ms)', '  ✖ P (2ms)', '✖ B (3ms)', 'ℹ tests 2', '', '✖ failing tests:', '',
    'test at tests/a.test.js:2:3', '✖ P (1ms)', '', 'test at tests/a.test.js:6:5', '✖ c (1ms)'];
  const t = testTree(lines.join('\n'), 'spec');
  assert.deepStrictEqual(t.failed, ['["A","P"]', '["B","P","c"]']);
  assert.strictEqual(t.wellFormed, true);
  // Two same-named parents with one spare listing: which one failed in its own right is unknowable.
  const ambiguous = ['▶ P', '  ✖ x (1ms)', '✖ P (2ms)', '▶ Q', '  ▶ P', '    ✖ y (1ms)', '  ✖ P (2ms)', '✖ Q (3ms)', '', '✖ failing tests:', '',
    'test at tests/a.test.js:2:3', '✖ x (1ms)', '', 'test at tests/a.test.js:6:5', '✖ y (1ms)', '', 'test at tests/a.test.js:5:3', '✖ P (2ms)'];
  assert.strictEqual(testTree(ambiguous.join('\n'), 'spec').wellFormed, false);
});

test('testTree and tapBlocks read a TAP YAML block as data — `failureType:` or `not ok` lines inside expected/actual text are not points (#3043)', () => {
  const tap = ['# Subtest: K', 'not ok 1 - K', '  ---', "  failureType: 'testCodeFailure'", '  ...',
    '# Subtest: L', 'not ok 2 - L', '  ---', "  failureType: 'testCodeFailure'", '  expected: |-', '    summary', "    failureType: 'subtestsFailed'", '    not ok 1 - Foo', "  location: '/r/tests/a.test.js:9:1'", '  ...', '# fail 2'].join('\n');
  const t = testTree(tap, 'tap');
  assert.deepStrictEqual(t.failed, ['["K"]', '["L"]']);
  assert.strictEqual(t.all.get('Foo'), undefined);
  assert.deepStrictEqual(failingTestsByFile(tap, 'tap', { cwd: '/r' }).get('tests/a.test.js'), ['L']);
});

test('testTree treats any ` # …` suffix as neither passed nor failed — t.skip(reason) included (#3043)', () => {
  const t = testTree(['﹣ works (0.1ms) # windows only', '✔ works (1ms)'].join('\n'), 'spec');
  assert.strictEqual(t.all.get('works'), 2, 'the skipped twin still counts, so the name is not unique');
  assert.strictEqual(t.passed.get('works'), 1);
});

// #3153: a meta-test that spawns its own `node --test` run and fails with the
// child's stdout as its assertion message. node quotes that whole child TAP
// document inside the outer point's `error: |-` YAML value — its `not ok`,
// `location:` and stack lines name the child's temp-dir fixture, never a
// file of this run. Shape recorded from a real node 22 run.
const NESTED_CHILD_TAP = [
  'TAP version 13',
  '# Subtest: meta: a spawned fixture run must pass',
  'not ok 1 - meta: a spawned fixture run must pass',
  '  ---',
  '  duration_ms: 149.780209',
  "  type: 'test'",
  "  location: '/repo/tests/meta.test.js:9:1'",
  "  failureType: 'testCodeFailure'",
  '  error: |-',
  '    TAP version 13',
  '    # Subtest: env',
  '    not ok 1 - env',
  '      ---',
  '      duration_ms: 0.391208',
  "      type: 'test'",
  "      location: '/private/var/folders/3_/x/T/verify-cli-test-vUXbeY/tests/env.test.js:1:40'",
  "      failureType: 'testCodeFailure'",
  "      error: 'nope'",
  "      code: 'ERR_TEST_FAILURE'",
  '      stack: |-',
  '        TestContext.<anonymous> (/private/var/folders/3_/x/T/verify-cli-test-vUXbeY/tests/env.test.js:1:66)',
  '        Test.runInAsyncScope (node:async_hooks:214:14)',
  '      ...',
  '    1..1',
  '    # tests 1',
  '    # pass 0',
  '    # fail 1',
  '    ',
  '    1 !== 0',
  '    ',
  "  code: 'ERR_ASSERTION'",
  "  name: 'AssertionError'",
  '  expected: 0',
  '  actual: 1',
  "  operator: 'strictEqual'",
  '  stack: |-',
  '    TestContext.<anonymous> (/repo/tests/meta.test.js:17:10)',
  '    Test.runInAsyncScope (node:async_hooks:214:14)',
  '  ...',
  '1..1',
  '# tests 1',
  '# suites 0',
  '# pass 0',
  '# fail 1',
  '# cancelled 0',
].join('\n');

test('#3153: a child TAP document quoted inside a failing point\'s error text names no failing file — only the point\'s own location/stack do', () => {
  assert.deepStrictEqual(extractFailingFiles(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), ['tests/meta.test.js']);
  assert.deepStrictEqual([...failingTestsByFile(NESTED_CHILD_TAP, 'tap', { cwd: '/repo', located: true })],
    [['tests/meta.test.js', ['meta: a spawned fixture run must pass@9:1']]]);
  assert.strictEqual(countUnmatchedFailures(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), 0);
  assert.strictEqual(unattributedFailureCount(NESTED_CHILD_TAP, 'tap', { cwd: '/repo' }), 0);
});

test('#3153: a nested subtest\'s own YAML location is still read — only quoted message text is skipped', () => {
  assert.deepStrictEqual(extractFailingFiles(NESTED_TAP, 'tap', { cwd: '/repo' }), ['tests/nested.test.js']);
  assert.deepStrictEqual([...failingTestsByFile(NESTED_TAP, 'tap', { cwd: '/repo', located: true })],
    [['tests/nested.test.js', ['inner@2:25', 'grp@2:1']]]);
});

test('#3153: an `exists` predicate drops a path absent from the checkout; a failure naming only such a path is unmatched, never a file', () => {
  const tap = ['not ok 1 - real', "  location: '/repo/tests/a.test.js:1:1'", '  at /tmp/elsewhere/tests/ghost.test.js:2:1',
    'not ok 2 - phantom only', '  at tests/ghost.test.js:3:1', '# tests 2', '# pass 0', '# fail 2'].join('\n');
  const exists = (rel) => rel === 'tests/a.test.js';
  assert.deepStrictEqual(extractFailingFiles(tap, 'tap', { cwd: '/repo', exists }), ['tests/a.test.js']);
  assert.strictEqual(countUnmatchedFailures(tap, 'tap', { cwd: '/repo', exists }), 1);
  assert.deepStrictEqual([...failingTestsByFile(tap, 'tap', { cwd: '/repo', exists }).keys()], ['tests/a.test.js']);
  const spec = ['ℹ tests 2', 'ℹ pass 0', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at /repo/tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at /repo/tests/gone.test.js:1:1', '✖ y (1ms)'].join('\n');
  assert.deepStrictEqual(extractFailingFiles(spec, 'spec', { cwd: '/repo', exists }), ['tests/a.test.js']);
  assert.strictEqual(countUnmatchedFailures(spec, 'spec', { cwd: '/repo', exists }), 1);
  // No predicate: the pre-#3153 behavior, unchanged.
  assert.deepStrictEqual(extractFailingFiles(tap, 'tap', { cwd: '/repo' }), ['tests/a.test.js', '/tmp/elsewhere/tests/ghost.test.js', 'tests/ghost.test.js']);
});

// Final-review finding 1: a TAP producer (tape-style) indents its YAML keys
// deeper than its own `---` line. node puts keys at the `---` indent, but a
// producer that doesn't must still be read correctly — the key indent is the
// indent of the first non-blank line after `---`, not assumed equal to the
// `---` line's own indent.
test('tapBlocks: a YAML key indented deeper than its own `---` line is still recognized (deep-key TAP producer)', () => {
  const log = [
    'not ok 1 - deep keys',
    '  ---',
    '    operator: fail',
    "    location: '/repo/tests/deep.test.js:4:3'",
    '    error: |-',
    '      not ok 1 - quoted',
    "        location: '/tmp/x/tests/ghost.test.js:1:1'",
    '  ...',
    '# tests 1',
    '# pass 0',
    '# fail 1',
  ].join('\n');
  assert.deepStrictEqual(extractFailingFiles(log, 'tap', { cwd: '/repo' }), ['tests/deep.test.js']);
  assert.strictEqual(countUnmatchedFailures(log, 'tap', { cwd: '/repo' }), 0);
});

const kinds = (text) => tapLines(text.split('\n')).map((e) => e.kind);
const owners = (text) => tapLines(text.split('\n')).map((e) => e.owner);

test('AC2.1: tapLines classifies a node TAP failure block, its YAML terminator, and the points around it', () => {
  const text = ['# Subtest: s', 'ok 1 - a', 'not ok 2 - b', '  ---', "  location: 'tests/a.test.js:1:1'", '  error: |-', '    boom', '  ...', '# tests 2'].join('\n');
  assert.deepStrictEqual(kinds(text), ['subtest', 'ok', 'notOk', 'yamlOpen', 'yaml', 'yaml', 'yaml', 'yamlClose', 'comment']);
  assert.deepStrictEqual(owners(text), [-1, -1, 2, 2, 2, 2, 2, 2, -1]);
  const entries = tapLines(text.split('\n'));
  const loc = entries[4];
  assert.deepStrictEqual([loc.key, loc.keyStart, loc.indent], ['location', true, 2]);
  const continuation = entries[6];
  assert.deepStrictEqual([continuation.key, continuation.keyStart], ['error', false], 'a continuation line carries its key but does not start one');
});

test('AC2.1: a deeper "..." and "not ok"/"ok 1" lines inside YAML error text stay yaml, owned by the block', () => {
  const text = ['not ok 1 - x', '  ---', '  error: |-', '    ...', '    not ok 9 - quoted', '    ok 1 - quoted', '  ...', 'ok 2 - next'].join('\n');
  assert.deepStrictEqual(kinds(text), ['notOk', 'yamlOpen', 'yaml', 'yaml', 'yaml', 'yaml', 'yamlClose', 'ok']);
  assert.deepStrictEqual(owners(text), [0, 0, 0, 0, 0, 0, 0, -1]);
});

test('AC2.1: a passing point\'s YAML is classified but owned by no block', () => {
  const text = ['ok 1 - a', '  ---', '  duration_ms: 1', '  ...'].join('\n');
  assert.deepStrictEqual(kinds(text), ['ok', 'yamlOpen', 'yaml', 'yamlClose']);
  assert.deepStrictEqual(owners(text), [-1, -1, -1, -1]);
});

test('AC2.1: a # line ends a block, and a deeper ok N with no YAML is an ok point at its own indent', () => {
  const text = ['    not ok 2 - nested', "      location: 'tests/a.test.js:5:5'", '        ok 1 - quoted', '        tail', '# Error: crashed', '  ---'].join('\n');
  const entries = tapLines(text.split('\n'));
  assert.deepStrictEqual(entries.map((e) => e.kind), ['notOk', 'other', 'ok', 'other', 'comment', 'other']);
  assert.deepStrictEqual(entries.map((e) => e.owner), [0, 0, -1, -1, -1, -1]);
  assert.deepStrictEqual([entries[0].indent, entries[2].indent], [4, 8]);
});

test('AC2.1: CRLF lines classify exactly like LF lines', () => {
  const lf = ['not ok 1 - x', '  ---', '  error: boom', '  ...', 'ok 2 - y'];
  assert.deepStrictEqual(tapLines(lf.map((l) => `${l}\r`)), tapLines(lf));
});
