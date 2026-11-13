// reduceDetail linearity budget (#5219) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// settle.js's reduceDetail runs on a worker-controlled stop.detail that has no upstream cap. A
// first fix for a trailing `)` after a path used a lazy `\S*?` with a lookahead, which re-ran the
// lookahead over a long run of `.` or `)`: 7.3 s at 32k and 29 s at 64k characters on
// '/a' + '.'.repeat(n) + 'x'. The greedy match plus a hand-walked tail is linear. Lives outside
// tests/ because a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { reduceDetail } = require('../plugin/bin/lib/driver/settle');

const N = 100000;
const CASES = [
  ['dot run before a non-path char', '/a' + '.'.repeat(N) + 'x', '<path>'],
  ['the same on a Windows drive path', 'C:/a' + '.'.repeat(N) + 'x', '<path>'],
  ['slash run', '/'.repeat(N), '/'],
  ['closing-paren run', ')'.repeat(N), ')'.repeat(200)],
  ['paren-and-dot tail on a path', '/a' + ').'.repeat(N / 2), ('<path>' + ').'.repeat(N / 2)).slice(0, 200)],
];

for (const [name, input, expected] of CASES) {
  test(`reduceDetail: ${name} (100k characters) stays under 200 ms`, () => {
    const start = performance.now();
    const out = reduceDetail(input);
    const elapsed = performance.now() - start;
    assert.ok(out === expected, `verdict changed (length ${out.length}, expected length ${expected.length})`);
    assert.ok(elapsed < 200, `took ${elapsed.toFixed(0)}ms — the path redaction must not backtrack over a long run`);
  });
}
