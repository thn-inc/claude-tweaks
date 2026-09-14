// plugin/bin/lib/repo-resolve.js — shared owner/repo resolution for the
// single-invocation gh-api CLI wrappers under bin/, factored out of
// apply-refine-labels.js, fetch-sub-issues.js, and resolve-blockers.js,
// which each hand-rolled an identical parseRepo/ghAvailable/remoteUrl trio
// (review finding: these three newest CLIs brought the total to 9
// independent copies of the same owner/repo regex across the codebase). The
// six pre-existing copies (link-records.js, release-claim.js,
// preflight-records.js, file-feedback.js, materialize.js, claims.js) have
// since migrated to this module too (#1177) — this is now the one parseRepo
// definition in the codebase. ghAvailable is the injectable, canonical
// `gh --version` probe (the six-call-site consolidation).
'use strict';
const { execFileSync } = require('child_process');

// A GitHub remote URL (SSH or HTTPS, with or without .git, or an
// `owner/name` string wrapped as `github.com/owner/name` by a caller) ->
// { owner, repo }, or null when it doesn't match.
function parseRepo(url) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

// gh-api-module-pattern: bound every remote-contacting call on the seam.
// --version is local-only, but the bound is free and keeps this the one
// options object every call site below now shares.
const GH_TIMEOUT_MS = 5000;

function ghAvailable(deps = {}) {
  const exec = deps.execFileSync || execFileSync;
  try {
    exec('gh', ['--version'], { stdio: 'ignore', timeout: GH_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

function remoteUrl() {
  return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
}

module.exports = { parseRepo, ghAvailable, remoteUrl };
