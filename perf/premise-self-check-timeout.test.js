// Premise self-check timeout budget (#1829) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// premiseReadsUnresolved kills a hung command at its timeout and drops the line. A `sleep 5` with a
// 100 ms timeout must return well before the full sleep, so under 4 s proves the kill path fired
// rather than the command being waited out. Lives outside tests/ because a wall-clock assertion
// flakes under sibling-suite load; the functional half (the hung command reads resolved, since an
// un-killed `sleep 5` exits 0 and reads unresolved) stays in
// tests/bin-lib/health-core/premise-self-check.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { premiseReadsUnresolved } = require('../plugin/bin/lib/health-core/premise-self-check');

// Temp dir name deliberately contains a space, matching the tests/ suite's fixture.
function tmpWithSpace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'premise self-check-')); }

test('real shell: a hung command is killed at the timeout and dropped', () => {
  const dir = tmpWithSpace();
  const start = Date.now();
  assert.strictEqual(premiseReadsUnresolved('sleep 5', { root: dir, timeoutMs: 100 }), false);
  assert.ok(Date.now() - start < 4000, 'must not wait for the full sleep');
});
