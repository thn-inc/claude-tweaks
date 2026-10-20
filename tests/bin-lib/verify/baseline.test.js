'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { adjudicate, realGit, findStaleBaselineWorktrees } = require('../../../plugin/bin/lib/verify/baseline');

function logFile(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-test-'));
  const p = path.join(dir, 'tests.log');
  fs.writeFileSync(p, text);
  return { dir, p };
}

const SPEC = (files) => [...files.map(() => '✖ x (1ms)'), 'ℹ tests 9', 'ℹ pass 1', `ℹ fail ${files.length}`, 'ℹ cancelled 0', '', '✖ failing tests:', '',
  ...files.flatMap((f) => [`test at ${f}:1:1`, '✖ x (1ms)', ''])].join('\n');

// A test file that fails to load: node lists the FILE as the failing test.
const FILE_LEVEL = (f) => ['ℹ tests 1', 'ℹ pass 0', 'ℹ fail 1', 'ℹ cancelled 0', '', '✖ failing tests:', '',
  `test at ${f}:1:1`, `✖ ${f} (12ms)`, "  'test failed'", ''].join('\n');

// outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/b.test.js': 0, ... } — exit code per (kind, file)
// Each fake run writes a real log reflecting its outcome (a failing run names the
// file in a spec-format log, a passing run reports one passing test); `logs`
// overrides the text per `${kind}:${file}`.
const PASS_LOG = ['✔ x (1ms)', 'ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 0'].join('\n');

function fakes({ outcomes, existsAtBase = () => true, sameAtBase = () => true, inCheckout = () => true, throwOn = null, logs = {}, repoRoot = '/repo' }) {
  const calls = { runs: [], added: [], removed: [], batchBaseInfo: [] };
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-fake-runs-'));
  const git = {
    repoRoot: () => repoRoot,
    // One call per adjudicate() run, however many files — #3070's AC: a
    // per-file git.fileExistsAt/sameAtBase pair would make calls.batchBaseInfo
    // grow with the failing-file count; this single-entry mock would catch it.
    batchBaseInfo: (sha, files, root) => {
      calls.batchBaseInfo.push({ sha, files, root });
      const m = new Map();
      files.forEach((f) => { const exists = existsAtBase(f); m.set(f, { exists, same: exists && sameAtBase(f) }); });
      return m;
    },
    inCheckout: (dir, rel) => inCheckout(dir, rel),
    addWorktree: (sha) => { calls.added.push(sha); return '/scratch'; },
    removeWorktree: (dir) => { calls.removed.push(dir); },
  };
  const runOne = async ({ name, command, cwd }) => {
    const kind = name.endsWith('-base-full') ? 'base-full' : (name.includes('-baseline-') ? 'baseline' : (name.includes('-isolated-retry-') ? 'isolated-retry' : 'isolated'));
    const file = command.replace('node --test ', '');
    calls.runs.push({ kind, file, cwd });
    if (throwOn && throwOn === `${kind}:${file}`) throw new Error('boom');
    const key = `${kind}:${file}`;
    // An outcome may be an object ({exitCode, timedOut}) to carry a timeout.
    const outcome = outcomes[key];
    const code = outcome !== null && typeof outcome === 'object' ? outcome.exitCode : outcome;
    const text = key in logs ? logs[key] : (code === 0 ? PASS_LOG : SPEC([file]));
    const logPath = path.join(logRoot, `${name}.log`);
    fs.writeFileSync(logPath, text);
    return { name, command, exitCode: code === undefined ? 1 : code, ...(outcome && outcome.timedOut ? { timedOut: true } : {}), durationMs: 1, logPath };
  };
  return { git, runOne, calls };
}

const tmpl = new Map([['tests', 'node --test {file}']]);

test('every failing file fails the same tests at base and in isolation at HEAD → verdict pass (#3043 AC1)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js', 'tests/b.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'baseline:tests/b.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, true);
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js', 'tests/b.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(r.baselineIsolated['tests/a.test.js'].waived, []);
  // Per-test failures are never covered by the base run alone — each file also runs once in isolation at HEAD.
  assert.deepStrictEqual(calls.runs.map((c) => `${c.kind}@${c.cwd}`), ['baseline@/scratch', 'baseline@/scratch', 'isolated@/repo', 'isolated@/repo']);
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

test('#3063 AC2: an isolated run that times out is no evidence — the file stays attributable and is named in r.timedOut', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const logRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-timeout-test-'));
  const git = {
    repoRoot: () => '/repo',
    batchBaseInfo: (sha, files) => new Map(files.map((f) => [f, { exists: true, same: true }])),
    inCheckout: () => true,
    addWorktree: () => '/scratch',
    removeWorktree: () => {},
  };
  const runOne = async ({ name, command }) => {
    const logPath = path.join(logRoot, `${name}.log`);
    const file = command.replace('node --test ', '');
    // The isolated single-file rerun hangs past its bound — the same shape
    // runOne itself produces on a real timeout (null exit, timedOut:true).
    // The base rerun behaves like an ordinary failure, unaffected.
    if (name.includes('-isolated-')) {
      fs.writeFileSync(logPath, '');
      return { name, command, exitCode: null, timedOut: true, durationMs: 1, logPath };
    }
    fs.writeFileSync(logPath, SPEC([file]));
    return { name, command, exitCode: 1, durationMs: 1, logPath };
  };
  const r = await adjudicate({
    checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40),
    cwd: '/repo', logDir: dir, runOne, git,
  });
  assert.strictEqual(r.verdict, 'fail');
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.flakyPassed, []);
  assert.deepStrictEqual(r.timedOut, ['tests/a.test.js']);
});

test('#3063: timeoutOf is forwarded from adjudicate to each per-file run, bounded by the check\'s own --cmd-timeout', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne: baseRunOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 } });
  const seenTimeouts = [];
  const runOne = async (args) => { seenTimeouts.push(args.timeout); return baseRunOne(args); };
  await adjudicate({
    checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40),
    cwd: '/repo', logDir: dir, runOne, git, timeoutOf: (name) => (name === 'tests' ? 5000 : null),
  });
  assert.strictEqual(calls.runs.length, 2, 'one baseline + one isolated run');
  assert.deepStrictEqual(seenTimeouts, [5000, 5000]);
});

test('#3063: adjudicate defaults timeoutOf to a no-op — every per-file run gets no timeout, unchanged from before', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne: baseRunOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 } });
  const seenTimeouts = [];
  const runOne = async (args) => { seenTimeouts.push(args.timeout); return baseRunOne(args); };
  await adjudicate({
    checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40),
    cwd: '/repo', logDir: dir, runOne, git,
  });
  assert.deepStrictEqual(seenTimeouts, [null, null]);
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
const SPEC_NAMED = (pairs) => [...pairs.map(([, name]) => `✖ ${name} (1ms)`), 'ℹ tests 9', 'ℹ pass 1', `ℹ fail ${pairs.length}`, 'ℹ cancelled 0', '', '✖ failing tests:', '',
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
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: {
      'baseline:tests/a.test.js': SPEC_NAMED([['tests/a.test.js', 'env two'], ['tests/a.test.js', 'env one']]),
      'isolated:tests/a.test.js': SPEC_NAMED([['tests/a.test.js', 'env one']]),
    },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'pass');
});

test('C2: TAP names compare the same way — a new failing test beside an old one is unproven (#3043)', async () => {
  const tap = (names) => [...names.flatMap((n, i) => [`not ok ${i + 1} - ${n}`, "  location: '/repo/tests/a.test.js:1:1'"]),
    `# tests ${names.length}`, '# pass 0', `# fail ${names.length}`, '# cancelled 0'].join('\n');
  const { p, dir } = logFile(tap(['old env failure', 'new regression # TODO not really']));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: {
      'baseline:tests/a.test.js': tap(['old env failure', 'new regression']).replace(/\/repo\//g, '/scratch/'),
      'isolated:tests/a.test.js': tap(['old env failure']),
    },
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

// Node resolves dependencies up the whole ancestor chain, so a `node_modules`
// above the OS tmpdir (e.g. in the home directory) is a real dependency
// source for the fixture root below — the positive path cannot hold there.
function nodeModulesAbove(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'node_modules'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

test('file-level base failure + file-level HEAD failure + no node_modules: a genuine load failure, baseline (#3043)', async (t) => {
  if (nodeModulesAbove(os.tmpdir())) return t.skip('a node_modules above the OS tmpdir makes the fixture root resolve dependencies');
  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const root = path.join(os.tmpdir(), 'baseline-no-such-repo-root');
  // The same load error at base (under /scratch) and in isolation at HEAD (under the repo root).
  const loadLog = (r, msg) => [`${r}${path.sep}lib.js:3`, `Error: ${msg}`, `    at Object.<anonymous> (${r}${path.sep}lib.js:3:7)`, FILE_LEVEL('tests/a.test.js').replace('(12ms)', `(${msg.length}ms)`)].join('\n');
  const run = async (headMsg) => {
    const { git, runOne } = fakes({
      outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
      logs: { 'baseline:tests/a.test.js': loadLog('/scratch', 'windows-only path issue'), 'isolated:tests/a.test.js': loadLog(root, headMsg) },
      repoRoot: root,
    });
    return adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: root, logDir: dir, runOne, git, env: {} });
  };
  const same = await run('windows-only path issue');
  assert.deepStrictEqual(same.baselineFailing, ['tests/a.test.js']);
  assert.strictEqual(same.verdict, 'pass');
  // Same site (1:1), different error — a new load failure, never covered.
  const different = await run('undefinedThing is not defined');
  assert.deepStrictEqual(different.attributable, ['tests/a.test.js']);
});

test('TAP whole-file failure at base and at HEAD that differs only in the run-summary `# duration_ms` is baseline (#3316)', async (t) => {
  if (nodeModulesAbove(os.tmpdir())) return t.skip('a node_modules above the OS tmpdir makes the fixture root resolve dependencies');
  const root = path.join(os.tmpdir(), 'baseline-no-such-repo-root');
  // A whole-file TAP failure; Node's default reporter is TAP whenever stdout is not a TTY.
  const tapFile = (r, ms) => ['TAP version 13', 'not ok 1 - tests/a.test.js', '  ---', "  location: 'tests/a.test.js:1:1'", `  error: 'Cannot find module ${r}/lib.js'`, '  ...',
    '1..1', '# tests 1', '# suites 0', '# pass 0', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0', `# duration_ms ${ms}`].join('\n');
  const { p, dir } = logFile(tapFile(root, '158.221'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: { 'baseline:tests/a.test.js': tapFile('/scratch', '158.5401'), 'isolated:tests/a.test.js': tapFile(root, '158.221') },
    repoRoot: root,
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: root, logDir: dir, runOne, git, env: {} });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.deepStrictEqual(r.attributable, []);
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

// #3167: a `--baseline` scratch worktree reached through a symlinked parent
// (macOS: `os.tmpdir()` -> `/var/folders/...` -> `/private/var/folders/...`)
// must still relativize correctly against the base run's own absolute
// paths, which node prints already realpath-resolved. Host-OS independent:
// the scratch dir is realpath'd first, then reached through one deliberate
// symlink hop, so the bug reproduces on every platform, not only macOS.
test('#3167: a base worktree reached through a symlinked parent still classifies a same-site failure as baseline (realpath)', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-head-'));
  const realScratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-real-scratch-')));
  const wtDir = path.join(realScratch, 'wt');
  fs.mkdirSync(wtDir);
  const symParent = path.join(os.tmpdir(), `baseline-sym-scratch-${process.pid}-${Date.now()}`);
  fs.symlinkSync(realScratch, symParent, 'dir');
  const symWtDir = path.join(symParent, 'wt');

  const { p, dir } = logFile(FILE_LEVEL('tests/a.test.js'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 },
    logs: {
      // node prints the resolved real path, never the symlink.
      'baseline:tests/a.test.js': FILE_LEVEL(path.join(wtDir, 'tests/a.test.js')),
      'isolated:tests/a.test.js': FILE_LEVEL(path.join(fs.realpathSync(outer), 'tests/a.test.js')),
    },
    repoRoot: outer,
  });
  // Hand back the symlinked path, as `fs.mkdtempSync(os.tmpdir())` does on macOS.
  git.addWorktree = () => symWtDir;
  const r = await adjudicate({
    checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40),
    cwd: outer, logDir: dir, runOne, git,
  });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.strictEqual(r.verdict, 'pass');
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

// A single-file spec log of tests/r.test.js, the way node prints it: the tree
// (`✔`/`✖`/`﹣` per test) above the failing section. `fails` are [name, loc,
// diagnostics?] — loc defaults to 1:1; `passes`/`skips` are names.
const R = 'tests/r.test.js';
const NAMED = ({ fails = [], passes = [], skips = [], fail = fails.length, cancelled = 0 } = {}) => [
  ...passes.map((n) => `✔ ${n} (1ms)`), ...fails.map(([n]) => `✖ ${n} (1ms)`), ...skips.map((n) => `﹣ ${n} (0.1ms) # SKIP`),
  `ℹ tests ${passes.length + fails.length + skips.length}`, `ℹ pass ${passes.length}`, `ℹ fail ${fail}`, `ℹ cancelled ${cancelled}`, '',
  '✖ failing tests:', '',
  ...fails.flatMap(([n, loc = '1:1', diag = '  AssertionError']) => [`test at ${R}:${loc}`, `✖ ${n} (1ms)`, diag, '']),
].join('\n');

// The full run fails tests/r.test.js on base's `x` plus a load-induced `slow`.
const isolationCase = (isolatedLog, {
  isolatedCode = 1, baseLog = NAMED({ fails: [['x']], passes: ['slow'] }), head = NAMED({ fails: [['x'], ['slow']] }), sameAtBase, retryLog, retryCode,
} = {}) => {
  const { p, dir } = logFile(head);
  const { git, runOne, calls } = fakes({
    outcomes: { [`baseline:${R}`]: 1, [`isolated:${R}`]: isolatedCode, ...(retryCode !== undefined ? { [`isolated-retry:${R}`]: retryCode } : {}) },
    logs: { [`baseline:${R}`]: baseLog, [`isolated:${R}`]: isolatedLog, ...(retryLog !== undefined ? { [`isolated-retry:${R}`]: retryLog } : {}) },
    sameAtBase,
  });
  return adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git })
    .then((r) => ({ ...r, calls }));
};

test('a file failing beyond its base tests in the full run, but only base tests in isolation (the rest passing there), is baseline (#3043)', async () => {
  const r = await isolationCase(NAMED({ fails: [['x']], passes: ['slow'] }));
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.baselineFailing, [R]);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(r.baselineIsolated[R].waived, ['slow']);
  assert.match(r.baselineIsolated[R].log, /tests-isolated-tests\+r\.test\.js\.log$/);
});

test('an isolated run failing a test base does not fail stays attributable when the retry reproduces it too (#3111 AC2)', async () => {
  const r = await isolationCase(NAMED({ fails: [['x'], ['slow']] }), {
    retryLog: NAMED({ fails: [['x'], ['slow']] }), retryCode: 1,
  });
  assert.deepStrictEqual(r.attributable, [R]);
  assert.deepStrictEqual(r.baselineIsolated, {});
  assert.deepStrictEqual(r.flakyPassed, []);
});

test('an isolated run failing a base-covered test plus an extra test is reported baseline-flaky when the retry does not reproduce the extra failure (#3111 AC1)', async () => {
  const r = await isolationCase(NAMED({ fails: [['x'], ['slow']] }), {
    retryLog: NAMED({ fails: [['x']], passes: ['slow'] }), retryCode: 1,
  });
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(r.flakyPassed, [R]);
  assert.match(r.flakyLogs[R], /tests-isolated-retry-tests\+r\.test\.js\.log$/);
  assert.strictEqual(r.verdict, 'pass');
});

test('an isolated run that already covers base on the first try never triggers a retry (#3111)', async () => {
  const r = await isolationCase(NAMED({ fails: [['x']], passes: ['slow'] }));
  assert.deepStrictEqual(r.baselineFailing, [R]);
  assert.deepStrictEqual(r.calls.runs.filter((c) => c.kind === 'isolated-retry'), []);
});

test('an isolated run that passes cleanly on the first try never triggers a retry (#3043, #3111)', async () => {
  const { p, dir } = logFile(SPEC([R]));
  const { git, runOne, calls } = fakes({ outcomes: { [`baseline:${R}`]: 0, [`isolated:${R}`]: 0 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.flakyPassed, [R]);
  assert.deepStrictEqual(calls.runs.filter((c) => c.kind === 'isolated-retry'), []);
});

test('absence is not a pass: an isolated run cut short (the extra test never ran) or skipping it stays attributable (#3043)', async () => {
  // A child killed mid-file after `x` failed: `slow` never appears.
  assert.deepStrictEqual((await isolationCase(NAMED({ fails: [['x']], passes: ['first'] }))).attributable, [R]);
  assert.deepStrictEqual((await isolationCase(NAMED({ fails: [['x']], skips: ['slow'] }))).attributable, [R]);
});

test('an isolated run that does not account for its failure, or reports a cancelled test, stays attributable (#3043)', async () => {
  assert.deepStrictEqual((await isolationCase(NAMED({ fails: [['x']], passes: ['slow'], fail: 2 }))).attributable, [R]);
  assert.deepStrictEqual((await isolationCase(NAMED({ fails: [['x']], passes: ['slow'], cancelled: 1 }))).attributable, [R]);
});

test('an isolated run with no numeric exit, or a base that names no failing test, stays attributable (#3043)', async () => {
  const iso = NAMED({ fails: [['x']], passes: ['slow'] });
  assert.deepStrictEqual((await isolationCase(iso, { isolatedCode: null })).attributable, [R]);
  assert.deepStrictEqual((await isolationCase(iso, { baseLog: PASS_LOG })).attributable, [R]);
});

test('a file-level isolated failure never qualifies as baseline-in-isolation (#3043)', async () => {
  const r = await isolationCase(FILE_LEVEL(R), { baseLog: FILE_LEVEL(R) });
  assert.deepStrictEqual(r.attributable, [R]);
});

test('a full run with a cancelled test is adjudicated: its entries add up to fail + cancelled, and the cancelled test needs its own isolated pass (#3043)', async () => {
  // HEAD: `x` fails (base's), `slow` is cancelled under load — listed but not counted in ℹ fail.
  const head = NAMED({ fails: [['x'], ['slow', '1:1', "  'test did not finish before its parent and was cancelled'"]], fail: 1, cancelled: 1 });
  const ok = await isolationCase(NAMED({ fails: [['x']], passes: ['slow'] }), { head });
  assert.strictEqual(ok.eligible, true);
  assert.deepStrictEqual(ok.baselineFailing, [R]);
  assert.deepStrictEqual(ok.baselineIsolated[R].waived, ['slow']);
  // The same cancelled test, cancelled again in isolation, proves nothing.
  const again = await isolationCase(NAMED({ fails: [['x'], ['slow']], fail: 1, cancelled: 1 }), { head });
  assert.deepStrictEqual(again.attributable, [R]);
});

test('a base run with a cancelled test, or whose failure timed out, is no evidence — even when HEAD fails the same names (#3043)', async () => {
  const head = NAMED({ fails: [['x']] });
  const cancelledBase = NAMED({ fails: [['x']], cancelled: 1 });
  const r1 = await isolationCase(NAMED({ fails: [['x']] }), { head, baseLog: cancelledBase });
  assert.deepStrictEqual(r1.attributable, [R]);
  const timedOutBase = NAMED({ fails: [['x', '1:1', "  'test timed out after 100ms'"]] });
  const r2 = await isolationCase(NAMED({ fails: [['x']] }), { head, baseLog: timedOutBase });
  assert.deepStrictEqual(r2.attributable, [R]);
});

test('an unchanged file compares tests by definition site — a same-named test elsewhere in the file is not covered (#3043)', async () => {
  // Base fails `works` at 3:3 (describe A); HEAD fails `works` at 9:3 (describe B).
  const head = NAMED({ fails: [['works', '9:3']], passes: ['works'] });
  const r = await isolationCase(NAMED({ fails: [['works', '9:3']], passes: ['works'] }), { head, baseLog: NAMED({ fails: [['works', '3:3']], passes: ['works'] }) });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, [R]);
});

// A single-file spec log of tests/r.test.js with an explicit tree (suites as
// `▶ name` … same-indent closer) and failing-section entries [name, loc].
const TREE = (tree, entries) => [...tree, `ℹ tests ${tree.filter((l) => /[✔✖﹣] /.test(l)).length}`, 'ℹ pass 1', `ℹ fail ${entries.length}`, 'ℹ cancelled 0', '',
  '✖ failing tests:', '', ...entries.flatMap(([n, loc]) => [`test at ${R}:${loc}`, `✖ ${n} (1ms)`, '  AssertionError', ''])].join('\n');

test('one call site in a loop: an unchanged file whose base and HEAD fail `works` at the same site in different suites is attributable (#3043)', async () => {
  // for (impl of ['A','B']) describe(impl, () => it('works')) — A fails at base, B fails at HEAD.
  const suites = (failing) => ['A', 'B'].flatMap((s) => [`▶ ${s}`, `  ${s === failing ? '✖' : '✔'} works (1ms)`, `${s === failing ? '✖' : '✔'} ${s} (2ms)`]);
  const r = await isolationCase(TREE(suites('B'), [['works', '6:5']]), {
    head: TREE(suites('B'), [['works', '6:5']]),
    baseLog: TREE(suites('A'), [['works', '6:5']]),
  });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, [R]);
});

test('a changed file whose failing test moved suites (X > works at base, Y > works at HEAD) is attributable (#3043)', async () => {
  const one = (s) => [`▶ ${s}`, '  ✖ works (1ms)', `✖ ${s} (2ms)`];
  const r = await isolationCase(TREE(one('Y'), [['works', '9:3']]), {
    head: TREE(one('Y'), [['works', '9:3']]), baseLog: TREE(one('X'), [['works', '3:3']]), sameAtBase: () => false,
  });
  assert.deepStrictEqual(r.attributable, [R]);
});

test('flaky needs evidence too: an isolated exit 0 where the full-run failure never ran, or a cancelled test, is attributable (#3043)', async () => {
  const { p, dir } = logFile(SPEC([R]));
  const notRun = ['✔ other (1ms)', 'ℹ tests 1', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 0'].join('\n');
  const cancelled = ['✔ x (1ms)', 'ℹ tests 2', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 1'].join('\n');
  for (const iso of [notRun, cancelled]) {
    const { git, runOne } = fakes({ outcomes: { [`baseline:${R}`]: 0, [`isolated:${R}`]: 0 }, logs: { [`isolated:${R}`]: iso } });
    const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
    assert.deepStrictEqual(r.flakyPassed, []);
    assert.deepStrictEqual(r.attributable, [R]);
  }
});

test('a suite name with a leading space nests exactly — moving a failing test into ` setup` is attributable (#3043)', async () => {
  // Base: describe(' setup', () => it('a')); it('works') — both fail. HEAD: works moved inside ` setup`, failing for a new reason.
  const base = TREE(['▶  setup', '  ✖ a (1ms)', '✖  setup (2ms)', '✖ works (1ms)'], [['a', '2:3'], ['works', '4:1']]);
  const iso = TREE(['▶  setup', '  ✖ a (1ms)', '  ✖ works (1ms)', '✖  setup (2ms)'], [['a', '2:3'], ['works', '3:3']]);
  const r = await isolationCase(iso, { head: iso, baseLog: base, sameAtBase: () => false });
  assert.deepStrictEqual(r.attributable, [R]);
});

test('a malformed isolated tree (a suite name spanning lines) is no evidence (#3043)', async () => {
  const tree = ['▶ multi', 'line', '  ✖ a (1ms)', '✖ multi', 'line (2ms)'];
  const r = await isolationCase(TREE(tree, [['a', '2:3']]), { head: TREE(tree, [['a', '2:3']]), baseLog: TREE(tree, [['a', '2:3']]) });
  assert.deepStrictEqual(r.attributable, [R]);
});

test('a runner-level error diagnostic in the isolated log (async work outliving its test) is no evidence, even beside a base failure (#3043)', async () => {
  const tree = ['✖ base-fail (1ms)', '✔ late (1ms)'];
  const iso = TREE(tree, [['base-fail', '3:1']]).replace('ℹ tests', 'ℹ Error: Test "late" at tests\\r.test.js:5:3 generated asynchronous activity after the test ended.\nℹ tests');
  const r = await isolationCase(iso, { head: TREE(tree, [['base-fail', '3:1']]), baseLog: TREE(tree, [['base-fail', '3:1']]) });
  assert.deepStrictEqual(r.attributable, [R]);
});

test('a base parent that only inherited its child failure never covers the parent failing in its own right at HEAD (#3043)', async () => {
  // Base: P fails only because `child` fails (P unlisted). HEAD: P also throws its own error (listed).
  const base = TREE(['▶ P', '  ✖ child (1ms)', '✖ P (2ms)'], [['child', '5:3']]);
  const iso = TREE(['▶ P', '  ✖ child (1ms)', '✖ P (2ms)'], [['child', '5:3'], ['P', '4:1']]);
  const r = await isolationCase(iso, { head: iso, baseLog: base });
  assert.deepStrictEqual(r.attributable, [R]);
  // The same inheritance on both sides is baseline.
  const same = await isolationCase(base, { head: base, baseLog: base });
  assert.deepStrictEqual(same.baselineFailing, [R]);
});

test('a file-scoped hook failure at base never covers a test file that fails to load at HEAD (#3043)', async () => {
  // Base: an `after` hook throws (reported as the file, at 7:1) beside an ordinary failing test. HEAD: the file does not load (1:1).
  const base = TREE([`✖ ${R} (3ms)`, '✖ crlf (1ms)'], [[R, '7:1'], ['crlf', '3:1']]);
  const head = FILE_LEVEL(R);
  const r = await isolationCase(FILE_LEVEL(R), { head, baseLog: base });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, [R]);
});

test('data-driven tests at one call site: base fails alpha > works, HEAD fails beta > works — attributable via the isolated run (#3043)', async () => {
  const base = TREE(['▶ alpha', '  ✖ works (1ms)', '✖ alpha (2ms)'], [['works', '8:5']]);
  const iso = TREE(['▶ alpha', '  ✔ works (1ms)', '✔ alpha (2ms)', '▶ beta', '  ✖ works (1ms)', '✖ beta (2ms)'], [['works', '8:5']]);
  const r = await isolationCase(iso, { head: TREE(['✖ works (1ms)'], [['works', '8:5']]), baseLog: base });
  assert.deepStrictEqual(r.baselineFailing, []);
  assert.deepStrictEqual(r.attributable, [R]);
  assert.strictEqual(r.calls.runs.filter((c) => c.kind === 'isolated').length, 1, 'an unchanged file with per-test failures still takes the isolated run');
});

test('a changed test file always takes the isolated run, comparing names unique in both trees (#3043)', async () => {
  const head = NAMED({ fails: [['x']] });
  const ok = await isolationCase(NAMED({ fails: [['x', '7:1']], passes: ['y'] }), { head, baseLog: NAMED({ fails: [['x']] }), sameAtBase: () => false });
  assert.deepStrictEqual(ok.baselineFailing, [R]);
  assert.deepStrictEqual(ok.baselineIsolated[R].waived, []);
  assert.strictEqual(ok.calls.runs.filter((c) => c.kind === 'isolated').length, 1, 'no definition-site shortcut for a changed file');
  // `works` appears twice in the base tree — ambiguous, never evidence.
  const dup = await isolationCase(NAMED({ fails: [['works']] }), { head: NAMED({ fails: [['works']] }), baseLog: NAMED({ fails: [['works']], passes: ['works'] }), sameAtBase: () => false });
  assert.deepStrictEqual(dup.attributable, [R]);
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

test('a working directory outside the repository root as git spells it is never adjudicated — the base-side run cannot leave the scratch tree (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: path.join('/elsewhere', 'app'), logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, false);
  assert.match(r.reason, /does not resolve under the repository root/);
  assert.deepStrictEqual(calls.runs, []);
  assert.deepStrictEqual(calls.added, [], 'no scratch worktree is created');
});

test('realGit.resolveCommit reads a flag-shaped ref as a ref, never as a git option (#3043)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base');
  const rg = realGit(repo);
  assert.strictEqual(rg.resolveCommit('HEAD'), git('rev-parse', 'HEAD'));
  assert.strictEqual(rg.resolveCommit('--all'), null);
});

test('realGit.addWorktree removes its temp parent when `git worktree add` fails (#3043)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const removed = [];
  const rg = realGit(repo, { rmSync: (dirPath, opts) => { removed.push(dirPath); fs.rmSync(dirPath, opts); } });
  assert.throws(() => rg.addWorktree('0'.repeat(40)));
  assert.strictEqual(removed.length, 1);
  assert.match(path.basename(removed[0]), /^ct-verify-base-/);
  assert.strictEqual(fs.existsSync(removed[0]), false);
});

test('realGit.batchBaseInfo: existence and sameness for several files in one pass, root passed in rather than re-resolved (#3070)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'one\n');
  fs.writeFileSync(path.join(repo, 'tests', 'b.test.js'), 'unchanged\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base');
  const sha = git('rev-parse', 'HEAD');
  const rg = realGit(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests', 'a.test.js'), 'two\n'); // edited since base
  const info = rg.batchBaseInfo(sha, ['tests/a.test.js', 'tests/b.test.js', 'tests/new.test.js'], repo);
  assert.deepStrictEqual(info.get('tests/a.test.js'), { exists: true, same: false }, 'edited since base');
  assert.deepStrictEqual(info.get('tests/b.test.js'), { exists: true, same: true }, 'unchanged since base, repo-root-relative path from a subdirectory cwd');
  assert.deepStrictEqual(info.get('tests/new.test.js'), { exists: false, same: false }, 'never existed at base');
});

test('realGit.batchBaseInfo: a file present at base but missing from the working tree is same:false, never a thrown batch error (#3070)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.test.js'), 'one\n');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base');
  const sha = git('rev-parse', 'HEAD');
  fs.rmSync(path.join(repo, 'a.test.js'));
  const rg = realGit(repo);
  const info = rg.batchBaseInfo(sha, ['a.test.js'], repo);
  assert.deepStrictEqual(info.get('a.test.js'), { exists: true, same: false });
});

test('a per-file git.fileExistsAt/sameAtBase pair would make calls grow with N; the batched seam stays at one call for any failing-file count (#3070)', async () => {
  const files = ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js', 'tests/d.test.js', 'tests/e.test.js'];
  const { p, dir } = logFile(SPEC(files));
  const outcomes = {};
  files.forEach((f) => { outcomes[`baseline:${f}`] = 1; });
  const { git, runOne, calls } = fakes({ outcomes });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
  assert.strictEqual(calls.batchBaseInfo.length, 1, 'exactly one batched call regardless of how many failing files');
  assert.deepStrictEqual(calls.batchBaseInfo[0].files, files, 'every failing file resolved in that one call');
});

test('adjudicate() registers SIGHUP/SIGINT/SIGTERM handlers only while the scratch worktree exists, and deregisters them on a clean completion (#3064)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const before = { SIGHUP: process.listenerCount('SIGHUP'), SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') };
  const seenDuring = {};
  const runOne = async ({ name, command, cwd }) => {
    if (name.includes('-baseline-')) {
      seenDuring.SIGHUP = process.listenerCount('SIGHUP');
      seenDuring.SIGINT = process.listenerCount('SIGINT');
      seenDuring.SIGTERM = process.listenerCount('SIGTERM');
    }
    const logPath = path.join(dir, `${name}.log`);
    fs.writeFileSync(logPath, SPEC(['tests/a.test.js']));
    return { name, command, exitCode: 1, durationMs: 1, logPath };
  };
  await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(seenDuring, { SIGHUP: before.SIGHUP + 1, SIGINT: before.SIGINT + 1, SIGTERM: before.SIGTERM + 1 }, 'one handler per signal is registered while the scratch worktree exists');
  assert.strictEqual(process.listenerCount('SIGHUP'), before.SIGHUP, 'deregistered after a clean completion');
  assert.strictEqual(process.listenerCount('SIGINT'), before.SIGINT);
  assert.strictEqual(process.listenerCount('SIGTERM'), before.SIGTERM);
});

test('adjudicate() registers no signal handlers when no failing file exists at base (nothing to clean up) (#3064)', async () => {
  const { p, dir } = logFile(SPEC(['tests/new.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'isolated:tests/new.test.js': 0 }, existsAtBase: () => false });
  const before = process.listenerCount('SIGINT');
  await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(process.listenerCount('SIGINT'), before);
});

test('a SIGINT while the scratch worktree exists removes it and exits with the signal\'s conventional code (130), deregistering even on that path (#3064)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, calls } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  class FakeExit extends Error { constructor(code) { super(`fake exit ${code}`); this.code = code; } }
  const originalExit = process.exit;
  process.exit = (code) => { throw new FakeExit(code); };
  const sigintBefore = process.listenerCount('SIGINT');
  // Invoke the just-registered handler directly (never `process.emit`, which
  // would also fire every other SIGINT listener already registered on this
  // shared test-runner process) — the handler registered by this adjudicate()
  // call is the one appended at index `sigintBefore`.
  const runOne = async ({ name }) => {
    if (name.includes('-baseline-')) process.listeners('SIGINT')[sigintBefore]();
    return { name, command: '', exitCode: 1, durationMs: 1, logPath: p };
  };
  try {
    await assert.rejects(
      adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git }),
      (err) => err instanceof FakeExit && err.code === 130,
    );
  } finally {
    process.exit = originalExit;
  }
  // The handler itself calls removeWorktree before throwing (simulating
  // process.exit) — real code never reaches the `finally` below once
  // process.exit actually terminates the process, but this test's stubbed
  // exit (a thrown error, so the test harness itself survives) lets the
  // `finally` still run afterward and call it again; that double call is the
  // real removeWorktree's own idempotent, best-effort shape, not a defect.
  assert.ok(calls.removed.includes('/scratch'), 'the signal handler itself removes the scratch worktree');
  assert.strictEqual(process.listenerCount('SIGINT'), sigintBefore, 'deregistered even on the signal-interrupted path (async function finally still runs during promise unwind)');
});

test('findStaleBaselineWorktrees filters `git worktree list` down to ct-verify-base-* scratch worktrees, never sweeping them (#3064)', () => {
  const listWorktrees = () => [
    '/repo',
    '/tmp/ct-verify-base-ab12cd/wt',
    '/Users/x/.worktrees/some-feature-branch',
    '/tmp/ct-verify-base-ef34gh/wt',
  ];
  assert.deepStrictEqual(findStaleBaselineWorktrees(listWorktrees), ['/tmp/ct-verify-base-ab12cd/wt', '/tmp/ct-verify-base-ef34gh/wt']);
});

test('realGit.listWorktrees reads real `git worktree list` output, and findStaleBaselineWorktrees names only the stale scratch one (#3064)', () => {
  // realpathSync: on macOS, os.tmpdir() is a symlink (/var -> /private/var)
  // that `git worktree list` reports already resolved — an unresolved
  // mkdtemp path would spuriously mismatch (same note as cli.test.js's own
  // tmpDir() helper).
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-realgit-')));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo });
  const normalWt = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-normal-wt-')));
  fs.rmdirSync(normalWt);
  execFileSync('git', ['worktree', 'add', '--detach', normalWt, 'HEAD'], { cwd: repo });
  const staleParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-')));
  const staleWt = path.join(staleParent, 'wt');
  execFileSync('git', ['worktree', 'add', '--detach', staleWt, 'HEAD'], { cwd: repo });
  const rg = realGit(repo);
  const all = rg.listWorktrees();
  assert.strictEqual(all.length, 3, 'the main worktree plus both added ones');
  assert.ok(all.includes(normalWt));
  assert.ok(all.includes(staleWt));
  assert.deepStrictEqual(findStaleBaselineWorktrees(() => all), [staleWt]);
});

test('realGit.listWorktrees returns an empty list rather than throwing outside a git repository (#3064)', () => {
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-not-a-repo-'));
  assert.deepStrictEqual(realGit(notARepo).listWorktrees(), []);
});

// #3153: the full-run failure of a meta-test that quotes its spawned child's
// TAP (temp-dir paths and all) in its assertion message.
const META_TAP = (root) => ['TAP version 13', 'not ok 1 - meta', '  ---', `  location: '${root}/tests/meta.test.js:9:1'`, '  error: |-',
  '    not ok 1 - env', '      ---', "      location: '/private/var/folders/x/T/verify-cli-test-abc/tests/env.test.js:1:40'", '      ...',
  '  stack: |-', `    TestContext.<anonymous> (${root}/tests/meta.test.js:17:10)`, '  ...', '1..1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');

test('#3153 AC1: a meta-test quoting its child\'s temp-dir TAP adjudicates on its own file only — baseline, never a phantom attributable', async () => {
  const { p, dir } = logFile(META_TAP('/repo'));
  const { git, runOne } = fakes({
    outcomes: { 'baseline:tests/meta.test.js': 1, 'isolated:tests/meta.test.js': 1 },
    logs: { 'baseline:tests/meta.test.js': META_TAP('/scratch'), 'isolated:tests/meta.test.js': META_TAP('/repo') },
  });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.failingFiles, ['tests/meta.test.js']);
  assert.deepStrictEqual(r.attributable, []);
  assert.deepStrictEqual(r.baselineFailing, ['tests/meta.test.js']);
  assert.strictEqual(r.verdict, 'pass');
});

test('#3153 AC3: a failing-file path absent from the checkout never reaches attributable — dropped beside a real file, unclassified alone', async () => {
  const present = (dir, rel) => rel === 'tests/a.test.js';
  const beside = ['not ok 1 - a', "  location: '/repo/tests/a.test.js:1:1'", '  at /tmp/sandbox/tests/env.test.js:2:1',
    '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');
  const { p, dir } = logFile(beside);
  const one = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 0 }, inCheckout: present });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne: one.runOne, git: one.git });
  assert.deepStrictEqual(r.failingFiles, ['tests/a.test.js']);
  assert.ok(!r.attributable.some((f) => f !== 'tests/a.test.js'), JSON.stringify(r.attributable));

  const alone = ['not ok 1 - env', '  at tests/env.test.js:2:1', '# tests 1', '# pass 0', '# fail 1', '# cancelled 0'].join('\n');
  const { p: p2, dir: dir2 } = logFile(alone);
  const two = fakes({ outcomes: {}, inCheckout: present });
  const r2 = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p2 }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir2, runOne: two.runOne, git: two.git });
  assert.strictEqual(r2.eligible, false);
  assert.match(r2.reason, /^absent-from-checkout: 1 failing entry names only paths absent from the checkout in tests$/);
  assert.deepStrictEqual(two.calls.runs, []);
});

// Final-review finding 2: the ineligible reason for the unmatched-entries
// branch (~baseline.js line 240) must say "absent from the checkout", not
// "no test file", when the only reason an entry's file was dropped is that
// `exists` rejected it — the entry DID name a test file, just one absent
// from this checkout.
test('#3153 finding 2: an unmatched entry naming only a path absent from the checkout is reported as absent-from-checkout, not unclassified', async () => {
  const tap = ['not ok 1 - a', "  location: '/repo/tests/a.test.js:1:1'",
    'not ok 2 - b', '  at tests/gone.test.js:2:1',
    '# tests 2', '# pass 0', '# fail 2', '# cancelled 0'].join('\n');
  const { p, dir } = logFile(tap);
  const present = (d, rel) => rel === 'tests/a.test.js';
  const { git, runOne, calls } = fakes({ outcomes: {}, inCheckout: present });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'absent-from-checkout: 1 failing entry names only paths absent from the checkout in tests');
  assert.deepStrictEqual(calls.runs, []);
});

test('#3153: realGit().inCheckout is true only for a relative path present under the given directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'baseline-incheckout-'));
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'tests', 'a.test.js'), '');
  const g = realGit(root);
  assert.strictEqual(g.inCheckout(root, 'tests/a.test.js'), true);
  assert.strictEqual(g.inCheckout(root, 'tests/gone.test.js'), false);
  assert.strictEqual(g.inCheckout(root, `${root.replace(/\\/g, '/')}/tests/a.test.js`), false, 'an absolute path is never inside');
  assert.strictEqual(g.inCheckout(path.join(root, 'tests'), '../tests/a.test.js'), false, 'a path climbing out is never inside');
  assert.strictEqual(g.inCheckout(path.join(root, 'tests'), 'x/../../tests/a.test.js'), false, 'an embedded `..` climbing out is never inside');
  assert.strictEqual(g.inCheckout(root, 'C:/repo/tests/a.test.js'), false);
});

// Final-review finding 3: `at(dir)` (adjudicate's own helper) must read each
// log against its OWN checkout — the base log against the scratch worktree,
// the HEAD log against the real checkout — never one dir for both. Pin both
// halves: the dirs an `inCheckout` predicate is actually called with, and
// that a predicate scoped to only one of the two dirs blocks classification.
test('#3153: each log is read against its own checkout — a predicate scoped to only one dir blocks classification', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const dirsSeen = new Set();
  const bothDirs = (d, rel) => { dirsSeen.add(d); return (d === '/repo' || d === '/scratch') && rel === 'tests/a.test.js'; };
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 }, inCheckout: bothDirs });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.ok(dirsSeen.has('/repo'), 'the HEAD log must be read against /repo');
  assert.ok(dirsSeen.has('/scratch'), 'the base log must be read against /scratch');
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);

  // A predicate scoped only to /repo would drop the base log's own entries
  // against /scratch — no base evidence — were `at(baseDir)` ever called as
  // `at(headDir)`. (Demonstrated by reasoning, per the brief, rather than by
  // editing baseline.js to prove it: `at(headDir)`'s `exists` always resolves
  // `/repo`, so the base run's `tests/a.test.js` would still pass `exists`
  // even though this predicate rejects `/scratch` — masking the very bug
  // this test pins.)
  const { p: p2, dir: dir2 } = logFile(SPEC(['tests/a.test.js']));
  const onlyRepo = (d, rel) => d === '/repo' && rel === 'tests/a.test.js';
  const { git: git2, runOne: runOne2 } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/a.test.js': 1 }, inCheckout: onlyRepo });
  const r2 = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p2 }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir2, runOne: runOne2, git: git2 });
  assert.deepStrictEqual(r2.baselineFailing, []);
});

// #3313: `fixed` — files failing in a full run at base but not at HEAD. The
// failing check carries a `command`; its one full run at base is keyed
// `base-full:{command}` in `outcomes`/`logs`.
const adjudicateFixed = async (headFiles, { fakeOpts = {}, check = {}, extra = {} } = {}) => {
  const { p, dir } = logFile(SPEC(headFiles));
  const f = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'base-full:npm test': 1 }, ...fakeOpts });
  const checks = [{ name: 'tests', command: 'npm test', exitCode: 1, logPath: p, ...check }];
  const r = await adjudicate({ checks, baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne: f.runOne, git: f.git, ...extra });
  return { r, calls: f.calls };
};

test('fixed: a file failing in the base full run but not at HEAD is fixed; new mirrors attributable (#3313 AC2.1)', async () => {
  const { r, calls } = await adjudicateFixed(['tests/a.test.js'], {
    fakeOpts: { logs: { 'base-full:npm test': SPEC(['tests/a.test.js', 'tests/fixed.test.js']) } },
  });
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.fixed, ['tests/fixed.test.js'], 'a.test.js fails at HEAD too, so only fixed.test.js is fixed');
  assert.deepStrictEqual(r.new, []);
  assert.strictEqual(r.new, r.attributable);
  assert.strictEqual('fixedReason' in r, false);
  const full = calls.runs.filter((c) => c.kind === 'base-full');
  assert.deepStrictEqual(full.map((c) => c.cwd), ['/scratch'], 'one full run, in the scratch worktree');
});

test('fixed: no proven base failure skips the base full run (#3313)', async () => {
  const { r, calls } = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { outcomes: { 'baseline:tests/a.test.js': 0, 'isolated:tests/a.test.js': 1 } } });
  assert.deepStrictEqual(r.attributable, ['tests/a.test.js']);
  assert.strictEqual(r.fixed, null);
  assert.strictEqual(r.fixedReason, 'no failing file classified baseline — base full run skipped');
  assert.deepStrictEqual(r.new, ['tests/a.test.js']);
  assert.ok(!calls.runs.some((c) => c.kind === 'base-full'), 'no base-full run');
});

test('fixed: computeFixed:false skips the base full run even with a proven base failure (#3313 --no-baseline-fixed)', async () => {
  const { r, calls } = await adjudicateFixed(['tests/a.test.js'], {
    fakeOpts: { logs: { 'base-full:npm test': SPEC(['tests/a.test.js', 'tests/fixed.test.js']) } },
    extra: { computeFixed: false },
  });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js'], 'a base failure was proven, so the default path would have run the base full run');
  assert.strictEqual(r.verdict, 'pass', 'the opt-out never changes the verdict');
  assert.strictEqual(r.fixed, null);
  assert.strictEqual(r.fixedReason, 'base full run disabled (--no-baseline-fixed)');
  assert.ok(!calls.runs.some((c) => c.kind === 'base-full'), 'no base-full run');
});

test('fixed: a timed-out base full run is fixed:null and never changes the verdict (#3313)', async () => {
  const { r } = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { outcomes: { 'baseline:tests/a.test.js': 1, 'base-full:npm test': { exitCode: null, timedOut: true } } } });
  assert.strictEqual(r.fixed, null);
  assert.match(r.fixedReason, /^tests base full run exited without a numeric code \(timed out\)$/);
  assert.strictEqual(r.verdict, 'pass');
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
});

test('fixed: a check with no command, or a base full log that proves nothing, is fixed:null with the reason (#3313)', async () => {
  const noCmd = await adjudicateFixed(['tests/a.test.js'], { check: { command: undefined } });
  assert.strictEqual(noCmd.r.fixed, null);
  assert.strictEqual(noCmd.r.fixedReason, 'tests has no command to run at base');
  assert.ok(!noCmd.calls.runs.some((c) => c.kind === 'base-full'));
  const unaccounted = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { logs: { 'base-full:npm test': 'garbage' } } });
  assert.strictEqual(unaccounted.r.fixed, null);
  assert.match(unaccounted.r.fixedReason, /^tests base full run log does not account for its failures — see .*tests-base-full\.log$/);
  assert.strictEqual(unaccounted.r.verdict, 'pass');
});

test('fixed: an unreadable base full log, or one that ran no tests, is fixed:null naming its log path (#3313)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const f = fakes({ outcomes: { 'baseline:tests/a.test.js': 1, 'base-full:npm test': 1 } });
  const lostLog = async (o) => { const r = await f.runOne(o); return o.name.endsWith('-base-full') ? { ...r, logPath: `${r.logPath}.missing` } : r; };
  const run = (runOne) => adjudicate({ checks: [{ name: 'tests', command: 'npm test', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git: f.git });
  const unreadable = await run(lostLog);
  assert.strictEqual(unreadable.fixed, null);
  assert.match(unreadable.fixedReason, /^tests base full run log unreadable — see .*tests-base-full\.log\.missing$/);
  assert.strictEqual(unreadable.verdict, 'pass');
  const noTests = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { logs: { 'base-full:npm test': 'ℹ tests 0\nℹ pass 0\nℹ fail 0\nℹ cancelled 0' } } });
  assert.strictEqual(noTests.r.fixed, null);
  assert.match(noTests.r.fixedReason, /^tests base full run ran no tests — see .*tests-base-full\.log$/);
  assert.strictEqual(noTests.r.verdict, 'pass');
});

// A base full log failing a.test.js plus a file that cannot load (file-level).
const BASE_FULL_WITH_LOAD_FAILURE = ['ℹ tests 9', 'ℹ pass 7', 'ℹ fail 2', 'ℹ cancelled 0', '', '✖ failing tests:', '',
  'test at tests/a.test.js:1:1', '✖ x (1ms)', '', 'test at tests/fixed.test.js:1:1', '✖ tests/fixed.test.js (12ms)', "  'test failed'", ''].join('\n');

test('fixed: a file-level base failure is not fixed when HEAD resolves dependencies (#3313)', async () => {
  const logs = { 'base-full:npm test': BASE_FULL_WITH_LOAD_FAILURE };
  const resolving = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { logs }, extra: { env: { NODE_PATH: '/x' } } });
  assert.deepStrictEqual(resolving.r.fixed, [], 'a load failure in a scratch worktree may only be a missing install');
  const bare = await adjudicateFixed(['tests/a.test.js'], { fakeOpts: { logs }, extra: { env: {} } });
  assert.deepStrictEqual(bare.r.fixed, ['tests/fixed.test.js'], 'with no dependencies resolved at HEAD, the load failure at base is genuine');
});

test('fixed: a base-failing file absent at HEAD is not fixed (#3313)', async () => {
  const { r } = await adjudicateFixed(['tests/a.test.js'], {
    fakeOpts: {
      logs: { 'base-full:npm test': SPEC(['tests/a.test.js', 'tests/gone.test.js', 'tests/fixed.test.js']) },
      inCheckout: (dir, rel) => !(dir === '/repo' && rel === 'tests/gone.test.js'),
    },
  });
  assert.deepStrictEqual(r.fixed, ['tests/fixed.test.js']);
});

test('a failing path the retry template cannot quote is ineligible, never run (#3676)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a b.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: {} });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: new Map([['tests', "NODE_OPTIONS='--x' node --test {file}"]]), base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git, platform: 'linux' });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests failing file tests/a b.test.js cannot be handed to the shell safely (template-quotes)');
  assert.strictEqual(calls.runs.length, 0);
  assert.strictEqual(calls.added.length, 0);
});

test('a failing path with a leading dash is ineligible, never run (#3676)', async () => {
  const { p, dir } = logFile(SPEC(['-x.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: {} });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git, platform: 'linux' });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.reason, 'tests failing file -x.test.js cannot be handed to the shell safely (leading-dash)');
  assert.strictEqual(calls.runs.length, 0);
});

test('adjudicate hands its platform to the path quoting — a win32 percent path is refused where linux quotes it (#3676)', async () => {
  const { p, dir } = logFile(SPEC(['tests/%PATH%.test.js']));
  const run = (platform) => {
    const { git, runOne } = fakes({ outcomes: {} });
    return adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git, platform });
  };
  const win = await run('win32');
  assert.strictEqual(win.eligible, false);
  assert.strictEqual(win.reason, 'tests failing file tests/%PATH%.test.js cannot be handed to the shell safely (cmd-unquotable)');
  assert.notStrictEqual((await run('linux')).eligible, false, 'the same path quotes fine on linux');
});

test('a quotable spaced failing path reaches the run stage as the quoted command (#3676)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a b.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: {} });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'origin/main', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git, platform: 'linux' });
  assert.notStrictEqual(r.eligible, false, 'a quotable path is not refused');
  assert.ok(calls.runs.length > 0, 'the adjudication reached the run stage');
  assert.ok(calls.runs.every((c) => c.file === "'tests/a b.test.js'"), 'every run got the single-quoted path');
});
