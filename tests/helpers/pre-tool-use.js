'use strict';
// Fixtures shared by tests/hooks-pre-tool-use.test.js and
// tests/hooks-pre-tool-use-forge-memo.test.js (the two halves of what was one
// slow file, split so CI can shard them). Not a test file: no `.test.js` suffix.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fromTemplate, fromTemplateSet } = require('./git-template');

// Both repos are copied from a once-per-process template (#5297): a copy starts
// no git process, where building each one cost an init (and a commit).
function gitRepo() {
  return fromTemplate('pre-tool-use:init', (dir) => {
    execFileSync('git', ['-C', dir, 'init', '-q']);
  }, { prefix: 'ct-e1-', realpath: true });
}

function gitRepoWithCommit() {
  return fromTemplate('pre-tool-use:init-commit', (dir) => {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  }, { prefix: 'ct-e1-', realpath: true });
}

// A template build's first two steps: init, then one empty commit.
function initWithCommit(dir) {
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
}

// The same repo on a local `main`, not the host's init.defaultBranch.
function gitRepoOnLocalMain() {
  return fromTemplate('pre-tool-use:init-commit-main', (dir) => {
    initWithCommit(dir);
    execFileSync('git', ['-C', dir, 'branch', '-M', 'main']);
  }, { prefix: 'ct-e1-', realpath: true });
}

// A main checkout plus one linked worktree of it, copied as a pair (#5324). The worktree add runs
// against the realpath of the template's wtparent, so the recorded gitdir paths are realpath spellings.
function mainAndWorktree({ localMain = false } = {}) {
  const { main, wtparent } = fromTemplateSet(localMain ? 'pre-tool-use:main-wt:local-main' : 'pre-tool-use:main-wt', (dirs) => {
    initWithCommit(dirs.main);
    if (localMain) execFileSync('git', ['-C', dirs.main, 'branch', '-M', 'main']);
    const wt = path.join(fs.realpathSync(dirs.wtparent), 'wt');
    execFileSync('git', ['-C', dirs.main, 'worktree', 'add', '-q', wt, '-b', 'wt-branch-ct-e1-wtparent-template']);
  }, { main: { prefix: 'ct-e1-', realpath: true }, wtparent: { prefix: 'ct-e1-wtparent-', realpath: true } });
  return { main, wt: path.join(wtparent, 'wt') };
}

const GH_TIMEOUT_ENV = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';

// Runs fn with CLAUDE_TWEAKS_GH_TIMEOUT_MS deleted so detection's ladder falls
// to policy / the 5000 ms default, then restores the original value.
function withoutGhTimeoutEnv(fn) {
  const original = process.env[GH_TIMEOUT_ENV];
  delete process.env[GH_TIMEOUT_ENV];
  try {
    return fn();
  } finally {
    if (original !== undefined) process.env[GH_TIMEOUT_ENV] = original;
  }
}

// An unpinned repo whose origin looks like a GitHub remote, so detection reaches the fake `gh`.
function unpinnedRepoWithOrigin() {
  return fromTemplate('pre-tool-use:unpinned-origin', (dir) => {
    initWithCommit(dir);
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/o/n.git']);
  }, { prefix: 'ct-e1-', realpath: true });
}

module.exports = { gitRepo, gitRepoWithCommit, gitRepoOnLocalMain, mainAndWorktree, GH_TIMEOUT_ENV, withoutGhTimeoutEnv, unpinnedRepoWithOrigin };
