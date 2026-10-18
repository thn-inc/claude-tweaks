// Closing-keyword regex linearity budget (#3412) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// release-merged.js scans a merge-commit message for a line-anchored GitHub
// closing keyword. Under `/m`, a `\s`-based grammar restarts `^\s*` at every
// line and runs across newlines, which is quadratic on blank-line runs
// (40k newlines took ~16s before the `[ \t]` fix) and ran synchronously after
// the fetch, where no timeout could stop it. This pins the scan as linear on
// that input. Lives outside tests/ for the same reason the other perf/ files
// do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { prClosesIssue } = require('../plugin/bin/lib/reconcile/release-merged');

test('prClosesIssue: a long run of blank lines before the keyword stays linear', () => {
  // The blank run must be followed by a non-matching line: a greedy `\s*` that goes on to match
  // would finish at once, so only a failing tail exposes the quadratic backtracking.
  const message = `${'\n'.repeat(40000)}x\nFixes #3311`;
  const start = performance.now();
  const verdict = prClosesIssue({ closingIssuesReferences: [] }, 3311, 'acme/w', message);
  const elapsed = performance.now() - start;
  assert.equal(verdict, true);
  assert.ok(elapsed < 200, `matching took ${elapsed.toFixed(0)}ms — the keyword regex must not backtrack across newlines`);
});
