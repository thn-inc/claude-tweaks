const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { readCache, writeCache, cachePath } = require('../../../plugin/bin/lib/code-health/cache');

function tmp() { return scratchDir('codehealth-cache-'); }

test('readCache returns {} when no cache file exists', () => {
  assert.deepStrictEqual(readCache(tmp()), {});
});

test('cachePath points at .claude-tweaks/code-health/cache.json', () => {
  const root = tmp();
  assert.strictEqual(cachePath(root), path.join(root, '.claude-tweaks', 'code-health', 'cache.json'));
});

test('writeCache then readCache round-trips and creates the dir', () => {
  const root = tmp();
  const cache = { 'codehealth-abc12345': { status: 'open', issue: 42 }, 'codehealth-deadbeef': { status: 'remembered', issue: null } };
  writeCache(root, cache);
  assert.ok(fs.existsSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json')));
  assert.deepStrictEqual(readCache(root), cache);
});

test('readCache returns {} on corrupt JSON rather than throwing', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'code-health'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'code-health', 'cache.json'), '{ not json');
  assert.deepStrictEqual(readCache(root), {});
});

// recordRun/readCursors/writeCursors (local-disk cursor persistence) were
// removed by the health-state migration — cursors now live on the durable
// health-state branch (bin/lib/health-core/durable-state.js), not local disk.
// The cursor-merge semantics these tests used to cover directly (preserve an
// existing lastHash when an area isn't in areasSwept; only touch swept areas),
// plus the remembered-delta merge and run-history append, now live in the
// pure, separately-exported buildValidateFindingsUpdate (defined in this
// module, ../cache.js), which bin/code-health.js's cmdValidateFindings hands
// to writeDurableState as its mutator. It is unit tested directly with
// plain-object fixtures in
// tests/bin-lib/code-health/build-validate-findings-update.test.js — no
// git/gh involved. That extraction was necessary because durable-integration.test.js
// and tests/bin-lib/code-health/cli-nextslice.test.js only ever exercise the
// read side (readDurableState) or retry-queue drain: every CLI-level test
// that reaches cmdValidateFindings's persistence step fails its `git fetch
// origin health-state` first (no real GitHub-hosted remote configured in any
// test), so the mutator itself was never actually invoked by any prior test —
// despite an earlier version of this comment claiming otherwise. The write
// path's own git/gh mechanics (blob/tree/commit/ref calls) are covered by
// tests/bin-lib/health-core/durable-state.test.js's fake-runner tests, using
// trivial synthetic mutators (not this one); those tests cannot be
// re-exercised for real without live GitHub credentials.

const { readDurableState, writeDurableState } = require('../../../plugin/bin/lib/code-health/cache');

test('readDurableState/writeDurableState are bound to the code-health skill name', () => {
  // cache.js's exports are already bound instances (createDurableState('code-health', ...)
  // called once at module load) — this test only proves the shape is right
  // (both are functions). Their actual read/write behavior against a
  // fresh/empty branch, a populated branch, CAS retries, and bootstrap is
  // exercised thoroughly, with a real fake command-runner, by
  // tests/bin-lib/health-core/durable-state.test.js — no need to duplicate
  // that here.
  assert.strictEqual(typeof readDurableState, 'function');
  assert.strictEqual(typeof writeDurableState, 'function');
});
