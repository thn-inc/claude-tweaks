'use strict';
// Record #5161 — the ci-health billing and repo fixtures carry synthetic values over
// field names probed live (org budgets, org usage summary, repo read) or, for the user
// usage endpoint the token cannot read, taken from GitHub's REST docs. These tests keep
// every fixture inside its probed key set, keep the fields the headroom and superseded
// formulas read present, and keep real owner names out of the fixtures.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', '..', 'fixtures', 'ci-health');
const load = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));

// Every key path, intermediate ones included (the shape `jq paths` lists), with `[]`
// standing in for any array index.
function keyPaths(json) {
  const out = new Set();
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        out.add(`${prefix}[]`);
        walk(item, `${prefix}[]`);
      }
    } else if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const p = prefix === '' ? key : `${prefix}.${key}`;
        out.add(p);
        walk(value[key], p);
      }
    }
  };
  walk(json, '');
  return out;
}

const REPO_KEYS = ['full_name', 'default_branch', 'owner', 'owner.login', 'owner.type'];

const PROBED_KEYS = {
  'org-budgets.json': [
    'budgets', 'budgets[]',
    'budgets[].id', 'budgets[].budget_type', 'budgets[].budget_product_sku',
    'budgets[].budget_scope', 'budgets[].budget_amount', 'budgets[].prevent_further_usage',
    'budgets[].budget_entity_name', 'budgets[].budget_alerting',
    'budgets[].budget_alerting.will_alert', 'budgets[].budget_alerting.alert_recipients',
    'budgets[].budget_alerting.alert_recipients[]',
    'has_next_page', 'total_count',
  ],
  'org-usage-summary.json': [
    'organization', 'timePeriod', 'timePeriod.year', 'timePeriod.month',
    'usageItems', 'usageItems[]',
    'usageItems[].product', 'usageItems[].sku', 'usageItems[].unitType',
    'usageItems[].pricePerUnit', 'usageItems[].grossQuantity', 'usageItems[].grossAmount',
    'usageItems[].discountQuantity', 'usageItems[].discountAmount',
    'usageItems[].netQuantity', 'usageItems[].netAmount',
  ],
  'user-usage.json': [
    'usageItems', 'usageItems[]',
    'usageItems[].date', 'usageItems[].product', 'usageItems[].sku', 'usageItems[].quantity',
    'usageItems[].unitType', 'usageItems[].pricePerUnit', 'usageItems[].grossAmount',
    'usageItems[].discountAmount', 'usageItems[].netAmount', 'usageItems[].repositoryName',
  ],
  'repo-org.json': REPO_KEYS,
  'repo-user.json': REPO_KEYS,
};

const FORMULA_KEYS = {
  'org-budgets.json': ['budgets[].budget_amount', 'budgets[].budget_product_sku', 'budgets[].budget_scope'],
  'org-usage-summary.json': ['usageItems[].product', 'usageItems[].netAmount'],
  'user-usage.json': ['usageItems[].product', 'usageItems[].netAmount'],
  'repo-org.json': ['owner.type', 'default_branch'],
  'repo-user.json': ['owner.type', 'default_branch'],
};

// Both the key check and the leak scan below iterate PROBED_KEYS, so a new fixture fails here
// until it joins that closed set.
test('every ci-health JSON fixture is in PROBED_KEYS, and every PROBED_KEYS entry is a fixture', () => {
  const onDisk = fs.readdirSync(FIX).filter((name) => name.endsWith('.json')).sort();
  assert.deepStrictEqual(onDisk, Object.keys(PROBED_KEYS).sort());
});

for (const name of Object.keys(PROBED_KEYS)) {
  test(`${name}: key paths stay inside the probed set and carry the formula fields`, () => {
    const paths = keyPaths(load(name));
    const allowed = new Set(PROBED_KEYS[name]);
    const unprobed = [...paths].filter((p) => !allowed.has(p));
    assert.deepStrictEqual(unprobed, [], `${name} has key paths no probe or doc listed`);
    for (const key of FORMULA_KEYS[name]) {
      assert.ok(paths.has(key), `${name} is missing formula field ${key}`);
    }
  });
}

// Fields that name an owner, an organisation or an owner-qualified repository.
const OWNER_FIELDS = new Set(['login', 'organization', 'budget_entity_name', 'full_name', 'repositoryName']);

test('no fixture carries a real owner name: no thn-inc, owner-naming values all example-', () => {
  const ownerValues = [];
  const strings = [];
  const walk = (value, key) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value !== null && typeof value === 'object') {
      for (const k of Object.keys(value)) walk(value[k], k);
    } else if (typeof value === 'string') {
      strings.push(value);
      if (OWNER_FIELDS.has(key)) ownerValues.push(value);
    }
  };
  for (const name of Object.keys(PROBED_KEYS)) walk(load(name), null);
  assert.ok(ownerValues.length >= 6, `expected owner-naming values in the fixtures, saw ${ownerValues.length}`);
  for (const s of strings) assert.ok(!s.includes('thn-inc'), `fixture string contains thn-inc: ${s}`);
  for (const v of ownerValues) assert.ok(v.startsWith('example-'), `owner-naming value is not synthetic: ${v}`);
});
