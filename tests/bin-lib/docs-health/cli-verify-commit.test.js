'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { sweepCli } = require('../../helpers/health-sweep-cli');
const { acquireLock } = require('../../../plugin/bin/lib/file-lock');
const { DEEPEN_TIMEOUT_MS, LOCK_WAIT_MARGIN_MS } = require('../../../plugin/bin/lib/docs-health/commit-ref');
const { git, tmpDir, makeOriginRepo, cloneOf } = require('./commit-fixtures');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
function cli(argv, opts) {
  return sweepCli(CLI, argv, opts);
}

test('verify-commit exits 2 with no hash argument', () => {
  const r = cli(['verify-commit']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: docs-health\.js verify-commit/);
});

test('verify-commit prints the result envelope for reachable and exists-unreachable hashes', () => {
  const origin = makeOriginRepo();
  const res = cli([
    'verify-commit', origin.root.slice(0, 7), origin.sideOnly,
    '--root', origin.dir, '--integration-branch', 'main',
  ]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.strictEqual(result.integrationRef, 'refs/heads/main');
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
});

test('verify-commit --no-deepen on a shallow clone reports unverifiable and leaves it shallow', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const res = cli(['verify-commit', origin.root, '--root', dir, '--no-deepen']);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['unverifiable']);
  assert.strictEqual(git(dir, ['rev-parse', '--is-shallow-repository']).trim(), 'true');
});

test('verify-commit on a shallow clone deepens by default and classifies', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const res = cli(['verify-commit', origin.root, '--root', dir, '--remote', 'origin']);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.strictEqual(result.shallow.deepened, true);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable']);
});

test('the no-argument usage line names verify-commit', () => {
  const r = cli([]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /verify-commit <sha>\.\.\./);
});

test('verify-commit resolves the integration branch from policy.yml when no flag is passed', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'));
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-branch: side\n');
  const res = cli(['verify-commit', origin.sideOnly, '--root', dir]);
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.strictEqual(result.integrationBranch, 'side');
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable']);
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, the same outcome as the --root twin above.
test('AC8.1: verify-commit without --root classifies against the repo at the injected cwd', () => {
  const origin = makeOriginRepo();
  const res = cli(['verify-commit', origin.root, origin.sideOnly, '--integration-branch', 'main'], { cwd: origin.dir });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable', 'exists-unreachable']);
});

// The script entry hands the real file lock to verify-commit through realDeps.
test('realDeps carries the real file lock', () => {
  assert.strictEqual(require(CLI).realDeps.lock, acquireLock);
});

// The lock and its wait are the injected ones: a `lock` dep sees the extended deepen wait, and the
// CLAUDE_TWEAKS_LOCK_WAIT_MS in the injected env does not override it nor reach process.env (the
// leak guard checks the real process.env).
test('AC3.1, AC3.2: an in-process verify-commit that deepens a shallow clone passes the extended wait to the lock and leaves process.env untouched', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin, { depth: 1 });
  const calls = [];
  const envBefore = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  const res = cli(['verify-commit', origin.root, '--root', dir, '--remote', 'origin'], {
    env: { CLAUDE_TWEAKS_LOCK_WAIT_MS: '7' }, // sweepCli merges this over the ambient env, minus GIT_*
    deps: {
      lock: (p, opts) => {
        // envAtCall sees a set-then-restore swap of process.env around the lock, which the
        // leak guard's end-state comparison cannot.
        calls.push({ ...opts, envAtCall: process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS });
        return acquireLock(p, opts);
      },
    },
  });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].waitMs, DEEPEN_TIMEOUT_MS + LOCK_WAIT_MARGIN_MS);
  assert.strictEqual(calls[0].envAtCall, envBefore, 'process.env must not carry the wait while the lock is acquired');
  assert.strictEqual(JSON.parse(res.stdout).result.shallow.deepened, true);
});

// env-only fixture: verify-commit's git children run under the injected env, so a GIT_DIR that only
// the injected env carries points them at the origin repo although --root itself is not a repo.
test('verify-commit classifies through the injected env: GIT_DIR names the repo, root is not one', () => {
  const origin = makeOriginRepo();
  const root = tmpDir('plain'); // not a git repo
  const res = cli(['verify-commit', origin.root, '--root', root, '--integration-branch', 'main'], {
    env: { GIT_DIR: path.join(origin.dir, '.git') },
  });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  assert.deepStrictEqual(JSON.parse(res.stdout).result.commits.map((c) => c.outcome), ['reachable']);
});

// Accepted output difference (plan review): a relative --root is normalized against the injected cwd,
// so result.root prints absolute.
test('verify-commit --root <relative dir> prints the root resolved against the injected cwd', () => {
  const origin = makeOriginRepo();
  const dir = cloneOf(origin);
  const parent = path.dirname(dir);
  const res = cli(['verify-commit', origin.root, '--root', path.basename(dir), '--integration-branch', 'main'], { cwd: parent });
  assert.strictEqual(res.status, 0, `stderr: ${res.stderr}`);
  const { result } = JSON.parse(res.stdout);
  assert.strictEqual(result.root, path.resolve(parent, path.basename(dir)));
  assert.deepStrictEqual(result.commits.map((c) => c.outcome), ['reachable']);
});
