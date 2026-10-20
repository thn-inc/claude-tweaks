'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBudget } = require('../../../plugin/bin/lib/reconcile/budget');

test('createBudget: not exceeded immediately after creation', () => {
  const b = createBudget(1000);
  assert.equal(b.exceeded(), false);
});

test('createBudget: exceeded once the deadline has passed', () => {
  let now = 1000;
  const b = createBudget(1, () => now);
  now += 5;
  assert.equal(b.exceeded(), true);
});

test('createBudget: remainingMs never goes negative', () => {
  let now = 1000;
  const b = createBudget(1, () => now);
  now += 5;
  assert.equal(b.remainingMs(), 0);
});

test('createBudget: an Infinity ceiling never expires (#3026)', () => {
  const b = createBudget(Infinity, () => 1e15);
  assert.equal(b.exceeded(), false);
  assert.equal(b.remainingMs(), Infinity);
});

test('createBudget: nowFn defaults to Date.now when omitted', () => {
  const b = createBudget(1000);
  assert.equal(b.exceeded(), false);
});
