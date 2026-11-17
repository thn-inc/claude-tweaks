'use strict';
// Template-copy fixtures for prune-remote.test.js (#5769): each variant's origin, repo and
// pushed branches are built once per test process and copied per call, so a further call
// starts no git process (tests/helpers/git-template.js). No test runner import here.

const fs = require('node:fs');
const path = require('node:path');
const { fromTemplateSet, disableReceiveAutoGc } = require('../../helpers/git-template');
const { fixtureGit, initRepo } = require('../../helpers/git-fixtures');

function git(cwd, ...args) {
  return fixtureGit(args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A clone wired to a real bare origin — push --delete must actually land.
function buildBase({ origin, dir }) {
  git(origin, 'init', '--bare', '-b', 'main');
  disableReceiveAutoGc(origin);
  initRepo(dir, { branch: 'main', name: 't', email: 't@t' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main');
}

// Push `branch` with one commit and return to main; the local branch stays, never merged.
function pushedUnmerged(dir, branch, file, content, msg) {
  git(dir, 'checkout', '-b', branch);
  fs.writeFileSync(path.join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-m', msg);
  git(dir, 'push', 'origin', branch);
  git(dir, 'checkout', 'main');
}

// Push `branch` with one commit, cherry-pick it onto main (squash-merge shape), then dispose
// the local branch; the remote lingers.
function pushedAndCherryPicked(dir, branch, file, content, msg) {
  pushedUnmerged(dir, branch, file, content, msg);
  git(dir, 'cherry-pick', branch);
  git(dir, 'branch', '-D', branch);
}

function buildTwoPrunable({ dir }) {
  for (const name of ['build/b1', 'build/b2']) {
    pushedAndCherryPicked(dir, name, `${name.replace('/', '-')}.txt`, `${name}\n`, `change ${name}`);
  }
}

// Per-process cache of the squashed variant's shas: a copy whose build was skipped reads it
// here. Set as the build's last statement, so a failed build leaves no entry and the next
// call rebuilds.
const shas = new Map();

function buildSquashed(dirs, name) {
  const { dir } = dirs;
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
  shas.set(name, { preSquash, squash });
}

const VARIANTS = {
  base: () => {},
  merged: ({ dir }) => pushedAndCherryPicked(dir, 'build/merged', 'b.txt', 'b\n', 'change'),
  stale: ({ dir }) => pushedAndCherryPicked(dir, 'build/stale', 'h.txt', 'h\n', 'merged part'),
  'unmerged-and-out-of-scope': ({ dir }) => {
    pushedUnmerged(dir, 'build/unmerged', 'c.txt', 'c\n', 'unmerged');
    git(dir, 'branch', '-D', 'build/unmerged');
    pushedUnmerged(dir, 'feature/out-of-scope', 'd.txt', 'd\n', 'oos');
    git(dir, 'branch', '-D', 'feature/out-of-scope');
  },
  squashed: (dirs) => buildSquashed(dirs, 'squashed'),
  // build/b1 is gone on the origin while the repo's origin/build/b1 tracking ref stays stale.
  'b1-deleted': (dirs) => {
    buildTwoPrunable(dirs);
    git(dirs.origin, 'update-ref', '-d', 'refs/heads/build/b1');
  },
  trunk: ({ dir }) => pushedUnmerged(dir, 'build/trunk', 'g.txt', 'g\n', 'trunk'), // stays a local ref, attached to no worktree
  'origin-head': ({ dir }) => {
    git(dir, 'remote', 'set-head', 'origin', 'main'); // creates the symbolic refs/remotes/origin/HEAD ref
    pushedAndCherryPicked(dir, 'build/merged2', 'f.txt', 'f\n', 'change2');
  },
  worktree: ({ dir, wt }) => {
    pushedUnmerged(dir, 'build/wt', 'e.txt', 'e\n', 'wt');
    git(dir, 'cherry-pick', 'build/wt'); // even cherry-equivalent…
    git(dir, 'worktree', 'add', path.join(wt, 'w'), 'build/wt'); // …but attached to a live worktree
  },
  'two-prunable': buildTwoPrunable,
  reused: ({ dir }) => pushedAndCherryPicked(dir, 'build/reused', 'r.txt', 'r\n', 'change'),
  screened: ({ dir }) => pushedAndCherryPicked(dir, 'build/screened', 's.txt', 's\n', 'change'),
};

const PRUNE_REMOTE_FIXTURES = Object.keys(VARIANTS);

function pruneRemoteFixture(name) {
  if (!Object.hasOwn(VARIANTS, name)) throw new Error(`pruneRemoteFixture: unknown variant "${name}"`);
  const layout = {
    origin: { prefix: 'prune-remote-origin-' },
    dir: { prefix: 'prune-remote-' },
    ...(name === 'worktree' ? { wt: { prefix: 'prune-remote-wt-' } } : {}),
  };
  const out = fromTemplateSet(`prune-remote:${name}`, (dirs) => {
    buildBase(dirs);
    VARIANTS[name](dirs);
  }, layout);
  return name === 'squashed' ? { ...out, ...shas.get(name) } : out;
}

module.exports = { PRUNE_REMOTE_FIXTURES, pruneRemoteFixture, git };
