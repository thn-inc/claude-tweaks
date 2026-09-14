'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { reapMerged, isOwnCwd, decideReap, trackReapResidue } = require('../../../plugin/bin/lib/reconcile/reap-merged');
const { writeRunState } = require('../../../plugin/bin/lib/hooks/context');
const { listResidueFailures, RESIDUE_ESCALATE_THRESHOLD } = require('../../../plugin/bin/lib/reconcile/cache');
const { reconcile } = require('../../../plugin/bin/lib/reconcile');
const { residueBody } = require('../../../plugin/bin/lib/reconcile/escalate-residue');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// resolvePrState (pr-state.js) shells to `gh pr list` and is not injectable
// (reap-merged.js `const { resolvePrState } = require('./pr-state')` binds
// the function value at module load — reassigning the pr-state.js export
// afterward doesn't reach it, same caveat prune-remote.test.js/
// pr-state.test.js already document) — intercept at the process-spawn
// boundary via a `gh` wrapper placed first on PATH.
function installGhWrapper(prsJson) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(wrapperPath, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(prsJson)}\nEOF\n`);
  fs.chmodSync(wrapperPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

// Main checkout + a linked worktree under the harness domain (.claude/worktrees/,
// the only domain reapMerged ever considers), plus a pipeline run dir whose
// run-state.json names that worktree — the join reapMerged's own audit-trail
// write (review finding) needs to find the owning run.
function buildReapableFixture() {
  // realpathSync immediately, like every other fixture root in this suite
  // (e.g. tests/run-integrity.test.js, tests/reconcile.test.js) — on macOS
  // os.tmpdir() resolves through the /var -> /private/var symlink, and
  // reapMerged's own `real` (safeReal(wt.path), used both for the domain
  // check and the value passed to releasePorts) is always realpath'd. A
  // non-realpath'd root here made this fixture's own `wtPath` — built by
  // joining onto the un-resolved root — a different string from the one
  // reapMerged actually hands to releasePorts, so the #1793 assertions
  // below never matched on a real Mac (#1900).
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-root-')));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'init');

  const wtPath = path.join(root, '.claude', 'worktrees', 'issue-1');
  git(root, 'worktree', 'add', '-q', '-b', 'worktree-issue-1', wtPath);

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-test-run');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { worktree: wtPath, status: 'active' });

  return { root, wtPath, runDir };
}

test('reapMerged: a merged-PR worktree is removed and logs a worktree-reaped event to its owning run', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  let result;
  try {
    result = reapMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.equal(result.reaped.length, 1, `expected exactly one reaped worktree, got: ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(wtPath), false);

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const reapedEvent = events.find((e) => e.type === 'worktree-reaped');
  assert.ok(reapedEvent, `expected a worktree-reaped event, got: ${JSON.stringify(events)}`);
  assert.equal(reapedEvent.prNumber, 42);
});

test('reapMerged: a closed-unmerged PR is skipped (never reaped) and logs worktree-reap-skipped, not worktree-reaped', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 7, state: 'CLOSED', mergedAt: null, updatedAt: '2026-01-01T00:00:00Z' }]);
  let result;
  try {
    result = reapMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.equal(result.reaped.length, 0);
  assert.equal(fs.existsSync(wtPath), true);

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.some((e) => e.type === 'worktree-reaped'), false);
  const skipEvent = events.find((e) => e.type === 'worktree-reap-skipped');
  assert.ok(skipEvent, `expected a worktree-reap-skipped event, got: ${JSON.stringify(events)}`);
  assert.equal(skipEvent.reason, 'pr-closed-unmerged');
});

// QUIET_SKIP_REASONS ('in-use' among them) must stay quiet in events.jsonl
// too — the same noise-reduction convention the SessionStart banner already
// applies (worktree-reap.js), so a live session's own worktree doesn't get a
// fresh log line every ~7-minute background pass for the length of a session.
test('reapMerged: an in-use (locked) worktree is skipped silently — no events.jsonl entry at all', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  // A live lock, same mechanism EnterWorktree uses: the reason string embeds
  // this test process's own (guaranteed-alive) pid, so lockVerdict() reads
  // 'in-use' rather than 'orphaned'.
  git(root, 'worktree', 'lock', wtPath, '--reason', `claude session test (pid ${process.pid} start now)`);

  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  let result;
  try {
    result = reapMerged({ cwd: root });
  } finally {
    wrapper.restore();
  }
  assert.equal(result.reaped.length, 0);
  assert.equal(result.skipped.length, 1, `expected exactly one skipped entry, got: ${JSON.stringify(result)}`);
  assert.equal(result.skipped[0].reason, 'in-use');

  assert.equal(fs.existsSync(path.join(runDir, 'events.jsonl')), false, 'a quiet skip reason must never write events.jsonl at all');
});

// ─── #1793: port-lease release after a successful reap ────────────────────
// Same rationale as worktree-reap.test.js's #1793 block for not forcing a
// removal failure: no existing test in this file does either.

test('#1793: reapMerged calls releasePorts with the removed realpath after a successful reap', () => {
  const { root, wtPath } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  const calls = [];
  let result;
  try {
    result = reapMerged({ cwd: root, releasePorts: (p) => calls.push(p) });
  } finally {
    wrapper.restore();
  }
  assert.deepEqual(result.reaped, [wtPath]);
  assert.deepEqual(calls, [wtPath]);
  assert.deepEqual(result.portsRelease, [], 'no note on a successful release');
});

test('#1793: a releasePorts throw is recorded as a portsRelease note and never changes the reap outcome', () => {
  const { root, wtPath } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  let result;
  try {
    result = reapMerged({ cwd: root, releasePorts: () => { throw new Error('registry unwritable'); } });
  } finally {
    wrapper.restore();
  }
  assert.deepEqual(result.reaped, [wtPath], 'the reap outcome is unaffected by a release failure');
  assert.equal(fs.existsSync(wtPath), false, 'the worktree is still gone — release failing does not undo the removal');
  assert.deepEqual(result.portsRelease, [{ path: wtPath, note: 'failed: registry unwritable' }]);
});

test('#1793: a removed path with no lease is a no-op release with no note', () => {
  const { root, wtPath } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  // registry.release() itself no-ops for an unknown path (#1791 AC6) — the
  // real release function proves the "no note" half of this without a fake.
  const { release } = require('../../../plugin/bin/lib/ports/registry');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reap-merged-ports-home-'));
  let result;
  try {
    result = reapMerged({ cwd: root, releasePorts: (p) => release(p, { home }) });
  } finally {
    wrapper.restore();
  }
  assert.deepEqual(result.reaped, [wtPath]);
  assert.deepEqual(result.portsRelease, []);
});

// #644 Deliverable 1 — a session standing inside its own worktree must never
// reap it, even with a merged PR and no lock file at all (the exact gap the
// issue reports: isWorktreeLocked alone never catches this).
test('isOwnCwd: true for the exact path and for any path underneath it; false otherwise', () => {
  assert.equal(isOwnCwd('/a/wt', '/a/wt'), true);
  assert.equal(isOwnCwd('/a/wt/sub/dir', '/a/wt'), true);
  assert.equal(isOwnCwd('/a/other', '/a/wt'), false);
  assert.equal(isOwnCwd('/a/wt2', '/a/wt'), false, 'must not match on a bare prefix without the separator');
  assert.equal(isOwnCwd(null, '/a/wt'), false, 'unresolvable cwd fails closed to false — the caller has nothing to compare');
});

test('reapMerged: never reaps the worktree the caller is standing in — merged PR, no lock, still skipped with a distinct reason', () => {
  const { root, wtPath, runDir } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  let result;
  try {
    result = reapMerged({ cwd: wtPath }); // the caller's own cwd IS the candidate worktree
  } finally {
    wrapper.restore();
  }
  assert.equal(result.reaped.length, 0, `expected nothing reaped, got: ${JSON.stringify(result)}`);
  assert.equal(fs.existsSync(wtPath), true, 'the worktree must still exist on disk');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'own-cwd');
  assert.notEqual(result.skipped[0].reason, 'in-use', 'own-cwd must be distinguishable from a lock-based skip');

  // A worktree containing the caller's own cwd but not equal to it (cwd one
  // level deeper) is caught the same way.
  const nested = path.join(wtPath, 'src');
  fs.mkdirSync(nested, { recursive: true });
  const result2 = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  let r2;
  try {
    r2 = reapMerged({ cwd: nested });
  } finally {
    result2.restore();
  }
  assert.equal(r2.reaped.length, 0);
  assert.equal(r2.skipped[0].reason, 'own-cwd');
  void runDir;
});

// #644 Deliverable 2 — a worktree that repeatedly fails `git worktree
// remove` accumulates a persisted per-path failure count, escalating once
// it crosses cache.js's threshold and never re-escalating on later still-
// failing passes.
test('reapMerged: removal-failed tracks a consecutive-failure streak and escalates once at the threshold', () => {
  const { root, wtPath } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  // A file inside the worktree with no write permission on its parent isn't
  // reliably enough to fail `git worktree remove` across environments —
  // instead, lock the worktree with a DEAD pid so isWorktreeLocked reads it
  // as free (unknown/orphaned, not in-use) while `git worktree remove`
  // itself still refuses because the lock file is present and the command
  // is run without `--force`.
  execFileSync('git', ['worktree', 'lock', wtPath, '--reason', 'stuck'], { cwd: root, stdio: 'ignore' });
  // Undo isWorktreeLocked's own "locked" read by not giving it a live pid —
  // this fixture's lock reason has no `(pid N)`, so lockVerdict reads
  // 'unknown', which isWorktreeLocked treats as NOT in-use (only a
  // confirmed-alive pid is 'in-use') — decideReap proceeds to the removal
  // attempt, which `git worktree remove` (no --force) then refuses because
  // the worktree is locked.
  try {
    let last;
    for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
      last = reapMerged({ cwd: root });
      assert.equal(last.reaped.length, 0);
      assert.equal(last.skipped[0].reason, 'removal-failed', `pass ${i + 1}: ${JSON.stringify(last)}`);
    }
    const stuck = listResidueFailures(root);
    assert.equal(stuck.length, 1, `expected exactly one tracked residue entry, got: ${JSON.stringify(stuck)}`);
    assert.equal(stuck[0].reason, 'removal-failed');
    assert.equal(stuck[0].count, RESIDUE_ESCALATE_THRESHOLD);
    assert.equal(stuck[0].escalated, true, 'threshold reached — must be marked escalated');
  } finally {
    wrapper.restore();
  }
});

// #1341 — reapMerged's removal-failed branch used to thread the bare
// FAILURE.* category string ('git-error') through as lastError, discarding
// git's actual stderr. This pins that the residue cache now carries git's
// real message instead.
test('reapMerged: removal-failed threads git\'s real stderr through as lastError, not the bare "git-error" category', () => {
  const { root, wtPath } = buildReapableFixture();
  const wrapper = installGhWrapper([{ number: 9, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);
  execFileSync('git', ['worktree', 'lock', wtPath, '--reason', 'stuck'], { cwd: root, stdio: 'ignore' });
  try {
    const result = reapMerged({ cwd: root });
    assert.equal(result.skipped[0].reason, 'removal-failed', `expected removal-failed, got: ${JSON.stringify(result)}`);

    const stuck = listResidueFailures(root);
    assert.equal(stuck.length, 1, `expected exactly one tracked residue entry, got: ${JSON.stringify(stuck)}`);
    assert.notEqual(stuck[0].lastError, 'git-error', 'lastError must not be the bare category string');
    assert.match(stuck[0].lastError, /lock/i,
      `expected git's real "cannot remove a locked working tree" message, got: ${JSON.stringify(stuck[0].lastError)}`);
  } finally {
    wrapper.restore();
  }
});

test('trackReapResidue: escalates exactly once at the threshold via an injected escalate, never on later still-failing calls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-track-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackReapResidue(root, 'o/r', '/x/wt', { failed: true, lastError: 'removal-failed' }, { escalate });
  }
  assert.equal(calls.length, 1, `expected exactly one escalation call, got ${calls.length}`);
  assert.equal(calls[0].reason, 'removal-failed');
  assert.equal(calls[0].targetPath, '/x/wt');
  assert.equal(calls[0].count, RESIDUE_ESCALATE_THRESHOLD);

  // Further still-failing calls never re-escalate.
  trackReapResidue(root, 'o/r', '/x/wt', { failed: true, lastError: 'removal-failed' }, { escalate });
  assert.equal(calls.length, 1);

  // A success clears the streak; escalation still never happened again as
  // part of that clear.
  trackReapResidue(root, 'o/r', '/x/wt', { failed: false }, { escalate });
  assert.equal(calls.length, 1);
});

// #1341 acceptance criterion — trackReapResidue's `escalate` call must carry
// real captured stderr as `lastError`, not the literal string 'git-error'.
test('trackReapResidue: escalate\'s lastError carries real captured stderr, not the literal string "git-error"', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-track3-'));
  const calls = [];
  const escalate = (args) => { calls.push(args); return { status: 'filed', number: 1 }; };
  const realStderr = 'fatal: cannot remove a locked working tree, lock reason: stuck\nuse \'remove -f -f\' to override or unlock first';

  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    trackReapResidue(root, 'o/r', '/x/wt', { failed: true, lastError: realStderr }, { escalate });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lastError, realStderr);
  assert.notEqual(calls[0].lastError, 'git-error', 'escalate must receive git\'s real message, not the bare category');
});

// #1341 acceptance criterion — the resulting escalation body's "Last error"
// line must contain actual git output, not a bare category name.
test('residueBody: the rendered "Last error" line carries actual git output, not a bare category name', () => {
  const realStderr = 'fatal: cannot remove a locked working tree, lock reason: stuck';
  const { body } = residueBody({
    reason: 'removal-failed', targetPath: '/x/wt', count: RESIDUE_ESCALATE_THRESHOLD,
    firstFailedAt: Date.now(), lastError: realStderr,
  });
  const lastErrorLine = body.split('\n').find((l) => l.startsWith('**Last error:**'));
  assert.ok(lastErrorLine, `expected a "Last error" line, got body: ${body}`);
  assert.equal(lastErrorLine, `**Last error:** ${realStderr}`);
  assert.notEqual(lastErrorLine, '**Last error:** git-error', 'must not regress to the bare category string');
});

test('trackReapResidue: never throws when escalate itself throws (best-effort)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-track2-'));
  const escalate = () => { throw new Error('gh not found'); };
  for (let i = 0; i < RESIDUE_ESCALATE_THRESHOLD; i++) {
    assert.doesNotThrow(() => trackReapResidue(root, 'o/r', '/x/wt', { failed: true, lastError: 'x' }, { escalate }));
  }
});

// #644 review fix — a merged-PR worktree the caller is standing in with no
// lock file, reaped only when going through the SAME entry point the rest
// of this suite exercises reapMerged directly through (`reapMerged({cwd:
// wtPath})`, above). The real production call path is index.js's
// `reconcile()` dispatcher, which resolves `root` from the caller's cwd
// FIRST and previously passed that already-resolved `root` — never the
// caller's actual cwd — down to reapMerged, making isOwnCwd's comparison
// always false in practice (root is never itself nor an ancestor of the
// worktree it's checking): the own-cwd guard existed but was unreachable
// through the one path real callers use. A direct reapMerged({cwd: wtPath})
// call bypasses this entirely and gives false confidence — this test goes
// through reconcile() itself to close that gap.
function buildReapableFixtureWithRemote() {
  const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originDir], { stdio: 'ignore' });

  // `origin/HEAD` (what resolveIntegrationBranch reads) is only set by a
  // clone taken AFTER origin already has a commit — a bare `git init` alone
  // has no HEAD to symlink to. Seed origin from a throwaway clone first,
  // exactly like tests/reconcile.test.js's own pairedFixture() does, then
  // clone again into the fixture's real main checkout.
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-seed-'));
  execFileSync('git', ['clone', '-q', originDir, seedDir], { stdio: 'ignore' });
  git(seedDir, 'config', 'user.email', 't@t');
  git(seedDir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(seedDir, 'a.txt'), 'a\n');
  git(seedDir, 'add', 'a.txt');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'push', '-q', 'origin', 'main');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-merged-remote-root-'));
  execFileSync('git', ['clone', '-q', originDir, root], { stdio: 'ignore' });
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');

  // reconcile()'s pr-first branch is policy-gated, not auto-detected from a
  // local bare-repo origin URL — force it explicitly, same as this repo's
  // other full-reconcile() fixtures (tests/reconcile.test.js's D2 test).
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  git(root, 'add', '.claude-tweaks/policy.yml');
  git(root, 'commit', '-q', '-m', 'policy');
  git(root, 'push', '-q', 'origin', 'main');

  const wtPath = path.join(root, '.claude', 'worktrees', 'issue-1');
  git(root, 'worktree', 'add', '-q', '-b', 'worktree-issue-1', wtPath);

  return { root, wtPath };
}

test('reconcile(): the real dispatcher never reaps the worktree the caller is standing in (#644 review fix — reachable only through index.js, not a direct reapMerged() call)', async () => {
  const { wtPath } = buildReapableFixtureWithRemote();
  const preflight = require('../../../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  const wrapper = installGhWrapper([{ number: 42, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]);

  let result;
  try {
    result = await reconcile({ cwd: wtPath, checks: ['reap'] });
  } finally {
    wrapper.restore();
    preflight.ghHealthCheck = originalHealth;
  }

  assert.equal(fs.existsSync(wtPath), true, 'the worktree the caller is standing in must survive a real reconcile() call');
  assert.ok(Array.isArray(result.worktrees), `expected a worktrees array, got: ${JSON.stringify(result)}`);
  const realWt = fs.realpathSync(wtPath);
  const entry = result.worktrees.find((w) => w.path === realWt);
  assert.ok(entry, `expected an entry for the own-cwd worktree, got: ${JSON.stringify(result.worktrees)}`);
  assert.equal(entry.action, 'skipped');
  assert.equal(entry.reason, 'own-cwd', `expected 'own-cwd', got: ${JSON.stringify(entry)}`);
});
