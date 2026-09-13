const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { probeWorktrees, extractPid, defaultIsDirty, readPorcelainStatus } = require('../../../plugin/bin/lib/residue/probes/worktrees');
const { probeBranches } = require('../../../plugin/bin/lib/residue/probes/branches');
const { filterResultsByScope } = require('../../../plugin/bin/lib/residue/scope-filter');
const { validateFinding } = require('../../../plugin/bin/lib/residue/finding');

function stubRunner(responses) {
  return (args) => (Object.prototype.hasOwnProperty.call(responses, args.join(' ')) ? responses[args.join(' ')] : null);
}

// Same as stubRunner, but also records every call's args (and any execFileSync
// options passed alongside them) so a test can assert ordering (the prune
// must run before the `--merged` read) and per-call options (e.g. `timeout`).
function recordingRunner(responses) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push(args.join(' '));
    runner.optsByCall.push(opts);
    return Object.prototype.hasOwnProperty.call(responses, args.join(' ')) ? responses[args.join(' ')] : null;
  };
  runner.calls = calls;
  runner.optsByCall = [];
  return runner;
}

const SCOPE = {
  ran: true, reason: null, base: 'a1b2c3d', headBranch: 'worktree-feat',
  branches: ['main', 'worktree-feat', 'worktree-old'],
  worktrees: [
    { path: '/repo', branch: 'main', locked: false },
    { path: '/repo/.claude/worktrees/self', branch: 'worktree-feat', locked: true },
    { path: '/repo/.claude/worktrees/live', branch: 'worktree-live', locked: true },
    { path: '/repo/.claude/worktrees/done', branch: 'worktree-done', locked: false },
    { path: '/repo/.worktrees/fallback', branch: 'worktree-fallback', locked: false },
  ],
};

test('the main working tree is never a finding', () => {
  const { findings } = probeWorktrees({ scope: SCOPE });
  assert.ok(!findings.some((f) => f.subject === '/repo'), 'main checkout must not be reported');
});

test('a locked worktree is reported for a human, not for auto-removal', () => {
  const { findings } = probeWorktrees({ scope: SCOPE });
  const locked = findings.find((f) => f.subject === '/repo/.claude/worktrees/live');
  assert.strictEqual(locked.remedy, 'record', 'a live lock means a session is using it');
});

test('an unlocked worktree in the harness domain is auto-remediable', () => {
  const { findings } = probeWorktrees({ scope: SCOPE });
  assert.strictEqual(findings.find((f) => f.subject === '/repo/.claude/worktrees/done').remedy, 'auto');
});

test('an unlocked worktree outside the reaper domain is still auto-remediable', () => {
  // No reaper collects .worktrees/ — that makes explicit teardown MORE
  // necessary, not less.
  const { findings } = probeWorktrees({ scope: SCOPE });
  assert.strictEqual(findings.find((f) => f.subject === '/repo/.worktrees/fallback').remedy, 'auto');
});

test('an unresolved scope produces no findings and says why', () => {
  const r = probeWorktrees({ scope: { ran: false, reason: 'not a git repository', worktrees: [] } });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
  assert.match(r.reason, /not a git repository/);
});

// The head worktree is present, locked, and reachable at every Step 8.5 run
// (the session is standing in it) — reporting it demands a per-item answer
// for a worktree that cannot ever be disposed of mid-run. Confirmed broken
// by execution before this fix: on this repo, every /wrap-up run surfaced
// its own live worktree, plus every OTHER concurrent session's, as findings.
test('the worktree this session is standing in is never a finding', () => {
  const { findings } = probeWorktrees({ scope: SCOPE });
  assert.ok(!findings.some((f) => f.subject === '/repo/.claude/worktrees/self'), 'this run\'s own worktree must not be reported');
});

test('a sibling worktree is observed, not blast-radius', () => {
  const { findings } = probeWorktrees({ scope: SCOPE });
  const sibling = findings.find((f) => f.subject === '/repo/.claude/worktrees/live');
  assert.strictEqual(sibling.scope, 'observed', 'a worktree on a branch this work did not produce is observed, never blast-radius');
});

test('a merged remote branch is reported as auto-remediable', () => {
  const run = stubRunner({ 'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old' });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  const stale = findings.find((f) => f.subject === 'origin/worktree-old');
  assert.strictEqual(stale.kind, 'branch');
  assert.strictEqual(stale.remedy, 'auto');
});

test('the integration branch itself is never a finding', () => {
  const run = stubRunner({ 'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old' });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.ok(!findings.some((f) => f.subject === 'origin/main'), 'deleting the integration branch would be catastrophic');
});

test('the branch currently checked out is never a finding', () => {
  const run = stubRunner({ 'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-feat' });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.ok(!findings.some((f) => f.subject.endsWith('worktree-feat')), 'HEAD is on this branch');
});

test('branches on other remotes are never findings', () => {
  // Verified live: `git branch -r --merged origin/main` in this repo returns
  // local-check/main, local/main-check, and a bare `origin` alongside
  // origin/*. Proposing a delete on another remote's main is the worst
  // output this probe could produce.
  const run = stubRunner({
    'branch -r --format=%(refname:short) --merged origin/main':
      'origin\norigin/main\nlocal-check/main\nlocal/main-check\norigin/worktree-old',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.deepStrictEqual(findings.map((f) => f.subject), ['origin/worktree-old']);
});

test('an unreadable branch list does not run, rather than reporting none', () => {
  const r = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run: stubRunner({}) });
  assert.strictEqual(r.ran, false);
  assert.deepStrictEqual(r.findings, []);
});

// `_shared/integration-branch.md`'s canonical ladder yields a BARE branch
// name (`main`, `dev`), never a `<remote>/<branch>` form. `git branch -r
// --merged` only ever returns remote-tracking refs, so a bare name must
// resolve to one before it can match anything — confirmed broken by
// execution before this fix: `origin/main` found 1 stale branch, bare
// `main` and bare `dev` found 0, on the identical live repo.
test('bare main, bare dev, and origin/main all find the same stale branch', () => {
  const stale = 'origin/worktree-old';
  const branchListForMain = 'origin/main\norigin/worktree-old';
  const branchListForDev = 'origin/dev\norigin/worktree-old';

  const viaQualified = probeBranches({
    scope: SCOPE,
    integrationBranch: 'origin/main',
    run: stubRunner({ 'branch -r --format=%(refname:short) --merged origin/main': branchListForMain }),
  });
  const viaBareMain = probeBranches({
    scope: SCOPE,
    integrationBranch: 'main',
    run: stubRunner({
      'config branch.main.remote': null,
      'branch -r --format=%(refname:short) --merged origin/main': branchListForMain,
    }),
  });
  const viaBareDev = probeBranches({
    scope: SCOPE,
    integrationBranch: 'dev',
    run: stubRunner({
      'config branch.dev.remote': 'origin',
      'branch -r --format=%(refname:short) --merged origin/dev': branchListForDev,
    }),
  });

  assert.deepStrictEqual(viaQualified.findings.map((f) => f.subject), [stale]);
  assert.deepStrictEqual(viaBareMain.findings.map((f) => f.subject), [stale]);
  assert.deepStrictEqual(viaBareDev.findings.map((f) => f.subject), [stale]);
});

test('a bare integration branch resolves its remote via git config, not always origin', () => {
  const run = stubRunner({
    'config branch.dev.remote': 'upstream',
    'branch -r --format=%(refname:short) --merged upstream/dev': 'upstream/dev\nupstream/worktree-old',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'dev', run });
  assert.deepStrictEqual(findings.map((f) => f.subject), ['upstream/worktree-old']);
});

test('the integration branch itself is never a finding, even when passed bare', () => {
  const run = stubRunner({
    'config branch.main.remote': null,
    'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'main', run });
  assert.ok(!findings.some((f) => f.subject === 'origin/main'), 'deleting the integration branch would be catastrophic');
});

// #499: probeBranches tagged every merged-but-undeleted remote branch except
// scope.headBranch as scope:'blast-radius' unconditionally, with no way to
// tell "this run's own worktree branch" apart from an unrelated, separately-
// completed session's merged branch. `probeWorktrees` already draws this
// contrast correctly (a fallthrough worktree is 'observed', never
// 'blast-radius') — this probe had no equivalent contrast. Mirrors that
// fix: a merged branch not matching scope.headBranch is 'observed'.
test('a merged branch belonging to an unrelated run is observed, not blast-radius', () => {
  const run = stubRunner({ 'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old' });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  const stale = findings.find((f) => f.subject === 'origin/worktree-old');
  assert.strictEqual(stale.scope, 'observed', 'a branch this run did not produce is observed, never blast-radius, mirroring probeWorktrees');
});

// AC: a repo state with 2+ merged-but-undeleted branches belonging to
// unrelated runs, and 0 belonging to the invoking run, produces zero
// blast-radius-scoped branch findings under --scope blast-radius.
test('multiple merged branches from unrelated runs produce zero blast-radius findings', () => {
  const run = stubRunner({
    'branch -r --format=%(refname:short) --merged origin/main':
      'origin/main\norigin/worktree-flow-464\norigin/worktree-record-174',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.strictEqual(findings.length, 2, 'both unrelated merged branches are still reported');
  assert.ok(findings.every((f) => f.scope !== 'blast-radius'), 'none of them qualify as this run\'s own blast radius');
  assert.deepStrictEqual(
    filterResultsByScope([{ ran: true, reason: null, findings }], 'blast-radius')[0].findings,
    [],
    '--scope blast-radius drops every finding once none carry scope:blast-radius',
  );
});

// #1172: `probeBranches` used to run `git remote prune <remote>` unconditionally
// before every merged-branch read — a ref-mutating, up-to-15s network call on
// every invocation, including a report-only `residue.js --json` run and a
// `--scope blast-radius` run whose branch findings (all scope:'observed') are
// guaranteed to be filtered out afterward. The actual deletion of a
// proven-merged remote branch runs through reconcile's own `remote-prune`
// check (`bin/lib/reconcile/prune-remote.js`), which fetches and prunes
// origin itself immediately before it deletes — this probe's findings are
// read-only report output and never trigger a delete on their own, so the
// prune bought nothing here.
test('probeBranches never issues a `git remote prune` call — deletion (and its own prune) lives in reconcile/prune-remote.js', () => {
  const run = recordingRunner({
    'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.deepStrictEqual(run.calls, ['branch -r --format=%(refname:short) --merged origin/main'], 'no remote-mutating call, ever');
  assert.ok(findings.some((f) => f.subject === 'origin/worktree-old'), 'the merged-branch read itself is unaffected');
});

test('a merged branch\'s evidence carries no degrade/unpruned-read tag — the read is unconditionally local-only now', () => {
  const run = stubRunner({
    'branch -r --format=%(refname:short) --merged origin/main': 'origin/main\norigin/worktree-old',
  });
  const { findings } = probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  const stale = findings.find((f) => f.subject === 'origin/worktree-old');
  assert.doesNotMatch(stale.evidence, /unpruned-read|prune/, 'no prune-related tag survives in evidence');
});

test('the local merged-branch read carries no timeout option — it never contacts a remote', () => {
  const run = recordingRunner({
    'branch -r --format=%(refname:short) --merged origin/main': 'origin/main',
  });
  probeBranches({ scope: SCOPE, integrationBranch: 'origin/main', run });
  assert.strictEqual(run.optsByCall[0], undefined, 'the only call this probe makes is local-only and needs no explicit timeout');
});

// #225: a locked worktree's evidence must distinguish a live session from an
// abandoned lock, not report every lock identically.
const PID_SCOPE = {
  ran: true, reason: null, base: 'a1b2c3d', headBranch: 'worktree-feat',
  branches: [],
  worktrees: [
    { path: '/repo', branch: 'main', locked: false },
    { path: '/repo/.claude/worktrees/live', branch: 'worktree-live', locked: true, lockReason: 'claude session foo (pid 16478, host vm)' },
    { path: '/repo/.claude/worktrees/dead', branch: 'worktree-dead', locked: true, lockReason: 'claude session bar (pid 99999, host vm)' },
    { path: '/repo/.claude/worktrees/nopid', branch: 'worktree-nopid', locked: true, lockReason: 'manual lock, no pid recorded' },
  ],
};

test('extractPid reads the pid out of a lockReason string', () => {
  assert.strictEqual(extractPid('claude session foo (pid 16478, host vm)'), 16478);
  assert.strictEqual(extractPid('manual lock, no pid recorded'), null);
  assert.strictEqual(extractPid(null), null);
  assert.strictEqual(extractPid(undefined), null);
});

test('a locked worktree whose pid is running shows a live-session verdict with the pid', () => {
  const isPidAlive = (pid) => pid === 16478;
  const { findings } = probeWorktrees({ scope: PID_SCOPE, isPidAlive });
  const live = findings.find((f) => f.subject === '/repo/.claude/worktrees/live');
  assert.match(live.evidence, /live session/);
  assert.match(live.evidence, /pid 16478/);
  assert.strictEqual(live.remedy, 'record', 'still a human call — liveness does not change the remedy');
});

test('a locked worktree whose pid is not running shows an abandoned-lock verdict, distinct from a live one', () => {
  const isPidAlive = (pid) => pid === 16478; // only the "live" fixture's pid is alive
  const { findings } = probeWorktrees({ scope: PID_SCOPE, isPidAlive });
  const dead = findings.find((f) => f.subject === '/repo/.claude/worktrees/dead');
  assert.match(dead.evidence, /abandoned lock/);
  assert.match(dead.evidence, /pid 99999/);
  assert.strictEqual(dead.remedy, 'record');

  const live = findings.find((f) => f.subject === '/repo/.claude/worktrees/live');
  assert.notStrictEqual(dead.evidence, live.evidence, 'a live pid and a dead pid must render differently');
});

test('an unparseable lock reason reports pid unknown rather than crashing', () => {
  const { findings } = probeWorktrees({ scope: PID_SCOPE, isPidAlive: () => true });
  const nopid = findings.find((f) => f.subject === '/repo/.claude/worktrees/nopid');
  assert.match(nopid.evidence, /pid unknown/);
});

test('a liveness check that throws fails toward "could not be confirmed" rather than crashing the sweep', () => {
  const isPidAlive = () => { throw new Error('ps unavailable'); };
  const { findings } = probeWorktrees({ scope: PID_SCOPE, isPidAlive });
  const live = findings.find((f) => f.subject === '/repo/.claude/worktrees/live');
  assert.match(live.evidence, /could not be confirmed/);
  assert.strictEqual(live.remedy, 'record');
});

// #1424: a dirty (uncommitted or untracked changes present) unlocked
// worktree must never classify as `remedy: 'auto'` — committed-history merge
// state says nothing about working-tree state, and a plain `git worktree
// remove` without `--force` is the only thing standing between that
// classification and real data loss (see #1424's Current State for the live
// incident this fixes).
test('a dirty unlocked worktree routes to record, not auto', () => {
  const isDirty = (p) => p === '/repo/.claude/worktrees/done';
  const { findings } = probeWorktrees({ scope: SCOPE, isDirty });
  const dirty = findings.find((f) => f.subject === '/repo/.claude/worktrees/done');
  assert.strictEqual(dirty.remedy, 'record', 'uncommitted work must never be routed to the auto-delete batch');
  assert.match(dirty.evidence, /dirty: true/);
  assert.deepStrictEqual(validateFinding(dirty), []);
});

test('a confirmed-clean unlocked worktree still auto-remediates, with dirty: false in evidence', () => {
  const isDirty = () => false;
  const { findings } = probeWorktrees({ scope: SCOPE, isDirty });
  const clean = findings.find((f) => f.subject === '/repo/.claude/worktrees/done');
  assert.strictEqual(clean.remedy, 'auto');
  assert.match(clean.evidence, /dirty: false/);
});

test('an unreadable dirty check (git status failed) does not force record — unconfirmed is not confirmed-dirty', () => {
  const isDirty = () => null;
  const { findings } = probeWorktrees({ scope: SCOPE, isDirty });
  const unknown = findings.find((f) => f.subject === '/repo/.claude/worktrees/done');
  assert.strictEqual(unknown.remedy, 'auto', 'today\'s behavior (locked-only gate) must survive an unrelated read failure');
  assert.match(unknown.evidence, /dirty: unknown/);
});

test('the default (no isDirty override) never crashes and preserves today\'s locked-only remedy against a nonexistent path', () => {
  // Every existing test in this file calls probeWorktrees({ scope: SCOPE })
  // with no isDirty override — the real defaultIsDirty then shells out
  // against fixture paths like '/repo/.claude/worktrees/done', which do not
  // exist on the test machine. That must read as "could not confirm" (null),
  // not crash, and must not flip remedy away from 'auto' — pinning this is
  // what keeps every pre-existing remedy assertion in this file valid.
  const { findings } = probeWorktrees({ scope: SCOPE });
  const done = findings.find((f) => f.subject === '/repo/.claude/worktrees/done');
  assert.strictEqual(done.remedy, 'auto');
  assert.match(done.evidence, /dirty: unknown/);
});

// Fixture-based: exercises the real `defaultIsDirty` (actual `git status
// --porcelain`) against real worktrees on disk, per #1424's Deliverables.
function tmpGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'residue-worktree-dirty-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  return dir;
}

test('defaultIsDirty: a fixture worktree with an uncommitted file reads dirty: true', () => {
  const dir = tmpGitRepo();
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x');
  assert.strictEqual(defaultIsDirty(dir), true);
});

test('defaultIsDirty: a clean fixture worktree reads dirty: false', () => {
  const dir = tmpGitRepo();
  assert.strictEqual(defaultIsDirty(dir), false);
});

test('defaultIsDirty: a nonexistent path reads null (could not confirm), not false', () => {
  assert.strictEqual(defaultIsDirty('/does/not/exist/anywhere'), null);
});

// #1796 — readPorcelainStatus is the shared reader defaultIsDirty above now
// delegates to; reap-merged.js's removal-failed branch needs the raw lines
// themselves (not just the boolean) to carry a dirty-file list on the
// escalation issue.
test('readPorcelainStatus: an untracked file reads back as one raw porcelain line', () => {
  const dir = tmpGitRepo();
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'x');
  assert.deepEqual(readPorcelainStatus(dir), ['?? untracked.txt']);
});

test('readPorcelainStatus: a clean fixture worktree reads an empty array, not null', () => {
  const dir = tmpGitRepo();
  assert.deepEqual(readPorcelainStatus(dir), []);
});

test('readPorcelainStatus: a nonexistent path reads null (could not confirm), not an empty array', () => {
  assert.strictEqual(readPorcelainStatus('/does/not/exist/anywhere'), null);
});
