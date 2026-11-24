const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { cachePath, readCache, writeCache, readDurableState, writeDurableState } = require('../../../plugin/bin/lib/docs-health/cache');

function tmp() { return scratchDir('docs-health-cache-'); }

test('readCache returns {} when the cache file does not exist', () => {
  const root = tmp();
  assert.deepStrictEqual(readCache(root), {});
});

test('writeCache then readCache round-trips', () => {
  const root = tmp();
  writeCache(root, { 'docshealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
  assert.deepStrictEqual(readCache(root), { 'docshealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
});

test('cachePath points under .claude-tweaks/docs-health/cache.json', () => {
  const root = tmp();
  assert.strictEqual(cachePath(root), path.join(root, '.claude-tweaks', 'docs-health', 'cache.json'));
});

test('readDurableState/writeDurableState are exported and bound to docs-health', () => {
  assert.strictEqual(typeof readDurableState, 'function');
  assert.strictEqual(typeof writeDurableState, 'function');
});
