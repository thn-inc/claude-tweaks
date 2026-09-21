'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { isPendingAuthorization } = require('../../../plugin/bin/lib/issues/pending-authorization');

function facets({ build = false, merge = false, inProgress = false, blocked = false, parked = false } = {}) {
  return { grants: { build, merge }, bot: { inProgress, blocked, parked } };
}

test('isPendingAuthorization: no grants, no bot state -> pending', () => {
  assert.strictEqual(isPendingAuthorization(facets()), true);
});

test('isPendingAuthorization: auto:build granted -> not pending', () => {
  assert.strictEqual(isPendingAuthorization(facets({ build: true })), false);
});

test('isPendingAuthorization: auto:merge granted -> not pending', () => {
  assert.strictEqual(isPendingAuthorization(facets({ merge: true })), false);
});

test('isPendingAuthorization: bot:in-progress -> not pending', () => {
  assert.strictEqual(isPendingAuthorization(facets({ inProgress: true })), false);
});

test('isPendingAuthorization: bot:blocked -> not pending (the exact bug this predicate exists to prevent)', () => {
  assert.strictEqual(isPendingAuthorization(facets({ blocked: true })), false);
});

test('isPendingAuthorization: both a grant and bot:blocked -> not pending', () => {
  assert.strictEqual(isPendingAuthorization(facets({ merge: true, blocked: true })), false);
});

test('isPendingAuthorization: bot:parked -> not pending (merge-verification park, distinct from bot:blocked)', () => {
  assert.strictEqual(isPendingAuthorization(facets({ parked: true })), false);
});
