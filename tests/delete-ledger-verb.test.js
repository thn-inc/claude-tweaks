'use strict';
// tests/delete-ledger-verb.test.js — #2546: `bin/hooks.js delete-ledger`,
// giving wrap-up cleanup item 2 (ledger deletion) a sanctioned verb instead
// of a hand-run `rm`/Bash call.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runHook(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

function gitRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

function runDirFixture(root) {
  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  return runDir;
}

test('delete-ledger: deletes {run-dir}/ledger.md when present and exits cleanly', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(runDir, 'ledger.md')));
});

test('delete-ledger: falls back to the single docs/plans/*-ledger.md candidate when no run-dir ledger.md exists', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const ledgerPath = path.join(root, 'docs', 'plans', '2026-08-14-sample-ledger.md');
  fs.writeFileSync(ledgerPath, '# Open Items\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(ledgerPath));
});

test('delete-ledger: running it again on an already-deleted ledger reports not-found, not a crash', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  runHook(['delete-ledger', '--run', runDir], { cwd: root });
  const second = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(second.code, 0);
  assert.match(second.stdout, /not found/);
});

test('delete-ledger: 2+ docs/plans/*-ledger.md candidates refuses to guess, naming all candidates', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = runHook(['delete-ledger', '--run', runDir], { cwd: root });
  assert.match(result.stdout, /candidate ledgers found/);
  assert.match(result.stdout, /a-ledger\.md/);
  assert.match(result.stdout, /b-ledger\.md/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger explicitly overrides resolution, deleting the named file', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'b-ledger.md'), '# B\n');
  const result = runHook(['delete-ledger', '--run', runDir, '--ledger', path.join(root, 'docs', 'plans', 'a-ledger.md')], { cwd: root });
  assert.match(result.stdout, /deleted ledger/);
  assert.ok(!fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'b-ledger.md')));
});

test('delete-ledger: --ledger naming a file outside the run dir and worktree is refused, nothing deleted', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-delledger-outside-')));
  const victim = path.join(outside, 'victim-ledger.md');
  fs.writeFileSync(victim, '# keep me\n');
  const result = runHook(['delete-ledger', '--run', runDir, '--ledger', victim], { cwd: root });
  assert.match(result.stdout, /rejected \(outside the run directory and worktree\)/);
  assert.ok(fs.existsSync(victim));
});

test('delete-ledger: no --run exits cleanly with a clear message, nothing deleted', () => {
  const root = gitRoot();
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'plans', 'a-ledger.md'), '# A\n');
  const result = runHook(['delete-ledger'], { cwd: root });
  assert.match(result.stdout, /no pipeline run dir found/);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'plans', 'a-ledger.md')));
});

test('delete-ledger --help prints usage and does nothing', () => {
  const root = gitRoot();
  const result = runHook(['delete-ledger', '--help'], { cwd: root });
  assert.match(result.stdout, /usage: delete-ledger/);
});
