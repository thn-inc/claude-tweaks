'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { resolveSuiteSlots, chooseLane, workerCap } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'verify', 'slot.js'));

test('resolveSuiteSlots: the declaration wins over the flag, the flag over the default (#5119)', () => {
  assert.deepStrictEqual(resolveSuiteSlots({ declared: 2, flag: 3 }), { slots: 2, source: 'declaration' });
  assert.deepStrictEqual(resolveSuiteSlots({ declared: null, flag: 3 }), { slots: 3, source: 'flag' });
  assert.deepStrictEqual(resolveSuiteSlots({ declared: null, flag: null }), { slots: 1, source: 'default' });
});

test('chooseLane: null with no local check, full when a full suite runs, subset otherwise (#5119)', () => {
  assert.strictEqual(chooseLane({ localCheckCount: 0, fullSuiteRuns: true }), null);
  assert.strictEqual(chooseLane({ localCheckCount: 2, fullSuiteRuns: true }), 'full');
  assert.strictEqual(chooseLane({ localCheckCount: 2, fullSuiteRuns: false }), 'subset');
});

test('workerCap: cores / (2 * slots), floored, never below 1 (#5119)', () => {
  assert.strictEqual(workerCap(16, 1), 8);
  assert.strictEqual(workerCap(16, 4), 2);
  assert.strictEqual(workerCap(3, 2), 1);
  assert.strictEqual(workerCap(1, 1), 1);
});
