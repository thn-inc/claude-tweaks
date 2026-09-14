'use strict';
// bin/lib/release-local/bump.js — semver bump derivation over a conventional
// commit list (#2254): breaking marker → major; any feat → minor; any fix →
// patch; nothing releasable → 'none' (the CLI exits 3). The same precedence
// applies on a first release (no prior tag) over the full first-parent history.
function bumpPart(commits) {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  if (commits.some((c) => c.type === 'fix')) return 'patch';
  return 'none';
}

module.exports = { bumpPart };
