'use strict';

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) {
    throw new Error(`Invalid semver version: "${v}"`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a, b) {
  const [aMajor, aMinor, aPatch] = parseVersion(a);
  const [bMajor, bMinor, bPatch] = parseVersion(b);
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

// Two heading grammars, one file. Alternative 1 is this repo's pre-migration form
// (`## vX.Y.Z — {title}`, every entry from v6.128.0 downward); alternatives 2 and 3 are
// release-please's (`## [X.Y.Z](compare-url) (date)`, and `## X.Y.Z (date)` when no repo URL
// is available) — the same pair bin/lib/release-local/changelog.js renders, so both engines
// produce headings this parser can see. A release-please heading carries no free-text title,
// so `title` is '' for those entries; that is an honest value, not a placeholder —
// skills/init/bootstrap/version-check.md synthesizes its notice from {version, title, body}
// and does not require a non-empty title.
//
// Declared once and reused via matchAll (not exec/test in a loop) — matchAll operates on an
// internal clone and never mutates this regex's lastIndex, so reuse across calls is safe.
const HEADER_RE = /^## (?:v(\d+\.\d+\.\d+) — (.+)|\[(\d+\.\d+\.\d+)\]\(\S+\) \(\d{4}-\d{2}-\d{2}\)|(\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\))$/gm;

function parseChangelogVersions(changelogText) {
  const matches = [...changelogText.matchAll(HEADER_RE)];
  return matches.map((match, i) => {
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : changelogText.length;
    return {
      version: match[1] || match[3] || match[4],
      title: match[1] ? match[2].trim() : '',
      body: changelogText.slice(start, end).trim(),
    };
  });
}

function extractChangelogRange(changelogText, oldVersion, newVersion) {
  return parseChangelogVersions(changelogText).filter(
    (entry) =>
      compareVersions(entry.version, oldVersion) > 0 &&
      compareVersions(entry.version, newVersion) <= 0,
  );
}

// Any line that LOOKS like a version heading, however malformed. Deliberately
// looser than HEADER_RE: its whole job is to find headings HEADER_RE rejects.
// A rejected heading is not a parse error anyone sees — it is silently absent
// from parseChangelogVersions, so /init's version notice skips that release
// without a word. `## v4.1` (no title) and `## v4.2 — Token Saver` (two-component
// version) both shipped for months in exactly that state.
const LOOSE_HEADING_RE = /^## v(\S+)(.*)$/gm;
const STRICT_HEADING_RE = /^## v(\d+\.\d+\.\d+) — (.+)$/;

// Headings the parser can't see, and versions documented twice. Both are silent
// failures rather than errors, which is why they need an explicit check.
function findHeadingDefects(changelogText) {
  const unparseable = [];
  for (const match of changelogText.matchAll(LOOSE_HEADING_RE)) {
    if (!STRICT_HEADING_RE.test(match[0])) unparseable.push(match[0].trim());
  }
  const counts = new Map();
  for (const entry of parseChangelogVersions(changelogText)) {
    counts.set(entry.version, (counts.get(entry.version) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([v]) => v);
  return { unparseable, duplicates };
}

// Compare the set of versions that actually shipped against the set the
// changelog documents. `shippedVersions` comes from git (see
// bin/changelog-coverage.js) and is the authority for `missing`; the changelog
// is the authority for nothing — a heading naming a version that never shipped
// is an `orphan`, which is how a concurrent-session version collision shows up
// after the fact.
function findCoverageGaps(shippedVersions, changelogText) {
  // A prerelease build (4.5.0-phase1, 4.5.0-phase2 — both shipped in May 2026)
  // is covered by its base version's entry. It cannot have an entry of its own:
  // HEADER_RE and parseVersion both require a strict X.Y.Z, so a
  // "## v4.5.0-phase1" heading would be invisible to the parser and would make
  // extractChangelogRange throw the moment /init spanned it. Normalizing here
  // keeps that constraint in one place instead of loosening the comparator.
  const base = (v) => String(v).split('-')[0];
  const shipped = new Set(shippedVersions.map(base));
  const documented = new Set(parseChangelogVersions(changelogText).map((e) => e.version));
  return {
    missing: [...shipped].filter((v) => !documented.has(v)),
    orphans: [...documented].filter((v) => !shipped.has(v)),
  };
}

function nextVersion(current, part) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`Invalid semver version: "${current}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (part === 'major') return `${major + 1}.0.0`;
  if (part === 'minor') return `${major}.${minor + 1}.0`;
  if (part === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`part must be "major", "minor" or "patch", got "${part}"`);
}

module.exports = {
  compareVersions,
  parseChangelogVersions,
  extractChangelogRange,
  findHeadingDefects,
  findCoverageGaps,
  nextVersion,
};
