// tests/bin-lib/wrap-up/render.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { renderState } = require('../../../plugin/bin/lib/wrap-up/render');

const PUSHED = {
  isRepo: true, branch: 'feature-x', detachedAt: null, upstream: 'origin/main',
  ahead: 0, behind: 0, pushed: true, commitsInScope: 3, linkedWorktree: true,
};
const UNPUSHED = { ...PUSHED, ahead: 1, pushed: false, commitsInScope: 1, branch: 'main', upstream: 'origin/dev' };

test('renderState marks unpushed work in caps so it cannot be skimmed past', () => {
  const out = renderState({ state: UNPUSHED, ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14' });
  assert.match(out, /UNPUSHED/);
  assert.match(out, /Branch\s+main — 1 commit, UNPUSHED \(origin\/dev\)/);
});

test('renderState names the remote when work is pushed', () => {
  const out = renderState({ state: PUSHED, ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14' });
  assert.match(out, /Branch\s+feature-x — 3 commits, pushed to origin\/main/);
  assert.doesNotMatch(out, /UNPUSHED/);
});

test('renderState prints the scope boundary so a wrong base is visible rather than silent', () => {
  const out = renderState({ state: UNPUSHED, since: 'a1b2c3d', sinceDate: '2026-08-07 09:14', ops: [] });
  assert.match(out, /Scope\s+since a1b2c3d \(2026-08-07 09:14\)/);
});

test('renderState renders unknown for a non-repository rather than omitting the line', () => {
  const out = renderState({
    state: { isRepo: false, branch: null, detachedAt: null, upstream: null, ahead: null, behind: null, pushed: false, commitsInScope: null, linkedWorktree: false },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+unknown/);
});

test('renderState reports a detached HEAD by sha', () => {
  const out = renderState({
    state: { ...UNPUSHED, branch: null, detachedAt: 'deadbee' },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+detached at deadbee/);
});

test('renderState distinguishes a linked worktree from the main checkout', () => {
  const linked = renderState({ state: PUSHED, ops: [], since: 'a', sinceDate: 'd' });
  const main = renderState({ state: { ...PUSHED, linkedWorktree: false }, ops: [], since: 'a', sinceDate: 'd' });
  assert.match(linked, /Worktree\s+linked worktree/);
  assert.match(main, /Worktree\s+main checkout/);
});

test('renderState lists history ops one per line and omits the section when there are none', () => {
  const withOps = renderState({
    state: UNPUSHED, since: 'a', sinceDate: 'd',
    ops: [{ op: 'rebase', sha: 'd4e5f6a', date: '2026-08-07 15:40:11 +0200', message: 'rebase (finish): returning to refs/heads/main' }],
  });
  assert.match(withOps, /History ops in window \(1\)/);
  assert.match(withOps, /rebase\s+d4e5f6a/);
  assert.match(withOps, /rebase \(finish\): returning to refs\/heads\/main/);

  const withoutOps = renderState({ state: UNPUSHED, ops: [], since: 'a', sinceDate: 'd' });
  assert.doesNotMatch(withoutOps, /History ops in window/);
});

test('renderState singularises one commit and pluralises the rest', () => {
  const one = renderState({ state: { ...UNPUSHED, commitsInScope: 1 }, ops: [], since: 'a', sinceDate: 'd' });
  const two = renderState({ state: { ...UNPUSHED, commitsInScope: 2 }, ops: [], since: 'a', sinceDate: 'd' });
  assert.match(one, /1 commit,/);
  assert.match(two, /2 commits,/);
});

test('renderState reports push status unknown, not UNPUSHED, when pushed is null', () => {
  const out = renderState({
    state: { ...UNPUSHED, pushed: null },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+main — 1 commit, push status unknown \(origin\/dev\)/);
  assert.doesNotMatch(out, /UNPUSHED/);
});

test('renderState reports an attached branch with no upstream as UNPUSHED rather than unknown', () => {
  const out = renderState({
    state: { ...UNPUSHED, upstream: null, ahead: null, commitsInScope: 3 },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+main — 3 commits, UNPUSHED \(no upstream\)/);
});

test('renderState keeps commit count and push status on a detached HEAD, where commits are reachable from no ref', () => {
  const out = renderState({
    state: { ...UNPUSHED, branch: null, detachedAt: 'deadbee', upstream: null, commitsInScope: 3 },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+detached at deadbee — 3 commits, UNPUSHED/);
});

// #1869: the three pushedVia-keyed shapes readState's remote-ref fallback
// produces, plus confirmation the pushed===null "unknown" case keeps its
// pre-#1869 wording verbatim.

const REMOTE_REF_PUSHED = {
  isRepo: true, branch: 'feature-y', detachedAt: null, upstream: null,
  ahead: 0, behind: 0, pushed: true, commitsInScope: 2, linkedWorktree: true,
  remoteRef: 'origin/feature-y', pushedVia: 'remote-ref',
};

test('renderState: pushedVia remote-ref and pushed true names the remote ref and notes no upstream configured', () => {
  const out = renderState({ state: REMOTE_REF_PUSHED, ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14' });
  assert.match(out, /Branch\s+feature-y — 2 commits, pushed \(origin\/feature-y; no upstream configured\)/);
  assert.doesNotMatch(out, /UNPUSHED/);
});

test('renderState: the existing pushed/UNPUSHED(upstream) lines still render when pushedVia is upstream', () => {
  const out = renderState({
    state: { ...PUSHED, pushedVia: 'upstream', remoteRef: null },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+feature-x — 3 commits, pushed to origin\/main/);
});

test('renderState: neither ref exists renders UNPUSHED naming the absent origin/{branch}', () => {
  const out = renderState({
    state: { ...UNPUSHED, upstream: null, ahead: null, commitsInScope: 3, remoteRef: null, pushedVia: null },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+main — 3 commits, UNPUSHED \(no upstream, origin\/main absent\)/);
});

test('renderState: pushed===null keeps its pre-#1869 wording even on a state carrying the new fields', () => {
  const out = renderState({
    state: { ...UNPUSHED, pushed: null, pushedVia: 'upstream', remoteRef: null },
    ops: [], since: 'a1b2c3d', sinceDate: '2026-08-07 09:14',
  });
  assert.match(out, /Branch\s+main — 1 commit, push status unknown \(origin\/dev\)/);
});
