'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommitScopeError, parseScopePaths, resolveCommitScope } = require('../../plugin/bin/lib/commit-scope.js');

test('parseScopePaths: splits each entry on the first = and keeps order', () => {
  assert.deepEqual(parseScopePaths(['plugin/bin/=bin', 'plugin/skills/=skills']), [
    { prefix: 'plugin/bin/', token: 'bin' }, { prefix: 'plugin/skills/', token: 'skills' }]);
  assert.deepEqual(parseScopePaths(['a=b=c']), [{ prefix: 'a', token: 'b=c' }]);
  assert.deepEqual(parseScopePaths([]), []);
});

test('parseScopePaths: no =, empty prefix, or empty token throws CommitScopeError naming the entry', () => {
  for (const bad of ['plugin/bin', '=bin', 'plugin/bin/=']) {
    assert.throws(() => parseScopePaths([bad]), (e) => e instanceof CommitScopeError && e.message.includes(JSON.stringify(bad)));
  }
});

test('parseScopePaths trims whitespace around = (a spaced entry is not a silent never-match)', () => {
  assert.deepEqual(parseScopePaths(['plugin/bin/ = bin', ' plugin/skills/=skills ']), [
    { prefix: 'plugin/bin/', token: 'bin' }, { prefix: 'plugin/skills/', token: 'skills' }]);
  assert.equal(resolveCommitScope({
    explicit: null, constant: null, pairs: parseScopePaths(['plugin/bin/ = bin']), changedPaths: ['plugin/bin/x.js'],
  }).scope, 'bin');
});

test('resolveCommitScope: explicit wins over paths and constant', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: 'api', constant: 'web', pairs, changedPaths: ['plugin/bin/x.js'] }), { scope: 'api', source: 'explicit', note: null });
});

test('resolveCommitScope: constant only', () => {
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'web', pairs: [], changedPaths: [] }), { scope: 'web', source: 'constant', note: null });
});

test('resolveCommitScope: single path match; an unmatched path contributes nothing', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['README.md', 'plugin/bin/x.js', 'plugin/bin/lib/y.js'] }), { scope: 'bin', source: 'paths', note: null });
  assert.equal(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['vendor/plugin/bin/x.js'] }).source, 'none');
});

test('AC5.1: resolveCommitScope: the longest matching prefix wins per path', () => {
  const pairs = parseScopePaths(['plugin/=a', 'plugin/bin/=b']);
  assert.equal(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['plugin/bin/x.js'] }).scope, 'b');
  const reversed = parseScopePaths(['plugin/bin/=b', 'plugin/=a']);
  assert.equal(resolveCommitScope({ explicit: null, constant: null, pairs: reversed, changedPaths: ['plugin/bin/x.js'] }).scope, 'b');
});

test('resolveCommitScope: zero matches falls back to constant, else none', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'plugin', pairs, changedPaths: ['README.md'] }), { scope: 'plugin', source: 'constant', note: null });
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['README.md'] }), { scope: null, source: 'none', note: null });
});

test('resolveCommitScope: ambiguous matches fall back with a sorted note — to constant, else unscoped', () => {
  const pairs = parseScopePaths(['plugin/skills/=skills', 'plugin/bin/=bin']);
  const paths = ['plugin/bin/x.js', 'plugin/skills/a.md'];
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'plugin', pairs, changedPaths: paths }), { scope: 'plugin', source: 'constant', note: ['bin', 'skills'] });
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: paths }), { scope: null, source: 'none', note: ['bin', 'skills'] });
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: [...paths].reverse() }).note, ['bin', 'skills']);
});

test('resolveCommitScope: blank explicit/constant are treated as absent', () => {
  assert.deepEqual(resolveCommitScope({ explicit: '  ', constant: '', pairs: [], changedPaths: [] }), { scope: null, source: 'none', note: null });
});

test('two prefixes mapping to the same token resolve to one paths scope with no note', () => {
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs: parseScopePaths(['plugin/bin/=plugin', 'plugin/skills/=plugin']), changedPaths: ['plugin/bin/x.js', 'plugin/skills/a.md'] }), { scope: 'plugin', source: 'paths', note: null });
});

test('empty changedPaths with pairs set falls through to the constant with no note', () => {
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'x', pairs: parseScopePaths(['plugin/bin/=bin']), changedPaths: [] }), { scope: 'x', source: 'constant', note: null });
});
