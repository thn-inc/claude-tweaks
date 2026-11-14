'use strict';
// acceptance.js decideRoute: the pure acceptance route table. Every floor verdict the
// expectations rely on is computed with the real exceedsOversightFloor, never hand-typed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { decideRoute } = require(path.join(LIB, 'driver', 'acceptance'));
const { exceedsOversightFloor } = require(path.join(LIB, 'issues', 'oversight-floor'));

const FLOORS = { riskFloor: 'high', sizeFloor: 'high' };
const LOW = { risk: 'low', size: 'low' };
const OVER = { risk: 'high', size: 'low' };

const gate = (state, extra) => ({ code: 0, verdict: { parent: state === 'no-parent' ? null : 7, state, exceeds: null, ...extra } });
const NO_PARENT_ROUTES = ['no-parent-exempt', 'no-parent-gated'];

test('fixtures: LOW is under the floors and OVER exceeds them, per the real predicate', () => {
  assert.strictEqual(exceedsOversightFloor(LOW, FLOORS).exceeds, false);
  assert.strictEqual(exceedsOversightFloor(OVER, FLOORS).exceeds, true);
});

test('decideRoute', async (t) => {
  for (const state of ['incomplete', 'gated', 'resolved']) {
    await t.test(`code 0, state ${state} -> try-it-only, no labels`, () => {
      const r = decideRoute({ gate: gate(state), facets: OVER, floors: FLOORS });
      assert.deepStrictEqual(r, { route: 'try-it-only', labels: [] });
    });
  }

  await t.test('code 0, due, exceeds false -> try-it-only', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: false }), facets: OVER, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'try-it-only', labels: [] });
  });

  await t.test('code 0, due, exceeds true -> due-exceeds, label on the parent', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: true }), facets: LOW, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'due-exceeds', labels: [{ on: 'parent', label: 'demo:pending' }] });
  });

  await t.test('code 0, no-parent, floor not exceeded -> no-parent-exempt', () => {
    const f = exceedsOversightFloor(LOW, FLOORS);
    assert.strictEqual(f.exceeds, false);
    const r = decideRoute({ gate: gate('no-parent'), facets: LOW, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'no-parent-exempt', labels: [] });
  });

  await t.test('code 0, no-parent, risk high under high floors -> no-parent-gated, label on the record', () => {
    const f = exceedsOversightFloor({ risk: 'high', size: 'low' }, FLOORS);
    assert.strictEqual(f.exceeds, true);
    const r = decideRoute({ gate: gate('no-parent'), facets: { risk: 'high', size: 'low' }, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'no-parent-gated', labels: [{ on: 'record', label: 'demo:pending' }] });
  });

  await t.test('code 0, no-parent, risk undefined -> unscored -> no-parent-gated', () => {
    const f = exceedsOversightFloor({ risk: undefined, size: 'low' }, FLOORS);
    assert.strictEqual(f.reason, 'unscored');
    const r = decideRoute({ gate: gate('no-parent'), facets: { risk: undefined, size: 'low' }, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-gated');
    assert.deepStrictEqual(r.labels, [{ on: 'record', label: 'demo:pending' }]);
  });

  await t.test('code 0, no-parent, out-of-vocabulary risk -> no-parent-gated', () => {
    assert.strictEqual(exceedsOversightFloor({ risk: 'extreme', size: 'low' }, FLOORS).exceeds, true);
    const r = decideRoute({ gate: gate('no-parent'), facets: { risk: 'extreme', size: 'low' }, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-gated');
  });

  await t.test('code 0, no-parent, size over its floor -> no-parent-gated', () => {
    const facets = { risk: 'low', size: 'high' };
    assert.strictEqual(exceedsOversightFloor(facets, FLOORS).reason, 'size');
    assert.strictEqual(decideRoute({ gate: gate('no-parent'), facets, floors: FLOORS }).route, 'no-parent-gated');
  });

  await t.test('the floors come from the caller: a stricter floor gates a low-risk record', () => {
    const floors = { riskFloor: 'low', sizeFloor: 'high' };
    assert.strictEqual(exceedsOversightFloor(LOW, floors).exceeds, true);
    assert.strictEqual(decideRoute({ gate: gate('no-parent'), facets: LOW, floors }).route, 'no-parent-gated');
  });

  await t.test('due with exceeds null -> route null', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: null }), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.match(r.error, /due/);
  });

  await t.test("due with exceeds 'true' (a string) -> route null", () => {
    const r = decideRoute({ gate: gate('due', { exceeds: 'true' }), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.ok(r.error);
  });

  await t.test('an unknown state -> route null, error names it', () => {
    const r = decideRoute({ gate: gate('bogus'), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.match(r.error, /bogus/);
    assert.strictEqual('labels' in r, false);
  });

  await t.test('code 0 with a null verdict is unparseable -> falls back, never null', () => {
    const r = decideRoute({ gate: { code: 0, verdict: null }, facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-exempt');
    assert.strictEqual(r.fallback, 'parent-gate failed');
  });

  for (const code of [1, 2, 3]) {
    await t.test(`AC8: exit ${code} falls back to the floor, never null, never a skip`, () => {
      const exempt = decideRoute({ gate: { code, verdict: null }, facets: LOW, floors: FLOORS });
      assert.ok(NO_PARENT_ROUTES.includes(exempt.route));
      assert.deepStrictEqual(exempt, { route: 'no-parent-exempt', labels: [], fallback: 'parent-gate failed' });
      const gated = decideRoute({ gate: { code, verdict: null }, facets: OVER, floors: FLOORS });
      assert.ok(NO_PARENT_ROUTES.includes(gated.route));
      assert.deepStrictEqual(gated, {
        route: 'no-parent-gated', labels: [{ on: 'record', label: 'demo:pending' }], fallback: 'parent-gate failed',
      });
    });
  }

  await t.test('a non-zero exit with a parseable due/exceeds verdict still falls back to the floor', () => {
    const r = decideRoute({ gate: { code: 3, verdict: { state: 'due', exceeds: true } }, facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-exempt');
    assert.strictEqual(r.fallback, 'parent-gate failed');
  });

  await t.test('a clean verdict carries no fallback key', () => {
    const r = decideRoute({ gate: gate('resolved'), facets: LOW, floors: FLOORS });
    assert.strictEqual('fallback' in r, false);
  });
});
