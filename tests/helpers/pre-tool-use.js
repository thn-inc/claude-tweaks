'use strict';
// Fixtures shared by tests/hooks-pre-tool-use.test.js and
// tests/hooks-pre-tool-use-forge-memo.test.js (the two halves of what was one
// slow file, split so CI can shard them). Not a test file: no `.test.js` suffix.
const { execFileSync } = require('child_process');
const { fromTemplate } = require('./git-template');

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
  const repo = gitRepoWithCommit();
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/o/n.git']);
  return repo;
}

module.exports = { gitRepo, gitRepoWithCommit, GH_TIMEOUT_ENV, withoutGhTimeoutEnv, unpinnedRepoWithOrigin };
