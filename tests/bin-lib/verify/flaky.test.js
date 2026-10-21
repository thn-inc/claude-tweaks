'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  planRetry, applyRetryResults, retryLogName, runRetries, flakyCaveatLines,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'flaky.js'));
const {
  sniffFamily, extractFailingFiles, unattributedFailureCount,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'extract.js'));

// Real jest/vitest/pytest output (#3480), shared with extract.test.js.
const readDialect = (name) => fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'verify-dialects', name), 'utf8');

const FLAKY = { files: ['tests/a.test.js', 'tests/b.test.js'], maxRetries: 1 };
const RETRY = { tests: 'node --test {file}' };
const JEST_UNATTRIBUTED = [
  'FAIL tests/flaky.test.js',
  '  ● flaky › sometimes fails',
  'FAIL src/setup.js',
  '  ● Test suite failed to run',
  'Tests:       2 failed, 3 passed, 5 total',
].join('\n');

test('planRetry: every failing file listed + a template → retry with one command per file, log order kept (AC2)', () => {
  const plan = planRetry({ failingFiles: ['tests/b.test.js', 'tests/a.test.js'], flaky: FLAKY, retry: RETRY, suite: 'tests' });
  assert.deepStrictEqual(plan, {
    retry: true,
    files: ['tests/b.test.js', 'tests/a.test.js'],
    command: [
      { file: 'tests/b.test.js', cmd: 'node --test tests/b.test.js' },
      { file: 'tests/a.test.js', cmd: 'node --test tests/a.test.js' },
    ],
  });
});

test('planRetry: a $(…) failing path is quoted, never shell syntax (#3676)', () => {
  const plan = planRetry({ failingFiles: ['tests/$(touch PWNED).test.js'], flaky: { files: ['tests/**'], maxRetries: 1 }, retry: RETRY, suite: 'tests', platform: 'linux' });
  assert.strictEqual(plan.retry, true);
  assert.deepStrictEqual(plan.command, [{ file: 'tests/$(touch PWNED).test.js', cmd: "node --test 'tests/$(touch PWNED).test.js'" }]);
});

test('planRetry: a path cmd.exe cannot quote refuses with unsafe-path (#3676)', () => {
  const plan = planRetry({ failingFiles: ['tests/%PATH%.test.js'], flaky: { files: ['tests/**'], maxRetries: 1 }, retry: RETRY, suite: 'tests', platform: 'win32' });
  assert.deepStrictEqual(plan, {
    retry: false,
    reason: 'unsafe-path: [tests/%PATH%.test.js (cmd-unquotable)]',
    unsafe: [{ file: 'tests/%PATH%.test.js', reason: 'cmd-unquotable' }],
  });
});

test('planRetry: every unsafe path is named in the reason, and a control byte is shown escaped (#3676)', () => {
  const plan = planRetry({ failingFiles: ['tests/%A%.test.js', 'tests/b\x1b[31m.test.js', '-x.test.js'], flaky: { files: ['**'], maxRetries: 1 }, retry: RETRY, suite: 'tests', platform: 'win32' });
  assert.strictEqual(plan.retry, false);
  assert.strictEqual(plan.reason, 'unsafe-path: [tests/%A%.test.js (cmd-unquotable), tests/b\\x1b[31m.test.js (control-character), -x.test.js (leading-dash)]');
  assert.deepStrictEqual(plan.unsafe.map((u) => u.file), ['tests/%A%.test.js', 'tests/b\x1b[31m.test.js', '-x.test.js'], 'the structured list keeps the raw paths');
});

test('planRetry: one unsafe path in a mixed list refuses the whole retry (#3676)', () => {
  const plan = planRetry({ failingFiles: ['tests/a.test.js', 'tests/%PATH%.test.js'], flaky: { files: ['tests/**'], maxRetries: 1 }, retry: RETRY, suite: 'tests', platform: 'win32' });
  assert.strictEqual(plan.retry, false);
  assert.strictEqual(plan.reason, 'unsafe-path: [tests/%PATH%.test.js (cmd-unquotable)]');
});

test('planRetry: maxRetries 0 keeps max-retries-0 even with an unsafe path (#3676)', () => {
  const plan = planRetry({ failingFiles: ['tests/%PATH%.test.js'], flaky: { files: ['tests/**'], maxRetries: 0 }, retry: RETRY, suite: 'tests', platform: 'win32' });
  assert.deepStrictEqual(plan, { retry: false, reason: 'max-retries-0' });
});

test('planRetry: any unlisted failing file → no retry, and the reason names every unlisted file (AC2)', () => {
  const plan = planRetry({ failingFiles: ['tests/a.test.js', 'tests/real.test.js', 'tests/other.test.js'], flaky: FLAKY, retry: RETRY, suite: 'tests' });
  assert.strictEqual(plan.retry, false);
  assert.strictEqual(plan.reason, 'unlisted: [tests/real.test.js, tests/other.test.js]');
  assert.deepStrictEqual(plan.unlisted, ['tests/real.test.js', 'tests/other.test.js']);
});

test('planRetry: an unattributed failure refuses retry even when every named failing file is allowlisted (#3066 AC1)', () => {
  const log = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  const unattributedCount = unattributedFailureCount(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/a.test.js']);
  assert.strictEqual(unattributedCount, 1);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/a.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests', unattributedCount,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'unattributed-failures: 1' });
});

test('planRetry: a jest log with an allowlisted failing file plus a failing suite no test file accounts for refuses retry — unattributed-failures (#3480)', () => {
  const family = sniffFamily(JEST_UNATTRIBUTED);
  assert.strictEqual(family, 'summary');
  const failingFiles = extractFailingFiles(JEST_UNATTRIBUTED, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const unattributedCount = unattributedFailureCount(JEST_UNATTRIBUTED, family);
  assert.strictEqual(unattributedCount, 1);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests', unattributedCount, family,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'unattributed-failures: 1' });
});

test('planRetry: a fully attributed jest log whose failing file is allowlisted retries that file (#3480 AC)', () => {
  const log = readDialect('jest-attributed.txt');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const unattributedCount = unattributedFailureCount(log, family);
  assert.strictEqual(unattributedCount, 0);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests', unattributedCount, family,
  });
  assert.strictEqual(plan.retry, true);
  assert.deepStrictEqual(plan.files, ['tests/flaky.test.js']);
});

test('AC1.1: planRetry: a jest log that crashed after its trailer refuses retry even when its failing file is allowlisted — unattributed-failures: 1 (#3674)', () => {
  const log = readDialect('jest-results-processor-crash.txt');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests',
    unattributedCount: unattributedFailureCount(log, family), family,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'unattributed-failures: 1' });
});

test('planRetry: a vitest log with an unhandled error refuses retry even when its failing file is allowlisted — unattributed-failures: 1 (#3480 AC)', () => {
  const log = readDialect('vitest-unhandled-error.txt');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const unattributedCount = unattributedFailureCount(log, family);
  assert.strictEqual(unattributedCount, 1);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: RETRY, suite: 'tests', unattributedCount, family,
  });
  assert.deepStrictEqual(plan, { retry: false, reason: 'unattributed-failures: 1' });
});

test('planRetry: a vitest multi-project log retries the real test file, not the |unit| label (#3676)', () => {
  const log = readDialect('vitest-multi-project.txt');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  assert.deepStrictEqual(failingFiles, ['tests/flaky.test.js']);
  const unattributedCount = unattributedFailureCount(log, family);
  assert.strictEqual(unattributedCount, 0);
  const plan = planRetry({
    failingFiles, flaky: { files: ['tests/flaky.test.js'], maxRetries: 1 }, retry: { tests: 'npx vitest run {file}' }, suite: 'tests', unattributedCount, family, platform: 'linux',
  });
  assert.strictEqual(plan.retry, true);
  assert.deepStrictEqual(plan.command, [{ file: 'tests/flaky.test.js', cmd: 'npx vitest run tests/flaky.test.js' }]);
});

test('planRetry: a pytest log still refuses — no-accounting-guard: summary, with or without a collection error (#3480 AC)', () => {
  for (const name of ['pytest-attributed.txt', 'pytest-collection-error.txt']) {
    const log = readDialect(name);
    const family = sniffFamily(log);
    const plan = planRetry({
      failingFiles: extractFailingFiles(log, family), flaky: { files: ['tests/test_flaky.py'], maxRetries: 1 }, retry: RETRY, suite: 'tests',
      unattributedCount: unattributedFailureCount(log, family), family,
    });
    assert.deepStrictEqual(plan, { retry: false, reason: 'no-accounting-guard: summary' }, name);
  }
});

test('planRetry: no-parse still wins over no-accounting-guard when no failing file is named (#3204)', () => {
  assert.deepStrictEqual(
    planRetry({ failingFiles: [], flaky: FLAKY, retry: RETRY, suite: 'tests', unattributedCount: null, family: 'summary' }),
    { retry: false, reason: 'no-parse' });
});

test('planRetry: a caller passing unattributedCount null without family renders no-accounting-guard: unknown, never undefined (#3204)', () => {
  assert.deepStrictEqual(
    planRetry({ failingFiles: ['tests/a.test.js'], flaky: FLAKY, retry: RETRY, suite: 'tests', unattributedCount: null }),
    { retry: false, reason: 'no-accounting-guard: unknown' });
});

test('planRetry: a spec log whose every failure is an allowlisted file still retries and passes as today (#3066 AC2)', () => {
  const log = ['ℹ tests 2', 'ℹ pass 0', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/b.test.js:2:1', '✖ y (1ms)'].join('\n');
  const family = sniffFamily(log);
  const failingFiles = extractFailingFiles(log, family);
  const unattributedCount = unattributedFailureCount(log, family);
  assert.strictEqual(unattributedCount, 0);
  const plan = planRetry({ failingFiles, flaky: FLAKY, retry: RETRY, suite: 'tests', unattributedCount });
  assert.strictEqual(plan.retry, true);
  assert.deepStrictEqual(plan.files, ['tests/a.test.js', 'tests/b.test.js']);
});

test('planRetry: empty failingFiles → no-parse; no template for the suite → no-template; maxRetries 0 → max-retries-0 (AC2)', () => {
  assert.deepStrictEqual(planRetry({ failingFiles: [], flaky: FLAKY, retry: RETRY, suite: 'tests' }), { retry: false, reason: 'no-parse' });
  assert.deepStrictEqual(planRetry({ failingFiles: ['tests/a.test.js'], flaky: FLAKY, retry: {}, suite: 'tests' }), { retry: false, reason: 'no-template' });
  assert.deepStrictEqual(planRetry({ failingFiles: ['tests/a.test.js'], flaky: FLAKY, retry: RETRY, suite: 'unit' }), { retry: false, reason: 'no-template' });
  assert.deepStrictEqual(planRetry({ failingFiles: ['tests/a.test.js'], flaky: { files: ['tests/a.test.js'], maxRetries: 0 }, retry: RETRY, suite: 'tests' }), { retry: false, reason: 'max-retries-0' });
});

test('planRetry: the allowlist is suite-agnostic — a listed file retries under whichever suite it failed in, with that suite\'s template', () => {
  const plan = planRetry({ failingFiles: ['tests/a.test.js'], flaky: FLAKY, retry: { unit: 'pnpm --filter api test -- {file}' }, suite: 'unit' });
  assert.deepStrictEqual(plan.command, [{ file: 'tests/a.test.js', cmd: 'pnpm --filter api test -- tests/a.test.js' }]);
});

test('planRetry: flaky.files entries are globs (#2029) — reuses the same engine rules[].match uses', () => {
  // '**' spans path segments: a new file under tests/flaky/ is allowlisted
  // without listing it by name.
  const globAllowlist = { files: ['tests/flaky/**'], maxRetries: 1 };
  const globPlan = planRetry({ failingFiles: ['tests/flaky/new-file.test.js'], flaky: globAllowlist, retry: RETRY, suite: 'tests' });
  assert.strictEqual(globPlan.retry, true);

  // An entry with no glob metacharacter still matches only itself (exact
  // paths behave byte-for-byte as before globToRegExp compiled them).
  const exactPlan = planRetry({ failingFiles: ['tests/a.test.js', 'tests/c.test.js'], flaky: FLAKY, retry: RETRY, suite: 'tests' });
  assert.strictEqual(exactPlan.retry, false);
  assert.deepStrictEqual(exactPlan.unlisted, ['tests/c.test.js']);

  // '*' stays segment-bound — it does not match a nested file.
  const segmentBound = { files: ['tests/*.test.js'], maxRetries: 1 };
  const nestedPlan = planRetry({ failingFiles: ['tests/flaky/nested.test.js'], flaky: segmentBound, retry: RETRY, suite: 'tests' });
  assert.strictEqual(nestedPlan.retry, false);
  assert.deepStrictEqual(nestedPlan.unlisted, ['tests/flaky/nested.test.js']);

  // An entry matching nothing still leaves the unlisted reason naming the file.
  const noMatch = planRetry({ failingFiles: ['tests/other.test.js'], flaky: { files: ['tests/flaky/**'], maxRetries: 1 }, retry: RETRY, suite: 'tests' });
  assert.strictEqual(noMatch.retry, false);
  assert.strictEqual(noMatch.reason, 'unlisted: [tests/other.test.js]');
});

test('retryLogName namespaces per file and per attempt', () => {
  assert.strictEqual(retryLogName('tests', 'tests/bin-lib/a.test.js', 2), 'tests-retry-tests+bin-lib+a.test.js-2');
  // A dash slug would collide these two; `+` is outside the extracted-path charset (review 3c, #1925).
  assert.notStrictEqual(retryLogName('tests', 'tests/a-b.test.js', 1), retryLogName('tests', 'tests/a/b.test.js', 1));
});

test('applyRetryResults: every attempted file passed → exitCode 0 + flakyRetried; a file with no pass → retryFailed and the original exit code kept', () => {
  const check = { name: 'tests', command: 'npm test', exitCode: 1, durationMs: 5, logPath: '/l/tests.log' };
  const ok = applyRetryResults(check, [
    { file: 'tests/a.test.js', attempt: 1, exitCode: 1, logPath: '/l/a1.log', durationMs: 1 },
    { file: 'tests/a.test.js', attempt: 2, exitCode: 0, logPath: '/l/a2.log', durationMs: 1 },
    { file: 'tests/b.test.js', attempt: 1, exitCode: 0, logPath: '/l/b1.log', durationMs: 1 },
  ]);
  assert.strictEqual(ok.exitCode, 0);
  assert.deepStrictEqual(ok.flakyRetried, ['tests/a.test.js', 'tests/b.test.js']);
  assert.strictEqual(ok.retryAttempts.length, 3);
  const bad = applyRetryResults(check, [
    { file: 'tests/a.test.js', attempt: 1, exitCode: 1, logPath: '/l/a1.log', durationMs: 1 },
  ]);
  assert.strictEqual(bad.exitCode, 1);
  assert.deepStrictEqual(bad.flakyRetried, []);
  assert.deepStrictEqual(bad.retryFailed, ['tests/a.test.js']);
});

// A scripted runOne: `script[file]` is the list of exit codes successive
// attempts return; records every call in order.
function fakeRunOne(script) {
  const calls = [];
  const runOne = async ({
    name, command, cwd, env,
  }) => {
    const file = command.replace(/^run /, '');
    const codes = script[file] || [0];
    const attempt = calls.filter((c) => c.file === file).length;
    calls.push({
      name, file, cwd, env,
    });
    return { name, command, exitCode: codes[Math.min(attempt, codes.length - 1)], durationMs: 1, logPath: `/l/${name}.log` };
  };
  return { runOne, calls };
}

test('runRetries: files run serially in plan order, each stops at its first pass, and the result carries flakyRetried', async () => {
  const { runOne, calls } = fakeRunOne({ 'tests/a.test.js': [1, 0], 'tests/b.test.js': [0] });
  const plan = { retry: true, files: ['tests/a.test.js', 'tests/b.test.js'], command: [{ file: 'tests/a.test.js', cmd: 'run tests/a.test.js' }, { file: 'tests/b.test.js', cmd: 'run tests/b.test.js' }] };
  const out = await runRetries({ check: { name: 'tests', exitCode: 1 }, plan, maxRetries: 2, logDir: '/l', runOne, spawnImpl: null, now: () => 0 });
  assert.deepStrictEqual(calls.map((c) => c.name), ['tests-retry-tests+a.test.js-1', 'tests-retry-tests+a.test.js-2', 'tests-retry-tests+b.test.js-1']);
  assert.strictEqual(out.exitCode, 0);
  assert.deepStrictEqual(out.flakyRetried, ['tests/a.test.js', 'tests/b.test.js']);
});

test('runRetries: a file that exhausts maxRetries fails the run and short-circuits the files after it', async () => {
  const { runOne, calls } = fakeRunOne({ 'tests/a.test.js': [1, 1, 1], 'tests/b.test.js': [0] });
  const plan = { retry: true, files: ['tests/a.test.js', 'tests/b.test.js'], command: [{ file: 'tests/a.test.js', cmd: 'run tests/a.test.js' }, { file: 'tests/b.test.js', cmd: 'run tests/b.test.js' }] };
  const out = await runRetries({ check: { name: 'tests', exitCode: 1 }, plan, maxRetries: 2, logDir: '/l', runOne, spawnImpl: null, now: () => 0 });
  assert.strictEqual(calls.length, 2, 'two attempts for a, none for b');
  assert.strictEqual(out.exitCode, 1);
  assert.deepStrictEqual(out.retryFailed, ['tests/a.test.js']);
  assert.deepStrictEqual(out.flakyRetried, []);
});

test('runRetries forwards cwd to every runOne call (#2376)', async () => {
  const { runOne, calls } = fakeRunOne({ 'tests/a.test.js': [0] });
  const plan = { retry: true, files: ['tests/a.test.js'], command: [{ file: 'tests/a.test.js', cmd: 'run tests/a.test.js' }] };
  await runRetries({
    check: { name: 'tests', exitCode: 1 }, plan, maxRetries: 2, logDir: '/l', runOne, spawnImpl: null, now: () => 0, cwd: '/repo/packages/app',
  });
  assert.deepStrictEqual(calls.map((c) => c.cwd), ['/repo/packages/app']);
});

test('runRetries forwards the check env to every runOne call (#2779)', async () => {
  const { runOne, calls } = fakeRunOne({ 'tests/a.test.js': [1, 0] });
  const plan = { retry: true, files: ['tests/a.test.js'], command: [{ file: 'tests/a.test.js', cmd: 'run tests/a.test.js' }] };
  await runRetries({
    check: { name: 'tests', exitCode: 1 }, plan, maxRetries: 2, logDir: '/l', runOne, spawnImpl: null, now: () => 0, env: { MY_VAR: '1' },
  });
  assert.deepStrictEqual(calls.map((c) => c.env), [{ MY_VAR: '1' }, { MY_VAR: '1' }]);
});

test('flakyCaveatLines: one line per retried check naming the files and the passing retry logs; none for an ordinary check', () => {
  const lines = flakyCaveatLines([
    { name: 'lint', exitCode: 0 },
    { name: 'tests', exitCode: 0, flakyRetried: ['tests/a.test.js'], retryAttempts: [{ file: 'tests/a.test.js', attempt: 1, exitCode: 1, logPath: '/l/a1.log' }, { file: 'tests/a.test.js', attempt: 2, exitCode: 0, logPath: '/l/a2.log' }] },
  ]);
  assert.deepStrictEqual(lines, ['CAVEAT: flaky-retried: tests/a.test.js — passed on isolated rerun; see /l/a2.log']);
  // Two files retried in one check join with ', ' in both the file list and the passing logs (review 3f, #1925).
  const two = flakyCaveatLines([{
    name: 'unit', exitCode: 0, flakyRetried: ['tests/a.test.js', 'tests/b.test.js'],
    retryAttempts: [
      { file: 'tests/a.test.js', attempt: 1, exitCode: 0, logPath: '/l/a1.log' },
      { file: 'tests/b.test.js', attempt: 1, exitCode: 1, logPath: '/l/b1.log' },
      { file: 'tests/b.test.js', attempt: 2, exitCode: 0, logPath: '/l/b2.log' },
    ],
  }]);
  assert.deepStrictEqual(two, ['CAVEAT: flaky-retried: tests/a.test.js, tests/b.test.js — passed on isolated rerun; see /l/a1.log, /l/b2.log']);
});
