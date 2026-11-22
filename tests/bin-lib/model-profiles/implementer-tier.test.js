// tests/bin-lib/model-profiles/implementer-tier.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { POLICY_KEY, RULES, SIZES, keyFileCount, implementerProfile, stepUp } = require('../../../plugin/bin/lib/model-profiles/implementer-tier');

const KF = (...items) => `# T\n\n### Key Files\n\n${items.map((i) => `- ${i}`).join('\n')}\n`;
const COUNTS = [0, 1, 2, 3];

test('constants carry the contract values', () => {
  assert.strictEqual(POLICY_KEY, 'implementer-tier');
  assert.deepStrictEqual(RULES, ['lane', 'record']);
  assert.deepStrictEqual(SIZES, ['low', 'medium', 'high']);
});

test('AC10.1: keyFileCount counts a repeated path once', () => assert.strictEqual(keyFileCount(KF('`a.js` — x', '`a.js` — again', '`b.js`')), 2));
test('AC10.2: keyFileCount is at least 3 for a list naming a directory', () => assert.strictEqual(keyFileCount(KF('`plugin/skills/foo/`')), 3));
test('keyFileCount: a directory beside four files reports 5, never less than the distinct count', () => assert.strictEqual(keyFileCount(KF('`d/`', '`a`', '`b`', '`c`', '`e`')), 5));
test('keyFileCount: a glob entry counts like a directory (plan-review clarification)', () => assert.strictEqual(keyFileCount(KF('`plugin/skills/flow/*.md`')), 3));
test('keyFileCount: a ? wildcard entry counts like a directory', () => assert.strictEqual(keyFileCount(KF('`a/file?.js`')), 3));
test('keyFileCount: a brace-list entry counts like a directory', () => assert.strictEqual(keyFileCount(KF('`bin/lib/{a,b}-health/x.js`')), 3));
test('keyFileCount: a lone brace with no comma is a plain path', () => assert.strictEqual(keyFileCount(KF('`a/{x}.js`', '`b.js`')), 2));
test('keyFileCount: a test file counts like any other path', () => assert.strictEqual(keyFileCount(KF('`tests/x.test.js`', '`a.js`')), 2));
test('AC10.3: keyFileCount is 0 for a body with no Key Files section', () => assert.strictEqual(keyFileCount('# T\n\n## Overview\n\ntext\n'), 0));
test('keyFileCount: bullets with no backticked path count 0', () => assert.strictEqual(keyFileCount(KF('plain words', 'more words')), 0));

for (const count of COUNTS) {
  const expected = count === 1 || count === 2 ? 'fast' : 'standard';
  test(`AC1: record rule, size low, keyFileCount ${count} -> ${expected}`, () => {
    assert.strictEqual(implementerProfile({ size: 'low', keyFileCount: count, rule: 'record' }), expected);
  });
  for (const size of ['medium', 'high', undefined, null]) {
    test(`AC2: record rule, size ${size}, keyFileCount ${count} -> standard`, () => {
      assert.strictEqual(implementerProfile({ size, keyFileCount: count, rule: 'record' }), 'standard');
    });
  }
  for (const [size, profile] of [['low', 'fast'], ['medium', 'standard'], ['high', 'capable']]) {
    test(`AC3: lane rule, size ${size}, keyFileCount ${count} -> ${profile}`, () => {
      assert.strictEqual(implementerProfile({ size, keyFileCount: count, rule: 'lane' }), profile);
    });
  }
  for (const size of [undefined, null]) {
    test(`AC3: lane rule, size ${size}, keyFileCount ${count} -> null`, () => {
      assert.strictEqual(implementerProfile({ size, keyFileCount: count, rule: 'lane' }), null);
    });
  }
}

test('AC4.1: stepUp climbs one rung and stops at capable', () => {
  assert.strictEqual(stepUp('fast'), 'standard');
  assert.strictEqual(stepUp('standard'), 'capable');
  assert.strictEqual(stepUp('capable'), null);
  assert.strictEqual(stepUp('frontier'), null);
  assert.strictEqual(stepUp(null), null);
});
test('AC4.2: stepUp refuses an unknown profile, naming it', () => assert.throws(() => stepUp('huge'), /huge/));
test('AC4.2: stepUp refuses undefined — only null means no profile', () => assert.throws(() => stepUp(undefined), /undefined/));
test('stepUp refuses an inherited object key', () => assert.throws(() => stepUp('toString'), /toString/));

test('AC5.1: an unknown rule throws naming it', () => assert.throws(() => implementerProfile({ size: 'low', keyFileCount: 1, rule: 'sometimes' }), /sometimes/));
test('AC5.1: an unknown size throws naming it', () => assert.throws(() => implementerProfile({ size: 'huge', keyFileCount: 1, rule: 'record' }), /huge/));
test('AC5.1: a negative keyFileCount throws naming it', () => assert.throws(() => implementerProfile({ size: 'low', keyFileCount: -1, rule: 'record' }), /-1/));
for (const [bad, shown] of [[1.5, /1\.5/], ['2', /"2"/], [NaN, /NaN/], [Infinity, /Infinity/], [1n, /keyFileCount 1n/], [Number.MAX_SAFE_INTEGER + 1, /9007199254740992/], [undefined, /undefined/]]) {
  test(`a non-safe-integer keyFileCount (${String(bad)}) throws naming it`, () => {
    assert.throws(() => implementerProfile({ size: 'low', keyFileCount: bad, rule: 'record' }), shown);
  });
}
test('stepUp(NaN) throws naming NaN, not null', () => assert.throws(() => stepUp(NaN), /unknown profile NaN/));
test('a Symbol size throws naming it rather than a TypeError', () => assert.throws(() => implementerProfile({ size: Symbol('x'), keyFileCount: 1, rule: 'record' }), /unknown size Symbol\(x\)/));
test('an array rule is shown as an array, not flattened', () => assert.throws(() => implementerProfile({ size: 'low', keyFileCount: 1, rule: ['lane'] }), /unknown rule \[ 'lane' \]/));
test('an object size is shown as an object', () => assert.throws(() => implementerProfile({ size: {}, keyFileCount: 1, rule: 'record' }), /unknown size \{\}/));
test('a null-prototype size throws the module error, not a TypeError', () => {
  assert.throws(() => implementerProfile({ size: Object.create(null), keyFileCount: 1, rule: 'record' }), (e) => e instanceof Error && !(e instanceof TypeError) && /unknown size/.test(e.message));
});
test('a missing rule throws naming undefined', () => assert.throws(() => implementerProfile({ size: 'low', keyFileCount: 1 }), /unknown rule undefined/));

test('keyFileCount: a nested brace list counts like a directory', () => assert.strictEqual(keyFileCount(KF('`a/{x,{y,z}}.js`')), 3));
test('keyFileCount: unclosed braces are verdict-stable (timing is pinned in perf/)', () => {
  assert.strictEqual(keyFileCount(KF(`\`${'{,'.repeat(50)}\``)), 1);
  assert.strictEqual(keyFileCount(KF(`\`{${','.repeat(50)}\``)), 1);
});
