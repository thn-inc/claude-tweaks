// Review-replay branch-role reader linearity budget (#5992) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// shaPairOf, pointerPathOf and originRefsOf (tools/review-replay/reviews-rewrite.js) and parseBranchReply
// (tools/review-replay/reviews-score.js) read archived prompts and replies of unbounded length. Each case pins its
// answer as well as its time, so a fix that returns early on the long input cannot pass on the clock alone. Lives
// outside tests/ because a wall-clock assertion flakes under sibling-suite load (tests/wall-clock-budget-conformance).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const rw = require('../tools/review-replay/reviews-rewrite');
const { parseBranchReply } = require('../tools/review-replay/reviews-score');

const BUDGET_MS = 500;
const marker = '(it is your prompt): ';

const cases = [
  ['shaPairOf: "base " repeated', () => rw.shaPairOf('base '.repeat(50000)), (v) => v === null],
  ['shaPairOf: spaces', () => rw.shaPairOf(' '.repeat(200000)), (v) => v === null],
  ['shaPairOf: a hex-letter run', () => rw.shaPairOf('a'.repeat(200000)), (v) => v === null],
  // Many sha-bearing "base" lines and no head: a lazy base-to-head scan restarts from each one (quadratic).
  ['shaPairOf: many base lines, no head', () => rw.shaPairOf('base 44200e4559 '.repeat(20000)), (v) => v === null],
  ['pointerPathOf: marker then spaces', () => rw.pointerPathOf(marker + ' '.repeat(200000)), (v) => v === null],
  ['pointerPathOf: marker then a long path', () => rw.pointerPathOf(marker + 'a'.repeat(200000)), (v) => v === 'a'.repeat(200000)],
  ['pointerPathOf: open marker then spaces', () => rw.pointerPathOf('(it is your prompt' + ' '.repeat(200000)), (v) => v === null],
  // The "this file" scan: one long would-be path line of many space-separated pieces, and many short lines.
  ['pointerPathOf: one long spaced path line', () => rw.pointerPathOf('in this file\n/' + 'a '.repeat(100000)), (v) => v === null],
  ['pointerPathOf: many lone path lines', () => rw.pointerPathOf('in this file\n' + '/a/b.md\n'.repeat(50000)), (v) => v === null],
  ['pointerPathOf: space-tab run', () => rw.pointerPathOf('in this file ' + ' \t'.repeat(100000)), (v) => v === null],
  // originRefsOf: a lazy capture with a terminator lookahead rescanned the run from every origin/ in it (12.7 s at
  // 30000 repeats before the hand-cut scan).
  ['originRefsOf: origin/ repeated, non-terminator end', () => rw.originRefsOf('origin/'.repeat(30000) + '!'), (v) => v.length === 0],
  ['originRefsOf: origin/a/ repeated, non-terminator end', () => rw.originRefsOf('origin/a/'.repeat(25000) + '!'), (v) => v.length === 0],
  ['originRefsOf: origin/ repeated, then the end', () => rw.originRefsOf('origin/'.repeat(30000)), (v) => v.length === 0],
  ['originRefsOf: trailing dot run', () => rw.originRefsOf('origin/main' + '.'.repeat(200000) + '!'), (v) => v.length === 1 && v[0] === 'main'],
  ['originRefsOf: x.. repeated', () => rw.originRefsOf('origin/' + 'x..'.repeat(60000)), (v) => v.length === 1 && v[0] === 'x'],
  // parseBranchReply's line-start "No issues" read.
  ['parseBranchReply: one long non-word line', () => parseBranchReply('-'.repeat(200000)), (v) => v === null],
  ['parseBranchReply: many bullet-only lines', () => parseBranchReply('- *\n'.repeat(50000)), (v) => v === null],
];

for (const [name, run, verdict] of cases) {
  test(`linear: ${name}`, () => {
    const start = performance.now();
    const value = run();
    const elapsed = performance.now() - start;
    assert.ok(verdict(value), `unexpected answer (length ${JSON.stringify(value).length})`);
    assert.ok(elapsed < BUDGET_MS, `took ${elapsed.toFixed(0)}ms — a scan here must not backtrack`);
  });
}
