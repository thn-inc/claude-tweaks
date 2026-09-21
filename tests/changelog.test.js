'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compareVersions,
  parseChangelogVersions,
  extractChangelogRange,
  findHeadingDefects,
  findCoverageGaps,
  nextVersion,
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
