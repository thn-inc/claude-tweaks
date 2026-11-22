'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { createCache } = require('../../../plugin/bin/lib/health-core/cache');

function tmp() { return scratchDir('health-core-cache-'); }

test('cachePath is namespaced under .claude-tweaks/<skillName>/cache.json', () => {
  const core = createCache('some-skill');
  const root = tmp();
  assert.strictEqual(core.cachePath(root), path.join(root, '.claude-tweaks', 'some-skill', 'cache.json'));
});

test('readCache returns {} when the cache file does not exist', () => {
  const core = createCache('some-skill');
  assert.deepStrictEqual(core.readCache(tmp()), {});
});

test('writeCache then readCache round-trips and creates the dir', () => {
  const core = createCache('some-skill');
  const root = tmp();
  const cache = { 'someskill-abc123': { status: 'staged' } };
  core.writeCache(root, cache);
  assert.ok(fs.existsSync(core.cachePath(root)));
  assert.deepStrictEqual(core.readCache(root), cache);
});

test('readCache returns {} on corrupt JSON rather than throwing', () => {
  const core = createCache('some-skill');
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'some-skill'), { recursive: true });
  fs.writeFileSync(core.cachePath(root), '{ not json');
  assert.deepStrictEqual(core.readCache(root), {});
});

test('two different skill names namespace to different directories under the same root', () => {
  const root = tmp();
  const a = createCache('skill-a');
  const b = createCache('skill-b');
  a.writeCache(root, { x: 1 });
  assert.deepStrictEqual(b.readCache(root), {});
});

// cursorsPath/readCursors/writeCursors/runsDir/readRuns (local-disk cursor and
// run-log persistence) were removed by the durable-state migration — cursors
// and run history now live on the health-state git branch
// (bin/lib/health-core/durable-state.js), read via readDurableState(root),
// not from local disk. None of the four skill consumers ever called these
// (only their own recordAudit()/cursor-shape logic on top of cachePath/
// readCache/writeCache), so they were deleted rather than wired up — same
// migration as runs.js's recordRun/readRuns removal.
test('createCache exports cachePath/readCache/writeCache/updateCache — cursor and runs helpers were removed as dead code', () => {
  const core = createCache('some-skill');
  assert.deepStrictEqual(Object.keys(core).sort(), ['cachePath', 'readCache', 'updateCache', 'writeCache']);
});

// --- updateCache: atomic read-modify-write (closes the unguarded RMW race) ---

test('updateCache performs a read-modify-write and returns the fully updated cache', () => {
  const core = createCache('some-skill');
  const root = tmp();
  core.writeCache(root, { a: 1 });
  const result = core.updateCache(root, (cache) => ({ ...cache, b: 2 }));
  assert.deepStrictEqual(result, { a: 1, b: 2 });
  assert.deepStrictEqual(core.readCache(root), { a: 1, b: 2 });
});

test('updateCache creates the cache dir when it does not exist yet, mirroring writeCache', () => {
  const core = createCache('some-skill');
  const root = tmp();
  const result = core.updateCache(root, (cache) => ({ ...cache, first: true }));
  assert.deepStrictEqual(result, { first: true });
  assert.ok(fs.existsSync(core.cachePath(root)));
});

test('sequential updateCache calls compose correctly, each seeing the prior call\'s persisted result', () => {
  const core = createCache('some-skill');
  const root = tmp();
  core.updateCache(root, (cache) => ({ ...cache, x: 1 }));
  core.updateCache(root, (cache) => ({ ...cache, y: (cache.x || 0) + 1 }));
  assert.deepStrictEqual(core.readCache(root), { x: 1, y: 2 });
});

test('updateCache releases its lock file after a successful update — no lock litter left behind', () => {
  const core = createCache('some-skill');
  const root = tmp();
  core.updateCache(root, (cache) => ({ ...cache, a: 1 }));
  assert.ok(!fs.existsSync(`${core.cachePath(root)}.lock`));
});

test('updateCache throws (does not silently proceed unguarded) when a lock held by another writer is never released — a stuck/crashed holder must not defeat the guard', () => {
  const core = createCache('some-skill');
  const root = tmp();
  core.writeCache(root, { a: 1 });
  const lockPath = `${core.cachePath(root)}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, 'stuck-holder', { flag: 'wx' });
  let mutatorRan = false;
  assert.throws(
    () => core.updateCache(root, (cache) => { mutatorRan = true; return { ...cache, b: 2 }; }, { maxAttempts: 3, retryDelayMs: 1, sleep: () => {} }),
    /could not acquire lock/,
  );
  assert.strictEqual(mutatorRan, false, 'the mutator must never run when the lock could not be acquired');
  // The cache must be untouched — no unguarded write happened.
  assert.deepStrictEqual(core.readCache(root), { a: 1 });
  fs.unlinkSync(lockPath);
});

test('updateCache retries acquiring the lock and eventually succeeds once a stale lock is released mid-wait', () => {
  const core = createCache('some-skill');
  const root = tmp();
  core.writeCache(root, { a: 1 });
  const lockPath = `${core.cachePath(root)}.lock`;
  fs.writeFileSync(lockPath, 'other-writer', { flag: 'wx' });
  let sleepCalls = 0;
  const sleep = () => {
    sleepCalls += 1;
    if (sleepCalls === 2) fs.unlinkSync(lockPath); // released after two waited attempts
  };
  const result = core.updateCache(root, (cache) => ({ ...cache, b: 2 }), { maxAttempts: 10, retryDelayMs: 1, sleep });
  assert.deepStrictEqual(result, { a: 1, b: 2 });
  assert.ok(sleepCalls >= 2, 'must have actually waited/retried instead of failing immediately');
});
