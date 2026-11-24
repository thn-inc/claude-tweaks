// `classifyPairLine` linearity budget (#5556) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// A strict pair-line pattern with several unanchored `.+` groups took seconds on a long decisions.md line that
// repeats the pattern's own delimiter (absence-refuted: about 11.7 s at 22 KB before the groups were split at
// their delimiters; 1.6 ms after). A strict pattern is also tried on a line past the loose-pattern cap, and the
// yield is derived inside the synchronous close hook, so a slow line stalls a close. Lives outside tests/ for the
// reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load
// (tests/wall-clock-budget-conformance.test.js). The verdict is asserted next to every clock.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyPairLine } = require('../plugin/bin/lib/timing/pair-lines');

const BUDGET_MS = 250;

const LINES = [
  ['absence-refuted, repeated whole clause', `Reproduction: lens "3a" absence claim ${'a:b refuted by ground-truth check (x found it at y:1). '.repeat(400)}`],
  ['absence-refuted, repeated tail', `Reproduction: lens "3a" absence claim a:b refuted by ground-truth check (${'x found it at y:1). '.repeat(400)}`],
  ['coincidence, repeated locations', `Reproduction: lens "3a" findings ${'a:1 / a:1 '.repeat(400)}`],
  ['coincidence, repeated separator', `Reproduction: lens "3a" findings ${'a:1 / '.repeat(400)}share a location but not substance; both staged unconfirmed.`],
  ['single-read-coverage, repeated blocked reason', `Reproduction: lens "3a" blocked: ${'x; single-read coverage. Reversibility: high. '.repeat(400)}x`],
  ['vacuity-reconfirmed, repeated clause', `Reproduction: lens "3f" vacuity finding ${'a:1 re-confirmed by executed run: x → y. Confirmed. '.repeat(400)}`],
];

for (const [label, line] of LINES) {
  test(`classifyPairLine reads a repeated-delimiter line in linear time: ${label}`, () => {
    const start = performance.now();
    const got = classifyPairLine(line);
    const ms = performance.now() - start;
    assert.equal(got, null);
    assert.ok(ms < BUDGET_MS, `${label}: ${line.length} chars took ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
  });
}
