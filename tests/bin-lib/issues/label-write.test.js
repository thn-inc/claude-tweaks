'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeLabelNames, ensureLabelNameArray } = require('../../../plugin/bin/lib/issues/label-write');

test('mergeLabelNames adds a new label onto an existing set, preserving every existing name', () => {
  const current = ['bug', 'ready', 'size:medium', 'auto:build'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['bug', 'ready', 'size:medium', 'auto:build', 'bot:in-progress']);
});

test('mergeLabelNames is a no-op add when the label is already present', () => {
  const current = ['ready', 'bot:in-progress'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['ready', 'bot:in-progress']);
});

test('mergeLabelNames removes a label while preserving every other one', () => {
  const current = ['ready', 'auto:merge', 'auto:merge-pending', 'risk:low'];
  const result = mergeLabelNames(current, { remove: ['auto:merge'] });
  assert.deepStrictEqual(result, ['ready', 'auto:merge-pending', 'risk:low']);
});

test('mergeLabelNames removing an absent label is a no-op', () => {
  const current = ['ready', 'risk:low'];
  const result = mergeLabelNames(current, { remove: ['bot:blocked'] });
  assert.deepStrictEqual(result, ['ready', 'risk:low']);
});

test('mergeLabelNames combines add and remove in one call', () => {
  const current = ['ready', 'bot:blocked'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'], remove: ['bot:blocked'] });
  assert.deepStrictEqual(result, ['ready', 'bot:in-progress']);
});

test('mergeLabelNames: a name in both add and remove is removed, not added (remove wins)', () => {
  const current = ['ready'];
  const result = mergeLabelNames(current, { add: ['bot:in-progress'], remove: ['bot:in-progress'] });
  assert.deepStrictEqual(result, ['ready']);
});

test('mergeLabelNames does not manufacture a duplicate when current already has one', () => {
  const current = ['ready', 'ready', 'risk:low'];
  const result = mergeLabelNames(current, { add: ['ready'] });
  assert.deepStrictEqual(result, ['ready', 'ready', 'risk:low']);
});

test('mergeLabelNames with no add/remove options returns an equal-valued copy, not the same array', () => {
  const current = ['ready', 'risk:low'];
  const result = mergeLabelNames(current);
  assert.deepStrictEqual(result, current);
  assert.notStrictEqual(result, current);
});

test('mergeLabelNames throws on a non-array current', () => {
  assert.throws(() => mergeLabelNames('not-an-array', { add: ['x'] }), TypeError);
});

test('mergeLabelNames throws on a non-array add/remove', () => {
  assert.throws(() => mergeLabelNames(['ready'], { add: 'x' }), TypeError);
  assert.throws(() => mergeLabelNames(['ready'], { remove: 'x' }), TypeError);
});

test('mergeLabelNames throws on a non-string entry in current/add/remove', () => {
  assert.throws(() => mergeLabelNames([1], {}), TypeError);
  assert.throws(() => mergeLabelNames(['ready'], { add: [null] }), TypeError);
});

test('ensureLabelNameArray returns the array unchanged when valid', () => {
  assert.deepStrictEqual(ensureLabelNameArray(['a', 'b'], 'current'), ['a', 'b']);
});

test('ensureLabelNameArray names the offending argument in its error message', () => {
  assert.throws(() => ensureLabelNameArray('nope', 'current'), /current/);
});
