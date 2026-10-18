'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  decideRelease, releasedEntry, writeTombstone, releaseMerged, shouldSkipClaimRead, prClosesIssue, needsIssueEvidence,
} = require('../../../plugin/bin/lib/reconcile/release-merged');
const { readCache, writeCache } = require('../../../plugin/bin/lib/reconcile/cache');
const { GRANT_LABELS } = require('../../../plugin/bin/lib/release-claim/release');
const { CLOSING_KEYWORD_ALTERNATION } = require('../../../plugin/bin/lib/issue-branch-tracking');

// The label a `gh api -X DELETE .../labels/{name}` fake call removes: the last argv entry, URL-encoded.
function deletedLabelName(args) {
  const labelPath = args[args.length - 1];
  return decodeURIComponent(labelPath.slice(labelPath.lastIndexOf('/') + 1));
}

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
test('decideRelease: merged PR that closes the issue releases regardless of issue state (AC2.1)', () => {
  assert.strictEqual(decideRelease('live', { number: 7, state: 'MERGED' }, 'OPEN', true).action, 'release');
});

const merged = { number: 3348, state: 'MERGED' };

test('decideRelease: AC1.1 live claim + MERGED PR not closing the issue + open issue -> skip pr-merged-not-closing', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN', false), { action: 'skip', reason: 'pr-merged-not-closing' });
  assert.deepStrictEqual(decideRelease('stale', merged, undefined, false), { action: 'skip', reason: 'pr-merged-not-closing' });
});
test('decideRelease: AC3.1 MERGED PR not closing the issue + CLOSED issue -> release issue-closed', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'CLOSED', false), { action: 'release', reason: 'issue-closed' });
});
test('decideRelease: AC4.1 MERGED PR with unknown closing data never releases on merged evidence', () => {
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN', undefined), { action: 'skip', reason: 'pr-merged-closing-unknown' });
  assert.deepStrictEqual(decideRelease('live', merged, 'OPEN'), { action: 'skip', reason: 'pr-merged-closing-unknown' });
  assert.deepStrictEqual(decideRelease('live', merged, 'CLOSED', undefined), { action: 'release', reason: 'issue-closed' });
});
test('needsIssueEvidence: MERGED needs issue evidence unless closesIssue is true', () => {
  assert.equal(needsIssueEvidence(merged, true), false);
  assert.equal(needsIssueEvidence(merged, false), true);
  assert.equal(needsIssueEvidence(merged, undefined), true);
  assert.equal(needsIssueEvidence({ number: 1, state: 'OPEN' }, false), false);
  assert.equal(needsIssueEvidence(null), true);
  assert.equal(needsIssueEvidence({ number: 1, state: 'CLOSED' }), true);
  assert.equal(needsIssueEvidence('gh-absent'), false);
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-7.json', sha: 'tombstone-sha' }] }), failure: null, status: null };
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
    if (args[0].includes('/git/trees/claims-registry')) {
      // The listing's sha — stale by the time the read below happens.
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-9.json', sha: 'listing-sha' }] }), failure: null, status: null };
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-8.json', sha: 'live-sha' }] }), failure: null, status: null };
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-11.json', sha: 'live-sha' }] }), failure: null, status: null };
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
    '#!/bin/sh\ncat <<\'EOF\'\n[{"number":42,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closingIssuesReferences":[{"number":11,"repository":{"name":"w","owner":{"login":"acme"}}}]}]\nEOF\n',
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

// #3249: the exact shape the record names — the worktree this claim's
// run-state.json pointed at has already been torn down (the normal
// post-merge-teardown timing, not an edge case), AND the branch name
// itself has been deleted (pr-first-merge-post-merge.md Step 5), so
// neither the live-worktree join nor fallbackBranch's branchExists check
// can recover a branch to query `gh pr list --head` with. Before this
// fix, this candidate's joinFailure stayed 'no-branch' forever, prState
// stayed null forever, and decideRelease only ever consulted issue-state
// evidence — which may lag the merge. run-state.json's pr.number (stamped
// once at PR-early-lifecycle time, never cleared) is what the by-number
// fallback resolves instead.
test('releaseMerged: releases a live claim via the by-number fallback when the worktree AND its branch are both gone (#3249)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  // No worktree is ever created for this run — simulates one already
  // reaped by the time this reconcile pass runs. No branch of this name
  // exists in this checkout either, so fallbackBranch's branchExists check
  // also fails — the only surviving evidence is run-state.json's pr.number.
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-gone-3249');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'already-reaped'),
    pr: { number: 3249001, branch: 'already-deleted-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-gone-3249', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-61.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-61.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null }; // removeInProgressLabel/removeGrantLabels, best-effort
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  // A `gh` wrapper on PATH answers `gh pr view 3249001 ...` with a merged PR
  // — `gh pr list --head {branch}` must never be called (no branch resolved).
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr view 3249001"*) cat <<\'EOF\'\n'
    + '{"number":3249001,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","mergeCommit":{"oid":"deadbeef"},"closingIssuesReferences":[{"number":61,"repository":{"name":"w","owner":{"login":"acme"}}}]}\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr list"*) echo "pr list must never be called when no branch resolved" >&2; exit 1 ;;\n'
    // writeTombstone's conditional-update PUT shells to this same `gh`
    // wrapper (raw ghRunner, not the injectable ghApi fake above) — unrelated
    // to this test's by-number assertion, so it just needs to succeed
    // (empty stdout is fine; writeClaimBlob only checks r.failure === null).
    + '  *"api --method PUT"*) exit 0 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1, `expected the by-number fallback to release the claim, got ${JSON.stringify(result)}`);
    assert.equal(result.released[0].issueNumber, 61);
    assert.equal(result.released[0].prNumber, 3249001);
  } finally {
    process.env.PATH = originalPath;
  }
});

// #3412: the same by-number path (worktree AND branch gone) must run through the
// closes-this-issue gate: the PR is MERGED but its closingIssuesReferences name
// issue 62, not the claim's issue 61, and there is no mergeCommit field, so no
// commit fetch is attempted — the claim is kept.
test('releaseMerged: the by-number fallback keeps the claim when the merged PR does not close the issue (#3412)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-notclosing-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-gone-3412');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'already-reaped'),
    pr: { number: 3249001, branch: 'already-deleted-branch' },
  }));
  const liveContent = JSON.stringify({
    runId: 'run-gone-3412', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const labelDeletes = [];
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-61.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-61.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      labelDeletes.push(deletedLabelName(args));
      return { stdout: '', failure: null, status: null };
    }
    if (args[0].includes('/commits/')) throw new Error('no mergeCommit field: the commit fetch must not be reached');
    if (args[0].includes('/issues/61')) return { stdout: 'OPEN\n', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-notclosing-ghwrap-'));
  const marker = path.join(wrapperDir, 'pr-view-called');
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + `  *"pr view 3249001"*) touch '${marker}'; cat <<'EOF'\n`
    + '{"number":3249001,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closingIssuesReferences":[{"number":62,"repository":{"name":"w","owner":{"login":"acme"}}}]}\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr list"*) echo "pr list must never be called when no branch resolved" >&2; exit 1 ;;\n'
    + '  *"api --method PUT"*) exit 0 ;;\n' // a wrongly attempted release would succeed, so the no-release assertions are real
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.ok(fs.existsSync(marker), 'the by-number `gh pr view 3249001` must have been called');
    assert.equal(result.released.length, 0, `merged-not-closing must not release, got ${JSON.stringify(result)}`);
    assert.ok(result.skipped.some((x) => x.issueNumber === 61 && x.reason === 'pr-merged-not-closing'), JSON.stringify(result.skipped));
    assert.equal(labelDeletes.length, 0, 'no label may be removed');
  } finally {
    process.env.PATH = originalPath;
  }
});

// Companion: the by-number fallback must never fire (and never call `gh pr
// view`) for a candidate whose branch actually resolved via the ordinary
// live-worktree join — it is strictly a last resort.
test('releaseMerged: does not invoke the by-number fallback when the live-worktree join already resolved a branch', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-unused-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  const wtPath = path.join(root, '.worktrees', 'wt-run-live-branch');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'live-branch', wtPath], { cwd: root });

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-live-branch');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: wtPath, pr: { number: 999999, branch: 'live-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-live-branch', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-62.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-62.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-unused-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr list --head live-branch"*) cat <<\'EOF\'\n'
    + '[{"number":77,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closingIssuesReferences":[{"number":62,"repository":{"name":"w","owner":{"login":"acme"}}}]}]\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr view 999999"*) echo "by-number must never be called when the branch already resolved" >&2; exit 1 ;;\n'
    // writeTombstone's conditional-update PUT shells to this same `gh`
    // wrapper (raw ghRunner, not the injectable ghApi fake above) — unrelated
    // to this test's by-number assertion, so it just needs to succeed
    // (empty stdout is fine; writeClaimBlob only checks r.failure === null).
    + '  *"api --method PUT"*) exit 0 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1);
    assert.equal(result.released[0].prNumber, 77, 'must use the branch-resolved PR, never the by-number one');
  } finally {
    process.env.PATH = originalPath;
  }
});

// #3249 (whole-branch review): a by-number probe that FAILS (here a real
// network-failure classification — gh exits non-zero with an unrecognized
// error) must leave prState null, exactly as before the by-number fallback
// existed, so the pre-existing issue-closed release path (Phase 2) still
// runs. Setting prState to the failure string would make needsIssueEvidence
// false and decideRelease skip on the transport failure instead — a
// regression for a closed record whose pr.number probe happens to fail.
test('releaseMerged: a failed by-number probe still lets a CLOSED issue release the claim via issue-closed (#3249)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-fail-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });

  // Worktree reaped, branch deleted — only pr.number survives.
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-bynumber-fail');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', 'already-reaped'),
    pr: { number: 3249003, branch: 'already-deleted-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-bynumber-fail', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  let issueReads = 0;
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-63.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-63.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args[0].includes('/issues/63')) {
      issueReads += 1;
      return { stdout: 'CLOSED\n', failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-bynumber-fail-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    // classifyGhApiError maps an unrecognized non-zero exit to 'network-failure'.
    + '  *"pr view 3249003"*) echo "error connecting to api.github.com" >&2; exit 1 ;;\n'
    + '  *"pr list"*) echo "pr list must never be called when no branch resolved" >&2; exit 1 ;;\n'
    + '  *"api --method PUT"*) exit 0 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(issueReads, 1, 'the issue-state lookup must still run after a failed by-number probe');
    assert.equal(result.released.length, 1, `expected an issue-closed release, got ${JSON.stringify(result)}`);
    assert.equal(result.released[0].issueNumber, 63);
    assert.equal(result.released[0].prNumber, null, 'released on issue-closed evidence, not a PR');
  } finally {
    process.env.PATH = originalPath;
  }
});

// #3249 (whole-branch review): a run-state.json with no worktree stamp at
// all (the #1684 gap) but a still-resolvable pr.branch must use that
// recovered branch for the ordinary `gh pr list --head` join — mirroring
// archive-merged.js, which only reports no-worktree when fallbackBranch
// ALSO fails. No pr.number here, so the by-number fallback can't rescue it.
test('releaseMerged: an unstamped worktree with a fallbackBranch-recovered branch still joins by branch (#3249)', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-unstamped-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });
  execFileSync('git', ['branch', 'unstamped-branch'], { cwd: root }); // ref still resolves

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-unstamped');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: null, pr: { branch: 'unstamped-branch' },
  }));

  const liveContent = JSON.stringify({
    runId: 'run-unstamped', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-64.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-64.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-unstamped-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr list --head unstamped-branch"*) cat <<\'EOF\'\n'
    + '[{"number":88,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closingIssuesReferences":[{"number":64,"repository":{"name":"w","owner":{"login":"acme"}}}]}]\n'
    + 'EOF\n'
    + '    ;;\n'
    + '  *"api --method PUT"*) exit 0 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;

  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    assert.equal(result.released.length, 1, `expected the recovered branch to join, got ${JSON.stringify(result)}`);
    assert.equal(result.released[0].prNumber, 88);
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-21.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-21.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      labelDeletes.push(deletedLabelName(args));
      return { stdout: '', failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-grants-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\ncat <<\'EOF\'\n[{"number":55,"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","closingIssuesReferences":[{"number":21,"repository":{"name":"w","owner":{"login":"acme"}}}]}]\nEOF\n',
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-31.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-31.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args[0].includes('/issues/31')) {
      return { stdout: 'CLOSED\n', failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      labelDeletes.push(deletedLabelName(args));
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
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-13.json', sha: 'live-sha' }] }), failure: null, status: null };
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

const ref = (number, login = 'acme', name = 'w') => ({ number, repository: { name, owner: { login } } });

test('prClosesIssue: closing reference naming the issue in this repo -> true', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3311)] }, 3311, 'acme/w'), true);
});
test('prClosesIssue: references present, none match -> false (the #3348 shape)', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', closingIssuesReferences: [ref(3306), ref(3310)] }, 3311, 'acme/w'), false);
});
test('prClosesIssue: cross-repo and malformed entries never match', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [ref(3311, 'other', 'repo')] }, 3311, 'acme/w'), false);
  assert.equal(prClosesIssue({ closingIssuesReferences: [{ number: 3311 }] }, 3311, 'acme/w'), false);
});
test('prClosesIssue: merge commit closing keyword line -> true; Refs never matches', () => {
  const noRefs = { closingIssuesReferences: [ref(3306)] };
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x (#3306)\n\nFixes #3306\nFixes #3311\n'), true);
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x\n\ncloses: #3311'), true);
  assert.equal(prClosesIssue(noRefs, 3311, 'acme/w', 'feat: x\n\nRefs #3311\n'), false);
});
test('prClosesIssue: #N is matched on a word boundary', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 3412, 'acme/w', 'Fixes #34120\n'), false);
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 34, 'acme/w', 'Fixes #34abc\n'), false);
});
test('prClosesIssue: a closing keyword must start its line (prose mention never matches)', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 3311, 'acme/w', 'this change fixes #3311 partially\n'), false);
});
test('prClosesIssue: no closingIssuesReferences array -> undefined, even when the commit message closes it (AC4)', () => {
  assert.equal(prClosesIssue({ state: 'MERGED', number: 7 }, 7, 'acme/w'), undefined);
  assert.equal(prClosesIssue({ state: 'MERGED', number: 7 }, 7, 'acme/w', 'Fixes #7'), undefined);
  assert.equal(prClosesIssue({ state: 'MERGED' }, 3311, 'acme/w', 'Fixes #3311\n'), undefined);
});
test('prClosesIssue: a keyword and its #N on different lines never match', () => {
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 3311, 'acme/w', 'Fixes\n#3311'), false);
});
test('prClosesIssue: a keyword after a long run of blank lines still matches', () => {
  // The blank run is followed by a non-matching line so the regex has to scan past it. The
  // wall-clock budget for this input lives in perf/closing-keyword-linearity.test.js — timing
  // assertions stay out of `npm test` (docs/plugin-structure.md's perf/ entry).
  const message = `${'\n'.repeat(40000)}x\nFixes #3311`;
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 3311, 'acme/w', message), true);
});
test('prClosesIssue: the repo slug compares case-insensitively', () => {
  const mixed = { number: 3311, repository: { name: 'W', owner: { login: 'ACME' } } };
  assert.equal(prClosesIssue({ closingIssuesReferences: [mixed] }, 3311, 'acme/w'), true);
  assert.equal(prClosesIssue({ closingIssuesReferences: [ref(3311)] }, 3311, 'ACME/W'), true);
});

// The keyword SET is shared with issue-branch-tracking.js (CLOSING_KEYWORD_ALTERNATION);
// CLOSING_KEYWORD_RE is module-private, so pin it through behavior.
test('prClosesIssue: every shared closing-keyword form matches; Refs and a trailing-garbage #N do not', () => {
  assert.ok(CLOSING_KEYWORD_ALTERNATION.includes('close'), 'the shared vocabulary must be the one imported from issue-branch-tracking');
  for (const kw of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved', 'Fixes:', 'CLOSED']) {
    assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 7, 'acme/w', `${kw} #7`), true, `${kw} #7`);
  }
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 7, 'acme/w', 'Refs #7'), false);
  assert.equal(prClosesIssue({ closingIssuesReferences: [] }, 7, 'acme/w', 'Fixed  #7x'), false);
});

// #3412: end-to-end — a MERGED PR is release evidence only when it closes THIS
// issue. The scenario mirrors PR #3348 (closed #3306-#3310 while the run's
// claim on #3311 stayed live): a live worktree on 'run-3348-branch', a live
// claim issue-3311.json, and a `gh` wrapper answering `pr list` with the
// merged PR. `commit` is the ghApi fake's answer for '/commits/a39cd61' (a
// function that throws marks the fetch as unreachable); `putExit` is the
// tombstone PUT's exit code — 0 in the keep-the-claim scenarios so a wrongly
// attempted release would succeed and show up in `released` / `labelDeletes`.
// `refs` undefined omits closingIssuesReferences; `withMergeCommit: false` omits mergeCommit.
async function run3348Scenario({ refs, commit, issueState, putExit, withMergeCommit = true }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-3348-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });
  const wtPath = path.join(root, '.worktrees', 'wt-run-3348');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'run-3348-branch', wtPath], { cwd: root });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-3348');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtPath }));

  const liveContent = JSON.stringify({
    runId: 'run-3348', sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h',
  });
  const labelDeletes = [];
  const reads = { commit: 0, issue: 0 };
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: [{ name: 'issue-3311.json', sha: 'live-sha' }] }), failure: null, status: null };
    }
    if (args[0].includes('/contents/claims/issue-3311.json')) {
      return { stdout: JSON.stringify({ content: liveContent, sha: 'live-sha' }), failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      labelDeletes.push(deletedLabelName(args));
      return { stdout: '', failure: null, status: null };
    }
    if (args[0].includes('/commits/a39cd61')) {
      reads.commit += 1;
      return commit();
    }
    if (args[0].includes('/issues/3311')) {
      reads.issue += 1;
      return { stdout: issueState, failure: null, status: null };
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const prJson = JSON.stringify([{
    number: 3348, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    mergeCommit: withMergeCommit ? { oid: 'a39cd61' } : undefined, closingIssuesReferences: refs, // undefined fields are omitted from the JSON
  }]);
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-3348-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr list --head run-3348-branch"*) cat <<\'EOF\'\n'
    + `${prJson}\n`
    + 'EOF\n'
    + '    ;;\n'
    + `  *"api --method PUT"*) exit ${putExit} ;;\n`
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    return { result, labelDeletes, reads };
  } finally {
    process.env.PATH = originalPath;
  }
}

const commitBody = (stdout) => () => ({ stdout, failure: null, status: null });

test('releaseMerged: AC1.1 AC5.1 the #3348 shape — merged PR closing other records keeps this record\'s claim and labels', async () => {
  const { result, labelDeletes, reads } = await run3348Scenario({
    refs: [ref(3306), ref(3307)],
    commit: commitBody('feat: x (#3306)\n\nFixes #3306\nFixes #3307\n'),
    issueState: 'OPEN\n',
    putExit: 0, // a wrongly attempted release would succeed, making released/labelDeletes falsifiable
  });
  assert.equal(result.released.length, 0, `merged-not-closing must not release, got ${JSON.stringify(result)}`);
  assert.ok(result.skipped.some((s) => s.issueNumber === 3311 && s.reason === 'pr-merged-not-closing'), JSON.stringify(result.skipped));
  assert.equal(labelDeletes.length, 0, 'no label (bot:in-progress or grant) may be removed');
  assert.equal(reads.commit, 1);
  assert.equal(reads.issue, 1);
});

test('releaseMerged: AC3.1 merged-not-closing PR whose issue is now CLOSED releases via issue-closed', async () => {
  const { result, labelDeletes } = await run3348Scenario({
    refs: [ref(3306), ref(3307)],
    commit: commitBody('feat: x (#3306)\n\nFixes #3306\nFixes #3307\n'),
    issueState: 'CLOSED\n',
    putExit: 0,
  });
  assert.equal(result.released.length, 1, JSON.stringify(result));
  assert.equal(result.released[0].issueNumber, 3311);
  assert.equal(result.released[0].prNumber, 3348);
  assert.deepEqual(labelDeletes, ['bot:in-progress'], 'issue-closed release strips no grant labels');
});

test('releaseMerged: references present, commit fetch fails -> still decided from references (not unknown)', async () => {
  const { result } = await run3348Scenario({
    refs: [ref(3306), ref(3307)],
    commit: () => ({ stdout: null, failure: 'network-failure' }),
    issueState: 'OPEN\n',
    putExit: 0,
  });
  assert.equal(result.released.length, 0);
  const skip = result.skipped.find((s) => s.issueNumber === 3311);
  assert.ok(skip, JSON.stringify(result));
  assert.equal(skip.reason, 'pr-merged-not-closing');
});

test('releaseMerged: a merge commit closing keyword releases when references do not name the issue', async () => {
  const { result, labelDeletes, reads } = await run3348Scenario({
    refs: [ref(3306)],
    commit: commitBody('feat: x\n\nFixes #3306\nFixes #3311\n'),
    issueState: 'OPEN\n',
    putExit: 0,
  });
  assert.equal(result.released.length, 1, JSON.stringify(result));
  assert.equal(result.released[0].issueNumber, 3311);
  for (const label of GRANT_LABELS) {
    assert.ok(labelDeletes.includes(label), `merged: path must strip ${label}, got ${JSON.stringify(labelDeletes)}`);
  }
  assert.equal(reads.issue, 0, 'a confirmed close needs no issue-state fetch');
});

test('releaseMerged: references already naming the issue skip the commit fetch entirely', async () => {
  const { result, reads } = await run3348Scenario({
    refs: [ref(3311)],
    commit: () => { throw new Error('the commit fetch must not be reached'); },
    issueState: 'OPEN\n',
    putExit: 0,
  });
  assert.equal(result.released.length, 1, JSON.stringify(result));
  assert.equal(reads.commit, 0);
});

test('releaseMerged: a merged PR with no closingIssuesReferences array never releases and fetches no commit (AC4)', async () => {
  const { result, labelDeletes, reads } = await run3348Scenario({
    refs: undefined,
    commit: () => { throw new Error('the commit fetch must not be reached'); },
    issueState: 'OPEN\n',
    putExit: 0,
  });
  assert.equal(result.released.length, 0, JSON.stringify(result));
  assert.ok(result.skipped.some((s) => s.issueNumber === 3311 && s.reason === 'pr-merged-closing-unknown'), JSON.stringify(result.skipped));
  assert.equal(reads.commit, 0);
  assert.equal(labelDeletes.length, 0);
});

test('releaseMerged: merged-not-closing references and no mergeCommit field -> pr-merged-not-closing without a commit fetch', async () => {
  const { result, labelDeletes, reads } = await run3348Scenario({
    refs: [ref(3306), ref(3307)],
    commit: () => { throw new Error('the commit fetch must not be reached'); },
    issueState: 'OPEN\n',
    putExit: 0,
    withMergeCommit: false,
  });
  assert.equal(result.released.length, 0, JSON.stringify(result));
  assert.ok(result.skipped.some((s) => s.issueNumber === 3311 && s.reason === 'pr-merged-not-closing'), JSON.stringify(result.skipped));
  assert.equal(reads.commit, 0);
  assert.equal(labelDeletes.length, 0);
});

// #3412: Phase 1.75 fans out over every merged candidate; with two live claims
// the per-candidate commit fetch must be keyed back to the right claim. Each
// PR's closingIssuesReferences names some OTHER issue (9001 / 9002), so only
// the merge-commit message can decide — and A's oid must answer A's claim.
async function runTwoCandidateScenario({ issueA, issueB, messageForOidA, messageForOidB }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-twocand-')));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/w.git'], { cwd: root });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'init'], { cwd: root });
  const oids = { A: 'aaaa111', B: 'bbbb222' };
  const issues = { A: issueA, B: issueB };
  const claimEntries = [];
  const contents = new Map();
  for (const key of ['A', 'B']) {
    const runId = `run-two-${key}`;
    const wtPath = path.join(root, '.worktrees', `wt-${runId}`);
    execFileSync('git', ['worktree', 'add', '-q', '-b', `${runId}-branch`, wtPath], { cwd: root });
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wtPath }));
    claimEntries.push({ name: `issue-${issues[key]}.json`, sha: `sha-${key}` });
    contents.set(`/contents/claims/issue-${issues[key]}.json`, JSON.stringify({
      content: JSON.stringify({ runId, sessionId: 's1', claimedAt: new Date().toISOString(), ttlHours: 72, host: 'h' }),
      sha: `sha-${key}`,
    }));
  }
  const labelDeletes = [];
  const commitFetches = [];
  const messages = { [oids.A]: messageForOidA, [oids.B]: messageForOidB };
  const ghApi = (args) => {
    if (args[0].includes('/git/trees/claims-registry')) {
      return { stdout: JSON.stringify({ truncated: false, entries: claimEntries }), failure: null, status: null };
    }
    for (const [suffix, stdout] of contents) {
      if (args[0].includes(suffix)) return { stdout, failure: null, status: null };
    }
    if (args.some((a) => a.includes('/labels/'))) {
      labelDeletes.push(deletedLabelName(args));
      return { stdout: '', failure: null, status: null };
    }
    const commitMatch = /\/commits\/([0-9a-f]+)/.exec(args[0]);
    if (commitMatch) {
      commitFetches.push(commitMatch[1]);
      return { stdout: messages[commitMatch[1]], failure: null, status: null };
    }
    if (/\/issues\/\d+/.test(args[0])) return { stdout: 'OPEN\n', failure: null, status: null };
    throw new Error(`unexpected ${args.join(' ')}`);
  };

  const prFor = (key, number, otherIssue) => JSON.stringify([{
    number, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    mergeCommit: { oid: oids[key] }, closingIssuesReferences: [ref(otherIssue)],
  }]);
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-twocand-ghwrap-'));
  const wrapperPath = path.join(wrapperDir, 'gh');
  fs.writeFileSync(
    wrapperPath,
    '#!/bin/sh\n'
    + 'case "$*" in\n'
    + '  *"pr list --head run-two-A-branch"*) cat <<\'EOF\'\n'
    + `${prFor('A', 7001, 9001)}\n`
    + 'EOF\n'
    + '    ;;\n'
    + '  *"pr list --head run-two-B-branch"*) cat <<\'EOF\'\n'
    + `${prFor('B', 7002, 9002)}\n`
    + 'EOF\n'
    + '    ;;\n'
    + '  *"api --method PUT"*) exit 0 ;;\n'
    + '  *) exit 1 ;;\n'
    + 'esac\n',
  );
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  try {
    const result = await releaseMerged({ cwd: root, ghApi });
    return { result, labelDeletes, commitFetches, oids };
  } finally {
    process.env.PATH = originalPath;
  }
}

test('releaseMerged: two live claims each resolve through their own merge commit (Phase 1.75 keyed per candidate) (#3412)', async () => {
  const { result, labelDeletes, commitFetches, oids } = await runTwoCandidateScenario({
    issueA: 3401, issueB: 3402, messageForOidA: 'feat: a\n\nFixes #3401\n', messageForOidB: 'feat: b\n\nFixes #3402\n',
  });
  assert.equal(result.released.length, 2, JSON.stringify(result));
  assert.deepEqual(result.released.map((r) => r.issueNumber).sort(), [3401, 3402]);
  assert.deepEqual(result.released.map((r) => r.prNumber).sort(), [7001, 7002]);
  // The merged: path (unlike issue-closed) strips the grant labels; both issues are OPEN here.
  for (const label of GRANT_LABELS) {
    assert.ok(labelDeletes.includes(label), `merged: path must strip ${label}, got ${JSON.stringify(labelDeletes)}`);
  }
  assert.equal(commitFetches.filter((o) => o === oids.A).length, 1, JSON.stringify(commitFetches));
  assert.equal(commitFetches.filter((o) => o === oids.B).length, 1, JSON.stringify(commitFetches));
  assert.equal(commitFetches.length, 2, JSON.stringify(commitFetches));
});

test('releaseMerged: two live claims with the commit messages swapped release neither — a mis-keyed fan-out would release both (#3412)', async () => {
  const { result, labelDeletes } = await runTwoCandidateScenario({
    issueA: 3401, issueB: 3402, messageForOidA: 'feat: a\n\nFixes #3402\n', messageForOidB: 'feat: b\n\nFixes #3401\n',
  });
  assert.equal(result.released.length, 0, JSON.stringify(result));
  for (const n of [3401, 3402]) {
    assert.ok(result.skipped.some((x) => x.issueNumber === n && x.reason === 'pr-merged-not-closing'), JSON.stringify(result.skipped));
  }
  assert.equal(labelDeletes.length, 0);
});
