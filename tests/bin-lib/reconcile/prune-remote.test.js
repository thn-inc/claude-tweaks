'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decideRemotePrune, pruneRemote } = require('../../../plugin/bin/lib/reconcile/prune-remote');

// The delete bar is deliberately stricter than archive-branches' local -D:
// a pushed deletion is unrecoverable from this checkout once origin GCs the
// ref, so it requires BOTH signals — a MERGED PR and cherry-equivalence.
test('decideRemotePrune: merged PR + cherry-equivalent -> delete', () => {
  const r = decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: { number: 3, state: 'MERGED' } });
  assert.strictEqual(r.action, 'delete');
  assert.strictEqual(r.reason, 'merged-pr-cherry-equivalent');
});
test('decideRemotePrune: open PR -> skip, even when cherry-equivalent', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: { number: 3, state: 'OPEN' } }).reason, 'pr-open');
});
// #2252 supersedes #1082's "no new per-branch reasons" pin for exactly one
// rename: `not-cherry-equivalent` -> `not-proven-merged`, because the skip
// now means "neither cherry-equivalence nor squash provenance proved it",
// and adds the delete-side `merged-pr-squash-merged`. Deliberate,
// documented exception — see docs/reconcile-checks.md's Merged-proof section.
test('decideRemotePrune: merged PR but neither proof (rebased remnant) -> skip not-proven-merged', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: false, prState: { number: 3, state: 'MERGED' } }).reason, 'not-proven-merged');
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: false, squashMerged: false, prState: { number: 3, state: 'MERGED' } }).reason, 'not-proven-merged');
});
test('decideRemotePrune: merged PR + squash provenance (not cherry-equivalent) -> delete', () => {
  const r = decideRemotePrune({ branch: 'build/x', cherryEquivalent: false, squashMerged: true, prState: { number: 3, state: 'MERGED' } });
  assert.strictEqual(r.action, 'delete');
  assert.strictEqual(r.reason, 'merged-pr-squash-merged');
});
test('decideRemotePrune: squash provenance never outranks OPEN or a missing merged PR', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: false, squashMerged: true, prState: { number: 3, state: 'OPEN' } }).reason, 'pr-open');
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: false, squashMerged: true, prState: null }).reason, 'no-merged-pr');
});
test('decideRemotePrune: cherry-equivalent but no PR / closed-unmerged PR -> skip (no merged-PR corroboration)', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: null }).reason, 'no-merged-pr');
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: { number: 3, state: 'CLOSED' } }).reason, 'no-merged-pr');
});
test('decideRemotePrune: transport failures -> skip (fail closed)', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: 'gh-absent' }).reason, 'gh-absent');
  assert.strictEqual(decideRemotePrune({ branch: 'build/x', cherryEquivalent: true, prState: 'network-failure' }).reason, 'network-failure');
});

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultRefExists } = require('../../../plugin/bin/lib/reconcile/prune-remote');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Screen-then-confirm (#1082): every pre-existing test below injects only
// `resolvePr` (the confirm step). Without an injected screen, the default
// resolvePrStatesBulk would run for real: repoSlugOf happily parses a bogus
// 'owner/repo' out of the fixture's file-path origin URL, so the default
// screen would spawn a live `gh api graphql` from tests. Inject a permissive
// fake so every branch takes the candidate path and each test's own
// resolvePr fake keeps governing.
const permissiveScreen = (root, branches) => new Map(branches.map((b) => [b, { number: 99, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]));

// A clone wired to a real bare origin — push --delete must actually land.
function makeRepoWithOrigin() {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-origin-'));
  git(origin, 'init', '--bare', '-b', 'main');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main');
  return dir;
}

// Two independently prunable remote branches (both cherry-equivalent + MERGED),
// built with the exact same steps as the single-branch delete test above,
// looped over 'build/b1' and 'build/b2' — the batch-push tests need at least
// two candidates in the same `pruneRemote()` pass to observe batching.
function buildTwoPrunableBranchesFixture() {
  const dir = makeRepoWithOrigin();
  for (const name of ['build/b1', 'build/b2']) {
    const file = `${name.replace('/', '-')}.txt`;
    git(dir, 'checkout', '-b', name);
    fs.writeFileSync(path.join(dir, file), `${name}\n`);
    git(dir, 'add', file);
    git(dir, 'commit', '-m', `change ${name}`);
    git(dir, 'push', 'origin', name);
    git(dir, 'checkout', 'main');
    git(dir, 'cherry-pick', name); // merged in substance (squash-merge shape)
    git(dir, 'branch', '-D', name); // local branch already disposed; remote lingers
  }
  return { root: dir, integration: 'main' };
}

test('pruneRemote: squash-merged remote build/* branch is deleted on origin; dry-run only reports', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/merged');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  git(dir, 'add', 'b.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'push', 'origin', 'build/merged');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/merged'); // merged in substance (squash-merge shape)
  git(dir, 'branch', '-D', 'build/merged'); // local branch already disposed; remote lingers

  const dry = pruneRemote({ cwd: dir, integration: 'main', dryRun: true, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(dry.entries.find((e) => e.name === 'build/merged').action, 'delete');
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/merged'), /build\/merged/); // dry-run did not mutate

  const real = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  const entry = real.entries.find((e) => e.name === 'build/merged');
  assert.strictEqual(entry.action, 'delete');
  assert.strictEqual(entry.kind, 'remote-branch');
  assert.strictEqual(git(dir, 'ls-remote', 'origin', 'refs/heads/build/merged').trim(), ''); // gone on origin
});

// The evidence is read from local refs/remotes/origin/* but the delete lands
// on origin's LIVE ref, and `push --delete` has no --force-with-lease. So the
// check must refresh those refs itself: without the internal fetch, a branch
// another clone has pushed to since our last fetch still reads merged here and
// the delete destroys commits this checkout never saw. Deleting the fetch call
// makes this test fail with the branch actually gone from origin.
test('pruneRemote: refreshes origin before judging — a branch advanced from another clone is not deleted on stale evidence', () => {
  const dir = makeRepoWithOrigin();
  const originUrl = git(dir, 'remote', 'get-url', 'origin').trim();
  git(dir, 'checkout', '-b', 'build/stale');
  fs.writeFileSync(path.join(dir, 'h.txt'), 'h\n');
  git(dir, 'add', 'h.txt');
  git(dir, 'commit', '-m', 'merged part');
  git(dir, 'push', 'origin', 'build/stale');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/stale'); // this clone's snapshot IS cherry-equivalent…
  git(dir, 'branch', '-D', 'build/stale');

  // …but another machine pushes a further commit to the same remote branch.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-clone2-'));
  git(other, 'clone', originUrl, 'c');
  const clone2 = path.join(other, 'c');
  git(clone2, 'config', 'user.email', 't@t');
  git(clone2, 'config', 'user.name', 't');
  git(clone2, 'checkout', 'build/stale');
  fs.writeFileSync(path.join(clone2, 'i.txt'), 'i\n');
  git(clone2, 'add', 'i.txt');
  git(clone2, 'commit', '-m', 'work this clone never saw');
  git(clone2, 'push', 'origin', 'build/stale');

  // No fetch in `dir` — its refs/remotes/origin/build/stale is deliberately stale.
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  const entry = r.entries.find((e) => e.name === 'build/stale');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'not-proven-merged'); // the internal fetch pulled the new commit in
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/stale'), /build\/stale/); // unfetched work survives
});

test('pruneRemote: unmerged remote branch and non-namespace remote branch are never deleted', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/unmerged');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  git(dir, 'add', 'c.txt');
  git(dir, 'commit', '-m', 'unmerged');
  git(dir, 'push', 'origin', 'build/unmerged');
  git(dir, 'checkout', 'main');
  git(dir, 'branch', '-D', 'build/unmerged');
  git(dir, 'checkout', '-b', 'feature/out-of-scope');
  fs.writeFileSync(path.join(dir, 'd.txt'), 'd\n');
  git(dir, 'add', 'd.txt');
  git(dir, 'commit', '-m', 'oos');
  git(dir, 'push', 'origin', 'feature/out-of-scope');
  git(dir, 'checkout', 'main');
  git(dir, 'branch', '-D', 'feature/out-of-scope');

  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'build/unmerged').reason, 'not-proven-merged');
  assert.strictEqual(r.entries.find((e) => e.name === 'feature/out-of-scope'), undefined); // silent scope guard
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/unmerged'), /build\/unmerged/);
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/feature/out-of-scope'), /feature\/out-of-scope/);
});

// #2252 — the squash-merge shape `gh pr merge --squash` leaves on origin's
// main: a two-commit branch collapsed into one commit whose patch-id matches
// neither branch commit, so `git cherry` reads it as unmerged. The confirm's
// mergeCommit oid is what proves it.
function buildSquashMergedFixture() {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/squashed');
  fs.writeFileSync(path.join(dir, 's1.txt'), 's1\n');
  git(dir, 'add', 's1.txt');
  git(dir, 'commit', '-m', 'first');
  fs.writeFileSync(path.join(dir, 's2.txt'), 's2\n');
  git(dir, 'add', 's2.txt');
  git(dir, 'commit', '-m', 'second');
  git(dir, 'push', 'origin', 'build/squashed');
  git(dir, 'checkout', 'main');
  const preSquash = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'merge', '--squash', 'build/squashed');
  git(dir, 'commit', '-m', 'feat: squashed (#2251)');
  const squash = git(dir, 'rev-parse', 'HEAD').trim();
  git(dir, 'branch', '-D', 'build/squashed'); // local branch disposed; remote lingers
  return { dir, preSquash, squash };
}
const mergedVia = (oid) => ({ number: 1, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', mergeCommit: { oid } });

test('pruneRemote: squash-merged multi-commit branch (MERGED PR + mergeCommit on the tip) is deleted on origin — AC 1', () => {
  const { dir, squash } = buildSquashMergedFixture();
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => mergedVia(squash), resolvePrBulk: permissiveScreen });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'delete');
  assert.strictEqual(entry.reason, 'merged-pr-squash-merged');
  assert.strictEqual(git(dir, 'ls-remote', 'origin', 'refs/heads/build/squashed').trim(), ''); // gone on origin
});

test('pruneRemote: same squash shape but no merged PR -> skip not-proven-merged, branch survives — AC 2', () => {
  const { dir } = buildSquashMergedFixture();
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => null, resolvePrBulk: permissiveScreen });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'not-proven-merged');
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/squashed'), /build\/squashed/);
});

test('pruneRemote: MERGED PR whose mergeCommit is no longer on the rewritten tip -> skip not-proven-merged, never deleted — AC 5', () => {
  const { dir, preSquash, squash } = buildSquashMergedFixture();
  git(dir, 'checkout', '--detach');
  git(dir, 'branch', '-f', 'main', preSquash); // force-pushed/rewritten integration history: the squash commit is gone
  git(dir, 'checkout', 'main');
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => mergedVia(squash), resolvePrBulk: permissiveScreen });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'not-proven-merged');
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/squashed'), /build\/squashed/);
});

// #2252 review F1: a squash merge only proves the PR's own mergeCommit sat
// on the integration branch at some point — it says nothing about commits
// pushed to the branch AFTER that merge. Same shape as the "refreshes origin
// before judging" test above (a second clone pushes work this checkout
// never saw), but here the branch is ALREADY proven merged via squash
// provenance and gains a commit afterward — the fetch pulls that commit in,
// and the third (tree-equality) condition is what catches it.
test('pruneRemote: branch advanced after its squash merge (another clone pushed a commit; PR still MERGED with the squash oid) -> skip not-proven-merged, remote ref survives — F1', () => {
  const { dir, squash } = buildSquashMergedFixture();
  const originUrl = git(dir, 'remote', 'get-url', 'origin').trim();

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-clone3-'));
  git(other, 'clone', originUrl, 'c');
  const clone = path.join(other, 'c');
  git(clone, 'config', 'user.email', 't@t');
  git(clone, 'config', 'user.name', 't');
  git(clone, 'checkout', 'build/squashed');
  fs.writeFileSync(path.join(clone, 's3.txt'), 's3\n');
  git(clone, 'add', 's3.txt');
  git(clone, 'commit', '-m', 'third, pushed after the squash merge');
  git(clone, 'push', 'origin', 'build/squashed');

  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => mergedVia(squash), resolvePrBulk: permissiveScreen });
  const entry = r.entries.find((e) => e.name === 'build/squashed');
  assert.strictEqual(entry.action, 'skip');
  assert.strictEqual(entry.reason, 'not-proven-merged');
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/squashed'), /build\/squashed/); // survives
});

test('pruneRemote: integration branch is excluded even when it sits inside the plugin namespace', () => {
  // Namespaced (build/*), trivially cherry-equivalent against itself, and
  // NOT the branch currently checked out in this worktree (so the
  // live-worktree half of inScope can't be why it survives either) —
  // only the branch === integration guard can be what keeps it out of
  // entries. (A namespaced branch that IS the checked-out branch would
  // accidentally be protected by the live-worktree guard instead, since
  // the primary worktree's own branch always self-matches that check.)
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/trunk');
  fs.writeFileSync(path.join(dir, 'g.txt'), 'g\n');
  git(dir, 'add', 'g.txt');
  git(dir, 'commit', '-m', 'trunk');
  git(dir, 'push', 'origin', 'build/trunk');
  git(dir, 'checkout', 'main'); // build/trunk stays as a local ref but is no longer attached to any worktree

  const r = pruneRemote({ cwd: dir, integration: 'build/trunk', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'build/trunk'), undefined);
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/trunk'), /build\/trunk/);
});

test('pruneRemote: origin/HEAD symbolic ref is never a candidate, alongside a real deletable branch', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'remote', 'set-head', 'origin', 'main'); // creates the symbolic refs/remotes/origin/HEAD ref
  git(dir, 'checkout', '-b', 'build/merged2');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'f\n');
  git(dir, 'add', 'f.txt');
  git(dir, 'commit', '-m', 'change2');
  git(dir, 'push', 'origin', 'build/merged2');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/merged2');
  git(dir, 'branch', '-D', 'build/merged2');

  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'build/merged2').action, 'delete');
  assert.strictEqual(r.entries.find((e) => e.name === 'HEAD'), undefined);
  assert.strictEqual(git(dir, 'ls-remote', 'origin', 'refs/heads/build/merged2').trim(), ''); // real branch actually deleted
  assert.match(git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD'), /refs\/remotes\/origin\/main/); // origin/HEAD survives untouched
});

// skipFetch trusts the caller already refreshed origin/* this pass
// (reconcile()'s shared fetch, #820 D2) — pointing origin at an invalid URL
// proves no second fetch is attempted: if pruneRemote still fetched despite
// skipFetch, this would surface as `fetch-failed` instead of a real result.
test('pruneRemote: skipFetch=true never calls fetch, trusts already-fetched refs', () => {
  const dir = makeRepoWithOrigin();
  const originUrl = git(dir, 'remote', 'get-url', 'origin').trim();
  git(dir, 'fetch', '--prune', 'origin'); // caller already fetched, simulating the shared-fetch path
  git(dir, 'remote', 'set-url', 'origin', 'https://example.invalid/nope.git');

  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, skipFetch: true, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(r.failure, null);
  void originUrl;
});

test('pruneRemote: branch attached to a live worktree is silently out of scope', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/wt');
  fs.writeFileSync(path.join(dir, 'e.txt'), 'e\n');
  git(dir, 'add', 'e.txt');
  git(dir, 'commit', '-m', 'wt');
  git(dir, 'push', 'origin', 'build/wt');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/wt'); // even cherry-equivalent…
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-wt-'));
  git(dir, 'worktree', 'add', path.join(wt, 'w'), 'build/wt'); // …but attached to a live worktree

  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  assert.strictEqual(r.entries.find((e) => e.name === 'build/wt'), undefined);
  assert.match(git(dir, 'ls-remote', 'origin', 'refs/heads/build/wt'), /build\/wt/);
});

// gitExec.runGit = stub does NOT work here: prune-remote.js does
// `const { runGit } = require('../hooks/git-exec')` once at module load,
// which copies the function VALUE into a local const at that instant.
// Reassigning `gitExec.runGit` afterward only changes what a fresh
// `require('../hooks/git-exec').runGit` property lookup returns — the
// already-bound local `runGit` inside prune-remote.js keeps pointing at the
// original function (see tests/reconcile.test.js's identical note on
// classify.js/shared-fetch.js, #820 D2). Intercept at the process-spawn
// boundary instead: a `git` wrapper placed first on PATH.
function installPushWrapper(failMultiBranch) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-gitwrap-'));
  const logFile = path.join(wrapperDir, 'push-calls.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const wrapperPath = path.join(wrapperDir, 'git');
  // Real invocation shape is `git -C <cwd> push origin --delete <branch...>`,
  // so $1=-C $2=<cwd> $3=push $4=origin $5=--delete $6=<branch1> $7=<branch2?>.
  // When failMultiBranch is set, a push --delete naming 2+ branches (the
  // batch) exits 1 without touching origin; a single-branch push --delete
  // (the per-branch fallback) is let through to real git.
  const failClause = failMultiBranch ? '\n  if [ -n "$7" ]; then\n    exit 1\n  fi' : '';
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nif [ "$3" = "push" ]; then\n  echo "$@" >> "${logFile}"${failClause}\nfi\nexec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(wrapperPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return {
    logFile,
    restore: () => { process.env.PATH = originalPath; },
  };
}

test('pruneRemote: multiple prunable branches are deleted with ONE push call, not one per branch', () => {
  const { root, integration } = buildTwoPrunableBranchesFixture();
  const wrapper = installPushWrapper(false);
  let result;
  try {
    result = pruneRemote({ cwd: root, integration, skipFetch: true, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  } finally {
    wrapper.restore();
  }
  const pushLines = fs.readFileSync(wrapper.logFile, 'utf8').split('\n').filter(Boolean);
  assert.equal(pushLines.length, 1, `expected one batched push, saw ${pushLines.length}: ${JSON.stringify(pushLines)}`);
  assert.match(pushLines[0], /build\/b1/);
  assert.match(pushLines[0], /build\/b2/);
  assert.equal(result.entries.filter((e) => e.action === 'delete').length, 2);
});

test('pruneRemote: a failed batch push falls back to per-branch deletes, one bad ref does not swallow the rest', () => {
  const { root, integration } = buildTwoPrunableBranchesFixture();
  const wrapper = installPushWrapper(true);
  let result;
  try {
    result = pruneRemote({ cwd: root, integration, skipFetch: true, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  } finally {
    wrapper.restore();
  }
  const pushLines = fs.readFileSync(wrapper.logFile, 'utf8').split('\n').filter(Boolean);
  const batchAttempted = pushLines.some((l) => /build\/b1/.test(l) && /build\/b2/.test(l));
  assert.equal(batchAttempted, true, `expected a batch attempt naming both branches, saw ${JSON.stringify(pushLines)}`);
  assert.equal(result.entries.filter((e) => e.action === 'delete').length, 2, 'per-branch fallback still deletes both');
});

// Review finding: the per-branch fallback's own push can fail because the
// branch was ALREADY gone (deleted by the batch despite its own nonzero
// exit, or by a concurrent reconcile pass) — that must read as a completed
// delete, not delete-failed. build/b1 is deleted on origin out-of-band, by a
// SECOND clone (deleting via `root`'s own git auto-prunes its local tracking
// ref immediately, defeating the repro — a second clone's delete does not),
// before pruneRemote ever runs; skipFetch: true means root's stale local
// tracking ref still makes b1 look like a normal candidate, so only the
// fallback push itself exposes that it's gone.
test('pruneRemote: batch fails; a branch already deleted before the fallback push is reported delete, not delete-failed', () => {
  const { root, integration } = buildTwoPrunableBranchesFixture();
  const originUrl = git(root, 'remote', 'get-url', 'origin').trim();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-clone3-'));
  git(other, 'clone', originUrl, 'c');
  git(path.join(other, 'c'), 'push', 'origin', '--delete', 'build/b1');
  const wrapper = installPushWrapper(true); // batch push fails without touching origin; single-branch pushes hit real git
  let result;
  try {
    result = pruneRemote({ cwd: root, integration, skipFetch: true, resolvePr: () => ({ number: 1, state: 'MERGED' }), resolvePrBulk: permissiveScreen });
  } finally {
    wrapper.restore();
  }
  const b1 = result.entries.find((e) => e.name === 'build/b1');
  const b2 = result.entries.find((e) => e.name === 'build/b2');
  assert.strictEqual(b1.action, 'delete', `already-gone branch must be reported delete, not misreported as ${b1.action}/${b1.reason}`);
  assert.strictEqual(b2.action, 'delete', 'a genuinely present branch still deletes normally');
});

// A genuine, non-"already gone" per-branch failure — a wrapper that fails
// EVERY push --delete naming build/b1 (batch and single-branch fallback
// alike), never reaching real git for it — must still report delete-failed:
// checkRefExists reporting the ref is still present (or indeterminate, on a
// bad connection) must never be read as success.
function installAlwaysFailWrapper(branchToFail) {
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-remote-gitwrap2-'));
  const logFile = path.join(wrapperDir, 'push-calls.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const wrapperPath = path.join(wrapperDir, 'git');
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\n` +
    `if [ "$3" = "push" ]; then\n` +
    `  echo "$@" >> "${logFile}"\n` +
    `  case " $* " in\n` +
    `    *" ${branchToFail} "*) exit 1 ;;\n` +
    `  esac\n` +
    `fi\n` +
    `exec "${realGit}" "$@"\n`,
  );
  fs.chmodSync(wrapperPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { logFile, restore: () => { process.env.PATH = originalPath; } };
}

test('pruneRemote: a genuine per-branch delete failure still reports delete-failed', () => {
  const { root, integration } = buildTwoPrunableBranchesFixture();
  const wrapper = installAlwaysFailWrapper('build/b1');
  let result;
  try {
    result = pruneRemote({
      cwd: root, integration, skipFetch: true,
      resolvePr: () => ({ number: 1, state: 'MERGED' }),
      resolvePrBulk: permissiveScreen,
      refExists: () => true, // both branches provably still exist on origin
    });
  } finally {
    wrapper.restore();
  }
  assert.strictEqual(result.entries.find((e) => e.name === 'build/b1').action, 'skip');
  assert.strictEqual(result.entries.find((e) => e.name === 'build/b1').reason, 'delete-failed');
  assert.strictEqual(result.entries.find((e) => e.name === 'build/b2').action, 'delete');
});

test('defaultRefExists: true when the ref is present, false when git ls-remote --exit-code reports it missing (exit 2), null on any other failure', () => {
  const dir = makeRepoWithOrigin();
  assert.strictEqual(defaultRefExists(dir, 'main', 5000), true);
  assert.strictEqual(defaultRefExists(dir, 'no-such-branch-at-all', 5000), false);
  // An unreachable remote fails ls-remote itself (git exit 128, "fatal"), a
  // different exit code from the ref-not-found case above (exit 2) — must
  // read as indeterminate, never as "gone".
  execFileSync('git', ['-C', dir, 'remote', 'set-url', 'origin', '/no/such/path/at/all'], { stdio: 'ignore' });
  assert.strictEqual(defaultRefExists(dir, 'main', 5000), null);
});

const { reconcile, ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');

test("index: ALL_CHECKS includes 'remote-prune'; dispatch sits between 'archive-branches' and 'reap'; result gains remoteBranches slot", () => {
  assert.ok(ALL_CHECKS.includes('remote-prune'));
  const src = fs.readFileSync(path.join(__dirname, '../../../plugin/bin/lib/reconcile/index.js'), 'utf8');
  const iBranches = src.indexOf("checks.includes('archive-branches')");
  // Search from iBranches: the shared-fetch gate above the mirror dispatch
  // (#820 D2) also tests `checks.includes('remote-prune')` — as part of
  // deciding whether to run the one shared fetch at all — so the literal
  // string now appears earlier in the file too. The actual dispatch block is
  // the occurrence after archive-branches.
  const iRemote = src.indexOf("checks.includes('remote-prune')", iBranches);
  const iReap = src.indexOf("checks.includes('reap')", iBranches);
  assert.ok(iBranches > -1 && iRemote > iBranches && iReap > iRemote, 'dispatch order: archive-branches < remote-prune < reap');
});

test('index: pr-first repo with a working remote actually reaches the remote-prune dispatch; requesting a different check leaves remoteBranches null', async () => {
  // A no-remote fixture never reaches the dispatch at all (it short-circuits
  // at the earlier `if (!integration)` guard) — that would pass even with
  // the dispatch block deleted, so it doesn't discriminate. This fixture has
  // a real working origin and forces pr-first (integration-model detection
  // shells to `gh repo view`, which has no real GitHub repo to find here),
  // so `checks: ['remote-prune']` must actually run pruneRemote() and land
  // an array (even an empty one — no in-namespace remote branches exist) in
  // result.remoteBranches. Deleting the dispatch block makes this fail.
  const dir = makeRepoWithOrigin();
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-model: pr-first\nintegration-branch: main\n',
  );

  // reconcile()'s preflight shells to the real `gh api rate_limit` with a
  // 2s timeout; that live network call flaked in CI (observed failures at
  // ~2051ms, right at the ceiling), skipping the remote-prune dispatch and
  // leaving remoteBranches null regardless of this fixture. Stub it the
  // same way tests/reconcile.test.js does throughout, so this test only
  // discriminates on the dispatch block itself.
  const preflight = require('../../../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  try {
    const withDispatch = await reconcile({ cwd: dir, checks: ['remote-prune'] });
    assert.ok(Array.isArray(withDispatch.remoteBranches), 'remote-prune requested under pr-first must set remoteBranches to an array, not stay null');

    const withoutDispatch = await reconcile({ cwd: dir, checks: ['mirror'] });
    assert.strictEqual(withoutDispatch.remoteBranches, null, 'remote-prune not requested must leave remoteBranches null');
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
});

test('pruneRemote passes preferOpen to its PR resolver (destructive tie-break wiring, #664)', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/reused');
  fs.writeFileSync(path.join(dir, 'r.txt'), 'r\n');
  git(dir, 'add', 'r.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'push', 'origin', 'build/reused');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/reused'); // cherry-equivalent (squash-merge shape)
  git(dir, 'branch', '-D', 'build/reused');

  const seenOpts = [];
  const resolvePr = (root, branch, opts) => { seenOpts.push(opts); return null; };
  pruneRemote({ cwd: dir, integration: 'main', dryRun: true, resolvePr, skipFetch: true, resolvePrBulk: permissiveScreen });
  assert.equal(seenOpts.length, 1);
  assert.deepEqual(seenOpts[0], { preferOpen: true });
});

test('#570 scenario: cherry-equivalent branch with MERGED + newer OPEN PR is skipped pr-open, ref survives on origin', () => {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/reused');
  fs.writeFileSync(path.join(dir, 'r.txt'), 'r\n');
  git(dir, 'add', 'r.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'push', 'origin', 'build/reused');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/reused');
  git(dir, 'branch', '-D', 'build/reused');

  // Contract-mimicking fake: with preferOpen the OPEN PR governs (Task 1's
  // real behavior); without it the MERGED one would — which is exactly the
  // pre-#664 bug this test locks out.
  const resolvePr = (root, branch, opts) => (opts && opts.preferOpen
    ? { number: 11, state: 'OPEN', mergedAt: null, updatedAt: '2026-02-01T00:00:00Z' }
    : { number: 10, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, skipFetch: true, resolvePrBulk: permissiveScreen });
  assert.equal(r.failure, null);
  const entry = r.entries.find((e) => e.name === 'build/reused');
  assert.equal(entry.action, 'skip');
  assert.equal(entry.reason, 'pr-open');
  // The pushed ref must still exist — no delete may have landed.
  const lsRemote = git(dir, 'ls-remote', '--heads', 'origin', 'build/reused');
  assert.match(lsRemote, /refs\/heads\/build\/reused/);
});

// Shared fixture: one in-scope, cherry-equivalent remote branch (squash-merge shape).
function buildScreenFixture() {
  const dir = makeRepoWithOrigin();
  git(dir, 'checkout', '-b', 'build/screened');
  fs.writeFileSync(path.join(dir, 's.txt'), 's\n');
  git(dir, 'add', 's.txt');
  git(dir, 'commit', '-m', 'change');
  git(dir, 'push', 'origin', 'build/screened');
  git(dir, 'checkout', 'main');
  git(dir, 'cherry-pick', 'build/screened');
  git(dir, 'branch', '-D', 'build/screened');
  return dir;
}
const MERGED_PR = { number: 20, state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
const OPEN_PR = { number: 21, state: 'OPEN', mergedAt: null, updatedAt: '2026-02-01T00:00:00Z' };

test('screen-then-confirm: zero candidates -> one bulk call, zero per-branch resolver calls, screen-sourced reasons', () => {
  const dir = buildScreenFixture();
  let bulkCalls = 0; let confirmCalls = 0;
  const resolvePrBulk = (root, branches, opts) => {
    bulkCalls += 1;
    assert.deepEqual(branches, ['build/screened']);
    assert.equal(opts && opts.preferOpen, true);
    return new Map([['build/screened', OPEN_PR]]);
  };
  const resolvePr = () => { confirmCalls += 1; return null; };
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  assert.equal(r.failure, null);
  assert.equal(bulkCalls, 1);
  assert.equal(confirmCalls, 0); // screen-skip is terminal — confirm never called
  const entry = r.entries.find((e) => e.name === 'build/screened');
  assert.equal(entry.action, 'skip');
  assert.equal(entry.reason, 'pr-open');
});

test('screen-then-confirm: screen-null branch skips no-merged-pr without cherry or confirm', () => {
  const dir = buildScreenFixture();
  let confirmCalls = 0;
  const resolvePrBulk = () => new Map([['build/screened', null]]);
  const resolvePr = () => { confirmCalls += 1; return MERGED_PR; };
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  assert.equal(confirmCalls, 0);
  const entry = r.entries.find((e) => e.name === 'build/screened');
  assert.equal(entry.reason, 'no-merged-pr');
});

test('screen-then-confirm: screen-MERGED candidate confirms per-branch; confirm disagreement -> skip, ref survives', () => {
  const dir = buildScreenFixture();
  const resolvePrBulk = () => new Map([['build/screened', MERGED_PR]]);
  const seenConfirmOpts = [];
  const resolvePr = (root, branch, opts) => { seenConfirmOpts.push(opts); return OPEN_PR; }; // confirm sees a newer OPEN PR
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  assert.deepEqual(seenConfirmOpts, [{ preferOpen: true }]);
  const entry = r.entries.find((e) => e.name === 'build/screened');
  assert.equal(entry.action, 'skip');
  assert.equal(entry.reason, 'pr-open');
  assert.match(git(dir, 'ls-remote', '--heads', 'origin', 'build/screened'), /refs\/heads\/build\/screened/);
});

test('screen-then-confirm: screen-MERGED but confirm finds no PR -> skip no-merged-pr, ref survives', () => {
  const dir = buildScreenFixture();
  const resolvePrBulk = () => new Map([['build/screened', MERGED_PR]]);
  const resolvePr = () => null;
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  const entry = r.entries.find((e) => e.name === 'build/screened');
  assert.equal(entry.action, 'skip');
  assert.equal(entry.reason, 'no-merged-pr');
  assert.match(git(dir, 'ls-remote', '--heads', 'origin', 'build/screened'), /refs\/heads\/build\/screened/);
});

test('screen-then-confirm: confirmed MERGED candidate still deletes; dry-run still confirms and reports final reason', () => {
  const dir = buildScreenFixture();
  let confirmCalls = 0;
  const resolvePrBulk = () => new Map([['build/screened', MERGED_PR]]);
  const resolvePr = () => { confirmCalls += 1; return MERGED_PR; };
  const dry = pruneRemote({ cwd: dir, integration: 'main', dryRun: true, resolvePr, resolvePrBulk, skipFetch: true });
  assert.equal(confirmCalls, 1); // dry-run still confirms
  assert.equal(dry.entries.find((e) => e.name === 'build/screened').reason, 'merged-pr-cherry-equivalent');
  assert.match(git(dir, 'ls-remote', '--heads', 'origin', 'build/screened'), /refs\/heads\/build\/screened/); // dry-run deleted nothing
  const real = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  assert.equal(real.entries.find((e) => e.name === 'build/screened').action, 'delete');
  assert.equal(git(dir, 'ls-remote', '--heads', 'origin', 'build/screened').trim(), '');
});

test('screen-then-confirm: per-candidate confirm failure skips that branch, pass completes', () => {
  const dir = buildScreenFixture();
  const resolvePrBulk = () => new Map([['build/screened', MERGED_PR]]);
  const resolvePr = () => 'network-failure';
  const r = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk, skipFetch: true });
  assert.equal(r.failure, null);
  assert.equal(r.entries.find((e) => e.name === 'build/screened').reason, 'network-failure');
});

test('screen failure is check-level and fail-closed: network -> pr-screen-failed, gh-absent -> gh-absent', () => {
  const dir = buildScreenFixture();
  let confirmCalls = 0;
  const resolvePr = () => { confirmCalls += 1; return MERGED_PR; };
  const net = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk: () => 'network-failure', skipFetch: true });
  assert.deepEqual(net, { entries: [], failure: 'pr-screen-failed' });
  const absent = pruneRemote({ cwd: dir, integration: 'main', dryRun: false, resolvePr, resolvePrBulk: () => 'gh-absent', skipFetch: true });
  assert.deepEqual(absent, { entries: [], failure: 'gh-absent' });
  assert.equal(confirmCalls, 0);
  assert.match(git(dir, 'ls-remote', '--heads', 'origin', 'build/screened'), /refs\/heads\/build\/screened/);
});

test('decideRemotePrune order pin: OPEN prState -> pr-open regardless of cherryEquivalent value (sentinel safety)', () => {
  assert.strictEqual(decideRemotePrune({ branch: 'x', cherryEquivalent: true, prState: { number: 1, state: 'OPEN' } }).reason, 'pr-open');
  assert.strictEqual(decideRemotePrune({ branch: 'x', cherryEquivalent: false, prState: { number: 1, state: 'OPEN' } }).reason, 'pr-open');
});
