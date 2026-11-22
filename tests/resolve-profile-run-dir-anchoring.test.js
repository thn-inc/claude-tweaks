// tests/resolve-profile-run-dir-anchoring.test.js
//
// #1065: bin/resolve-profile.js's --run-dir had zero anchoring validation —
// the anchored-or-outside half of the [IL-127] CLI-argument-boundary guard
// (tests/materialize-run-dir-anchoring.test.js covers the strict half).
// These tests call the CLI in-process with the injected cwd set per fixture and
// assert on exit code, stderr, and tally side effects.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'resolve-profile.js');

function runCli(args, cwd) {
  const r = runCliSync(CLI, args, { cwd, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } });
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
}

test('accept: main-anchored --run-dir from linked-worktree cwd (production shape)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', 'r1');
  fs.mkdirSync(runDir, { recursive: true });
  const res = runCli(['standard', '--run-dir', runDir], wt);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(JSON.parse(res.stdout).model, 'still resolves a model');
});

// #1138: an empty or whitespace-only --run-dir (the shape an unset
// $PIPELINE_RUN_DIR expands to in shell) used to reach the anchoring check
// as a blank string, producing a malformed double-space message
// ("--run-dir  resolves outside..."). It must now be rejected at parse
// time, before the anchoring check ever runs.
test('reject: empty --run-dir value — "--run-dir requires a value", exit 1, never reaches the anchoring check', () => {
  const main = gitRepo();
  const res = runCli(['standard', '--run-dir', ''], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--run-dir requires a value/);
  assert.doesNotMatch(res.stderr, /resolves outside/, 'must never reach the anchoring check with a blank value');
});

test('reject: whitespace-only --run-dir value degrades the same as empty', () => {
  const main = gitRepo();
  const res = runCli(['standard', '--run-dir', '   '], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--run-dir requires a value/);
});

test('accept: --run-dir outside any checkout (journey shape) — tally readable/appendable there', () => {
  const main = gitRepo();
  const outside = scratchDir('rp-journey-');
  const res = runCli(['frontier', '--run-dir', outside], main);
  assert.strictEqual(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.model, 'fable', 'fixture preconditions must resolve frontier to fable');
  assert.ok(fs.existsSync(path.join(outside, 'frontier-tally.log')), 'tally written outside as before');
});

test('AC9.1: reject: bare relative --run-dir from linked-worktree cwd (the injected cwd, not process.cwd()) — exit 1, no tally anywhere', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const res = runCli(['frontier', '--run-dir', path.join('.claude-tweaks', 'pipelines', 'r1')], wt);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /resolves outside the main checkout/);
  assert.match(res.stderr, /--run-dir /);
  assert.ok(res.stderr.includes(path.join(fs.realpathSync(wt), '.claude-tweaks', 'pipelines', 'r1')), res.stderr);
  assert.ok(!fs.existsSync(path.join(wt, '.claude-tweaks', 'pipelines', 'r1', 'frontier-tally.log')), 'reject fires before any tally I/O');
});

test('reject: absolute --run-dir inside a linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const res = runCli(['standard', '--run-dir', path.join(wt, '.claude-tweaks', 'pipelines', 'r1')], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /resolves outside the main checkout/);
  assert.ok(res.stderr.includes(path.join(fs.realpathSync(wt), '.claude-tweaks', 'pipelines', 'r1')), res.stderr);
});

test('reject: --run-dir inside a genuinely unrelated second repo (AC 10)', () => {
  const main = gitRepo();
  const other = gitRepo();
  const res = runCli(['standard', '--run-dir', path.join(other, 'run')], main);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /resolves outside the main checkout/);
});

test('reject: no-repo-root cwd with --run-dir inside some checkout — distinct message (AC 6, fixture per AC 12)', () => {
  const bare = scratchDir('rp-norepo-');
  const repo = gitRepo();
  const res = runCli(['standard', '--run-dir', path.join(repo, 'run')], bare);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /could not determine the git repository root/);
  assert.doesNotMatch(res.stderr, /resolves outside the main checkout/);
});

test('accept: symlinked tmpdir spelling classifies by real location (AC 11)', () => {
  const main = gitRepo();
  const realOutside = scratchDir('rp-sym-');
  const aliasParent = scratchDir('rp-symparent-');
  const alias = path.join(aliasParent, 'alias');
  fs.symlinkSync(realOutside, alias);
  const res = runCli(['standard', '--run-dir', path.join(alias, 'r')], main);
  assert.strictEqual(res.status, 0, res.stderr);
});
