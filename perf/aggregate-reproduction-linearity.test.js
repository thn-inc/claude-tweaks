// Aggregate-reproduction detector linearity budget (#4581) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// log-decision.js runs aggregateReproductionProblem on every STAGED entry it writes, so a super-linear scan stalls the
// review that logs it. Three were found: an unanchored global PATH_RE restarting inside a long dot-free token (158 s at
// 200k characters), the full FINDING_PATH location test restarting the same way inside a coincidence location (82 s),
// and #4632's lazy coincidence locations rescanning to the end once per ` / ` split (12 s). This pins each as linear.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateReproductionProblem } = require('../plugin/bin/lib/log-decision/aggregate-reproduction');

const BUDGET_MS = 750;
const timed = (text) => {
  const start = performance.now();
  const value = aggregateReproductionProblem({ status: 'STAGED', text });
  return { value, ms: performance.now() - start };
};

for (const [label, text, refused] of [
  ['a per-finding line followed by a 200k-character path-shaped token', `Reproduction: lens "3a" finding a.js:1 ${'a'.repeat(200000)}`, false],
  ['a coincidence line whose first location is a 200k-character dot-free token', `Reproduction: lens "3a" findings ${'a'.repeat(200000)}:1 / b.js:2 share a location`, true],
  ['a coincidence-shaped line with 25k ` / ` splits', `Reproduction: lens "3a" findings ${'a b:1 / '.repeat(25000)}`, true],
]) {
  test(`aggregateReproductionProblem: ${label} stays linear`, () => {
    const { value, ms } = timed(text);
    assert.strictEqual(value !== null, refused);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}
