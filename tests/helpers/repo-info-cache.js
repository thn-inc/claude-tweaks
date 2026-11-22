'use strict';
// A test that fakes git's output or failure (a mocked child_process.execFileSync,
// a forced timeout) must call isolateRepoInfoCache(t) first: repoInfo answers
// from a per-process memo and a per-user store (#5294), so a remembered answer
// would otherwise stand in for the fake — and the store would carry the fake's
// answer into other tests and processes.
const fs = require('fs');
const { scratchDir } = require('./tmp-dir');
const os = require('os');
const path = require('path');
const { resetMemo } = require('../../plugin/bin/lib/hooks/repo-info-cache');

// Any of these in the env bypasses the store, so a launching environment that
// sets one would make "nothing was written to the store" pass for that reason
// alone. They are removed for the test and restored after.
const DISCOVERY_ENV_NAMES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'];

// Points CT_HOOKS_REPO_INFO_STORE at a fresh temp file, removes the git
// discovery variables, clears the memo, and restores the env (and removes the
// temp dir) when the test ends.
function isolateRepoInfoCache(t) {
  const dir = scratchDir('ct-ric-iso-');
  const names = ['CT_HOOKS_REPO_INFO_STORE', ...DISCOVERY_ENV_NAMES];
  const prior = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  process.env.CT_HOOKS_REPO_INFO_STORE = path.join(dir, 'store.json');
  for (const n of DISCOVERY_ENV_NAMES) delete process.env[n];
  resetMemo();
  t.after(() => {
    for (const n of names) {
      if (prior[n] === undefined) delete process.env[n];
      else process.env[n] = prior[n];
    }
    resetMemo();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

module.exports = { isolateRepoInfoCache };
