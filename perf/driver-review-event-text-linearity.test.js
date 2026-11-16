// normalizeEventText linearity budget (#5222) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// review.js's normalizeEventText runs on reviewer text no caller bounds (a finding's claim and
// path, an envelope's detail). It called events.js's normalizeTitle, whose trailing
// `(?:\s*\.)+\s*$` is quadratic on a long run of dots, on the whole string and cut to
// EVENT_TEXT_MAX_CHARS only afterwards: '.'.repeat(80000) + 'x' took about 25 s and
// '. '.repeat(80000) + 'x' about 96 s. The input is now cut to EVENT_TEXT_INPUT_MAX_CHARS first.
// Lives outside tests/ because a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeEventText } = require('../plugin/bin/lib/driver/review');

const CASES = [
  ['dot run', `${'.'.repeat(80000)}x`, ''],
  ['dot-and-space run', `a${'. '.repeat(100000)}x`, 'a'],
  ['dot run across line breaks', `a${'.\n'.repeat(100000)}x`, 'a'],
];

for (const [name, input, expected] of CASES) {
  test(`normalizeEventText: ${name} (~100k characters or more) stays under 1000 ms`, () => {
    const start = performance.now();
    const out = normalizeEventText(input);
    const elapsed = performance.now() - start;
    assert.ok(out === expected, `verdict changed (length ${out.length}, expected length ${expected.length})`);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — normalizeTitle must only ever see bounded text`);
  });
}
