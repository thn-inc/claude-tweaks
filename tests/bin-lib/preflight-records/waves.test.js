'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planParallelWaves } = require('../../../plugin/bin/lib/preflight-records/waves');

const rec = (blockedBy, keyFiles) => ({ blockedBy, keyFiles });

test('AC2.1: two mutually independent records with disjoint files share one wave', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2] }), { waves: [[1, 2]], parallel: true });
});

test('AC3.1: a strict linear chain yields only singleton waves, in dependency order', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']), 3: rec([2], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }), { waves: [[1], [2], [3]], parallel: false });
});

test('diamond: the two middle records run together, after their blocker and before their dependent', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']), 3: rec([1], ['c.js']), 4: rec([2, 3], ['d.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3, 4] }).waves, [[1], [2, 3], [4]]);
});

test('a dependent listed before its blocker still lands in a later wave', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([1], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [2, 1] }).waves, [[1], [2]]);
});

test('file-overlapping records at the same level are split, still running beside an independent one', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], ['a.js', 'x.js']), 3: rec([], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1, 3], [2]]);
});

test('a hub file shared by three records still separates them (hub paths do not exempt concurrency)', () => {
  const hub = 'docs/plugin-structure.md';
  const records = { 1: rec([], [hub, 'a.js']), 2: rec([], [hub, 'b.js']), 3: rec([], [hub, 'c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1], [2], [3]]);
});

test('a record with no Key Files gets a wave of its own', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], []), 3: rec([], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[1, 3], [2]]);
});

test('a record with a bare-directory Key Files entry gets a wave of its own', () => {
  const records = { 1: rec([], ['tests/']), 2: rec([], ['tests/']), 3: rec([], ['c.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }).waves, [[3], [1], [2]]);
});

test('a level whose records all lack Key Files runs them one per wave, in run order', () => {
  const records = { 1: rec([], []), 2: rec([], ['lib/']), 3: rec([], []) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3] }), { waves: [[1], [2], [3]], parallel: false });
});

test('overlap is transitive: two records sharing no file are still split through a third', () => {
  const records = { 1: rec([], ['a.js']), 2: rec([], ['a.js', 'c.js']), 3: rec([], ['c.js']), 4: rec([], ['d.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2, 3, 4] }).waves, [[1, 4], [2], [3]]);
});

test('a blocker outside the run does not delay a record', () => {
  const records = { 1: rec([99], ['a.js']), 2: rec([], ['b.js']) };
  assert.deepEqual(planParallelWaves({ records, numbers: [1, 2] }).waves, [[1, 2]]);
});

test('a dependency cycle throws instead of recursing forever', () => {
  const records = { 1: rec([2], ['a.js']), 2: rec([1], ['b.js']) };
  assert.throws(() => planParallelWaves({ records, numbers: [1, 2] }), /dependency cycle through #/);
});
