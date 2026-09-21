'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReleaseNotes, RELEASE_NOTE_FOOTER_RE } = require('../../plugin/bin/lib/release-notes.js');

test('renderReleaseNotes: empty commit list returns null', () => {
  assert.strictEqual(renderReleaseNotes([]), null);
});

test('renderReleaseNotes: a whitespace-only releaseNote is treated as absent — no bullet', () => {
  const out = renderReleaseNotes([{ releaseNote: '   ' }]);
  assert.strictEqual(out, null);
});

test('renderReleaseNotes: a mix of commits with and without releaseNote — one bullet per non-empty note, input order preserved, no lines for the rest', () => {
  const commits = [
    { releaseNote: 'Added the thing.' },
    { releaseNote: null },
    { releaseNote: 'Fixed the other thing.' },
    { releaseNote: '' },
    { releaseNote: '  ' },
  ];
  const out = renderReleaseNotes(commits);
  assert.strictEqual(out, '* Added the thing.\n* Fixed the other thing.');
});

test('renderReleaseNotes: each note is trimmed before rendering', () => {
  const out = renderReleaseNotes([{ releaseNote: '  Added the thing.  ' }]);
  assert.strictEqual(out, '* Added the thing.');
});

test('RELEASE_NOTE_FOOTER_RE: matches a Release-Note: footer line and captures its text', () => {
  const body = 'Some body text.\n\nRelease-Note: Fixed the thing.\n\nFixes #1';
  const m = RELEASE_NOTE_FOOTER_RE.exec(body);
  assert.ok(m);
  assert.strictEqual(m[1], 'Fixed the thing.');
});

test('RELEASE_NOTE_FOOTER_RE: does not match a BREAKING CHANGE: footer', () => {
  const body = 'BREAKING CHANGE: something else';
  assert.strictEqual(RELEASE_NOTE_FOOTER_RE.exec(body), null);
});
