'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('../helpers/read-skill');
const { renderReleaseNotes, extractReleaseNotes } = require('../../plugin/bin/lib/release-notes.js');
const { parseCommit } = require('../../plugin/bin/lib/release-local/commits.js');
const { parseReleaseNotesFromLog } = require('../../plugin/bin/lib/release-notes-publish.js');

test('renderReleaseNotes: empty commit list returns null', () => {
  assert.strictEqual(renderReleaseNotes([]), null);
});

test('renderReleaseNotes: a whitespace-only release note is treated as absent — no bullet', () => {
  const out = renderReleaseNotes([{ releaseNotes: ['   '] }]);
  assert.strictEqual(out, null);
});

test('renderReleaseNotes: a mix of commits with and without release notes — one bullet per non-empty note, input order preserved, no lines for the rest', () => {
  const commits = [
    { releaseNotes: ['Added the thing.'] },
    { releaseNotes: [] },
    { releaseNotes: ['Fixed the other thing.'] },
    { releaseNotes: [''] },
    { releaseNotes: ['  '] },
  ];
  const out = renderReleaseNotes(commits);
  assert.strictEqual(out, '* Added the thing.\n* Fixed the other thing.');
});

test('renderReleaseNotes: each note is trimmed before rendering', () => {
  const out = renderReleaseNotes([{ releaseNotes: ['  Added the thing.  '] }]);
  assert.strictEqual(out, '* Added the thing.');
});

test('extractReleaseNotes: matches a Release-Note: footer line and captures its text', () => {
  const body = 'Some body text.\n\nRelease-Note: Fixed the thing.\n\nFixes #1';
  assert.deepStrictEqual(extractReleaseNotes(body), ['Fixed the thing.']);
});

test('extractReleaseNotes: does not match a BREAKING CHANGE: footer', () => {
  assert.deepStrictEqual(extractReleaseNotes('BREAKING CHANGE: something else'), []);
});

test('extractReleaseNotes: is stateless across calls (a global regex must not leak lastIndex)', () => {
  const body = 'Release-Note: One.';
  assert.deepStrictEqual(extractReleaseNotes(body), ['One.']);
  assert.deepStrictEqual(extractReleaseNotes(body), ['One.']);
});

test('extractReleaseNotes: an empty Release-Note: line is dropped', () => {
  assert.deepStrictEqual(extractReleaseNotes('Release-Note:\nRelease-Note: Kept.'), ['Kept.']);
});

const THREE = 'feat: x (#10)\n\nRelease-Note: One.\nRelease-Note:   Two.  \nRelease-Note: Three.\n\nFixes #10\nFixes #11\nFixes #12';

test('AC4.1: extractReleaseNotes returns every note from a three-note body, trimmed and in order', () => {
  assert.deepStrictEqual(extractReleaseNotes(THREE), ['One.', 'Two.', 'Three.']);
});

test('AC4.2: extractReleaseNotes returns [] from a body with none, and never matches a BREAKING CHANGE: footer', () => {
  assert.deepStrictEqual(extractReleaseNotes('just a body\n\nBREAKING CHANGE: x\n\nFixes #1'), []);
  assert.deepStrictEqual(extractReleaseNotes(undefined), []);
});

test('AC4.3: parseCommit and parseReleaseNotesFromLog both return all three notes for the same body', () => {
  assert.deepStrictEqual(parseCommit({ sha: 'a'.repeat(40), subject: 'feat: x (#10)', body: THREE }).releaseNotes, ['One.', 'Two.', 'Three.']);
  assert.deepStrictEqual(parseReleaseNotesFromLog(`${'a'.repeat(40)}\x1f${THREE}\x1e`)[0].releaseNotes, ['One.', 'Two.', 'Three.']);
});

test('AC5.1: renderReleaseNotes drops both No user-visible change forms (any case, after trimming) and keeps a note that mentions the phrase later', () => {
  const out = renderReleaseNotes([{ releaseNotes: ['No user-visible change.', 'No user-visible change: fixes Windows-only test failures.', '  no user-visible change — internal.', 'Added X; No user-visible change to Y.'] }]);
  assert.strictEqual(out, '* Added X; No user-visible change to Y.');
});

test('AC5.2: renderReleaseNotes collapses an exact duplicate to one bullet, across commits', () => {
  assert.strictEqual(renderReleaseNotes([{ releaseNotes: ['Added X.', 'Fixed Y.'] }, { releaseNotes: ['Added X.'] }]), '* Added X.\n* Fixed Y.');
});

test('AC5.3: renderReleaseNotes returns null when every note was dropped', () => {
  assert.strictEqual(renderReleaseNotes([{ releaseNotes: ['No user-visible change.'] }, { releaseNotes: [] }, {}]), null);
});

test('neither commits.js nor release-notes-publish.js restates the Release-Note: pattern — both import extractReleaseNotes', () => {
  for (const rel of ['plugin/bin/lib/release-local/commits.js', 'plugin/bin/lib/release-notes-publish.js']) {
    const src = readText(path.join(__dirname, '..', '..', rel));
    assert.match(src, /extractReleaseNotes/, rel);
    assert.ok(!/\/\^?Release-Note:/.test(src), `${rel} declares its own Release-Note: regex literal`);
  }
});
