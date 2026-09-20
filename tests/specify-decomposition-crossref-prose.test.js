// tests/specify-decomposition-crossref-prose.test.js
//
// Pins record #490's prose wiring: record-creation-subissues.md must invoke
// decomposition-crossref.js's crossReferenceKeyFiles once per decomposition
// batch, and decomposition-mode.md must note that a unit's own Key Files list
// is scope-only, extended later by the cross-reference pass. The mechanical
// half (identifier -> file resolution, dedup, test-file exclusion) is pinned
// separately in tests/bin-lib/issues/decomposition-crossref.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SUBISSUES = read('plugin/skills/specify/record-creation-subissues.md');
const DECOMP_MODE = read('plugin/skills/specify/decomposition-mode.md');

test('record-creation-subissues.md invokes crossReferenceKeyFiles once per batch, after accumulation and before Snapshot invalidation', () => {
  assert.match(SUBISSUES, /crossReferenceKeyFiles\(units, grep\)/);
  const crossRefIdx = SUBISSUES.indexOf('Cross-reference forward/backward Key Files');
  const snapshotIdx = SUBISSUES.indexOf('Snapshot invalidation');
  assert.ok(crossRefIdx !== -1, 'the cross-reference step must be documented');
  assert.ok(snapshotIdx !== -1, 'Snapshot invalidation must still exist');
  assert.ok(crossRefIdx < snapshotIdx, 'cross-referencing must run before the batch-final snapshot invalidation');
});

test('record-creation-subissues.md accumulates every unit\'s title/id/body for the cross-reference pass, surviving the per-iteration temp-file overwrite', () => {
  assert.match(SUBISSUES, /Accumulate this unit for the cross-reference pass/);
  assert.match(SUBISSUES, /specify-decomp-manifest\.json/);
});

test('record-creation-subissues.md writes cross-referenced additions back via the existing write-path-resilience contract, never a new failure mode', () => {
  const section = SUBISSUES.slice(SUBISSUES.indexOf('Cross-reference forward/backward Key Files'));
  assert.match(section, /per \*\*Write-path resilience\*\* above/);
});

test('decomposition-mode.md marks a unit\'s own drafted Key Files list as scope-only, citing the Step 3 cross-reference pass', () => {
  assert.match(DECOMP_MODE, /scope-only\*\s*list/);
  assert.match(DECOMP_MODE, /record-creation-subissues\.md.*Cross-reference forward\/backward Key Files/);
});

test('the cited module actually exports crossReferenceKeyFiles', () => {
  const mod = require('../plugin/bin/lib/issues/decomposition-crossref');
  assert.strictEqual(typeof mod.crossReferenceKeyFiles, 'function');
});
