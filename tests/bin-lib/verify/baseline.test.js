'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { adjudicate } = require('../../../plugin/bin/lib/verify/baseline');

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
});

test('a failing file absent at base skips the base run and is attributable unless it passes in isolation (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/new.test.js']));
  const { git, runOne, calls } = fakes({ outcomes: { 'isolated:tests/new.test.js': 1 }, existsAtBase: () => false });
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.deepStrictEqual(r.attributable, ['tests/new.test.js']);
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
  const r = await adjudicate({ checks: [{ name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: path.join(os.tmpdir(), 'baseline-no-such-repo-root'), logDir: dir, runOne, git });
  assert.deepStrictEqual(r.baselineFailing, ['tests/a.test.js']);
  assert.strictEqual(r.verdict, 'pass');
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
