// tests/hooks-check-pass-reentry.test.js
//
// #3553: `hooks.js check-pass-reentry --run <dir> [--online]` prints
// consolidated-pass.js's checkPassReentry verdict as one JSON line on stdout
// (exit 0), or a stderr refusal and nothing on stdout (exit 1). Its skill
// caller (flow/multispec-review-console.md's re-entry step) reads a non-zero
// exit or non-JSON stdout as a stop, so this suite pins that contract.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reentryFixture, reentryGit } = require('./helpers/reentry-fixture');
const { checkPassReentry } = require('../plugin/bin/lib/flow/consolidated-pass');
const { USAGE } = require('../plugin/bin/hooks.js');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function runCli(args, { cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOKS, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', CLAUDE_CODE_SESSION_ID: 'cpr-test', ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const verdictOf = (r) => JSON.parse(r.stdout.trim());

test('AC1.1: eligible fixture -> stdout is checkPassReentry\'s verdict JSON, exit 0', () => {
  const { root, runDir } = reentryFixture();
  const expected = checkPassReentry(runDir, { sessionId: 'cpr-test' });
  assert.equal(expected.reason, 'eligible'); // fixture really is eligible
  const r = runCli(['check-pass-reentry', '--run', runDir], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepStrictEqual(verdictOf(r), expected);
  assert.equal(r.stdout, `${JSON.stringify(expected)}\n`);
});

test('AC1.1: ineligible fixture (console.json present) -> same verdict JSON as checkPassReentry', () => {
  const { root, runDir } = reentryFixture();
  fs.writeFileSync(path.join(runDir, 'console.json'), '{}');
  const expected = checkPassReentry(runDir, { sessionId: 'cpr-test' });
  assert.equal(expected.reason, 'console-exists');
  const r = runCli(['check-pass-reentry', '--run', runDir], { cwd: root });
  assert.equal(r.code, 0, r.stderr);
  assert.deepStrictEqual(verdictOf(r), expected);
});

test('AC1.2: an unanchored --run exits non-zero with no JSON on stdout', () => {
  const { root } = reentryFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cpr-outside-'));
  const runDir2 = path.join(outside, '.claude-tweaks', 'pipelines', '2026-08-01T090000-spec-11-12');
  fs.mkdirSync(runDir2, { recursive: true });
  fs.writeFileSync(path.join(runDir2, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(runDir2, 'config.yml'), 'mode: auto\n');
  const r = runCli(['check-pass-reentry', '--run', runDir2], { cwd: root });
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--run path rejected/);
});

test('#3553: omitting --run exits non-zero, never guessing a run dir', () => {
  const { root } = reentryFixture();
  const r = runCli(['check-pass-reentry'], { cwd: root });
  assert.notEqual(r.code, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /requires --run/);
});

// gh-absent is simulated by a PATH holding only a symlink to git, so the
// online PR check cannot resolve `gh`. Skipped where git cannot be located.
const gitPath = (() => {
  const w = spawnSync('which', ['git'], { encoding: 'utf8' });
  return w.status === 0 ? w.stdout.trim() : null;
})();

test('#3553: --online is threaded through (gh absent -> degrade named in detail; absent without --online)', { skip: (!gitPath && 'git not resolvable on PATH') || (process.platform === 'win32' && 'symlink-only PATH fixture is POSIX-only') }, () => {
  const { root, runDir } = reentryFixture();
  const statePath = path.join(runDir, 'run-state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.pr = { number: 7, url: 'https://example.test/pr/7', branch: 'feat-branch' };
  fs.writeFileSync(statePath, JSON.stringify(state));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cpr-bin-'));
  fs.symlinkSync(gitPath, path.join(bin, 'git'));
  const env = { PATH: bin };
  const online = runCli(['check-pass-reentry', '--run', runDir, '--online'], { cwd: root, env });
  const offline = runCli(['check-pass-reentry', '--run', runDir], { cwd: root, env });
  assert.equal(online.code, 0, online.stderr);
  assert.equal(offline.code, 0, offline.stderr);
  assert.match(verdictOf(online).detail, /online PR check unavailable \(gh-absent\)/);
  assert.doesNotMatch(verdictOf(offline).detail, /online PR check unavailable/);
});

test('#3553: the caller\'s CLAUDE_CODE_SESSION_ID is passed as sessionId (own run skips the parent-live lock check)', () => {
  const { root, wt, runDir } = reentryFixture();
  // A lock with no pid yields lockVerdict 'unknown', which checkPassReentry reads as
  // parent-live unless the run's recorded sessionId is the caller's own.
  reentryGit(root, 'worktree', 'lock', '--reason', 'held', wt);
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wt, sessionId: 'cpr-test' }));
  const own = runCli(['check-pass-reentry', '--run', runDir], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'cpr-test' } });
  const other = runCli(['check-pass-reentry', '--run', runDir], { cwd: root, env: { CLAUDE_CODE_SESSION_ID: 'someone-else' } });
  assert.equal(own.code, 0, own.stderr);
  assert.equal(other.code, 0, other.stderr);
  assert.equal(verdictOf(own).reason, 'eligible');
  assert.equal(verdictOf(other).reason, 'parent-live');
});

test('#3553: an unknown flag prints the usage line, never verdict JSON', () => {
  const { root, runDir } = reentryFixture();
  const r = runCli(['check-pass-reentry', '--run', runDir, '--onlin'], { cwd: root });
  assert.equal(r.stdout, `claude-tweaks: usage: ${USAGE['check-pass-reentry']}\n`);
});
