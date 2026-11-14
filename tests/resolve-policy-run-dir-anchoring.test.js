// tests/resolve-policy-run-dir-anchoring.test.js
//
// #1065: bin/resolve-policy.js's --run had only an existence check — the
// anchored-or-outside guard now runs BEFORE it (and before any config.yml
// read). Existing behavior for accepted-shape paths is pinned unchanged,
// including the nonexistent-dir exit-1 message.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-policy.js');

// In-process (#5384): the anchoring guard and the config reads run against the fixture cwd.
function runResolver(args, cwd) {
  const { code, stdout, stderr } = runCliSync(CLI, args, { cwd, env: { ...process.env } });
  return { status: code, stdout, stderr };
}

test('accept: main-anchored --run from linked-worktree cwd; config overlay still read', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'autonomy: trusted\n');
  const res = runResolver(['--run', runDir, 'autonomy'], wt);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.deepStrictEqual(JSON.parse(res.stdout).autonomy, { value: 'trusted', source: 'run-config' });
});

// #1138: an empty or whitespace-only --run value must be rejected at parse
// time — before it ever reaches the anchoring check — the same rule
// resolve-policy already applied to a genuinely missing value.
test('reject: empty --run value — "--run requires a value", exit 1', () => {
  const main = gitRepo();
  const res = runResolver(['--run', '', 'autonomy'], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--run requires a value/);
});

test('reject: whitespace-only --run value degrades the same as empty', () => {
  const main = gitRepo();
  const res = runResolver(['--run', '   ', 'autonomy'], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--run requires a value/);
});

test('accept: --run outside any checkout; nonexistent dir still exits 1 with the pre-existing message (AC 5)', () => {
  const main = gitRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'rpol-out-'));
  const ok = runResolver(['--run', outside, 'autonomy'], main);
  assert.strictEqual(ok.status, 0, ok.stderr);
  const missing = runResolver(['--run', path.join(outside, 'no-such'), 'autonomy'], main);
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /does not exist or is not a directory/);
});

test('reject: bare relative --run from linked-worktree cwd, before any config read', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'config.yml'), 'autonomy: unattended\n');
  const res = runResolver(['--run', path.join('.claude-tweaks', 'pipelines', 'r1'), 'autonomy'], wt);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--run .*resolves outside the main checkout/);
  assert.ok(res.stderr.includes(path.join(fs.realpathSync(wt), '.claude-tweaks', 'pipelines', 'r1')), res.stderr);
  assert.strictEqual(res.stdout, '', 'no JSON — rejected before resolution');
});

test('reject: absolute --run inside a linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const res = runResolver(['--run', path.join(wt, '.claude-tweaks', 'pipelines', 'r1'), 'autonomy'], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /resolves outside the main checkout/);
  assert.ok(res.stderr.includes(path.join(fs.realpathSync(wt), '.claude-tweaks', 'pipelines', 'r1')), res.stderr);
});

test('reject: --run inside an unrelated second repo (AC 10)', () => {
  const main = gitRepo();
  const other = gitRepo();
  const res = runResolver(['--run', path.join(other, 'run'), 'autonomy'], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /resolves outside the main checkout/);
});

test('reject: no-repo-root cwd with --run inside some checkout — distinct message (AC 6)', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'rpol-norepo-'));
  const repo = gitRepo();
  const res = runResolver(['--run', path.join(repo, 'run'), 'autonomy'], bare);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /could not determine the git repository root/);
  assert.doesNotMatch(res.stderr, /resolves outside the main checkout/);
});
