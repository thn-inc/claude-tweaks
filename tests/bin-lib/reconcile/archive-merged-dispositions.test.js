'use strict';
// tests/bin-lib/reconcile/archive-merged-dispositions.test.js — #3977: the
// report-only disposition pass archiveMerged runs after its archive loops.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { archiveMerged, STALE_INTERRUPTED_TTL_MS } = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { QUIET_FLOOR_MS, STAGED_OUTCOME_REASON } = require('../../../plugin/bin/lib/run-liveness/disposition');

const DAY = 24 * 60 * 60 * 1000;
const DEAD = () => ({ verdict: 'dead', evidence: [{ probe: 'owner-pid', result: 'negative', detail: 'gone' }] });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-dispositions-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nwork-backend: local-files\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude-tweaks/\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const OLD = new Date(Date.now() - 3 * DAY).toISOString();

function run(root, name, { state, decisions, staged = [], events = true } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  if (!name.endsWith('-standalone')) fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  if (decisions) fs.writeFileSync(path.join(dir, 'decisions.md'), `## /build\n- AUTO 10:00:00 — ${decisions}. Reversibility: n/a.\n`);
  if (events) fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ ts: OLD, type: 'commit' })}\n`);
  for (const s of staged) {
    fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'staged', s), 'x\n');
  }
  return dir;
}

// Every file under pipelines/, path -> bytes, plus the directory list.
function snapshot(root) {
  const base = path.join(root, '.claude-tweaks', 'pipelines');
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      const rel = path.relative(base, abs);
      if (e.isDirectory()) { out[`${rel}/`] = 'dir'; walk(abs); } else out[rel] = fs.readFileSync(abs, 'base64');
    }
  };
  walk(base);
  return out;
}

const prStatesOf = (byNumber = {}, byBranch = {}) => ({
  byNumber: (n) => (n in byNumber ? byNumber[n] : 'network-failure'),
  byBranch: (b) => (b in byBranch ? byBranch[b] : 'network-failure'),
});

function threeDeadRuns(root) {
  const adhoc = run(root, '2026-10-10T000000-adhoc-standalone', { state: { status: 'active', worktree: path.join(root, 'gone-a') } });
  const closed = run(root, '2026-10-11T000000-record-11', {
    state: { status: 'active', pr: { number: 11 } }, staged: ['review-unconfirmed-1.md'],
  });
  const nothing = run(root, '2026-10-12T000000-record-12', {
    state: { status: 'active', worktree: path.join(root, 'gone-wt') },
    decisions: 'PR-early run lifecycle: push of feat-gone to origin FAILED (offline); run proceeds local-only, no PR opened',
  });
  return { adhoc, closed, nothing };
}

test('AC4: three dead runs yield three would-close lines and leave the tree byte-identical', () => {
  const root = repo();
  const { adhoc, closed, nothing } = threeDeadRuns(root);
  const prStates = prStatesOf({ 11: { number: 11, state: 'CLOSED', closingIssuesReferences: [] } }, { 'feat-gone': null });
  const before = snapshot(root);
  const r = archiveMerged({ cwd: root, prStates, runVerdict: DEAD, integration: 'main' });
  assert.deepEqual(snapshot(root), before, 'a report-only pass writes nothing under pipelines/');
  const d = r.runDispositions;
  assert.equal(d.reportOnly, true);
  assert.deepEqual(d.wouldClose.map((w) => [w.runDir, w.reason]), [
    [nothing, 'nothing-to-resume'],
    [closed, 'pr-closed-unmerged'],
    [adhoc, 'adhoc-dead'],
  ]);
  assert.deepEqual(d.orphaned, []);
  // AC6 (second half): the closed-unmerged run lists the finding it would drop, and drops none.
  assert.deepEqual(d.wouldClose.find((w) => w.runDir === closed).dropFindings, ['staged/review-unconfirmed-1.md']);
  assert.ok(fs.existsSync(path.join(closed, 'staged', 'review-unconfirmed-1.md')));
});

test('AC5: an open draft PR and unpushed commits are orphan, not would-close', () => {
  const root = repo();
  const draft = run(root, '2026-10-13T000000-record-13', { state: { status: 'active', pr: { number: 13 } } });
  git(root, 'branch', 'feat-local');
  git(root, 'checkout', '-q', 'feat-local');
  fs.writeFileSync(path.join(root, 'u.txt'), 'u');
  git(root, 'add', 'u.txt');
  git(root, 'commit', '-q', '-m', 'unpushed');
  git(root, 'checkout', '-q', 'main');
  const unpushed = run(root, '2026-10-14T000000-record-14', {
    state: { status: 'active', pr: { branch: 'feat-local' } },
  });
  const prStates = prStatesOf({ 13: { number: 13, state: 'OPEN', isDraft: true } }, { 'feat-local': null });
  const r = archiveMerged({ cwd: root, dryRun: true, prStates, runVerdict: DEAD, integration: 'main' });
  const d = r.runDispositions;
  assert.deepEqual(d.wouldClose, []);
  assert.deepEqual(d.orphaned.map((o) => [o.runDir, o.reason, o.pr]), [
    [unpushed, 'unpushed commits on feat-local', null],
    [draft, 'draft PR #13, session gone', 13],
  ]);
});

test('AC6: a dead run holding a non-review staged item is an orphan with the staged reason', () => {
  const root = repo();
  const dir = run(root, '2026-10-15T000000-adhoc-standalone', {
    state: { status: 'active', worktree: path.join(root, 'gone') }, staged: ['reflect-1.md'],
  });
  const d = archiveMerged({ cwd: root, dryRun: true, runVerdict: DEAD, integration: 'main' }).runDispositions;
  assert.deepEqual(d.orphaned, [{ runId: path.basename(dir), runDir: dir, reason: STAGED_OUTCOME_REASON, pr: null }]);
  assert.deepEqual(d.wouldClose, []);
});

test('live and unknown runs appear in neither list; unknown is counted', () => {
  const root = repo();
  const { adhoc, closed } = threeDeadRuns(root);
  const verdict = (dir) => (dir === adhoc ? { verdict: 'live', evidence: [] } : dir === closed ? { verdict: 'unknown', evidence: [] } : DEAD());
  const prStates = prStatesOf({ 11: { number: 11, state: 'CLOSED' } }, { 'feat-gone': null });
  const d = archiveMerged({ cwd: root, dryRun: true, prStates, runVerdict: verdict, integration: 'main' }).runDispositions;
  assert.deepEqual(d.wouldClose.map((w) => w.reason), ['nothing-to-resume']);
  assert.equal(d.unknown, 1);
  assert.deepEqual(d.orphaned, []);
});

test('a PR lookup failure leaves a formal run (gh-absent posture)', () => {
  const root = repo();
  threeDeadRuns(root);
  const d = archiveMerged({ cwd: root, dryRun: true, prStates: prStatesOf(), runVerdict: DEAD, integration: 'main' }).runDispositions;
  assert.deepEqual(d.wouldClose.map((w) => w.reason), ['adhoc-dead']);
});

test('a run this pass archived is not reported again (dry run)', () => {
  const root = repo();
  const stale = run(root, '2026-10-16T000000-adhoc-standalone', { state: { status: 'active', worktree: path.join(root, 'gone') } });
  const t = new Date(Date.now() - 31 * DAY);
  fs.utimesSync(stale, t, t);
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: DEAD, integration: 'main' });
  assert.ok(r.archived.includes(stale));
  assert.deepEqual(r.runDispositions.wouldClose, []);
});

test('QUIET_FLOOR_MS equals STALE_INTERRUPTED_TTL_MS', () => {
  assert.equal(QUIET_FLOOR_MS, STALE_INTERRUPTED_TTL_MS);
});
