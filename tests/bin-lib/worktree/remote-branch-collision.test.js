'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { originWithTwoClones } = require('../../helpers/git-fixtures');
const { isValidBranchName } = require('../../../plugin/bin/lib/branch-name');
const {
  readRemoteTip,
  classifyRemoteBranch,
  findPrsForBranch,
  findPriorAttemptPr,
  formatStopCard,
  readIssueComments,
  TOMBSTONE_CLOSE_WINDOW_MS,
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

test('#4648 AC1.1: classifyRemoteBranch rejects every name isValidBranchName rejects, before git runs', () => {
  const git = () => {
    throw new Error('git must not be called');
  };
  for (const branch of ['--upload-pack=x', '', 'a b', 'a..b', undefined, 'a/', 'a//b', 'a.lock']) {
    assert.deepEqual(classifyRemoteBranch({ branch, git }), { state: 'unreachable', reason: 'invalid-branch-name' }, String(branch));
    assert.equal(isValidBranchName(branch), false, String(branch));
  }
  assert.equal(isValidBranchName('worktree-flow+spec-2704-2709'), true);
  assert.equal(isValidBranchName('flow/spec-1-2'), true);
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
// #4058: dispatch/settle-and-merge.md Step 6 step 5 posts the `Attempt N failed` comment, then closes
// the PR, so a real tombstone's comment lands seconds before `closedAt`.
const CLOSED_AT = '2026-10-21T12:00:00Z';
const tombstoneComment = (over) => ({
  body: 'Attempt 1 failed: tests red. Claim released, will retry.',
  authorAssociation: 'MEMBER',
  createdAt: '2026-10-21T11:59:55Z',
  ...over,
});
const withComments = (comments) => ({ readComments: () => ({ ok: true, comments }) });
const PR9 = { number: 9, url: 'https://example.test/pr/9' };
const closedPr = (over) => ({
  number: 9,
  url: 'https://example.test/pr/9',
  state: 'CLOSED',
  isCrossRepository: false,
  closedAt: CLOSED_AT,
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
  readComments: () => ({ ok: true, comments: [tombstoneComment()] }),
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

test('findPriorAttemptPr: judges the newest closed PR, ignoring older non-matching ones and fork PRs', () => {
  const OTHER_HEAD = 'c'.repeat(40);
  const prLookup = {
    ok: true,
    prs: [
      closedPr({ number: 1, closedAt: '2026-10-01T00:00:00Z', closingIssuesReferences: [ref(43)], body: closedPr().body.replace('#42', '#43') }),
      closedPr({ number: 2, isCrossRepository: true }),
      closedPr({ number: 3, closedAt: '2026-10-02T00:00:00Z', headRefOid: OTHER_HEAD }),
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
  assert.equal(seen[seen.indexOf('--json') + 1], 'number,url,state,isDraft,headRefOid,closingIssuesReferences,body,isCrossRepository,closedAt');
});

// --- #4058: a closed PR is a tombstone only with a failure comment just before its closedAt ---

test('#4058 AC2.1: a tombstone PR (attempt comment just before closedAt) matches, read from the record it closes', () => {
  const calls = [];
  const readComments = (a) => { calls.push(a); return { ok: true, comments: [tombstoneComment()] }; };
  assert.deepEqual(priorAttempt({ readComments }), PR9);
  assert.deepEqual(calls, [{ number: 42, repo: 'o/r' }]);
});

test('#4058 AC1.1: a PR with no attempt comment stays foreign', () => {
  assert.equal(priorAttempt(withComments([])), null);
  assert.equal(priorAttempt(withComments([tombstoneComment({ body: 'Rejected, wrong approach.' })])), null);
});

test('#4058 AC1.1: a PR whose only attempt comment is older than the window stays foreign (stale marker)', () => {
  const edge = new Date(Date.parse(CLOSED_AT) - TOMBSTONE_CLOSE_WINDOW_MS).toISOString();
  const justOutside = new Date(Date.parse(CLOSED_AT) - TOMBSTONE_CLOSE_WINDOW_MS - 1000).toISOString();
  assert.equal(priorAttempt(withComments([tombstoneComment({ createdAt: justOutside })])), null);
  assert.deepEqual(priorAttempt(withComments([tombstoneComment({ createdAt: edge })])), PR9);
});

test('#4058 AC1.1: a failed or partial issue-comment lookup stays foreign', () => {
  assert.equal(priorAttempt({ readComments: () => ({ ok: false, comments: [] }) }), null);
  assert.equal(priorAttempt({ readComments: () => ({ ok: false, comments: [tombstoneComment()] }) }), null);
});

test('#4058 AC3.1: an attempt comment from an untrusted author never counts', () => {
  for (const authorAssociation of ['CONTRIBUTOR', 'NONE', undefined]) {
    assert.equal(priorAttempt(withComments([tombstoneComment({ authorAssociation })])), null, String(authorAssociation));
  }
  for (const authorAssociation of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.deepEqual(priorAttempt(withComments([tombstoneComment({ authorAssociation })])), PR9, authorAssociation);
  }
});

test('#4058: a comment after closedAt stays foreign; one at closedAt counts', () => {
  assert.equal(priorAttempt(withComments([tombstoneComment({ createdAt: '2026-10-21T12:00:01Z' })])), null);
  assert.deepEqual(priorAttempt(withComments([tombstoneComment({ createdAt: CLOSED_AT })])), PR9);
});

test('#4058: an unparseable closedAt or createdAt stays foreign', () => {
  for (const closedAt of [null, 'nope']) {
    assert.equal(priorAttempt({ prLookup: { ok: true, prs: [closedPr({ closedAt })] } }), null, String(closedAt));
  }
  assert.equal(priorAttempt(withComments([tombstoneComment({ createdAt: 'nope' })])), null);
  assert.deepEqual(priorAttempt(), PR9);
});

test('#4058: ancestry failure never reads the comments', () => {
  const calls = [];
  const git = () => { throw exitWith(1); };
  assert.equal(priorAttempt({ git, readComments: (a) => { calls.push(a); return { ok: true, comments: [tombstoneComment()] }; } }), null);
  assert.equal(calls.length, 0);
});

const OLDER = '2026-10-01T00:00:00Z';
const lookupOf = (prs, order) => ({ prLookup: { ok: true, prs: order === 'reversed' ? [...prs].reverse() : prs } });

test('#4058 AC5.1 AC5.2 AC5.3 Reading A: a newest human-closed PR hides an older genuine tombstone', () => {
  const prs = [closedPr({ number: 3, url: 'https://example.test/pr/3', closedAt: OLDER }), closedPr()];
  const readComments = () => ({ ok: true, comments: [tombstoneComment({ createdAt: '2026-09-30T23:59:55Z' })] });
  for (const order of ['listed', 'reversed']) {
    assert.equal(priorAttempt({ ...lookupOf(prs, order), readComments }), null, order);
  }
});

test('#4058 Reading A: a newest tombstone matches over an older evidence-less PR, and only the newest PR is read', () => {
  const prs = [closedPr({ number: 3, url: 'https://example.test/pr/3', closedAt: OLDER, headRefOid: 'c'.repeat(40) }), closedPr()];
  for (const order of ['listed', 'reversed']) {
    const reads = [];
    const gitCalls = [];
    const git = (args) => { gitCalls.push(args); return ''; };
    const readComments = (a) => { reads.push(a); return { ok: true, comments: [tombstoneComment()] }; };
    assert.deepEqual(priorAttempt({ ...lookupOf(prs, order), git, readComments }), PR9, order);
    assert.equal(reads.length, 1, order);
    assert.deepEqual(gitCalls, [['merge-base', '--is-ancestor', SHA_B, SHA_A]], order);
  }
});

test('#4058 Reading A: a newest closed PR that fails an existing check is null, never a fallback to an older match', () => {
  const older = closedPr({ number: 3, url: 'https://example.test/pr/3', closedAt: OLDER });
  const otherRecord = closedPr({ closingIssuesReferences: [ref(43)], body: closedPr().body.replace('#42', '#43') });
  assert.equal(priorAttempt(lookupOf([older, otherRecord])), null);
  assert.equal(priorAttempt(lookupOf([otherRecord, older])), null);
  // Newest PR 9's head (SHA_B) is not an ancestor; the older PR's head is.
  const git = (args) => { if (args[2] === SHA_B) throw exitWith(1); return ''; };
  const olderOtherHead = closedPr({ number: 3, url: 'https://example.test/pr/3', closedAt: OLDER, headRefOid: 'c'.repeat(40) });
  assert.equal(priorAttempt({ ...lookupOf([olderOtherHead, closedPr()]), git }), null);
  assert.equal(priorAttempt({ ...lookupOf([closedPr(), olderOtherHead]), git }), null);
});

test('#4058 Reading A: a fork PR is not a candidate for newest', () => {
  const fork = closedPr({ number: 2, url: 'https://example.test/pr/2', isCrossRepository: true, closedAt: '2026-10-22T00:00:00Z' });
  for (const order of ['listed', 'reversed']) {
    assert.deepEqual(priorAttempt(lookupOf([fork, closedPr()], order)), PR9, order);
  }
});

const PR11 = (over) => closedPr({ number: 11, url: 'https://example.test/pr/11', ...over });

test('#4058 AC6.1 AC6.2 Reading B: a newer open, draft or merged same-repo PR blocks adoption', () => {
  const live = [
    { state: 'OPEN', isDraft: false, closedAt: null },
    { state: 'OPEN', isDraft: true, closedAt: null },
    { state: 'MERGED', closedAt: '2026-10-21T13:00:00Z' },
  ];
  for (const over of live) {
    for (const order of ['listed', 'reversed']) {
      const reads = [];
      const readComments = (a) => { reads.push(a); return { ok: true, comments: [tombstoneComment()] }; };
      assert.equal(priorAttempt({ ...lookupOf([closedPr(), PR11(over)], order), readComments }), null, `${JSON.stringify(over)} ${order}`);
      assert.equal(reads.length, 0, `${JSON.stringify(over)} ${order}`);
    }
  }
});

test('#4058 Reading B: an open PR blocks whatever its age', () => {
  const open = PR11({ state: 'OPEN', closedAt: null, createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(priorAttempt(lookupOf([closedPr(), open])), null);
});

test('#4058 Reading B: an older merged PR or a fork\'s open PR does not block', () => {
  assert.deepEqual(priorAttempt(lookupOf([closedPr(), PR11({ state: 'MERGED', closedAt: OLDER })])), PR9);
  assert.deepEqual(priorAttempt(lookupOf([closedPr(), PR11({ state: 'OPEN', closedAt: null, isCrossRepository: true })])), PR9);
});

test('#4058 Reading B: a merged PR whose closedAt cannot be compared blocks', () => {
  for (const closedAt of [null, 'nope', CLOSED_AT]) {
    assert.equal(priorAttempt(lookupOf([closedPr(), PR11({ state: 'MERGED', closedAt })])), null, String(closedAt));
  }
});

test('#4058 Reading A: newest cannot be established, so foreign', () => {
  const other = (over) => closedPr({ number: 3, url: 'https://example.test/pr/3', ...over });
  for (const closedAt of [null, 'nope']) {
    assert.equal(priorAttempt(lookupOf([closedPr(), other({ closedAt })])), null, String(closedAt));
  }
  assert.equal(priorAttempt(lookupOf([closedPr(), other({ closedAt: CLOSED_AT })])), null);
});

test('#4058: a null or non-object comment element is skipped, never thrown on', () => {
  assert.deepEqual(priorAttempt(withComments([null, 'x', tombstoneComment()])), PR9);
  assert.equal(priorAttempt(withComments([null])), null);
  assert.deepEqual(priorAttempt(lookupOf([null, 'x', closedPr()])), PR9);
});

test('#4058: a bundle PR matches on any record it closes and never reads a record it does not', () => {
  const reads = [];
  const readComments = ({ number }) => { reads.push(number); return { ok: true, comments: number === 42 ? [tombstoneComment()] : [] }; };
  const prLookup = { ok: true, prs: [closedPr({ closingIssuesReferences: [ref(7), ref(42)] })] };
  assert.deepEqual(priorAttempt({ records: [7, 42, 8], prLookup, readComments }), PR9);
  assert.deepEqual(reads, [7, 42]);
});

test('#4058: readIssueComments reads the record\'s issue comments through gh', () => {
  const comments = [tombstoneComment()];
  let seen;
  const ok = readIssueComments({ number: 42, repo: 'o/r', gh: (args) => { seen = args; return JSON.stringify({ comments }); } });
  assert.deepEqual(seen, ['issue', 'view', '42', '--repo', 'o/r', '--json', 'comments']);
  assert.deepEqual(ok, { ok: true, comments });
});

test('#4058: readIssueComments reports ok:false when gh throws, or returns non-json or the wrong shape', () => {
  const answer = (out) => readIssueComments({ number: 42, repo: 'o/r', gh: () => out });
  assert.equal(readIssueComments({ number: 42, repo: 'o/r', gh: () => { throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }); } }).ok, false);
  for (const out of ['not json', '{}', '{"comments":"x"}', 'null']) {
    const result = answer(out);
    assert.equal(result.ok, false, out);
    assert.deepEqual(result.comments, [], out);
  }
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
    readComments: () => ({ ok: true, comments: [tombstoneComment()] }),
  });
  assert.deepEqual(prior, { number: 9, url: 'https://example.test/pr/9' });

  r.run(r.work, ['merge', '--no-edit', verdict.remoteSha]);
  assert.equal(classifyRemoteBranch({ branch, git }).state, 'mine');
  assert.doesNotThrow(() => r.run(r.work, ['push', '-q', 'origin', branch]));
});
