'use strict';

// Where this plugin's manifest lives, on both sides of the #418 payload cutover.
//
// The payload moved into `plugin/` so the marketplace can install it as a
// `git-subdir` source. That move is a boundary inside this repo's own history:
// every commit before it carries the manifest at the repo root, every commit
// after it carries it under `plugin/`. Working-tree reads only ever see the new
// path — but anything reading a manifest at an ARBITRARY historical ref (the
// release pre-check's branch reads, the version-bump walk, the post-commit
// release nudge's parent comparison) straddles the boundary and would otherwise
// report a pre-cutover commit as having no manifest, i.e. as never having
// shipped a version.

const MANIFEST_PATH = 'plugin/.claude-plugin/plugin.json';
const LEGACY_MANIFEST_PATH = '.claude-plugin/plugin.json';

// New path first: a repo that has cut over resolves in one read, and the legacy
// path is only paid for on genuinely older history.
const MANIFEST_PATHS = [MANIFEST_PATH, LEGACY_MANIFEST_PATH];

// Try each spelling in turn with the caller's own reader, which may signal
// absence either by throwing (an `execFileSync`-backed `deps.git`) or by
// returning null (the hooks' `runGit`). Returns `{ path, text }` for the first
// spelling that yields anything.
//
// When no spelling resolves, the FIRST error is rethrown rather than the last:
// the new path is what a current checkout should have, so its failure is the one
// that classifies the situation (`does not exist in <ref>` = no manifest here;
// `invalid object name` = the ref itself is bad). Callers downstream key on that
// distinction, and the legacy read's error would blur it.
function readManifestAtRef(read) {
  let firstError = null;
  for (const manifestPath of MANIFEST_PATHS) {
    let text;
    try {
      text = read(manifestPath);
    } catch (err) {
      if (firstError === null) firstError = err;
      continue;
    }
    if (text !== null && text !== undefined) return { path: manifestPath, text };
  }
  if (firstError !== null) throw firstError;
  return { path: MANIFEST_PATH, text: null };
}

// A git error meaning "this path/ref genuinely does not exist" — as opposed to a
// git resolution failure (bad ref, corrupt object) that must not be misread as
// absence. Shared by every reader of a readManifestAtRef-driven git error: the
// release pre-check's worktree-branch absence check.
const NOT_FOUND_ERROR_RE = /does not exist|exists on disk, but not in|invalid object name/i;

// Version at an arbitrary ref, trying both manifest spellings there — every
// caller targets an arbitrary ref (origin/main, local main, a sibling
// worktree's branch, a bump commit or its parent), any of which can predate
// the plugin/ payload move (#418).
function manifestVersionAtRef(deps, ref) {
  return JSON.parse(readManifestAtRef((p) => deps.git(['show', `${ref}:${p}`])).text).version;
}

module.exports = {
  MANIFEST_PATH, LEGACY_MANIFEST_PATH, MANIFEST_PATHS, readManifestAtRef,
  NOT_FOUND_ERROR_RE, manifestVersionAtRef,
};
