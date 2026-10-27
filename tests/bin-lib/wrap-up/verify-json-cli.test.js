'use strict';
// tests/bin-lib/wrap-up/verify-json-cli.test.js — `wrap-up-engine.js verify`
// persists its per-check rows to {run-dir}/verify.json (#3783), into the dir
// that was actually verified (the archived copy when the original path is
// gone), never recreating the stale original. Spawns the CLI as a real child
// process against a temp git repo, with a gh-absent PATH (a scratch dir of
// symlinks to node and git only) so the result is machine-independent.
const { test, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chmodDenialSkip } = require('../../helpers/root');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-engine.js');
const { runVerify, resolveArchivedRunDir } = require('../../../plugin/bin/lib/wrap-up/engine-verify');

const RUN_ID = '2026-10-21T120000-verify-json-fixture';

// Every temp dir this file mints, removed once the file's tests finish.
const tmpDirs = [];
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// Same shape as tests/integration-model.test.js's ghAbsentPath(), plus node:
// `gh` is absent even where it sits beside git (Homebrew).
function ghAbsentPath() {
  const binDir = tmpDir('ct-nogh-bin-');
  fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(binDir, 'git'));
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  return binDir;
}

function makeRepo() {
  const repo = fs.realpathSync(tmpDir('verify-json-cli-'));
  const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  g('init', '-q');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  return repo;
}

function pipelinesDir(repo) {
  return path.join(repo, '.claude-tweaks', 'pipelines');
}

function runCli(repo, runDir, binDir) {
  const r = spawnSync(process.execPath, [CLI, 'verify', '--run-dir', runDir, '--base', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: binDir },
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The table's rows, parsed: [{ check, resultCell }] in order.
function tableRows(stdout) {
  return stdout.split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Check ') && !l.startsWith('|---'))
    .map((l) => {
      const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      return { check: cells[0], resultCell: cells[1] };
    });
}

// runVerify's own verdict on the same fixture, in-process, with gh absent.
function inProcessExitCode(repo, runDir) {
  const original = process.env.PATH;
  process.env.PATH = ghAbsentPath();
  try {
    const resolved = resolveArchivedRunDir(runDir, repo);
    return runVerify({ runDir: resolved, originalRunDir: runDir, base: 'HEAD', repoRoot: repo, cwd: repo, deps: {} }).exitCode;
  } finally {
    process.env.PATH = original;
  }
}

test('AC1.1: verify-json writes one entry per check', () => {
  const repo = makeRepo();
  const runDir = path.join(pipelinesDir(repo), RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const expectedExit = inProcessExitCode(repo, runDir);

  const r = runCli(repo, runDir, ghAbsentPath());
  assert.strictEqual(r.status, expectedExit, r.stderr);
  assert.strictEqual(r.stderr, '', 'a successful write is silent on stderr');

  const written = JSON.parse(fs.readFileSync(path.join(runDir, 'verify.json'), 'utf8'));
  const rows = tableRows(r.stdout);
  assert.ok(rows.length > 0, 'the table has rows');
  assert.deepStrictEqual(written.checks.map((c) => c.check), rows.map((x) => x.check));
  assert.ok(written.checks.some((c) => c.check === 'acceptance-labeling'), 'acceptance-labeling is persisted');
  written.checks.forEach((c, i) => assert.strictEqual(c.result, rows[i].resultCell.split(' ')[0], `result of ${c.check}`));
  assert.strictEqual(written.version, 1);
  assert.strictEqual(written.base, 'HEAD');
});

test('verify-json lands in the archived copy', () => {
  const repo = makeRepo();
  const runDir = path.join(pipelinesDir(repo), RUN_ID);
  const archived = path.join(pipelinesDir(repo), 'archive', RUN_ID);
  fs.mkdirSync(archived, { recursive: true });

  const r = runCli(repo, runDir, ghAbsentPath());
  assert.ok(fs.existsSync(path.join(archived, 'verify.json')), `${r.stderr}${r.stdout}`);
  const written = JSON.parse(fs.readFileSync(path.join(archived, 'verify.json'), 'utf8'));
  assert.deepStrictEqual(written.checks.map((c) => c.check), tableRows(r.stdout).map((x) => x.check));
  assert.ok(written.checks.some((c) => c.check === 'acceptance-labeling'), 'acceptance-labeling is persisted');
  assert.ok(!fs.existsSync(runDir), 'the stale original run dir was not recreated');
});

test('verify-json not written when run dir not found', () => {
  const repo = makeRepo();
  const runDir = path.join(pipelinesDir(repo), RUN_ID);

  const r = runCli(repo, runDir, ghAbsentPath());
  assert.strictEqual(r.status, 3, r.stderr);
  assert.ok(!fs.existsSync(pipelinesDir(repo)) || !JSON.stringify(fs.readdirSync(pipelinesDir(repo), { recursive: true })).includes('verify.json'),
    'no verify.json anywhere under .claude-tweaks/pipelines/');
  assert.ok(!fs.existsSync(runDir), 'the original path was not created');
});

const unwritableSkip = chmodDenialSkip('root ignores directory permissions');

test('verify-json write failure leaves the verdict alone', unwritableSkip, () => {
  const repo = makeRepo();
  const runDir = path.join(pipelinesDir(repo), RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const expectedExit = inProcessExitCode(repo, runDir);
  fs.chmodSync(runDir, 0o555);
  try {
    const r = runCli(repo, runDir, ghAbsentPath());
    assert.strictEqual(r.status, expectedExit);
    assert.match(r.stdout, /\| Check \| Result \| Detail \|/, 'the table is still printed');
    assert.match(r.stderr, /verify\.json/);
    assert.ok(!fs.existsSync(path.join(runDir, 'verify.json')));
  } finally {
    fs.chmodSync(runDir, 0o755);
  }
});
