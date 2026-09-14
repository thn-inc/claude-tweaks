'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideArchive, inScope, shouldAgeTag, encodeArchiveTagSuffix } = require('../../../plugin/bin/lib/reconcile/archive-branches');

const DAY = 24 * 60 * 60 * 1000;

// AC4: cherry-equivalent branch, no PR or closed PR -> delete (no tag)
test('decideArchive: cherry-equivalent + no PR -> delete', () => {
  const r = decideArchive({ branch: 'build/x', tipAgeDays: 2, cherryEquivalent: true, prState: null });
  assert.strictEqual(r.action, 'delete');
});
test('decideArchive: cherry-equivalent + closed PR -> delete', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 2, cherryEquivalent: true, prState: { number: 3, state: 'CLOSED' } }).action, 'delete');
});
test('decideArchive: cherry-equivalent + merged PR -> delete', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 2, cherryEquivalent: true, prState: { number: 3, state: 'MERGED' } }).action, 'delete');
});

// AC4: any OPEN PR -> skip, cherry-equivalent or not
test('decideArchive: open PR -> skip, even when cherry-equivalent', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: true, prState: { number: 3, state: 'OPEN' } }).action, 'skip');
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, prState: { number: 3, state: 'OPEN' } }).action, 'skip');
});

// AC4: genuinely unmerged, aged, no-pr / pr-closed-unmerged -> tag-and-delete
test('decideArchive: unmerged 15-day-old + closed-unmerged PR -> tag-and-delete', () => {
  const r = decideArchive({ branch: 'build/x', tipAgeDays: 15, cherryEquivalent: false, prState: { number: 3, state: 'CLOSED' } });
  assert.strictEqual(r.action, 'tag-and-delete');
});
test('decideArchive: unmerged 15-day-old + no PR -> tag-and-delete', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 15, cherryEquivalent: false, prState: null }).action, 'tag-and-delete');
});
test('decideArchive: unmerged 13-day-old -> skip (too young)', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 13, cherryEquivalent: false, prState: null }).action, 'skip');
});

// Fail closed on unknown PR state
test('decideArchive: transport failures -> skip', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: true, prState: 'gh-absent' }).action, 'skip');
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, prState: 'network-failure' }).action, 'skip');
});
test('decideArchive: unmerged + merged PR (rebased remnant) -> skip', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, prState: { number: 3, state: 'MERGED' } }).action, 'skip');
});

// #2252: squash provenance is the second proof — delete without a tag,
// exactly like cherry-equivalence, but never ahead of OPEN.
test('decideArchive: squash-merged (not cherry-equivalent) + merged PR -> delete, reason squash-merged', () => {
  const r = decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, squashMerged: true, prState: { number: 3, state: 'MERGED' } });
  assert.strictEqual(r.action, 'delete');
  assert.strictEqual(r.reason, 'squash-merged');
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, squashMerged: true, prState: { number: 3, state: 'OPEN' } }).action, 'skip');
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 30, cherryEquivalent: false, squashMerged: false, prState: { number: 3, state: 'MERGED' } }).reason, 'merged-pr-without-cherry-equivalence');
});
// #2252 review F4: squashMerged: true with a null/CLOSED prState is not a
// real proof — isSquashMerged already requires prState.state === 'MERGED'
// to ever return true, so `{ squashMerged: true, prState: null }` can only
// happen via a stale/malformed caller, exactly the shape the age rules exist
// to guard. The squash clause must sit BELOW nothingLanded so a young branch
// still reads too-young rather than deleting on an unproven squashMerged flag.
test('decideArchive: squashMerged:true with a null or CLOSED prState still takes the age rules (guard parity with cherryEquivalent)', () => {
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 2, cherryEquivalent: false, squashMerged: true, prState: null }).reason, 'too-young');
  assert.strictEqual(decideArchive({ branch: 'build/x', tipAgeDays: 2, cherryEquivalent: false, squashMerged: true, prState: { number: 3, state: 'CLOSED' } }).reason, 'too-young');
});

// AC4 scope guard: namespaces + worktree attachment
test('inScope: only build/*, worktree-*, demo/* namespaces', () => {
  assert.strictEqual(inScope('build/x', []), true);
  assert.strictEqual(inScope('worktree-record-42', []), true);
  assert.strictEqual(inScope('demo/y', []), true);
  assert.strictEqual(inScope('main', []), false);
  assert.strictEqual(inScope('feature/z', []), false);
  assert.strictEqual(inScope('flow/spec-1-2', []), false);
});
test('inScope: branch attached to a worktree is out of scope', () => {
  const wts = [{ path: '/w/a', branch: 'build/x' }];
  assert.strictEqual(inScope('build/x', wts), false);
  assert.strictEqual(inScope('build/y', wts), true);
});

// AC5: tag aging on committer date, 90-day threshold
test('shouldAgeTag: 91 days old -> true, 89 days -> false', () => {
  const now = Date.parse('2026-08-16T00:00:00Z');
  assert.strictEqual(shouldAgeTag(new Date(now - 91 * DAY).toISOString(), now), true);
  assert.strictEqual(shouldAgeTag(new Date(now - 89 * DAY).toISOString(), now), false);
});
test('shouldAgeTag: unparseable date -> false (fail closed)', () => {
  assert.strictEqual(shouldAgeTag('not-a-date', Date.now()), false);
});

// #548: encodeArchiveTagSuffix — flat (never contains '/') and injective
// (two distinct branch names never collide), the fix for the D/F ref
// conflict between e.g. archive/build/foo and archive/build/foo/bar.
test('encodeArchiveTagSuffix: never returns a string containing "/"', () => {
  assert.strictEqual(encodeArchiveTagSuffix('build/foo').includes('/'), false);
  assert.strictEqual(encodeArchiveTagSuffix('build/foo/bar').includes('/'), false);
  assert.strictEqual(encodeArchiveTagSuffix('worktree-record-42').includes('/'), false);
  assert.strictEqual(encodeArchiveTagSuffix('build/foo-bar').includes('/'), false);
});
test('encodeArchiveTagSuffix: the reported example does not collide', () => {
  assert.notStrictEqual(encodeArchiveTagSuffix('build/foo'), encodeArchiveTagSuffix('build/foo/bar'));
});
test('encodeArchiveTagSuffix: adversarial pair constructed to collide under naive "/"->"-" substitution does not collide', () => {
  // Naive `branch.replace(/\//g, '-')` maps both of these to the same
  // string ('build-foo-bar') because one input already contains a literal
  // '-' where the other's flattened '/' would land. Percent-encoding only
  // '/' (and '%' itself) keeps '-' untouched entirely, so the two stay
  // distinguishable.
  const a = encodeArchiveTagSuffix('build/foo-bar');
  const b = encodeArchiveTagSuffix('build/foo/bar');
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, 'build%2ffoo-bar');
  assert.strictEqual(b, 'build%2ffoo%2fbar');
});
// A prior fix attempt for this same function ("escape literal '-' as '--',
// then replace '/' with '-'") was itself not injective: a literal '-'
// immediately adjacent to a '/' collapses the run-length information that
// distinguishes the two cases. Caught in review (#548) before shipping —
// pinned here so it can never silently regress.
test('encodeArchiveTagSuffix: a literal "-" immediately adjacent to "/" does not collide (regression for a prior non-injective fix attempt)', () => {
  const a = encodeArchiveTagSuffix('ab-/cd');
  const b = encodeArchiveTagSuffix('ab/-cd');
  assert.notStrictEqual(a, b);
  assert.strictEqual(a, 'ab-%2fcd');
  assert.strictEqual(b, 'ab%2f-cd');
});
test('encodeArchiveTagSuffix: a literal "%2f" substring does not collide with an actual encoded slash', () => {
  assert.notStrictEqual(encodeArchiveTagSuffix('a%2fb'), encodeArchiveTagSuffix('a/b'));
});
test('encodeArchiveTagSuffix: a branch with no "/" or "%" passes through unchanged', () => {
  assert.strictEqual(encodeArchiveTagSuffix('worktree-record-42'), 'worktree-record-42');
});

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { archiveBranches } = require('../../../plugin/bin/lib/reconcile/archive-branches');
const { reconcile, ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-branches-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
}

// Screen-then-confirm (#1083): every pre-existing test below injects only
// `resolvePr` (the confirm step). Without an injected screen, the default
// resolvePrStatesBulk would run for real — same hazard prune-remote.test.js
// documents (repoSlugOf happily parses a bogus 'owner/repo' out of the
// fixture's file-path origin URL, so the default screen would spawn a live
// `gh api graphql`). Every branch here has no origin remote at all, but the
// nullScreen fake keeps every candidate on the confirm-per-branch path
// regardless, matching what today's tests already assume: a screen that
// knows nothing (the deleted-ref blind spot, #1082/#1083) rather than a
// screen that asserts MERGED — a permissive-MERGED screen would short-
// circuit before decideArchive's cherry check ever ran for these fixtures.
const nullScreen = (root, branches) => new Map(branches.map((b) => [b, null]));

test('archiveBranches: cherry-equivalent build/* branch is deleted; out-of-namespace branch untouched (dry-run reports, real run mutates)', () => {
  const dir = makeRepo();
  // cherry-equivalent branch: same patch as main's next commit
  git(dir, 'checkout', '-b', 'build/eq');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git(dir, 'add', 'b.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq');
  // out-of-namespace branch with the same shape
  git(dir, 'branch', 'feature/keep', 'build/eq');

  const dry = archiveBranches({ cwd: dir, integration: 'main', dryRun: true, resolvePr: () => null, resolvePrBulk: nullScreen });
  const dryEq = dry.entries.find((e) => e.name === 'build/eq');
  assert.strictEqual(dryEq.action, 'delete');
  assert.match(git(dir, 'branch', '--list', 'build/eq'), /build\/eq/); // dry-run did not mutate

  const real = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  const realEq = real.entries.find((e) => e.name === 'build/eq');
  assert.strictEqual(realEq.action, 'delete');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/eq').trim(), ''); // gone
  assert.match(git(dir, 'branch', '--list', 'feature/keep'), /feature\/keep/); // out of scope, untouched
});

// #2252 — a two-commit local branch squash-merged into main: `git cherry`
// cannot prove it (one squash commit, two branch patch-ids), so only the
// confirm's mergeCommit oid can. Parity with prune-remote (AC 4): the same
// squash-provenance.js helper, the same delete/skip outcome on the same shape.
function makeSquashMergedRepo() {
  const dir = makeRepo();
  git(dir, 'checkout', '-b', 'build/squashed');
  fs.writeFileSync(path.join(dir, 's1.txt'), 's1\n');
  git(dir, 'add', 's1.txt');
  git(dir, 'commit', '-m', 'first');
  fs.writeFileSync(path.join(dir, 's2.txt'), 's2\n');
  git(dir, 'add', 's2.txt');
  git(dir, 'commit', '-m', 'second');
  git(dir, 'checkout', 'main');
  const preSquash = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'merge', '--squash', 'build/squashed');
  git(dir, 'commit', '-m', 'feat: squashed (#2251)');
  const squash = git(dir, 'rev-parse', 'HEAD').trim();
  return { dir, preSquash, squash };
}
const screenMerged = (root, branches) => new Map(branches.map((b) => [b, { number: 1, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]));
const confirmMergedVia = (oid) => () => ({ number: 1, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid } });

test('archiveBranches: squash-merged branch (MERGED screen, confirm carries mergeCommit on the tip) is deleted with reason squash-merged, no tag — AC 4', () => {
  const { dir, squash } = makeSquashMergedRepo();
  let confirms = 0;
  const resolvePr = (...args) => { confirms += 1; return confirmMergedVia(squash)(...args); };
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk: screenMerged });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'delete');
  assert.strictEqual(entry.reason, 'squash-merged');
  assert.strictEqual(confirms, 1); // the squash candidate is confirmed per-branch exactly once
  assert.doesNotMatch(git(dir, 'branch', '--list', 'build/squashed'), /build\/squashed/); // really gone
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/*').trim(), ''); // no archive tag for a proven merge
});

test('archiveBranches: squash shape whose mergeCommit is no longer on the rewritten tip -> skip merged-pr-without-cherry-equivalence, branch kept — AC 5 parity', () => {
  const { dir, preSquash, squash } = makeSquashMergedRepo();
  git(dir, 'checkout', '--detach');
  git(dir, 'branch', '-f', 'main', preSquash);
  git(dir, 'checkout', 'main');
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: confirmMergedVia(squash), resolvePrBulk: screenMerged });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'merged-pr-without-cherry-equivalence');
  assert.match(git(dir, 'branch', '--list', 'build/squashed'), /build\/squashed/);
});

// #2252 review F1: same shape as prune-remote's parity test — the squash
// path ignores age, so this is deliberately NOT aged. A commit landed on the
// local branch AFTER the squash merge still confirms MERGED with the squash
// oid on the tip (cherry false, oid-on-tip true), but the branch's current
// content no longer matches what got squashed — the tree-equality condition
// is what catches it.
test('archiveBranches: squash-merged branch that gained a commit AFTER the merge -> skip merged-pr-without-cherry-equivalence, branch kept — F1', () => {
  const { dir, squash } = makeSquashMergedRepo();
  git(dir, 'checkout', 'build/squashed');
  fs.writeFileSync(path.join(dir, 's3.txt'), 's3\n');
  git(dir, 'add', 's3.txt');
  git(dir, 'commit', '-m', 'third, added after the squash merge');
  git(dir, 'checkout', 'main');
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: confirmMergedVia(squash), resolvePrBulk: screenMerged });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'merged-pr-without-cherry-equivalence');
  assert.match(git(dir, 'branch', '--list', 'build/squashed'), /build\/squashed/); // kept
});

// #2252 review F2: after `gh pr merge --delete-branch`, the remote branch is
// gone; the bulk screen's `ref()` returns null for it (pr-state.js's
// documented blind spot). A screen-null, AGED, squash-merged local branch
// reaches the confirm via the age-driven `tag-and-delete` provisional (never
// via `squashCandidate`, which is false when the screen returned null) — the
// bug was computing squashMerged only when `squashCandidate` held, hardcoding
// it false here and losing the confirm's own MERGED-with-mergeCommit verdict.
test('archiveBranches: aged squash-merged branch screened null (deleted-ref blind spot) still deletes via squash provenance, no tag — F2', () => {
  const { dir, squash } = makeSquashMergedRepo();
  const resolvePrBulk = () => new Map([['build/squashed', null]]); // screen blind spot
  const resolvePr = confirmMergedVia(squash); // confirm still carries mergeCommit
  const thirtyDaysLater = Date.now() + 30 * DAY; // ages the tip past BRANCH_AGE_DAYS without touching commit dates
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, now: thirtyDaysLater, resolvePr, resolvePrBulk });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'delete');
  assert.strictEqual(entry.reason, 'squash-merged');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/squashed').trim(), ''); // really gone
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/*').trim(), ''); // no archive tag for a proven merge
});

test('archiveBranches: unmerged aged branch gets archive tag then delete; young branch skipped', () => {
  const dir = makeRepo();
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/aged');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git(dir, 'add', 'c.txt');
  execFileSync('git', ['commit', '-m', 'aged'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(dir, 'checkout', 'main');
  git(dir, 'checkout', '-b', 'build/young');
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd\n');
  git(dir, 'add', 'd.txt');
  git(dir, 'commit', '-m', 'young');
  git(dir, 'checkout', 'main');

  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'build/aged').action, 'tag-and-delete');
  assert.strictEqual(r.entries.find((e) => e.name === 'build/young').action, 'skip');
  assert.match(git(dir, 'tag', '--list', 'archive/build%2faged'), /archive\/build%2faged/);
  assert.strictEqual(git(dir, 'branch', '--list', 'build/aged').trim(), '');
  assert.match(git(dir, 'branch', '--list', 'build/young'), /build\/young/);
});

test('archiveBranches: same-pass survival — 120-day-old tip gets tagged AND the tag survives the same pass (annotated tag ages from taggerdate, not the old commit date)', () => {
  const dir = makeRepo();
  const ancient = new Date(Date.now() - 120 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/veryold');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'f\n');
  git(dir, 'add', 'f.txt');
  execFileSync('git', ['commit', '-m', 'very old'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: ancient, GIT_AUTHOR_DATE: ancient },
  });
  git(dir, 'checkout', 'main');

  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  const entry = r.entries.find((e) => e.name === 'build/veryold');
  assert.strictEqual(entry.action, 'tag-and-delete');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/veryold').trim(), ''); // branch gone
  assert.match(git(dir, 'tag', '--list', 'archive/build%2fveryold'), /archive\/build%2fveryold/); // tag survives — not aged out in the same pass
});

test('archiveBranches: retry idempotency — a pre-existing lightweight archive tag from an earlier failed pass is force-replaced, not a dead end', () => {
  const dir = makeRepo();
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/retry');
  fs.writeFileSync(path.join(dir, 'g.txt'), 'g\n');
  git(dir, 'add', 'g.txt');
  execFileSync('git', ['commit', '-m', 'retry'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  const tip = git(dir, 'rev-parse', 'build/retry').trim();
  git(dir, 'tag', `archive/build%2fretry`, tip); // pre-existing lightweight tag, same tip, from an earlier failed pass
  git(dir, 'checkout', 'main');

  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  const entry = r.entries.find((e) => e.name === 'build/retry');
  assert.strictEqual(entry.action, 'tag-and-delete');
  assert.notStrictEqual(entry.reason, 'tag-failed');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/retry').trim(), '');
  assert.match(git(dir, 'tag', '--list', 'archive/build%2fretry'), /archive\/build%2fretry/);
});

// #548: the reported D/F-collision scenario. build/foo and build/foo/bar can
// never exist as branches at the same time (git refuses that ref-prefix
// overlap), so the repro archives-then-deletes build/foo first, then creates
// and archives the unrelated build/foo/bar — proving the old unencoded
// scheme's directory/file tag conflict (archive/build/foo would need to
// become a directory to hold archive/build/foo/bar) no longer happens.
test('archiveBranches: build/foo archived-and-deleted, then unrelated build/foo/bar archived — both succeed, two distinct tags, neither tag-failed', () => {
  const dir = makeRepo();
  const old = new Date(Date.now() - 20 * DAY).toISOString();

  git(dir, 'checkout', '-b', 'build/foo');
  fs.writeFileSync(path.join(dir, 'h1.txt'), 'h1\n');
  git(dir, 'add', 'h1.txt');
  execFileSync('git', ['commit', '-m', 'foo'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(dir, 'checkout', 'main');

  const first = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  const fooEntry = first.entries.find((e) => e.name === 'build/foo');
  assert.strictEqual(fooEntry.action, 'tag-and-delete');
  assert.notStrictEqual(fooEntry.reason, 'tag-failed');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/foo').trim(), ''); // deleted, so build/foo/bar can now be created

  git(dir, 'checkout', '-b', 'build/foo/bar');
  fs.writeFileSync(path.join(dir, 'h2.txt'), 'h2\n');
  git(dir, 'add', 'h2.txt');
  execFileSync('git', ['commit', '-m', 'foo/bar'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(dir, 'checkout', 'main');

  const second = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  const barEntry = second.entries.find((e) => e.name === 'build/foo/bar');
  assert.strictEqual(barEntry.action, 'tag-and-delete'); // never 'skip'/'tag-failed' — the reported D/F conflict
  assert.notStrictEqual(barEntry.reason, 'tag-failed');
  assert.strictEqual(git(dir, 'branch', '--list', 'build/foo/bar').trim(), '');

  // Two distinct, flat tags — neither a directory, both independently listable.
  assert.match(git(dir, 'tag', '--list', 'archive/build%2ffoo'), /archive\/build%2ffoo$/m);
  assert.match(git(dir, 'tag', '--list', 'archive/build%2ffoo%2fbar'), /archive\/build%2ffoo%2fbar/);
});

test('archiveBranches: archive/* tag older than 90 days is deleted, younger kept', () => {
  const dir = makeRepo();
  const ancient = new Date(Date.now() - 91 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/tagsrc');
  fs.writeFileSync(path.join(dir, 'e.txt'), 'e\n');
  git(dir, 'add', 'e.txt');
  execFileSync('git', ['commit', '-m', 'ancient'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: ancient, GIT_AUTHOR_DATE: ancient },
  });
  git(dir, 'tag', 'archive/old-tag');
  git(dir, 'checkout', 'main');
  git(dir, 'branch', '-D', 'build/tagsrc');
  git(dir, 'tag', 'archive/fresh-tag'); // points at main's tip (fresh committer date)

  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: nullScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'archive/old-tag' && e.kind === 'tag').action, 'aged-out');
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/old-tag').trim(), '');
  assert.match(git(dir, 'tag', '--list', 'archive/fresh-tag'), /archive\/fresh-tag/);
});

// --- screen-then-confirm (#1083) ---

const MERGED_PR_1083 = { number: 30, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const OPEN_PR_1083 = { number: 31, state: 'OPEN', mergedAt: null, updatedAt: '2026-02-01T00:00:00Z' };

test('screen: all-skip pass makes zero per-branch resolver calls, one bulk call, screen-sourced reasons', () => {
  const dir = makeRepo();
  // Reuse the squash-merge cherry-equivalent fixture shape from the first
  // archiveBranches test above — its provisional destiny doesn't matter
  // here: the OPEN screen must short-circuit before cherry is ever computed.
  git(dir, 'checkout', '-b', 'build/eq');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git(dir, 'add', 'b.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq');

  // A second in-scope branch, screened null (the deleted-ref blind spot),
  // young (~2 days) and NOT cherry-equivalent to main — its provisional
  // verdict is 'skip' (too-young) off decideArchive's age check alone, via
  // the normal per-branch cherry path (a git-only op), never a gh call.
  // Pins that a provisional-skip branch makes no per-branch gh call
  // regardless of which fast path (OPEN screen vs. too-young age) produced it.
  const recent = new Date(Date.now() - 2 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/young2');
  fs.writeFileSync(path.join(dir, 'y2.txt'), 'y2\n');
  git(dir, 'add', 'y2.txt');
  execFileSync('git', ['commit', '-m', 'young2'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: recent, GIT_AUTHOR_DATE: recent },
  });
  git(dir, 'checkout', 'main');

  let bulkCalls = 0; let confirmCalls = 0;
  const resolvePrBulk = (root, branches) => {
    bulkCalls += 1;
    assert.deepEqual([...branches].sort(), ['build/eq', 'build/young2']); // order-insensitive: both arrive in the one call
    return new Map([['build/eq', OPEN_PR_1083], ['build/young2', null]]);
  };
  const resolvePr = () => { confirmCalls += 1; return null; };
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  assert.equal(bulkCalls, 1);
  assert.equal(confirmCalls, 0);
  const entry = r.entries.find((e) => e.name === 'build/eq');
  assert.deepEqual(entry, { name: 'build/eq', kind: 'branch', action: 'skip', reason: 'pr-open' });
  assert.match(git(dir, 'branch', '--list', 'build/eq'), /build\/eq/); // still exists locally
  const entry2 = r.entries.find((e) => e.name === 'build/young2');
  assert.deepEqual(entry2, { name: 'build/young2', kind: 'branch', action: 'skip', reason: 'too-young' });
});

test('screen-delete candidate confirms per-branch; confirm OPEN -> skip pr-open, branch survives', () => {
  const dir = makeRepo();
  // AC2 deleted-ref blind spot: screen returns null (as if the branch's PR
  // history is invisible to the bulk ref() lookup) even though this branch
  // IS cherry-equivalent, so the provisional verdict is delete.
  git(dir, 'checkout', '-b', 'build/eq2');
  fs.writeFileSync(path.join(dir, 'b2.txt'), 'b2\n');
  git(dir, 'add', 'b2.txt');
  git(dir, 'commit', '-m', 'change2');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq2');

  let confirmCalls = 0;
  const resolvePrBulk = () => new Map([['build/eq2', null]]);
  const resolvePr = () => { confirmCalls += 1; return OPEN_PR_1083; };
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  assert.equal(confirmCalls, 1);
  const entry = r.entries.find((e) => e.name === 'build/eq2');
  assert.deepEqual(entry, { name: 'build/eq2', kind: 'branch', action: 'skip', reason: 'pr-open' });
  assert.match(git(dir, 'branch', '--list', 'build/eq2'), /build\/eq2/); // survives
});

test('screen-delete candidate: confirm MERGED-without-cherry never applies (cherry true governs); confirm null still deletes', () => {
  const dir = makeRepo();
  git(dir, 'checkout', '-b', 'build/eq3');
  fs.writeFileSync(path.join(dir, 'b3.txt'), 'b3\n');
  git(dir, 'add', 'b3.txt');
  git(dir, 'commit', '-m', 'change3');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq3');

  const resolvePrBulk = () => new Map([['build/eq3', null]]);
  const resolvePr = () => null;
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  const entry = r.entries.find((e) => e.name === 'build/eq3');
  assert.deepEqual(entry, { name: 'build/eq3', kind: 'branch', action: 'delete', reason: 'cherry-equivalent' });
  assert.strictEqual(git(dir, 'branch', '--list', 'build/eq3').trim(), ''); // deleted
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/build%2feq3').trim(), ''); // delete path, not tag-and-delete: no tag

  // MERGED-without-cherry-never-applies half: confirm returns MERGED (not
  // null) for a cherry-equivalent candidate — cherry true still governs
  // (decideArchive checks cherryEquivalent before the nothingLanded branch),
  // so the outcome is identical to the null-confirm case above: delete.
  git(dir, 'checkout', '-b', 'build/eq3b');
  fs.writeFileSync(path.join(dir, 'b3b.txt'), 'b3b\n');
  git(dir, 'add', 'b3b.txt');
  git(dir, 'commit', '-m', 'change3b');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq3b');

  const resolvePrBulkMerged = () => new Map([['build/eq3b', null]]);
  const resolvePrMerged = () => MERGED_PR_1083;
  const r2 = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr: resolvePrMerged, resolvePrBulk: resolvePrBulkMerged });
  const entry2 = r2.entries.find((e) => e.name === 'build/eq3b');
  assert.deepEqual(entry2, { name: 'build/eq3b', kind: 'branch', action: 'delete', reason: 'cherry-equivalent' });
  assert.strictEqual(git(dir, 'branch', '--list', 'build/eq3b').trim(), ''); // deleted
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/build%2feq3b').trim(), ''); // delete path, not tag-and-delete: no tag
});

test('aged tag-and-delete candidate: confirm MERGED downgrades to merged-pr-without-cherry-equivalence skip', () => {
  const dir = makeRepo();
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/aged2');
  fs.writeFileSync(path.join(dir, 'c2.txt'), 'c2\n');
  git(dir, 'add', 'c2.txt');
  execFileSync('git', ['commit', '-m', 'aged2'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(dir, 'checkout', 'main');

  const resolvePrBulk = () => new Map([['build/aged2', null]]);
  const resolvePr = () => MERGED_PR_1083;
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  const entry = r.entries.find((e) => e.name === 'build/aged2');
  assert.deepEqual(entry, { name: 'build/aged2', kind: 'branch', action: 'skip', reason: 'merged-pr-without-cherry-equivalence' });
  assert.match(git(dir, 'branch', '--list', 'build/aged2'), /build\/aged2/); // survives
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/build%2faged2').trim(), ''); // no tag created
});

test('dry-run still confirms candidates and reports final reasons; nothing deleted', () => {
  const dir = makeRepo();
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  git(dir, 'checkout', '-b', 'build/aged3');
  fs.writeFileSync(path.join(dir, 'c3.txt'), 'c3\n');
  git(dir, 'add', 'c3.txt');
  execFileSync('git', ['commit', '-m', 'aged3'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old },
  });
  git(dir, 'checkout', 'main');

  let confirmCalls = 0;
  const resolvePrBulk = () => new Map([['build/aged3', null]]);
  const resolvePr = () => { confirmCalls += 1; return null; };
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: true, resolvePr, resolvePrBulk });
  assert.ok(confirmCalls >= 1); // dry-run still confirms
  const entry = r.entries.find((e) => e.name === 'build/aged3');
  assert.match(entry.reason, /^unmerged-aged: /);
  assert.match(git(dir, 'branch', '--list', 'build/aged3'), /build\/aged3/); // nothing deleted
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/build%2faged3').trim(), '');
});

test('screen failure degrades to per-branch skips; tag-aging sweep still runs', () => {
  const dir = makeRepo();
  git(dir, 'checkout', '-b', 'build/anybranch');
  fs.writeFileSync(path.join(dir, 'z.txt'), 'z\n');
  git(dir, 'add', 'z.txt');
  git(dir, 'commit', '-m', 'z');
  git(dir, 'checkout', 'main');
  // An aged archive/* tag — wholly gh-independent — must still be swept in
  // the same pass despite the screen failure (#1083 review, reproduced).
  const ancient = new Date(Date.now() - 91 * DAY).toISOString();
  execFileSync('git', ['tag', '-a', '-m', 'ancient', 'archive/old-tag'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: ancient, GIT_AUTHOR_DATE: ancient },
  });

  let confirmCalls = 0;
  const resolvePr = () => { confirmCalls += 1; return null; };
  const net = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk: () => 'network-failure' });
  assert.strictEqual(net.failure, null);
  assert.deepEqual(net.entries.find((e) => e.name === 'build/anybranch'), { name: 'build/anybranch', kind: 'branch', action: 'skip', reason: 'network-failure' });
  assert.strictEqual(net.entries.find((e) => e.name === 'archive/old-tag' && e.kind === 'tag').action, 'aged-out');
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/old-tag').trim(), '');
  assert.equal(confirmCalls, 0);

  // Recreate the branch + an aged tag for the gh-absent variant.
  git(dir, 'checkout', '-b', 'build/anybranch2');
  fs.writeFileSync(path.join(dir, 'z2.txt'), 'z2\n');
  git(dir, 'add', 'z2.txt');
  git(dir, 'commit', '-m', 'z2');
  git(dir, 'checkout', 'main');
  execFileSync('git', ['tag', '-a', '-m', 'ancient2', 'archive/old-tag2'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_COMMITTER_DATE: ancient, GIT_AUTHOR_DATE: ancient },
  });

  const absent = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk: () => 'gh-absent' });
  assert.strictEqual(absent.failure, null);
  assert.deepEqual(absent.entries.find((e) => e.name === 'build/anybranch2'), { name: 'build/anybranch2', kind: 'branch', action: 'skip', reason: 'gh-absent' });
  assert.strictEqual(absent.entries.find((e) => e.name === 'archive/old-tag2' && e.kind === 'tag').action, 'aged-out');
  assert.strictEqual(git(dir, 'tag', '--list', 'archive/old-tag2').trim(), '');
  assert.equal(confirmCalls, 0); // zero per-branch gh work across both passes
});

test('per-candidate confirm failure skips that branch (gh-absent/network-failure reason), pass completes', () => {
  const dir = makeRepo();
  git(dir, 'checkout', '-b', 'build/eq4');
  fs.writeFileSync(path.join(dir, 'b4.txt'), 'b4\n');
  git(dir, 'add', 'b4.txt');
  git(dir, 'commit', '-m', 'change4');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/eq4');

  const resolvePrBulk = () => new Map([['build/eq4', null]]);
  const resolvePr = () => 'network-failure';
  const r = archiveBranches({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk });
  assert.strictEqual(r.failure, null);
  const entry = r.entries.find((e) => e.name === 'build/eq4');
  assert.deepEqual(entry, { name: 'build/eq4', kind: 'branch', action: 'skip', reason: 'network-failure' });
});

test('archiveBranches source order: OPEN-screened fast path precedes isCherryEquivalent in the branch loop', () => {
  const src = fs.readFileSync(require.resolve('../../../plugin/bin/lib/reconcile/archive-branches'), 'utf8');
  const openIdx = src.indexOf("screenPr.state === 'OPEN'");
  const cherryIdx = src.indexOf('isCherryEquivalent(root', openIdx);
  assert.ok(openIdx > -1 && cherryIdx > openIdx, 'OPEN screen check must come before the cherry call so OPEN branches skip cherry');
});

// AC6: index wiring
test("index: ALL_CHECKS includes 'archive-branches'; dispatch sits between 'archive' and 'reap'; result gains branches slot", () => {
  assert.ok(ALL_CHECKS.includes('archive-branches'));
  const src = fs.readFileSync(path.join(__dirname, '../../../plugin/bin/lib/reconcile/index.js'), 'utf8');
  const iArchive = src.indexOf("checks.includes('archive')");
  const iBranches = src.indexOf("checks.includes('archive-branches')");
  const iReap = src.indexOf("checks.includes('reap')", iArchive);
  assert.ok(iArchive > -1 && iBranches > iArchive && iReap > iBranches, 'dispatch order: archive < archive-branches < reap');
});

test('index: no-remote repo never dispatches archive-branches; result.branches stays null', async () => {
  const dir = makeRepo();
  // no origin remote -> resolveIntegrationBranch fails -> skipped no-remote; that
  // still proves archive-branches never dispatches outside pr-first. Assert the
  // result shape carries the branches slot untouched.
  const r = await reconcile({ cwd: dir, checks: ['archive-branches'] });
  assert.strictEqual(r.branches, null);
});
