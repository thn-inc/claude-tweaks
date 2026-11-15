// tests/reconcile.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyMirror } = require('../plugin/bin/lib/reconcile/classify');
const { mirrorFastForward } = require('../plugin/bin/lib/reconcile/mirror-ff');
const { decideReap } = require('../plugin/bin/lib/reconcile/reap-merged');
const { decideRelease } = require('../plugin/bin/lib/reconcile/release-merged');
const { decideArchive, readConsoleState, localHasMerge } = require('../plugin/bin/lib/reconcile/archive-merged');
const { isWorktreeLocked } = require('../plugin/bin/lib/hooks/worktree-reap');
const { reconcile } = require('../plugin/bin/lib/reconcile');
const { gitRepo } = require('./helpers/git-fixtures');
const { chmodDenialSkip } = require('./helpers/root');
const { STUB_SKIP, installStub } = require('./helpers/path-stub');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');
const {
  git,
  pairedFixture,
  bareRepoRoot,
  mintEmptyRunDir,
} = require('./helpers/reconcile-fixtures');

// Every non-dry reconcile() pass prunes the declined-learning store (#1399), and that store resolves
// from process.cwd() to the main checkout (#4360). The in-process passes below pass `cwd: <fixture>`,
// which does not move process.cwd(), so left real they would lock and rewrite the maintainer's own
// store whenever the suite runs from a linked worktree. Stub the prune for the whole file; node --test
// gives each file its own process, and the #4180 prune test (tests/reconcile-archive-residue.test.js) installs its own counting stub on top.
require('../plugin/bin/lib/declined-learning/store').pruneDeclines = () => 0;

// --- classify.js / mirror-ff.js: real local git fixtures, no network ---

test('classifyMirror: current when local matches origin', () => {
  const { mainDir } = pairedFixture();
  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'current');
  assert.strictEqual(r.failure, null);
});

test('classifyMirror: behind when origin has moved ahead', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
});

test('classifyMirror: ahead when local has unpushed commits', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'local.txt'), 'mine\n');
  git(['add', 'local.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-only'], mainDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'ahead');
});

test('classifyMirror: diverged when both sides have unique commits', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'origin-side.txt'), 'x\n');
  git(['add', 'origin-side.txt'], seedDir);
  git(['commit', '-q', '-m', 'origin-side'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  fs.writeFileSync(path.join(mainDir, 'local-side.txt'), 'y\n');
  git(['add', 'local-side.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-side'], mainDir);

  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'diverged');
});

test('classifyMirror: dirty when the working tree has uncommitted changes, before any fetch is attempted', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'a.txt'), 'modified\n');
  const r = classifyMirror(mainDir, 'main');
  assert.strictEqual(r.state, 'dirty');
});

test('classifyMirror: skipFetch=true never calls fetch, trusts already-fetched refs', () => {
  const { originDir, mainDir } = pairedFixture();
  git(['fetch', 'origin'], mainDir); // caller already fetched, simulating the shared-fetch path
  // Point origin at an invalid URL so a *second* fetch attempt would fail —
  // if classifyMirror still fetched despite skipFetch, this would surface as
  // a non-null failure instead of the 'current' state proven by the fetch above.
  git(['remote', 'set-url', 'origin', 'https://example.invalid/nope.git'], mainDir);
  const result = classifyMirror(mainDir, 'main', { skipFetch: true });
  assert.equal(result.state, 'current');
  assert.equal(result.failure, null);
  void originDir;
});

test('mirrorFastForward: fast-forwards when strictly behind and clean (AC1)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const before = git(['rev-parse', 'main'], mainDir).trim();
  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
  assert.strictEqual(r.action, 'fast-forwarded');
  const after = git(['rev-parse', 'main'], mainDir).trim();
  assert.notStrictEqual(before, after);
  assert.strictEqual(after, git(['rev-parse', 'origin/main'], mainDir).trim());
});

test('mirrorFastForward: dryRun reports a behind mirror as skipped and moves nothing (#3630)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const before = git(['rev-parse', 'main'], mainDir).trim();
  const r = mirrorFastForward(mainDir, 'main', { dryRun: true });
  assert.deepStrictEqual(r, { state: 'behind', action: 'skipped', reason: 'dry-run' });
  assert.strictEqual(git(['rev-parse', 'main'], mainDir).trim(), before);
});

test('mirrorFastForward: dirty tree reports dirty and moves nothing (AC1)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  fs.writeFileSync(path.join(mainDir, 'a.txt'), 'dirty\n');

  const before = git(['rev-parse', 'HEAD'], mainDir).trim();
  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'dirty');
  assert.strictEqual(r.action, 'none');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
});

test('mirrorFastForward: ahead (local-only commits) reports a warning and moves nothing (AC1)', () => {
  const { mainDir } = pairedFixture();
  fs.writeFileSync(path.join(mainDir, 'local.txt'), 'mine\n');
  git(['add', 'local.txt'], mainDir);
  git(['commit', '-q', '-m', 'local-only'], mainDir);
  const before = git(['rev-parse', 'HEAD'], mainDir).trim();

  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'ahead');
  assert.ok(r.warning);
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
});

test('mirrorFastForward: idempotent — a second run after an ff produces zero further writes (AC3)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  mirrorFastForward(mainDir, 'main');
  const afterFirst = git(['rev-parse', 'HEAD'], mainDir).trim();
  const r2 = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r2.state, 'current');
  assert.strictEqual(r2.action, 'none');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), afterFirst);
});

// #2565: a concurrent session on a different branch must never have its
// working tree touched — but the local integration-branch REF can and
// should still advance, via a plain `git fetch origin {b}:{b}` (a local ref
// update, not a merge). This is what closes the "permanently stuck at
// local-behind-merge" bug: without it, archive-merged.js's localHasMerge
// had no path to ever see the local ref catch up when the main checkout
// stayed off the integration branch.
test('mirrorFastForward: a concurrent session on a different branch — working tree untouched, but the local ref fast-forwards via fetch', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  const originMain = git(['rev-parse', 'origin/main'], seedDir).trim();

  // classifyMirror's rev-list comparison is ref-to-ref and reports 'behind'
  // regardless of what's checked out — the guard has to catch it downstream,
  // at the write itself, not by changing the classification.
  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  const before = git(['rev-parse', 'HEAD'], mainDir).trim();
  const localMainBefore = git(['rev-parse', 'main'], mainDir).trim();
  assert.notStrictEqual(localMainBefore, originMain, 'sanity: local main must start genuinely behind');

  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
  assert.strictEqual(r.action, 'fast-forwarded');
  // The working tree — checked-out branch and HEAD — is never touched: only
  // the non-checked-out `main` ref moves.
  assert.strictEqual(git(['branch', '--show-current'], mainDir).trim(), 'someone-elses-work');
  assert.strictEqual(git(['rev-parse', 'HEAD'], mainDir).trim(), before);
  // The local `main` ref itself did advance to match origin.
  assert.strictEqual(git(['rev-parse', 'main'], mainDir).trim(), originMain);
});

// AC5's negative control, at the git primitive mirror-ff.js's fetch-based
// path actually relies on: `git fetch origin {b}:{b}` must refuse — loudly,
// leaving the local ref untouched — when updating it would NOT be a
// fast-forward, the same guarantee `--ff-only` gives the checked-out path.
// (classifyMirror's own rev-list gate means mirrorFastForward's 'behind'
// branch is only ever reached when the local ref genuinely IS a strict
// ancestor of origin's — so this exact non-ff rejection is unreachable
// through mirrorFastForward itself under non-racing conditions; it is
// exactly the guard against the race that gate leaves open between
// classification and this write.)
test("git fetch origin {b}:{b} refuses a non-fast-forward local ref update (the safety mirrorFastForward's fetch path relies on)", () => {
  const { seedDir, mainDir } = pairedFixture();

  // Diverge the LOCAL `main` ref from origin's: `main` gains a commit origin
  // never sees, via a throwaway worktree (so the checked-out branch is
  // untouched), while origin also advances independently.
  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  const scratchWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-scratch-'));
  git(['worktree', 'add', '-q', scratchWorktree, 'main'], mainDir);
  fs.writeFileSync(path.join(scratchWorktree, 'c.txt'), 'local-only\n');
  git(['add', 'c.txt'], scratchWorktree);
  git(['commit', '-q', '-m', 'local-only divergent commit'], scratchWorktree);
  git(['worktree', 'remove', '--force', scratchWorktree], mainDir);
  const localMainBefore = git(['rev-parse', 'main'], mainDir).trim();

  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'origin-only divergent commit'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  assert.throws(() => git(['fetch', 'origin', 'main:main'], mainDir));
  // Refusal is loud and leaves the local ref exactly where it was — never a
  // silent rewrite.
  assert.strictEqual(git(['rev-parse', 'main'], mainDir).trim(), localMainBefore);
  assert.strictEqual(git(['branch', '--show-current'], mainDir).trim(), 'someone-elses-work');
});

// AC6: the fetch-based update path isn't viable for every case — a
// concurrent session with the integration branch checked out in ANOTHER
// linked worktree of the same repo makes git itself refuse
// `fetch origin {b}:{b}` ("refusing to fetch into branch ... checked out
// at ...") — and the original wrong-branch skip must still be there to
// catch that residual case, exactly as before this fix.
test('mirrorFastForward: fetch-based update not viable (branch checked out in another worktree) falls back to the original wrong-branch skip', () => {
  const { seedDir, mainDir } = pairedFixture();
  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  const otherWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-otherwt-'));
  git(['worktree', 'add', '-q', otherWorktree, 'main'], mainDir);

  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'second'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const r = mirrorFastForward(mainDir, 'main');
  assert.strictEqual(r.state, 'behind');
  assert.strictEqual(r.action, 'skipped');
  assert.match(r.reason, /wrong-branch/);
});

// --- decision tables: pure functions, zero I/O ---

test('decideReap: merged PR -> reap', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'MERGED' }), { action: 'reap' });
});

test('decideReap: closed-unmerged PR -> skip, surfaced (AC2)', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'CLOSED' }), { action: 'skip', reason: 'pr-closed-unmerged' });
});

test('decideReap: open PR -> skip, reason pr-open (AC2)', () => {
  assert.deepStrictEqual(decideReap({ number: 5, state: 'OPEN' }), { action: 'skip', reason: 'pr-open' });
});

test('decideReap: no PR at all -> skip, reason no-pr', () => {
  assert.deepStrictEqual(decideReap(null), { action: 'skip', reason: 'no-pr' });
});

test('decideReap: gh absent / network failure are distinguished, never silently collapsed', () => {
  assert.deepStrictEqual(decideReap('gh-absent'), { action: 'skip', reason: 'gh-absent' });
  assert.deepStrictEqual(decideReap('network-failure'), { action: 'skip', reason: 'network-failure' });
});

test('decideRelease: only live/stale claims are ever candidates for release', () => {
  assert.strictEqual(decideRelease('absent', { number: 1, state: 'MERGED' }).action, 'skip');
  assert.strictEqual(decideRelease('tombstone', { number: 1, state: 'MERGED' }).action, 'skip');
  assert.strictEqual(decideRelease('unreadable', { number: 1, state: 'MERGED' }).action, 'skip');
});

test('decideRelease: live claim + merged PR -> release', () => {
  const r = decideRelease('live', { number: 7, state: 'MERGED' }, undefined, true);
  assert.strictEqual(r.action, 'release');
  assert.match(r.reason, /#7/);
});

test('decideRelease: stale claim + merged PR -> release (idempotence path)', () => {
  assert.strictEqual(decideRelease('stale', { number: 7, state: 'MERGED' }, undefined, true).action, 'release');
});

test('decideRelease: live claim + open PR -> skip, never released', () => {
  assert.deepStrictEqual(decideRelease('live', { number: 7, state: 'OPEN' }), { action: 'skip', reason: 'pr-open' });
});

// #1130: archiveMerged only ever iterates NON-terminal runs, so a missing
// console.json here always means wrap-up never rendered a console for this
// run — not the empty-console fast path, which ends with close-run (status
// clean) + the archive-run verb and never reaches this sweep. Archiving on
// 'none' swept live runs with pending staged decisions (the #657 incident).
test('decideArchive: merged + console never rendered -> skip, not archive', () => {
  assert.deepStrictEqual(
    decideArchive({ number: 3, state: 'MERGED' }, 'none'),
    { action: 'skip', reason: 'console-never-rendered' },
  );
});

test('decideArchive: merged + console resolved -> archive', () => {
  assert.deepStrictEqual(decideArchive({ number: 3, state: 'MERGED' }, 'resolved'), { action: 'archive' });
});

test('decideArchive: merged + console UNresolved -> never archived', () => {
  assert.deepStrictEqual(decideArchive({ number: 3, state: 'MERGED' }, 'unresolved'), { action: 'skip', reason: 'console-unresolved' });
});

test('decideArchive: PR not merged -> never archived regardless of console state', () => {
  assert.strictEqual(decideArchive({ number: 3, state: 'OPEN' }, 'resolved').action, 'skip');
});

test('readConsoleState: absent file reads as none, not unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  assert.strictEqual(readConsoleState(dir), 'none');
});

test('readConsoleState: {resolved:true} reads as resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true }));
  assert.strictEqual(readConsoleState(dir), 'resolved');
});

test('readConsoleState: unparseable content fails closed to unresolved, never silently archived', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), '{not json');
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});

// #1130: no production path writes `resolved` (`_shared/console-execution.md`'s
// Write order only ever stamped `executedAt`) — `readConsoleState` gating
// solely on `resolved === true` made the archive branch unreachable for
// every real console-carrying run. A non-empty `executedAt` is
// console-execution's own completion stamp and must read as 'resolved' too.
test('readConsoleState: {executedAt} with no resolved field reads as resolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ executedAt: '2026-08-20T10:00:00Z' }));
  assert.strictEqual(readConsoleState(dir), 'resolved');
});

test('readConsoleState: {} (neither resolved nor executedAt) reads as unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({}));
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});

// #1130 review: a whitespace-only executedAt is not a completion stamp — the
// acceptance check trims before testing length, so it fails closed.
test('readConsoleState: whitespace-only executedAt reads as unresolved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-console-'));
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ executedAt: '   ' }));
  assert.strictEqual(readConsoleState(dir), 'unresolved');
});

// #1130: gh can report MERGED before the local main checkout has
// fast-forwarded to include the merge commit. Archiving then moves only the
// gitignored half (work/ arrives via the merge) — the #657 symptom.
test('localHasMerge: merge commit not in local history -> false; present -> true; unknown oid shape -> null', () => {
  const root = gitRepo();
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.strictEqual(localHasMerge(root, { oid: head }), true);
  assert.strictEqual(localHasMerge(root, { oid: 'f'.repeat(40) }), false);
  assert.strictEqual(localHasMerge(root, null), null);
  assert.strictEqual(localHasMerge(root, {}), null);
});

// #2565 AC1/AC2: with `integration` supplied, a main checkout NOT on that
// branch must not report `false` forever just because HEAD never advanced.
test('localHasMerge: with integration supplied, a merge absent from HEAD but present on origin/{integration} still reports true', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'merge commit'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  const mergeOid = git(['rev-parse', 'main'], seedDir).trim();

  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  // Local `main` ref stays behind; only the remote-tracking ref catches up
  // (the caller's own mirror/fetch step keeps this current independent of
  // what's checked out — mirrorFastForward's own fetch above is one path).
  git(['fetch', '-q', 'origin', 'main'], mainDir);

  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }), false, 'sanity: HEAD-only check must still miss it');
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
});

// Once the local integration-branch ref itself has been updated (e.g. by
// mirrorFastForward's fetch-based path above), the FIRST check
// (refs/heads/{integration}) already satisfies it — the origin/{integration}
// fallback is a fallback, not the only path.
test('localHasMerge: with integration supplied, a merge present on the local (non-checked-out) integration ref reports true', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'merge commit'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  const mergeOid = git(['rev-parse', 'main'], seedDir).trim();

  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  git(['fetch', '-q', 'origin', 'main:main'], mainDir); // local ref update, no checkout

  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
});

// AC4: a main checkout actually ON the integration branch is unaffected —
// HEAD and refs/heads/{integration} name the same commit either way.
test('localHasMerge: checked out ON the integration branch — passing integration changes nothing', () => {
  const root = gitRepo();
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const branch = execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim();
  assert.strictEqual(localHasMerge(root, { oid: head }, branch), localHasMerge(root, { oid: head }));
  assert.strictEqual(localHasMerge(root, { oid: 'f'.repeat(40) }, branch), localHasMerge(root, { oid: 'f'.repeat(40) }));
});

// #4387 fixtures: origin holds a merge commit pushed from seedDir; mainDir is untouched until a test fetches.
function pairedFixtureWithPushedMerge() {
  const fixture = pairedFixture();
  const { seedDir } = fixture;
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'merge commit'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  return { ...fixture, mergeOid: git(['rev-parse', 'main'], seedDir).trim() };
}

// Fails every `git branch --show-current` probe with `error`; the returned counter records how many ran.
function failBranchProbe(t, error) {
  const counter = { calls: 0 };
  t.mock.method(require('child_process'), 'execFileSync', (file, args, opts) => {
    if (Array.isArray(args) && args.includes('branch') && args.includes('--show-current')) {
      counter.calls += 1;
      throw error;
    }
    return execFileSync(file, args, opts); // the real one, destructured at load before the mock
  });
  return counter;
}

// #4387: on the integration branch the archive's `git mv` runs against this
// checkout's working tree, so a behind local branch must not borrow origin's
// ancestry — the tracked work/ only arrives with the local fast-forward.
test('localHasMerge: on the integration branch with local behind origin — reports false (no origin fallback, #4387)', () => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();

  git(['fetch', '-q', 'origin', 'main'], mainDir); // only origin/main advances; mainDir stays on main
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), false);

  git(['merge', '-q', '--ff-only', 'origin/main'], mainDir);
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
});

// #4387: a dry-run previews the fast-forward the real pass's mirror runs first,
// so on the integration branch it keeps the origin fallback.
test('localHasMerge: dry-run on the integration branch with local behind origin keeps the origin fallback (#4387)', () => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();

  git(['fetch', '-q', 'origin', 'main'], mainDir); // only origin/main advances; mainDir stays on main
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main', { dryRun: true }), true);
});

// #4387: when the branch probe itself fails with an ordinary git error (a git too old to
// know `--show-current`), the integration-branch rule cannot apply, so localHasMerge
// falls through to the origin fallback.
test('localHasMerge: a failed `git branch --show-current` probe falls through to the origin fallback (#4387)', (t) => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();
  git(['fetch', '-q', 'origin', 'main'], mainDir);

  const probe = failBranchProbe(t, Object.assign(new Error('simulated probe failure'), { status: 128, stderr: 'fatal: simulated probe failure\n' }));
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
  assert.strictEqual(probe.calls, 1, 'the probe must have run and failed');
});

// #4387 (final-review M2): an indeterminate probe failure (timeout / spawn failure) means
// the question went unanswered, so the guard answers in the retryable direction (false)
// instead of falling toward the origin fallback and an archive.
test('localHasMerge: an indeterminate `git branch --show-current` probe failure answers false, not the origin fallback (#4387)', (t) => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();
  git(['fetch', '-q', 'origin', 'main'], mainDir);

  const probe = failBranchProbe(t, Object.assign(new Error('simulated probe timeout'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' }));
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), false);
  assert.strictEqual(probe.calls, 1, 'the probe must have run and failed');
});

// #4387: the origin fallback's false direction with `integration` supplied — a parked
// checkout (not on main) and a merge that neither local main nor origin/main holds
// (a commit that exists only in another, unpushed clone) is not locally present.
test('localHasMerge: parked checkout, integration supplied, merge held by neither local main nor origin/main — reports false (#4387)', () => {
  const { seedDir, mainDir } = pairedFixture();
  fs.writeFileSync(path.join(seedDir, 'b.txt'), 'two\n');
  git(['add', 'b.txt'], seedDir);
  git(['commit', '-q', '-m', 'unpushed commit'], seedDir); // never pushed
  const unpushedOid = git(['rev-parse', 'HEAD'], seedDir).trim();

  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  assert.strictEqual(localHasMerge(mainDir, { oid: unpushedOid }, 'main'), false);
  assert.strictEqual(localHasMerge(mainDir, { oid: 'f'.repeat(40) }, 'main'), false);
});

// #2565 parked shape with no local integration ref at all: the origin fallback
// is still the only path that can see the merge.
test('AC3.1: localHasMerge parked with no local integration ref — still falls back to origin (#2565)', () => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();

  git(['checkout', '-q', '-b', 'someone-elses-work'], mainDir);
  git(['branch', '-q', '-D', 'main'], mainDir);
  git(['fetch', '-q', 'origin', 'main'], mainDir);
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
});

// Detached HEAD names no branch, so the integration-branch rule does not apply
// and the origin fallback still answers.
test('localHasMerge: detached HEAD with local behind — still falls back to origin', () => {
  const { mainDir, mergeOid } = pairedFixtureWithPushedMerge();

  git(['fetch', '-q', 'origin', 'main'], mainDir);
  git(['checkout', '-q', '--detach'], mainDir);
  assert.strictEqual(localHasMerge(mainDir, { oid: mergeOid }, 'main'), true);
});

// --- archiveRunDir: real git fixture — the actual move/commit I/O, not just the pure decision table ---

function runDirFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-archive-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);

  const runId = '2026-08-14T120000-spec-999';
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '999-spec.md'), '# 999\n');
  git(['add', path.join('.claude-tweaks', 'pipelines', runId, 'work', '999-spec.md')], root);
  git(['commit', '-q', '-m', 'materialize #999'], root);

  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '# decisions\n');
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: '/some/worktree' }));

  return { root, runDir, runId };
}

test('archiveRunDir: the git mv of work/ is committed, not left staged (no uncommitted rename after archival)', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const archivedWorkRel = path.relative(root, path.join(archiveDir, 'work'));
  const oldWorkRel = path.relative(root, path.join(runDir, 'work'));
  assert.ok(fs.existsSync(path.join(archiveDir, 'work', '999-spec.md')));
  assert.ok(!fs.existsSync(path.join(runDir, 'work')));
  // config.yml/decisions.md/run-state.json are plain (never git-tracked, same
  // as .gitignore's real-repo rule) — only the git-mv'd work/ path is checked
  // for cleanliness here, since that's the actual write this test pins.
  assert.strictEqual(git(['status', '--porcelain', '--', archivedWorkRel, oldWorkRel], root).trim(), '');
  assert.strictEqual(git(['ls-files', '--', archivedWorkRel], root).trim(),
    toPosix(path.join(archivedWorkRel, '999-spec.md')));
  assert.match(git(['log', '-1', '--format=%s'], root).trim(), /archive run/);
});

test('#3721 AC1.1: archiveRunDir returns the commit it made', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.commit.sha, git(['rev-parse', '--short', 'HEAD'], root).trim());
  assert.strictEqual(result.commit.branch, 'main');
});

test('#3721 AC1.2: archiveRunDir with nothing tracked returns no commit field', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['rm', '-rq', '--cached', '--', path.join(runDir, 'work')], root);
  git(['commit', '-q', '-m', 'untrack'], root);
  fs.rmSync(path.join(runDir, 'work'), { recursive: true });
  const before = git(['rev-parse', 'HEAD'], root).trim();
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  assert.ok(!('commit' in result));
  assert.strictEqual(git(['rev-parse', 'HEAD'], root).trim(), before);
});

test('#3721 archiveRunDir on a detached HEAD reports branch detached', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['checkout', '-q', '--detach'], root);
  assert.strictEqual(archiveRunDir(root, runDir).commit.branch, 'detached');
});

test('#3721 a commit followed by a refusal still returns the commit', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'accidentally track a stray file'], root);
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'tracked-entry');
  assert.strictEqual(result.commit.sha, git(['rev-parse', '--short', 'HEAD'], root).trim());
  assert.strictEqual(result.commit.branch, 'main');
});

test('#3721 a refusal before any commit carries no commit field', () => {
  // Nothing tracked under work/, so no commit runs; the stray file then refuses.
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['rm', '-rq', '--cached', '--', path.join(runDir, 'work')], root);
  fs.rmSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'stray only'], root);
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.reason, 'tracked-entry');
  assert.ok(!('commit' in result));
});

// A fake `git(args, cwd)` for the probe seam: `answers` maps the first argv
// word to a result; a missing key fails with a timeout (an unanswered probe).
function fakeGit(answers) {
  return (args) => answers[args[0]] || { stdout: null, failure: 'timeout', stderr: '', exitCode: null };
}

const OK = (stdout) => ({ stdout, failure: null, stderr: null });

const ARCHIVE_RUN_ID = '2026-08-01T120000-record-3721-x';

const OWN_SUBJECT = `[reconcile] archive run ${ARCHIVE_RUN_ID}`;

test('#3721 readArchiveCommit: a failed sha probe stores null', () => {
  const { readArchiveCommit } = require('../plugin/bin/lib/reconcile/archive-merged');
  const fake = fakeGit({
    show: { stdout: null, failure: 'timeout', exitCode: null },
    'symbolic-ref': OK('refs/heads/main'),
  });
  assert.deepStrictEqual(readArchiveCommit('/x', ARCHIVE_RUN_ID, fake), { sha: null, branch: 'main' });
});

test('#3721 readArchiveCommit: reads the sha and subject in one spawn', () => {
  const { readArchiveCommit } = require('../plugin/bin/lib/reconcile/archive-merged');
  const calls = [];
  const fake = (args) => {
    calls.push(args);
    return args[0] === 'show' ? OK(`abc1234\n${OWN_SUBJECT}`) : OK('refs/heads/main');
  };
  assert.deepStrictEqual(readArchiveCommit('/x', ARCHIVE_RUN_ID, fake), { sha: 'abc1234', branch: 'main' });
  // The property is one spawn for sha and subject together, not the argv that spawn uses.
  assert.strictEqual(calls.filter((a) => a[0] === 'show').length, 1);
  assert.ok(!calls.some((a) => a[0] === 'rev-parse' || a[0] === 'log'));
});

test('#3721 readArchiveCommit: a foreign HEAD subject stores a null sha', () => {
  const { readArchiveCommit } = require('../plugin/bin/lib/reconcile/archive-merged');
  const fake = fakeGit({
    show: OK('abc1234\nsomebody else committed in the window'),
    'symbolic-ref': OK('refs/heads/main'),
  });
  assert.deepStrictEqual(readArchiveCommit('/x', ARCHIVE_RUN_ID, fake), { sha: null, branch: 'main' });
});

test('#3721 readArchiveCommit: symbolic-ref exit 1 is detached', () => {
  const { readArchiveCommit } = require('../plugin/bin/lib/reconcile/archive-merged');
  const fake = fakeGit({
    show: OK(`abc1234\n${OWN_SUBJECT}`),
    'symbolic-ref': { stdout: null, failure: 'git-error', exitCode: 1 },
  });
  assert.strictEqual(readArchiveCommit('/x', ARCHIVE_RUN_ID, fake).branch, 'detached');
});

test('#3721 readArchiveCommit: an unanswered symbolic-ref is not detached', () => {
  const { readArchiveCommit } = require('../plugin/bin/lib/reconcile/archive-merged');
  for (const failed of [
    { stdout: null, failure: 'timeout', exitCode: null },
    { stdout: null, failure: 'git-error', exitCode: 128 },
  ]) {
    const fake = fakeGit({ show: OK(`abc1234\n${OWN_SUBJECT}`), 'symbolic-ref': failed });
    assert.strictEqual(readArchiveCommit('/x', ARCHIVE_RUN_ID, fake).branch, null);
  }
});

const AC2_PREFIX = /^claude-tweaks: committed [0-9a-f]{7,} on \S+ \(/;

test('#3721 archiveCommitLine: a null sha never prints a placeholder', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const line = archiveCommitLine('/x', { sha: null, branch: 'main' }, fakeGit({}));
  assert.doesNotMatch(line, /unknown on|on unknown/);
  assert.doesNotMatch(line, AC2_PREFIX);
  assert.strictEqual(line, 'claude-tweaks: committed the archive move on main but could not read its sha (push state unknown)');
});

test('#3721 archiveCommitLine: a null branch never prints detached', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const line = archiveCommitLine('/x', { sha: 'abc1234', branch: null }, fakeGit({}));
  assert.doesNotMatch(line, /detached/);
  assert.doesNotMatch(line, AC2_PREFIX);
  assert.strictEqual(line, 'claude-tweaks: committed abc1234 but could not read its branch (push state unknown)');
});

test('#3721 archiveCommitLine: both halves null keeps the generic line', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const line = archiveCommitLine('/x', { sha: null, branch: null }, fakeGit({}));
  assert.doesNotMatch(line, AC2_PREFIX);
  assert.strictEqual(line, 'claude-tweaks: committed the archive move but could not read its sha and branch (push state unknown)');
});

test('#3721 archiveCommitLine: a failed for-each-ref is push state unknown', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const fake = fakeGit({
    'symbolic-ref': OK('refs/heads/main'),
    'for-each-ref': { stdout: null, failure: 'git-error', exitCode: 128 },
  });
  const line = archiveCommitLine('/x', { sha: 'abc1234', branch: 'main' }, fake);
  assert.match(line, / \(push state unknown\)$/);
});

test('#3721 archiveCommitLine: a zero ahead count is push state unknown', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const fake = fakeGit({
    'symbolic-ref': OK('refs/heads/main'),
    'for-each-ref': OK('origin/main'),
    'rev-list': OK('0'),
  });
  const line = archiveCommitLine('/x', { sha: 'abc1234', branch: 'main' }, fake);
  assert.match(line, / \(push state unknown\)$/);
  assert.doesNotMatch(line, /0 ahead/);
});

test('#3721 archiveCommitLine: a throwing probe degrades instead of throwing', () => {
  const { archiveCommitLine } = require('../plugin/bin/lib/reconcile/archive-merged');
  const line = archiveCommitLine('/x', { sha: 'abc1234', branch: 'main' }, () => { throw new Error('boom'); });
  assert.match(line, / \(push state unknown\)$/);
});

test('archiveRunDir: run-state.json moves to the archived location with status: clean, not left orphaned at the old path', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  const archived = JSON.parse(fs.readFileSync(path.join(archiveDir, 'run-state.json'), 'utf8'));
  assert.strictEqual(archived.status, 'clean');
  assert.strictEqual(archived.worktree, null);
  assert.ok(!fs.existsSync(path.join(runDir, 'run-state.json')));
});

test('archiveRunDir: the old run dir is removed once empty — a later iterRunDirsWithState pass never re-yields it', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { iterRunDirsWithState } = require('../plugin/bin/lib/hooks/context');
  const { root, runDir } = runDirFixture();

  archiveRunDir(root, runDir);
  assert.ok(!fs.existsSync(runDir));
  assert.deepStrictEqual([...iterRunDirsWithState(root)], []);
});

test('archiveRunDir: enumeration archives files the fixed list never named (engine-state.json, extra.txt)', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'extra.txt'), 'hello\n');

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'engine-state.json')));
  assert.ok(fs.existsSync(path.join(archiveDir, 'extra.txt')));
  assert.ok(!fs.existsSync(runDir));
});

test('archiveRunDir: movedEntries reflects the real enumerated set, not a fixed list', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'engine-state.json'), '{}');

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  assert.ok(Array.isArray(result.movedEntries));
  assert.ok(result.movedEntries.includes('work'));
  assert.ok(result.movedEntries.includes('config.yml'));
  assert.ok(result.movedEntries.includes('engine-state.json'));
  // Never a hardcoded name that wasn't actually present in this fixture.
  assert.ok(!result.movedEntries.includes('manifest.yml'));
});

test('archiveRunDir: a run dir with no work/ still archives cleanly', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();
  fs.rmSync(path.join(runDir, 'work'), { recursive: true, force: true });
  git(['add', '-u'], root);
  git(['commit', '-q', '-m', 'remove work for fixture'], root);

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archiveRunDir: re-running over a partially-archived dir is idempotent', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir, runId } = runDirFixture();

  const first = archiveRunDir(root, runDir);
  assert.strictEqual(first.ok, true);
  // runDir is gone after a clean archival — re-run against the same (now
  // nonexistent) path exercises the fs.existsSync guards' no-op behavior.
  const second = archiveRunDir(root, runDir);
  assert.strictEqual(second.ok, true);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(path.join(archiveDir, 'config.yml')));
});

test('archiveRunDir: a git-tracked non-work file in the run dir refuses with reason tracked-entry', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'accidentally track a stray file'], root);

  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'tracked-entry');
  // Refusal is total — nothing else got moved either.
  assert.ok(fs.existsSync(path.join(runDir, 'config.yml')));
  assert.ok(fs.existsSync(path.join(runDir, 'tracked-stray.md')));
});

test('archiveRunDir: an unreadable run dir returns reason readdir-failed instead of throwing', chmodDenialSkip('root ignores directory permissions'), () => {
  // Review finding #902: a TOCTOU between the existsSync guard and the
  // readdirSync enumeration (dir deleted/permission-changed in between)
  // must not crash the caller — hooks.js's archive-run verb has no
  // try/catch of its own around this call.
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.chmodSync(runDir, 0o000);
  try {
    const result = archiveRunDir(root, runDir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'readdir-failed');
  } finally {
    fs.chmodSync(runDir, 0o755);
  }
});

// --- isOrphanedMint / archiveOrphanedMint: dispatch-minted dirs that never got adopted by flow ---

test('isOrphanedMint: false when config.yml exists, regardless of age', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-record-999', { ageMs: ORPHAN_MINT_TTL_MS * 2 });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
  assert.strictEqual(isOrphanedMint(dir), false);
});

test('isOrphanedMint: false when empty but within the grace window', () => {
  const { isOrphanedMint } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-15T000000-record-999');
  assert.strictEqual(isOrphanedMint(dir), false);
});

test('isOrphanedMint: true when empty (no config.yml) and older than the TTL', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-record-999', { ageMs: ORPHAN_MINT_TTL_MS + 60000 });
  assert.strictEqual(isOrphanedMint(dir), true);
});

test('archiveMerged: an orphaned mint older than the TTL is archived on the next sweep, not left in place', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T120000-record-999';
  mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS + 60000 });

  const result = archiveMerged({ cwd: root });

  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  assert.ok(fs.existsSync(archiveDir), 'orphaned mint should be moved to the archive path');
  assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', runId)), 'original mint dir should no longer exist');
  assert.ok(result.archived.includes(path.join(root, '.claude-tweaks', 'pipelines', runId)));
});

test('archiveMerged: an orphaned mint within the TTL is left in place, not archived', () => {
  const { archiveMerged } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-15T120000-record-999';
  const dir = mintEmptyRunDir(root, runId);

  archiveMerged({ cwd: root });

  assert.ok(fs.existsSync(dir), 'a fresh mint should not be swept before the grace window elapses');
});

// --- #1117: -adhoc-standalone mints (post-tool-use.js's stampAdHocRunDir)
// are exempt from the blind isOrphanedMint mtime sweep — see
// archive-merged.js's isAdHocStandaloneMint.

test('isOrphanedMint: false for a genuine adhoc-standalone mint, regardless of age (#1117)', () => {
  const { isOrphanedMint, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const dir = mintEmptyRunDir(root, '2026-08-01T000000-adhoc-standalone', { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  writeRunState(dir, { worktree: path.join(root, 'some-worktree'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isOrphanedMint(dir), false);
});

// #1604: the suffix alone is no longer sufficient — isAdHocStandaloneMint
// now also requires a real run-state.json carrying a non-empty `worktree`,
// closing the leak a malformed/mkdir-only dir sharing the suffix used to
// slip through (both isOrphanedMint's exemption and decideArchive's
// no-worktree/no-branch skip).
test('isAdHocStandaloneMint: requires the suffix AND a corroborating run-state.json worktree field (#1604)', () => {
  const { isAdHocStandaloneMint } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();

  const genuine = mintEmptyRunDir(root, '2026-08-01T000000-adhoc-standalone');
  writeRunState(genuine, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(genuine), true);

  const wrongSuffix = mintEmptyRunDir(root, '2026-08-01T000100-record-999');
  writeRunState(wrongSuffix, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(wrongSuffix), false);

  const extraSuffix = mintEmptyRunDir(root, '2026-08-01T000200-adhoc-standalone-extra');
  writeRunState(extraSuffix, { worktree: path.join(root, 'wt'), status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(extraSuffix), false);

  const noRunState = mintEmptyRunDir(root, '2026-08-01T000300-adhoc-standalone');
  assert.strictEqual(isAdHocStandaloneMint(noRunState), false, 'suffix alone, no run-state.json at all, must not be treated as ad-hoc');

  const noWorktreeField = mintEmptyRunDir(root, '2026-08-01T000400-adhoc-standalone');
  writeRunState(noWorktreeField, { status: 'active', sessionId: 'sess-1' });
  assert.strictEqual(isAdHocStandaloneMint(noWorktreeField), false, 'a run-state.json with no worktree field must not be treated as ad-hoc');
});

test('archiveMerged: an adhoc-standalone mint past the orphan TTL is left in place, not archived (#1117)', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const runId = '2026-08-01T120000-adhoc-standalone';
  const dir = mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  // A real ad-hoc dir's run-state.json always carries a `worktree` (stampAdHocRunDir) —
  // an arbitrary non-registered path here, so archiveMerged's merged-PR branch skips on
  // 'no-branch' without shelling out to `gh`, deliberately distinct from a genuine
  // orphaned mint (which has no run-state.json at all).
  writeRunState(dir, { worktree: path.join(root, 'nonexistent-worktree'), status: 'active', sessionId: 'sess-1' });

  const result = archiveMerged({ cwd: root });

  assert.ok(fs.existsSync(dir), 'adhoc-standalone mint should NOT be archived by the mtime orphan sweep');
  assert.ok(!result.archived.includes(dir));
  assert.ok(result.skipped.some((s) => s.runDir === dir && s.reason === 'no-branch'));
});

test('findRunsByWorktreePath still finds an adhoc-standalone dir after a reconcile sweep has run against it (#1117)', () => {
  const { archiveMerged, ORPHAN_MINT_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { writeRunState, findRunsByWorktreePath } = require('../plugin/bin/lib/hooks/context');
  const root = bareRepoRoot();
  const runId = '2026-08-01T130000-adhoc-standalone';
  const dir = mintEmptyRunDir(root, runId, { ageMs: ORPHAN_MINT_TTL_MS * 3 });
  const worktreePath = path.join(root, 'nonexistent-worktree');
  writeRunState(dir, { worktree: worktreePath, status: 'active', sessionId: 'sess-1' });

  archiveMerged({ cwd: root });

  const found = findRunsByWorktreePath(root, worktreePath, null);
  assert.ok(
    found.some((r) => r.runDir === dir),
    "the Friction lens's read path (bin/friction-events.js -> findRunsByWorktreePath) must still find the adhoc dir's events after the sweep",
  );
});

// --- #1604: isAdHocStandaloneSuperseded / archiveMerged's eventual-cleanup
// path for a genuinely superseded ad-hoc dir (worktree definitively gone) ---
//
// writeRunState() creates a file inside `dir`, which bumps the DIRECTORY's
// own mtime back to "now" — so any backdating must happen AFTER writing
// run-state.json, never via mintEmptyRunDir's own `ageMs` (which backdates
// before run-state.json exists, and gets silently undone).
function mintAdHocDir(root, runId, state, ageMs) {
  const { writeRunState } = require('../plugin/bin/lib/hooks/context');
  const dir = mintEmptyRunDir(root, runId);
  writeRunState(dir, state);
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

test('isAdHocStandaloneSuperseded: false while the recorded worktree still resolves, regardless of age (#1117 invariant unchanged)', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  // realpathSync(os.tmpdir()) — not the not-yet-created wtDir itself — since
  // macOS's /var is a symlink to /private/var and `git worktree list
  // --porcelain` always reports the resolved form; path.resolve() alone
  // does not resolve symlinks, so an unresolved wtDir would never match.
  const wtDir = path.join(fs.realpathSync(os.tmpdir()), `ct-recon-adhoc-wt-${Date.now()}`);
  git(['worktree', 'add', '-b', 'adhoc-live', wtDir], root);
  try {
    const state = { worktree: wtDir, status: 'active', sessionId: 'sess-1' };
    const dir = mintAdHocDir(root, '2026-08-01T140000-adhoc-standalone', state, ADHOC_SUPERSEDED_TTL_MS * 3);
    const { parseWorktreeList } = require('../plugin/bin/lib/hooks/worktree-reap');
    const { runGit } = require('../plugin/bin/lib/hooks/git-exec');
    const worktrees = parseWorktreeList(runGit(['worktree', 'list', '--porcelain'], root).stdout);
    assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, worktrees), false);
  } finally {
    git(['worktree', 'remove', '--force', wtDir], root);
  }
});

test('isAdHocStandaloneSuperseded: false when the worktree is gone but younger than the TTL', () => {
  const { isAdHocStandaloneSuperseded } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T150000-adhoc-standalone', state, 60 * 60 * 1000);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), false);
});

test('isAdHocStandaloneSuperseded: true when the worktree is gone AND the TTL has elapsed', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T160000-adhoc-standalone', state, ADHOC_SUPERSEDED_TTL_MS * 2);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), true);
});

test('isAdHocStandaloneSuperseded: false for a non-ad-hoc dir even past the TTL with a gone worktree', () => {
  const {
    isAdHocStandaloneSuperseded, ADHOC_SUPERSEDED_TTL_MS,
  } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, '2026-08-01T170000-record-42', state, ADHOC_SUPERSEDED_TTL_MS * 2);
  assert.strictEqual(isAdHocStandaloneSuperseded(dir, state, []), false);
});

test('archiveMerged: a superseded ad-hoc-standalone dir is archived (moved out of the live pipelines dir), ending the SessionStart/probePipelineRuns nag (#1604)', () => {
  const { archiveMerged, ADHOC_SUPERSEDED_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T180000-adhoc-standalone';
  const state = { worktree: path.join(root, 'long-gone-worktree'), status: 'active', sessionId: 'sess-1' };
  const dir = mintAdHocDir(root, runId, state, ADHOC_SUPERSEDED_TTL_MS * 2);

  const result = archiveMerged({ cwd: root });

  assert.ok(!fs.existsSync(dir), 'superseded ad-hoc dir must no longer sit in the live pipelines/ directory');
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)), 'it must have been moved to the archive/ location');
  assert.ok(result.archived.includes(dir));
});

test('archiveMerged: a still-live ad-hoc-standalone dir (worktree exists) is never swept, no matter how old (#1117 regression guard)', () => {
  const { archiveMerged, ADHOC_SUPERSEDED_TTL_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const wtDir = path.join(fs.realpathSync(os.tmpdir()), `ct-recon-adhoc-wt2-${Date.now()}`);
  git(['worktree', 'add', '-b', 'adhoc-live-2', wtDir], root);
  try {
    const runId = '2026-08-01T190000-adhoc-standalone';
    const state = { worktree: wtDir, status: 'active', sessionId: 'sess-1' };
    const dir = mintAdHocDir(root, runId, state, ADHOC_SUPERSEDED_TTL_MS * 3);

    const result = archiveMerged({ cwd: root });

    assert.ok(fs.existsSync(dir), 'a still-live ad-hoc dir must never be archived by the superseded sweep');
    assert.ok(!result.archived.includes(dir));
  } finally {
    git(['worktree', 'remove', '--force', wtDir], root);
  }
});

test('AC1.1 AC4.1 #4179: archiveMerged archives a main-checkout ad-hoc dir whose session is dead and past the grace period', () => {
  const { archiveMerged, ADHOC_SESSION_ENDED_GRACE_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T200000-adhoc-standalone';
  const dir = mintAdHocDir(root, runId, { worktree: root, status: 'interrupted', sessionId: 'sess-1', lastEvent: 'session-end' }, ADHOC_SESSION_ENDED_GRACE_MS * 2);
  const result = archiveMerged({ cwd: root, liveness: () => 'dead' });
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)));
  assert.ok(result.archived.includes(dir));
});

test('AC2.1 #4179: archiveMerged leaves a main-checkout ad-hoc dir in place while its session is live', () => {
  const { archiveMerged, ADHOC_SESSION_ENDED_GRACE_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const dir = mintAdHocDir(root, '2026-08-01T210000-adhoc-standalone', { worktree: root, status: 'active', sessionId: 'sess-1' }, ADHOC_SESSION_ENDED_GRACE_MS * 3);
  const result = archiveMerged({ cwd: root, liveness: () => 'live' });
  assert.ok(fs.existsSync(dir));
  assert.ok(!result.archived.includes(dir));
});

test('#4179: adHocSessionLiveness reads a legacy main-checkout ad-hoc dir with a 5-day-silent events log as dead, where runLiveness as-is does not', () => {
  const { adHocSessionLiveness } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { runLiveness } = require('../plugin/bin/lib/run-liveness');
  const root = bareRepoRoot(); // its seed commit is seconds old: last-commit reads positive as-is
  const dir = mintAdHocDir(root, '2026-08-01T220000-adhoc-standalone', { worktree: root, status: 'interrupted', sessionId: 'sess-1', lastEvent: 'session-end' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'gate-denial', ts: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), sessionId: 'sess-1' })}\n`);
  assert.equal(adHocSessionLiveness(dir), 'dead');
  assert.notEqual(runLiveness(dir).verdict, 'dead');
});

test('#4179: archiveMerged with the production-default liveness archives a legacy main-checkout ad-hoc dir silent for 5 days', () => {
  const { archiveMerged, ADHOC_SESSION_ENDED_GRACE_MS } = require('../plugin/bin/lib/reconcile/archive-merged');
  const root = bareRepoRoot();
  const runId = '2026-08-01T230000-adhoc-standalone';
  const dir = mintAdHocDir(root, runId, { worktree: root, status: 'interrupted', sessionId: 'sess-1', lastEvent: 'session-end' });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'gate-denial', ts: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(), sessionId: 'sess-1' })}\n`);
  // Backdate AFTER the events write — writing into the dir moved its mtime.
  const backdated = new Date(Date.now() - ADHOC_SESSION_ENDED_GRACE_MS * 2);
  fs.utimesSync(dir, backdated, backdated);

  const result = archiveMerged({ cwd: root, sessionId: 'other-session' }); // no `liveness` injection

  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId)));
  assert.ok(result.archived.includes(dir));
});

// --- isWorktreeLocked: reused verbatim from worktree-reap.js (not a copy) ---

test('isWorktreeLocked: a plain unlocked linked worktree is not locked', () => {
  const { originDir, mainDir } = pairedFixture();
  const wtDir = path.join(os.tmpdir(), `ct-recon-wt-${Date.now()}`);
  git(['worktree', 'add', '-b', 'feature-x', wtDir], mainDir);
  try {
    assert.strictEqual(isWorktreeLocked(wtDir, { cwd: mainDir }), false);
  } finally {
    git(['worktree', 'remove', '--force', wtDir], mainDir);
    void originDir;
  }
});

test('isWorktreeLocked: a path not registered in git worktree list at all is not locked (nothing to lock)', () => {
  const { mainDir } = pairedFixture();
  assert.strictEqual(isWorktreeLocked('/nonexistent/path/xyz', { cwd: mainDir }), false);
});

// --- reconcile() orchestrator: offline degradation and model gating ---

test('reconcile: local-merge project falls back to the legacy ancestry reap, skips mirror/release/archive (AC4-adjacent)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-lm-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  // No remote at all (truly no-forge) — integration-branch: must be explicit
  // in policy.yml for resolveIntegrationBranch to succeed, since there is no
  // origin/HEAD to fall back to. The legacy ancestry reap still needs a
  // resolved integration branch name regardless of forge reachability.
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-model: local-merge\nintegration-branch: main\n',
  );

  const r = await reconcile({ cwd: dir });
  assert.strictEqual(r.mirror, null);
  assert.deepStrictEqual(r.worktrees, []); // legacy reap ran, found zero worktrees to consider
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console', reason: 'local-merge-model' }]);
});

test('reconcile: local-merge with no resolvable integration branch at all resolves no-remote, never crashes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-lm-noib-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

test('reconcile: no network / no remote resolves to no-remote, never crashes (AC4)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noremote-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-remote' }]);
});

// #3503 F5: index.js hands archiveMerged's `unclosed` through to result.runs. A
// real reconcile() pass over a merged PR that leaves 3311 unclosed (its issue is
// OPEN) must report the skip with the record list, not just the reason.
test('reconcile: an archive merged-partial skip carries unclosed through to result.runs (#3503)', { skip: STUB_SKIP }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-partial-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  git(['branch', 'feat-partial'], root);
  git(['remote', 'add', 'origin', 'git@github.com:acme/w.git'], root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-17T062549-spec-3306-3311');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, '.claude', 'worktrees', 'gone'), pr: { number: 3503100, branch: 'feat-partial' },
  }));
  const pr = {
    number: 3503100, state: 'MERGED', mergedAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    closingIssuesReferences: [{ number: 3306, repository: { name: 'w', owner: { login: 'acme' } } }],
  };
  const restore = installStub('gh', [
    '#!/bin/sh',
    'if [ "$1" = "issue" ]; then echo \'{"state":"OPEN"}\'; exit 0; fi',
    `cat <<'EOF'\n${JSON.stringify(pr)}\nEOF`,
    '',
  ].join('\n'));
  const originalSshCommand = process.env.GIT_SSH_COMMAND;
  // #3630: ['archive'] now also runs mirror's shared fetch, and this origin is a
  // real-looking SSH URL — `false` makes that fetch fail fast instead of going
  // out over the network. mirror skips as fetch-failed; archive still runs.
  process.env.GIT_SSH_COMMAND = 'false';
  let r;
  try {
    r = await reconcile({ cwd: root, checks: ['archive'], resolveIntegrationModel: () => 'pr-first' });
  } finally {
    restore();
    if (originalSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = originalSshCommand;
  }
  assert.ok(r.skipped.some((s) => s.check.split(',').includes('mirror') && s.reason === 'fetch-failed'), JSON.stringify(r.skipped));
  assert.deepStrictEqual(r.runs, [{ runDir, action: 'skipped', reason: 'merged-partial', unclosed: [3311] }]);
});

// #3945 F6: index.js hands a tiebreak coverage skip's `missing` ids and `hint`
// through to result.runs the same way, so the refusal names what to fix.
test('reconcile: an archive tiebreak-coverage-missing skip carries missing and hint through to result.runs (#3945)', { skip: STUB_SKIP }, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-tiebreak-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  git(['branch', 'feat-tiebreak'], root);
  git(['remote', 'add', 'origin', 'git@github.com:acme/w.git'], root);
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-22T090000-record-3945');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: path.join(root, '.claude', 'worktrees', 'gone'), pr: { number: 3945100, branch: 'feat-tiebreak' },
  }));
  fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify([
    { id: 'abc123def456', lens: 'correctness', path: 'src/a.js', line: 3, claim: 'x', reporterSeverity: 'medium', kind: 'unconfirmed' },
  ]));
  const pr = {
    number: 3945100, state: 'MERGED', mergedAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z',
    closingIssuesReferences: [{ number: 3945, repository: { name: 'w', owner: { login: 'acme' } } }],
  };
  const restore = installStub('gh', [
    '#!/bin/sh',
    'if [ "$1" = "issue" ]; then echo \'{"state":"OPEN"}\'; exit 0; fi',
    `cat <<'EOF'\n${JSON.stringify(pr)}\nEOF`,
    '',
  ].join('\n'));
  let r;
  try {
    r = await reconcile({ cwd: root, checks: ['archive'], resolveIntegrationModel: () => 'pr-first' });
  } finally {
    restore();
  }
  assert.deepStrictEqual(r.runs, [{
    runDir,
    action: 'skipped',
    reason: 'tiebreak-coverage-missing',
    missing: ['abc123def456'],
    hint: "re-run the review step's findings writer for this run, or delete review-findings.json if the run predates the tiebreak",
  }]);
});

test('reconcile: outside any repo resolves to no-repo, never crashes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-norepo-'));
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [{ check: 'all', reason: 'no-repo' }]);
});

test('reconcile: a non-canonical (dash-less) run-dir name is surfaced, never silently omitted (#848)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-noncanon-'));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines', '20260817T173343-spec-764'), { recursive: true });
  // No remote configured, same as the no-remote fixture above — the
  // non-canonical-run-dir report must appear ahead of (not instead of) the
  // no-remote skip, since it runs before that gate.
  const r = await reconcile({ cwd: dir });
  assert.deepStrictEqual(r.skipped, [
    { check: 'all', reason: 'non-canonical-run-dir', names: ['20260817T173343-spec-764'] },
    { check: 'all', reason: 'no-remote' },
  ]);
});

test('reconcile: checks filter excludes reap -> local-merge project runs nothing at all', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-checks-'));
  git(['init', '-q', '--initial-branch=main'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-model: local-merge\nintegration-branch: main\n',
  );

  const r = await reconcile({ cwd: dir, checks: ['mirror'] });
  // 'mirror' was requested but has no local-merge equivalent — nothing runs.
  assert.strictEqual(r.worktrees, null);
  assert.deepStrictEqual(r.skipped, [{ check: 'mirror,release,post-merge,archive,archive-branches,remote-prune,ledger-residue,console', reason: 'local-merge-model' }]);
});
