'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { checkPrBookkeepingPrecondition } = require('../../../plugin/bin/lib/pr-bookkeeping/precondition');

function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function linkedWorktreeOf(main) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-wtparent-'));
  const wt = path.join(parent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', wt, '-b', `wt-branch-${path.basename(parent)}`]);
  return fs.realpathSync(wt);
}

function makeRunDir(id) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-run-'));
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function writeRunState(runDir, state) {
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
}

function commitMaterializeFile(repo, runId) {
  const rel = path.join('.claude-tweaks', 'pipelines', runId, 'work', '1-spec.md');
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'materialize', '-q']);
}

test('checkPrBookkeepingPrecondition: ok when run dir is absent (nothing to check)', () => {
  const r = checkPrBookkeepingPrecondition({ runDir: null, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
});

test('checkPrBookkeepingPrecondition: ok when the run is already clean', () => {
  const runId = '2026-09-17T000001-spec-1';
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'clean' });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: process.cwd() });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'clean');
});

test('checkPrBookkeepingPrecondition: ok when no materialize commit has landed yet', () => {
  const runId = '2026-09-17T000002-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-materialized-yet');
});

test('checkPrBookkeepingPrecondition: DENY when materialize commit landed but no worktree stamp was ever recorded (#2472 core scenario)', () => {
  const runId = '2026-09-17T000003-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  // No run-state.json at all -- record-worktree never ran.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
  assert.match(r.message, /record-worktree/);
});

test('checkPrBookkeepingPrecondition: ok (fail-open) for a current-branch-shaped run -- no worktree field, NOT a linked worktree (#2472 Finding 1 regression)', () => {
  const runId = '2026-09-17T000003b-spec-1';
  // A plain git repo that is NOT a linked worktree of anything -- the
  // git-strategy: current-branch shape, where build/worktree-setup.md (and
  // its record-worktree call) never runs at all.
  const main = gitRepoWithCommit();
  // current-branch mode works directly on a feature branch in the SAME
  // checkout (no linked worktree at all) -- advance HEAD past the resolved
  // integration branch (main/master) the same way a linked worktree's own
  // branch does, so hasMaterializeCommit's {integration}..HEAD range is
  // non-empty.
  execFileSync('git', ['-C', main, 'checkout', '-b', 'feature-branch', '-q']);
  commitMaterializeFile(main, runId);
  const runDir = makeRunDir(runId);
  // No run-state.json -- record-worktree legitimately never ran in this mode.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: main });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-linked-worktree');
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and prExempt is set', () => {
  const runId = '2026-09-17T000004-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, prExempt: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when worktree stamped and a PR is recorded', () => {
  const runId = '2026-09-17T000005-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition: ok when integration model resolves local-merge (no policy, no remote)', () => {
  const runId = '2026-09-17T000006-spec-1';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-pr-first');
});

test('checkPrBookkeepingPrecondition: ok when a PR-early-lifecycle FAILED degrade line is already logged', () => {
  const runId = '2026-09-17T000007-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  fs.writeFileSync(path.join(runDir, 'decisions.md'),
    '- AUTO 10:00:00 -- PR-early run lifecycle: push of br FAILED (network). Reversibility: n/a.\n');
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'degrade-logged');
});

test('checkPrBookkeepingPrecondition: DENY when pr-first, worktree stamped, no PR and no degrade line logged (#2472 core scenario)', () => {
  const runId = '2026-09-17T000008-spec-1';
  const main = gitRepoWithCommit();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  execFileSync('git', ['-C', main, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', main, 'commit', '-m', 'policy', '-q']);
  const wt = linkedWorktreeOf(main);
  commitMaterializeFile(wt, runId);
  const runDir = makeRunDir(runId);
  writeRunState(runDir, { status: 'active', worktree: wt });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-pr-stamp');
  assert.match(r.message, /pr-early-run-lifecycle/);
});
