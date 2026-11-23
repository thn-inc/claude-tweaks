// tests/bin-lib/model-profiles/implementer-tier.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { POLICY_KEY, RULES, SIZES, keyFileCount, implementerProfile, stepUp, startEffort, nextAttempt, TRIGGERS, MAX_ESCALATIONS, EFFORT_CAP } = require('../../../plugin/bin/lib/model-profiles/implementer-tier');

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

const TABLE = { fast: { model: 'haiku', launchEffort: null }, standard: { model: 'sonnet', launchEffort: 'medium' }, capable: { model: 'opus', launchEffort: 'medium' } };
const resolveProfile = (name) => TABLE[name];
const step = (o, over = {}) => nextAttempt({ resolveProfile, ...o, ...over });

test('effort ladder constants', () => {
  assert.deepStrictEqual([...TRIGGERS], ['red-tests', 'fix-round-failed', 'blocked', 'cannot-complete']);
  assert.ok(Object.isFrozen(TRIGGERS));
  assert.strictEqual(MAX_ESCALATIONS, 2);
  assert.strictEqual(EFFORT_CAP, 'high');
});

test('AC1.1: startEffort with launchEffort medium', () => {
  assert.strictEqual(startEffort({ risk: 'low', launchEffort: 'medium' }), 'low');
  assert.strictEqual(startEffort({ risk: 'medium', launchEffort: 'medium' }), 'medium');
  assert.strictEqual(startEffort({ risk: 'high', launchEffort: 'medium' }), 'medium');
  assert.strictEqual(startEffort({ risk: undefined, launchEffort: 'medium' }), 'medium');
  assert.strictEqual(startEffort({ risk: 'critical', launchEffort: 'medium' }), 'medium');
});

test('AC1.2: startEffort with a null launchEffort is null for every risk', () => {
  for (const risk of ['low', 'medium', 'high', undefined]) {
    assert.strictEqual(startEffort({ risk, launchEffort: null }), null);
    assert.strictEqual(startEffort({ risk, launchEffort: undefined }), null);
  }
});

test('AC1.3: startEffort clamps xhigh to high', () => {
  assert.strictEqual(startEffort({ risk: 'high', launchEffort: 'xhigh' }), 'high');
  assert.strictEqual(startEffort({ risk: 'high', launchEffort: 'max' }), 'high');
  assert.strictEqual(startEffort({ risk: 'medium', launchEffort: 'low' }), 'low');
});

test('startEffort refuses an unknown launchEffort', () => {
  assert.throws(() => startEffort({ risk: 'low', launchEffort: 'huge' }), /^Error: implementer-tier: unknown launchEffort "huge"/);
});

test('AC2.1 AC2.2 AC2.3: the red-tests sequence from low', () => {
  const a = step({ profile: 'standard', effort: 'low', escalations: 0, trigger: 'red-tests' });
  assert.deepStrictEqual(a, { profile: 'standard', effort: 'medium', escalations: 1 });
  const b = step({ ...a, trigger: 'red-tests' });
  assert.deepStrictEqual(b, { profile: 'capable', effort: 'medium', escalations: 2 });
  assert.strictEqual(step({ ...b, trigger: 'red-tests' }), null);
});

test('AC3.1: blocked and cannot-complete skip the effort rung', () => {
  for (const trigger of ['blocked', 'cannot-complete']) {
    assert.deepStrictEqual(step({ profile: 'standard', effort: 'low', escalations: 0, trigger }), { profile: 'capable', effort: 'medium', escalations: 1 });
  }
});

test('AC3.2: an effort already at high takes the profile step', () => {
  assert.deepStrictEqual(step({ profile: 'standard', effort: 'high', escalations: 0, trigger: 'red-tests' }), { profile: 'capable', effort: 'medium', escalations: 1 });
});

test('AC3.3: Fast null effort takes the profile step', () => {
  assert.deepStrictEqual(step({ profile: 'fast', effort: null, escalations: 0, trigger: 'red-tests' }), { profile: 'standard', effort: 'medium', escalations: 1 });
});

test('nextAttempt sequence from medium', () => {
  const a = step({ profile: 'standard', effort: 'medium', escalations: 0, trigger: 'fix-round-failed' });
  assert.deepStrictEqual(a, { profile: 'standard', effort: 'high', escalations: 1 });
  const b = step({ ...a, trigger: 'fix-round-failed' });
  assert.deepStrictEqual(b, { profile: 'capable', effort: 'medium', escalations: 2 });
  assert.strictEqual(step({ ...b, trigger: 'fix-round-failed' }), null);
});

test('AC7.1: no rung above high', () => {
  const rp = (n) => (n === 'capable' ? { model: 'opus', launchEffort: 'max' } : TABLE[n]);
  assert.strictEqual(nextAttempt({ profile: 'standard', effort: 'high', escalations: 0, trigger: 'red-tests', resolveProfile: rp }).effort, 'high');
});

test('nextAttempt is null at capable and when the step-up resolves to the same model', () => {
  assert.strictEqual(step({ profile: 'capable', effort: 'medium', escalations: 1, trigger: 'blocked' }), null);
  const same = (n) => (n === 'capable' ? { model: 'sonnet', launchEffort: 'medium' } : TABLE[n]);
  assert.strictEqual(nextAttempt({ profile: 'standard', effort: 'medium', escalations: 1, trigger: 'red-tests', resolveProfile: same }), null);
});

test('nextAttempt refuses bad input with a per-case message', () => {
  const ok = { profile: 'standard', effort: 'low', escalations: 0, trigger: 'red-tests', resolveProfile };
  const cases = [
    [{ trigger: 'red' }, /^Error: implementer-tier: unknown trigger "red"/],
    [{ escalations: 3 }, /^Error: implementer-tier: invalid escalations 3/],
    [{ escalations: -1 }, /^Error: implementer-tier: invalid escalations -1/],
    [{ escalations: 1.5 }, /^Error: implementer-tier: invalid escalations 1\.5/],
    [{ effort: 'extreme' }, /^Error: implementer-tier: unknown effort "extreme"/],
    [{ resolveProfile: undefined }, /^Error: implementer-tier: resolveProfile must be a function/],
    [{ profile: 'bogus' }, /^Error: implementer-tier: unknown profile "bogus"/],
    [{ profile: undefined }, /^Error: implementer-tier: unknown profile undefined/],
  ];
  for (const [bad, re] of cases) assert.throws(() => nextAttempt({ ...ok, ...bad }), re, JSON.stringify(bad));
});

test('an input effort above the cap takes the profile step, never a rung above high', () => {
  for (const effort of ['xhigh', 'max']) {
    assert.deepStrictEqual(step({ profile: 'standard', effort, escalations: 0, trigger: 'red-tests' }), { profile: 'capable', effort: 'medium', escalations: 1 });
  }
});

test('a step-up target with a null launchEffort returns effort null', () => {
  const rp = (n) => (n === 'capable' ? { model: 'opus', launchEffort: null } : TABLE[n]);
  assert.deepStrictEqual(nextAttempt({ profile: 'standard', effort: 'high', escalations: 0, trigger: 'blocked', resolveProfile: rp }), { profile: 'capable', effort: null, escalations: 1 });
});

test('riskOf: exactly one valid value is the risk; zero, several or an invalid one is undefined', () => {
  const { riskOf } = require('../../../plugin/bin/lib/model-profiles/implementer-tier');
  for (const v of ['low', 'medium', 'high']) assert.strictEqual(riskOf([v]), v);
  assert.strictEqual(riskOf([]), undefined);
  assert.strictEqual(riskOf(['high', 'low']), undefined);
  assert.strictEqual(riskOf(['low', 'low']), undefined);
  assert.strictEqual(riskOf(['huge']), undefined);
  assert.strictEqual(riskOf(undefined), undefined);
});
