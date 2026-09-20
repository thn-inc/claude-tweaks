'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextVersion, bumpManifest, stubChangelogEntry, RELEASE_FILES } = require('../../../plugin/bin/lib/release/compose.js');
const { parseChangelogVersions, findHeadingDefects } = require('../../../plugin/bin/lib/changelog.js');

const CHANGELOG_FIXTURE = `# Changelog

Prose header kept verbatim.

## v6.70.1 — Prior release

Body of prior release.

## v6.70.0 — Older release

Older body.
`;

test('nextVersion bumps minor and patch', () => {
  assert.strictEqual(nextVersion('6.70.1', 'minor'), '6.71.0');
  assert.strictEqual(nextVersion('6.70.1', 'patch'), '6.70.2');
  assert.throws(() => nextVersion('not-semver', 'patch'), /Invalid semver/);
});

test('bumpManifest rewrites only the version field and refuses regressions', () => {
  const out = bumpManifest('{\n  "name": "claude-tweaks",\n  "version": "6.70.1"\n}\n', '6.71.0');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.version, '6.71.0');
  assert.strictEqual(parsed.name, 'claude-tweaks');
  assert.ok(out.endsWith('\n'));
  assert.throws(() => bumpManifest(out, '6.70.9'), /not ahead|greater/i);
});

test('stubChangelogEntry inserts a parseable heading before the first entry', () => {
  const out = stubChangelogEntry(CHANGELOG_FIXTURE, '6.71.0', 'Release automation');
  const entries = parseChangelogVersions(out);
  assert.strictEqual(entries[0].version, '6.71.0');
  assert.strictEqual(entries[0].title, 'Release automation');
  assert.strictEqual(entries[1].version, '6.70.1');
  const defects = findHeadingDefects(out);
  assert.deepStrictEqual(defects.unparseable, []);
  assert.deepStrictEqual(defects.duplicates, []);
  assert.ok(out.startsWith('# Changelog\n'), 'prose header survives');
});

test('stubChangelogEntry refuses duplicates and empty summaries', () => {
  assert.throws(() => stubChangelogEntry(CHANGELOG_FIXTURE, '6.70.1', 'Again'), /already/);
  assert.throws(() => stubChangelogEntry(CHANGELOG_FIXTURE, '6.71.0', ''), /summary/i);
});

test('RELEASE_FILES names exactly the same-commit trio', () => {
  assert.deepStrictEqual(RELEASE_FILES, ['plugin/.claude-plugin/plugin.json', 'CHANGELOG.md', 'docs/shipped-versions.tsv']);
});

test('nextVersion: major resets minor and patch', () => {
  assert.strictEqual(nextVersion('6.70.1', 'major'), '7.0.0');
  assert.throws(() => nextVersion('6.70.1', 'huge'), /part must be/);
});
