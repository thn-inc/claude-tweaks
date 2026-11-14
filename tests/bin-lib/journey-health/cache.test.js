const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  cachePath, readCache, writeCache, createDurable,
} = require('../../../plugin/bin/lib/journey-health/cache');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'journey-health-cache-')); }

test('readCache returns {} when the cache file does not exist', () => {
  const root = tmp();
  assert.deepStrictEqual(readCache(root), {});
});

test('writeCache then readCache round-trips', () => {
  const root = tmp();
  writeCache(root, { 'journeyhealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
  assert.deepStrictEqual(readCache(root), { 'journeyhealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
});

test('cachePath points under .claude-tweaks/journey-health/cache.json', () => {
  const root = tmp();
  assert.strictEqual(cachePath(root), path.join(root, '.claude-tweaks', 'journey-health', 'cache.json'));
});

// readCursors/writeCursors/recordAudit/readCoverageScanCursor/recordCoverageScan/
// recordRun/readRuns/computeChurn (local-disk cursor + run-log persistence)
// were removed by the health-state migration — cursors and run history now
// live on the durable health-state branch
// (bin/lib/health-core/durable-state.js), not local disk. The cursor-merge
// semantics these tests used to cover directly (set a per-journey light/deep
// audit cursor without clobbering the sibling tier, set the coverage-scan
// cursor, leave unrelated cursor keys untouched) now live in the pure,
// separately-exported buildValidateFindingsUpdate (defined in this module,
// ../cache.js), which bin/journey-health.js's cmdValidateFindings hands to
// writeDurableState as its mutator. It is unit tested directly with
// plain-object fixtures in
// tests/bin-lib/journey-health/build-validate-findings-update.test.js — no
// git/gh involved. That extraction was necessary because
// tests/bin-lib/journey-health/durable-integration.test.js and the CLI-level
// tests in cli-validate-findings.test.js only ever exercise the read side
// (readDurableState) or a run that fails its `git fetch origin health-state`
// (no real GitHub-hosted remote configured in any test) and never actually
// invokes the mutator itself. The write path's own git/gh mechanics
// (blob/tree/commit/ref calls) are covered by
// tests/bin-lib/health-core/durable-state.test.js's fake-runner tests, using
// trivial synthetic mutators (not this one); those tests cannot be
// re-exercised for real without live GitHub credentials. computeChurn is a
// pure function shared with harness-health and is fully covered by
// tests/bin-lib/health-core/runs.test.js — no need to duplicate it here.

const { readDurableState, writeDurableState } = require('../../../plugin/bin/lib/journey-health/cache');

test('readDurableState/writeDurableState are exported and bound to journey-health', () => {
  // cache.js's exports are already bound instances (createDurableState('journey-health')
  // called once at module load) — this test only proves the shape is right
  // (both are functions). Their actual read/write behavior against a
  // fresh/empty branch, a populated branch, CAS retries, and bootstrap is
  // exercised thoroughly, with a real fake command-runner, by
  // tests/bin-lib/health-core/durable-state.test.js — no need to duplicate
  // that here.
  assert.strictEqual(typeof readDurableState, 'function');
  assert.strictEqual(typeof writeDurableState, 'function');
});

test('createDurable returns the durable accessors and routes git stderr to the injected sink', () => {
  let err = '';
  const root = tmp();
  const durable = createDurable({ env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) }, stderr: (t) => { err += t; } });
  assert.deepStrictEqual(Object.keys(durable).sort(), ["readDurableState","writeDurableState"]);
  assert.deepStrictEqual(durable.readDurableState(root), { cursors: {}, retryQueue: [], runs: [], declined: {} });
  assert.match(err, /health-state: fetch failed/);
});
