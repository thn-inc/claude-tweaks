'use strict';
// A test that fakes git's output or failure (a mocked child_process.execFileSync,
// a forced timeout) must call isolateRepoInfoCache(t) first: repoInfo answers
// from a per-process memo and a per-user store (#5294), so a remembered answer
// would otherwise stand in for the fake — and the store would carry the fake's
// answer into other tests and processes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resetMemo } = require('../../plugin/bin/lib/hooks/repo-info-cache');

// Points CT_HOOKS_REPO_INFO_STORE at a fresh temp file, clears the memo, and
// restores the env (and removes the temp dir) when the test ends.
function isolateRepoInfoCache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ric-iso-'));
  const prior = process.env.CT_HOOKS_REPO_INFO_STORE;
  process.env.CT_HOOKS_REPO_INFO_STORE = path.join(dir, 'store.json');
  resetMemo();
  t.after(() => {
    if (prior === undefined) delete process.env.CT_HOOKS_REPO_INFO_STORE;
    else process.env.CT_HOOKS_REPO_INFO_STORE = prior;
    resetMemo();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

module.exports = { isolateRepoInfoCache };
