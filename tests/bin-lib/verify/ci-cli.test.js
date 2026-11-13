'use strict';
// #4347: verify.js taking a declared suite's full-run verdict from the PR's CI
// job on HEAD. `gh` is a fake script first on PATH — the runner seam's real
// spawn, never the network. POSIX only: a PATH shim named `gh` is not
// spawnable by execFileSync on win32 (no .exe/.cmd), and ci-source.test.js
// covers the same branches through the injected runner on every platform.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile, execFileSync, spawn, spawnSync } = require('child_process');

const { slotEnv } = require('../../helpers/suite-slot-env');
const { anchoredRunDir } = require('./cli-helpers');
const { derivePhases } = require('../../../plugin/bin/lib/timing/derive');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'verify.js');
const SKIP = process.platform === 'win32' ? 'a PATH shim named gh is not spawnable on win32' : false;

function tmpDir() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-ci-test-'))); }

const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (process.env.FAKE_GH_CALLS) fs.appendFileSync(process.env.FAKE_GH_CALLS, a.join(' ') + '\\n');
const ep = a[1] || '';
const mode = process.env.FAKE_GH_MODE;
const out = (v) => process.stdout.write(JSON.stringify(v));
let m;
if ((m = ep.match(/commits\\/([0-9a-f]{40})\\/pulls$/))) {
  if (mode === 'unpushed') { process.stderr.write('gh: No commit found for SHA: ' + m[1] + ' (HTTP 422)'); process.exit(1); }
  out(mode === 'nopr' ? [] : [{ number: 7, state: 'open', head: { sha: m[1] } }]);
}
else if (/pulls\\/7$/.test(ep)) out({ number: 7, mergeable_state: 'clean' });
else if ((m = ep.match(/runs\\?head_sha=([0-9a-f]{40})/))) out({ workflow_runs: [{ id: 41, head_sha: m[1], status: 'completed', html_url: 'https://example.test/runs/41' }] });
else if (/runs\\/41\\/jobs/.test(ep)) out({ jobs: (process.env.FAKE_GH_JOBS || 'test').split(',').map((name) => ({ id: name === 'test' ? 99 : 98, name, status: 'completed', conclusion: mode === 'red' && !(process.env.FAKE_GH_GREEN || '').split(',').includes(name) ? 'failure' : 'success', started_at: '2026-10-25T17:27:00Z', completed_at: '2026-10-25T17:30:30Z', html_url: 'https://example.test/job/' + (name === 'test' ? 99 : 98) })) });
else if (/jobs\\/(99|98)\\/logs$/.test(ep)) {
  const flagged = a.includes('--allow-escape-sequences');
  const logMode = process.env.FAKE_GH_LOG;
  if (logMode === 'gone') { process.stderr.write('HTTP 410: Gone'); process.exit(1); }
  if (logMode === 'old' && flagged) { process.stderr.write('unknown flag: --allow-escape-sequences'); process.exit(1); }
  if (!logMode && !flagged) { process.stderr.write('the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway'); process.exit(1); }
  process.stdout.write(fs.readFileSync(process.env.FAKE_GH_LOG_FILE, 'utf8'));
}
else { process.stderr.write('unexpected gh ' + a.join(' ')); process.exit(1); }
`;

function fakeGhEnv(mode, logFile, extra = {}) {
  const bin = tmpDir();
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  const calls = path.join(tmpDir(), 'calls.txt');
  // CT_TEST_SUITE_SLOT_HELD=1 (#5119): the child skips the machine-wide suite slot exactly as under
  // tools/run-tests.js, so a direct `node --test` of this file never queues on the real lock;
  // withSlots() strips it again for the tests that exercise the slot.
  const env = {
    ...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
    FAKE_GH_MODE: mode, FAKE_GH_CALLS: calls, FAKE_GH_LOG_FILE: logFile || '', CT_TEST_SUITE_SLOT_HELD: '1', ...extra,
  };
  delete env.NODE_TEST_CONTEXT;
  return { env, calls };
}

function runCli(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { maxBuffer: 10 * 1024 * 1024, cwd, env },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// A repo whose base commit carries a test failing for an environment reason,
// and a HEAD commit adding the declaration (with or without a ci block).
function repoWith({ ci = true, extraFiles = {}, declExtra = {} } = {}) {
  const repo = tmpDir();
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 'verify-test@example.invalid');
  git('config', 'user.name', 'verify test');
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'tests', 'env.test.js'), "require('node:test')('env', () => { throw new Error('env-specific'); });\n");
  fs.writeFileSync(path.join(repo, 'tests', 'ok.test.js'), "require('node:test')('ok', () => {});\n");
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD').trim();
  const decl = {
    checks: { tests: 'npm test' },
    retry: { tests: 'node --test --test-reporter=tap {file}' },
    rules: [{ match: '**', suites: '*', static: false }],
    ...(ci ? { ci: { tests: { workflow: 'test.yml', job: 'test', waitSeconds: 5, pollSeconds: 1 } } } : {}),
    ...declExtra,
  };
  fs.mkdirSync(path.join(repo, '.claude-tweaks'));
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'verify-scope.json'), JSON.stringify(decl));
  for (const [rel, body] of Object.entries(extraFiles)) fs.writeFileSync(path.join(repo, rel), body);
  git('add', '.');
  git('commit', '-q', '-m', 'head');
  const branch = git('symbolic-ref', '--short', 'HEAD').trim();
  return { repo, git, baseSha, branch, gitDir: path.join(repo, '.git') };
}

// The CI job's log for `files`: a real TAP run in the repo, every line
// timestamp-prefixed and the checkout root spelled as the runner's.
function ciLogOf(r, files) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: r.repo, encoding: 'utf8', env });
  const text = run.stdout.split(r.repo).join('/home/runner/work/proj/proj');
  const file = path.join(tmpDir(), 'job.log');
  fs.writeFileSync(file, text.split('\n').map((l) => `2026-10-25T17:28:00.1234567Z ${l}`).join('\n'));
  return file;
}

function markerCommand(marker) {
  return `node -e "require('fs').writeFileSync(process.argv[1], String(1))" "${marker}"`;
}
function localMarkerCmd(marker) {
  return `tests=${markerCommand(marker)}`;
}
const KEY = { localRuns: 'on-request' };

function ciRunDir(r) {
  fs.mkdirSync(path.join(r.gitDir, 'info'), { recursive: true });
  fs.appendFileSync(path.join(r.gitDir, 'info', 'exclude'), '.claude-tweaks/pipelines/\n');
  return anchoredRunDir(r.repo);
}
const eventsOf = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
function timingEntry(runDir) {
  const events = [{ type: 'skill_invoked', skill: 'claude-tweaks:test', ts: '2000-01-01T00:00:00.000Z' }, ...eventsOf(runDir)];
  return derivePhases({ events, now: new Date(Date.now() + 60000) }).phases.find((p) => p.phase === 'test').verify[0];
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const reportOf = (r) => readJson(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'));
const stampOf = (r) => readJson(path.join(r.gitDir, 'claude-tweaks-verify-pass.json'));

test('a green CI job on HEAD writes a full pass stamp with source ci and runs no local suite (#4347 AC1)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const marker = path.join(tmpDir(), 'ran-locally');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'the local suite must not run when CI answered');
  assert.match(res.stdout, /^CI: tests — taken from test\.yml \/ test run 41 on HEAD \(success, https:\/\/example\.test\/runs\/41\)$/m);
  const stamp = stampOf(r);
  assert.strictEqual(stamp.scope, 'full');
  assert.strictEqual(stamp.source, 'ci');
  assert.deepStrictEqual(stamp.ci, { tests: { runId: 41, runUrl: 'https://example.test/runs/41' } });
  const report = reportOf(r);
  assert.strictEqual(report.ci[0].used, true);
  assert.strictEqual(report.checks.tests.ci.runId, 41);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo, env })).stdout);
  assert.strictEqual(status.verifiedHead, true);
  assert.strictEqual(status.match, true);
  assert.strictEqual(status.source, 'ci');
});

test('a red CI run whose only failure is red at the fork point is a baseline pass, re-running only that file (#4347 AC2)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']));
  const marker = path.join(tmpDir(), 'ran-locally');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--baseline', r.baseSha, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'the local full suite must not run');
  const report = reportOf(r);
  assert.strictEqual(report.baselineAdjudicated.verdict, 'pass');
  assert.deepStrictEqual(report.baselineAdjudicated.failingFiles, ['tests/env.test.js']);
  assert.deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js']);
  const stamp = stampOf(r);
  assert.strictEqual(stamp.source, 'ci');
  assert.ok(stamp.baseline, 'an adjudicated CI pass keeps the baseline marker');
});

test('a red CI run with a real failure fails verification and names the failing test from the CI log (#4347 AC3)', { skip: SKIP }, async () => {
  const r = repoWith({ extraFiles: { 'tests/new.test.js': "require('node:test')('brand new check', () => { throw new Error('regressed'); });\n" } });
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/new.test.js', 'tests/ok.test.js']));
  const marker = path.join(tmpDir(), 'ran-locally');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 1, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker));
  assert.match(res.stdout, /### tests failing region/);
  assert.match(res.stdout, /brand new check/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'a failing run never stamps');
});

test('HEAD with no CI run to take falls back to the local full run and names why in report.json (#4347 AC4)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('nopr', '');
  const marker = path.join(tmpDir(), 'ran-locally');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(marker), 'the suite must run locally');
  assert.match(res.stdout, /^CI: tests — ran locally \(no-open-pr-at-head\)$/m);
  assert.strictEqual(reportOf(r).ci[0].fallback, 'no-open-pr-at-head');
  assert.strictEqual(stampOf(r).source, undefined, 'a local pass carries no source');
});

test('a dirty tree never takes CI, which never saw the edits — no gh call at all (#4347)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env, calls } = fakeGhEnv('green', '');
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok edited', () => {});\n");
  const marker = path.join(tmpDir(), 'ran-locally');
  await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.ok(fs.existsSync(marker));
  assert.strictEqual(reportOf(r).ci[0].fallback, 'dirty-tree');
  assert.ok(!fs.existsSync(calls), 'gh must not be called for a dirty tree');
});

test('without a ci block, report, stamp and stdout carry nothing new and gh is never called (#4347 AC5)', { skip: SKIP }, async () => {
  const r = repoWith({ ci: false });
  const { env, calls } = fakeGhEnv('green', '');
  const marker = path.join(tmpDir(), 'ran-locally');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(marker));
  assert.ok(!/^CI:/m.test(res.stdout));
  assert.ok(!('ci' in reportOf(r)));
  assert.ok(!('ci' in reportOf(r).checks.tests));
  const stamp = stampOf(r);
  assert.ok(!('source' in stamp) && !('ci' in stamp));
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo, env })).stdout);
  assert.ok(!('source' in status) && !('ci' in status));
  assert.ok(!fs.existsSync(calls));
});

test('AC7: a CI-answered run\'s verify event and timing entry carry ci and local: false (#5369)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const runDir = ciRunDir(r);
  const res = await runCli(['--run', runDir, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.deepStrictEqual(ev.ci, [{ suite: 'tests', used: true, fallback: null }]);
  assert.strictEqual(ev.local, false);
  assert.strictEqual(Object.hasOwn(ev, 'noVerdict'), false);
  const entry = timingEntry(runDir);
  assert.deepStrictEqual(entry.ci, ev.ci);
  assert.strictEqual(entry.local, false);
});

test('AC7: a suite that fell back to a local run records used: false and the named fallback (#5369)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('nopr', '');
  const runDir = ciRunDir(r);
  const res = await runCli(['--run', runDir, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.deepStrictEqual(ev.ci, [{ suite: 'tests', used: false, fallback: 'no-open-pr-at-head' }]);
});

test('AC7: a run with no ci block carries local but no ci key (#5369)', async () => {
  const r = repoWith({ ci: false });
  const runDir = ciRunDir(r);
  const { env } = fakeGhEnv('green', '');
  const res = await runCli(['--run', runDir, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--local', '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.strictEqual(ev.local, true);
  assert.strictEqual(Object.hasOwn(ev, 'ci'), false);
});

// #5119: the suite slot around CI-answered suites. slotEnv() strips the CT_TEST_SUITE_SLOT_HELD=1
// this suite's runner sets; the slot dir does not exist beforehand, so a run that never tried for a
// slot leaves it uncreated.
const withSlots = (env, dir) => slotEnv(dir, {}, env);

test('a green CI suite takes no slot (#5119)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const dir = path.join(tmpDir(), 'slots');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env: withSlots(env, dir) });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!('slot' in reportOf(r)));
  assert.strictEqual(fs.existsSync(dir), false, 'no slot was tried for');
});

test('a red CI suite with no local retry takes no slot (#5119)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']));
  const dir = path.join(tmpDir(), 'slots');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env: withSlots(env, dir) });
  assert.strictEqual(res.code, 1, res.stdout + res.stderr);
  assert.strictEqual(reportOf(r).checks.tests.retryDecision.retry, false);
  assert.ok(!('retrySlot' in reportOf(r).checks.tests), 'no retry hold, no retrySlot');
  assert.strictEqual(fs.existsSync(dir), false, 'no slot was tried for');
});

test('a red CI suite\'s local flaky retry runs under a held subset-lane slot (#5119)', { skip: SKIP }, async () => {
  const out = path.join(tmpDir(), 'held.txt');
  const r = repoWith({
    declExtra: {
      flaky: { files: ['tests/env.test.js'] },
      retry: { tests: `node -e "require('fs').writeFileSync(process.argv[1], String(process.env.CT_TEST_SUITE_SLOT_HELD))" "${out}" {file}` },
    },
  });
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']));
  const dir = path.join(tmpDir(), 'slots');
  const res = await runCli(['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env: withSlots(env, dir) });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const report = reportOf(r);
  assert.deepStrictEqual(report.checks.tests.flakyRetried, ['tests/env.test.js']);
  const { waitedMs, ...retrySlot } = report.checks.tests.retrySlot;
  assert.deepStrictEqual(retrySlot, { lane: 'subset', index: 0, slots: 1, source: 'default' }, 'the retry hold is recorded on the retried check');
  assert.ok(Number.isInteger(waitedMs), String(waitedMs));
  assert.ok(!('slot' in report), 'report.slot stays the checks hold\'s alone — no local check ran here');
  assert.strictEqual(fs.readFileSync(out, 'utf8'), '1', 'the retry ran with the slot held');
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'subset')), [], 'the subset-lane slot was taken and freed');
  assert.deepStrictEqual(fs.readdirSync(dir), ['subset'], 'never the full lane');
});

test('a SIGTERM during a CI-failed suite\'s local retry kills the retry and its forked grandchild, and frees its slot (#5119)', { skip: SKIP }, async () => {
  const out = path.join(tmpDir(), 'retry-pid.txt');
  const grandOut = path.join(tmpDir(), 'grandchild-pid.txt');
  // The retry forks a grandchild that ignores SIGTERM, so only the group kill after the grace reaches it.
  const script = path.join(tmpDir(), 'retry.js');
  fs.writeFileSync(script, [
    "const fs = require('fs');",
    "const { spawn } = require('child_process');",
    'const [out, grandOut] = process.argv.slice(2);',
    "const grand = \"process.on('SIGTERM', () => {}); require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);\";",
    "spawn(process.execPath, ['-e', grand, grandOut], { stdio: 'ignore', windowsHide: true });",
    'fs.writeFileSync(out, String(process.pid));',
    'setTimeout(() => {}, 30000);',
  ].join('\n'));
  const r = repoWith({
    declExtra: {
      flaky: { files: ['tests/env.test.js'] },
      retry: { tests: `node "${script}" "${out}" "${grandOut}" {file}` },
    },
  });
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']));
  const dir = path.join(tmpDir(), 'slots');
  const child = spawn(process.execPath, [CLI, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], {
    cwd: r.repo, env: withSlots(env, dir), stdio: 'ignore', timeout: 60000, killSignal: 'SIGKILL',
  });
  const exited = new Promise((resolve) => { child.on('exit', (c, s) => resolve([c, s])); });
  const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const pidIn = async (file) => {
    for (const deadline = Date.now() + 20000; Date.now() < deadline;) {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (/^\d+$/.test(text)) return Number(text);
      await pause(50);
    }
    return NaN;
  };
  const retryPid = await pidIn(out);
  const grandPid = await pidIn(grandOut);
  assert.ok(Number.isInteger(retryPid) && Number.isInteger(grandPid), 'the retry and its grandchild started');
  child.kill('SIGTERM');
  const [code] = await exited;
  const goneAfter = async (pid) => {
    for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
      try { process.kill(pid, 0); } catch (err) { if (err.code === 'ESRCH') return true; }
      await pause(50);
    }
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    return false;
  };
  const goneRetry = await goneAfter(retryPid);
  const goneGrand = await goneAfter(grandPid);
  assert.strictEqual(code, 143);
  assert.ok(goneRetry, `the retry (pid ${retryPid}) was killed, not orphaned`);
  assert.ok(goneGrand, `the retry's grandchild (pid ${grandPid}) was killed with its group, not orphaned`);
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'subset')), [], 'the subset-lane slot is freed');
});

// #5369: scoped runs under localRuns "on-request" — a CI-declared suite never runs on this machine without --local.
const SCOPE = (r) => ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch];
const ciOf = (jobName) => ({ workflow: 'test.yml', job: jobName, waitSeconds: 5, pollSeconds: 1 });
const TWO_SUITES = (otherMarker) => ({
  ...KEY,
  checks: { tests: { tests: 'npm test', other: markerCommand(otherMarker) } },
  ci: { tests: ciOf('test'), other: ciOf('other') },
});
const NO_VERDICT_FIRST = (suite, why) => `verify.js: no verdict yet for suite "${suite}" — CI could not answer (${why}), and the declaration's localRuns "on-request" keeps it off this machine; no check ran and no pass stamp was written.`;
const callLines = (calls) => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []);

test('AC1.1: under the key an unpushed HEAD exits 3 before any check, prints head-not-pushed and both ways on, writes no stamp (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('unpushed', '');
  const marker = path.join(tmpDir(), 'm');
  // A previous run's report must not survive an exit 3 (it would read as this run's answer).
  fs.mkdirSync(path.join(r.gitDir, 'claude-tweaks-verify'), { recursive: true });
  fs.writeFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), '{"pass":true}\n');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'no check may run');
  const [first, second, third] = res.stderr.split('\n');
  assert.strictEqual(first, NO_VERDICT_FIRST('tests', 'head-not-pushed'));
  assert.strictEqual(second, '  Either push the branch (commit first if the tree is dirty) so HEAD is the head of an open PR, then re-run this command,');
  assert.strictEqual(third, '  or re-run it with --local to run the suite on this machine.');
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json')), 'exit 3 writes no report and removes the stale one');
});

test('AC1.2: under the key a green CI job on HEAD is taken from CI and the suite never runs here (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'the suite must not run here');
  assert.strictEqual(stampOf(r).source, 'ci');
});

test('AC2.1: under the key --local makes no gh call and runs the suite here (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env, calls } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--local', '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(marker), 'the suite runs here');
  assert.ok(!fs.existsSync(calls), 'gh must not be called');
  assert.strictEqual(reportOf(r).ci[0].fallback, 'local-requested');
  assert.match(res.stdout, /^CI: tests — ran locally \(local-requested\)$/m);
});

test('AC4.1: without the key an unpushed HEAD still runs the suite here and exits 0 (#5369)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('unpushed', '');
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(marker), 'the suite must run here');
  assert.strictEqual(reportOf(r).ci[0].fallback, 'head-not-pushed');
});

test('AC6.1: under the key a suite with no ci source runs here without --local (#5369)', { skip: SKIP }, async () => {
  const testsMarker = path.join(tmpDir(), 'tests-m');
  const otherMarker = path.join(tmpDir(), 'other-m');
  const r = repoWith({
    declExtra: { ...KEY, checks: { tests: { tests: 'npm test', other: markerCommand(otherMarker) } } },
  });
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(testsMarker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(testsMarker), 'CI answered the ci-declared suite');
  assert.ok(fs.existsSync(otherMarker), 'the suite without a ci source runs here');
});

test('two CI suites under the key, the first unanswered: exit 3 names it, the second is not-consulted and never fetched (#5369)', { skip: SKIP }, async () => {
  const testsMarker = path.join(tmpDir(), 'tests-m');
  const otherMarker = path.join(tmpDir(), 'other-m');
  const r = repoWith({ declExtra: TWO_SUITES(otherMarker) });
  const { env, calls } = fakeGhEnv('unpushed', '');
  const runDir = ciRunDir(r);
  const res = await runCli(['--run', runDir, ...SCOPE(r), '--cmd', localMarkerCmd(testsMarker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.strictEqual(res.stderr.split('\n')[0], NO_VERDICT_FIRST('tests', 'head-not-pushed'));
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.deepStrictEqual(ev.ci, [
    { suite: 'tests', used: false, fallback: 'head-not-pushed' },
    { suite: 'other', used: false, fallback: 'not-consulted' },
  ]);
  assert.strictEqual(callLines(calls).length, 1, `only the first suite's one request was made: ${callLines(calls)}`);
  assert.ok(!fs.existsSync(testsMarker) && !fs.existsSync(otherMarker), 'neither suite ran here');
});

test('two CI suites under the key: the second unanswered one exits 3 naming it, neither runs here (#5369)', { skip: SKIP }, async () => {
  const testsMarker = path.join(tmpDir(), 'tests-m');
  const otherMarker = path.join(tmpDir(), 'other-m');
  const r = repoWith({ declExtra: TWO_SUITES(otherMarker) });
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(testsMarker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.strictEqual(res.stderr.split('\n')[0], NO_VERDICT_FIRST('other', 'ci-job-not-found'));
  assert.ok(!fs.existsSync(testsMarker) && !fs.existsSync(otherMarker), 'neither suite ran here');
});

test('a red first suite and an unanswered second suite under the key exit 3 before any local retry (#5369)', { skip: SKIP }, async () => {
  const build = (declKey) => {
    const retryMarker = path.join(tmpDir(), 'retry-m');
    const otherMarker = path.join(tmpDir(), 'other-m');
    const testsMarker = path.join(tmpDir(), 'tests-m');
    const r = repoWith({
      declExtra: {
        ...declKey,
        checks: { tests: { tests: 'npm test', other: markerCommand(otherMarker) } },
        ci: { tests: ciOf('test'), other: ciOf('other') },
        flaky: { files: ['tests/env.test.js'], maxRetries: 1 },
        retry: { tests: `${markerCommand(retryMarker)} {file}` },
      },
    });
    const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']));
    return { r, env, retryMarker, otherMarker, testsMarker };
  };
  const keyed = build(KEY);
  const res = await runCli([...SCOPE(keyed.r), '--cmd', localMarkerCmd(keyed.testsMarker)], { cwd: keyed.r.repo, env: keyed.env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.strictEqual(res.stderr.split('\n')[0], NO_VERDICT_FIRST('other', 'ci-job-not-found'));
  assert.ok(!fs.existsSync(keyed.retryMarker), 'no retry ran before the no-verdict exit');
  assert.ok(!fs.existsSync(keyed.testsMarker) && !fs.existsSync(keyed.otherMarker), 'neither suite ran here');
  // Control: without the key the identical repo reaches the in-loop retry.
  const plain = build({});
  await runCli([...SCOPE(plain.r), '--cmd', localMarkerCmd(plain.testsMarker)], { cwd: plain.r.repo, env: plain.env });
  assert.ok(fs.existsSync(plain.retryMarker), 'without the key the retry runs, so the fixture does reach it');
});

test('under the key a red CI suite\'s flaky retry runs after every suite answered, here, and is recorded (#5369)', { skip: SKIP }, async () => {
  const retryMarker = path.join(tmpDir(), 'retry-m');
  const otherMarker = path.join(tmpDir(), 'other-m');
  const r = repoWith({
    declExtra: {
      ...TWO_SUITES(otherMarker),
      flaky: { files: ['tests/env.test.js'], maxRetries: 1 },
      retry: { tests: `${markerCommand(retryMarker)} {file}` },
    },
  });
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/env.test.js', 'tests/ok.test.js']), { FAKE_GH_JOBS: 'test,other', FAKE_GH_GREEN: 'other' });
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(path.join(tmpDir(), 'tests-m'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.ok(fs.existsSync(retryMarker), 'the deferred retry ran');
  assert.strictEqual(reportOf(r).checks.tests.retryDecision.retry, true);
  assert.deepStrictEqual(reportOf(r).checks.tests.flakyRetried, ['tests/env.test.js']);
  assert.ok(!fs.existsSync(otherMarker), 'CI answered the second suite');
});

test('under the key a stale baseline worktree warning is printed after the no-verdict lines, never before (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('unpushed', '');
  const staleParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-')));
  r.git('worktree', 'add', '--detach', path.join(staleParent, 'wt'), 'HEAD');
  const res = await runCli([...SCOPE(r), '--baseline', 'HEAD', '--baseline-cmd', 'tests=node -e 0 {file}', '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  const lines = res.stderr.split('\n');
  assert.strictEqual(lines[0], NO_VERDICT_FIRST('tests', 'head-not-pushed'));
  assert.match(lines[3], /^verify\.js: a stale baseline scratch worktree is registered at /);
});

test('without the key the stale baseline worktree warning is still stderr line 1 of a CI-declared --scope run (#5369 AC4)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('unpushed', '');
  const staleParent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-verify-base-')));
  r.git('worktree', 'add', '--detach', path.join(staleParent, 'wt'), 'HEAD');
  const res = await runCli([...SCOPE(r), '--baseline', 'HEAD', '--baseline-cmd', 'tests=node -e 0 {file}', '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  assert.match(res.stderr.split('\n')[0], /^verify\.js: a stale baseline scratch worktree is registered at /);
});

test('a dirty tree under the key exits 3 with dirty-tree and calls no gh (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env, calls } = fakeGhEnv('green', '');
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok edited', () => {});\n");
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.strictEqual(res.stderr.split('\n')[0], NO_VERDICT_FIRST('tests', 'dirty-tree'));
  assert.ok(!fs.existsSync(calls), 'gh must not be called for a dirty tree');
  assert.ok(!fs.existsSync(marker));
});

test('a dirty tree under the key with two CI suites names the first and leaves the second not-consulted (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: TWO_SUITES(path.join(tmpDir(), 'other-m')) });
  const { env, calls } = fakeGhEnv('green', '');
  fs.writeFileSync(path.join(r.repo, 'tests', 'ok.test.js'), "require('node:test')('ok edited', () => {});\n");
  const runDir = ciRunDir(r);
  const res = await runCli(['--run', runDir, ...SCOPE(r), '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.deepStrictEqual(ev.ci, [
    { suite: 'tests', used: false, fallback: 'dirty-tree' },
    { suite: 'other', used: false, fallback: 'not-consulted' },
  ]);
  assert.ok(!fs.existsSync(calls), 'gh must not be called');
});

test('AC9.3: under the key a red CI job with no downloadable log exits 1, names the run URL, and runs nothing here (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('red', '', { FAKE_GH_LOG: 'gone' });
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 1, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'nothing runs here');
  assert.match(res.stdout, /^CI: tests — taken from test\.yml \/ test run 41 on HEAD \(failure, https:\/\/example\.test\/runs\/41; its log could not be downloaded — pass --local to reproduce the failure here\)$/m);
  assert.deepStrictEqual(reportOf(r).checks.tests.retryDecision, { retry: false, reason: 'ci-log-unavailable' });
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')), 'a failing run never stamps');
});

test('AC9.2: an older gh that rejects --allow-escape-sequences still takes the red verdict from CI (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ extraFiles: { 'tests/new.test.js': "require('node:test')('brand new check', () => { throw new Error('regressed'); });\n" } });
  const { env } = fakeGhEnv('red', ciLogOf(r, ['tests/new.test.js', 'tests/ok.test.js']), { FAKE_GH_LOG: 'old' });
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 1, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker));
  assert.match(res.stdout, /brand new check/);
});

test('AC7: an exit-3 run writes a verify event with noVerdict and pass null; a --local run records local-requested (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('unpushed', '');
  const runDir = ciRunDir(r);
  const marker = path.join(tmpDir(), 'm');
  const first = await runCli(['--run', runDir, ...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(first.code, 3, first.stdout + first.stderr);
  const second = await runCli(['--run', runDir, ...SCOPE(r), '--local', '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(second.code, 0, second.stdout + second.stderr);
  const [noVerdict, local] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.strictEqual(noVerdict.noVerdict, true);
  assert.strictEqual(noVerdict.pass, null);
  assert.deepStrictEqual(noVerdict.suitesRun, []);
  assert.deepStrictEqual(noVerdict.ci, [{ suite: 'tests', used: false, fallback: 'head-not-pushed' }]);
  assert.strictEqual(noVerdict.local, false);
  assert.strictEqual(local.local, true);
  assert.deepStrictEqual(local.ci, [{ suite: 'tests', used: false, fallback: 'local-requested' }]);
});

test('an exit-3 run takes no suite slot (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('unpushed', '');
  const dir = path.join(tmpDir(), 'slots');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env: withSlots(env, dir) });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.strictEqual(fs.existsSync(dir), false, 'no slot was tried for');
});
