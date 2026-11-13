// readWorkflowShape linearity budget (#5162) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// init's CI workflow review runs readWorkflowShape (plugin/bin/lib/merge-verification.js) over
// every project-authored workflow file, text no caller bounds. Each probe asserts the verdict as
// well as the time:
//   - a 200 KB job-level `if:` of `a && ` repeated (the comment strip, the alias scan, the join);
//   - 40,000 blank lines between `on:` and `jobs:` (the region walk never rescans blank runs);
//   - a 40,000-line `run: |` block under one step (block-scalar content is skipped once);
//   - a 200,000-space run inside one `if:` value (no regex backtracks across the spaces);
//   - 20,000 jobs (the jobs walk keeps one persistent position; it never restarts at `jobs:`).
//     At 5,000 a per-job restart took only 2.0–3.5 s, too close to the budget to stay red on a
//     faster machine; 20,000 makes the quadratic walk about 16 times slower again.
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion
// flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readWorkflowShape } = require('../plugin/bin/lib/merge-verification');

function timed(text) {
  const start = performance.now();
  const shape = readWorkflowShape(text);
  return { shape, ms: performance.now() - start };
}

test('a 200 KB job-level if: stays linear', () => {
  const { shape, ms } = timed(`on: push\njobs:\n  a:\n    if: ${'a && '.repeat(40000)}b\n`);
  assert.ok(shape.jobs[0].if.length > 0);
  assert.deepEqual(shape.unparsed, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});

test('40,000 blank lines between on: and jobs: stay linear', () => {
  const { shape, ms } = timed(`on: push\n${'\n'.repeat(40000)}jobs:\n  a:\n    runs-on: x\n`);
  assert.equal(shape.jobs.length, 1);
  assert.deepEqual(shape.unparsed, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});

test('a 40,000-line run: block under one step stays linear', () => {
  const script = Array.from({ length: 40000 }, (_, i) => `          if [ -f f${i} ]; then echo; fi\n`).join('');
  const { shape, ms } = timed(`on: push\njobs:\n  a:\n    steps:\n      - run: |\n${script}`);
  assert.equal(shape.jobs[0].stepIfCount, 0);
  assert.deepEqual(shape.unparsed, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});

test('a 200,000-space run inside one if: value stays linear', () => {
  const { shape, ms } = timed(`on: push\njobs:\n  a:\n    if: a${' '.repeat(200000)}b\n`);
  assert.ok(shape.jobs[0].if.startsWith('a'));
  assert.deepEqual(shape.unparsed, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});

test('20,000 jobs are read in one forward pass', () => {
  const jobs = Array.from({ length: 20000 }, (_, i) => `  j${i}:\n    runs-on: x\n`).join('');
  const { shape, ms } = timed(`on: push\njobs:\n${jobs}`);
  assert.equal(shape.jobs.length, 20000);
  assert.equal(shape.jobs[19999].id, 'j19999');
  assert.deepEqual(shape.unparsed, []);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
});
