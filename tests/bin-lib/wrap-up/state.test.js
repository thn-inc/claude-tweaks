// tests/bin-lib/wrap-up/state.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { readState } = require('../../../plugin/bin/lib/wrap-up/state');

// Build a stub git runner from a map of joined-args -> output. Returning null
// models a failing git invocation, which is how the real runner reports one.
function stubRunner(responses) {
  return (args) => (Object.prototype.hasOwnProperty.call(responses, args.join(' ')) ? responses[args.join(' ')] : null);
}

const ON_BRANCH_UNPUSHED = {
  'rev-parse --is-inside-work-tree': 'true',
  'branch --show-current': 'main',
  'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/dev',
  'rev-list --left-right --count @{u}...HEAD': '0\t1',
  'rev-list --count a1b2c3d..HEAD': '1',
  'rev-parse --git-dir': '/repo/.git',
  'rev-parse --git-common-dir': '/repo/.git',
};

test('readState reports an unpushed branch, which is the fact the old report got wrong', () => {
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(ON_BRANCH_UNPUSHED) });
  assert.strictEqual(s.branch, 'main');
  assert.strictEqual(s.upstream, 'origin/dev');
  assert.strictEqual(s.ahead, 1);
  assert.strictEqual(s.pushed, false);
  assert.strictEqual(s.commitsInScope, 1);
});

test('readState reports pushed when nothing is ahead of upstream', () => {
  const s = readState({
    cwd: '/repo',
    since: 'a1b2c3d',
    run: stubRunner({ ...ON_BRANCH_UNPUSHED, 'rev-list --left-right --count @{u}...HEAD': '0\t0' }),
  });
  assert.strictEqual(s.pushed, true);
});

test('readState marks a detached HEAD rather than reporting an empty branch name', () => {
  const s = readState({
    cwd: '/repo',
    since: 'a1b2c3d',
    run: stubRunner({ ...ON_BRANCH_UNPUSHED, 'branch --show-current': '', 'rev-parse --short HEAD': 'deadbee' }),
  });
  assert.strictEqual(s.branch, null);
  assert.strictEqual(s.detachedAt, 'deadbee');
});

test('readState reports pushed as null when an upstream resolves but the ahead/behind read fails', () => {
  const responses = { ...ON_BRANCH_UNPUSHED };
  delete responses['rev-list --left-right --count @{u}...HEAD'];
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(responses) });
  assert.strictEqual(s.upstream, 'origin/dev');
  assert.strictEqual(s.ahead, null);
  assert.strictEqual(s.pushed, null);
});

test('readState reports no upstream as unpushed rather than as unknown', () => {
  const responses = { ...ON_BRANCH_UNPUSHED };
  delete responses['rev-parse --abbrev-ref --symbolic-full-name @{u}'];
  delete responses['rev-list --left-right --count @{u}...HEAD'];
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(responses) });
  assert.strictEqual(s.upstream, null);
  assert.strictEqual(s.pushed, false);
  assert.strictEqual(s.ahead, null);
});

test('readState detects a linked worktree by git-dir differing from git-common-dir', () => {
  const s = readState({
    cwd: '/repo/.claude/worktrees/x',
    since: 'a1b2c3d',
    run: stubRunner({
      ...ON_BRANCH_UNPUSHED,
      'rev-parse --git-dir': '/repo/.git/worktrees/x',
      'rev-parse --git-common-dir': '/repo/.git',
    }),
  });
  assert.strictEqual(s.linkedWorktree, true);
});

test('readState outside a repository sets isRepo false and leaves fields null, never omitted', () => {
  const s = readState({ cwd: '/tmp', since: 'a1b2c3d', run: stubRunner({}) });
  assert.strictEqual(s.isRepo, false);
  assert.strictEqual(s.branch, null);
  assert.strictEqual(s.upstream, null);
  assert.strictEqual(s.commitsInScope, null);
  assert.ok('pushed' in s, 'pushed must be present even when unknown');
  assert.strictEqual(s.remoteRef, null);
  assert.strictEqual(s.pushedVia, null);
});

// #1869: a pr-first branch is pushed with `git push origin {branch}`, never
// `-u`, so `@{u}` stays unset while `refs/remotes/origin/{branch}` is
// current. readState must fall back to that remote-tracking ref rather than
// reporting UNPUSHED for work origin already holds.

const NO_UPSTREAM_REMOTE_REF = {
  'rev-parse --is-inside-work-tree': 'true',
  'branch --show-current': 'feature-y',
  'rev-parse --verify --quiet --end-of-options refs/remotes/origin/feature-y': 'abc1234',
  'rev-list --left-right --count origin/feature-y...HEAD': '0\t0',
  'rev-list --count a1b2c3d..HEAD': '2',
  'rev-parse --git-dir': '/repo/.git',
  'rev-parse --git-common-dir': '/repo/.git',
};

test('readState: no upstream + remote ref present + ahead 0 -> pushed via remote-ref', () => {
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(NO_UPSTREAM_REMOTE_REF) });
  assert.strictEqual(s.upstream, null);
  assert.strictEqual(s.remoteRef, 'origin/feature-y');
  assert.strictEqual(s.pushedVia, 'remote-ref');
  assert.strictEqual(s.pushed, true);
});

test('readState: no upstream + remote ref present + ahead 2 -> not pushed', () => {
  const s = readState({
    cwd: '/repo',
    since: 'a1b2c3d',
    run: stubRunner({ ...NO_UPSTREAM_REMOTE_REF, 'rev-list --left-right --count origin/feature-y...HEAD': '0\t2' }),
  });
  assert.strictEqual(s.pushedVia, 'remote-ref');
  assert.strictEqual(s.pushed, false);
  assert.strictEqual(s.ahead, 2);
});

test('readState: no upstream + no remote ref -> unpushed, remoteRef null', () => {
  const responses = { ...NO_UPSTREAM_REMOTE_REF };
  delete responses['rev-parse --verify --quiet --end-of-options refs/remotes/origin/feature-y'];
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(responses) });
  assert.strictEqual(s.upstream, null);
  assert.strictEqual(s.remoteRef, null);
  assert.strictEqual(s.pushedVia, null);
  assert.strictEqual(s.pushed, false);
  assert.strictEqual(s.ahead, null);
});

test('readState: inherited upstream (origin/main) + own remote ref present -> judged by remote ref, not @{u}', () => {
  const s = readState({
    cwd: '/repo',
    since: 'a1b2c3d',
    run: stubRunner({
      ...NO_UPSTREAM_REMOTE_REF,
      'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main',
      // A stale @{u}...HEAD read would report ahead 5 — the remote-ref read
      // (ahead 0) is the one that must win.
      'rev-list --left-right --count @{u}...HEAD': '0\t5',
    }),
  });
  assert.strictEqual(s.upstream, 'origin/main');
  assert.strictEqual(s.pushedVia, 'remote-ref');
  assert.strictEqual(s.remoteRef, 'origin/feature-y');
  assert.strictEqual(s.pushed, true);
});

test('readState: a failed rev-list read against the remote-ref fallback yields pushed null, never a definite false', () => {
  const responses = { ...NO_UPSTREAM_REMOTE_REF };
  delete responses['rev-list --left-right --count origin/feature-y...HEAD'];
  const s = readState({ cwd: '/repo', since: 'a1b2c3d', run: stubRunner(responses) });
  assert.strictEqual(s.pushedVia, 'remote-ref');
  assert.strictEqual(s.pushed, null);
});

test('readState: a configured upstream that already names origin/{branch} takes precedence over the remote-ref fallback', () => {
  const s = readState({
    cwd: '/repo',
    since: 'a1b2c3d',
    run: stubRunner({
      ...ON_BRANCH_UNPUSHED,
      'rev-parse --abbrev-ref --symbolic-full-name @{u}': 'origin/main',
      'rev-list --left-right --count @{u}...HEAD': '0\t0',
      // A remote ref IS present and would report ahead 9 if consulted — the
      // equals-check must win regardless, never falling through to it.
      'rev-parse --verify --quiet --end-of-options refs/remotes/origin/main': 'abc1234',
      'rev-list --left-right --count origin/main...HEAD': '0\t9',
    }),
  });
  assert.strictEqual(s.pushedVia, 'upstream');
  assert.strictEqual(s.remoteRef, null);
  assert.strictEqual(s.ahead, 0);
});
