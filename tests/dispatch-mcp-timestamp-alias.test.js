'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aliasMcpTimestamps } = require('../plugin/bin/lib/issues/mcp-issue-shape');

// #3691: the GitHub MCP tools return snake_case created_at/updated_at, but the
// dispatch consumers read camelCase createdAt/updatedAt. aliasMcpTimestamps adds
// the camelCase keys without removing the snake_case originals.

test('aliases created_at/updated_at to camelCase', () => {
  const input = [{ number: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }];
  const [out] = aliasMcpTimestamps(input);
  assert.equal(out.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(out.updatedAt, '2026-01-02T00:00:00Z');
  assert.equal(out.created_at, '2026-01-01T00:00:00Z');
});

test('keeps an existing camelCase value', () => {
  const [out] = aliasMcpTimestamps([{ createdAt: 'A', created_at: 'B' }]);
  assert.equal(out.createdAt, 'A');
});

test('adds no key for an absent or non-string snake_case value', () => {
  const [absent, nullValue] = aliasMcpTimestamps([{ number: 2 }, { created_at: null }]);
  assert.ok(!('createdAt' in absent));
  assert.ok(!('createdAt' in nullValue));
});

test('non-array input returns []', () => {
  assert.deepEqual(aliasMcpTimestamps(null), []);
  assert.deepEqual(aliasMcpTimestamps(undefined), []);
  assert.deepEqual(aliasMcpTimestamps({}), []);
});

test('does not mutate its input', () => {
  const input = [{ number: 3, created_at: '2026-01-01T00:00:00Z' }];
  const snapshot = JSON.parse(JSON.stringify(input));
  aliasMcpTimestamps(input);
  assert.deepEqual(input, snapshot);
});
