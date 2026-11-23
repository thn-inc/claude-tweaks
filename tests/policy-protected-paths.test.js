'use strict';
// #6020: pins the protected-paths policy key — a policyOnly list of root-anchored
// globs (element 'glob'), [] as the explicit empty list, and hashInvalid so an
// inline `#` never cuts the list short.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { scratchDir } = require('./helpers/tmp-dir');

const { POLICY_KEYS, LIST_ELEMENT_PATTERNS, resolvePolicyKeys, auditPolicy } = require('../plugin/bin/lib/policy-schema');
const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');

const KEY = 'protected-paths';
const one = (opts) => resolvePolicyKeys([KEY], opts)[KEY];
const INVALID = { value: [], source: 'default', invalid: true };

test('the row: list, element glob, emptyList, default [], policyOnly, merge-safety, advanced', () => {
  const row = POLICY_KEYS.find((k) => k.key === KEY);
  assert.ok(row, `${KEY} missing from POLICY_KEYS`);
  const { summary, ...rest } = row;
  assert.deepStrictEqual(rest, {
    key: KEY, type: 'list', default: [], element: 'glob', emptyList: true, hashInvalid: true, policyOnly: true, category: 'merge-safety', tier: 'advanced',
  });
  assert.ok(typeof summary === 'string' && summary.length > 0);
});

test('glob element accepts globs and refuses the spellings that would match nothing', () => {
  const re = LIST_ELEMENT_PATTERNS.glob;
  for (const ok of ['infra/**', '**/package.json', '.claude/settings*.json', 'no/such/**', '%2e%2e/x', '/infra/**', './infra/**']) {
    assert.ok(re.test(ok), ok);
  }
  for (const bad of ['["infra/**"]', '""', '', 'a b', 'x?y', '{a', 'a]', 'app/[slug]/**', 'a\\b', "it's"]) {
    assert.ok(!re.test(bad), JSON.stringify(bad));
  }
});

test('AC5.1 (resolver half): a malformed value resolves invalid, never a list', () => {
  for (const v of ['["infra/**"]', 'app/[slug]/**', 'x?y', 'a\\b', 'infra/*.{tf,yml}']) {
    assert.deepStrictEqual(one({ policyRaw: `${KEY}: ${v}\n` }), INVALID, v);
  }
});

test('AC10.1 (resolver half): an empty element is invalid', () => {
  for (const v of ['""', 'infra/**,', 'infra/**, ""']) {
    assert.deepStrictEqual(one({ policyRaw: `${KEY}: ${v}\n` }), INVALID, v);
  }
});

test('an inline # never cuts the list short', () => {
  for (const v of ['**/package.json, docs/#x/**, **/hooks/**/*', 'infra/**#x']) {
    const seen = [];
    const out = resolvePolicyKeys([KEY], { policyRaw: `${KEY}: ${v}\n`, onInvalid: (k, raw, src) => seen.push([k, raw, src]) })[KEY];
    assert.deepStrictEqual(out, INVALID, v);
    assert.strictEqual(seen.length, 1, v);
  }
  assert.deepStrictEqual(one({ policyRaw: `${KEY}: infra/** # ours\n` }), { value: 'infra/**', source: 'policy' });
  // A row without the flag keeps the cut-at-# behaviour.
  assert.deepStrictEqual(
    resolvePolicyKeys(['deferral-digest-reasons'], { policyRaw: 'deferral-digest-reasons: blocked-dependency#x\n' })['deferral-digest-reasons'],
    { value: 'blocked-dependency', source: 'policy' },
  );
});

test('auditPolicy reports an inline-# list as invalid, exactly as the resolver does; a trailing comment is clean', () => {
  const audit = (text) => {
    const dir = scratchDir('policy-protected-paths-audit-');
    fs.mkdirSync(path.join(dir, '.claude-tweaks'));
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), text);
    return auditPolicy(dir).invalidValues.filter((r) => r.key === KEY);
  };
  const bad = audit(`${KEY}: infra/**, docs/#x/**\n`);
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].value, 'infra/**, docs/');
  assert.deepStrictEqual(audit(`${KEY}: infra/** # ours\n`), []);
});

test('AC10.2 (resolver half): a never-matching glob is valid', () => {
  for (const v of ['no/such/**', '/infra/**', './infra/**']) {
    assert.deepStrictEqual(one({ policyRaw: `${KEY}: ${v}\n` }), { value: v, source: 'policy' }, v);
  }
});

test('unset, a list and [] resolve from policy', () => {
  assert.deepStrictEqual(one({ policyRaw: '' }), { value: [], source: 'default' });
  assert.deepStrictEqual(one({ policyRaw: `${KEY}: infra/**, **/package.json\n` }), { value: 'infra/**, **/package.json', source: 'policy' });
  assert.deepStrictEqual(one({ policyRaw: `${KEY}: []\n` }), { value: [], source: 'policy' });
});

test('Review Focus 4: a run config never sets or shrinks the list (policyOnly)', () => {
  assert.deepStrictEqual(one({ policyRaw: '', runConfigRaw: `${KEY}: []\n` }), { value: [], source: 'default' });
  assert.deepStrictEqual(one({ policyRaw: `${KEY}: infra/**\n`, runConfigRaw: `${KEY}: []\n` }), { value: 'infra/**', source: 'policy' });
});

test('policy-schema.md indexes the key', () => {
  const md = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema.md'));
  assert.ok(md.includes('| `protected-paths` |'));
  assert.ok(Buffer.byteLength(md) < RAIL_BYTES, `policy-schema.md is ${Buffer.byteLength(md)} B against ${RAIL_BYTES}`);
});

test('AC6.3: the prose row states root-anchoring, the express-lane consequence, the main-checkout read and Phase 11', () => {
  const shared = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
  const md = readText(path.join(shared, 'policy-schema-express-driver.md'));
  const row = md.split('\n').find((l) => /^\| `protected-paths` \| /.test(l));
  assert.ok(row, 'policy-schema-express-driver.md has no protected-paths row');
  for (const needle of ['root-anchored', '**/package.json', 'case-sensitive', 'on green with no human', 'main checkout', 'Phase 11', 'invalid: true', '`[]`', 'SHIPPED_PROTECTED_PATHS', 'policyOnly']) {
    assert.ok(row.includes(needle), `row lacks ${needle}`);
  }
  const coverage = readText(path.join(shared, 'policy-schema-coverage.md'));
  const bullet = coverage.split('\n').find((l) => l.includes('are `policyOnly`'));
  assert.ok(bullet && bullet.includes('`protected-paths` (#6020)'), 'coverage policyOnly bullet lacks protected-paths');
});
