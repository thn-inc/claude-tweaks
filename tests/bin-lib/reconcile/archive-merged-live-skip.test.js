'use strict';
// tests/bin-lib/reconcile/archive-merged-live-skip.test.js — #3977: no archive
// path acts on a run whose run-liveness verdict is `live`; the merged,
// orphaned-mint and adhoc-superseded paths still act on `unknown`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { archiveMerged } = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { pidStartTime } = require('../../../plugin/bin/lib/run-liveness/process-probe');

const DAY = 24 * 60 * 60 * 1000;
const LIVE = () => ({ verdict: 'live', evidence: [{ probe: 'owner-pid', result: 'positive', detail: 'alive' }] });
const UNKNOWN = () => ({ verdict: 'unknown', evidence: [] });

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// A main checkout on `main` with one merged feature branch; `work-backend:
// local-files` keeps the merged path's GitHub record check out of the picture.
function repo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-live-skip-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nwork-backend: local-files\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.claude-tweaks/\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'checkout', '-q', '-b', 'feat');
  fs.writeFileSync(path.join(root, 'f.txt'), 'x');
  git(root, 'add', 'f.txt');
  git(root, 'commit', '-q', '-m', 'feat');
  git(root, 'checkout', '-q', 'main');
  git(root, 'merge', '-q', '--no-ff', '-m', 'merge feat', 'feat');
  return { root, mergeSha: git(root, 'rev-parse', 'HEAD') };
}

function runDir(root, name, { state, config = true, ageMs = 0 } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(dir, { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, 'config.yml'), 'mode: auto\n');
  if (state) fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, t, t);
  }
  return dir;
}

// The merged path through the by-number fallback (no worktree stamped).
function mergedFixture() {
  const { root, mergeSha } = repo();
  const dir = runDir(root, '2026-10-01T000000-topic-merged', { state: { status: 'active', pr: { number: 5 } } });
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true }));
  const prStates = {
    byNumber: () => ({ number: 5, state: 'MERGED', mergeCommit: { oid: mergeSha }, closingIssuesReferences: [] }),
    byBranch: () => null,
  };
  return { root, dir, prStates };
}

test('live skips the merged path', () => {
  const { root, dir, prStates } = mergedFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, prStates, runVerdict: LIVE, integration: 'main' });
  assert.ok(!r.archived.includes(dir), JSON.stringify(r));
  assert.deepEqual(r.skipped.find((s) => s.runDir === dir), { runDir: dir, reason: 'live' });
});

test('unknown still acts on the merged path', () => {
  const { root, dir, prStates } = mergedFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, prStates, runVerdict: UNKNOWN, integration: 'main' });
  assert.ok(r.archived.includes(dir), JSON.stringify(r));
});

function orphanedMintFixture() {
  const { root } = repo();
  const dir = runDir(root, '2026-10-01T000000-record-77', { state: { status: 'active' }, config: false, ageMs: 2 * DAY });
  return { root, dir };
}

test('live skips orphaned-mint', () => {
  const { root, dir } = orphanedMintFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: LIVE });
  assert.ok(!r.archived.includes(dir), JSON.stringify(r));
  assert.equal(r.skipped.find((s) => s.runDir === dir).reason, 'live');
});

test('unknown still acts on orphaned-mint', () => {
  const { root, dir } = orphanedMintFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: UNKNOWN });
  assert.ok(r.archived.includes(dir), JSON.stringify(r));
});

function adhocSupersededFixture() {
  const { root } = repo();
  const dir = runDir(root, '2026-10-01T000000-adhoc-standalone', {
    state: { status: 'active', worktree: path.join(root, 'gone-worktree') }, config: false, ageMs: 31 * DAY,
  });
  return { root, dir };
}

test('live skips adhoc-superseded', () => {
  const { root, dir } = adhocSupersededFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: LIVE });
  assert.ok(!r.archived.includes(dir), JSON.stringify(r));
  assert.equal(r.skipped.find((s) => s.runDir === dir).reason, 'live');
});

test('unknown still acts on adhoc-superseded', () => {
  const { root, dir } = adhocSupersededFixture();
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: UNKNOWN });
  assert.ok(r.archived.includes(dir), JSON.stringify(r));
});

test('live skips adhoc-session-ended', () => {
  const { root } = repo();
  const dir = runDir(root, '2026-10-01T000000-adhoc-standalone', {
    state: { status: 'active', worktree: root }, config: false, ageMs: 8 * DAY,
  });
  const dead = archiveMerged({ cwd: root, dryRun: true, runVerdict: UNKNOWN, liveness: () => 'dead' });
  assert.ok(dead.archived.includes(dir), `control: the sweep acts without the live skip, got ${JSON.stringify(dead)}`);
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: LIVE, liveness: () => 'dead' });
  assert.ok(!r.archived.includes(dir), JSON.stringify(r));
  assert.equal(r.skipped.find((s) => s.runDir === dir).reason, 'live');
});

// The #3845 shape: stamped `interrupted` by a nested session's SessionEnd while
// the owner process is still alive. Real probes — no runVerdict injection.
test('a falsely interrupted run with a live owner pid is live and left by abandoned-interrupted', () => {
  const { root } = repo();
  const startedAt = pidStartTime(process.pid);
  assert.ok(typeof startedAt === 'string' && startedAt, 'ps must report this process start time');
  const old = new Date(Date.now() - 4 * DAY).toISOString();
  const dir = runDir(root, '2026-10-01T000000-record-88', {
    state: {
      status: 'interrupted', lastEvent: 'session-end', sessionId: 'S1',
      owner: { sessionId: 'S1', host: os.hostname(), pid: process.pid, pidSource: 'env', pidStartedAt: startedAt, heartbeatAt: old },
    },
  });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ ts: old, type: 'session-end', sessionId: 'S1' })}\n`);
  const r = archiveMerged({ cwd: root, dryRun: true, sessionId: null });
  assert.ok(!r.archived.includes(dir), JSON.stringify(r));
  assert.equal(r.skipped.find((s) => s.runDir === dir).reason, 'live');
});

test('no run-state.json reads unknown at the guard without asking', () => {
  const { root } = repo();
  const dir = runDir(root, '2026-10-01T000000-record-99', { config: false, ageMs: 2 * DAY });
  const asked = [];
  const r = archiveMerged({ cwd: root, dryRun: true, runVerdict: (d) => { asked.push(d); return LIVE(); } });
  assert.ok(!asked.includes(dir), 'a state-less dir is never asked');
  assert.ok(r.archived.includes(dir), `a state-less stale mint still archives as orphaned-mint, got ${JSON.stringify(r)}`);
});

test('the verdict is computed once per run', () => {
  const { root } = repo();
  const a = runDir(root, '2026-10-01T000000-record-1', { state: { status: 'interrupted', sessionId: 'X' } });
  const b = runDir(root, '2026-10-02T000000-record-2', { state: { status: 'active' } });
  fs.writeFileSync(path.join(a, 'events.jsonl'), `${JSON.stringify({ ts: new Date(Date.now() - 3 * DAY).toISOString(), type: 'x' })}\n`);
  const asked = [];
  archiveMerged({ cwd: root, dryRun: true, runVerdict: (d) => { asked.push(d); return UNKNOWN(); } });
  assert.equal(asked.filter((d) => d === a).length, 1);
  assert.equal(asked.filter((d) => d === b).length, 1);
});
