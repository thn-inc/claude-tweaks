'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePrListing } = require('../../../plugin/bin/lib/issues/mcp-pr-shape');

const U = 'https://github.com/acme/w/pull/7';
const B = 'claude-tweaks-run: 2026-10-31T005940-record-4596';
const mcp = (fullName) => ({ html_url: U, body: B, head: { repo: { full_name: fullName } } });

test('normalizePrListing maps an MCP entry to the gh shape', () => {
  assert.deepEqual(normalizePrListing([mcp('acme/w')], 'acme', 'w'), [{ url: U, body: B, isCrossRepository: false }]);
});

test('normalizePrListing compares full_name exactly, as isSameRepoPrUrl does', () => {
  assert.equal(normalizePrListing([mcp('Acme/W')], 'acme', 'w')[0].isCrossRepository, true);
});

test('normalizePrListing marks a fork or a deleted head repo cross-repository', () => {
  assert.equal(normalizePrListing([mcp('evil/w')], 'acme', 'w')[0].isCrossRepository, true);
  assert.equal(normalizePrListing([{ html_url: U, body: B, head: { repo: null } }], 'acme', 'w')[0].isCrossRepository, true);
});

test('normalizePrListing passes a gh-shaped entry through unchanged', () => {
  const entry = { url: U, body: B, isCrossRepository: false };
  const out = normalizePrListing([entry], 'acme', 'w');
  assert.deepEqual(out, [{ url: U, body: B, isCrossRepository: false }]);
  assert.notEqual(out[0], entry);
});

test('normalizePrListing throws on a non-array or a non-object element', () => {
  assert.throws(() => normalizePrListing({}, 'acme', 'w'), /open-PR listing is not an array/);
  assert.throws(() => normalizePrListing([42], 'acme', 'w'), /open-PR listing entry 0 is not an object/);
  assert.throws(() => normalizePrListing([null], 'acme', 'w'), /entry 0 is not an object/);
  assert.throws(() => normalizePrListing([[]], 'acme', 'w'), /entry 0 is not an object/);
});

test('normalizePrListing throws on an agent-recorded error element or an entry with no url (shape guard)', () => {
  assert.throws(() => normalizePrListing([{ message: 'Bad credentials', status: '401' }], 'acme', 'w'), /entry 0 is not a PR/);
  assert.throws(() => normalizePrListing([{ head: { repo: { full_name: 'acme/w' } }, body: 'x' }], 'acme', 'w'), /entry 0 is not a PR/);
  assert.throws(() => normalizePrListing([{ url: U, body: B }], 'acme', 'w'), /entry 0 is not a PR/);
  assert.throws(() => normalizePrListing([{ url: U, body: B, isCrossRepository: 'false' }], 'acme', 'w'), /entry 0 is not a PR/);
  assert.throws(() => normalizePrListing([mcp('acme/w'), { message: 'x' }], 'acme', 'w'), /entry 1 is not a PR/);
});

test('normalizePrListing detects an MCP entry by html_url alone (no head -> cross-repository)', () => {
  assert.deepEqual(normalizePrListing([{ html_url: U, body: B }], 'acme', 'w'), [{ url: U, body: B, isCrossRepository: true }]);
});

test('normalizePrListing detects an MCP entry by head alone (a head key with no html_url is not a PR)', () => {
  const entry = { head: { repo: { full_name: 'acme/w' } }, url: U, body: B, isCrossRepository: false };
  assert.throws(() => normalizePrListing([entry], 'acme', 'w'), /entry 0 is not a PR/);
});

test('normalizePrListing throws on a gh-shaped entry with no url (the gh url guard alone)', () => {
  assert.throws(() => normalizePrListing([{ body: B, isCrossRepository: false }], 'acme', 'w'), /entry 0 is not a PR/);
});

test('normalizePrListing keeps a gh-shaped fork flag on passthrough', () => {
  assert.deepEqual(
    normalizePrListing([{ url: U, body: B, isCrossRepository: true }], 'acme', 'w'),
    [{ url: U, body: B, isCrossRepository: true }],
  );
});

test('normalizePrListing never mutates its input', () => {
  const input = [mcp('acme/w'), { url: U, body: B, isCrossRepository: false }];
  const snapshot = JSON.parse(JSON.stringify(input));
  normalizePrListing(input, 'acme', 'w');
  assert.deepEqual(input, snapshot);
});
