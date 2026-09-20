'use strict';
const { compareVersions, parseChangelogVersions, findHeadingDefects } = require('../changelog.js');
const { MANIFEST_PATH } = require('../manifest-path.js');

// The manifest moved under `plugin/` with the payload (#418); CHANGELOG.md and the
// shipped-versions record are repo-level documents and stayed at the root.
const RELEASE_FILES = [MANIFEST_PATH, 'CHANGELOG.md', 'docs/shipped-versions.tsv'];

function nextVersion(current, part) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`Invalid semver version: "${current}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`part must be "major", "minor" or "patch", got "${part}"`);
}

function bumpManifest(manifestText, version) {
  const manifest = JSON.parse(manifestText);
  if (compareVersions(version, manifest.version) <= 0) {
    throw new Error(`new version ${version} is not ahead of manifest ${manifest.version}`);
  }
  manifest.version = version;
  return JSON.stringify(manifest, null, 2) + '\n';
}

function stubChangelogEntry(changelogText, version, summary) {
  if (!summary || !String(summary).trim()) throw new Error('summary is required for the changelog stub');
  if (parseChangelogVersions(changelogText).some((e) => e.version === version)) {
    throw new Error(`CHANGELOG already documents v${version}`);
  }
  const firstHeading = changelogText.search(/^## v/m);
  if (firstHeading === -1) throw new Error('CHANGELOG has no version headings to insert before');
  const entry = `## v${version} — ${summary.trim()}\n\n${summary.trim()}.\n\n`;
  const out = changelogText.slice(0, firstHeading) + entry + changelogText.slice(firstHeading);
  const defects = findHeadingDefects(out);
  if (defects.unparseable.length || defects.duplicates.length) {
    throw new Error(`composed CHANGELOG has heading defects: ${JSON.stringify(defects)}`);
  }
  return out;
}

module.exports = { nextVersion, bumpManifest, stubChangelogEntry, RELEASE_FILES };
