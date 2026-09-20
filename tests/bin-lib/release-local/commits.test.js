'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommit, readCommits, lastTag, conventionalHistory } = require('../../../plugin/bin/lib/release-local/commits.js');

test('parseCommit: type, scope, description', () => {
  const c = parseCommit({ sha: 'a'.repeat(40), subject: 'fix(deps): bump x', body: '' });
  assert.deepStrictEqual(c, { sha: 'a'.repeat(40), subject: 'fix(deps): bump x', type: 'fix', scope: 'deps', breaking: false, breakingNote: null, description: 'bump x', unconventional: false, releaseNote: null });
});

test('parseCommit: Release-Note footer (conventional path) is captured as releaseNote', () => {
  const c = parseCommit({ sha: 'f'.repeat(40), subject: 'fix: y', body: 'body\n\nRelease-Note: Fixed the thing.' });
  assert.strictEqual(c.releaseNote, 'Fixed the thing.');
});

test('parseCommit: Release-Note footer is captured in the unconventional early-return branch too', () => {
  const c = parseCommit({ sha: 'g'.repeat(40), subject: 'Merge branch x', body: 'Release-Note: Merged the branch.' });
  assert.strictEqual(c.unconventional, true);
  assert.strictEqual(c.releaseNote, 'Merged the branch.');
});

test('parseCommit: a multi-line Release-Note section is truncated to its first line', () => {
  const c = parseCommit({ sha: 'h'.repeat(40), subject: 'feat: z', body: 'Release-Note: First line.\nSecond line that should not appear.' });
  assert.strictEqual(c.releaseNote, 'First line.');
});

test('parseCommit: no Release-Note footer at all returns releaseNote: null', () => {
  const c = parseCommit({ sha: 'i'.repeat(40), subject: 'chore: w', body: 'just a body, no footers' });
  assert.strictEqual(c.releaseNote, null);
});

test('parseCommit: BREAKING CHANGE and Release-Note footers in the same body are each extracted independently, no cross-match', () => {
  const c = parseCommit({ sha: 'j'.repeat(40), subject: 'fix!: v', body: 'BREAKING CHANGE: config key renamed\n\nRelease-Note: Renamed the config key.' });
  assert.strictEqual(c.breakingNote, 'config key renamed');
  assert.strictEqual(c.releaseNote, 'Renamed the config key.');
});

test('parseCommit: ! marker is breaking with the description as its note', () => {
  const c = parseCommit({ sha: 'b'.repeat(40), subject: 'feat!: drop node 16', body: '' });
  assert.strictEqual(c.breaking, true);
  assert.strictEqual(c.breakingNote, 'drop node 16');
});

test('parseCommit: BREAKING CHANGE footer (both spellings) is breaking with the footer text as its note', () => {
  const a = parseCommit({ sha: 'c'.repeat(40), subject: 'fix: y', body: 'body\n\nBREAKING CHANGE: config key renamed' });
  const b = parseCommit({ sha: 'd'.repeat(40), subject: 'fix: y', body: 'BREAKING-CHANGE: hyphen form' });
  assert.strictEqual(a.breakingNote, 'config key renamed');
  assert.strictEqual(b.breakingNote, 'hyphen form');
});

test('parseCommit: an unconventional subject is reported, never dropped, and a breaking footer still counts', () => {
  const c = parseCommit({ sha: 'e'.repeat(40), subject: 'Merge branch x', body: 'BREAKING CHANGE: removed api' });
  assert.strictEqual(c.unconventional, true);
  assert.strictEqual(c.type, null);
  assert.strictEqual(c.breaking, true);
  assert.strictEqual(c.description, 'Merge branch x');
});

test('lastTag: the first-parent v* tag, null when git reports no tag', () => {
  const calls = [];
  const git = (args) => { calls.push(args.join(' ')); return 'v1.2.0\n'; };
  assert.strictEqual(lastTag(git), 'v1.2.0');
  assert.strictEqual(calls[0], 'describe --tags --match v[0-9]* --abbrev=0 --first-parent HEAD');
  const none = () => { throw new Error('fatal: No names found, cannot describe anything.'); };
  assert.strictEqual(lastTag(none), null);
  const boom = () => { throw new Error('fatal: not a git repository'); };
  assert.throws(() => lastTag(boom), /not a git repository/);
});

test('readCommits: parses the record-separated log; the no-tag range is the full first-parent history', () => {
  const calls = [];
  const log = 'x'.repeat(40) + '\x1ffeat: a\x1fbody a\n\x1e\n' + 'y'.repeat(40) + '\x1fchore: b\x1f\x1e\n';
  const git = (args) => { calls.push(args); return log; };
  const commits = readCommits(git, null);
  assert.strictEqual(calls[0][calls[0].length - 1], 'HEAD');
  assert.deepStrictEqual(commits.map((c) => [c.type, c.description]), [['feat', 'a'], ['chore', 'b']]);
  readCommits(git, 'v1.2.0');
  assert.strictEqual(calls[1][calls[1].length - 1], 'v1.2.0..HEAD');
});

test('conventionalHistory: combines lastTag and the range', () => {
  const git = (args) => (args[0] === 'describe' ? 'v1.2.0\n' : 'z'.repeat(40) + '\x1ffix: c\x1f\x1e\n');
  const h = conventionalHistory(git);
  assert.strictEqual(h.lastTag, 'v1.2.0');
  assert.strictEqual(h.commits[0].type, 'fix');
});

test('lastTag/readCommits/conventionalHistory: an explicit ref replaces HEAD in every git call', () => {
  const calls = [];
  const git = (args) => { calls.push(args.join(' ')); return args[0] === 'describe' ? 'v1.2.0\n' : 'z'.repeat(40) + '\x1ffix: c\x1f\x1e\n'; };
  const h = conventionalHistory(git, 'origin/main');
  assert.strictEqual(h.lastTag, 'v1.2.0');
  assert.strictEqual(calls[0], 'describe --tags --match v[0-9]* --abbrev=0 --first-parent origin/main');
  assert.ok(calls[1].endsWith(' v1.2.0..origin/main'), calls[1]);
  readCommits(git, null, 'refs/heads/main');
  assert.ok(calls[2].endsWith(' refs/heads/main'), calls[2]);
});

test('lastTag/readCommits: the default ref is still HEAD', () => {
  const calls = [];
  const git = (args) => { calls.push(args.join(' ')); return args[0] === 'describe' ? 'v1.2.0\n' : ''; };
  lastTag(git); readCommits(git, 'v1.2.0');
  assert.ok(calls[0].endsWith(' HEAD') && calls[1].endsWith(' v1.2.0..HEAD'), calls.join(' | '));
});
