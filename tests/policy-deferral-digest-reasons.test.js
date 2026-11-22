'use strict';
// #5932: pins the deferral-digest-reasons policy key — a list of Defer-reason
// values validated against DEFER_REASONS, with [] as the explicit empty list
// (a new-key-only capability: the row's `emptyList: true`).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('./helpers/tmp-dir');
const { readText } = require('./helpers/read-skill');

const {
  POLICY_KEYS, LIST_ELEMENT_PATTERNS, EMPTY_LIST_RE, resolvePolicyKeys, auditPolicy, resolvePolicyConfig,
} = require('../plugin/bin/lib/policy-schema');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record-payload');

const KEY = 'deferral-digest-reasons';
const LISTED = 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n';
const REPO_POLICY = path.join(__dirname, '..', '.claude-tweaks', 'policy.yml');

// A throwaway project (outside any git repo) holding the given policy.yml text.
function projectWithPolicy(policyText) {
  const dir = scratchDir('policy-defer-digest-');
  fs.mkdirSync(path.join(dir, '.claude-tweaks'));
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  return dir;
}

function resolveOne(key, opts) {
  const seen = [];
  const out = resolvePolicyKeys([key], { ...opts, onInvalid: (k, raw) => seen.push([k, raw]) });
  return { entry: out[key], seen };
}

test('#5932 defer-reason element accepts exactly the DEFER_REASONS values', () => {
  const re = LIST_ELEMENT_PATTERNS['defer-reason'];
  for (const reason of DEFER_REASONS) assert.ok(re.test(reason), reason);
  for (const bad of ['not-a-reason', 'Tangential', '', ' tangential', 'xtangential', 'tangentialx', '[]', 'tangential|genuinely-larger']) {
    assert.ok(!re.test(bad), JSON.stringify(bad));
  }
});

test('#5932 defer-reason element is built from DEFER_REASONS', () => {
  assert.strictEqual(LIST_ELEMENT_PATTERNS['defer-reason'].source, `^(?:${DEFER_REASONS.join('|')})$`);
});

test('#5932 the row: list, element defer-reason, default [], advanced, set by policy or run config', () => {
  const row = POLICY_KEYS.find((k) => k.key === KEY);
  assert.ok(row, `${KEY} missing from POLICY_KEYS`);
  assert.strictEqual(row.type, 'list');
  assert.strictEqual(row.element, 'defer-reason');
  assert.deepStrictEqual(row.default, []);
  assert.strictEqual(row.emptyList, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(row.category, 'pipeline-behavior');
  assert.ok(!row.policyOnly, 'a run config may set it');
  assert.ok(!row.policySourceExcluded, 'policy.yml may set it');
});

test('#5932 unset resolves the empty default', () => {
  const { entry, seen } = resolveOne(KEY, { policyRaw: 'autonomy: trusted\n' });
  assert.deepStrictEqual(entry, { value: [], source: 'default' });
  assert.deepStrictEqual(seen, []);
});

test('#5932 a valid list resolves to the raw comma-separated string', () => {
  const { entry } = resolveOne(KEY, { policyRaw: LISTED });
  assert.deepStrictEqual(entry, { value: 'pre-existing-outside-diff, tangential', source: 'policy' });
});

test('#5932 AC6.1 an element outside the vocabulary, alone or beside valid reasons, resolves [] and is reported', () => {
  for (const raw of ['not-a-reason', 'pre-existing-outside-diff, not-a-reason', 'Tangential', 'tangential,', '[], tangential']) {
    const { entry, seen } = resolveOne(KEY, { policyRaw: `${KEY}: ${raw}\n` });
    assert.deepStrictEqual(entry, { value: [], source: 'default', invalid: true }, raw);
    assert.deepStrictEqual(seen, [[KEY, raw]], raw);
  }
});

test('#5932 AC6.1 auditPolicy and resolvePolicyConfig report the invalid list, with the return shape unchanged', () => {
  for (const raw of ['not-a-reason', 'pre-existing-outside-diff, not-a-reason']) {
    const dir = projectWithPolicy(`${KEY}: ${raw}\n`);
    const rows = auditPolicy(dir).invalidValues.filter((r) => r.key === KEY);
    assert.strictEqual(rows.length, 1, raw);
    assert.strictEqual(rows[0].value, raw);
    const out = resolvePolicyConfig({
      git: () => { throw new Error('no git'); },
      readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
      keys: [KEY],
      cwd: dir,
    });
    assert.deepStrictEqual(out.result[KEY], { value: [], source: 'default', invalid: true });
    assert.deepStrictEqual(Object.keys(out).sort(), ['factoryOrigin', 'factoryRaw', 'factoryWarnings', 'policyPath', 'policyRaw', 'policySource', 'result', 'root', 'runConfigRaw']);
  }
});

test('#5932 an explicit [] is the empty list, valid, not reported', () => {
  assert.ok(EMPTY_LIST_RE.test('[]'));
  for (const raw of ['[]', '[ ]', '[\t]']) {
    const { entry, seen } = resolveOne(KEY, { policyRaw: `${KEY}: ${raw}\n` });
    assert.deepStrictEqual(entry, { value: [], source: 'policy' }, JSON.stringify(raw));
    assert.deepStrictEqual(seen, [], JSON.stringify(raw));
  }
  const dir = projectWithPolicy(`${KEY}: []\n`);
  assert.deepStrictEqual(auditPolicy(dir).invalidValues.filter((r) => r.key === KEY), []);
});

test('#5932 a row without emptyList keeps [] as its raw string (element-less list)', () => {
  const { entry } = resolveOne('port-services', { policyRaw: 'port-services: []\n' });
  assert.deepStrictEqual(entry, { value: '[]', source: 'policy' });
});

for (const key of ['risk-categories', 'owned-owners', 'trusted-authors']) {
  test(`#5932 [] stays invalid on an element-bearing row without emptyList (${key})`, () => {
    const { entry, seen } = resolveOne(key, { policyRaw: `${key}: []\n` });
    assert.deepStrictEqual(entry, { value: [], source: 'default', invalid: true });
    assert.strictEqual(seen.length, 1);
  });
}

test('#5932 AC7.1 a run config overrides policy.yml (the key is not policyOnly)', () => {
  const { entry } = resolveOne(KEY, { policyRaw: `${KEY}: tangential\n`, runConfigRaw: `${KEY}: genuinely-larger\n` });
  assert.deepStrictEqual(entry, { value: 'genuinely-larger', source: 'run-config' });
});

test('#5932 AC7.2 a run config [] overrides a non-empty policy.yml list', () => {
  const { entry, seen } = resolveOne(KEY, { policyRaw: LISTED, runConfigRaw: `${KEY}: []\n` });
  assert.deepStrictEqual(entry, { value: [], source: 'run-config' });
  assert.deepStrictEqual(seen, []);
});

test('#5932 a blank run-config value reads as unset and falls through to policy.yml', () => {
  const { entry } = resolveOne(KEY, { policyRaw: LISTED, runConfigRaw: `${KEY}:\n` });
  assert.deepStrictEqual(entry, { value: 'pre-existing-outside-diff, tangential', source: 'policy' });
});

test('#5932 AC8 this repository sets the list to pre-existing-outside-diff, tangential, and it resolves valid', () => {
  const { entry, seen } = resolveOne(KEY, { policyRaw: readText(REPO_POLICY) });
  assert.deepStrictEqual(entry, { value: 'pre-existing-outside-diff, tangential', source: 'policy' });
  assert.deepStrictEqual(seen, []);
});

test("#5932 an invalid run-config value never cascades to policy.yml's list", () => {
  const { entry } = resolveOne(KEY, { policyRaw: `${KEY}: tangential\n`, runConfigRaw: `${KEY}: not-a-reason\n` });
  assert.deepStrictEqual(entry, { value: [], source: 'default', invalid: true });
});
