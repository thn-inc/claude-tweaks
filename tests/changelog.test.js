'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const {
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
} = require('../plugin/bin/lib/changelog.js');

const SAMPLE_CHANGELOG = `# Changelog

## v3.2.0 — Third entry

Third entry body line one.
Third entry body line two.

## v3.1.0 — Second entry

Second entry body.

## v3.0.0 — First entry

First entry body.
`;

test('compareVersions returns 0 for equal versions', () => {
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
});

test('compareVersions returns -1 when the first version is older', () => {
  assert.strictEqual(compareVersions('1.0.0', '2.0.0'), -1);
});

test('compareVersions returns 1 when the first version is newer', () => {
  assert.strictEqual(compareVersions('2.0.0', '1.0.0'), 1);
});

test('compareVersions compares numerically, not lexicographically', () => {
  // Lexicographic string comparison would say "1.10.0" < "1.2.0" (char '1' < '2' at the
  // first differing position) — numerically 1.10.0 > 1.2.0. This proves it isn't a string compare.
  assert.strictEqual(compareVersions('1.2.0', '1.10.0'), -1);
  assert.strictEqual(compareVersions('1.10.0', '1.2.0'), 1);
});

test('compareVersions throws a clear error on a non-semver input', () => {
  assert.throws(() => compareVersions('abc', '1.0.0'), /Invalid semver version/);
});

test('nextVersion bumps minor and patch', () => {
  assert.strictEqual(nextVersion('6.70.1', 'minor'), '6.71.0');
  assert.strictEqual(nextVersion('6.70.1', 'patch'), '6.70.2');
  assert.throws(() => nextVersion('not-semver', 'patch'), /Invalid semver/);
});

test('nextVersion: major resets minor and patch', () => {
  assert.strictEqual(nextVersion('6.70.1', 'major'), '7.0.0');
  assert.throws(() => nextVersion('6.70.1', 'huge'), /part must be/);
});

test('parseChangelogVersions extracts every entry in file order with trimmed bodies', () => {
  const entries = parseChangelogVersions(SAMPLE_CHANGELOG);
  assert.strictEqual(entries.length, 3);
  assert.deepStrictEqual(
    entries.map((e) => e.version),
    ['3.2.0', '3.1.0', '3.0.0'],
  );
  assert.strictEqual(entries[0].title, 'Third entry');
  assert.strictEqual(entries[0].body, 'Third entry body line one.\nThird entry body line two.');
  assert.strictEqual(entries[2].body, 'First entry body.');
});

test('extractChangelogRange excludes the old version and includes the new version', () => {
  const range = extractChangelogRange(SAMPLE_CHANGELOG, '3.0.0', '3.2.0');
  assert.deepStrictEqual(
    range.map((e) => e.version),
    ['3.2.0', '3.1.0'],
  );
});

test('extractChangelogRange returns an empty array when old and new versions match', () => {
  const range = extractChangelogRange(SAMPLE_CHANGELOG, '3.2.0', '3.2.0');
  assert.deepStrictEqual(range, []);
});

test('extractChangelogRange works by pure semver comparison even when the old version has no matching entry in the text', () => {
  const range = extractChangelogRange(SAMPLE_CHANGELOG, '2.5.0', '3.0.0');
  assert.deepStrictEqual(
    range.map((e) => e.version),
    ['3.0.0'],
  );
});

test('extractChangelogRange throws when the old version is malformed (e.g. an empty string from an unreadable marker)', () => {
  assert.throws(() => extractChangelogRange(SAMPLE_CHANGELOG, '', '3.2.0'), /Invalid semver version/);
});

// Frozen fixture, not the real CHANGELOG.md: these assert the checker's
// behavior, and pointing them at live content would turn every future release
// into a test edit. The live file is gated separately, by relationship rather
// than by content, in tests/changelog-coverage.test.js.
const DEFECTIVE_CHANGELOG = `# Changelog

## v4.2 — Two-component version, invisible to the parser

## v4.1

## v4.0.0 — Fine

## v4.0.0 — Documented twice
`;

test('findHeadingDefects reports headings the parser silently drops', () => {
  const { unparseable } = findHeadingDefects(DEFECTIVE_CHANGELOG);
  assert.deepStrictEqual(unparseable, [
    '## v4.2 — Two-component version, invisible to the parser',
    '## v4.1',
  ]);
});

test('findHeadingDefects reports a version documented more than once', () => {
  assert.deepStrictEqual(findHeadingDefects(DEFECTIVE_CHANGELOG).duplicates, ['4.0.0']);
});

test('findHeadingDefects is clean on a well-formed changelog', () => {
  assert.deepStrictEqual(findHeadingDefects(SAMPLE_CHANGELOG), { unparseable: [], duplicates: [] });
});

test('findCoverageGaps separates undocumented shipped versions from headings that never shipped', () => {
  const gaps = findCoverageGaps(['3.0.0', '3.1.0', '3.5.0'], SAMPLE_CHANGELOG);
  assert.deepStrictEqual(gaps.missing, ['3.5.0']);
  assert.deepStrictEqual(gaps.orphans, ['3.2.0']);
});

test('findCoverageGaps counts a prerelease build as covered by its base version entry', () => {
  // 4.5.0-phase1/-phase2 shipped as real builds but cannot carry their own
  // heading — HEADER_RE requires a strict X.Y.Z.
  const gaps = findCoverageGaps(['3.0.0-phase1', '3.0.0'], SAMPLE_CHANGELOG);
  assert.deepStrictEqual(gaps.missing, []);
});

test('findCoverageGaps reports nothing missing when every shipped version is documented', () => {
  assert.deepStrictEqual(findCoverageGaps(['3.0.0', '3.1.0', '3.2.0'], SAMPLE_CHANGELOG), {
    missing: [],
    orphans: [],
  });
});

// A repo that bootstrapped release-please mid-life holds both grammars in one file:
// release-please's machine-generated headings above the boundary, this repo's
// hand-written `## vX.Y.Z — {title}` below it. An entry HEADER_RE rejects is not an
// error anyone sees — it is silently absent from parseChangelogVersions, so /init's
// upgrade notice would skip that release without a word.
const MIXED_GRAMMAR_CHANGELOG = `# Changelog

## [3.4.0](https://github.com/acme/widget/compare/v3.3.0...v3.4.0) (2026-09-22)

### Features

* linked-form body line.

## 3.3.0 (2026-09-21)

### Bug Fixes

* bare-form body line.

## v3.2.0 — Third entry

Third entry body line one.
Third entry body line two.

## v3.1.0 — Second entry

Second entry body.

## v3.0.0 — First entry

First entry body.
`;

test('parseChangelogVersions reads release-please headings in both the linked and bare forms', () => {
  const entries = parseChangelogVersions(MIXED_GRAMMAR_CHANGELOG);
  assert.deepStrictEqual(
    entries.map((e) => e.version),
    ['3.4.0', '3.3.0', '3.2.0', '3.1.0', '3.0.0'],
  );
});

test('a release-please entry carries an empty title, because that grammar has no free-text title', () => {
  const entries = parseChangelogVersions(MIXED_GRAMMAR_CHANGELOG);
  assert.strictEqual(entries[0].title, '');
  assert.strictEqual(entries[1].title, '');
  assert.strictEqual(entries[2].title, 'Third entry', 'the legacy grammar keeps its title');
});

test('a release-please entry body is sliced between headings, exactly as a legacy entry body is', () => {
  const entries = parseChangelogVersions(MIXED_GRAMMAR_CHANGELOG);
  assert.strictEqual(entries[0].body, '### Features\n\n* linked-form body line.');
  assert.strictEqual(entries[1].body, '### Bug Fixes\n\n* bare-form body line.');
  assert.strictEqual(entries[2].body, 'Third entry body line one.\nThird entry body line two.');
});

test('extractChangelogRange filters by semver across a mix of old- and new-grammar entries', () => {
  const range = extractChangelogRange(MIXED_GRAMMAR_CHANGELOG, '3.1.0', '3.4.0');
  assert.deepStrictEqual(
    range.map((e) => e.version),
    ['3.4.0', '3.3.0', '3.2.0'],
  );
  const narrower = extractChangelogRange(MIXED_GRAMMAR_CHANGELOG, '3.2.0', '3.3.0');
  assert.deepStrictEqual(
    narrower.map((e) => e.version),
    ['3.3.0'],
  );
});

test('findHeadingDefects is clean on a mixed-grammar changelog', () => {
  // The loose/strict defect pair scans only the `## v…` family — the hand-written
  // grammar whose typos it exists to catch. A release-please heading starts with
  // `## [` or `## <digit>`, so it is outside that family and must not be reported
  // as unparseable now that HEADER_RE accepts it.
  assert.deepStrictEqual(findHeadingDefects(MIXED_GRAMMAR_CHANGELOG), { unparseable: [], duplicates: [] });
});

// changelog-max-releases (#5563): the trim, its `## Older releases` footer, and
// footer-aware parsing. Fixtures are built programmatically so the 60-section,
// three-grammar file stays readable.
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function sixty() {
  const header = '# Changelog\n\nintro prose\n\n';
  const versions = [];
  const headings = [];
  let body = '';
  for (let i = 0; i < 60; i += 1) {
    const n = 60 - i;
    const version = `1.0.${n}`;
    let heading;
    if (i % 3 === 0) heading = `## v${version} — title ${n}`;
    else if (i % 3 === 1) heading = `## [${version}](https://github.com/o/r/compare/v1.0.${n - 1}...v${version}) (2026-01-01)`;
    else heading = `## ${version} (2026-01-01)`;
    versions.push(version);
    headings.push(heading);
    body += `${heading}\n\n### Features\n\n* change ${n}\n\n`;
  }
  return { text: header + body, header, versions, headings };
}

function footerLine(text, re) {
  const tail = text.slice(parseChangelogFooter(text).index);
  const m = re.exec(tail);
  return m ? m[0] : null;
}

test('AC1.1 AC1.2: trim to 50 of a 60-section, three-grammar file keeps header and newest 50 byte-identical, adds the footer, returns the 10 removed', () => {
  const { text, header, versions, headings } = sixty();
  const r = trimChangelog(text, 50, { sha: SHA_A, repoUrl: 'https://github.com/o/r' });
  assert.ok(r.text.startsWith(header));
  assert.deepStrictEqual(parseChangelogVersions(r.text), parseChangelogVersions(text).slice(0, 50));
  assert.deepStrictEqual(r.removed, versions.slice(50));
  const footer = parseChangelogFooter(r.text);
  assert.ok(footer);
  // Raw bytes: everything before the footer is the original up to the 51st heading,
  // with only the final gap normalised to exactly one blank line.
  const cut = text.indexOf(headings[50]);
  assert.ok(cut > 0);
  assert.strictEqual(r.text.slice(0, footer.index), text.slice(0, cut).trimEnd() + '\n\n');
  assert.strictEqual(r.text.slice(footer.index), renderChangelogFooter({
    version: '1.0.60', sha: SHA_A, newestRemoved: '1.0.10', repoUrl: 'https://github.com/o/r',
  }));
  // Every three-grammar heading kept survives verbatim.
  for (const h of headings.slice(0, 50)) assert.ok(r.text.includes(`${h}\n`), h);
  for (const h of headings.slice(50)) assert.ok(!r.text.includes(h), h);
});

test('AC1.3: a second run on its own output changes nothing', () => {
  const once = trimChangelog(sixty().text, 50, { sha: SHA_A }).text;
  assert.deepStrictEqual(trimChangelog(once, 50), { text: once, removed: [] });
});

test('AC10.1 AC10.2: a ## line HEADER_RE does not match stays inside the section above; it is neither counted nor removed on its own', () => {
  const text = [
    '# Changelog',
    '',
    '## v1.0.3 — c',
    '',
    'body c',
    '',
    '## v1.0.2 — b',
    '',
    '## Notes',
    '',
    'body b',
    '',
    '## v1.0.1 — a',
    '',
    'body a',
    '',
  ].join('\n');
  const r = trimChangelog(text, 2, { sha: SHA_A });
  assert.match(r.text, /^## Notes$/m);
  assert.deepStrictEqual(r.removed, ['1.0.1']);
  assert.strictEqual(parseChangelogVersions(r.text).length, 2);
  assert.match(parseChangelogVersions(r.text)[1].body, /## Notes\n\nbody b$/);
  assert.doesNotMatch(r.text, /body a/);
});

test('AC11.1: the body extractChangelogRange returns for the oldest retained section does not include the footer', () => {
  const t = trimChangelog(sixty().text, 50, { sha: SHA_A }).text;
  const range = extractChangelogRange(t, '0.0.1', '9.9.9');
  assert.strictEqual(range.length, 50);
  assert.doesNotMatch(range[range.length - 1].body, /Older releases|Full file up to/);
  assert.strictEqual(range[range.length - 1].body, '### Features\n\n* change 11');
  const entries = parseChangelogVersions(t);
  assert.strictEqual(entries[entries.length - 1].body, '### Features\n\n* change 11');
});

test('AC6.1 AC6.2: a range starting below the newest removed version is partial; one starting at it is not', () => {
  const { text, versions } = sixty();
  const trimmed = trimChangelog(text, 50, { sha: SHA_A }).text;
  assert.strictEqual(parseChangelogFooter(trimmed).newestRemoved, versions[50]);

  const below = extractChangelogRange(trimmed, '1.0.5', '1.0.60');
  assert.strictEqual(below.length, 50, 'returns the sections it has');
  assert.strictEqual(below.partial, true);
  assert.strictEqual(Object.prototype.propertyIsEnumerable.call(below, 'partial'), false);

  const at = extractChangelogRange(trimmed, versions[50], '1.0.60');
  assert.strictEqual(at.length, 50);
  assert.strictEqual(at.partial, false);

  const above = extractChangelogRange(trimmed, '1.0.30', '1.0.60');
  assert.strictEqual(above.partial, false);

  const footerless = extractChangelogRange(text, '1.0.5', '1.0.60');
  assert.strictEqual(footerless.partial, false);
  assert.strictEqual(footerless.length, 55);
});

test('a later trim rewrites only the Newest release removed line', () => {
  const { text, versions } = sixty();
  const once = trimChangelog(text, 50, { sha: SHA_A, repoUrl: 'https://github.com/o/r' }).text;
  const r2 = trimChangelog(once, 40, { sha: SHA_B, repoUrl: 'https://example.invalid/x' });
  assert.deepStrictEqual(r2.removed, versions.slice(40, 50));
  const f1 = parseChangelogFooter(once);
  const f2 = parseChangelogFooter(r2.text);
  assert.strictEqual(f2.sha, SHA_A);
  assert.strictEqual(f2.version, '1.0.60');
  assert.strictEqual(f2.repoUrl, 'https://github.com/o/r');
  assert.strictEqual(f2.newestRemoved, versions[40]);
  assert.strictEqual(
    r2.text.slice(f2.index),
    once.slice(f1.index).replace(`Newest release removed: v${versions[50]}`, `Newest release removed: v${versions[40]}`),
  );
  // AC8: the recorded commit survives a third trim too.
  const r3 = trimChangelog(r2.text, 30, { sha: SHA_B });
  assert.strictEqual(parseChangelogFooter(r3.text).sha, SHA_A);
  assert.strictEqual(parseChangelogFooter(r3.text).newestRemoved, versions[30]);
  assert.strictEqual(parseChangelogVersions(r3.text).length, 30);
});

test('a later trim inserts the Newest release removed line after the record line when an existing footer lacks it', () => {
  const { text } = sixty();
  const once = trimChangelog(text, 50, { sha: SHA_A }).text;
  const stripped = once.replace(/^Newest release removed: v\d+\.\d+\.\d+\n\n/m, '');
  assert.strictEqual(parseChangelogFooter(stripped).newestRemoved, null);
  const r = trimChangelog(stripped, 40);
  const f = parseChangelogFooter(r.text);
  assert.strictEqual(f.newestRemoved, '1.0.20');
  assert.strictEqual(
    r.text.slice(f.index),
    once.slice(parseChangelogFooter(once).index).replace('v1.0.10', 'v1.0.20'),
  );
});

test('AC15.2: count 1 keeps one section and the footer', () => {
  const r = trimChangelog(sixty().text, 1, { sha: SHA_B });
  assert.strictEqual(parseChangelogVersions(r.text).length, 1);
  assert.strictEqual(r.removed.length, 59);
  assert.ok(parseChangelogFooter(r.text));
});

test('trimChangelog leaves a file within the bound unchanged, with or without a footer, and never adds a footer then', () => {
  assert.deepStrictEqual(trimChangelog(SAMPLE_CHANGELOG, 5), { text: SAMPLE_CHANGELOG, removed: [] });
  assert.deepStrictEqual(trimChangelog(SAMPLE_CHANGELOG, 3, { sha: SHA_A }), { text: SAMPLE_CHANGELOG, removed: [] });
  assert.strictEqual(parseChangelogFooter(SAMPLE_CHANGELOG), null);
  const footered = trimChangelog(sixty().text, 50, { sha: SHA_A }).text;
  assert.deepStrictEqual(trimChangelog(footered, 55, { sha: SHA_B }), { text: footered, removed: [] });
});

test('trimChangelog rejects a count that is not an integer >= 1, and a first trim without a commit sha', () => {
  for (const bad of [0, -1, 1.5, '2', NaN, undefined]) {
    assert.throws(() => trimChangelog(SAMPLE_CHANGELOG, bad), TypeError, String(bad));
  }
  assert.throws(() => trimChangelog(SAMPLE_CHANGELOG, 1), /^Error: trimChangelog: a first trim needs a commit sha$/);
  assert.throws(() => trimChangelog(SAMPLE_CHANGELOG, 1, { sha: 'not-a-sha' }), /trimChangelog: /);
});

test('renderChangelogFooter renders the exact footer, with links only when a repo URL is known', () => {
  const withLinks = renderChangelogFooter({ version: '2.3.4', sha: SHA_A, newestRemoved: '1.9.0', repoUrl: 'https://github.com/o/r' });
  assert.strictEqual(withLinks, [
    FOOTER_HEADING,
    '',
    `Full file up to v2.3.4: commit ${SHA_A}`,
    '',
    'Newest release removed: v1.9.0',
    '',
    `    git show ${SHA_A}:CHANGELOG.md`,
    '',
    'A release removed by a later trim keeps its notes in the file at its own tag, without the Highlights block added after the tag: `git show v<version>:CHANGELOG.md`.',
    '',
    `- [CHANGELOG.md at aaaaaaaaaaaa](https://github.com/o/r/blob/${SHA_A}/CHANGELOG.md)`,
    '- [All releases](https://github.com/o/r/releases)',
    '',
  ].join('\n'));
  assert.strictEqual(FOOTER_HEADING, '## Older releases');
  assert.deepStrictEqual(parseChangelogFooter(`x\n\n${withLinks}`), {
    index: 3, sha: SHA_A, version: '2.3.4', newestRemoved: '1.9.0', repoUrl: 'https://github.com/o/r',
  });
});

test('parseChangelogFooter: no origin → no links; heading without its record line → null', () => {
  const sha64 = 'c'.repeat(64);
  const bare = renderChangelogFooter({ version: '1.0.0', sha: sha64, newestRemoved: '0.9.0', repoUrl: null });
  assert.doesNotMatch(bare, /\]\(/);
  assert.ok(bare.endsWith('git show v<version>:CHANGELOG.md`.\n'));
  const parsed = parseChangelogFooter(bare);
  assert.strictEqual(parsed.repoUrl, null);
  assert.strictEqual(parsed.sha, sha64);
  assert.strictEqual(parsed.index, 0);
  // AC8: a first trim with no origin records the sha and no link.
  const r = trimChangelog(sixty().text, 50, { sha: SHA_A });
  assert.doesNotMatch(r.text.slice(parseChangelogFooter(r.text).index), /\]\(/);
  assert.strictEqual(footerLine(r.text, /^Full file up to .*$/m), `Full file up to v1.0.60: commit ${SHA_A}`);

  assert.strictEqual(parseChangelogFooter('## Older releases\n'), null);
  assert.strictEqual(parseChangelogFooter(`Full file up to v1.0.0: commit ${SHA_A}\n`), null, 'record line without the heading');
  assert.strictEqual(parseChangelogFooter(`## Older releases\n\nFull file up to v1.0.0: commit ${'a'.repeat(39)}\n`), null, 'short sha');
  assert.strictEqual(parseChangelogFooter(`Full file up to v1.0.0: commit ${SHA_A}\n\n## Older releases\n`), null, 'record line above the heading');
  assert.strictEqual(parseChangelogFooter(`### Older releases\n\nFull file up to v1.0.0: commit ${SHA_A}\n`), null);
});

test('an empty repoUrl counts as no origin: no links, and the footer reads back repoUrl null', () => {
  const rendered = renderChangelogFooter({ version: '1.0.0', sha: SHA_A, newestRemoved: '0.9.0', repoUrl: '' });
  assert.doesNotMatch(rendered, /\]\(/);
  assert.strictEqual(parseChangelogFooter(rendered).repoUrl, null);
  const r = trimChangelog(sixty().text, 50, { sha: SHA_A, repoUrl: '' });
  const tail = r.text.slice(parseChangelogFooter(r.text).index);
  assert.doesNotMatch(tail, /\]\(/);
  assert.strictEqual(parseChangelogFooter(r.text).repoUrl, null);
});

test('a ## line in the header that HEADER_RE does not match stays byte-identical through a trim', () => {
  const { text, headings } = sixty();
  const header = '# Changelog\n\n## Unreleased notes\n\nsomething pending\n\n';
  const withStray = text.replace('# Changelog\n\nintro prose\n\n', header);
  const r = trimChangelog(withStray, 50, { sha: SHA_A });
  assert.ok(r.text.startsWith(header));
  assert.strictEqual(r.text.indexOf(headings[0]), header.length);
  assert.strictEqual(r.removed.length, 10);
});

test('a file with no release sections comes back unchanged with no footer', () => {
  const text = '# Changelog\n\nintro\n';
  assert.deepStrictEqual(trimChangelog(text, 1, { sha: SHA_A }), { text, removed: [] });
  assert.deepStrictEqual(trimChangelog(text, 1), { text, removed: [] });
  assert.strictEqual(parseChangelogFooter(text), null);
});

test('trailing spaces on the last kept section\'s last content line (a Markdown hard break) survive the trim', () => {
  const text = [
    '# Changelog',
    '',
    '## v1.0.3 — c',
    '',
    'body c',
    '',
    '## v1.0.2 — b',
    '',
    'line ends with a hard break  ',
    '',
    '## v1.0.1 — a',
    '',
    'body a',
    '',
  ].join('\n');
  const r = trimChangelog(text, 2, { sha: SHA_A });
  const idx = parseChangelogFooter(r.text).index;
  assert.strictEqual(r.text.slice(0, idx), text.slice(0, text.indexOf('## v1.0.1')).replace(/\n+$/, '') + '\n\n');
  assert.ok(r.text.includes('line ends with a hard break  \n\n## Older releases'));
  // A whitespace-only line in the gap is still gap, not content.
  const spacedGap = text.replace('hard break  \n\n## v1.0.1', 'hard break  \n   \n\n## v1.0.1');
  const r2 = trimChangelog(spacedGap, 2, { sha: SHA_A });
  assert.ok(r2.text.includes('line ends with a hard break  \n\n## Older releases'));
});

test('extractChangelogRange with a malformed oldVersion throws no more than before: a footered file with no sections returns [] with partial false', () => {
  const footerOnly = `# Changelog\n\n${renderChangelogFooter({ version: '1.0.5', sha: SHA_A, newestRemoved: '1.0.2', repoUrl: null })}`;
  for (const bad of ['', 'abc', undefined]) {
    const range = extractChangelogRange(footerOnly, bad, '9.9.9');
    assert.deepStrictEqual(range, []);
    assert.strictEqual(range.partial, false);
  }
  // Unchanged: with sections present, a malformed oldVersion still throws (as on the base commit).
  const trimmed = trimChangelog(sixty().text, 50, { sha: SHA_A }).text;
  assert.throws(() => extractChangelogRange(trimmed, '', '9.9.9'), /Invalid semver version/);
  // A valid oldVersion on the footer-only file still computes partial.
  assert.strictEqual(extractChangelogRange(footerOnly, '1.0.1', '9.9.9').partial, true);
});

test('a hand-edited footer with no Newest release removed line: extractChangelogRange does not throw and partial is false', () => {
  const once = trimChangelog(sixty().text, 50, { sha: SHA_A }).text;
  const edited = once.replace(/^Newest release removed: v\d+\.\d+\.\d+\n\n/m, '');
  assert.strictEqual(parseChangelogFooter(edited).newestRemoved, null);
  const range = extractChangelogRange(edited, '1.0.5', '1.0.60');
  assert.strictEqual(range.length, 50);
  assert.strictEqual(range.partial, false);
});

test('a CRLF changelog keeps its one-blank-line gap before the footer, and a CR is gap whitespace', () => {
  const text = '# Changelog\r\n\r\n## v1.0.3 — c\r\n\r\nbody c\r\n\r\n## v1.0.2 — b\r\n\r\nbody b\r\n\r\n## v1.0.1 — a\r\n\r\nbody a\r\n';
  const r = trimChangelog(text, 2, { sha: SHA_A });
  assert.deepStrictEqual(r.removed, ['1.0.1']);
  assert.ok(r.text.includes('body b\n\n## Older releases'), JSON.stringify(r.text.slice(-400, -300)));
  assert.ok(r.text.startsWith('# Changelog\r\n\r\n## v1.0.3 — c\r\n\r\nbody c\r\n\r\n## v1.0.2 — b\r\n\r\nbody b\n\n'));
  // Spaces before a CRLF stay with the content line; only the terminator and the blank lines go.
  const hardBreak = text.replace('body b\r\n', 'body b  \r\n');
  assert.ok(trimChangelog(hardBreak, 2, { sha: SHA_A }).text.includes('body b  \n\n## Older releases'));
});

test('the trim cuts exactly the trailing blank-and-whitespace lines before the footer, on every short LF-only tail', () => {
  // Differential against the plain regex `(?:\n[ \t]*)+$` over every tail of length 1-6 drawn from
  // the gap alphabet (the tail must end in \n so the next heading starts a line).
  const oldCut = (s) => s.replace(/(?:\n[ \t]*)+$/, '');
  const alphabet = [' ', '\t', '\n'];
  let tails = [''];
  let checked = 0;
  for (let len = 1; len <= 6; len += 1) {
    tails = tails.flatMap((t) => alphabet.map((c) => t + c));
    for (const t of tails) {
      const prefix = `# C\n\n## v1.0.2 — b\n\nX${t}\n`;
      const text = `${prefix}## v1.0.1 — a\n`;
      const r = trimChangelog(text, 1, { sha: SHA_A });
      const idx = parseChangelogFooter(r.text).index;
      assert.strictEqual(r.text.slice(0, idx), `${oldCut(prefix)}\n\n`, JSON.stringify(t));
      checked += 1;
    }
  }
  assert.strictEqual(checked, 3 + 9 + 27 + 81 + 243 + 729);
});

test('AC6.3: version-check.md prints the partial flag and tells the reader the summary is partial', () => {
  const text = readText(path.join(__dirname, '..', 'plugin/skills/init/bootstrap/version-check.md'));
  assert.match(text, /partial: r\.partial/);
  assert.match(text, /summary is partial/);
  assert.match(text, /entries: \[\], partial: false/); // the missing-file branch prints the same shape
});
