// guard-refusals sed-script scan linearity budget (#5587) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// tools/guard-refusals/effect.js's sedScriptEffect() reads a sed script from one Bash call's text,
// which nothing bounds. It is a single forward pass written by hand: each case here is an input
// built from the scan's own alphabet, most without the terminator that ends a section, with its
// verdict and a 1000 ms budget through classifyByTables (the word tables without the write gate).
// Measured when written (2026-11-16): every case under 100 ms at these sizes.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyByTables } = require('../tools/guard-refusals/effect');

const BUDGET_MS = 1000;

const CASES = [
  { what: "'s/a/b/;' x 40000", text: `sed '${'s/a/b/;'.repeat(40000)}' f`, expect: 'read' },
  { what: "'s/a/b/;' x 40000 then 'w out'", text: `sed '${'s/a/b/;'.repeat(40000)}w out' f`, expect: 'write' },
  { what: 'an s regex of 200000 backslashes, never closed', text: `sed 's/${'\\'.repeat(200001)}' f`, expect: 'unknown' },
  { what: "an s regex of '[' x 200000", text: `sed 's/${'['.repeat(200000)}/x/' f`, expect: 'unknown' },
  { what: "an s regex of '[:' x 100000 inside a bracket", text: `sed 's/[${'[:'.repeat(100000)}/x/' f`, expect: 'unknown' },
  { what: "'/a/' x 100000 then 'p'", text: `sed -n '${'/a/'.repeat(100000)}p' f`, expect: 'read' },
  { what: 'a regex address of 200000 characters, never closed', text: `sed '/${'a'.repeat(200000)}' f`, expect: 'unknown' },
  { what: "'b x;' x 50000", text: `sed '${'b x;'.repeat(50000)}' f`, expect: 'read' },
  // Many lines: a text command's continuation and a comment each stop at their own line.
  { what: "'a x\\\\\\n' x 40000", text: `sed '${'a x\\\n'.repeat(40000)}' f`, expect: 'read' },
  { what: "'#c\\n' x 40000 then 'w out'", text: `sed '${'#c\n'.repeat(40000)}w out' f`, expect: 'write' },
  { what: "'-e p ' x 20000", text: `sed ${'-e p '.repeat(20000)}f`, expect: 'read' },
];

for (const { what, text, expect } of CASES) {
  test(`sed script scan stays linear: ${what}`, () => {
    const start = performance.now();
    const { effect } = classifyByTables(text);
    const elapsed = performance.now() - start;
    assert.strictEqual(effect, expect, what);
    assert.ok(elapsed < BUDGET_MS, `${what}: took ${elapsed.toFixed(0)}ms`);
  });
}
