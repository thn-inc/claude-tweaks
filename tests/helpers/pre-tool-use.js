'use strict';
// Fixtures shared by tests/hooks-pre-tool-use.test.js and
// tests/hooks-pre-tool-use-forge-memo.test.js (the two halves of what was one
// slow file, split so CI can shard them). Not a test file: no `.test.js` suffix.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e1-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  return fs.realpathSync(dir);
}

function gitRepoWithCommit() {
  const dir = gitRepo();
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return dir;
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
