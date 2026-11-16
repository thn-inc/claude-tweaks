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

// The `## Older releases` footer a changelog-max-releases trim (#5563) appends after the
// newest N sections. These patterns are the only footer grammar in the plugin — every
// footer reader goes through parseChangelogFooter, never a pattern of its own. The footer
// is the LAST `## Older releases` line that has its record line under it; the record line
// (`Full file up to vX.Y.Z: commit <sha>`) is written by the first trim and never changes,
// while the `Newest release removed:` line is rewritten by every trim that removes a section.
const FOOTER_HEADING = '## Older releases';
const FOOTER_HEADING_RE = /^## Older releases$/gm;
const SHA_PATTERN = '[0-9a-f]{40}|[0-9a-f]{64}';
const FOOTER_SHA_RE = new RegExp(`^(?:${SHA_PATTERN})$`);
const FOOTER_RECORD_RE = new RegExp(`^Full file up to v(\\d+\\.\\d+\\.\\d+): commit (${SHA_PATTERN})$`, 'm');
const FOOTER_NEWEST_RE = /^Newest release removed: v(\d+\.\d+\.\d+)$/m;
const FOOTER_LINK_RE = new RegExp(`^- \\[CHANGELOG\\.md at [0-9a-f]{12}\\]\\((\\S+?)/blob/(?:${SHA_PATTERN})/CHANGELOG\\.md\\)$`, 'm');

function parseChangelogFooter(text) {
  const headings = [...text.matchAll(FOOTER_HEADING_RE)];
  for (let i = headings.length - 1; i >= 0; i -= 1) {
    const index = headings[i].index;
    const tail = text.slice(index);
    const record = FOOTER_RECORD_RE.exec(tail);
    if (!record) continue;
    const newest = FOOTER_NEWEST_RE.exec(tail);
    const link = FOOTER_LINK_RE.exec(tail);
    return {
      index,
      sha: record[2],
      version: record[1],
      newestRemoved: newest ? newest[1] : null,
      repoUrl: link ? link[1] : null,
    };
  }
  return null;
}

function renderChangelogFooter({ version, sha, newestRemoved, repoUrl }) {
  let out = `${FOOTER_HEADING}\n\n`
    + `Full file up to v${version}: commit ${sha}\n\n`
    + `Newest release removed: v${newestRemoved}\n\n`
    + `    git show ${sha}:CHANGELOG.md\n\n`
    + 'A release removed by a later trim keeps its notes in the file at its own tag, without the Highlights block added after the tag: `git show v<version>:CHANGELOG.md`.\n';
  if (repoUrl) {
    out += `\n- [CHANGELOG.md at ${sha.slice(0, 12)}](${repoUrl}/blob/${sha}/CHANGELOG.md)\n`
      + `- [All releases](${repoUrl}/releases)\n`;
  }
  return out;
}

function parseChangelogVersions(changelogText) {
  return entriesBeforeFooter(changelogText, parseChangelogFooter(changelogText));
}

function entriesBeforeFooter(changelogText, footer) {
  const matches = [...changelogText.matchAll(HEADER_RE)];
  return matches.map((match, i) => {
    const start = match.index + match[0].length;
    let end = i + 1 < matches.length ? matches[i + 1].index : changelogText.length;
    // The section the footer follows ends at the footer, so its body never carries it.
    if (footer && footer.index >= start && footer.index < end) end = footer.index;
    return {
      version: match[1] || match[3] || match[4],
      title: match[1] ? match[2].trim() : '',
      body: changelogText.slice(start, end).trim(),
    };
  });
}

// `partial` (non-enumerable, so the array still deep-equals a plain one) is true only when
// a trim removed a version the range can reach: the file carries a footer and oldVersion
// (exclusive) is older than its newest removed version. A malformed oldVersion throws only
// where it always did (from the filter, when the file has sections); with nothing to filter
// it yields [] and partial false, as on the pre-footer code.
function extractChangelogRange(changelogText, oldVersion, newVersion) {
  const footer = parseChangelogFooter(changelogText);
  const range = entriesBeforeFooter(changelogText, footer).filter(
    (entry) =>
      compareVersions(entry.version, oldVersion) > 0 &&
      compareVersions(entry.version, newVersion) <= 0,
  );
  const partial = Boolean(footer && footer.newestRemoved !== null
    && /^\d+\.\d+\.\d+$/.test(String(oldVersion).trim())
    && compareVersions(oldVersion, footer.newestRemoved) < 0);
  Object.defineProperty(range, 'partial', { value: partial, enumerable: false });
  return range;
}

// Keep the header and the newest `count` sections byte-for-byte, drop the rest, and end the
// file with the footer. Only the gap between the last kept section and the footer is
// normalised (one blank line). An existing footer is kept verbatim except its
// `Newest release removed:` line; a first trim renders one and needs the commit sha whose
// CHANGELOG.md still holds the full file.
function trimChangelog(text, count, { sha, repoUrl } = {}) {
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError(`trimChangelog: count must be an integer >= 1, got ${String(count)}`);
  }
  const footer = parseChangelogFooter(text);
  const bodyEnd = footer ? footer.index : text.length;
  const sections = [...text.matchAll(HEADER_RE)].filter((m) => m.index < bodyEnd);
  if (sections.length <= count) return { text, removed: [] };

  const versionOf = (m) => m[1] || m[3] || m[4];
  const removed = sections.slice(count).map(versionOf);
  const newestLine = `Newest release removed: v${removed[0]}`;

  let footerText;
  if (footer) {
    footerText = text.slice(footer.index);
    footerText = FOOTER_NEWEST_RE.test(footerText)
      ? footerText.replace(FOOTER_NEWEST_RE, newestLine)
      : footerText.replace(FOOTER_RECORD_RE, (line) => `${line}\n\n${newestLine}`);
  } else {
    if (!sha) throw new Error('trimChangelog: a first trim needs a commit sha');
    if (!FOOTER_SHA_RE.test(sha)) {
      throw new Error(`trimChangelog: sha must be a 40- or 64-character lowercase hex commit id, got "${sha}"`);
    }
    footerText = renderChangelogFooter({
      version: versionOf(sections[0]),
      sha,
      newestRemoved: removed[0],
      repoUrl: repoUrl || null,
    });
  }

  const kept = cutTrailingGap(text.slice(0, sections[count].index));
  return { text: `${kept}\n\n${footerText}`, removed };
}

// Drop the trailing gap: the last content line's terminator (LF or CRLF) and every
// whitespace-only line after it. Spaces and tabs ending the last content line (a Markdown
// hard break) are section bytes and stay. One backward pass with no regex — a regex for the
// run restarts at every newline of a run in the middle of the text (quadratic, #5563).
function cutTrailingGap(s) {
  let cut = s.length;
  let i = s.length;
  while (i > 0) {
    const c = s[i - 1];
    if (c === '\n') cut = i - 1;
    else if (c !== ' ' && c !== '\t' && c !== '\r') break;
    i -= 1;
  }
  if (cut < s.length && s[cut - 1] === '\r') cut -= 1;
  return s.slice(0, cut);
}

// Any line that LOOKS like a `## v...` version heading, however malformed —
// deliberately looser than HEADER_RE's first alternative, to catch headings
// that alternative rejects. A rejected heading is not a parse error anyone
// sees — it is silently absent from parseChangelogVersions, so /init's
// version notice skips that release without a word. `## v4.1` (no title) and
// `## v4.2 — Token Saver` (two-component version) both shipped for months in
// exactly that state.
//
// Covers only the `## v...` family, not HEADER_RE's release-please
// alternatives (`## [X.Y.Z](...)`, `## X.Y.Z (date)`) — a malformed
// release-please heading (e.g. a two-component `## 6.12 (date)`) is
// currently invisible to both HEADER_RE and this detector. Left uncovered
// deliberately: release-please generates these headings mechanically, so the
// human-typo failure mode this pair exists to catch can't occur in that
// family. Revisit if that assumption stops holding (e.g. a hand-edited
// release-please entry).
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
  FOOTER_HEADING,
  parseChangelogFooter,
  renderChangelogFooter,
  trimChangelog,
};
