// normalizeTitle linearity budget (#5222) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// events.js's normalizeTitle runs on the implementer's commit title (steps.js's commit step,
// once per implementer launch, the review step's fix round included), which nothing bounds:
// the result schema's `title` is a bare string and the launcher checks only for line breaks.
// It ended with `.replace(/(?:\s*\.)+\s*$/, '')`, quadratic on a long run of dots or `. `
// pairs: '.'.repeat(80000) + 'x' took about 25 s and '. '.repeat(80000) + 'x' about 96 s
// (measured through review.js's normalizeEventText, before its input bound). A backward hand
// scan, dropTrailingDots, replaces it. Lives outside tests/ because a wall-clock assertion
// flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeTitle } = require('../plugin/bin/lib/driver/events');

const N = 100000;
const PAIRS = `a${'. '.repeat(N)}x`;
const DOTS_BEFORE_LETTER = `${'.'.repeat(N)}x`;
const CASES = [
  ['dot run before a letter', DOTS_BEFORE_LETTER, DOTS_BEFORE_LETTER],
  ['". " pairs before a letter', PAIRS, PAIRS],
  ['trailing dot run', `a${'.'.repeat(N)}`, 'a'],
  ['trailing " ." pairs', `a${' .'.repeat(N)}`, 'a'],
];

for (const [name, input, expected] of CASES) {
  test(`normalizeTitle: ${name} (~100k characters or more) stays under 1000 ms`, () => {
    const start = performance.now();
    const out = normalizeTitle(input);
    const elapsed = performance.now() - start;
    assert.ok(out === expected, `verdict changed (length ${out.length}, expected length ${expected.length})`);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — the trailing-dot cut must be one pass`);
  });
}
