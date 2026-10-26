'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MARKER_LINE,
  UPDATE_METHODS,
  parseMarker,
  serializeMarker,
  appendUpdate,
  resolvePendingCommit,
} = require('../../../plugin/bin/lib/dispatch/close-out-marker');

const H = 'a'.repeat(40);

// A body built from close-out-update.md's template; `extra` overrides field lines.
function TEMPLATE(line2 = 'close-out-update: pending', extra = {}) {
  const f = {
    'update-method': 'merge',
    'conflicted-files': 'a.js',
    'pre-update-head': H,
    'resolution-commit': H,
    ...extra,
  };
  const lines = [MARKER_LINE, line2];
  for (const [key, value] of Object.entries(f)) {
    if (value !== null) lines.push(`${key}: ${value}`);
  }
  lines.push('', 'While this reads `pending`, close-out has pushed an update to this PR.');
  return `${lines.join('\n')}\n`;
}

test('constants carry the contract values', () => {
  assert.equal(MARKER_LINE, '<!-- run-comment: close-out-update -->');
  assert.deepEqual([...UPDATE_METHODS], ['merge', 'gh pr update-branch']);
  assert.ok(Object.isFrozen(UPDATE_METHODS));
});

test('AC1.1: a second line ending in \\r reads pending', () => {
  const body = TEMPLATE();
  const parsed = parseMarker(body.replace('close-out-update: pending', 'close-out-update: pending\r'));
  assert.equal(parsed.status, 'pending');
});

test('a second line with trailing spaces or tabs reads pending, and so does a cleared one', () => {
  assert.equal(parseMarker(TEMPLATE('close-out-update: pending ')).status, 'pending');
  assert.equal(parseMarker(TEMPLATE('close-out-update: pending \t ')).status, 'pending');
  assert.equal(parseMarker(TEMPLATE('close-out-update: cleared (merged) ')).status, 'cleared');
  // leading whitespace is not tolerated: the line is not the recognised status
  assert.equal(parseMarker(TEMPLATE(' close-out-update: pending')).status, 'unreadable');
});

test('trailing spaces after a field value are trimmed from every field', () => {
  const parsed = parseMarker(TEMPLATE('close-out-update: pending', {
    'update-method': 'merge, gh pr update-branch  ',
    'conflicted-files': 'a.js, b/c.md \t',
    'pre-update-head': `${H} `,
    'resolution-commit': `${H}, pending  `,
  }));
  assert.equal(parsed.status, 'pending');
  assert.deepEqual(parsed.updateMethod, ['merge', 'gh pr update-branch']);
  assert.deepEqual(parsed.conflictedFiles, ['a.js', 'b/c.md']);
  assert.equal(parsed.preUpdateHead, H);
  assert.deepEqual(parsed.resolutionCommits, [H, 'pending']);
  assert.deepEqual(parseMarker(TEMPLATE('close-out-update: pending', { 'conflicted-files': 'none ' })).conflictedFiles, []);
});

test('AC1.1: a CRLF body parses every field to the LF values', () => {
  const body = TEMPLATE('close-out-update: pending', {
    'update-method': 'merge, gh pr update-branch',
    'conflicted-files': 'a.js, b/c.md',
    'resolution-commit': `${H}, pending`,
  });
  const lf = parseMarker(body);
  const crlf = parseMarker(body.replace(/\n/g, '\r\n'));
  assert.equal(lf.status, 'pending');
  assert.deepEqual(crlf, lf);
  assert.deepEqual(crlf.updateMethod, ['merge', 'gh pr update-branch']);
  assert.deepEqual(crlf.conflictedFiles, ['a.js', 'b/c.md']);
  assert.equal(crlf.preUpdateHead, H);
  assert.deepEqual(crlf.resolutionCommits, [H, 'pending']);
});

test('AC1.2: an unrecognised second line reads unreadable', () => {
  for (const line2 of ['close-out-update: pnding', 'close-out-update: cleared']) {
    const parsed = parseMarker(TEMPLATE(line2));
    assert.equal(parsed.status, 'unreadable', line2);
    assert.equal(parsed.updateMethod, 'unknown');
    assert.equal(parsed.conflictedFiles, 'unknown');
    assert.equal(parsed.preUpdateHead, 'unknown');
    assert.equal(parsed.resolutionCommits, 'unknown');
  }
});

test('AC1.2: a body whose first line is not the marker, or a non-string body, reads unreadable', () => {
  assert.equal(parseMarker(TEMPLATE().replace(MARKER_LINE, '<!-- run-comment: other -->')).status, 'unreadable');
  assert.equal(parseMarker(`\n${TEMPLATE()}`).status, 'unreadable');
  assert.equal(parseMarker('').status, 'unreadable');
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.equal(parseMarker(bad).status, 'unreadable');
  }
});

test('AC1.3: a non-40-hex pre-update-head reads unknown', () => {
  const cases = ['a'.repeat(39), `${'a'.repeat(39)}g`, '$(rm -rf ~)', 'a'.repeat(41)];
  for (const value of cases) {
    assert.equal(parseMarker(TEMPLATE('close-out-update: pending', { 'pre-update-head': value })).preUpdateHead, 'unknown', value);
  }
  assert.equal(parseMarker(TEMPLATE('close-out-update: pending', { 'pre-update-head': null })).preUpdateHead, 'unknown');
});

test('AC1.3: an uppercase 40-hex pre-update-head comes back lowercased', () => {
  const parsed = parseMarker(TEMPLATE('close-out-update: pending', { 'pre-update-head': 'ABCDEF0123'.repeat(4) }));
  assert.equal(parsed.preUpdateHead, 'abcdef0123'.repeat(4));
});

test('cleared (reason) reads cleared and its fields still parse', () => {
  const parsed = parseMarker(TEMPLATE('close-out-update: cleared (merged)'));
  assert.equal(parsed.status, 'cleared');
  assert.deepEqual(parsed.updateMethod, ['merge']);
  assert.deepEqual(parsed.conflictedFiles, ['a.js']);
  assert.equal(parsed.preUpdateHead, H);
  assert.deepEqual(parsed.resolutionCommits, [H]);
});

test('update-method validates against UPDATE_METHODS', () => {
  const read = (v) => parseMarker(TEMPLATE('close-out-update: pending', { 'update-method': v })).updateMethod;
  assert.deepEqual(read('merge, gh pr update-branch'), ['merge', 'gh pr update-branch']);
  assert.equal(read('rebase'), 'unknown');
  assert.equal(read('merge, rebase'), 'unknown');
  assert.equal(read('merge,,gh pr update-branch'), 'unknown');
});

test('conflicted-files validates', () => {
  const read = (v) => parseMarker(TEMPLATE('close-out-update: pending', { 'conflicted-files': v })).conflictedFiles;
  assert.deepEqual(read('none'), []);
  assert.equal(read('unknown'), 'unknown');
  assert.deepEqual(read('a.js, b/c.md'), ['a.js', 'b/c.md']);
  assert.equal(read('a.js,,b'), 'unknown');
});

test('resolution-commit validates', () => {
  const read = (v) => parseMarker(TEMPLATE('close-out-update: pending', { 'resolution-commit': v })).resolutionCommits;
  assert.deepEqual(read(`${H}, pending`), [H, 'pending']);
  assert.deepEqual(read('pending'), ['pending']);
  assert.deepEqual(read('A'.repeat(40)), [H]);
  assert.equal(read('abc; echo'), 'unknown');
  assert.equal(read(`${H}, abc`), 'unknown');
});

test('a missing field reads unknown, and a field after the blank line is ignored', () => {
  const body = TEMPLATE('close-out-update: pending', { 'update-method': null });
  assert.equal(parseMarker(body).updateMethod, 'unknown');
  const late = `${MARKER_LINE}\nclose-out-update: pending\n\nupdate-method: merge\n`;
  assert.equal(parseMarker(late).updateMethod, 'unknown');
});

test('the first matching field line wins', () => {
  const body = `${MARKER_LINE}\nclose-out-update: pending\nupdate-method: merge\nupdate-method: gh pr update-branch\n`;
  assert.deepEqual(parseMarker(body).updateMethod, ['merge']);
});

test('AC2.1: appending to a pending marker keeps entries oldest first, unions conflicted files and replaces pre-update-head', () => {
  const pending = { updateMethod: ['merge'], conflictedFiles: ['a.js', 'b.js'], preUpdateHead: H, resolutionCommits: [H] };
  const next = appendUpdate(pending, {
    updateMethod: 'gh pr update-branch',
    conflictedFiles: ['b.js', 'c.js'],
    preUpdateHead: 'b'.repeat(40),
    resolutionCommit: 'pending',
  });
  assert.deepEqual(next.updateMethod, ['merge', 'gh pr update-branch']);
  assert.deepEqual(next.conflictedFiles, ['a.js', 'b.js', 'c.js']);
  assert.equal(next.preUpdateHead, 'b'.repeat(40));
  assert.deepEqual(next.resolutionCommits, [H, 'pending']);
  // the input is not mutated
  assert.deepEqual(pending.updateMethod, ['merge']);
  assert.deepEqual(pending.resolutionCommits, [H]);
});

test('appending keeps an unknown field unknown', () => {
  const pending = { updateMethod: 'unknown', conflictedFiles: 'unknown', preUpdateHead: H, resolutionCommits: 'unknown' };
  const next = appendUpdate(pending, {
    updateMethod: 'merge',
    conflictedFiles: ['x.js'],
    preUpdateHead: 'b'.repeat(40),
    resolutionCommit: 'pending',
  });
  assert.equal(next.updateMethod, 'unknown');
  assert.equal(next.conflictedFiles, 'unknown');
  assert.equal(next.resolutionCommits, 'unknown');
  assert.equal(next.preUpdateHead, 'b'.repeat(40));
});

test('appending an unknown conflicted-files update makes the union unknown', () => {
  const pending = { updateMethod: ['merge'], conflictedFiles: ['a.js'], preUpdateHead: H, resolutionCommits: [H] };
  const next = appendUpdate(pending, {
    updateMethod: 'merge',
    conflictedFiles: 'unknown',
    preUpdateHead: H,
    resolutionCommit: H,
  });
  assert.equal(next.conflictedFiles, 'unknown');
});

test('serialize round-trips', () => {
  const appended = appendUpdate(
    { updateMethod: ['merge'], conflictedFiles: ['a.js', 'b.js'], preUpdateHead: H, resolutionCommits: [H] },
    { updateMethod: 'gh pr update-branch', conflictedFiles: ['b.js', 'c.js'], preUpdateHead: 'b'.repeat(40), resolutionCommit: 'pending' },
  );
  const empty = { updateMethod: ['gh pr update-branch'], conflictedFiles: [], preUpdateHead: H, resolutionCommits: ['pending'] };
  const unknown = { updateMethod: 'unknown', conflictedFiles: 'unknown', preUpdateHead: 'unknown', resolutionCommits: 'unknown' };
  for (const f of [appended, empty, unknown]) {
    const text = serializeMarker(f);
    assert.deepEqual(parseMarker(text), { status: 'pending', ...f });
    assert.ok(text.endsWith('\n'));
    assert.ok(text.includes('While this reads `pending`, close-out has pushed an update'));
  }
  assert.ok(serializeMarker(empty).includes('conflicted-files: none\n'));
  assert.ok(serializeMarker(unknown).includes('conflicted-files: unknown\n'));
});

test('serialize emits the template layout: marker, status, four fields, blank line, paragraph', () => {
  const text = serializeMarker({
    updateMethod: ['merge', 'gh pr update-branch'],
    conflictedFiles: ['a.js', 'b.js'],
    preUpdateHead: H,
    resolutionCommits: [H, 'pending'],
  });
  const lines = text.split('\n');
  assert.deepEqual(lines.slice(0, 7), [
    MARKER_LINE,
    'close-out-update: pending',
    'update-method: merge, gh pr update-branch',
    'conflicted-files: a.js, b.js',
    `pre-update-head: ${H}`,
    `resolution-commit: ${H}, pending`,
    '',
  ]);
  assert.equal(lines[7],
    'While this reads `pending`, close-out has pushed an update to this PR whose head had not passed a full-suite verify and CI when it was written; a close-out run from any checkout re-verifies the head before the merge question.');
  assert.deepEqual(lines.slice(8), ['']);
});

test('resolvePendingCommit replaces the last pending entry', () => {
  const sha = 'c'.repeat(40);
  const base = { updateMethod: ['merge'], conflictedFiles: [], preUpdateHead: H };
  const resolved = resolvePendingCommit({ ...base, resolutionCommits: [H, 'pending'] }, sha);
  assert.deepEqual(resolved.resolutionCommits, [H, sha]);
  assert.deepEqual(resolvePendingCommit({ ...base, resolutionCommits: ['pending', 'pending'] }, sha).resolutionCommits, ['pending', sha]);
  assert.equal(resolvePendingCommit({ ...base, resolutionCommits: [H] }, sha), null);
  assert.equal(resolvePendingCommit({ ...base, resolutionCommits: 'unknown' }, sha), null);
});
