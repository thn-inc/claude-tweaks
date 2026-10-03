'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseWorktreeList, isPidAlive, lockVerdict, isStale, isContentIdentical, reapWorktrees,
  resolveIntegrationBranch, ORPHAN_GRACE_MS, MAX_EXAMINED_PER_RUN, REASON, QUIET_SKIP_REASONS,
} = require('../plugin/bin/lib/hooks/worktree-reap');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { gitRepo, linkedWorktreeOf, harnessWorktreeOf } = require('./helpers/git-fixtures');

// Backdate everything newestMtimeMs() looks at, so a fixture created seconds
// ago reads as untouched for longer than the orphan grace period. Recursive,
// and skipping exactly what the scan skips: if this helper walked less deeply
// than the code under test, a nested fixture file would stay fresh and every
// staleness test would silently stop testing staleness.
function backdate(wtPath, ms) {
  const when = new Date(Date.now() - ms);
  const touch = (p) => {
    try { fs.lutimesSync(p, when, when); } catch { try { fs.utimesSync(p, when, when); } catch { /* gone */ } }
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      // Recurse into everything except `.git`, but still backdate the `.git`
      // entry itself. The scan under test skips `.git`, so its age is
      // irrelevant to the real path — but leaving it FRESH would mask a
      // depth-limited scan behind a depth-1 entry that is always current,
      // which is exactly how a sabotage check comes back green and proves
      // nothing.
      if (e.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') walk(p);
      touch(p);
    }
  };
  walk(wtPath);
  touch(wtPath);
}

// gitRepo() runs a bare `git init`, so the initial branch is whatever the
// machine's init.defaultBranch says — `main` on some, `master` on others.
// Resolve it instead of hardcoding, or these tests pass on the author's
// machine and fail in CI for a reason unrelated to the code under test.
const defaultBranch = (repo) =>
  execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

// Frozen 2026-08-07 from `git worktree list --porcelain` on macOS, git 2.x.
const PORCELAIN = [
  'worktree /repo',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree /repo/.claude/worktrees/alive',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/worktree-alive',
  'locked claude session alive (pid 29881 start Fri Aug  7 14:40:15 2026)',
  '',
  'worktree /repo/.claude/worktrees/dead',
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/worktree-dead',
  'locked claude session dead (pid 4242 start Fri Aug  7 09:00:00 2026)',
  '',
  'worktree /repo/.claude/worktrees/free',
  'HEAD 4444444444444444444444444444444444444444',
  'branch refs/heads/worktree-free',
  '',
  'worktree /repo/.claude/worktrees/opaque',
  'HEAD 5555555555555555555555555555555555555555',
  'branch refs/heads/worktree-opaque',
  'locked',
  '',
].join('\n');

test('parseWorktreeList: extracts path, branch and lock state for every entry', () => {
  const got = parseWorktreeList(PORCELAIN);
  assert.strictEqual(got.length, 5);
  assert.strictEqual(got[0].path, '/repo');
  assert.strictEqual(got[0].branch, 'main');
  assert.strictEqual(got[0].locked, false);
});

test('parseWorktreeList: recovers the owning pid from the lock reason', () => {
  const got = parseWorktreeList(PORCELAIN);
  const alive = got.find((w) => w.path.endsWith('/alive'));
  assert.strictEqual(alive.locked, true);
  assert.strictEqual(alive.pid, 29881);
});

test('parseWorktreeList: a bare `locked` with no reason yields locked with a null pid', () => {
  const got = parseWorktreeList(PORCELAIN);
  const opaque = got.find((w) => w.path.endsWith('/opaque'));
  assert.strictEqual(opaque.locked, true);
  assert.strictEqual(opaque.lockReason, null);
  assert.strictEqual(opaque.pid, null);
});

test('parseWorktreeList: an unlocked worktree has locked false and a null pid', () => {
  const got = parseWorktreeList(PORCELAIN);
  const free = got.find((w) => w.path.endsWith('/free'));
  assert.strictEqual(free.locked, false);
  assert.strictEqual(free.pid, null);
});

test('parseWorktreeList: a lock reason with no pid parses as locked, pid null', () => {
  const got = parseWorktreeList('worktree /a\nbranch refs/heads/b\nlocked being edited by hand\n\n');
  assert.strictEqual(got[0].locked, true);
  assert.strictEqual(got[0].lockReason, 'being edited by hand');
  assert.strictEqual(got[0].pid, null);
});

test('parseWorktreeList: a `prunable` line marks the entry prunable; entries without one are not', () => {
  const got = parseWorktreeList('worktree /a\nbranch refs/heads/a\nprunable gitdir file points to non-existent location\n\nworktree /b\nbranch refs/heads/b\n\n');
  assert.strictEqual(got[0].prunable, true);
  assert.strictEqual(got[1].prunable, false);
});

test('parseWorktreeList: empty input yields an empty array', () => {
  assert.deepStrictEqual(parseWorktreeList(''), []);
});

test('isPidAlive: this process is alive', () => {
  assert.strictEqual(isPidAlive(process.pid), true);
});

test('isPidAlive: null and nonsense pids are not alive', () => {
  assert.strictEqual(isPidAlive(null), false);
  assert.strictEqual(isPidAlive(0), false);
  assert.strictEqual(isPidAlive(-1), false);
});

test('lockVerdict: unlocked is free', () => {
  assert.strictEqual(lockVerdict({ locked: false, pid: null }), 'free');
});

test('lockVerdict: locked with a live pid is in-use', () => {
  assert.strictEqual(lockVerdict({ locked: true, pid: process.pid }), 'in-use');
});

test('lockVerdict: locked with a dead pid is orphaned', () => {
  // 2^22 is above the default pid_max on both macOS and Linux, so no process
  // can hold it — a deterministic "definitely dead" pid.
  assert.strictEqual(lockVerdict({ locked: true, pid: 4194304 }), 'orphaned');
});

test('lockVerdict: locked with no recoverable pid is unknown, never orphaned', () => {
  assert.strictEqual(lockVerdict({ locked: true, pid: null }), 'unknown');
});

test('isContentIdentical: a branch with no diff against the integration branch is identical', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: main });
  execFileSync('git', ['checkout', '-q', base], { cwd: main });
  assert.strictEqual(isContentIdentical(main, 'feature', base), true);
});

test('isContentIdentical: a branch with a real change is not identical', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: main });
  fs.writeFileSync(path.join(main, 'new.txt'), 'x');
  execFileSync('git', ['add', 'new.txt'], { cwd: main });
  execFileSync('git', ['commit', '-q', '-m', 'add'], { cwd: main });
  execFileSync('git', ['checkout', '-q', base], { cwd: main });
  assert.strictEqual(isContentIdentical(main, 'feature', base), false);
});

test('isContentIdentical: a rebase-rewritten branch is still identical (the ancestry trap)', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: main });
  fs.writeFileSync(path.join(main, 'f.txt'), 'content');
  execFileSync('git', ['add', 'f.txt'], { cwd: main });
  // Commit SHAs are content-addressed at 1-second granularity, and
  // `cherry-pick` below inherits the original commit's AUTHOR date while
  // stamping a fresh COMMITTER date. If both commits happened to land in the
  // same wall-clock second (execFileSync calls are fast — a real, observed
  // failure, not theoretical), the cherry-picked commit would be
  // byte-identical to the original — same tree, parent, author+date,
  // committer+date, message — producing the SAME sha and turning this test's
  // own precondition (NOT an ancestor) into a random, load-independent
  // failure (#185 review, Important 2). Pinning explicit, distinct dates via
  // GIT_AUTHOR_DATE/GIT_COMMITTER_DATE removes the race outright — no sleep,
  // no reliance on the clock ticking over.
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], {
    cwd: main,
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00', GIT_COMMITTER_DATE: '2020-01-01T00:00:00' },
  });
  // Simulate `gh pr merge --rebase`: the integration branch gains the same
  // content under a different sha, so the branch is NOT an ancestor of it.
  // cherry-pick copies the AUTHOR date from the source commit automatically;
  // only the COMMITTER date needs to be forced distinct here.
  execFileSync('git', ['checkout', '-q', base], { cwd: main });
  execFileSync('git', ['cherry-pick', 'feature'], {
    cwd: main,
    env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-02T00:00:00' },
  });

  const ancestor = (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', 'feature', base], { cwd: main });
      return true;
    } catch { return false; }
  })();
  assert.strictEqual(ancestor, false, 'precondition: rebase-merge breaks ancestry');
  assert.strictEqual(isContentIdentical(main, 'feature', base), true);
});

test('isContentIdentical: an unresolvable branch is not identical', () => {
  const main = gitRepo();
  assert.strictEqual(isContentIdentical(main, 'no-such-branch', defaultBranch(main)), false);
});

test('reapWorktrees: removes a merged, clean, unlocked harness worktree', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  const before = fs.existsSync(wt);
  assert.strictEqual(before, true);

  const res = reapWorktrees({ cwd: main, integration: base });
  // harnessWorktreeOf() already returns fs.realpathSync(wt), so `wt` is
  // already canonical here — re-resolving it via realpathSync would throw
  // ENOENT, since reapWorktrees() has already deleted the directory by now.
  assert.deepStrictEqual(res.reaped, [wt]);
  assert.strictEqual(fs.existsSync(wt), false);
});

test('reapWorktrees: never removes the main checkout', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const res = reapWorktrees({ cwd: main, integration: base });
  assert.ok(!res.reaped.includes(fs.realpathSync(main)));
});

test('reapWorktrees: skips a worktree holding unmerged commits', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  fs.writeFileSync(path.join(wt, 'x.txt'), 'x');
  execFileSync('git', ['add', 'x.txt'], { cwd: wt });
  execFileSync('git', ['commit', '-q', '-m', 'unmerged'], { cwd: wt });

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, []);
  assert.strictEqual(fs.existsSync(wt), true);
  assert.match(res.skipped.find((s) => s.path === fs.realpathSync(wt)).reason, /not merged/);
});

test('reapWorktrees: skips a worktree carrying untracked or ignored content', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  fs.writeFileSync(path.join(wt, 'scratch-notes.md'), 'decision pending');

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, []);
  assert.strictEqual(fs.existsSync(wt), true);
  assert.match(res.skipped.find((s) => s.path === fs.realpathSync(wt)).reason, /local content/);
});

test('reapWorktrees: never removes the worktree the caller is standing in', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  const res = reapWorktrees({ cwd: wt, integration: base });
  assert.deepStrictEqual(res.reaped, []);
  assert.strictEqual(fs.existsSync(wt), true);
});

// ─── C2: the harness-owned domain is the only domain ───────────────────────
//
// `.worktrees/` (and anything else outside `<main>/.claude/worktrees/`) belongs
// to superpowers' finishing-a-development-branch per ADR-0004, and the design's
// Non-goals say so explicitly. It matters far more than a scoping nicety:
// worktrees in that domain are created by raw `git worktree add` and are
// therefore NEVER locked, so lock resolution — the guard that protects a live
// session — is structurally absent for the whole domain. Without the filter, a
// fresh, unlocked, commit-less worktree someone is actively standing in clears
// criteria 4 and 5 trivially and is removed.

test('reapWorktrees: a worktree outside .claude/worktrees/ is skipped, with a reason naming the domain', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const outside = linkedWorktreeOf(main); // raw `git worktree add` shape, never locked

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, [], 'a worktree outside the harness domain must never be reaped');
  assert.strictEqual(fs.existsSync(outside), true);
  const entry = res.skipped.find((s) => s.path === fs.realpathSync(outside));
  assert.ok(entry, 'the out-of-domain worktree must still be accounted for in skipped');
  assert.match(entry.reason, /\.claude[/\\]worktrees/, 'the skip reason must name the domain');
  assert.strictEqual(entry.reason, REASON.OUT_OF_DOMAIN);
});

test('reapWorktrees: the domain filter does not shadow an in-domain worktree in the same repo', () => {
  // Control for the test above: proves the filter selects rather than disables.
  const main = gitRepo();
  const base = defaultBranch(main);
  const outside = linkedWorktreeOf(main);
  const inside = harnessWorktreeOf(main);

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, [inside]);
  assert.strictEqual(fs.existsSync(outside), true);
});

test('reapWorktrees: a sibling directory named like the domain but outside the main root is not in it', () => {
  // The domain is resolved against the MAIN checkout root, not matched as a
  // substring — a path merely CONTAINING `.claude/worktrees` is not a member.
  const main = gitRepo();
  const base = defaultBranch(main);
  const decoyParent = path.join(main, '..', path.basename(main) + '-decoy', '.claude', 'worktrees');
  fs.mkdirSync(decoyParent, { recursive: true });
  const decoy = path.join(decoyParent, 'wt');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', decoy, '-b', 'decoy-branch']);

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, []);
  assert.strictEqual(fs.existsSync(decoy), true);
  assert.strictEqual(res.skipped.find((s) => s.path === fs.realpathSync(decoy)).reason, REASON.OUT_OF_DOMAIN);
});

// ─── C3: an orphaned lock alone is not evidence the worktree is finished ────
//
// The lock's pid is stamped once at creation, so a session resumed after a
// process restart carries a pid that no longer exists while the session lives.
// A "Kept as-is" worktree (wrap-up cleanup-procedures.md, Section C step 3) is
// merged and clean, so criteria 4 and 5 both pass and the lock is all that is
// left. The design's failure analysis covered pid REUSE and missed pid CHANGE.

test('isStale: a just-created directory is not stale', () => {
  const main = gitRepo();
  assert.strictEqual(isStale(main), false);
});

test('isStale: a directory untouched for longer than the grace period is stale', () => {
  const main = gitRepo();
  backdate(main, ORPHAN_GRACE_MS + 60_000);
  assert.strictEqual(isStale(main), true);
});

test('isStale: recent activity below depth 2 keeps a worktree off the stale list', () => {
  // The defect this replaces (#199), reproduced as a fixture: everything
  // shallow is old, and the only fresh write is four levels down. A depth-1
  // scan reports 25h idle; the real newest write is seconds ago. Measured on a
  // live worktree in this repo before the fix — .claude-tweaks/pipelines/{run}/
  // events.jsonl, which the hooks touch on every tool call, sits at exactly
  // this depth. Directory mtimes do not propagate upward, so nothing above it
  // moved.
  const main = gitRepo();
  const deep = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-06T174516-record-138');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'events.jsonl'), '{}\n');
  backdate(main, 25 * 60 * 60 * 1000);

  // Now make only the depth-4 file current again.
  const now = new Date();
  fs.utimesSync(path.join(deep, 'events.jsonl'), now, now);

  assert.strictEqual(isStale(main), false);
});

test('isStale: an unreadable path cannot prove staleness, so it is not stale', () => {
  assert.strictEqual(isStale('/this/path/should/not/exist/anywhere/xyz'), false);
});

test('reapWorktrees: a dead-pid lock on a RECENTLY MODIFIED worktree is refused, not reaped', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  // 2^22 is above the default pid_max on both macOS and Linux — a pid no
  // process can hold, so lockVerdict() says 'orphaned'. The worktree is merged
  // and clean, so criteria 4 and 5 pass. Only staleness stands between this
  // worktree and deletion, and it was created moments ago.
  execFileSync(
    'git',
    ['worktree', 'lock', '--reason', 'claude session test (pid 4194304 start Fri Aug  7 09:00:00 2026)', wt],
    { cwd: main },
  );

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, [], 'a stale pid on a live worktree must not authorize removal');
  assert.strictEqual(fs.existsSync(wt), true);
  assert.strictEqual(res.skipped.find((s) => s.path === wt).reason, REASON.RECENT);
});

test('reapWorktrees: a worktree locked by a dead pid AND untouched past the grace period is unlocked and reaped', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  execFileSync(
    'git',
    ['worktree', 'lock', '--reason', 'claude session test (pid 4194304 start Fri Aug  7 09:00:00 2026)', wt],
    { cwd: main },
  );
  // `git worktree lock` writes into the ADMIN directory, not the worktree, so
  // backdating after it is safe — newestMtimeMs deliberately ignores the admin
  // dir (see its header comment).
  backdate(wt, ORPHAN_GRACE_MS + 60_000);

  const res = reapWorktrees({ cwd: main, integration: base });
  // Reaching `reaped` at all proves the `git worktree unlock` step ran first —
  // `git worktree remove` refuses outright on a still-locked worktree.
  assert.deepStrictEqual(res.reaped, [wt]);
  assert.strictEqual(fs.existsSync(wt), false);
});

// ─── M-c: the own-cwd guard fails CLOSED ───────────────────────────────────

test('reapWorktrees: an unresolvable cwd reaps nothing (the own-ground guard fails closed)', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  // A path that does not exist: mainCheckoutRoot() still walks up to `main`, so
  // the repo resolves fine and every candidate is enumerated — but safeReal()
  // on the cwd returns null, so "is this the caller's own ground?" is
  // unanswerable. The original `here && (...)` form short-circuited to FALSE
  // there, i.e. "not our ground", and the worktree became a candidate.
  const res = reapWorktrees({ cwd: path.join(main, 'no-such-dir'), integration: base });
  assert.deepStrictEqual(res.reaped, [], 'an unprovable cwd must reap nothing');
  assert.strictEqual(fs.existsSync(wt), true);
});

// ─── I4: bounded per-invocation git fan-out ────────────────────────────────

test('reapWorktrees: examines at most MAX_EXAMINED_PER_RUN candidates and defers the rest', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const made = [];
  for (let i = 0; i < MAX_EXAMINED_PER_RUN + 2; i += 1) made.push(harnessWorktreeOf(main));

  const first = reapWorktrees({ cwd: main, integration: base });
  assert.strictEqual(first.reaped.length, MAX_EXAMINED_PER_RUN, 'the cap bounds one invocation');
  assert.strictEqual(first.deferred, 2, 'candidates past the cap are deferred, not skipped or lost');

  // Reaping is idempotent across sessions, so the cap only ever defers work.
  const second = reapWorktrees({ cwd: main, integration: base });
  assert.strictEqual(second.reaped.length, 2);
  assert.strictEqual(second.deferred, 0);
  for (const wt of made) assert.strictEqual(fs.existsSync(wt), false);
});

// ─── I2: the canonical integration-branch ladder ───────────────────────────

test('resolveIntegrationBranch: policy.yml\'s integration-branch wins', () => {
  const main = gitRepo();
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'integration-branch: staging\n');
  assert.strictEqual(resolveIntegrationBranch(main), 'staging');
});

test('resolveIntegrationBranch: #1688 — a policy-configured local name upgrades to its remote-tracking ref when one already exists (no fetch)', () => {
  // A local `integration-branch:` value can lag `origin/{name}` --
  // worktree-setup.md's post-creation catch-up merges origin/{integration}
  // into a worktree's HEAD routinely, so a caller comparing a range/merge-base
  // against the stale local name can find those already-merged commits still
  // inside it. Built entirely from local refs (no network) -- the exact shape
  // `git remote set-head` plus a manual fetch would produce.
  const main = gitRepo();
  const base = defaultBranch(main);
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), `integration-branch: ${base}\n`);
  execFileSync('git', ['-C', main, 'update-ref', `refs/remotes/origin/${base}`, 'HEAD']);
  assert.strictEqual(resolveIntegrationBranch(main), `origin/${base}`,
    'the resolved name must upgrade to origin/{name} once that remote-tracking ref exists on disk');
});

test('resolveIntegrationBranch: never falls back to the main checkout\'s current branch', () => {
  // No policy key and no origin/HEAD -> nothing resolves. The current branch is
  // deliberately NOT a source (integration-branch.md's named anti-pattern): a
  // concurrent session switches it underfoot, and the reaper DELETES on the
  // answer. A probe reaped a worktree holding genuinely unmerged work for
  // exactly this reason.
  const main = gitRepo();
  assert.ok(defaultBranch(main), 'precondition: the repo does have a current branch');
  assert.strictEqual(resolveIntegrationBranch(main), null);
});

test('resolveIntegrationBranch: falls back to refs/remotes/origin/HEAD, stripped of the remote prefix', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  // The on-disk shape `git remote set-head origin -a` produces, built locally so
  // the fixture needs no network: a real remote-tracking ref plus a symbolic
  // origin/HEAD pointing at it.
  execFileSync('git', ['-C', main, 'update-ref', `refs/remotes/origin/${base}`, 'HEAD']);
  execFileSync('git', ['-C', main, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${base}`]);
  assert.strictEqual(resolveIntegrationBranch(main), base);
});

test('resolveIntegrationBranch: a null repo root resolves nothing', () => {
  assert.strictEqual(resolveIntegrationBranch(null), null);
});

test('QUIET_SKIP_REASONS covers exactly the reasons that describe a healthy repo', () => {
  // session-start.js filters its "worktree(s) left in place" report on this set.
  // A reason that is NOT here gets reprinted on every session start, so adding
  // one silently is how the reaper becomes noise.
  assert.deepStrictEqual(
    [...QUIET_SKIP_REASONS].sort(),
    [REASON.IN_USE, REASON.OUT_OF_DOMAIN, REASON.RECENT].sort(),
  );
});

// The reapWorktrees tests above exercise freshly-created, never-locked
// worktrees, so lockVerdict() always evaluates to 'free' inside reapWorktrees()
// itself — lockVerdict is well covered in isolation against synthetic
// {locked, pid} fixtures (above), but nothing proved the *wiring* at the loop's
// own verdict-dispatch: a regression that inverted or dropped that condition
// would still pass every other test here. This drives 'in-use' through
// reapWorktrees() itself, via a real `git worktree lock`; the 'orphaned' half
// is driven by the two grace-period tests in the C3 block above.

test('reapWorktrees: a worktree locked by a live session is skipped, never removed', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  // process.pid is guaranteed alive for the duration of this test.
  execFileSync(
    'git',
    ['worktree', 'lock', '--reason', `claude session test (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`, wt],
    { cwd: main },
  );
  // Backdated so staleness cannot be what saves it — only the live pid can.
  backdate(wt, ORPHAN_GRACE_MS + 60_000);

  const res = reapWorktrees({ cwd: main, integration: base });
  assert.deepStrictEqual(res.reaped, []);
  assert.strictEqual(fs.existsSync(wt), true);
  assert.match(res.skipped.find((s) => s.path === fs.realpathSync(wt)).reason, /in use/);
});

// ─── #1793: port-lease release after a successful reap ────────────────────
// "removal fails -> releasePorts is never called" is guaranteed by
// construction (the call sits strictly after the `if (rm.failure) continue`
// line, mirroring the pre-#1793 skip case for that branch — see this file's
// header rationale for why every predicate fails closed) rather than by a
// forced-failure test: no existing test in this file forces a genuine `git
// worktree remove` failure either, since doing so deterministically across
// platforms isn't practical with this fixture style.

test('#1793: reapWorktrees calls releasePorts with the removed realpath after a successful reap', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  const calls = [];
  const res = reapWorktrees({ cwd: main, integration: base, releasePorts: (p) => calls.push(p) });
  assert.deepStrictEqual(res.reaped, [wt]);
  assert.deepStrictEqual(calls, [wt]);
  assert.deepStrictEqual(res.portsRelease, [], 'no note on a successful release');
});

test('#1793: a releasePorts throw is recorded as a portsRelease note and never changes the reap outcome', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  const res = reapWorktrees({
    cwd: main,
    integration: base,
    releasePorts: () => { throw new Error('registry unwritable'); },
  });
  assert.deepStrictEqual(res.reaped, [wt], 'the reap outcome is unaffected by a release failure');
  assert.strictEqual(fs.existsSync(wt), false, 'the worktree is still gone — release failing does not undo the removal');
  assert.deepStrictEqual(res.portsRelease, [{ path: wt, note: 'failed: registry unwritable' }]);
});

test('#1793: a removed path with no lease is a no-op release with no note', () => {
  const main = gitRepo();
  const base = defaultBranch(main);
  const wt = harnessWorktreeOf(main);
  // registry.release() itself no-ops for an unknown path (#1791 AC6) — the
  // real release function proves the "no note" half of this without a fake.
  const { release } = require('../plugin/bin/lib/ports/registry');
  const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-wt-ports-home-'));
  const res = reapWorktrees({ cwd: main, integration: base, releasePorts: (p) => release(p, { home }) });
  assert.deepStrictEqual(res.reaped, [wt]);
  assert.deepStrictEqual(res.portsRelease, []);
});
