'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { readText } = require('../../helpers/read-skill');
const { CLI, tmpDir, runCli, tmpGitRepo, stampOf, commitFile, flakyRepo } = require('./cli-helpers');

test('flaky retry: an allowlisted failing file is re-run through the template and the run passes with flakyRetried on row, report, and stamp (#1925 AC3)', async () => {
  const r = flakyRepo();
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /\| tests \| pass \(flaky-retried: tests\/flaky\.test\.js\) \|/);
  assert.match(stdout, /^CAVEAT: flaky-retried: tests\/flaky\.test\.js — passed on isolated rerun; see .*tests-retry-tests\+flaky\.test\.js-1\.log$/m);
  assert.strictEqual(fs.readFileSync(r.marker, 'utf8'), 'tests/flaky.test.js');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, true);
  assert.deepStrictEqual(report.checks.tests.flakyRetried, ['tests/flaky.test.js']);
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: true, files: ['tests/flaky.test.js'] });
  assert.strictEqual(report.checks.tests.retryAttempts.length, 1);
  assert.strictEqual(report.checks.tests.exitCode, 0);
  const stamp = stampOf(r.gitDir);
  assert.deepStrictEqual(stamp.flakyRetried, ['tests/flaky.test.js']);
  assert.strictEqual(stamp.scope, 'full');
});

test('flaky retry: an unlisted failing file is an ordinary failure — no retry spawned, no stamp, the decision names it (#1925 AC4)', async () => {
  const r = flakyRepo({ failingFile: 'tests/real.test.js' });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker), 'no retry command may run for an unlisted file');
  assert.ok(!fs.existsSync(r.retryLog(1)));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unlisted: [tests/real.test.js]' });
  assert.strictEqual('flakyRetried' in report.checks.tests, false);
});

test('flaky retry: a TAP failure with no attributable file refuses retry even when every named file is allowlisted, through the real CLI wiring (#3066)', async () => {
  // Exercises the actual verify.js retryHook path (readFileSync → stripAnsi
  // → sniffFamily → unattributedFailureCount → planRetry), not just the
  // library functions in isolation — review finding (3f): the unit tests
  // alone would stay green if the 4-line wiring in verify.js were reverted.
  const r = tmpGitRepo();
  const tap = [
    'not ok 1 - a flaky one', '  ---', '  stack: |-', '    at TestContext.<anonymous> (tests/flaky.test.js:12:5)', '  ...',
    'not ok 2 - an unattributed one', '  ---', '  stack: |-', '    some non-frame diagnostic text', '  ...',
    '# tests 2', '# pass 0', '# fail 2',
  ].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), "require('fs').writeFileSync('retry.marker', process.argv[2]); process.exit(0);\n");
  const decl = {
    checks: { tests: 'node fail.js' },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'unattributed fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  const { code, stdout } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(path.join(r.repo, 'retry.marker')), 'no retry command may run while a failure is unattributed');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unattributed-failures: 1' });
  assert.strictEqual('flakyRetried' in report.checks.tests, false);
});

test('flaky retry: a jest failure with a suite no test file accounts for refuses retry even when every named file is allowlisted, through the real CLI wiring (#3204, #3480)', async () => {
  // Same wiring as the #3066 TAP test above, on a jest summary log: the
  // allowlisted tests/flaky.test.js is named, and src/setup.js is a failing
  // suite no test file accounts for. Without an accounting guard for the
  // summary family this used to retry, pass the named file, and clear the check.
  const r = tmpGitRepo();
  const JEST_UNATTRIBUTED = [
    'FAIL tests/flaky.test.js',
    '  ● flaky › sometimes fails',
    'FAIL src/setup.js',
    '  ● Test suite failed to run',
    'Tests:       2 failed, 3 passed, 5 total',
  ].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(JEST_UNATTRIBUTED)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), "require('fs').writeFileSync('retry.marker', process.argv[2]); process.exit(0);\n");
  const decl = {
    checks: { tests: 'node fail.js' },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'summary-family unattributed fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  const { code, stdout } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(path.join(r.repo, 'retry.marker')), 'no retry command may run while a jest failure is unattributed');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unattributed-failures: 1' });
  assert.strictEqual('flakyRetried' in report.checks.tests, false);
});

test('flaky retry: a fully attributed jest log whose failing file is allowlisted retries it through the real CLI wiring (#3480 AC)', async () => {
  // Same wiring as the refusal test above, on a real captured jest log whose
  // only failure is the allowlisted file: the runner now retries it.
  const r = tmpGitRepo();
  const jest = readText(path.join(__dirname, '..', '..', 'fixtures', 'verify-dialects', 'jest-attributed.txt'));
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(jest)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), "require('fs').writeFileSync('retry.marker', process.argv[2]); process.exit(0);\n");
  const decl = {
    checks: { tests: 'node fail.js' },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'summary-family attributed fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  const { code, stdout } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 0);
  assert.strictEqual(fs.readFileSync(path.join(r.repo, 'retry.marker'), 'utf8'), 'tests/flaky.test.js');
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: true, files: ['tests/flaky.test.js'] });
  assert.match(stdout, /flaky-retried: tests\/flaky\.test\.js/);
});

// Shared by the no-parse test below: writes a verify-scope.json declaring
// `testsCmd` (with a flaky allowlist that never matches this fixture) and
// commits it, returning the --scope args to run it under.
function noParseArgs(r, testsCmd) {
  const decl = {
    checks: { tests: testsCmd },
    retry: { tests: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'no-parse fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  return ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', `tests=${testsCmd}`];
}

test('flaky retry: a generic-family failing fixture (no extractable file) gets the no-parse clause on stdout; a passing check gets no clause (#2026)', async () => {
  const r = tmpGitRepo();
  // No TAP/mocha markers at all — sniffFamily classifies this as 'generic'
  // and extractFailingFiles finds nothing to name.
  fs.writeFileSync(path.join(r.repo, 'fail.js'), "process.stdout.write('Something went wrong\\n'); process.exit(1);\n");
  const args = noParseArgs(r, 'node fail.js');
  const { code, stdout } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \| .*\(retry: no-parse — whole-suite re-run applies\) \|/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'no-parse' });

  // A passing check never carries the clause, even with flaky declared.
  const passRepo = tmpGitRepo();
  fs.writeFileSync(path.join(passRepo.repo, 'ok.js'), "process.exit(0);\n");
  const passArgs = noParseArgs(passRepo, 'node ok.js');
  const passRun = await runCli(passArgs, { cwd: passRepo.repo });
  assert.strictEqual(passRun.code, 0, passRun.stderr);
  assert.doesNotMatch(passRun.stdout, /no-parse/);
});

test('flaky retry: an empty/absent flaky declaration still records retryDecision.reason (#2333 — the actual behavior #2026 shipped)', async () => {
  // #2026 replaced `flakyEnabled = Boolean(decl && decl.flaky.files.length > 0)`
  // with `if (!decl) return result` — an empty (or absent) `flaky.files`
  // must still reach planRetry and record a decision, not be gated out
  // before the hook ever runs. declaration.js's own default for a missing
  // `flaky` key is `{ files: [], maxRetries: DEFAULT_MAX_RETRIES }`, so an
  // explicit empty array below exercises the exact same shape.
  const r = flakyRepo({ flaky: { files: [] } });
  const { code } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unlisted: [tests/flaky.test.js]' });
  assert.ok(!fs.existsSync(r.marker), 'no retry command may run when the allowlist is empty');
});

test('flaky retry: maxRetries 2 performs at most two attempts and an exhausted file fails the run with retryFailed; maxRetries 3 is rejected by the declaration (#1925 AC6)', async () => {
  const r = flakyRepo({ retryExit: 1, flaky: { files: ['tests/flaky.test.js'], maxRetries: 2 } });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /\| tests \| fail \|/);
  assert.ok(fs.existsSync(r.retryLog(1)) && fs.existsSync(r.retryLog(2)), 'two attempts logged');
  assert.ok(!fs.existsSync(r.retryLog(3)));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryFailed, ['tests/flaky.test.js']);
  assert.strictEqual(report.checks.tests.retryAttempts.length, 2);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));

  const r3 = flakyRepo({ flaky: { files: ['tests/flaky.test.js'], maxRetries: 3 } });
  const three = await runCli(r3.args, { cwd: r3.repo });
  assert.strictEqual(three.code, 2);
  assert.match(three.stderr, /flaky\.maxRetries: must be an integer from 0 to 2/);
});

test('flaky retry: a failing lint check never triggers a retry and still fail-fasts tests (#1925 AC7)', async () => {
  const r = flakyRepo();
  const { code } = await runCli([...r.args, '--cmd', 'lint=node fail.js'], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.ok(!fs.existsSync(r.marker));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.checks.tests.skipped, 'fail-fast');
  assert.strictEqual('retryDecision' in report.checks.lint, false);
});

test('flaky retry: without --scope (no declaration) a failing tests check is never retried, byte-for-byte today\'s behavior (#1925)', async () => {
  const r = flakyRepo();
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/flaky.test.js': 3 } }));
  const { code, stdout } = await runCli(['--cmd', 'tests=node fail.js'], { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker));
  // I1 (#1925 review): a run with no declaration at all must not be read as
  // "the allowlist is empty" — the prior flakyHits map must survive untouched.
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 3 });
});

test('flaky retry: a check whose log vanished before the hook could read it is an ordinary failure with retryDecision.reason unreadable-log — no retry, no stamp, no crash (#1925 review 3f)', async () => {
  const r = flakyRepo();
  const logDir = tmpDir();
  // The check prints its TAP failure, then removes its own log file (runOne's
  // stream keeps writing to the unlinked inode), so the hook's read sees ENOENT.
  const tap = ['not ok 1 - vanished', '    at TestContext.<anonymous> (tests/flaky.test.js:1:1)', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail-unlink.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); require('fs').unlinkSync(process.argv[2]); process.exit(1);\n`);
  const logPath = path.join(logDir, 'tests.log');
  const { code, stdout, stderr } = await runCli([...r.args.slice(0, 4), '--log-dir', logDir, '--cmd', `tests=node fail-unlink.js ${logPath}`], { cwd: r.repo });
  assert.strictEqual(code, 1, stderr);
  assert.doesNotMatch(stdout, /flaky-retried/);
  assert.ok(!fs.existsSync(r.marker), 'no retry may run when the log could not be read');
  const report = JSON.parse(fs.readFileSync(path.join(logDir, 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.checks.tests.retryDecision, { retry: false, reason: 'unreadable-log' });
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
});

test('flaky retry: a retried-to-pass suite does not fail-fast-skip the suites behind it, so the full set stamps (#1925 design)', async () => {
  const r = tmpGitRepo();
  const tap = ['not ok 1 - flaky', '    at TestContext.<anonymous> (tests/flaky.test.js:1:1)', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  fs.writeFileSync(path.join(r.repo, 'retry.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(r.repo, 'other.js'), "require('fs').writeFileSync('other.marker', 'ran');\n");
  const decl = {
    checks: { tests: { unit: 'node fail.js', other: 'node other.js' } },
    retry: { unit: 'node retry.js {file}' },
    rules: [{ match: 'src/**', suites: ['unit'], static: true }],
    flaky: { files: ['tests/flaky.test.js'] },
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'two suites');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const { code, stdout, stderr } = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'unit=node fail.js', '--cmd', 'other=node other.js'], { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /\| unit \| pass \(flaky-retried: tests\/flaky\.test\.js\) \|/);
  assert.match(stdout, /\| other \| pass \|/);
  assert.ok(fs.existsSync(path.join(r.repo, 'other.marker')), 'other ran after unit was retried to a pass');
  assert.deepStrictEqual(stampOf(r.gitDir).flakyRetried, ['tests/flaky.test.js']);
});

test('flaky retry: a pre-seeded flakyHits of 4 escalates on the fifth retry — both caveats render, report.flakyEscalation has one entry, the count stamp records 5 (#1925 AC5)', async () => {
  const r = flakyRepo();
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/flaky.test.js': 4 } }));
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /^CAVEAT: flaky-retried: tests\/flaky\.test\.js — passed on isolated rerun/m);
  assert.match(stdout, /^CAVEAT: flaky-allowlist: tests\/flaky\.test\.js retried 5 times — file a fix or remove it from the allowlist$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.flakyEscalation, [{ file: 'tests/flaky.test.js', hits: 5, onAllowlist: true }]);
  const stamp = JSON.parse(fs.readFileSync(countStampPath, 'utf8'));
  assert.deepStrictEqual(stamp.flakyHits, { 'tests/flaky.test.js': 5 });
  assert.strictEqual(stamp.tests, 1);
});

test('flaky retry: hits accumulate across two runs and a file removed from the allowlist is pruned from the map (#1925)', async () => {
  const r = flakyRepo({ flaky: { files: ['tests/flaky.test.js', 'tests/other.test.js'] } });
  const countStampPath = path.join(r.gitDir, 'claude-tweaks-test-count.json');
  fs.writeFileSync(countStampPath, JSON.stringify({ tests: 1, sha: 'seed', recordedAt: 't', flakyHits: { 'tests/other.test.js': 2, 'tests/removed.test.js': 9 } }));
  const first = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(first.code, 0, first.stderr);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 1, 'tests/other.test.js': 2 });
  assert.doesNotMatch(first.stdout, /flaky-allowlist/);
  // Second run at the same HEAD: the prior stamp is full at this sha, so the
  // scope run is mode none and nothing spawns — the map must be untouched.
  // run 1's retry marker is fixture scaffolding — an untracked file is a real change to the runner, so clear it before proving the unchanged-HEAD run is mode none
  fs.unlinkSync(r.marker);
  const second = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(second.code, 0, second.stderr);
  assert.match(second.stdout, /^Scope: none/m);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(countStampPath, 'utf8')).flakyHits, { 'tests/flaky.test.js': 1, 'tests/other.test.js': 2 });
});

// Sibling fixture to flakyRepo (#3129): a tests check that always fails with
// a TAP failure naming `failingFile`, and a verify-scope.json declaring
// `preExisting` instead of `flaky` — no retry template, no retry.js spawned
// at all; the declared allowlist is checked, never re-run. `log` (#3481) is
// the raw string fail.js prints instead of the default TAP block.
function preExistingRepo({ failingFile = 'tests/known-shallow.test.js', preExisting = ['tests/known-shallow.test.js'], extraDecl = {}, log = null } = {}) {
  const r = tmpGitRepo();
  const tap = ['not ok 1 - a known pre-existing failure', '  ---', '  stack: |-', `    at TestContext.<anonymous> (${failingFile}:12:5)`, '  ...', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(log ?? tap)} + '\\n'); process.exit(1);\n`);
  const decl = {
    checks: { tests: 'node fail.js' },
    rules: [{ match: 'src/**', suites: ['tests'], static: true }],
    preExisting,
    ...extraDecl,
  };
  fs.mkdirSync(path.join(r.repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  r.git('add', '.');
  r.git('commit', '-q', '-m', 'pre-existing fixture');
  const branch = r.git('symbolic-ref', '--short', 'HEAD').trim();
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', branch, '--cmd', 'tests=node fail.js'];
  return { ...r, branch, args };
}

test('preExisting: a failing file fully covered by the declared allowlist is adjudicated as passing, and the stamp carries the marker with no legacy twin (#3129)', async () => {
  const r = preExistingRepo();
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /Pre-existing: adjudicated — 1 failing file\(s\) covered by the declared preExisting allowlist: tests\/known-shallow\.test\.js/);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.pass, false, 'report.pass stays raw');
  assert.strictEqual(report.effectivePass, true, 'an allowlist-covered failure is an effective pass (#3316)');
  assert.strictEqual(report.checks.tests.exitCode, 1, 'the check keeps its real exit code');
  assert.deepStrictEqual(report.preExistingAdjudicated, { declared: ['tests/known-shallow.test.js'], matched: ['tests/known-shallow.test.js'], new: [], fixed: [] });
  const stamp = stampOf(r.gitDir);
  assert.deepStrictEqual(stamp.preExisting, { declared: ['tests/known-shallow.test.js'], matched: ['tests/known-shallow.test.js'] });
  assert.strictEqual(stamp.scope, 'full');
  // H1 parity (#3043's own rule): an adjudicated-but-not-clean pass never
  // rewrites the legacy bare-SHA twin.
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass')));
});

test('preExisting: an uncovered failing file is an ordinary failure — no stamp, the report names the reason (#3129)', async () => {
  const r = preExistingRepo({ failingFile: 'tests/real.test.js', preExisting: ['tests/known-shallow.test.js'] });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /Pre-existing: not adjudicated — unlisted: \[tests\/real\.test\.js\]/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.preExistingAdjudicated, { declared: ['tests/known-shallow.test.js'], eligible: false, reason: 'unlisted: [tests/real.test.js]', new: ['tests/real.test.js'], fixed: [] });
});

test('preExisting: no preExisting declared at all never adjudicates — report omits the field entirely (#3129)', async () => {
  const r = flakyRepo({ flaky: { files: [] } });
  const { code } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual('preExistingAdjudicated' in report, false);
  assert.doesNotMatch(await fs.promises.readFile(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'), /preExisting/);
});

test('preExisting: --stamp-status reads the marker — preExistingAdjudicated:true, match:false, verifiedHead:true (#3129)', async () => {
  const r = preExistingRepo();
  const run = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const status = await runCli(['--stamp-status'], { cwd: r.repo });
  const parsed = JSON.parse(status.stdout);
  assert.strictEqual(parsed.preExistingAdjudicated, true);
  assert.strictEqual(parsed.match, false);
  assert.strictEqual(parsed.verifiedHead, true);
});

// #3481: a preExisting run over `log` is refused with `reason` — no stamp, no effective pass.
async function assertPreExistingRefused(log, reason, extraDecl = {}) {
  const r = preExistingRepo({ log, extraDecl });
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, new RegExp(`Pre-existing: not adjudicated — ${reason}`));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.preExistingAdjudicated, { declared: ['tests/known-shallow.test.js'], eligible: false, reason });
  assert.strictEqual(report.effectivePass, false);
}

test('AC1.1 preExisting: a spec log whose named files are all covered but which also carries an unattributed failure is refused — unattributed-failures: 1 (#3481)', async () => {
  const log = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/known-shallow.test.js:1:1', '✖ x (1ms)', '', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n');
  await assertPreExistingRefused(log, 'unattributed-failures: 1');
});

test('AC1.2 preExisting: a TAP log whose named file is covered but which also carries an unattributed failure is refused — unattributed-failures: 1 (#3481)', async () => {
  const log = ['not ok 1 - a known pre-existing failure', '  ---', '  stack: |-', '    at TestContext.<anonymous> (tests/known-shallow.test.js:12:5)', '  ...',
    'not ok 2 - an unattributed one', '  ---', '  stack: |-', '    some non-frame diagnostic text', '  ...',
    '# tests 2', '# pass 0', '# fail 2'].join('\n');
  await assertPreExistingRefused(log, 'unattributed-failures: 1');
});

test('AC2.1 preExisting: a pytest summary log is never adjudicated through preExisting — no-accounting-guard: summary (#3481, #3480)', async () => {
  const log = ['FAILED tests/known-shallow.test.js::test_known - assert 1 == 2', '========================= 1 failed, 3 passed in 0.02s ========================='].join('\n');
  await assertPreExistingRefused(log, 'no-accounting-guard: summary');
});

test('preExisting: a jest log whose only failing file is covered but whose global teardown threw is refused — unattributed-failures: 1 (#3480)', async () => {
  const log = readText(path.join(__dirname, '..', '..', 'fixtures', 'verify-dialects', 'jest-global-teardown.txt'))
    .replaceAll('tests/known.test.js', 'tests/known-shallow.test.js');
  await assertPreExistingRefused(log, 'unattributed-failures: 1');
});

test('preExisting: a fully attributed jest log covered by the allowlist is adjudicated (#3480)', async () => {
  const log = ['FAIL tests/known-shallow.test.js', '  ● known › fails', 'Test Suites: 1 failed, 2 passed, 3 total', 'Tests:       1 failed, 3 passed, 4 total', 'Ran all test suites.'].join('\n');
  const r = preExistingRepo({ log });
  const { code, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.preExistingAdjudicated, { declared: ['tests/known-shallow.test.js'], matched: ['tests/known-shallow.test.js'], new: [], fixed: [] });
});

test('#3313 AC1 preExisting: one allowlisted file now passing and one new failure prints 1 new, 1 fixed and lists both in report.json (#3313)', async () => {
  const r = preExistingRepo({ failingFile: 'tests/real.test.js', preExisting: ['tests/known-shallow.test.js'] });
  fs.mkdirSync(path.join(r.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, 'tests', 'known-shallow.test.js'), '// passes now\n');
  r.git('add', 'tests/known-shallow.test.js');
  r.git('commit', '-q', '-m', 'track the allowlisted file');
  const { code, stdout } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 1);
  assert.match(stdout, /^Pre-existing: 1 new, 1 fixed$/m);
  assert.match(stdout, /^FIXED: tests\/known-shallow\.test\.js — allowlisted but did not fail this run; if its failure is not environment-specific, consider removing its entry$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.deepStrictEqual(report.preExistingAdjudicated, {
    declared: ['tests/known-shallow.test.js'], eligible: false, reason: 'unlisted: [tests/real.test.js]',
    new: ['tests/real.test.js'], fixed: ['tests/known-shallow.test.js'],
  });
});

test('preExisting: a fixed file never changes the verdict — a fully covered run with a passing allowlisted sibling is still an effective pass (#3313)', async () => {
  const r = preExistingRepo({ failingFile: 'tests/a.test.js', preExisting: ['tests/a.test.js', 'tests/b.test.js'] });
  fs.mkdirSync(path.join(r.repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, 'tests', 'b.test.js'), '// passes now\n');
  r.git('add', 'tests/b.test.js');
  r.git('commit', '-q', '-m', 'track b');
  const { code, stdout, stderr } = await runCli(r.args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /^Pre-existing: 0 new, 1 fixed$/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.effectivePass, true);
  assert.deepStrictEqual(report.preExistingAdjudicated.fixed, ['tests/b.test.js']);
});

test('preExisting: a fail-fast skipped suite reports fixed as not computed — its allowlisted files never ran, so none is claimed passed (#3313)', async () => {
  const r = preExistingRepo({
    preExisting: ['tests/known-shallow.test.js', 'tests/other.test.js'],
    extraDecl: { checks: { tests: { unit: 'node fail.js', other: 'node -e 0' } }, rules: [{ match: 'src/**', suites: '*', static: true }] },
  });
  commitFile(r, 'tests/other.test.js', '// never ran: its suite was fail-fast skipped\n');
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', 'unit=node fail.js', '--cmd', 'other=node -e 0'];
  const { code, stdout, stderr } = await runCli(args, { cwd: r.repo });
  assert.strictEqual(code, 0, stderr);
  assert.match(stdout, /^Scope: full/m);
  assert.match(stdout, /skipped: fail-fast/);
  assert.match(stdout, /^Pre-existing: 0 new, fixed not computed — a check was skipped \(fail-fast\)$/m);
  assert.doesNotMatch(stdout, /^FIXED:/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.effectivePass, true);
  assert.deepStrictEqual(report.preExistingAdjudicated, {
    declared: ['tests/known-shallow.test.js', 'tests/other.test.js'], matched: ['tests/known-shallow.test.js'],
    new: [], fixed: null, fixedReason: 'a check was skipped (fail-fast)',
  });
});

test('preExisting: a narrowed scoped run reports fixed as not computed, never 0 fixed — the verdict is unchanged (#3313)', async () => {
  // Two declared suites, so a src/** change selecting only `unit` is a narrowed (scoped) run.
  const r = preExistingRepo({ extraDecl: { checks: { tests: { other: 'node -e 0', unit: 'node fail.js' } }, rules: [{ match: 'src/**', suites: ['unit'], static: true }] } });
  const args = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', 'other=node -e 0', '--cmd', 'unit=node fail.js'];
  const run1 = await runCli(args, { cwd: r.repo });
  assert.strictEqual(run1.code, 0, run1.stderr);
  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const run2 = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', 'unit=node fail.js'], { cwd: r.repo });
  assert.strictEqual(run2.code, 0, run2.stderr);
  assert.match(run2.stdout, /^Scope: scoped/m);
  assert.match(run2.stdout, /^Pre-existing: 0 new, fixed not computed — scope mode scoped did not run every suite$/m);
  assert.doesNotMatch(run2.stdout, /^FIXED:/m);
  const report = JSON.parse(fs.readFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), 'utf8'));
  assert.strictEqual(report.effectivePass, true);
  assert.deepStrictEqual(report.preExistingAdjudicated, {
    declared: ['tests/known-shallow.test.js'], matched: ['tests/known-shallow.test.js'],
    new: [], fixed: null, fixedReason: 'scope mode scoped did not run every suite',
  });
});

test('AC1.3 preExisting: unattributed failures sum across failing checks — types and lint with one each refuse as unattributed-failures: 2 (#3481)', async () => {
  const log = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', '', '✖ failing tests:', '',
    'test at tests/known-shallow.test.js:1:1', '✖ x (1ms)', '', 'test at tests/helper.js:2:1', '✖ y (1ms)'].join('\n');
  await assertPreExistingRefused(log, 'unattributed-failures: 2', {
    checks: { types: 'node fail.js', lint: 'node fail.js', tests: 'node fail.js' },
  });
});

test('AC1.4 preExisting: a fully accounted spec log whose covered failing file also carries a runner-level error line is refused — runner-error (#3481)', async () => {
  const log = ['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 1', '', '✖ failing tests:', '',
    'test at tests/known-shallow.test.js:1:1', '✖ x (1ms)', '', 'ℹ Error: asynchronous activity outlived its test'].join('\n');
  await assertPreExistingRefused(log, 'runner-error');
});

test('preExisting: log frames are relativized against --cwd, not the process cwd — an absolute frame under the checkout still matches the allowlist (#3481)', async () => {
  const r = preExistingRepo();
  const tap = ['not ok 1 - a known pre-existing failure', '  ---', '  stack: |-', `    at TestContext.<anonymous> (${r.repo}/tests/known-shallow.test.js:12:5)`, '  ...', '# tests 1', '# pass 0', '# fail 1'].join('\n');
  fs.writeFileSync(path.join(r.repo, 'fail.js'), `process.stdout.write(${JSON.stringify(tap)} + '\\n'); process.exit(1);\n`);
  const sub = path.join(r.repo, 'sub');
  fs.mkdirSync(sub);
  const { code, stdout, stderr } = await runCli([...r.args, '--cwd', r.repo], { cwd: sub });
  assert.strictEqual(code, 0, stdout + stderr);
  assert.match(stdout, /Pre-existing: adjudicated — 1 failing file\(s\) covered by the declared preExisting allowlist: tests\/known-shallow\.test\.js/);
});
