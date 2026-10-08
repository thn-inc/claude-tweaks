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

// outcomes: { 'baseline:tests/a.test.js': 1, 'isolated:tests/b.test.js': 0, ... } — exit code per (kind, file)
function fakes({ outcomes, existsAtBase = () => true, throwOn = null }) {
  const calls = { runs: [], added: [], removed: [] };
  const git = {
    repoRoot: () => '/repo',
    fileExistsAt: (sha, f) => existsAtBase(f),
    addWorktree: (sha) => { calls.added.push(sha); return '/scratch'; },
    removeWorktree: (dir) => { calls.removed.push(dir); },
  };
  const runOne = async ({ name, command, cwd }) => {
    const kind = name.includes('-baseline-') ? 'baseline' : 'isolated';
    const file = command.replace('node --test ', '');
    calls.runs.push({ kind, file, cwd });
    if (throwOn && throwOn === `${kind}:${file}`) throw new Error('boom');
    const code = outcomes[`${kind}:${file}`];
    return { name, command, exitCode: code === undefined ? 1 : code, durationMs: 1, logPath: 'x' };
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

test('passing checks are ignored — only failed ones are adjudicated (#3043)', async () => {
  const { p, dir } = logFile(SPEC(['tests/a.test.js']));
  const { git, runOne } = fakes({ outcomes: { 'baseline:tests/a.test.js': 1 } });
  const r = await adjudicate({ checks: [{ name: 'lint', exitCode: 0, logPath: 'unused' }, { name: 'tests', exitCode: 1, logPath: p }], baselineCmds: tmpl, base: 'x', baseSha: 'b'.repeat(40), cwd: '/repo', logDir: dir, runOne, git });
  assert.strictEqual(r.verdict, 'pass');
});
