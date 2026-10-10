'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  isSafeBranchName,
  readRemoteTip,
  classifyRemoteBranch,
  findPrsForBranch,
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

// --- real git: the mine / foreign distinction against an actual remote ---

function makeRepos() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-branch-collision-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const other = path.join(root, 'other');
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  };
  const run = (cwd, args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const commit = (cwd, name) => {
    fs.writeFileSync(path.join(cwd, name), name);
    run(cwd, ['add', name]);
    run(cwd, ['commit', '-q', '-m', name]);
  };
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { env });
  for (const dir of [work, other]) {
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env });
    run(dir, ['remote', 'add', 'origin', origin]);
  }
  commit(work, 'base');
  run(work, ['push', '-q', 'origin', 'main']);
  run(other, ['pull', '-q', 'origin', 'main']);
  return {
    root, work, other, run, commit,
    gitIn: (cwd) => (args) => run(cwd, args),
  };
}

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
