'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseCrossRepoDependencies, foreignEntries, bodyOnlyForeign, mergeForeignBlockers,
  stripCrossRepoRefs, buildCrossRepoStateQuery,
} = require('../../../plugin/bin/lib/issues/cross-repo-refs');
const { parseDependencies } = require('../../../plugin/bin/lib/issues/record');

test('Q7 (#4793): parseCrossRepoDependencies lists line-anchored Blocked by owner/name#N refs, qualified, deduped, in order', () => {
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by other/repo#5\nBlocked by #6\nBlocked by Other/Repo#5\nBlocked by acme/w.js#7\n'), ['other/repo#5', 'acme/w.js#7']);
  assert.deepStrictEqual(parseCrossRepoDependencies('see Blocked by other/repo#5 mid-line'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by #5'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by other/repo#5abc'), []);
  assert.deepStrictEqual(parseCrossRepoDependencies(undefined), []);
});
test('Q7: parseDependencies still returns this repository\'s numbers only beside a foreign line', () => {
  assert.deepStrictEqual(parseDependencies('Blocked by other/repo#5\nBlocked by #6'), [6]);
});
test('foreignEntries maps refs to crossRepoBlockers-shaped entries; a missing or non-string state reads null', () => {
  const states = new Map([['other/repo#5', 'OPEN'], ['other/repo#6', 'CLOSED'], ['other/repo#8', 42]]);
  assert.deepStrictEqual(foreignEntries(['Other/Repo#5', 'other/repo#6', 'other/repo#7', 'other/repo#8', 'other/repo#5'], states), [
    { number: 5, repository: 'Other/Repo', state: 'OPEN' }, { number: 6, repository: 'other/repo', state: 'CLOSED' },
    { number: 7, repository: 'other/repo', state: null }, { number: 8, repository: 'other/repo', state: null },
  ]);
});
test('mergeForeignBlockers keeps native entries and adds only body entries native lacks, case-insensitively', () => {
  const native = [{ number: 5, repository: 'other/repo', state: 'OPEN' }];
  const body = [{ number: 5, repository: 'OTHER/repo', state: null }, { number: 7, repository: 'other/repo', state: 'OPEN' }];
  assert.deepStrictEqual(bodyOnlyForeign(native, body), [{ number: 7, repository: 'other/repo', state: 'OPEN' }]);
  assert.deepStrictEqual(mergeForeignBlockers(native, body), [native[0], { number: 7, repository: 'other/repo', state: 'OPEN' }]);
  assert.deepStrictEqual(mergeForeignBlockers(undefined, undefined), []);
});
test('stripCrossRepoRefs removes qualified refs only', () => {
  assert.equal(stripCrossRepoRefs('blocked by other/repo#5 and #7'), 'blocked by  and #7');
  assert.equal(stripCrossRepoRefs('Blocked by #7'), 'Blocked by #7');
});
test('stripCrossRepoRefs strips only refs the parser accepts', () => {
  for (const line of ['Blocked by other/repo#5abc', 'Blocked by foo_bar/baz#5', 'Blocked by my.org/repo#5']) {
    assert.deepStrictEqual(parseCrossRepoDependencies(line), [], `${line}: the parser rejects it`);
    assert.equal(stripCrossRepoRefs(line), line, `${line}: so the strip leaves it`);
  }
  assert.ok(!stripCrossRepoRefs('see github.com/other/repo#5 now').includes('other/repo#5'));
});
test('foreignEntries throws a TypeError on misuse instead of dropping or nulling silently', () => {
  assert.throws(() => foreignEntries('other/repo#5', new Map()), TypeError);
  assert.throws(() => foreignEntries(['other/repo#5'], {}), TypeError);
  assert.throws(() => foreignEntries(['other/repo#5'], undefined), TypeError);
  assert.throws(() => foreignEntries(['not a ref'], new Map()), TypeError);
  assert.deepStrictEqual(foreignEntries([], new Map()), []);
});
test('buildCrossRepoStateQuery: one aliased repository/issue lookup per key, owner and name as String! variables', () => {
  const { query, fields } = buildCrossRepoStateQuery(['other/repo#5', 'acme/w.js#7']);
  assert.match(query, /^query\(\$o0:String!,\$n0:String!,\$o1:String!,\$n1:String!\)\{/);
  assert.match(query, /c0: repository\(owner:\$o0,name:\$n0\)\{ issue\(number:5\)\{ state \} \}/);
  assert.match(query, /c1: repository\(owner:\$o1,name:\$n1\)\{ issue\(number:7\)\{ state \} \}/);
  assert.deepStrictEqual(fields, [['o0', 'other'], ['n0', 'repo'], ['o1', 'acme'], ['n1', 'w.js']]);
  assert.strictEqual(buildCrossRepoStateQuery([]), null);
  assert.throws(() => buildCrossRepoStateQuery(['other/repo#3000000000']));
  assert.throws(() => buildCrossRepoStateQuery(['not a ref']));
});
