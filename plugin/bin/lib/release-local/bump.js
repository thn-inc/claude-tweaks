'use strict';
// bin/lib/release-local/bump.js — semver bump derivation over a conventional
// commit list (#2254): breaking marker → major; any feat → minor; any fix →
// patch; nothing releasable → 'none' (the CLI exits 3). The same precedence
// applies on a first release (no prior tag) over the full first-parent history.
//
// #2327: release-please's `bump-minor-pre-major`/`bump-patch-for-minor-pre-major`
// config keys soften that precedence while the base is still `0.x` — a `0.x`
// line has no public-contract major yet, so a breaking commit there need not
// force a `1.0.0`. `preMajor` (the caller's own determination of whether the
// base version is `0.x`) opts into this; `bumpMinorPreMajor` defaults `true`
// so the softened behavior is the out-of-the-box default, matching this
// record's AC 1. `bumpPatchForMinorPreMajor` defaults `false` — release-please
// itself defaults it off, and flipping it on by default would silently change
// today's plain-`feat`-on-`0.x` outcome (pinned by
// `tests/bin-lib/release-local/acceptance.test.js`'s AC 7 and
// `tests/bin-lib/release-preflight/pack.test.js`'s ruling-12 fixtures, both of
// which bump `0.1.0` + `feat` to `0.2.0`, not `0.1.1`) — so it stays an
// explicit opt-in via `release-please-config.json`.
function bumpPart(commits, opts = {}) {
  const { preMajor = false, bumpMinorPreMajor = true, bumpPatchForMinorPreMajor = false } = opts;
  if (commits.some((c) => c.breaking)) return preMajor && bumpMinorPreMajor ? 'minor' : 'major';
  if (commits.some((c) => c.type === 'feat')) return preMajor && bumpPatchForMinorPreMajor ? 'patch' : 'minor';
  if (commits.some((c) => c.type === 'fix')) return 'patch';
  return 'none';
}

module.exports = { bumpPart };
