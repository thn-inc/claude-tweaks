// Driver `neutralize` regex linearity budget (#5269) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// neutralize() cleans worker-controlled text before it reaches a commit title, a PR body or an event
// line, and that text is uncapped. These shapes were found when the closing-keyword rule narrowed to
// "only before a reference" and the reference passes began repeating to a fixed point:
//   - `fix` + a long whitespace run + a non-reference: the lookahead grammar `\s*:?\s*` split the run
//     two ways at every length, quadratic (60k spaces took ~7.6s pre-fix; now `(?:\s*:)?\s*`).
//   - a keyword + a whitespace run + a colon + a reference: same split, same pre-fix cost class.
//   - many fragments that each need a second removal pass (`h#7ttps://…` rebuilt into a URL): the
//     fixed-point loop must stay linear in the number of fragments; pre-loop the verdict was wrong
//     (a closing URL survived), so that case is guarded by its verdict as well as its time.
// A long run of identifier characters with no `/` is quadratic in QUALIFIED_REF already on the base
// code (50k `h` took ~4s); it is out of this record's scope and deliberately not pinned here.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes
// under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { neutralize } = require('../plugin/bin/lib/driver/events');

function timed(input) {
  const start = performance.now();
  const value = neutralize(input);
  return { value, elapsed: performance.now() - start };
}

test('neutralize: a keyword followed by a long whitespace run and no reference stays linear', () => {
  const { value, elapsed } = timed(`fix${' '.repeat(100000)}x`);
  assert.ok(value === 'fix x', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword lookahead must not backtrack over the whitespace run`);
});

test('neutralize: a keyword, a long whitespace run, a colon and a reference stays linear', () => {
  const { value, elapsed } = timed(`Fixes${' '.repeat(100000)}:${' '.repeat(10)}#12`);
  assert.ok(value === '', `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)}ms — the keyword lookahead must not backtrack over the whitespace run`);
});

test('neutralize: many fragments that each need a second removal pass stay linear', () => {
  const fragment = 'Add Closes h#7ttps://github.com/o/r/issues/5 now ';
  const { value, elapsed } = timed(fragment.repeat(2000));
  const expected = 'Add now '.repeat(2000).trim();
  assert.ok(value === expected, `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — the fixed-point loop must not rescan per fragment`);
});

test('neutralize: a run of bare references that collapses to prose stays linear', () => {
  const { value, elapsed } = timed('h#1'.repeat(5000));
  assert.ok(value === 'h'.repeat(5000), `verdict changed (length ${value.length})`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms`);
});
