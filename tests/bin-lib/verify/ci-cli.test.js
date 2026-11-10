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
const { execFile, execFileSync, spawnSync } = require('child_process');

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
if ((m = ep.match(/commits\\/([0-9a-f]{40})\\/pulls$/))) out(mode === 'nopr' ? [] : [{ number: 7, state: 'open', head: { sha: m[1] } }]);
else if (/pulls\\/7$/.test(ep)) out({ number: 7, mergeable_state: 'clean' });
else if ((m = ep.match(/runs\\?head_sha=([0-9a-f]{40})/))) out({ workflow_runs: [{ id: 41, head_sha: m[1], status: 'completed', html_url: 'https://example.test/runs/41' }] });
else if (/runs\\/41\\/jobs/.test(ep)) out({ jobs: [{ id: 99, name: 'test', status: 'completed', conclusion: mode === 'red' ? 'failure' : 'success', started_at: '2026-10-25T17:27:00Z', completed_at: '2026-10-25T17:30:30Z', html_url: 'https://example.test/job/99' }] });
else if (/jobs\\/99\\/logs$/.test(ep)) process.stdout.write(fs.readFileSync(process.env.FAKE_GH_LOG_FILE, 'utf8'));
else { process.stderr.write('unexpected gh ' + a.join(' ')); process.exit(1); }
`;

function fakeGhEnv(mode, logFile) {
  const bin = tmpDir();
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  const calls = path.join(tmpDir(), 'calls.txt');
  const env = {
    ...process.env, PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter),
    FAKE_GH_MODE: mode, FAKE_GH_CALLS: calls, FAKE_GH_LOG_FILE: logFile || '',
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
function repoWith({ ci = true, extraFiles = {} } = {}) {
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

function localMarkerCmd(marker) {
  return `tests=node -e "require('fs').writeFileSync(process.argv[1], String(1))" "${marker}"`;
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
