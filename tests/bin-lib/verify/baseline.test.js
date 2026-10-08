'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { adjudicate, realGit } = require('../../../plugin/bin/lib/verify/baseline');

function logFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-test-'));
  const p = path.join(dir, 'tests.log');
  fs.writeFileSync(p, text);
  return { dir, p };
}

const SPEC = (files) => ['ℹ tests 9', 'ℹ pass 1', `ℹ fail ${files.length}`, '', '✖ failing tests:', '',
  ...files.flatMap((f) => [`test at ${f}:1:1`, '✖ x (1ms)', ''])].join('\n');

// A test file that fails to load: node lists the FILE as the failing test.
const FILE_LEVEL = (f) => ['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 1', '', '✖ failing tests:', '',
  `test at ${f}:1:1`, `✖ ${f} (12ms)`, "  'test failed'", ''].join('\n');

// outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/b.test.js': 0, ... } — exit code per (kind, file)
// Each fake run writes a real log reflecting its outcome (a failing run names the
// file in a spec-format log, a passing run reports one passing test); `logs`
// overrides the text per `${kind}:${file}`.
const PASS_LOG = ['ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0'].join('\n');

function fakes({ outcomes, existsAtBase = () => true, throwOn = null, logs = {}, repoRoot = '/repo' }) {
  const calls = { runs: [], added: [], removed: [] };
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-fake-runs-'));
  const git = {
    repoRoot: () => repoRoot,
    fileExistsAt: (sha, f) => existsAtBase(f),
    addWorktree: (sha) => { calls.added.push(sha); return '/scratch'; },
    removeWorktree: (dir) => { calls.removed.push(dir); },
  };
  const runOne = async ({ name, command, cwd }) => {
    const kind = name.includes('-baseline-') ? 'baseline' : 'isolated';
    const file = command.replace('node --test ', '');
    calls.runs.push({ kind, file, cwd });
    if (throwOn && throwOn === `${kind}:${file}`) throw new Error('boom');
    const key = `${kind}:${file}`;
    const code = outcomes[key];
    const text = key in logs ? logs[key] : (code === 0 ? PASS_LOG : SPEC([file]));
    const logPath = path.join(logRoot, `${name}.log`);
    fs.writeFileSync(logPath, text);
    return { name, command, exitCode: code === undefined ? 1 : code, durationMs: 1, logPath };
  };
  return { git, runOne, calls };
}

const tmpl = new Map([['tests', 'node --test {file}']]);

test('every failing file also fails at base → verdict pass, nothing re-run at HEAD (#3043 AC1)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, true);
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js', 'tests/b.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(calls.runs.filter((c) => c.kind === 'isolated'), []);
  assert.deepStrictEqual(calls.runs.map((c) => c.cwd), ['/scratch', '/scratch']);
  assert.deepStrictEqual(calls.removed, ['/scratch']);
});

test('a file passing at base and failing in isolation at HEAD is attributable → verdict fail (#3043 AC2)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'fail');
  assert.deepStrictEqual(r.attributable, ['tests/b.test.js']);
});

test('a file passing at base and passing in isolation at HEAD is flaky, not attributable (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/b.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 0 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.flakyPassed, ['tests/b.test.js']);
  assert.match(r.flakyLogs['tests/b.test.js'], /tests-isolated-tests\+b\.test\.js\.log$/, 'the isolated log a CAVEAT line points at');
  assert.deepStrictEqual(r.failingByCheck, { tests: ['tests/b.test.js'] });
});

test('I3: a failing file absent at base is attributable outright — no base run, no isolated run, never flaky (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/new.test.js']));
  // Even an isolated run that would pass cannot cover a file new on this branch.
  const { git, runOne, calls } = fakes({ outcomes: { 'isolated:tests/new.test.js': 0 }, existsAtBase: () => false });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.attributable, ['tests/new.test.js']);
  assert.deepStrictEqual(r.flakyPassed, []);
  assert.strictEqual(r.verdict, 'fail');
  assert.deepStrictEqual(calls.runs, [], 'nothing is re-run for a file new on this branch');
  assert.deepStrictEqual(calls.added, [], 'no scratch worktree when no failing file exists at base');
});

test('Review Focus 3: a base run killed by a signal (exitCode null) never counts as failing at base (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': null, 'isolated:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('Review Focus 4: the scratch worktree is removed even when a run throws (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: {}, throwOn: 'baseline:tests/a.test.js' });
  await assert.rejects(adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git }), /boom/);
  assert.deepStrictEqual(calls.removed, ['/scratch']);
});

test('Review Focus 5: a --cwd subdir offsets both the base cwd and the cat-file path (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const seen = [];
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 }, existsAtBase: (f) => { seen.push(f); return true; } });
  await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: path.join('/repo', 'packages', 'app'), logDir: dir, runOne, git });
  assert.deepStrictEqual(seen, ['packages/app/tests/a.test.js']);
  assert.strictEqual(calls.runs[0].cwd, path.join('/scratch', 'packages', 'app'));
});

test('ineligible: a fail-fast skip, a spawn error, a missing template, or no extractable file (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { p: generic } = logFile('something went wrong\n');
  const { git, runOne } = fakes({ outcomes: {} });
  const base = { baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git };
  assert.match((await adjudicate({ ...base, checks: [{ name: 'lint', exitCode: 1, logPath: p }] })).reason, /no --baseline-cmd for failing check lint/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', skipped: 'fail-fast' }] })).reason, /tests skipped/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', exitCode: null, spawnError: 'ENOENT', logPath: p }] })).reason, /could not spawn/);
  assert.match((await adjudicate({ ...base, checks: [{ name: 'tests', exitCode: 1, logPath: generic }] })).reason, /no-parse/);
});

test('ineligible: a failing entry that names no test file is unclassified, never silently dropped to a pass (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/helper.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /unclassified failure/);
  assert.deepStrictEqual(calls.runs, [], 'nothing is re-run once the log is known to be undercounted');
});

// C1: the failing-file list must account for the whole failure. Each case
// below would otherwise adjudicate `pass` — its base run names the file.
const adjudicateOne = async (headLog, checkOverrides = {}) => {
  const { p, dir } = logFile(headLog);
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/test_a.py': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p, ...checkOverrides }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  return { r, calls };
};

test('C1: a signal-killed HEAD check (exitCode null) is not adjudicated (#3043)', async () => {
  const { r, calls } = await adjudicateOne(SPEC(['tests/a.test.js']), { exitCode: null });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests exited without a numeric code');
  assert.deepStrictEqual(calls.runs, []);
});

test('C1: a summary-family log (pytest ERROR lines are invisible to it) has no failure-accounting guard (#3043)', async () => {
  const pytest = ['FAILED tests/test_a.py::test_x - AssertionError', 'ERROR tests/test_b.py::test_y - fixture missing',
    '=========== 1 failed, 1 error, 3 passed in 0.21s ==========='].join('\n');
  const { r } = await adjudicateOne(pytest);
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests output family summary has no failure-accounting guard');
});

test('C1: a truncated TAP log (no `# fail N` summary) is not adjudicated (#3043)', async () => {
  const truncated = ['TAP version 13', 'not ok 1 - env', '  ---', "  location: '/repo/tests/a.test.js:1:1'", '  ...'].join('\n');
  const { r } = await adjudicateOne(truncated);
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests summary counts unparsed (family tap) — log truncated or unrecognized');
});

test('C1: a spec log whose failing entries fall short of `ℹ fail N` is not adjudicated (#3043)', async () => {
  const short = SPEC(['tests/a.test.js']).replace('ℹ fail 1', 'ℹ fail 3');
  const { r } = await adjudicateOne(short);
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests failing entries (1) do not account for ℹ fail 3');
});

test('C1: a TAP `not ok` block whose frames name no test file is an unclassified failure (#3043)', async () => {
  const tap = ['not ok 1 - env', "  location: '/repo/tests/a.test.js:1:1'", 'not ok 2 - crashed', "  error: 'worker died'",
    '# tests 2', '# pass 0', '# fail 2'].join('\n');
  const { r } = await adjudicateOne(tap);
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /^unclassified failure\(s\): 1 failing entry names no test file in tests$/);
});

// C2: failing (file, test-name) pairs, not just files.
const SPEC_NAMED = (pairs) => ['ℹ tests 9', 'ℹ pass 1', `ℹ fail ${pairs.length}`, '', '✖ failing tests:', '',
  ...pairs.flatMap(([f, name]) => [`test at ${f}:1:1`, `✖ ${name} (1ms)`, ''])].join('\n');

test('C2: an old environment failure at base does not cover a new failing test in the same file (#3043)', async () => {
  const { p, dir } = logFile(SPEC_NAMED([['tests/a.test.js', 'old env failure'], ['tests/a.test.js', 'new regression']]));
  const { git, runOne, calls } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': SPEC_NAMED([['tests/a.test.js', 'old env failure']]) },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'fail');
  assert.strictEqual(calls.runs.filter((c) => c.kind === 'isolated').length, 1, 'the unproven file falls through to the isolated run');
});

test('C2: the comparison is a multiset — a name failing twice at HEAD needs two base failures (#3043)', async () => {
  const { p, dir } = logFile(SPEC_NAMED([['tests/a.test.js', 'dup'], ['tests/a.test.js', 'dup']]));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': SPEC_NAMED([['tests/a.test.js', 'dup']]) },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('C2: every HEAD failing test also failing at base (a superset at base is fine) is baseline (#3043)', async () => {
  const { p, dir } = logFile(SPEC_NAMED([['tests/a.test.js', 'env one']]));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': SPEC_NAMED([['tests/a.test.js', 'env two'], ['tests/a.test.js', 'env one']]) },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'pass');
});

test('C2: TAP names compare the same way — a new failing test beside an old one is unproven (#3043)', async () => {
  const tap = (names) => [...names.flatMap((n, i) => [`not ok ${i + 1} - ${n}`, "  location: '/repo/tests/a.test.js:1:1'"]),
    `# tests ${names.length}`, '# pass 0', `# fail ${names.length}`].join('\n');
  const { p, dir } = logFile(tap(['old env failure', 'new regression # TODO not really']));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': tap(['old env failure', 'new regression']).replace(/\/repo\//g, '/scratch/') },
  });
  const covered = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(covered.baselineFailing, ['tests/a.test.js'], 'directive stripped, base paths relativized against the scratch tree');
  const { p: p2 } = logFile(tap(['old env failure', 'brand new']));
  const uncovered = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p2 }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(uncovered.attributable, ['tests/a.test.js']);
});

test('fail-open guard: a base run exiting 1 whose log names a different file, or none, is not baseline — it falls to the isolated HEAD run (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne, calls } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 1, 'isolated:tests/a.test.js': 1, 'isolated:tests/b.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': SPEC(['tests/other.test.js']), 'baseline:tests/b.test.js': 'sh: nod: command not found\n' },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js', 'tests/b.test.js']);
  assert.strictEqual(r.verdict, 'fail');
  assert.strictEqual(calls.runs.filter((c) => c.kind === 'isolated').length, 2);
});

test('fail-open guard: an unreadable base log is unproven, not baseline (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne: inner } = fakes({ outcomes: { 'isolated:tests/a.test.js': 1 } });
  const runOne = async (o) => {
    const r = await inner(o);
    return o.name.includes('-baseline-') ? { ...r, logPath: path.join(dir, 'does-not-exist.log') } : r;
  };
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('fail-open guard: an isolated run exiting 0 with an empty log is attributable, never flaky (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/b.test.js']));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 0 },
    logs: { 'isolated:tests/b.test.js': '' },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.flakyPassed, []);
  assert.deepStrictEqual(r.attributable, ['tests/b.test.js']);
  assert.strictEqual(r.verdict, 'fail');
});

test('pool abort: a rejection starts no further item and the worktree is removed only after the in-flight sibling settles (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js']));
  const { git } = fakes({ outcomes: {} });
  const order = [];
  git.removeWorktree = () => { order.push('removed'); };
  const started = [];
  const runOne = async ({ name, command }) => {
    const file = command.replace('node --test ', '');
    started.push(file);
    if (file === 'tests/a.test.js') { await new Promise((r) => setTimeout(r, 5)); throw new Error('boom'); }
    await new Promise((r) => setTimeout(r, 60)); // b is still in flight when a rejects
    order.push(`settled:${file}`);
    return { name, command, exitCode: 1, durationMs: 1, logPath: 'x' };
  };
  await assert.rejects(adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git, concurrency: 2 }), /boom/);
  assert.deepStrictEqual(started, ['tests/a.test.js', 'tests/b.test.js'], 'c never starts');
  assert.deepStrictEqual(order, ['settled:tests/b.test.js', 'removed']);
});

test('file-level base failure + per-test HEAD failure: the file may have loaded at base, so it is not baseline (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': FILE_LEVEL('tests/a.test.js') },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('file-level base failure + file-level HEAD failure + no node_modules: a genuine load failure, baseline (#3043)', async () => {
  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': FILE_LEVEL('tests/a.test.js') },
    repoRoot: path.join(os.tmpdir(), 'baseline-no-such-repo-root'),
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: path.join(os.tmpdir(), 'baseline-no-such-repo-root'), logDir: dir, runOne, git, env: {} });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'pass');
});

// I2: HEAD resolves dependencies the way Node does — walking up parent
// directories, and through NODE_PATH.
const fileLevelBoth = (cwd, repoRoot) => fakes({
  outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
  logs: { 'baseline:tests/a.test.js': FILE_LEVEL('tests/a.test.js'), 'isolated:tests/a.test.js': FILE_LEVEL('tests/a.test.js') },
  repoRoot: repoRoot || cwd,
});

test('I2: a worktree nested in a checkout whose node_modules sits at an ancestor resolves deps — not baseline (#3043)', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-outer-'));
  fs.mkdirSync(path.join(outer, 'node_modules'));
  const wt = path.join(outer, '.claude', 'worktrees', 'rec');
  fs.mkdirSync(wt, { recursive: true });
  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const { git, runOne } = fileLevelBoth(wt);
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: wt, logDir: dir, runOne, git, env: {} });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('I2: a set NODE_PATH resolves deps — a file-level failure on both sides is not baseline (#3043)', async () => {
  const root = path.join(os.tmpdir(), 'baseline-no-such-repo-root');
  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const { git, runOne } = fileLevelBoth(root);
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: root, logDir: dir, runOne, git, env: { NODE_PATH: path.join(os.tmpdir(), 'deps') } });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
});

test('file-level base failure + file-level HEAD failure but the checkout has node_modules: the scratch tree just lacks them, not baseline (#3043)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-repo-'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': FILE_LEVEL('tests/a.test.js'), 'isolated:tests/a.test.js': FILE_LEVEL('tests/a.test.js') },
    repoRoot: root,
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: root, logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'fail');
});

test('an isolated run exiting 0 with every test skipped (pass 0) is attributable, never flaky (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/b.test.js']));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/b.test.js': 0, 'isolated:tests/b.test.js': 0 },
    logs: { 'isolated:tests/b.test.js': ['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 0'].join('\n') },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.flakyPassed, []);
  assert.deepStrictEqual(r.attributable, ['tests/b.test.js']);
});

test('passing checks are ignored — only failed ones are adjudicated (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'lint', exitCode: 0, logPath: 'unused' }, { name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
});

test('M1: a scratch worktree that survives cleanup is named on stderr with the manual removal command (#3043)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-')), 'wt');
  fs.mkdirSync(scratch);
  const warned = [];
  // `git worktree remove` refuses a non-worktree and the rm is a no-op, so the directory survives.
  realGit(repo, { warn: (line) => warned.push(line), rmSync: () => {} }).removeWorktree(scratch);
  assert.deepStrictEqual(warned, [`verify.js: could not remove the baseline scratch worktree ${scratch} — remove it manually: git worktree remove --force ${scratch}\n`]);
  const quiet = [];
  realGit(repo, { warn: (line) => quiet.push(line) }).removeWorktree(scratch);
  assert.deepStrictEqual(quiet, [], 'a removal that succeeds says nothing');
});
