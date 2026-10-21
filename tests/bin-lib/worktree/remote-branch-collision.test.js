'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { originWithTwoClones } = require('../../helpers/git-fixtures');
const {
  isSafeBranchName,
  readRemoteTip,
  classifyRemoteBranch,
  findPrsForBranch,
  findPriorAttemptPr,
  formatStopCard,
} = require('../../../plugin/bin/lib/worktree/remote-branch-collision');

// #2844: a run that ADOPTS its worktree (dispatch, multi-spec shared worktree)
// skips build/worktree-setup.md Steps 1-3, so Step 1.6's remote-only stale
// branch check never ran for it and an unrelated same-name branch on origin
// surfaced only as a rejected push. This module is the adopt-path check; the
// load-bearing distinction is "mine" (this run's own earlier push — resume)
// versus "foreign" (someone else's stale leftover).

const SHA_A = 'a'.repeat(40);
const exitWith = (status) => Object.assign(new Error(`exit ${status}`), { status });

// --- fake-runner unit coverage ---

test('classifyRemoteBranch: no ref on origin is absent, and no ancestry check runs', () => {
  const calls = [];
  const git = (args) => {
    calls.push(args[0]);
    return '';
  };
  assert.deepEqual(classifyRemoteBranch({ branch: 'worktree-x', git }), { state: 'absent' });
  assert.deepEqual(calls, ['ls-remote']);
});

test('classifyRemoteBranch: a remote tip contained in HEAD is mine (the resume case)', () => {
  const git = (args) => {
    if (args[0] === 'ls-remote') return `${SHA_A}\trefs/heads/worktree-x\n`;
    if (args[0] === 'merge-base') {
      assert.deepEqual(args, ['merge-base', '--is-ancestor', SHA_A, 'HEAD']);
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  assert.deepEqual(classifyRemoteBranch({ branch: 'worktree-x', git }), {
    state: 'mine',
    remoteSha: SHA_A,
  });
});

test('classifyRemoteBranch: a remote tip NOT contained in HEAD is foreign', () => {
  const git = (args) => {
    if (args[0] === 'ls-remote') return `${SHA_A}\trefs/heads/worktree-x\n`;
    if (args[0] === 'merge-base') throw exitWith(1);
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  assert.deepEqual(classifyRemoteBranch({ branch: 'worktree-x', git }), {
    state: 'foreign',
    remoteSha: SHA_A,
  });
});

test('classifyRemoteBranch: an unknown remote object is fetched, then classified — never guessed', () => {
  const calls = [];
  let fetched = false;
  const git = (args) => {
    calls.push(args[0]);
    if (args[0] === 'ls-remote') return `${SHA_A}\trefs/heads/worktree-x\n`;
    if (args[0] === 'fetch') {
      assert.deepEqual(args, ['fetch', 'origin', 'refs/heads/worktree-x']);
      fetched = true;
      return '';
    }
    if (args[0] === 'merge-base') throw exitWith(fetched ? 1 : 128);
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const result = classifyRemoteBranch({ branch: 'worktree-x', git });
  assert.equal(result.state, 'foreign');
  assert.deepEqual(calls, ['ls-remote', 'merge-base', 'fetch', 'merge-base']);
});

test('classifyRemoteBranch: an ls-remote failure is unreachable, distinct from absent', () => {
  const git = () => {
    throw exitWith(128);
  };
  const result = classifyRemoteBranch({ branch: 'worktree-x', git });
  assert.equal(result.state, 'unreachable');
  assert.equal(result.reason, 'ls-remote-failed');
});

test('classifyRemoteBranch: a failed fetch of an unknown object is unreachable, not foreign', () => {
  const git = (args) => {
    if (args[0] === 'ls-remote') return `${SHA_A}\trefs/heads/worktree-x\n`;
    throw exitWith(128);
  };
  const result = classifyRemoteBranch({ branch: 'worktree-x', git });
  assert.equal(result.state, 'unreachable');
  assert.equal(result.reason, 'fetch-failed');
});

test('classifyRemoteBranch: a dash-led or malformed name never reaches git', () => {
  const git = () => {
    throw new Error('git must not be called');
  };
  for (const branch of ['--upload-pack=x', '', 'a b', 'a..b', undefined]) {
    assert.equal(classifyRemoteBranch({ branch, git }).state, 'unreachable');
    assert.equal(isSafeBranchName(branch), false);
  }
  assert.equal(isSafeBranchName('worktree-flow+spec-2704-2709'), true);
  assert.equal(isSafeBranchName('flow/spec-1-2'), true);
});

test('readRemoteTip: matches the exact ref only, not a tail-matching sibling', () => {
  const git = (args) => {
    assert.deepEqual(args, ['ls-remote', '--heads', 'origin', 'refs/heads/x']);
    return `${SHA_A}\trefs/heads/team/x\n`;
  };
  assert.deepEqual(readRemoteTip({ branch: 'x', git }), { ok: true, sha: null });
});

test('findPrsForBranch: a failed lookup is ok:false, distinct from a confirmed empty list', () => {
  const failing = findPrsForBranch({ branch: 'b', repo: 'o/r', gh: () => { throw new Error('no gh'); } });
  assert.equal(failing.ok, false);
  const empty = findPrsForBranch({ branch: 'b', repo: 'o/r', gh: () => '[]' });
  assert.deepEqual(empty, { ok: true, prs: [] });
});

test('formatStopCard: names the branch, the short sha, the PR state, and all three options', () => {
  const card = formatStopCard({
    branch: 'worktree-dispatch-next',
    remoteSha: 'c19a97b7a4ff1b8e9ff51f5834326eaabbd189b5',
    prLookup: { ok: true, prs: [{ number: 7, url: 'https://example.test/pr/7', state: 'CLOSED' }] },
  });
  assert.match(card, /^## Build: Adopted branch collides with an unrelated branch on origin/);
  assert.match(card, /`worktree-dispatch-next` already exists on `origin` at `c19a97b7a`/);
  assert.match(card, /closed PR #7/);
  assert.match(card, /git branch -m worktree-dispatch-next-\{suffix\}/);
  assert.match(card, /git push origin --delete worktree-dispatch-next/);
  assert.match(card, /resume the existing remote branch\/PR/);
  assert.match(formatStopCard({ branch: 'b', remoteSha: SHA_A, prLookup: { ok: false, prs: [] } }), /PR status unknown/);
  assert.match(formatStopCard({ branch: 'b', remoteSha: SHA_A, prLookup: { ok: true, prs: [] } }), /no PR found/);
});

test('formatStopCard with a reason: names it and does not claim the commit is outside HEAD\'s history (#3093)', () => {
  const card = formatStopCard({ branch: 'b', remoteSha: SHA_A, prLookup: { ok: true, prs: [] }, reason: 'fetch-failed' });
  assert.match(card, /^## Build: Adopted branch collides with an unrelated branch on origin/);
  assert.match(card, /could not be determined \(`fetch-failed`\)/);
  assert.doesNotMatch(card, /is not in this worktree's history/);
  assert.match(card, /no PR found/);
  assert.match(card, /git branch -m b-\{suffix\}/);
});

// --- real git: the mine / foreign distinction against an actual remote ---

const makeRepos = () => originWithTwoClones('remote-branch-collision-');

test('real git: this run\'s own earlier push is mine; an unrelated same-name branch is foreign', (t) => {
  const r = makeRepos();
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const git = r.gitIn(r.work);

  r.run(r.work, ['checkout', '-q', '-b', 'worktree-dispatch-next']);
  assert.deepEqual(classifyRemoteBranch({ branch: 'worktree-dispatch-next', git }), { state: 'absent' });

  // Resume: this worktree pushed the branch, then committed more locally.
  r.commit(r.work, 'materialize');
  r.run(r.work, ['push', '-q', 'origin', 'worktree-dispatch-next']);
  r.commit(r.work, 'more-work');
  assert.equal(classifyRemoteBranch({ branch: 'worktree-dispatch-next', git }).state, 'mine');

  // The #2844 shape: a different checkout left an unrelated branch on origin
  // under the same name. Its tip is not in this worktree's object store yet.
  r.run(r.other, ['checkout', '-q', '-b', 'worktree-dispatch-next']);
  r.commit(r.other, 'someone-elses-stale-work');
  r.run(r.other, ['push', '-q', '--force', 'origin', 'worktree-dispatch-next']);
  const foreign = classifyRemoteBranch({ branch: 'worktree-dispatch-next', git });
  assert.equal(foreign.state, 'foreign');
  assert.equal(foreign.remoteSha, r.run(r.other, ['rev-parse', 'HEAD']).trim());

  // And the classification predicts the push: it is rejected non-fast-forward.
  assert.throws(() => r.run(r.work, ['push', '-q', 'origin', 'worktree-dispatch-next']));
});

test('real git: an unreachable origin is unreachable, never absent', (t) => {
  const r = makeRepos();
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  r.run(r.work, ['remote', 'set-url', 'origin', path.join(r.root, 'does-not-exist.git')]);
  const result = classifyRemoteBranch({ branch: 'main', git: r.gitIn(r.work) });
  assert.equal(result.state, 'unreachable');
  assert.equal(result.reason, 'ls-remote-failed');
});

// --- #3887: a dispatched retry's own prior attempt vs a foreign branch ---

const SHA_B = 'b'.repeat(40);
const ref = (number, slug = 'o/r') => ({ number, repository: { name: slug.split('/')[1], owner: { login: slug.split('/')[0] } } });
const closedPr = (over) => ({
  number: 9,
  url: 'https://example.test/pr/9',
  state: 'CLOSED',
  isCrossRepository: false,
  headRefOid: SHA_B,
  closingIssuesReferences: [ref(42)],
  body: '<!-- claude-tweaks-run: 2026-10-21T000000-record-42 -->\nclaude-tweaks-run: 2026-10-21T000000-record-42\n\nFixes #42\n',
  ...over,
});
const ancestorGit = (calls = []) => (args) => {
  calls.push(args);
  assert.deepEqual(args, ['merge-base', '--is-ancestor', SHA_B, SHA_A]);
  return '';
};
const priorAttempt = (over) => findPriorAttemptPr({
  remoteSha: SHA_A,
  prLookup: { ok: true, prs: [closedPr()] },
  records: [42],
  repo: 'o/r',
  git: ancestorGit(),
  ...over,
});

test('AC4.1: findPriorAttemptPr matches this record\'s closed claude-tweaks PR whose head is an ancestor of origin\'s tip', () => {
  assert.deepEqual(priorAttempt(), { number: 9, url: 'https://example.test/pr/9' });
});

test('AC2.1: a closed PR for a different record stays foreign', () => {
  const calls = [];
  assert.equal(priorAttempt({ records: [43], git: ancestorGit(calls) }), null);
  assert.equal(calls.length, 0);
});

test('AC2.1: a closed PR with no claude-tweaks-run marker (a human\'s PR) stays foreign', () => {
  const prLookup = { ok: true, prs: [closedPr({ body: 'Fixes #42\n' })] };
  assert.equal(priorAttempt({ prLookup }), null);
});

test('AC2.1: an open or merged PR never matches', () => {
  for (const state of ['OPEN', 'MERGED']) {
    const prLookup = { ok: true, prs: [closedPr({ state })] };
    assert.equal(priorAttempt({ prLookup }), null, state);
  }
});

test('AC2.1: a fork PR on the same branch name never matches, nor does one with no isCrossRepository', () => {
  for (const isCrossRepository of [true, undefined]) {
    const calls = [];
    const prLookup = { ok: true, prs: [closedPr({ isCrossRepository })] };
    assert.equal(priorAttempt({ prLookup, git: ancestorGit(calls) }), null, String(isCrossRepository));
    assert.equal(calls.length, 0);
  }
});

test('AC2.1: a PR head that is not an ancestor of origin\'s tip, or an ancestry error, never matches', () => {
  for (const status of [1, 128]) {
    const git = () => { throw exitWith(status); };
    assert.equal(priorAttempt({ git }), null, `exit ${status}`);
  }
});

test('findPriorAttemptPr: a failed or absent lookup, or no records, is null', () => {
  const calls = [];
  const git = ancestorGit(calls);
  assert.equal(priorAttempt({ prLookup: { ok: false, prs: [] }, git }), null);
  assert.equal(priorAttempt({ prLookup: null, git }), null);
  assert.equal(priorAttempt({ records: [], git }), null);
  assert.equal(priorAttempt({ records: ['{records}'], git }), null);
  assert.equal(priorAttempt({ remoteSha: 'not-a-sha', git }), null);
  assert.equal(calls.length, 0);
});

test('findPriorAttemptPr: links by a closing-keyword line when GitHub linked no issue (empty references)', () => {
  const prLookup = { ok: true, prs: [closedPr({ closingIssuesReferences: [] })] };
  assert.deepEqual(priorAttempt({ prLookup }), { number: 9, url: 'https://example.test/pr/9' });
});

test('findPriorAttemptPr: a PR read without closingIssuesReferences is unknown, so it stays foreign', () => {
  const prLookup = { ok: true, prs: [closedPr({ closingIssuesReferences: undefined })] };
  assert.equal(priorAttempt({ prLookup }), null);
});

test('findPriorAttemptPr: a closing reference into another repository never counts, and no repo is no match', () => {
  const prLookup = { ok: true, prs: [closedPr({ closingIssuesReferences: [ref(42, 'other/x')], body: closedPr().body.replace('Fixes #42', 'Refs #42') })] };
  assert.equal(priorAttempt({ prLookup }), null);
  assert.equal(priorAttempt({ repo: undefined }), null);
});

test('findPriorAttemptPr: links by closingIssuesReferences alone when the body has no Fixes line', () => {
  const prLookup = { ok: true, prs: [closedPr({ body: '<!-- claude-tweaks-run: 2026-10-21T000000-record-42 -->\n' })] };
  assert.deepEqual(priorAttempt({ prLookup }), { number: 9, url: 'https://example.test/pr/9' });
});

test('findPriorAttemptPr: skips non-matching closed PRs ahead of the record\'s own and returns the own one', () => {
  const OTHER_HEAD = 'c'.repeat(40);
  const prLookup = {
    ok: true,
    prs: [
      closedPr({ number: 1, closingIssuesReferences: [ref(43)], body: closedPr().body.replace('#42', '#43') }),
      closedPr({ number: 2, isCrossRepository: true }),
      closedPr({ number: 3, headRefOid: OTHER_HEAD }),
      closedPr({ number: 9, url: 'https://example.test/pr/9' }),
    ],
  };
  const git = (args) => {
    if (args[2] === OTHER_HEAD) throw exitWith(1);
    return '';
  };
  assert.deepEqual(priorAttempt({ prLookup, git }), { number: 9, url: 'https://example.test/pr/9' });
});

test('findPrsForBranch: requests the fields findPriorAttemptPr reads', () => {
  let seen;
  findPrsForBranch({ branch: 'b', repo: 'o/r', gh: (args) => { seen = args; return '[]'; } });
  assert.equal(seen[seen.indexOf('--json') + 1], 'number,url,state,isDraft,headRefOid,closingIssuesReferences,body,isCrossRepository');
});

test('AC1.1: a retry\'s fresh branch is foreign by ancestry but prior-attempt by PR, and adopting it lets the push fast-forward', (t) => {
  const r = makeRepos();
  t.after(() => fs.rmSync(r.root, { recursive: true, force: true }));
  const branch = 'worktree-dispatch-record-42';

  // First attempt: pushed, its PR closed, then more commits landed on the branch.
  r.run(r.other, ['checkout', '-q', '-b', branch]);
  r.commit(r.other, 'plan');
  r.run(r.other, ['push', '-q', 'origin', branch]);
  const closedHead = r.run(r.other, ['rev-parse', 'HEAD']).trim();
  r.commit(r.other, 'post-close-plan');
  r.run(r.other, ['push', '-q', 'origin', branch]);

  // The retry: a fresh branch of the same name from main.
  r.run(r.work, ['checkout', '-q', '-b', branch]);
  const git = r.gitIn(r.work);
  const verdict = classifyRemoteBranch({ branch, git });
  assert.equal(verdict.state, 'foreign');

  const prior = findPriorAttemptPr({
    remoteSha: verdict.remoteSha,
    prLookup: { ok: true, prs: [closedPr({ headRefOid: closedHead })] },
    records: [42],
    repo: 'o/r',
    git,
  });
  assert.deepEqual(prior, { number: 9, url: 'https://example.test/pr/9' });

  r.run(r.work, ['merge', '--no-edit', verdict.remoteSha]);
  assert.equal(classifyRemoteBranch({ branch, git }).state, 'mine');
  assert.doesNotThrow(() => r.run(r.work, ['push', '-q', 'origin', branch]));
});
