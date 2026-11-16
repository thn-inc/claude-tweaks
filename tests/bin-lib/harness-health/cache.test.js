const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  cachePath, readCache, writeCache, createDurable,
} = require('../../../plugin/bin/lib/harness-health/cache');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-health-cache-')); }

test('readCache returns {} when the cache file does not exist', () => {
  const root = tmp();
  assert.deepStrictEqual(readCache(root), {});
});

test('writeCache then readCache round-trips', () => {
  const root = tmp();
  writeCache(root, { 'skillhealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
  assert.deepStrictEqual(readCache(root), { 'skillhealth-abc123': { status: 'staged', lastSeenMs: 1000 } });
});

test('cachePath points under .claude-tweaks/harness-health/cache.json', () => {
  const root = tmp();
  assert.strictEqual(cachePath(root), path.join(root, '.claude-tweaks', 'harness-health', 'cache.json'));
});

// readCursors/writeCursors/recordAudit/readGapScanCursor/recordGapScan/
// recordRun/readRuns (local-disk cursor + run-log persistence) were removed
// by the health-state migration — cursors and run history now live on the
// durable health-state branch (bin/lib/health-core/durable-state.js), not
// local disk. The cursor-merge semantics these tests used to cover directly
// (set a per-target audit cursor, set the gap-scan cursor, leave unrelated
// cursor keys untouched) now live in the pure, separately-exported
// buildValidateFindingsUpdate (defined in this module, ../cache.js), which
// bin/harness-health.js's cmdValidateFindings hands to writeDurableState as
// its mutator. It is unit tested directly with plain-object fixtures in
// tests/bin-lib/harness-health/build-validate-findings-update.test.js — no
// git/gh involved. That extraction was necessary because
// tests/bin-lib/harness-health/durable-integration.test.js and the CLI-level
// tests in cli-validate-findings.test.js only ever exercise the read side
// (readDurableState) or a run that fails its `git fetch origin health-state`
// (no real GitHub-hosted remote configured in any test) and never actually
// invokes the mutator itself. The write path's own git/gh mechanics
// (blob/tree/commit/ref calls) are covered by
// tests/bin-lib/health-core/durable-state.test.js's fake-runner tests, using
// trivial synthetic mutators (not this one); those tests cannot be
// re-exercised for real without live GitHub credentials. computeChurn is a
// pure function shared with journey-health and is fully covered by
// tests/bin-lib/health-core/runs.test.js — no need to duplicate it here.

const { readDurableState, writeDurableState } = require('../../../plugin/bin/lib/harness-health/cache');

test('readDurableState/writeDurableState are exported and bound to harness-health', () => {
  // cache.js's exports are already bound instances (createDurableState('harness-health')
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
  // GIT_DIR names an empty repo with no origin remote: the fetch then fails with
  // a remote-specific message that a non-repo root (env ignored) never produces.
  const repo = tmp();
  execFileSync('git', ['init', '-q', repo]);
  const durable = createDurable({ env: { ...process.env, GIT_DIR: path.join(repo, '.git') }, stderr: (t) => { err += t; } });
  assert.deepStrictEqual(Object.keys(durable).sort(), ["pushDurableState","readDurableState","writeDurableState","writeDurableStateLocal"]);
  assert.deepStrictEqual(durable.readDurableState(root), { cursors: {}, retryQueue: [], runs: [], remembered: {}, declined: {} });
  assert.match(err, /health-state: fetch failed.*does not appear to be a git repository/s);
});
