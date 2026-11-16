'use strict';
// bin/lib/changelog-release-trim.js — the engine-side CHANGELOG trim procedure (#5563).
// Callers: bin/release-notes-publish.js (pr-first) and bin/release-local.js (local-merge).
// Both hand over the CHANGELOG text they are about to commit; this module reads the
// `changelog-max-releases` key, proves HEAD is on the default branch (the footer's commit
// must stay reachable), resolves the origin URL for the footer links, and trims.
// Never throws: any failure prints one line to `stderr` and returns null, so the release
// finishes with the file untrimmed.

const { readChangelogMaxReleases } = require('./policy');
const { trimChangelog, parseChangelogVersions } = require('./changelog');
const { parseGitHubRemote } = require('./release-local/changelog');

function resolveDefaultRef(git, ancestorRefs) {
  for (const ref of ancestorRefs) {
    try {
      git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`no default branch ref among ${ancestorRefs.join(', ')}`);
}

const firstLine = (message) => String(message).split(/\r?\n/)[0];

function originUrl(git) {
  try {
    const remote = parseGitHubRemote(git(['remote', 'get-url', 'origin']));
    return remote ? remote.url : null;
  } catch {
    return null;
  }
}

// -> { text, count, removed } when the file was trimmed, null otherwise (key 0/absent, within
// the bound, unreadable policy, or any failure — the last two print one line to `stderr`).
function prepareTrim({ text, readPolicy, git, ancestorRefs, stderr, trim = trimChangelog }) {
  const { count, error } = readChangelogMaxReleases(readPolicy);
  if (error != null) {
    stderr(`changelog trim: policy unreadable (${firstLine(error)}); not trimmed\n`);
    return null;
  }
  if (count === 0) return null;
  try {
    // Within the bound the trim would remove nothing: skip every git check, print nothing.
    if (parseChangelogVersions(text).length <= count) return null;
    const sha = git(['rev-parse', 'HEAD']).trim();
    const ref = resolveDefaultRef(git, ancestorRefs);
    try {
      git(['merge-base', '--is-ancestor', '--end-of-options', sha, ref]);
    } catch (err) {
      // --is-ancestor exits 1 for "no" and 128 for a real error.
      if (err && err.status === 1) throw new Error(`${sha} is not an ancestor of ${ref}`);
      throw err;
    }
    const result = trim(text, count, { sha, repoUrl: originUrl(git) });
    if (result.text === text) return null;
    return { text: result.text, count, removed: result.removed };
  } catch (err) {
    stderr(`changelog trim: failed (${firstLine(err.message)}); file left untrimmed\n`);
    return null;
  }
}

module.exports = { prepareTrim, firstLine };
