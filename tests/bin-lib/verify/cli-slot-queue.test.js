'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { slotEnv } = require('../../helpers/suite-slot-env');
const { slotScratchPath } = require('../../../plugin/bin/lib/verify/baseline');
const { tmpDir, runCli, tmpGitRepo, nodeCmd, scopedRepo, commitFile, anchoredRunDir, baselineRepo, PER_FILE, headCommit, RUN_TESTS, reportAt, withoutWait, pause } = require('./cli-helpers');

// ---- #5119: the machine-wide suite slot. Each test below builds its child env with slotEnv(),
// which strips the CT_TEST_SUITE_SLOT_HELD=1 this suite's runner sets and points
// CT_TEST_SUITE_SLOT_DIR at the test's own temp dir. Every cli*.test.js test outside it inherits
// HELD=1, so its runs take no slot, exactly as before. ----

// Holds `dir`'s full-lane slot-0.lock as this (live) test process, naming `cwd`.
function holdLock(dir, cwd = '/holder-cwd') {
  const lock = path.join(dir, 'slot-0.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), cwd }));
  return lock;
}
// Resolves once a waiter's queue ticket shows in `dir`'s full lane, plus a margin for it to try the
// slot and log its waiting line.
async function waitForQueued(dir, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.readdirSync(dir).some((n) => /^ticket-\d+\.json$/.test(n))) {
    if (Date.now() > deadline) throw new Error(`no run queued in ${dir} within ${timeoutMs} ms`);
    await pause(50);
  }
  await pause(500);
}

test('AC5.1: a scoped failing --baseline run\'s adjudication waits for a full-lane slot its subset-lane checks never queued for (#5119)', async () => {
  // A tool-scoped declaration (its tests command takes {base}) over baselineRepo()'s failing-at-base
  // suite: after one full pass anchors the stamp, a change runs tool-scoped — a subset-lane
  // command — and fails into adjudication.
  const r = baselineRepo();
  const trunk = r.git('symbolic-ref', '--short', 'HEAD').trim();
  commitFile(r, 'scripts/suite.js', "const r = require('child_process').spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/env.test.js', 'tests/ok.test.js'], { stdio: 'inherit' });\nprocess.exit(r.status === null ? 1 : r.status);\n");
  commitFile(r, '.claude-tweaks/verify-scope.json', JSON.stringify({
    checks: { tests: 'node scripts/suite.js {base}' },
    retry: { tests: PER_FILE.slice('tests='.length) },
    rules: [{ match: '**', suites: [], static: false }],
  }));
  r.git('checkout', '-q', '-b', 'feature');
  const scope = ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', trunk];
  const anchor = await runCli([...scope, '--cmd', 'tests=node -e 0'], r.opts);
  assert.strictEqual(anchor.code, 0, anchor.stdout + anchor.stderr);
  commitFile(r, 'src/a.js', 'module.exports = 1;\n');
  const dir = tmpDir();
  const lock = holdLock(dir);
  // A slot-holding child writes its scratch under os.tmpdir(): give it a private one (#5150).
  const t = tmpDir();
  const run = runCli([...scope, '--baseline', trunk, '--no-stamp'], { cwd: r.repo, env: slotEnv(dir, { TMPDIR: t, TMP: t, TEMP: t }) });
  await waitForQueued(dir);
  const releasedAt = Date.now();
  fs.unlinkSync(lock);
  const res = await run;
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const report = reportAt(r);
  assert.strictEqual(report.scope.mode, 'tool-scoped');
  assert.strictEqual(report.slot.lane, 'subset');
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(withoutWait(report.baselineAdjudicated.slot), { lane: 'full', index: 0, slots: 1, source: 'default' });
  assert.deepStrictEqual(report.baselineAdjudicated.scratch, {
    path: path.join(fs.realpathSync(t), path.relative(t, slotScratchPath({
      tmpdir: t, commonDir: fs.realpathSync.native(path.join(r.repo, '.git')), slotBase: fs.realpathSync.native(dir), slot: 0,
    }))),
    reused: false,
  });
  assert.ok(!fs.readdirSync(t).some((n) => n.startsWith('ct-verify-base-')), fs.readdirSync(t).join(', '));
  const logDir = path.join(r.gitDir, 'claude-tweaks-verify');
  const mtime = (f) => fs.statSync(path.join(logDir, f)).mtimeMs;
  const adjLogs = fs.readdirSync(logDir).filter((f) => /^tests-(baseline|isolated)-.*\.log$/.test(f));
  assert.ok(adjLogs.length > 0, fs.readdirSync(logDir).join(', '));
  // 50 ms of slack for a filesystem clock coarser than Date.now(); the poll interval is 2 s.
  assert.ok(Math.min(...adjLogs.map(mtime)) >= releasedAt - 50, 'every adjudication log was last written after the release (an mtime is a last-write time, not a spawn time; the queued ticket waitForQueued saw is what shows adjudication waited)');
  assert.ok(mtime('tests.log') < releasedAt, 'the checks ran before the release');
});

test('AC4.2: a scoped selection whose suite runs its declared full command takes the full lane (#5119)', async () => {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: false },
    { match: 'docs/**', suites: [], static: false },
  ]);
  const args = ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
  const anchor = await runCli(args, { cwd: r.repo });
  assert.strictEqual(anchor.code, 0, anchor.stderr);
  commitFile(r, 'src/a.js', '1');
  const run = await runCli(args, { cwd: r.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  const report = reportAt(r);
  assert.strictEqual(report.scope.mode, 'scoped');
  assert.strictEqual(report.slot.lane, 'full');
});

test('AC6.1, AC6.2, AC6.3: the slot count comes from the declaration, then --default-suite-slots, then 1 — each named in report.json slot.source (#5119)', async () => {
  const flag = tmpGitRepo();
  assert.strictEqual((await runCli(['--cmd', 'tests=node -e 0', '--default-suite-slots', '3'], { cwd: flag.repo, env: slotEnv(tmpDir()) })).code, 0);
  assert.deepStrictEqual(withoutWait(reportAt(flag).slot), { lane: 'full', index: 0, slots: 3, source: 'flag' });

  const declared = scopedRepo([{ match: '**', suites: '*', static: true }], { concurrency: { suiteSlots: 2 } });
  const scoped = await runCli(['--scope', declared.declPath, '--integration-branch', declared.branch, '--cmd', `unit=${declared.unitCmd}`, '--cmd', 'other=node -e 0', '--default-suite-slots', '3'], { cwd: declared.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(scoped.code, 0, scoped.stdout + scoped.stderr);
  assert.deepStrictEqual(withoutWait(reportAt(declared).slot), { lane: 'full', index: 0, slots: 2, source: 'declaration' });

  // Without --scope, only the default declaration's concurrency block is read.
  const unscoped = await runCli(['--cmd', 'tests=node -e 0', '--default-suite-slots', '3'], { cwd: declared.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(unscoped.code, 0, unscoped.stdout + unscoped.stderr);
  assert.deepStrictEqual(withoutWait(reportAt(declared).slot), { lane: 'full', index: 0, slots: 2, source: 'declaration' });

  const neither = tmpGitRepo();
  assert.strictEqual((await runCli(['--cmd', 'tests=node -e 0'], { cwd: neither.repo, env: slotEnv(tmpDir()) })).code, 0);
  assert.deepStrictEqual(withoutWait(reportAt(neither).slot), { lane: 'full', index: 0, slots: 1, source: 'default' });
});

test('an invalid default declaration\'s concurrency falls back with one stderr line (#5119)', async () => {
  const r = tmpGitRepo();
  commitFile(r, '.claude-tweaks/verify-scope.json', JSON.stringify({
    checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], concurrency: { suiteSlots: 0 },
  }));
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  assert.strictEqual(reportAt(r).slot.source, 'default');
  const lines = run.stderr.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, run.stderr);
  assert.match(lines[0], /^verify\.js: concurrency ignored — .*concurrency\.suiteSlots/);

  // Every real skill call passes --default-suite-slots: the invalid declaration falls back to the flag, not to 1.
  const flagged = await runCli(['--cmd', 'tests=node -e 0', '--default-suite-slots', '3'], { cwd: r.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(flagged.code, 0, flagged.stdout + flagged.stderr);
  assert.deepStrictEqual(withoutWait(reportAt(r).slot), { lane: 'full', index: 0, slots: 3, source: 'flag' });
  assert.match(flagged.stderr, /^verify\.js: concurrency ignored — /);
});

test('a nested run (CT_TEST_SUITE_SLOT_HELD=1) never reads the default declaration\'s concurrency, so an invalid one prints no line (#5119)', async () => {
  const r = tmpGitRepo();
  commitFile(r, '.claude-tweaks/verify-scope.json', JSON.stringify({
    checks: { tests: 'npm test' }, rules: [{ match: '**', suites: '*', static: false }], concurrency: { suiteSlots: 0 },
  }));
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(tmpDir(), { CT_TEST_SUITE_SLOT_HELD: '1' }), timeout: 60000 });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  assert.doesNotMatch(run.stderr, /concurrency ignored/);
});

test('a lock dir verify.js cannot use exits 2 with one named line, never 1 as if a check failed (#5119)', async () => {
  const r = tmpGitRepo();
  const notADir = path.join(tmpDir(), 'slots');
  fs.writeFileSync(notADir, '');
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(notADir), timeout: 60000 });
  assert.strictEqual(run.code, 2, run.stdout + run.stderr);
  const lines = run.stderr.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, run.stderr);
  assert.match(lines[0], /^verify\.js: suite slot unavailable — \S/);
  assert.strictEqual(lines[0].split('suite slot unavailable').length, 2, `named once, never doubled: ${lines[0]}`);
});

// A check (holding its own slot) that leaves a directory named like a queue ticket in the full lane,
// so the next full-lane acquire there fails reading it: the lock dir is unusable at adjudication.
test('--baseline: a lock dir unusable at adjudication is recorded as not adjudicated, naming "suite slot unavailable" (#5119)', async () => {
  const r = baselineRepo();
  headCommit(r);
  const dir = tmpDir();
  const script = path.join(tmpDir(), 'suite.js');
  fs.writeFileSync(script, [
    "const fs = require('fs');",
    "const path = require('path');",
    "fs.mkdirSync(path.join(process.env.CT_TEST_SUITE_SLOT_DIR, 'ticket-1.json'));",
    "const r = require('child_process').spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/env.test.js', 'tests/ok.test.js'], { stdio: 'inherit' });",
    'process.exit(r.status === null ? 1 : r.status);',
  ].join('\n'));
  const run = await runCli(['--cmd', `tests=node "${script}"`, '--baseline', r.baseSha, '--baseline-cmd', PER_FILE], {
    cwd: r.repo, env: slotEnv(dir), timeout: 60000,
  });
  assert.strictEqual(run.code, 1, run.stdout + run.stderr);
  const adj = reportAt(r).baselineAdjudicated;
  assert.strictEqual(adj.eligible, false, JSON.stringify(adj));
  assert.match(adj.reason, /^adjudication error: suite slot unavailable — \S/);
  assert.ok(!('slot' in adj), 'no adjudication slot was taken');
});

test('--baseline: an adjudication refused on sight never queues for the full-lane slot a live sibling holds (#5119)', async () => {
  const r = tmpGitRepo();
  const base = r.git('rev-parse', 'HEAD').trim();
  r.git('commit', '-q', '--allow-empty', '-m', 'head');
  const dir = tmpDir();
  holdLock(dir);
  // types/lint alone take the subset lane; the failing lint has no --baseline-cmd, so adjudication
  // is ineligible before any rerun could spawn. Were it to queue for the held full-lane slot, the
  // run would hang into the spawn timeout.
  const run = await runCli(['--cmd', `types=${nodeCmd('0')}`, '--cmd', `lint=${nodeCmd('process.exit(1)')}`, '--baseline', base, '--baseline-cmd', 'types=node -e 0 {file}'], {
    cwd: r.repo, env: slotEnv(dir), timeout: 60000,
  });
  assert.strictEqual(run.code, 1, run.stdout + run.stderr);
  const report = reportAt(r);
  assert.strictEqual(report.slot.lane, 'subset');
  assert.strictEqual(report.baselineAdjudicated.eligible, false);
  assert.strictEqual(report.baselineAdjudicated.reason, 'no --baseline-cmd for failing check lint');
  assert.ok(!('slot' in report.baselineAdjudicated), 'no adjudication slot was taken');
  assert.ok(!fs.readdirSync(dir).some((n) => /^ticket-\d+\.json$/.test(n)), 'nothing queued in the full lane');
  assert.doesNotMatch(run.stderr, /waiting for a test-suite slot/);
});

test('a check that runs tools/run-tests.js under the held slot skips the lock instead of waiting on its own parent (#5119 nested deadlock)', async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const root = tmpDir();
  fs.writeFileSync(path.join(root, 'nested.test.js'), "require('node:test')('nested', () => {});\n");
  // A private TMPDIR, as AC3.1 does, so the nested runner's startup sweep never scans the real one.
  const childTmp = tmpDir();
  const run = await runCli(['--cmd', `tests=node "${RUN_TESTS}" "${root}"`], {
    cwd: r.repo, env: slotEnv(dir, { TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp }), timeout: 60000,
  });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  const report = reportAt(r);
  assert.deepStrictEqual(withoutWait(report.slot), { lane: 'full', index: 0, slots: 1, source: 'default' }, 'the parent held the one full-lane slot');
  assert.strictEqual(report.checks.tests.exitCode, 0);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'the nested runner took no slot and left no ticket');
});

test('AC7.1: a run started with CT_TEST_SUITE_SLOT_HELD=1 takes no slot (#5119)', async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  holdLock(dir);
  const run = await runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(dir, { CT_TEST_SUITE_SLOT_HELD: '1' }), timeout: 60000 });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  assert.ok(!('slot' in reportAt(r)));
  assert.deepStrictEqual(fs.readdirSync(dir), ['slot-0.lock'], 'no ticket and no other slot was taken');
});

test('AC7.2: a check spawned under a held slot sees CT_TEST_SUITE_SLOT_HELD=1 and a positive CT_TEST_WORKERS (#5119)', async () => {
  const r = tmpGitRepo();
  const out = path.join(tmpDir(), 'env.txt');
  const cmd = nodeCmd("require('fs').writeFileSync(process.argv[1], process.env.CT_TEST_SUITE_SLOT_HELD + ' ' + process.env.CT_TEST_WORKERS)", out);
  const run = await runCli(['--cmd', `tests=${cmd}`], { cwd: r.repo, env: slotEnv(tmpDir()) });
  assert.strictEqual(run.code, 0, run.stdout + run.stderr);
  const [held, workers] = fs.readFileSync(out, 'utf8').split(' ');
  assert.strictEqual(held, '1');
  assert.match(workers, /^[1-9]\d*$/);
});

test('AC8.1: a waiting run prints one stderr line naming the holder and how to raise the limit (#5119)', async () => {
  const r = tmpGitRepo();
  const dir = tmpDir();
  const lock = holdLock(dir, '/holder-cwd');
  const run = runCli(['--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(dir) });
  await waitForQueued(dir);
  await pause(2500); // past one more 2 s poll: the line is printed once per wait, not once per poll
  fs.unlinkSync(lock);
  const res = await run;
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const lines = res.stderr.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, res.stderr);
  assert.match(lines[0], new RegExp(`^verify\\.js \\[full lane\\]: waiting for a test-suite slot — held by pid ${process.pid} \\(cwd \\/holder-cwd\\)`));
  assert.ok(lines[0].includes('concurrency.suiteSlots') && lines[0].includes('verify-suite-slots'), lines[0]);
  assert.ok(reportAt(r).slot.waitedMs >= 2500);
});

test('the verify event carries the run\'s total slot queue wait as slotWaitedMs, so the timing budget can count work only (#5119)', async () => {
  const r = tmpGitRepo();
  const runDir = anchoredRunDir(r.repo);
  const dir = tmpDir();
  const lock = holdLock(dir);
  const run = runCli(['--run', runDir, '--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: r.repo, env: slotEnv(dir) });
  await waitForQueued(dir);
  fs.unlinkSync(lock);
  const res = await run;
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const report = reportAt(r);
  const ev = JSON.parse(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').pop());
  assert.ok(report.slot.waitedMs > 0, JSON.stringify(report.slot));
  assert.strictEqual(ev.slotWaitedMs, report.slot.waitedMs, 'the one hold\'s wait');
  assert.strictEqual(ev.durationMs, report.durationMs, 'durationMs stays wall-clock, wait included');
  assert.ok(ev.durationMs >= ev.slotWaitedMs);

  const unheld = tmpGitRepo();
  const unheldRun = anchoredRunDir(unheld.repo);
  assert.strictEqual((await runCli(['--run', unheldRun, '--no-stamp', '--cmd', 'tests=node -e 0'], { cwd: unheld.repo })).code, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(unheldRun, 'events.jsonl'), 'utf8').trim()).slotWaitedMs, 0, 'no slot taken, no wait');
});
