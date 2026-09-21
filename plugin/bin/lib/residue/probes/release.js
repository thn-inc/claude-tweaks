// bin/lib/residue/probes/release.js — tag-to-CHANGELOG consistency, generalized
// (#2257) past this repo's own release-please-manifest.json/CHANGELOG/tsv triple:
// every v* tag at or after the project's "bootstrap version" has a matching
// CHANGELOG heading, and vice versa. Runs on any consuming project, not only
// claude-tweaks — the old `manifest.name === 'claude-tweaks'` gate is gone
// entirely, since the check no longer depends on anything claude-tweaks-specific.
'use strict';

const { makeFinding } = require('../finding');

const RP_MANIFEST_PATH = '.release-please-manifest.json';

// Both operands "X.Y.Z" strings — true when a >= b. Deliberately not a full
// semver comparator (no pre-release/build metadata) — v* tags and CHANGELOG
// headings in this codebase's convention are always bare three-part versions.
function versionGte(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return true;
}

// The per-project anchor (Technical Approach): the version
// .release-please-manifest.json held at the commit that FIRST introduced it
// to the repo (unit 3's bootstrap step writing it for the first time). No
// separate marker file — mechanically derived from git history alone. A
// project that never bootstrapped release-please has no anchor, and this
// probe has nothing to check (`ran: false`, not a finding).
function bootstrapVersion(run) {
  const log = run(['git', 'log', '--diff-filter=A', '--format=%H', '--', RP_MANIFEST_PATH]);
  if (log === null) return { sha: null, version: null };
  const shas = log.split('\n').map((s) => s.trim()).filter(Boolean);
  const sha = shas.pop(); // oldest (first-add) commit is last in --format=%H's newest-first order
  if (!sha) return { sha: null, version: null };
  const content = run(['git', 'show', `${sha}:${RP_MANIFEST_PATH}`]);
  let parsed;
  try { parsed = JSON.parse(content); } catch { return { sha, version: null }; }
  if (!parsed || typeof parsed !== 'object') return { sha, version: null };
  // release-please-manifest.json keys by package path. A single-package repo's
  // root manifest is keyed "." — read that when present; otherwise, when
  // there is exactly one key, read its value (a single-package repo whose
  // manifest was bootstrapped with a non-"." path). A genuine multi-package
  // manifest has no single unambiguous anchor, so this probe declines rather
  // than guess which package's version gates the whole repo.
  if (typeof parsed['.'] === 'string') return { sha, version: parsed['.'] };
  const values = Object.values(parsed);
  if (values.length === 1 && typeof values[0] === 'string') return { sha, version: values[0] };
  return { sha, version: null };
}

function probeRelease({ scope, run } = {}) {
  if (!scope || !scope.ran) {
    return { ran: false, reason: (scope && scope.reason) || 'scope unresolved', findings: [] };
  }

  const { sha, version: anchor } = bootstrapVersion(run);
  if (!sha) {
    return { ran: false, reason: `not applicable — ${RP_MANIFEST_PATH} was never added to this repo`, findings: [] };
  }
  if (!anchor) {
    return { ran: false, reason: `could not read a single package version from ${RP_MANIFEST_PATH} at its bootstrap commit ${sha}`, findings: [] };
  }

  const changelog = run(['git', 'show', 'HEAD:CHANGELOG.md']);
  const tagList = run(['git', 'tag', '-l', 'v*']);
  if (changelog === null || tagList === null) {
    return { ran: false, reason: 'could not read CHANGELOG.md or the v* tag list at HEAD', findings: [] };
  }

  const tags = tagList.split('\n').map((t) => t.trim()).filter(Boolean)
    .map((t) => t.replace(/^v/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v) && versionGte(v, anchor));

  // Both heading grammars a post-bootstrap CHANGELOG can hold, since the very
  // entries this probe checks straddle the boundary: the pre-migration
  // `## vX.Y.Z — {summary}` form, and release-please's own
  // `## [X.Y.Z](compare-url) (date)` / `## X.Y.Z (date)` pair (the latter when
  // no repo URL is available) — the same two forms
  // bin/lib/release-local/changelog.js renders and recognizes. Matching only
  // the legacy form would report every real release-please release as a tag
  // with no CHANGELOG entry, permanently.
  const headingRe = /^## (?:v(\d+\.\d+\.\d+) — |\[(\d+\.\d+\.\d+)\]\(\S+\) \(|(\d+\.\d+\.\d+) \()/gm;
  const headings = [];
  let m;
  while ((m = headingRe.exec(changelog))) headings.push(m[1] || m[2] || m[3]);
  const headingsAtOrAfterAnchor = headings.filter((v) => versionGte(v, anchor));

  const tagSet = new Set(tags);
  const headingSet = new Set(headingsAtOrAfterAnchor);
  const findings = [];

  for (const v of tags) {
    if (!headingSet.has(v)) {
      findings.push(makeFinding({
        kind: 'release', scope: 'blast-radius', subject: `CHANGELOG entry for v${v}`, remedy: 'auto',
        evidence: `tag v${v} exists (at or after bootstrap v${anchor}) but CHANGELOG.md at HEAD has no version heading for ${v} in either grammar`,
      }));
    }
  }
  for (const v of headingsAtOrAfterAnchor) {
    if (!tagSet.has(v)) {
      findings.push(makeFinding({
        kind: 'release', scope: 'blast-radius', subject: `tag for CHANGELOG entry v${v}`, remedy: 'auto',
        evidence: `CHANGELOG.md has a version heading for ${v} (at or after bootstrap v${anchor}) but no matching v${v} tag exists`,
      }));
    }
  }
  return { ran: true, reason: null, findings };
}

module.exports = { probeRelease, versionGte, bootstrapVersion, RP_MANIFEST_PATH };
