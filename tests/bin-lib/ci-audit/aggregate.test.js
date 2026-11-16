'use strict';
// tests/bin-lib/ci-audit/aggregate.test.js — #5757: per-job phase percentiles across runs, the
// critical path over `needs`, matrix shard skew, steps declared in several jobs, which job pairs
// ever ran at the same time, and the jobs left out for unusable timestamps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate } = require('../../../plugin/bin/lib/ci-audit/aggregate');

// Seconds after a fixed base instant, as ISO-8601.
const BASE = Date.parse('2026-11-16T00:00:00Z');
const at = (s) => new Date(BASE + s * 1000).toISOString();

// A NormJob; steps are [name, startS, endS] in run order.
function job(name, created, started, completed, steps = []) {
  return {
    name,
    createdAt: at(created),
    startedAt: at(started),
    completedAt: at(completed),
    conclusion: 'success',
    steps: steps.map(([n, s, e], i) => ({ name: n, number: i + 1, startedAt: at(s), completedAt: at(e) })),
  };
}
const run = (id, workflow, jobs) => ({ id, workflow, conclusion: 'success', createdAt: at(0), jobs });
const fj = (id, overrides = {}) => ({ id, name: id, needs: [], timeoutDeclared: false, matrix: false, steps: [], ...overrides });
const facts = (jobs, unparsed = []) => ({ jobs, concurrencyDeclared: false, unparsed });
const CMD = (name) => ({ name, kind: 'command' });
const ACT = (name) => ({ name, kind: 'action' });
const stat = (p50s, p90s, n) => ({ p50Ms: p50s === null ? null : p50s * 1000, p90Ms: p90s === null ? null : p90s * 1000, n });
const find = (agg, workflow, name) => agg.jobs.find((j) => j.workflow === workflow && j.job === name);

const W = 'workflows/ci.yml';
const W_FACTS = facts([
  fj('build', { steps: [ACT('Checkout'), CMD('Install'), CMD('Build')] }),
  fj('test', { needs: ['build'], steps: [ACT('Checkout'), CMD('Install'), CMD('Test')] }),
  fj('docs', { steps: [CMD('Install'), CMD('Docs')] }),
]);
const build = (created, started, install, completed, setUpEnd, buildStart) => job('build', created, started, completed, [
  ['Set up job', started, setUpEnd],
  ['Checkout', setUpEnd, install],
  ['Install', install, buildStart],
  ['Build', buildStart, completed],
]);
const simple = (name, last, created, started, install, completed) => job(name, created, started, completed, [
  ['Set up job', started, install],
  ['Install', install, install + 1],
  [last, install + 1, completed],
]);
const W_RUNS = [
  run(1, W, [build(0, 10, 30, 100, 20, 50), simple('test', 'Test', 100, 110, 120, 200), simple('docs', 'Docs', 0, 5, 10, 60)]),
  run(2, W, [build(0, 20, 50, 140, 35, 80), simple('test', 'Test', 140, 150, 165, 260), simple('docs', 'Docs', 0, 5, 10, 60)]),
  run(3, W, [build(0, 5, 15, 85, 10, 35), simple('test', 'Test', 85, 100, 110, 175), simple('docs', 'Docs', 0, 90, 95, 150)]),
  // startedAt before createdAt: excluded, no figures.
  run(4, W, [job('build', 50, 40, 300)]),
];

test('aggregate gives exact per-phase percentiles and run counts per job', () => {
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  const b = find(agg, W, 'build');
  assert.equal(b.runs, 3);
  assert.deepEqual(b.waiting, stat(10, 20, 3));
  assert.deepEqual(b.setup, stat(20, 30, 3));
  assert.deepEqual(b.running, stat(70, 90, 3));
  const t = find(agg, W, 'test');
  assert.deepEqual(t.waiting, stat(10, 15, 3));
  assert.deepEqual(t.setup, stat(10, 15, 3));
  assert.deepEqual(t.running, stat(80, 95, 3));
  assert.deepEqual(agg.jobs.map((j) => j.job), ['build', 'docs', 'test']);
});

test('aggregate lists the three slowest steps by p50, ties by name', () => {
  const b = find(aggregate(W_RUNS, { [W]: W_FACTS }), W, 'build');
  assert.deepEqual(b.slowestSteps, [
    { name: 'Build', p50Ms: 50000, n: 3 },
    { name: 'Install', p50Ms: 20000, n: 3 },
    { name: 'Checkout', p50Ms: 10000, n: 3 },
  ]);
});

test('aggregate counts a job whose startedAt precedes createdAt in excluded and gives it no figures', () => {
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  assert.equal(agg.excluded, 1);
  assert.equal(find(agg, W, 'build').runs, 3);
});

test('aggregate critical path follows needs over p50 totals; sumMs adds every job', () => {
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  // build p50 total of [100, 140, 85] = 100 s; test of [100, 120, 90] = 100 s; docs of [60, 60, 150] = 60 s.
  assert.deepEqual(agg.criticalPaths, [{ workflow: W, pathMs: 200000, sumMs: 260000, chain: ['build', 'test'] }]);
});

test('aggregate overlaps: never-intersecting pair is false, a pair intersecting in one run is true', () => {
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  assert.deepEqual(agg.overlaps, [
    { workflow: W, a: 'build', b: 'docs', everOverlapped: true },
    { workflow: W, a: 'build', b: 'test', everOverlapped: false },
    { workflow: W, a: 'docs', b: 'test', everOverlapped: true },
  ]);
});

test('aggregate repeatedSteps lists step names declared in two or more jobs, most jobs first', () => {
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  assert.deepEqual(agg.repeatedSteps, [
    { name: 'Install', jobs: ['build', 'docs', 'test'] },
    { name: 'Checkout', jobs: ['build', 'test'] },
  ]);
});

const M = 'workflows/matrix.yml';
const M_FACTS = facts([fj('unit', { matrix: true, steps: [CMD('Install')] })]);
const shard = (name, total) => job(name, 0, 2, total, [['Set up job', 2, 4], ['Install', 4, total]]);
const M_RUNS = [run(10, M, [shard('unit (a)', 10), shard('unit (b)', 10), shard('unit (c)', 10), shard('unit (d)', 40), shard('lint (x)', 30)])];

test('aggregate shard skew: totals 10,10,10,40 s give ratio 4 with the slowest shard named', () => {
  const agg = aggregate(M_RUNS, { [M]: M_FACTS });
  // lint (x) is a single shard: no skew entry for its family.
  assert.deepEqual(agg.shardSkews, [{ workflow: M, family: 'unit', ratio: 4, slowest: 'unit (d)', shards: 4 }]);
});

test('aggregate matches a matrix shard to its workflow job by the part before " ("', () => {
  const agg = aggregate(M_RUNS, { [M]: M_FACTS });
  assert.deepEqual(find(agg, M, 'unit (a)').setup, stat(2, 2, 1));
  // lint is not a declared job: no step kinds, so no setup figure.
  assert.deepEqual(find(agg, M, 'lint (x)').setup, stat(null, null, 0));
  // a matrix job weighs as its slowest shard on the critical path.
  assert.deepEqual(agg.criticalPaths, [{ workflow: M, pathMs: 40000, sumMs: 40000, chain: ['unit'] }]);
});

test('aggregate does not match a run job by its base name when the workflow job is not a matrix', () => {
  const agg = aggregate([run(11, M, [shard('unit (a)', 10)])], { [M]: facts([fj('unit', { steps: [CMD('Install')] })]) });
  assert.deepEqual(find(agg, M, 'unit (a)').setup, stat(null, null, 0));
});

test('aggregate leaves a workflow with a cycle in needs out of criticalPaths', () => {
  const C = 'workflows/cycle.yml';
  const cFacts = facts([fj('x', { needs: ['y'] }), fj('y', { needs: ['x'] }), fj('z')]);
  const agg = aggregate([run(20, C, [job('x', 0, 1, 10), job('y', 0, 1, 20), job('z', 0, 1, 5)])], { [C]: cFacts });
  assert.deepEqual(agg.criticalPaths, []);
  assert.equal(agg.jobs.length, 3);
});

test('aggregate reads no step kinds, path or repeated steps from an unparsed workflow, but keeps run figures and skew', () => {
  const U = 'workflows/unparsed.yml';
  // Hand-built facts that carry jobs beside an unparsed reason: only the unparsed guard ignores them.
  const uFacts = facts(
    [fj('one', { steps: [CMD('Install')] }), fj('two', { steps: [CMD('Install')] }), fj('three', { steps: [CMD('Install')] })],
    ['tab indentation in jobs:'],
  );
  const runs = [run(30, U, [shard('one', 10), shard('two', 20), shard('three', 30), shard('s (a)', 10), shard('s (b)', 30)])];
  const agg = aggregate(runs, { [U]: uFacts });
  assert.deepEqual(find(agg, U, 'one').setup, stat(null, null, 0));
  assert.deepEqual(find(agg, U, 'one').running, stat(8, 8, 1));
  assert.deepEqual(agg.criticalPaths, []);
  assert.deepEqual(agg.repeatedSteps, []);
  assert.deepEqual(agg.shardSkews, [{ workflow: U, family: 's', ratio: 3, slowest: 's (b)', shards: 2 }]);
});

test('aggregate keeps an excluded job out of overlaps', () => {
  const X = 'workflows/x.yml';
  const runs = [
    run(40, X, [job('a', 0, 1, 10), job('b', 0, 20, 30)]),
    // a: startedAt before createdAt — excluded; its interval would intersect b's.
    run(41, X, [job('a', 10, 5, 50), job('b', 0, 20, 30)]),
  ];
  const agg = aggregate(runs, {});
  assert.equal(agg.excluded, 1);
  assert.deepEqual(agg.overlaps, [{ workflow: X, a: 'a', b: 'b', everOverlapped: false }]);
});

test('aggregate overlaps hold only pairs of two jobs seen in the same run', () => {
  const X = 'workflows/x.yml';
  const single = aggregate([run(50, X, [job('a', 0, 1, 10)])], {});
  assert.deepEqual(single.overlaps, []);
  const apart = aggregate([run(51, X, [job('a', 0, 1, 10)]), run(52, X, [job('b', 0, 1, 10)])], {});
  assert.deepEqual(apart.overlaps, []);
});

test('aggregate tolerates no runs and missing facts', () => {
  assert.deepEqual(aggregate([], {}), { jobs: [], excluded: 0, criticalPaths: [], shardSkews: [], repeatedSteps: [], overlaps: [] });
  // a workflow string that names an Object.prototype key is still a workflow with no facts.
  const agg = aggregate([run(60, 'constructor', [job('a', 0, 1, 10, [['Install', 1, 10]])])], {});
  assert.deepEqual(agg.jobs[0].setup, stat(null, null, 0));
  assert.deepEqual(agg.criticalPaths, []);
});
