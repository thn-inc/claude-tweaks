'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCherryPickTrailer,
  findContainingBranches,
  findOpenPrsForBranches,
  checkCherryPickProvenance,
  formatStopCard,
} = require('../../../plugin/bin/lib/worktree/cherry-pick-provenance');

// --- parseCherryPickTrailer (AC3: an ordinary commit must never be scanned further) ---

test('parseCherryPickTrailer: extracts the sha from a real -x trailer', () => {
  const msg = 'Fix the thing\n\n(cherry picked from commit 1893db5b7abc1234567890abcdef1234567890)';
  assert.equal(parseCherryPickTrailer(msg), '1893db5b7abc1234567890abcdef1234567890');
});

test('parseCherryPickTrailer: extracts a short sha too', () => {
  const msg = 'Fix the thing\n\n(cherry picked from commit 1893db5)';
  assert.equal(parseCherryPickTrailer(msg), '1893db5');
});

test('parseCherryPickTrailer: an ordinary authored commit (no trailer) returns null', () => {
  assert.equal(parseCherryPickTrailer('Add the new feature\n\nrefs #1957'), null);
});

test('parseCherryPickTrailer: non-string input returns null rather than throwing', () => {
  assert.equal(parseCherryPickTrailer(undefined), null);
  assert.equal(parseCherryPickTrailer(null), null);
});

// --- findContainingBranches ---

test('findContainingBranches: strips origin/ prefix, dedupes, excludes own branch and the HEAD arrow line', () => {
  const fakeGit = (args) => {
    assert.deepEqual(args, ['branch', '-r', '--contains', 'deadbeef']);
    return [
      '  origin/worktree-record-1224',
      '  origin/HEAD -> origin/main',
      '  origin/worktree-record-1957-branch-reuse-guard',
      '  origin/worktree-record-1224', // duplicate line, as a real multi-ref listing can produce
      '',
    ].join('\n');
  };
  const result = findContainingBranches({
    sha: 'deadbeef',
    ownBranch: 'worktree-record-1957-branch-reuse-guard',
    git: fakeGit,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.branches, ['worktree-record-1224']);
});

test('findContainingBranches: a lookup failure (no network / not found) returns ok:false, not a false "no match"', () => {
  const fakeGit = () => {
    throw new Error('fatal: bad object deadbeef');
  };
  const result = findContainingBranches({ sha: 'deadbeef', ownBranch: 'x', git: fakeGit });
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof Error);
});

// --- findOpenPrsForBranches ---

test('findOpenPrsForBranches: a branch with an open PR is reported, a branch with none is not degraded', () => {
  const fakeGh = (args) => {
    const headIdx = args.indexOf('--head');
    const branch = args[headIdx + 1];
    if (branch === 'worktree-record-1224') {
      return JSON.stringify([{ number: 1852, url: 'https://github.com/o/r/pull/1852', isDraft: false }]);
    }
    return JSON.stringify([]);
  };
  const { results, degraded } = findOpenPrsForBranches({
    branches: ['worktree-record-1224', 'some-other-branch'],
    repo: 'o/r',
    gh: fakeGh,
  });
  assert.equal(degraded, false);
  assert.deepEqual(
    results.map((r) => ({ branch: r.branch, ok: r.ok, prCount: r.prs.length })),
    [
      { branch: 'worktree-record-1224', ok: true, prCount: 1 },
      { branch: 'some-other-branch', ok: true, prCount: 0 },
    ],
  );
});

test('findOpenPrsForBranches: a gh lookup failure sets degraded distinctly from "no PR found"', () => {
  const fakeGh = () => {
    throw new Error('gh: connection refused');
  };
  const { results, degraded } = findOpenPrsForBranches({ branches: ['b1'], repo: 'o/r', gh: fakeGh });
  assert.equal(degraded, true);
  assert.equal(results[0].ok, false);
  assert.deepEqual(results[0].prs, []);
});

// --- checkCherryPickProvenance (the full orchestration, AC1/AC2/AC3) ---

test('AC3: a commit with no cherry-pick trailer is never scanned — git/gh are never called', () => {
  let called = false;
  const spy = () => {
    called = true;
    return '';
  };
  const result = checkCherryPickProvenance({
    message: 'Add the new feature\n\nrefs #1957',
    ownBranch: 'worktree-record-1957-branch-reuse-guard',
    repo: 'o/r',
    git: spy,
    gh: spy,
  });
  assert.deepEqual(result, { scanned: false });
  assert.equal(called, false, 'git/gh must not be invoked when there is no trailer to act on');
});

test('AC1: #1821\'s exact shape — a cherry-picked commit whose source branch has an open PR triggers', () => {
  const message =
    'Port fix from record #1224\n\n(cherry picked from commit 1893db5b7abc1234567890abcdef1234567890)';
  const fakeGit = () => '  origin/worktree-record-1224\n';
  const fakeGh = () =>
    JSON.stringify([{ number: 1852, url: 'https://github.com/o/r/pull/1852', isDraft: false }]);
  const result = checkCherryPickProvenance({
    message,
    ownBranch: 'worktree-record-1957-branch-reuse-guard',
    repo: 'o/r',
    git: fakeGit,
    gh: fakeGh,
  });
  assert.equal(result.scanned, true);
  assert.equal(result.trigger, true);
  assert.equal(result.degraded, false);
  assert.equal(result.sha, '1893db5b7abc1234567890abcdef1234567890');
  assert.deepEqual(result.openPrBranches, [
    { branch: 'worktree-record-1224', prs: [{ number: 1852, url: 'https://github.com/o/r/pull/1852', isDraft: false }] },
  ]);
});

test('AC2: a cherry-picked commit whose source branch has NO open PR does not trigger', () => {
  const message = 'Port fix\n\n(cherry picked from commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)';
  const fakeGit = () => '  origin/some-abandoned-branch\n';
  const fakeGh = () => JSON.stringify([]);
  const result = checkCherryPickProvenance({
    message,
    ownBranch: 'worktree-record-1957-branch-reuse-guard',
    repo: 'o/r',
    git: fakeGit,
    gh: fakeGh,
  });
  assert.equal(result.scanned, true);
  assert.equal(result.trigger, false);
  assert.equal(result.degraded, false);
  assert.deepEqual(result.openPrBranches, []);
});

test('a cherry-picked commit whose sha is contained by no other branch does not trigger', () => {
  const message = 'Port fix\n\n(cherry picked from commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)';
  const fakeGit = () => '';
  const result = checkCherryPickProvenance({
    message,
    ownBranch: 'worktree-record-1957-branch-reuse-guard',
    repo: 'o/r',
    git: fakeGit,
    gh: () => {
      throw new Error('must not be called when there are no candidate branches');
    },
  });
  assert.equal(result.scanned, true);
  assert.equal(result.trigger, false);
  assert.deepEqual(result.branches, []);
});

test('a branch-contains lookup failure fails open and is flagged degraded, distinct from a confirmed no-match', () => {
  const message = 'Port fix\n\n(cherry picked from commit deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)';
  const result = checkCherryPickProvenance({
    message,
    ownBranch: 'own',
    repo: 'o/r',
    git: () => {
      throw new Error('no network');
    },
    gh: () => {
      throw new Error('must not be called — branch lookup never resolved a candidate list');
    },
  });
  assert.equal(result.scanned, true);
  assert.equal(result.degraded, true);
  assert.equal(result.degradeReason, 'branch-contains-lookup-failed');
  assert.equal(result.trigger, false, 'a degraded/unknown result must never masquerade as a confirmed no-PR pass');
});

test('multiple containing branches: only the one(s) with an open PR are named as triggers', () => {
  const message = 'Port fix\n\n(cherry picked from commit 1893db5b7abc1234567890abcdef1234567890)';
  const fakeGit = () => ['  origin/branch-a', '  origin/branch-b', '  origin/own-branch'].join('\n');
  const fakeGh = (args) => {
    const branch = args[args.indexOf('--head') + 1];
    if (branch === 'branch-b') {
      return JSON.stringify([{ number: 42, url: 'https://github.com/o/r/pull/42', isDraft: false }]);
    }
    return JSON.stringify([]);
  };
  const result = checkCherryPickProvenance({
    message,
    ownBranch: 'own-branch',
    repo: 'o/r',
    git: fakeGit,
    gh: fakeGh,
  });
  assert.equal(result.trigger, true);
  assert.deepEqual(result.openPrBranches.map((b) => b.branch), ['branch-b']);
});

// --- formatStopCard ---

test('formatStopCard: names the specific branch and PR, and both options', () => {
  const card = formatStopCard({
    sha: '1893db5b7',
    openPrBranches: [
      { branch: 'worktree-record-1224', prs: [{ number: 1852, url: 'https://github.com/o/r/pull/1852' }] },
    ],
  });
  assert.match(card, /worktree-record-1224/);
  assert.match(card, /#1852/);
  assert.match(card, /https:\/\/github\.com\/o\/r\/pull\/1852/);
  assert.match(card, /1893db5b7/);
  assert.match(card, /stop and route to the existing PR/);
  assert.match(card, /proceed anyway/);
});
