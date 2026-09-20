'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  decideRelease, releasedEntry, writeTombstone, releaseMerged, shouldSkipClaimRead,
} = require('../../../plugin/bin/lib/reconcile/release-merged');
const { readCache, writeCache } = require('../../../plugin/bin/lib/reconcile/cache');
const { GRANT_LABELS } = require('../../../plugin/bin/lib/release-claim/release');

// AC1: open PR always wins over issue-closed evidence
test('decideRelease: live claim + open PR + closed issue -> skip pr-open', () => {
  assert.deepStrictEqual(
    decideRelease('live', { number: 7, state: 'OPEN' }, 'CLOSED'),
    { action: 'skip', reason: 'pr-open' },
  );
});

// AC2: issue-closed evidence releases on no-pr and pr-closed-unmerged joins
test('decideRelease: live claim + no PR + closed issue -> release (issue-closed)', () => {
  const r = decideRelease('live', null, 'CLOSED');
  assert.strictEqual(r.action, 'release');
  assert.match(r.reason, /^issue-closed/);
});
test('decideRelease: stale claim + closed-unmerged PR + closed issue -> release', () => {
  const r = decideRelease('stale', { number: 7, state: 'CLOSED' }, 'CLOSED');
  assert.strictEqual(r.action, 'release');
  assert.match(r.reason, /^issue-closed/);
});

// AC3: open or unknown issue state never releases without merged-PR evidence
test('decideRelease: live claim + no PR + open issue -> skip', () => {
  assert.strictEqual(decideRelease('live', null, 'OPEN').action, 'skip');
});
test('decideRelease: live claim + no PR + unknown issue state (fetch failed) -> skip', () => {
  assert.strictEqual(decideRelease('live', null, undefined).action, 'skip');
});

// Unchanged behavior: merged-PR evidence, transports, non-candidates
test('decideRelease: merged PR still releases regardless of issue state', () => {
  assert.strictEqual(decideRelease('live', { number: 7, state: 'MERGED' }, 'OPEN').action, 'release');
});
test('decideRelease: transport failures still skip even with closed issue', () => {
  assert.strictEqual(decideRelease('live', 'gh-absent', 'CLOSED').action, 'skip');
  assert.strictEqual(decideRelease('live', 'network-failure', 'CLOSED').action, 'skip');
});
test('decideRelease: tombstone/absent/unreadable never release on issue-closed', () => {
  assert.strictEqual(decideRelease('tombstone', null, 'CLOSED').action, 'skip');
  assert.strictEqual(decideRelease('absent', null, 'CLOSED').action, 'skip');
  assert.strictEqual(decideRelease('unreadable', null, 'CLOSED').action, 'skip');
});

// AC2 caller-dereference: released entry tolerates null / non-object prState
test('releasedEntry: null prState -> prNumber null, no throw', () => {
  assert.deepStrictEqual(releasedEntry(42, 'run-x', null), { issueNumber: 42, runId: 'run-x', prNumber: null });
});
test('releasedEntry: merged prState carries its number', () => {
  assert.deepStrictEqual(releasedEntry(42, 'run-x', { number: 9, state: 'MERGED' }), { issueNumber: 42, runId: 'run-x', prNumber: 9 });
});

// The reconciler's PUT is composed by the shared release-claim module — one write path
// for every release (Section E CLI, reconciler). Pin the adapter's contract: it delegates
// to release-claim's writeTombstone with owner/repo split from the slug and the issue
// number parsed from the blob name, and maps any throw to false.
test('writeTombstone adapter delegates to bin/lib/release-claim/release.js writeTombstone', () => {
  assert.equal(typeof writeTombstone, 'function', 'adapter is exported for this pin');
  const seen = [];
  const ok = writeTombstone('acme/w', 'issue-42.json', 'sha42', '{"released":true}', 'merged: reconciled from PR #7', (args) => { seen.push(args); return '{}'; });
  assert.equal(ok, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].slice(0, 4), ['api', '--method', 'PUT', 'repos/acme/w/contents/claims/issue-42.json']);
  assert.ok(seen[0].includes('sha=sha42'));
  assert.ok(seen[0].some((a) => /^message=Release claim issue-42\.json — merged: reconciled from PR #7$/.test(a)));
  assert.equal(writeTombstone('acme/w', 'issue-42.json', 'sha42', '{}', 'r', () => { throw new Error('HTTP 422'); }), false);
});

test('shouldSkipClaimRead: matching cached sha skips the read', () => {
  assert.equal(shouldSkipClaimRead({ name: 'issue-7.json', sha: 'abc' }, 'abc'), true);
});
test('shouldSkipClaimRead: different sha does not skip', () => {
  assert.equal(shouldSkipClaimRead({ name: 'issue-7.json', sha: 'abc' }, 'different'), false);
});
test('shouldSkipClaimRead: no cached entry (undefined) does not skip — first sighting always reads', () => {
  assert.equal(shouldSkipClaimRead({ name: 'issue-7.json', sha: 'abc' }, undefined), false);
});

test('releaseMerged: a tombstoned claim with an unchanged sha is never re-fetched on the next pass', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-cache-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });

  let readCalls = 0;
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-7.json', sha: 'tombstone-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-7.json')) {
      readCalls += 1;
      return { stdout: JSON.stringify({ content: JSON.stringify({ released: true }), sha: 'tombstone-sha' }), failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  await releaseMerged({ cwd: root, ghApi }); // first pass: reads and caches the tombstone's sha
  assert.equal(readCalls, 1);
  await releaseMerged({ cwd: root, ghApi }); // second pass: sha unchanged, must not re-read
  assert.equal(readCalls, 1, 'second pass must skip the read for an unchanged terminal-state sha');
});

// Task 7's Critical TOCTOU fix, pinned (#820 final review). Every other
// fixture in this file gives the directory listing and the blob read the
// SAME sha, so both would still pass if the cache write reverted to the
// listing's `entry.sha` — the exact bug Task 7's review caught. Here the two
// deliberately diverge (a race: another agent rewrote the claim between the
// listing call and the read), and the cache must record the sha of the
// content that was actually classified.
//
// Two independent discriminators, both red under `entry.sha`:
//   (1) the written cache holds 'blob-sha', not 'listing-sha';
//   (2) the next pass still RE-READS the claim — caching the listing's sha
//       would make shouldSkipClaimRead match the (unchanged) listing entry
//       forever, permanently freezing a claim on evidence never read.
test('releaseMerged: caches the blob sha actually classified, not the directory listing\'s sha (Task 7 TOCTOU)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-toctou-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });

  let readCalls = 0;
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      // The listing's sha — stale by the time the read below happens.
      return { stdout: JSON.stringify([{ name: 'issue-9.json', sha: 'listing-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-9.json')) {
      readCalls += 1;
      // The blob actually read and classified — terminal (tombstone), so it
      // reaches the cache-write branch, but at a DIFFERENT sha.
      return { stdout: JSON.stringify({ content: JSON.stringify({ released: true }), sha: 'blob-sha' }), failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  await releaseMerged({ cwd: root, ghApi });
  assert.equal(readCalls, 1);
  assert.equal(
    readCache(root).claimShas[9],
    'blob-sha',
    'the cache must record the sha of the content that was classified, never the directory listing\'s',
  );

  await releaseMerged({ cwd: root, ghApi });
  assert.equal(
    readCalls,
    2,
    'the listing sha never matched a real read, so the claim must be re-read — caching entry.sha would freeze it on unread evidence',
  );
});

// Guards against terminal-only caching silently widening to cover active
// (live/stale) claims — the invariant this task exists to hold. A live
// claim's PR/issue join can change pass-to-pass even when its content
// hasn't, so it must never be cached/skipped, unlike the tombstone above.
test('releaseMerged: a live claim with an unchanged sha is still re-fetched every pass', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-cache-live-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });

  // Un-expired claimedAt/ttlHours + a runId — matches this file's existing
  // claim-marker fixture shape (see claims.js's claimPayload).
  const liveContent = JSON.stringify({
    runId: 'no-such-run', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });

  let readCalls = 0;
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-8.json', sha: 'live-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-8.json')) {
      readCalls += 1;
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args[0].includes('/issues/8')) {
      // No local run-state.json for 'no-such-run', so the PR join fails
      // closed (no-run-state) and decideRelease falls through to the
      // issue-state lookup — this fake answers it 'OPEN' so the claim
      // resolves to an ordinary skip ('no-run-state'), never a release,
      // keeping this test's only assertion on `readCalls`.
      return { stdout: 'OPEN\n', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  await releaseMerged({ cwd: root, ghApi });
  assert.equal(readCalls, 1);
  await releaseMerged({ cwd: root, ghApi }); // second pass: sha unchanged, but the claim is live — must still re-read
  assert.equal(readCalls, 2, 'a live claim must never be cached/skipped, even with an unchanged sha');
});

// Phase 1.5 (#820 review — resolvePrState was left serial in an earlier pass
// of this diff; this proves it's actually wired through the pool end to
// end): a real resolvable worktree/run-state/branch join, with `gh pr list`
// intercepted at the process-spawn boundary (resolvePrStateAsync isn't
// injectable — same PATH-wrapper technique as pr-state.test.js and
// prune-remote.test.js's `git` wrapper) — reaching a merged-PR release
// decision proves the async prState resolution actually reaches
// decideRelease, not just that the module loads.
test('releaseMerged: Phase 1.5 resolves prState via the pool and reaches a merged-PR release decision', async () => {
  // realpathSync up front: on macOS, os.tmpdir() lives under a /var symlink
  // to /private/var, and `git worktree list --porcelain` always reports the
  // resolved form — resolving here once keeps every path built from `root`
  // consistent with what git reports, avoiding a spurious no-branch join.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-prstate-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  const wtPath = path.join(root, '.worktrees', 'wt-run-1');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'run-1-branch', wtPath], { cwd: root });

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtPath }));

  const liveContent = JSON.stringify({
    runId: 'run-1', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-11.json', sha: 'live-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-11.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null }; // removeInProgressLabel, best-effort
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  // A `gh` wrapper on PATH answers `gh pr list --head run-1-branch ...` with
  // a merged PR — the real gh binary is never invoked.
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\ncat <<\'EOF\'\n[{"number":42,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]\nEOF\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1, 'the merged-PR evidence must reach decideRelease and release the claim');
    assert.equal(result.released[0].issueNumber, 11);
    assert.equal(result.released[0].prNumber, 42, 'the resolved prState (via Phase 1.5\'s pool) must carry through to the released entry');
  } finally {
    process.env.PATH = originalPath;
  }
});

// #1378: a convergent (merged:) release used to leave auto:build/auto:merge live
// on the now-closed issue — release-merged.js called only removeInProgressLabel.
// This pins the fix end-to-end: every GRANT_LABELS entry (never a hardcoded
// 2-element list — release-claim/release.js's actual export carries 3) is
// stripped via the same injectable `api` seam removeInProgressLabel already
// uses, and the removal is logged as an AUTO decisions.md entry against the
// candidate's own run dir.
test('releaseMerged: a merged: release strips every GRANT_LABELS entry and logs the removal to decisions.md', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-grants-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  const wtPath = path.join(root, '.worktrees', 'wt-run-grants');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'run-grants-branch', wtPath], { cwd: root });

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-grants');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtPath }));

  const liveContent = JSON.stringify({
    runId: 'run-grants', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const labelDeletes = [];
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-21.json', sha: 'live-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-21.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      const labelPath = args[args.length - 1];
      labelDeletes.push(decodeURIComponent(labelPath.slice(labelPath.lastIndexOf('/') + 1)));
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-grants-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\ncat <<\'EOF\'\n[{"number":55,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]\nEOF\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1);
    assert.equal(result.released[0].issueNumber, 21);

    for (const label of GRANT_LABELS) {
      assert.ok(labelDeletes.includes(label), `expected a DELETE for ${label}, got ${JSON.stringify(labelDeletes)}`);
    }
    assert.ok(labelDeletes.includes('bot:in-progress'), 'bot:in-progress removal is pre-existing behavior, unaffected by this fix');

    const decisionsText = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(decisionsText, /stripped auto:build\/auto:merge grants on convergent release/);
    assert.match(decisionsText, /merged: reconciled from PR #55/);
    assert.match(decisionsText, /^- AUTO \d{2}:\d{2}:\d{2} — reconcile: /m);
  } finally {
    process.env.PATH = originalPath;
  }
});

// Companion to the fixture above (#1378 AC2): a release reason other than
// `merged:` must leave grants untouched — matches
// wrap-up/cleanup-procedures-execution.md Section E step 6's existing rule.
// Only `bot:in-progress` (removeInProgressLabel, pre-existing) is deleted.
test('releaseMerged: an issue-closed release does not touch grant labels', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-issueclosed-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });

  // No run-state -> joinFailure 'no-run-state' -> prState stays null ->
  // needsIssueEvidence(null) is true -> the issue-closed evidence path fires.
  const liveContent = JSON.stringify({
    runId: 'no-such-run', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const labelDeletes = [];
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-31.json', sha: 'live-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-31.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args[0].includes('/issues/31')) {
      return { stdout: 'CLOSED\n', failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      const labelPath = args[args.length - 1];
      labelDeletes.push(decodeURIComponent(labelPath.slice(labelPath.lastIndexOf('/') + 1)));
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  // writeTombstone's PUT always shells through this module's own raw ghRunner
  // (real execFileSync), not the injectable `api` — a `gh` wrapper on PATH
  // answers it, same technique as the merged-PR test above.
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-issueclosed-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(wrapperPath, '#!/bin/sh\necho \'{}\'\n');
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1);
    assert.deepEqual(labelDeletes, ['bot:in-progress'], 'only bot:in-progress removed — no grant-label DELETE for a non-merged release');
  } finally {
    process.env.PATH = originalPath;
  }
});

// #820 review: the final cache write must re-read immediately before
// writing, not reuse the `cache` snapshot captured at function entry (before
// Phase 1.5/2's async gh-pool calls, which can take real wall-clock time).
// Simulates a concurrent reconcile() process writing a fresher `lastRunAt`
// WHILE this call's own Phase 2 issue-state fetch is in flight — the fix
// must preserve that write, not silently revert it to the stale entry-time
// snapshot (which here is `null`, since no cache file exists yet at entry).
test('releaseMerged: does not revert a concurrent process\'s cache write made during its own async phases', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-cache-race-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });

  // A live claim with no run-state -> joinFailure 'no-run-state' -> prState
  // stays null -> needsIssueEvidence(null) is true -> Phase 2's issue-state
  // fetch fires, which is where the side effect below lands.
  const liveContent = JSON.stringify({
    runId: 'no-such-run', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const CONCURRENT_LAST_RUN_AT = 123456789;
  const ghApi = (args) => {
    if (args[0].includes('/contents/claims?')) {
      return { stdout: JSON.stringify([{ name: 'issue-13.json', sha: 'live-sha' }]), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-13.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args[0].includes('/issues/13')) {
      // A concurrent process finishes and writes its own fresher lastRunAt
      // WHILE this call is still awaiting its Phase 2 batch.
      writeCache(root, { lastRunAt: CONCURRENT_LAST_RUN_AT, claimShas: {} });
      return { stdout: 'OPEN\n', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  await releaseMerged({ cwd: root, ghApi });
  assert.equal(
    readCache(root).lastRunAt,
    CONCURRENT_LAST_RUN_AT,
    'the concurrent write must survive — a stale entry-time snapshot must not overwrite it',
  );
});
