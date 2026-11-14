'use strict';
// Record #5161 — plugin/bin/lib/ci-health/billing.js: owner-type-routed billing reads behind an
// injected runner, returning their own {available, …} envelope, and the pure headroomFrom.
// Fake runners record argv and opts inside and branch on the path; anything unhandled throws.
// No test name carries an amount — only percentages and statuses.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { readText } = require('../../helpers/read-skill');
const { headroomFrom, readBilling } = require('../../../plugin/bin/lib/ci-health/billing');

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'ci-health');
const read = (name) => readText(path.join(FIXTURES, name));
const BUDGETS = read('org-budgets.json');
const SUMMARY = read('org-usage-summary.json');
const USER_USAGE = read('user-usage.json');

const BUDGETS_PATH = 'organizations/example-org/settings/billing/budgets';
const SUMMARY_PATH = 'organizations/example-org/settings/billing/usage/summary';
const USER_PATH = 'users/example-user/settings/billing/usage';
const ORG_REPO = { ok: true, ownerType: 'Organization', ownerLogin: 'example-org', defaultBranch: 'main' };
const USER_REPO = { ok: true, ownerType: 'User', ownerLogin: 'example-user', defaultBranch: 'main' };

function ghError(stderr) {
  const err = new Error(`Command failed: gh api\n${stderr}`);
  err.stderr = stderr;
  return err;
}

// routes: { path: body string | Error }.
function billingRunner(routes) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    const entry = routes[args[3]];
    if (entry === undefined || args.length !== 4) throw new Error('unexpected ' + args.join(' '));
    if (entry instanceof Error) throw entry;
    return entry;
  };
  return { runner, calls };
}

const budgets = (list, extra = {}) => ({ budgets: list, has_next_page: false, total_count: list.length, ...extra });
const actionsBudget = (amount, extra = {}) => ({ budget_product_sku: 'actions', budget_scope: 'organization', budget_amount: amount, ...extra });
const summary = () => JSON.parse(SUMMARY);

for (const [status, text] of [[404, 'Not Found'], [403, 'Forbidden'], [410, 'Gone']]) {
  test(`AC4.1: the org budgets read throwing HTTP ${status} is unavailable with that status, and stops`, () => {
    const stderr = `gh: ${text} (HTTP ${status})`;
    const { runner, calls } = billingRunner({ [BUDGETS_PATH]: ghError(stderr), [SUMMARY_PATH]: SUMMARY });
    const r = readBilling({ repoRead: ORG_REPO }, { runner });
    assert.deepStrictEqual(r.billing, { available: false, status, reason: `HTTP ${status}` });
    assert.deepStrictEqual(r.failures, [{ query: 'billing budgets', status, error: stderr }]);
    assert.strictEqual(calls.length, 1, 'no usage summary call after a failed budgets read');
  });
}

test('a billing read that fails after partial output never copies that stdout into the reason or the failure', () => {
  const partial = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT', stdout: '{"usageItems":[{"product":"actions","netAmount": 123}' });
  const { runner } = billingRunner({ [BUDGETS_PATH]: BUDGETS, [SUMMARY_PATH]: partial });
  const r = readBilling({ repoRead: ORG_REPO }, { runner });
  assert.deepStrictEqual(r.billing, { available: false, status: null, reason: 'spawnSync gh ETIMEDOUT' });
  assert.deepStrictEqual(r.failures, [{ query: 'billing usage summary', status: null, error: 'spawnSync gh ETIMEDOUT' }]);
  assert.doesNotMatch(JSON.stringify(r), /123/);
});

test('AC7.4: the org fixtures give 5% headroom through the two exact GET reads', () => {
  const { runner, calls } = billingRunner({ [BUDGETS_PATH]: BUDGETS, [SUMMARY_PATH]: SUMMARY });
  const r = readBilling({ repoRead: ORG_REPO }, { runner });
  assert.deepStrictEqual(r, { billing: { available: true, scope: 'org', headroomPct: 5 }, failures: [] });
  assert.deepStrictEqual(calls, [
    { args: ['api', '--method', 'GET', BUDGETS_PATH], opts: { timeout: 15000 } },
    { args: ['api', '--method', 'GET', SUMMARY_PATH], opts: { timeout: 15000 } },
  ]);
});

test('AC7.4: headroomFrom over the fixtures is 5 with no reason, first page complete', () => {
  assert.deepStrictEqual(headroomFrom(JSON.parse(BUDGETS), summary()), { headroomPct: 5, reason: null, firstPageOnly: false });
});

test('AC7.6: two Actions budgets — the smaller headroom wins', () => {
  const r = headroomFrom(budgets([actionsBudget(1000), actionsBudget(100)]), summary());
  assert.strictEqual(r.headroomPct, 5);
  assert.strictEqual(r.reason, null);
});

test('a non-integer headroom is rounded to 2 dp inside headroomFrom', () => {
  const s = summary();
  s.usageItems = [{ product: 'Actions', sku: 'actions_linux', netAmount: 271 }];
  assert.strictEqual(headroomFrom(budgets([actionsBudget(300)]), s).headroomPct, 9.67);
});

for (const [label, list] of [
  ['only a git_lfs budget', JSON.parse(BUDGETS).budgets.filter((b) => b.budget_product_sku === 'git_lfs')],
  ['a zero Actions budget', [actionsBudget(0)]],
  ['no budgets at all', []],
  ['an Actions budget scoped to a repository', [actionsBudget(100, { budget_scope: 'repository' })]],
  ['an actions_linux SKU budget', [actionsBudget(100, { budget_product_sku: 'actions_linux' })]],
]) {
  test(`AC7.7: ${label} → available, null headroom, no Actions budget to compare`, () => {
    assert.deepStrictEqual(headroomFrom(budgets(list), summary()), { headroomPct: null, reason: 'no Actions budget to compare', firstPageOnly: false });
    const { runner } = billingRunner({ [BUDGETS_PATH]: JSON.stringify(budgets(list)), [SUMMARY_PATH]: SUMMARY });
    assert.deepStrictEqual(readBilling({ repoRead: ORG_REPO }, { runner }).billing, {
      available: true, scope: 'org', headroomPct: null, reason: 'no Actions budget to compare',
    });
  });
}

test('the Actions SKU and the usage product match case-insensitively', () => {
  const s = summary();
  for (const item of s.usageItems) item.product = item.product.toUpperCase();
  assert.strictEqual(headroomFrom(budgets([actionsBudget(100, { budget_product_sku: 'Actions' })]), s).headroomPct, 5);
});

test('AC7.7: the user route reads the user usage endpoint and has no Actions budget to compare', () => {
  const { runner, calls } = billingRunner({ [USER_PATH]: USER_USAGE });
  const r = readBilling({ repoRead: USER_REPO }, { runner });
  assert.deepStrictEqual(r, {
    billing: { available: true, scope: 'user', headroomPct: null, reason: 'no Actions budget to compare' },
    failures: [],
  });
  assert.deepStrictEqual(calls, [{ args: ['api', '--method', 'GET', USER_PATH], opts: { timeout: 15000 } }]);
});

test('the user usage read throwing HTTP 404 is unavailable with a billing usage failure', () => {
  const stderr = 'gh: This API operation needs the "user" scope (HTTP 404)';
  const { runner } = billingRunner({ [USER_PATH]: ghError(stderr) });
  const r = readBilling({ repoRead: USER_REPO }, { runner });
  assert.deepStrictEqual(r, {
    billing: { available: false, status: 404, reason: 'HTTP 404' },
    failures: [{ query: 'billing usage', status: 404, error: stderr }],
  });
});

test('has_next_page: true → firstPageOnly over the listed page, carried into the envelope', () => {
  const b = JSON.parse(BUDGETS);
  b.has_next_page = true;
  assert.deepStrictEqual(headroomFrom(b, summary()), { headroomPct: 5, reason: null, firstPageOnly: true });
  const { runner } = billingRunner({ [BUDGETS_PATH]: JSON.stringify(b), [SUMMARY_PATH]: SUMMARY });
  assert.deepStrictEqual(readBilling({ repoRead: ORG_REPO }, { runner }).billing, {
    available: true, scope: 'org', headroomPct: 5, firstPageOnly: true,
  });
});

test('has_next_page: true with no Actions budget on the first page → firstPageOnly beside the null headroom', () => {
  const b = budgets(JSON.parse(BUDGETS).budgets.filter((x) => x.budget_product_sku === 'git_lfs'), { has_next_page: true });
  assert.deepStrictEqual(headroomFrom(b, summary()), { headroomPct: null, reason: 'no Actions budget to compare', firstPageOnly: true });
  const { runner } = billingRunner({ [BUDGETS_PATH]: JSON.stringify(b), [SUMMARY_PATH]: SUMMARY });
  assert.deepStrictEqual(readBilling({ repoRead: ORG_REPO }, { runner }).billing, {
    available: true, scope: 'org', headroomPct: null, reason: 'no Actions budget to compare', firstPageOnly: true,
  });
});

for (const [label, mutate] of [
  ['missing', (item) => { delete item.netAmount; }],
  ['a string', (item) => { item.netAmount = String(item.netAmount); }],
  ['null', (item) => { item.netAmount = null; }],
]) {
  test(`Review Focus 5: an Actions netAmount that is ${label} → null headroom with a reason naming netAmount, never NaN`, () => {
    const s = summary();
    mutate(s.usageItems[1]);
    const r = headroomFrom(JSON.parse(BUDGETS), s);
    assert.strictEqual(r.headroomPct, null);
    assert.match(r.reason, /netAmount/);
    const { runner } = billingRunner({ [BUDGETS_PATH]: BUDGETS, [SUMMARY_PATH]: JSON.stringify(s) });
    const billing = readBilling({ repoRead: ORG_REPO }, { runner }).billing;
    assert.strictEqual(billing.available, true);
    assert.strictEqual(billing.headroomPct, null);
    assert.match(billing.reason, /netAmount/);
  });
}

test('a non-Actions usage item without netAmount does not block the figure', () => {
  const s = summary();
  delete s.usageItems[2].netAmount;
  assert.strictEqual(headroomFrom(JSON.parse(BUDGETS), s).headroomPct, 5);
});

for (const [label, b, s, field] of [
  ['budgets missing', {}, summary(), 'budgets'],
  ['budgets not an array', { budgets: { id: 'b-1' } }, summary(), 'budgets'],
  ['budgets JSON null', null, summary(), 'budgets'],
  ['an Actions budget_amount that is a string', budgets([actionsBudget('100')]), summary(), 'budget_amount'],
  ['usageItems missing', JSON.parse(BUDGETS), { organization: 'example-org' }, 'usageItems'],
  ['usageItems not an array', JSON.parse(BUDGETS), { usageItems: {} }, 'usageItems'],
]) {
  test(`${label} → null headroom with a reason naming ${field}`, () => {
    const r = headroomFrom(b, s);
    assert.strictEqual(r.headroomPct, null);
    assert.ok(r.reason.includes(field), r.reason);
  });
}

test('a summary with no Actions usage items still computes: no spend is 100% headroom', () => {
  const s = summary();
  s.usageItems = s.usageItems.filter((i) => i.product !== 'Actions');
  assert.strictEqual(headroomFrom(JSON.parse(BUDGETS), s).headroomPct, 100);
});

test('the usage summary read throwing HTTP 403 is unavailable with a billing usage summary failure', () => {
  const { runner, calls } = billingRunner({ [BUDGETS_PATH]: BUDGETS, [SUMMARY_PATH]: ghError('HTTP 403: Resource not accessible by integration') });
  const r = readBilling({ repoRead: ORG_REPO }, { runner });
  assert.deepStrictEqual(r, {
    billing: { available: false, status: 403, reason: 'HTTP 403' },
    failures: [{ query: 'billing usage summary', status: 403, error: 'HTTP 403: Resource not accessible by integration' }],
  });
  assert.strictEqual(calls.length, 2);
});

test('a read failing with another status keeps the status and uses the error text as the reason', () => {
  const stderr = 'HTTP 502: Bad Gateway (https://api.github.com/organizations/example-org/settings/billing/budgets)';
  const { runner } = billingRunner({ [BUDGETS_PATH]: ghError(stderr) });
  const r = readBilling({ repoRead: ORG_REPO }, { runner });
  assert.deepStrictEqual(r.billing, { available: false, status: 502, reason: stderr });
  assert.deepStrictEqual(r.failures, [{ query: 'billing budgets', status: 502, error: stderr }]);
});

// The second body makes V8's SyntaxError quote the body text ("budget 123456" is not valid JSON),
// so a reason built from the parse error's message would carry it.
for (const [label, body] of [
  ['a truncated body', '{"budgets":[{"budget_amount":123456'],
  ['a body the parse error quotes', 'budget 123456'],
]) {
  test(`${label} is a failed read with a null status and a fixed reason that quotes no body text`, () => {
    const { runner } = billingRunner({ [BUDGETS_PATH]: body });
    const r = readBilling({ repoRead: ORG_REPO }, { runner });
    const error = `${BUDGETS_PATH}: response is not valid JSON`;
    assert.deepStrictEqual(r, {
      billing: { available: false, status: null, reason: error },
      failures: [{ query: 'billing budgets', status: null, error }],
    });
    assert.doesNotMatch(r.billing.reason, /123456/);
    assert.doesNotMatch(r.failures[0].error, /123456/);
  });
}

test('a billing read finding gh gone adds no failure row only when the runs half is ghAbsent', () => {
  const enoent = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
  const billing = { available: false, status: null, reason: 'spawnSync gh ENOENT' };
  const absent = billingRunner({ [BUDGETS_PATH]: enoent });
  assert.deepStrictEqual(readBilling({ repoRead: ORG_REPO, ghAbsent: true }, { runner: absent.runner }), { billing, failures: [] });
  // gh vanishing after the first runs page leaves the runs half ghAbsent: false, so the read is named.
  for (const repoArg of [{ repoRead: ORG_REPO, ghAbsent: false }, { repoRead: ORG_REPO }]) {
    const { runner } = billingRunner({ [BUDGETS_PATH]: enoent });
    assert.deepStrictEqual(readBilling(repoArg, { runner }), {
      billing, failures: [{ query: 'billing budgets', status: null, error: 'spawnSync gh ENOENT' }],
    }, JSON.stringify(repoArg));
  }
  const user = billingRunner({ [USER_PATH]: enoent });
  assert.deepStrictEqual(readBilling({ repoRead: USER_REPO, ghAbsent: false }, { runner: user.runner }).failures,
    [{ query: 'billing usage', status: null, error: 'spawnSync gh ENOENT' }]);
  const summaryGone = billingRunner({ [BUDGETS_PATH]: BUDGETS, [SUMMARY_PATH]: enoent });
  assert.deepStrictEqual(readBilling({ repoRead: ORG_REPO, ghAbsent: false }, { runner: summaryGone.runner }).failures,
    [{ query: 'billing usage summary', status: null, error: 'spawnSync gh ENOENT' }]);
});

for (const ghAbsent of [false, true]) {
  test(`repoRead ok: false with ghAbsent: ${ghAbsent} → owner type unreadable, zero runner calls`, () => {
    const { runner, calls } = billingRunner({});
    const r = readBilling({ repoRead: { ok: false, status: null, error: 'x', ghAbsent } }, { runner });
    assert.deepStrictEqual(r, { billing: { available: false, status: null, reason: 'owner type unreadable' }, failures: [] });
    assert.strictEqual(calls.length, 0);
  });
}

test('an owner type that is neither Organization nor User makes no call', () => {
  const { runner, calls } = billingRunner({});
  const r = readBilling({ repoRead: { ...ORG_REPO, ownerType: 'Enterprise' } }, { runner });
  assert.deepStrictEqual(r, { billing: { available: false, status: null, reason: 'unsupported owner type' }, failures: [] });
  assert.strictEqual(calls.length, 0);
});
