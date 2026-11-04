'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseCrossRepoDependencies, parseCrossRepoRef, crossRepoKey, distinctCrossRepoRefs, foreignEntries, bodyOnlyForeign, mergeForeignBlockers,
  stripCrossRepoRefs, buildCrossRepoStateQuery,
} = require('../../../plugin/bin/lib/issues/cross-repo-refs');
const { parseDependencies, foreignBlockerRef } = require('../../../plugin/bin/lib/issues/record');

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
  // Inputs only the array / Map guards catch: an iterable of valid refs, and a Map look-alike that would answer.
  assert.throws(() => foreignEntries(new Set(['other/repo#5']), new Map()), TypeError);
  assert.throws(() => foreignEntries(['other/repo#5'], { get: () => 'OPEN' }), TypeError);
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
test('crossRepoKey is built from the digit string: every key round-trips through parseCrossRepoRef, and large numbers stay distinct', () => {
  for (const ref of ['huge/repo#1000000000000000000000', 'a/b#9007199254740993', 'a/b#007', 'a/b#0']) {
    const key = crossRepoKey(parseCrossRepoRef(ref));
    assert.ok(!key.includes('e+'), key);
    assert.notStrictEqual(parseCrossRepoRef(key), null, `${ref}: the key ${key} parses`);
    assert.strictEqual(crossRepoKey(parseCrossRepoRef(key)), key, `${ref}: the key is its own fixed point`);
  }
  assert.strictEqual(crossRepoKey(parseCrossRepoRef('Huge/Repo#1000000000000000000000')), 'huge/repo#1000000000000000000000');
  assert.strictEqual(crossRepoKey(parseCrossRepoRef('a/b#007')), 'a/b#7');
  // 2^53 + 1 and 2^53 are one Number apart; their keys are not.
  assert.notStrictEqual(crossRepoKey(parseCrossRepoRef('a/b#9007199254740993')), crossRepoKey(parseCrossRepoRef('a/b#9007199254740992')));
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by a/b#9007199254740993\nBlocked by a/b#9007199254740992\nBlocked by a/b#007\nBlocked by A/B#7'), ['a/b#9007199254740993', 'a/b#9007199254740992', 'a/b#007']);
  // An entry shaped like crossRepoBlockers (a Number only) still keys.
  assert.strictEqual(crossRepoKey({ repository: 'Other/Repo', number: 5 }), 'other/repo#5');
});
test('distinctCrossRepoRefs dedupes by key and answers null for a non-array or any unparseable entry', () => {
  assert.deepStrictEqual(distinctCrossRepoRefs(['a/b#1', 'A/B#1', 'c/d#2']).distinct.map(({ key }) => key), ['a/b#1', 'c/d#2']);
  assert.deepStrictEqual(distinctCrossRepoRefs([]), { distinct: [] });
  assert.throws(() => distinctCrossRepoRefs('a/b#1'), TypeError);
  assert.deepStrictEqual(distinctCrossRepoRefs(['a/b#1', 'nope', 'worse']), { distinct: null, invalid: 'nope' });
  assert.deepStrictEqual(distinctCrossRepoRefs(['a/b#1', '']), { distinct: null, invalid: '' });
});
test('an owner starting with a hyphen neither parses nor strips, so it can never become a leading-- argv element', () => {
  for (const ref of ['--x/y#1', '-x/y#1']) {
    assert.strictEqual(parseCrossRepoRef(ref), null, ref);
    assert.deepStrictEqual(parseCrossRepoDependencies(`Blocked by ${ref}`), [], ref);
    assert.strictEqual(stripCrossRepoRefs(`Blocked by ${ref}`), `Blocked by ${ref}`, ref);
    assert.strictEqual(stripCrossRepoRefs(`x ${ref} y`), `x ${ref} y`, ref);
  }
  assert.deepStrictEqual(parseCrossRepoDependencies('Blocked by x-y/z#1'), ['x-y/z#1']);
  assert.strictEqual(stripCrossRepoRefs('Blocked by x-y/z#1'), 'Blocked by ');
  assert.strictEqual(distinctCrossRepoRefs(['--x/y#1']).distinct, null);
});
test('an oversized body ref keeps its exact digits: a number is a Number only up to 2147483647, the state is always null', () => {
  const [entry] = foreignEntries(['o/r#1000000000000000000000'], new Map([['o/r#1000000000000000000000', 'CLOSED']]));
  assert.deepStrictEqual(entry, { number: '1000000000000000000000', repository: 'o/r', state: null });
  assert.strictEqual(foreignBlockerRef(entry), 'o/r#1000000000000000000000 (state unreadable)');
  // At the boundary the number stays a Number, and its state is read.
  assert.deepStrictEqual(foreignEntries(['o/r#2147483647', 'o/r#2147483648'], new Map([['o/r#2147483647', 'OPEN'], ['o/r#2147483648', 'OPEN']])), [
    { number: 2147483647, repository: 'o/r', state: 'OPEN' }, { number: '2147483648', repository: 'o/r', state: null },
  ]);
  // Two refs above 2^53 are one Number apart but stay two entries, and merge keys them by digits.
  const two = foreignEntries(['o/r#9007199254740993', 'o/r#9007199254740992'], new Map());
  assert.deepStrictEqual(two.map((e) => e.number), ['9007199254740993', '9007199254740992']);
  assert.deepStrictEqual(mergeForeignBlockers([{ number: 5, repository: 'o/r', state: 'OPEN' }], two), [{ number: 5, repository: 'o/r', state: 'OPEN' }, ...two]);
  assert.deepStrictEqual(bodyOnlyForeign(two.slice(0, 1), two), two.slice(1));
});
