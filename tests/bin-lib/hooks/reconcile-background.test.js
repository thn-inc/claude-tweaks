'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'hooks.js');

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

test('reconcile-background: writes a status file with completedAt + summary, exits 0 even with no gh/remote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@e.com'], dir);
  git(['config', 'user.name', 'T'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const result = execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.trim(), 'claude-tweaks: reconcile-background complete');

  const statusPath = path.join(dir, '.claude-tweaks', 'reconcile-background-status.json');
  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  assert.equal(typeof status.completedAt, 'number');
  assert.equal(status.surfaced, false);
  assert.equal(typeof status.summary, 'object');
});

// Task 10 review Critical finding fix-up: a second call within the
// freshness window must be a true no-op — it must not re-run reconcile()
// at all, and must not touch the status file in any way (no `completedAt`
// bump, no `surfaced` reset). Verified by comparing the raw file bytes
// before and after the second call: if the second call had rewritten
// anything, `completedAt` (a `Date.now()` millisecond value) would almost
// certainly differ, so byte-identity is a reliable proxy for "did not run".
test('reconcile-background: a second call within the freshness window is a no-op — it does not re-run reconcile() or touch the status file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-nop-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@e.com'], dir);
  git(['config', 'user.name', 'T'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const statusPath = path.join(dir, '.claude-tweaks', 'reconcile-background-status.json');

  const first = execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: dir, encoding: 'utf8' });
  assert.equal(first.trim(), 'claude-tweaks: reconcile-background complete');
  const firstRaw = fs.readFileSync(statusPath, 'utf8');

  const second = execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: dir, encoding: 'utf8' });
  assert.equal(second.trim(), 'claude-tweaks: reconcile-background complete', 'stdout is identical whether or not the pass actually ran — nothing reads this detached process\'s output');
  const secondRaw = fs.readFileSync(statusPath, 'utf8');

  assert.equal(secondRaw, firstRaw, 'a second call inside the freshness window must not touch the status file at all');
});

// Review finding: two sessions starting within the same short window could
// each independently spawn an overlapping reconcile-background pass — the
// lock is what actually prevents that (session-start.js's spawn-decision TTL
// gate is best-effort, not a mutex). A pre-existing lock held by a live pid
// (this test process's own pid, guaranteed alive for the duration of the
// call) must make the CLI skip entirely: no status-file touch, lock left
// untouched (not released by the loser).
test('reconcile-background: a lock already held by a live process is never taken over — no status-file write, lock left in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-locked-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@e.com'], dir);
  git(['config', 'user.name', 'T'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const lockDir = path.join(dir, '.claude-tweaks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, 'reconcile-background.lock');
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));

  const result = execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.trim(), 'claude-tweaks: reconcile-background complete (already running)');

  const statusPath = path.join(dir, '.claude-tweaks', 'reconcile-background-status.json');
  assert.equal(fs.existsSync(statusPath), false, 'a losing process must not write the status file at all');
  assert.equal(fs.existsSync(lockFile), true, 'a losing process must not release the winner\'s lock');
});

// A dead-pid lock (simulated by a pid no live process can plausibly hold —
// see worktree-reap.js's own isPidAlive contract) must be reclaimed, and the
// pass must complete and clean up its own lock afterward — no orphaned
// .lock file left behind on the success path.
test('reconcile-background: a stale (dead-pid) lock is reclaimed; a completed pass leaves no lock file behind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-stale-lock-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 't@e.com'], dir);
  git(['config', 'user.name', 'T'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);

  const lockDir = path.join(dir, '.claude-tweaks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, 'reconcile-background.lock');
  // PID 999999 is not a real process on any of this project's test runners.
  fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, startedAt: Date.now() }));

  const result = execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.trim(), 'claude-tweaks: reconcile-background complete');

  const statusPath = path.join(dir, '.claude-tweaks', 'reconcile-background-status.json');
  assert.equal(fs.existsSync(statusPath), true, 'a reclaimed lock must still let the pass run and report');
  assert.equal(fs.existsSync(lockFile), false, 'the lock must be released once the pass completes');
});

// #1687: mirrors tests/bin-lib/reconcile/archive-merged.test.js's own
// fixtureAbandonedShippedRun (an abandoned, stale, shipped 'interrupted' run
// whose worktree was torn down) — but this test drives the real
// `reconcile-background` CLI subcommand, not archiveMerged() in-process. The
// acceptance bar for #1687 is proof on the path that actually runs in
// production (session-start.js's spawn -> CLAUDE_TWEAKS_SESSION_ID env ->
// this subcommand -> reconcile({sessionId}) -> archiveMerged's ownership
// gate), not merely a unit test that passes sessionId as a function argument.
function fixtureAbandonedShippedRun({ runId, ownerSessionId } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-owner-')));
  git(['init', '-q', '-b', 'main'], root);
  git(['config', 'user.email', 't@e.com'], root);
  git(['config', 'user.name', 'T'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'init'], root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  // `integration-model: pr-first` is load-bearing here beyond what
  // archive-merged.test.js's own fixture needs: that file calls
  // archiveMerged() directly, bypassing reconcile()'s own
  // resolveIntegrationModel gate entirely, but this test drives the real
  // reconcile-background CLI, which skips every check (including 'archive')
  // under the default local-merge model.
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\nintegration-model: pr-first\n');

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-owner-wt-'));
  git(['worktree', 'add', '-q', wt, '-b', 'feat-branch'], root);
  fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], {
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' },
  });
  git(['merge', '-q', '--no-edit', 'feat-branch'], root);
  git(['worktree', 'remove', '--force', wt], root); // branch ref stays, worktree gone

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const runState = { status: 'interrupted', worktree: wt, pr: { branch: 'feat-branch' } };
  if (ownerSessionId) runState.sessionId = ownerSessionId;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  // Far outside the 24h staleness window — satisfies both checkRunIntegrity's
  // shipped-unclosed evidence bar and lastOwnEventMs' recency check.
  const seedEvent = '{"skill":"claude-tweaks:build","ts":"2020-01-01T09:05:00.000Z","type":"skill_invoked"}';
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${seedEvent}\n`);

  return { root, runDir };
}

test('reconcile-background: an abandoned interrupted run owned by CLAUDE_TWEAKS_SESSION_ID is never archived, on the real CLI path (#1687)', () => {
  const runId = '2026-08-01T090000-record-1687-live';
  const { root, runDir } = fixtureAbandonedShippedRun({ runId, ownerSessionId: 'sess-1687-live' });

  execFileSync('node', [HOOKS, 'reconcile-background'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_TWEAKS_SESSION_ID: 'sess-1687-live' },
  });

  assert.equal(fs.existsSync(runDir), true, 'the owned run dir must still exist — never archived');
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'interrupted');
});

// AC2's control case: with no session id resolvable at all (the env var
// absent, as it was before this fix), behavior is unchanged — the other two
// gates (24h staleness + shipped-unclosed evidence) still govern alone and
// this same shape of run is still archived.
test('reconcile-background: the same abandoned interrupted run IS archived when CLAUDE_TWEAKS_SESSION_ID is unset (control — unchanged fallback behavior, #1687 AC2)', () => {
  const runId = '2026-08-01T090000-record-1687-noown';
  const { root, runDir } = fixtureAbandonedShippedRun({ runId, ownerSessionId: 'sess-1687-someone-else' });

  const env = { ...process.env };
  delete env.CLAUDE_TWEAKS_SESSION_ID;
  execFileSync('node', [HOOKS, 'reconcile-background'], { cwd: root, encoding: 'utf8', env });

  assert.equal(fs.existsSync(runDir), false, 'expected the original run dir to have been archived away');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const state = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.equal(state.status, 'clean');
});

// The status file's `summary` is built from reconcile()'s result. Drives the
// real `reconcile-background` branch of main() in-process with reconcile()
// stubbed (the same module-object stub tests/reconcile.test.js's AC3.1 uses),
// so no git remote or `gh` is involved. process.cwd() is what that branch
// reads, so the test switches into the fixture repo and back.
async function backgroundSummaryFor(result) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-bg-summary-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  const { main } = require('../../../plugin/bin/hooks');
  const reconcileMod = require('../../../plugin/bin/lib/reconcile');
  const originalReconcile = reconcileMod.reconcile;
  const originalWrite = process.stdout.write;
  const originalCwd = process.cwd();
  reconcileMod.reconcile = async () => result;
  process.stdout.write = () => true;
  try {
    process.chdir(dir);
    assert.equal(await main(['node', 'hooks.js', 'reconcile-background']), 0);
  } finally {
    process.chdir(originalCwd);
    reconcileMod.reconcile = originalReconcile;
    process.stdout.write = originalWrite;
  }
  return JSON.parse(fs.readFileSync(path.join(dir, '.claude-tweaks', 'reconcile-background-status.json'), 'utf8')).summary;
}

test('reconcile-background summary: counts each check\'s taken entries (characterization, incl. prunedRemote)', async () => {
  const summary = await backgroundSummaryFor({
    claims: [{ action: 'released' }, { action: 'skipped' }],
    runs: [{ action: 'archived' }],
    branches: [{ kind: 'branch', action: 'delete' }, { kind: 'branch', action: 'tag-and-delete' }, { kind: 'tag', action: 'delete' }],
    remoteBranches: [{ action: 'delete' }, { action: 'delete' }, { action: 'skip' }],
    worktrees: [{ action: 'reaped' }, { action: 'skipped', path: '/w/a', reason: 'pr-open' }, { action: 'skipped', path: '/w/b', reason: 'in use by a live session' }],
    skipped: [{ check: 'release', reason: 'x' }],
  });
  assert.equal(summary.released, 1);
  assert.equal(summary.archived, 1);
  assert.equal(summary.archivedBranches, 2);
  assert.equal(summary.prunedRemote, 2);
  assert.equal(summary.reaped, 1);
  assert.deepEqual(summary.notableWorktrees, [{ path: '/w/a', reason: 'pr-open' }]);
  assert.deepEqual(summary.skipped, [{ check: 'release', reason: 'x' }]);
});

test('reconcile-background summary: ledger-residue PRs opened and notable per-path skips (#3812)', async () => {
  const summary = await backgroundSummaryFor({
    ledgerResidue: [
      { path: 'docs/plans/a-ledger.md', action: 'pr-opened', reason: 'removal-pr-opened', prNumber: 90 },
      { path: 'docs/plans/b-ledger.md', action: 'pr-opened', reason: 'removal-pr-opened', prNumber: 90 },
      { path: 'docs/plans/c-ledger.md', action: 'skip', reason: 'ledger-has-open-rows' },
      { path: 'docs/plans/d-ledger.md', action: 'skip', reason: 'removal-pr-open', prNumber: 88 },
      { path: 'docs/plans/e-ledger.md', action: 'skip', reason: 'run-live' },
      { path: 'docs/plans/f-ledger.md', action: 'skip', reason: 'removal-pr-declined', prNumber: 70 },
    ],
  });
  assert.equal(summary.ledgerResiduePrOpened, 1, 'two paths in one PR count as one PR opened');
  assert.deepEqual(summary.notableLedgerResidue, [
    { path: 'docs/plans/c-ledger.md', reason: 'ledger-has-open-rows' },
    { path: 'docs/plans/d-ledger.md', reason: 'removal-pr-open', prNumber: 88 },
  ]);
  const empty = await backgroundSummaryFor({});
  assert.equal(empty.ledgerResiduePrOpened, 0);
  assert.deepEqual(empty.notableLedgerResidue, []);
});

// Task 10 review Important #3: pin the FAST_CHECKS/BACKGROUND_CHECKS
// partition invariant — a future check added to reconcile/index.js's
// ALL_CHECKS that isn't also added to exactly one of these two lists must
// fail loudly here instead of silently belonging to neither the fast nor
// the background path (dropped entirely) or both (duplicated work).
test('FAST_CHECKS (session-start.js) + BACKGROUND_CHECKS (bin/hooks.js) partition reconcile/index.js\'s ALL_CHECKS exactly', () => {
  const { FAST_CHECKS } = require('../../../plugin/bin/lib/hooks/session-start');
  const { BACKGROUND_CHECKS } = require('../../../plugin/bin/hooks');
  const { ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');

  assert.ok(Array.isArray(FAST_CHECKS) && FAST_CHECKS.length, 'FAST_CHECKS must be a non-empty array');
  assert.ok(Array.isArray(BACKGROUND_CHECKS) && BACKGROUND_CHECKS.length, 'BACKGROUND_CHECKS must be a non-empty array');

  const combined = [...FAST_CHECKS, ...BACKGROUND_CHECKS];
  assert.equal(combined.length, new Set(combined).size, 'FAST_CHECKS and BACKGROUND_CHECKS must not overlap');
  assert.deepEqual(
    [...combined].sort(),
    [...ALL_CHECKS].sort(),
    'FAST_CHECKS + BACKGROUND_CHECKS must partition ALL_CHECKS exactly — nothing dropped, nothing duplicated',
  );
});
