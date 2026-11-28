'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const prices = require('../../../plugin/bin/lib/pricing/prices.js');
const spend = require('../../../tools/pipeline-cost-report/spend.js');

const { PRICES, familyOf, priceRequest, priceAggregate } = prices;
const usage = (model, o = {}) => ({ model, input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...o });

test('AC1.1: the price table lives in the plugin, dated 2026-11-03', () => {
  assert.equal(PRICES.date, '2026-11-03');
  assert.deepEqual(PRICES.families.opus, [4, 20, 0.2, 5, 8]);
  assert.equal(familyOf('claude-sonnet-5-5'), 'sonnet');
  assert.equal(familyOf('<synthetic>'), 'unpriced');
  assert.equal(spend.PRICES, PRICES);
});

test('priceRequest applies the Haiku long-prompt multiplier; priceAggregate does not', () => {
  const u = usage('claude-haiku-5', { input: 100001 });
  assert.equal(priceRequest(u).usd, (100001 * 0.1 * 5) / 1e6);
  assert.equal(priceAggregate(u).usd, (100001 * 0.1) / 1e6);
  assert.equal(priceAggregate(u).prompt, 100001);
  assert.equal(priceAggregate(u).family, 'haiku');
});

test('priceAggregate equals priceRequest on a non-Haiku input', () => {
  const u = usage('claude-opus-5', { input: 300000, output: 5000, cacheRead: 200000, cacheWrite5m: 1000, cacheWrite1h: 2000 });
  assert.deepEqual(priceAggregate(u), priceRequest(u));
});

test('an unpriced family costs zero in both pricers', () => {
  const u = usage('<synthetic>', { input: 10 });
  assert.deepEqual(priceAggregate(u), { usd: 0, cacheWriteUsd: 0, prompt: 10, family: 'unpriced' });
  assert.deepEqual(priceRequest(u), priceAggregate(u));
});
