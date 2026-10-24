'use strict';
// tests/resolve-ledger-verb.test.js — #3897: `bin/hooks.js resolve-ledger`, the
// read-only twin of delete-ledger. Prints which ledger belongs to this run
// (found/none/ambiguous/unattributable) so a skill never resolves one by
// listing docs/plans itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function runHook(args, { cwd } = {}) {
  const r = spawnSync('node', [HOOKS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '' } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The temp dir's parent name contains a space, as a real checkout path can.
function gitRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct resolve ledger ')));
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

function commitInheritedLedger(root) {
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const inherited = path.join(root, 'docs', 'plans', '2026-08-14-old-ledger.md');
  fs.writeFileSync(inherited, '# Open Items\n');
  git(['add', 'docs/plans/2026-08-14-old-ledger.md'], root);
  git(['commit', '-q', '-m', 'inherited ledger'], root);
  git(['checkout', '-q', '-b', 'feature'], root);
  return inherited;
}

test('AC1.1: resolve-ledger returns {run-dir}/ledger.md even with no materialized header (records unresolved)', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '');
  const result = runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${path.join(runDir, 'ledger.md')}\n`), result.stdout);
});

test('AC2.1: an inherited ledger committed on main is reported as other-run, never this-run', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const inherited = commitInheritedLedger(root);
  const result = runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: none\n'), result.stdout);
  assert.ok(result.stdout.includes(`other-run: ${inherited}\n`), result.stdout);
  assert.doesNotMatch(result.stdout, /this-run:/);
});

test('AC2.1: an untracked owned ledger beside an inherited one: found + other-run', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  const inherited = commitInheritedLedger(root);
  const owned = path.join(root, 'docs', 'plans', '2026-08-15-new-ledger.md');
  fs.writeFileSync(owned, '# Open Items\n');
  const result = runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${owned}\n`), result.stdout);
  assert.ok(result.stdout.includes(`other-run: ${inherited}\n`), result.stdout);
});

test('two owned ledgers report ambiguous, naming both as this-run', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const a = path.join(root, 'docs', 'plans', 'a-ledger.md');
  const b = path.join(root, 'docs', 'plans', 'b-ledger.md');
  fs.writeFileSync(a, '# A\n');
  fs.writeFileSync(b, '# B\n');
  const result = runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: ambiguous\n'), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${a}\n`), result.stdout);
  assert.ok(result.stdout.includes(`this-run: ${b}\n`), result.stdout);
});

test('no --run exits 0 with "no pipeline run dir found — ledger not resolved"', () => {
  const root = gitRoot();
  const result = runHook(['resolve-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /no pipeline run dir found — ledger not resolved/);
  assert.strictEqual(result.stdout, '');
});

test('resolve-ledger leaves every ledger on disk', () => {
  const root = gitRoot();
  const runDir = runDirFixture(root);
  fs.writeFileSync(path.join(runDir, 'ledger.md'), '# Open Items\n');
  fs.mkdirSync(path.join(root, 'docs', 'plans'), { recursive: true });
  const planLedger = path.join(root, 'docs', 'plans', '2026-08-15-sample-ledger.md');
  fs.writeFileSync(planLedger, '# Open Items\n');
  const result = runHook(['resolve-ledger', '--run', runDir], { cwd: root });
  assert.ok(result.stdout.startsWith('claude-tweaks: resolve-ledger: found\n'), result.stdout);
  assert.ok(fs.existsSync(path.join(runDir, 'ledger.md')));
  assert.ok(fs.existsSync(planLedger));
});

const REPORT_LINE_RE = /resolve-ledger: (found|none|ambiguous|unattributable)/;

test('resolve-ledger: --run "" refuses with "ledger not resolved" and no report line', () => {
  const root = gitRoot();
  const result = runHook(['resolve-ledger', '--run', ''], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /ledger not resolved/);
  assert.doesNotMatch(result.stdout, REPORT_LINE_RE);
  assert.doesNotMatch(result.stdout, /claude-tweaks: --run|not resolved/);
});

test('resolve-ledger: no --run with two live candidate runs refuses, listing candidates, no report line', () => {
  const root = gitRoot();
  for (const runId of ['2026-08-14T120000-spec-998', '2026-08-14T120100-spec-999']) {
    const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  }
  const result = runHook(['resolve-ledger'], { cwd: root });
  assert.strictEqual(result.code, 0);
  assert.match(result.stderr, /multiple candidate runs/);
  assert.match(result.stderr, /Ledger not resolved\./);
  assert.doesNotMatch(result.stdout, REPORT_LINE_RE);
  assert.doesNotMatch(result.stdout, /multiple candidate runs|not resolved/i);
});
