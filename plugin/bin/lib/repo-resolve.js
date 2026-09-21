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
const { GH_TIMEOUT_MS } = require('./shared-primitives');

// A git remote URL (SSH or HTTPS, with or without .git, on github.com or an
// arbitrary GitHub Enterprise Server host, or an `owner/name` string wrapped
// as `{host}/owner/name` by a caller) -> { host, owner, repo }, or null when
// it doesn't match. `host` defaults to matching whatever host segment is
// present in the URL -- callers that only destructure { owner, repo } are
// unaffected by the added field.
function parseRepo(url) {
  const m = /^(?:[a-zA-Z0-9._-]+@)?(?:https?:\/\/)?([a-zA-Z0-9.-]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
    String(url || '').trim()
  );
  return m ? { host: m[1], owner: m[2], repo: m[3] } : null;
}

// gh-api-module-pattern: bound every remote-contacting call on the seam.
// --version is local-only, but the bound is free and keeps this the one
// options object every call site below now shares. #2567: shared, not a
// local re-derivation of the same 5000 default, so a project's
// `gh-timeout-ms` policy override (or CLAUDE_TWEAKS_GH_TIMEOUT_MS env
// override) reaches this call too.
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

// A parseRepo result (or any { host, owner, repo }) -> the slug `gh --repo`
// takes: bare `owner/repo` on github.com, host-qualified `host/owner/repo` on
// a GitHub Enterprise Server host. A missing host reads as github.com, so a
// caller threading an optional host through needs no guard of its own.
function repoSlug({ host, owner, repo }) {
  return host && host !== 'github.com' ? `${host}/${owner}/${repo}` : `${owner}/${repo}`;
}

// #2538 Deliverable 3: "print the derived repo so a mismatch is visible to
// the operator" — but only when there's something an operator would
// actually need to double-check. On plain github.com (the overwhelming
// common case, and every existing CLI's own "success path writes nothing to
// stderr" test fixture) this returns null and callers print nothing,
// preserving that established silence-on-success convention; a resolved
// GitHub Enterprise Server host is the one case worth a visible note, since
// it's also the one case a caller's own gh call could silently resolve
// against the wrong repo/host if the derivation guessed wrong.
function repoResolutionNote(repoSpec) {
  if (!repoSpec || !repoSpec.host || repoSpec.host === 'github.com') return null;
  return `resolved repo ${repoSlug(repoSpec)} (host: ${repoSpec.host})`;
}

module.exports = {
  parseRepo, ghAvailable, remoteUrl, repoSlug, repoResolutionNote,
};
