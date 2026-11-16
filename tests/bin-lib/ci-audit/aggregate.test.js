'use strict';
// tests/bin-lib/ci-audit/aggregate.test.js — #5757: per-job phase percentiles across runs, the
// critical path over `needs`, matrix shard skew, steps declared in several jobs, which job pairs
// ever ran at the same time, and the jobs left out for unusable timestamps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, matchJob, usableJobs } = require('../../../plugin/bin/lib/ci-audit/aggregate');

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
  // total: percentiles of each run's waiting+setup+running — build 100, 140, 85; test 100, 120, 90
  assert.deepEqual(b.total, stat(100, 140, 3));
  assert.deepEqual(t.total, stat(100, 120, 3));
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
  assert.deepEqual(agg.criticalPaths, [{ workflow: W, pathMs: 200000, sumMs: 260000, chain: ['build', 'test'], allJobsMatched: true }]);
});

test('aggregate overlaps list only the workflow-job pairs that never intersected, with their shared runs', () => {
  // build–docs and docs–test intersect in some run; build–test never does (run 4's build is excluded).
  const agg = aggregate(W_RUNS, { [W]: W_FACTS });
  assert.deepEqual(agg.overlaps, [{ workflow: W, a: 'build', b: 'test', sharedRuns: 3 }]);
  // the shared-run floor: three shared runs are under a floor of 4
  assert.deepEqual(aggregate(W_RUNS, { [W]: W_FACTS }, { minSample: 4 }).overlaps, []);
  assert.deepEqual(aggregate(W_RUNS, { [W]: W_FACTS }, { minSample: 3 }).overlaps.length, 1);
});

test('aggregate overlaps: touching ends (one job ends as the other starts) do not intersect', () => {
  const X = 'workflows/x.yml';
  const f = { [X]: facts([fj('a'), fj('b')]) };
  assert.deepEqual(aggregate([run(1, X, [job('a', 0, 0, 10), job('b', 0, 10, 20)])], f).overlaps, [{ workflow: X, a: 'a', b: 'b', sharedRuns: 1 }]);
  assert.deepEqual(aggregate([run(1, X, [job('a', 0, 0, 11), job('b', 0, 10, 20)])], f).overlaps, []);
});

test('aggregate leaves skipped and cancelled jobs out of every figure and counts them in notTimed', () => {
  // The real shape of a job its `if:` skipped: conclusion skipped, created = started = completed.
  const X = 'workflows/fix.yml';
  const f = { [X]: facts([fj('label'), fj('cleanup')]) };
  const skipped = (s) => ({ ...job('cleanup', s, s, s), conclusion: 'skipped', steps: [] });
  const cancelled = { ...job('label', 0, 5, 7), conclusion: 'cancelled' };
  const runs = [
    run(1, X, [job('label', 0, 5, 40), skipped(0)]),
    run(2, X, [job('label', 0, 5, 50), skipped(0)]),
    run(3, X, [cancelled, skipped(0)]),
  ];
  const agg = aggregate(runs, f);
  assert.deepEqual(agg.jobs.map((j) => [j.job, j.runs]), [['label', 2]]);
  assert.deepEqual(find(agg, X, 'label').total, stat(40, 50, 2)); // no 0 ms or 7 s run drags it down
  assert.deepEqual(agg.notTimed, { skipped: 3, cancelled: 1 });
  assert.deepEqual(agg.overlaps, []); // the pair never both ran, so no evidence either way
  assert.deepEqual(agg.unmatchedJobs, []);
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
  // lint is not a declared job: no step kinds, so no setup figure, and it is listed as unmatched.
  assert.deepEqual(find(agg, M, 'lint (x)').setup, stat(null, null, 0));
  assert.deepEqual(agg.unmatchedJobs, [{ workflow: M, job: 'lint (x)' }]);
  // a matrix job weighs as its slowest shard; the unmatched job may sit on the real path.
  assert.deepEqual(agg.criticalPaths, [{ workflow: M, pathMs: 40000, sumMs: 40000, chain: ['unit'], allJobsMatched: false }]);
});

test('aggregate matches a run job to a ${{ }}-named workflow job and builds its shard family from it', () => {
  // The real shape: `name: shard ${{ matrix.shard }}/${{ strategy.job-total }}` runs as `shard 1/4`.
  const T = 'workflows/test.yml';
  const tpl = 'shard ${{ matrix.shard }}/${{ strategy.job-total }}';
  const tFacts = facts([
    fj('shard', { name: tpl, matrix: true, steps: [CMD('Install')] }),
    fj('test', { needs: ['shard'], steps: [CMD('Install')] }),
  ]);
  const runs = [run(1, T, [shard('shard 1/2', 100), shard('shard 2/2', 40), job('test', 100, 105, 120, [['Install', 106, 120]])])];
  const agg = aggregate(runs, { [T]: tFacts });
  assert.deepEqual(find(agg, T, 'shard 1/2').setup, stat(2, 2, 1));
  assert.deepEqual(agg.unmatchedJobs, []);
  assert.deepEqual(agg.shardSkews, [{ workflow: T, family: tpl, ratio: 2.5, slowest: 'shard 1/2', shards: 2 }]);
  // the path holds the shards (slowest, 100 s) and test (20 s), not test alone
  assert.deepEqual(agg.criticalPaths, [{ workflow: T, pathMs: 120000, sumMs: 120000, chain: [tpl, 'test'], allJobsMatched: true }]);
});

test('aggregate gives no shard family to plain jobs whose names only look like shards', () => {
  const D = 'workflows/deploy.yml';
  const dFacts = facts([fj('prod', { name: 'deploy (prod)' }), fj('staging', { name: 'deploy (staging)' })]);
  const runs = [run(1, D, [shard('deploy (prod)', 10), shard('deploy (staging)', 50)])];
  assert.deepEqual(aggregate(runs, { [D]: dFacts }).shardSkews, []);
  // with no trustworthy facts the run-data name rule is all there is
  assert.deepEqual(aggregate(runs, {}).shardSkews.map((s) => s.family), ['deploy']);
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
  const f = { [X]: facts([fj('a'), fj('b')]) };
  const runs = [
    run(40, X, [job('a', 0, 1, 10), job('b', 0, 20, 30)]),
    // a: startedAt before createdAt — excluded; its interval would intersect b's.
    run(41, X, [job('a', 10, 5, 50), job('b', 0, 20, 30)]),
  ];
  const agg = aggregate(runs, f);
  assert.equal(agg.excluded, 1);
  assert.deepEqual(agg.overlaps, [{ workflow: X, a: 'a', b: 'b', sharedRuns: 1 }]);
});

test('aggregate overlaps hold only matched pairs of two workflow jobs seen in the same run', () => {
  const X = 'workflows/x.yml';
  const f = { [X]: facts([fj('a'), fj('b')]) };
  assert.deepEqual(aggregate([run(50, X, [job('a', 0, 1, 10)])], f).overlaps, []);
  assert.deepEqual(aggregate([run(51, X, [job('a', 0, 1, 10)]), run(52, X, [job('b', 0, 1, 10)])], f).overlaps, []);
  // no trustworthy facts: no workflow jobs to pair
  assert.deepEqual(aggregate([run(53, X, [job('a', 0, 1, 10), job('b', 0, 20, 30)])], {}).overlaps, []);
  // two shards of one workflow job are one job, never a pair
  const m = { [X]: facts([fj('u', { matrix: true })]) };
  assert.deepEqual(aggregate([run(54, X, [job('u (1)', 0, 1, 10), job('u (2)', 0, 20, 30)])], m).overlaps, []);
});

test('aggregate tolerates no runs and missing facts', () => {
  assert.deepEqual(aggregate([], {}), {
    jobs: [], excluded: 0, notTimed: { skipped: 0, cancelled: 0 }, criticalPaths: [], shardSkews: [], repeatedSteps: [], overlaps: [], unmatchedJobs: [],
  });
  // facts reached only through the prototype are not this workflow's: own() alone decides.
  const inherited = Object.create({ [W]: facts([fj('a', { steps: [CMD('Install')] })]) });
  const agg = aggregate([run(60, W, [job('a', 0, 1, 10, [['Install', 1, 10]])])], inherited);
  assert.deepEqual(agg.jobs[0].setup, stat(null, null, 0));
  assert.deepEqual(agg.criticalPaths, []);
  assert.deepEqual(aggregate([run(60, W, [job('a', 0, 1, 10, [['Install', 1, 10]])])], { [W]: facts([fj('a', { steps: [CMD('Install')] })]) }).jobs[0].setup.n, 1);
});

test('aggregate step durations skip a step with an invalid or reversed instant', () => {
  const X = 'workflows/x.yml';
  const j = job('a', 0, 1, 30, [['Good', 1, 11]]);
  j.steps.push({ name: 'Reversed', number: 2, startedAt: at(20), completedAt: at(15) });
  j.steps.push({ name: 'Bad', number: 3, startedAt: 'nope', completedAt: at(25) });
  assert.deepEqual(aggregate([run(70, X, [j])], {}).jobs[0].slowestSteps, [{ name: 'Good', p50Ms: 10000, n: 1 }]);
});

test('aggregate gives no shard skew when the shards\' median total is zero', () => {
  const X = 'workflows/x.yml';
  const zero = (name) => job(name, 0, 0, 0);
  assert.deepEqual(aggregate([run(80, X, [zero('u (1)'), zero('u (2)'), zero('u (3)')])], {}).shardSkews, []);
});

test('matchJob maps a run job by exact name, else a matrix base name, else a template, and gives null when ambiguous', () => {
  const jobs = [fj('lint'), fj('unit', { matrix: true }), fj('pack'), fj('twin-a', { name: 'twin' }), fj('twin-b', { name: 'twin' })];
  assert.equal(matchJob('lint', jobs).id, 'lint');
  assert.equal(matchJob('unit (node 20, linux)', jobs).id, 'unit');
  assert.equal(matchJob('pack (a)', jobs), null); // base name holds no matrix
  assert.equal(matchJob('twin', jobs), null); // two workflow jobs share the name
  assert.equal(matchJob('other', jobs), null);
  assert.equal(matchJob('lint', null), null);
  // the base-name walk tries each ` (` from the last: `e2e (a) (b)` reaches the matrix job `e2e (a)`
  const nested = [fj('e2e', { name: 'e2e (a)', matrix: true })];
  assert.equal(matchJob('e2e (a) (b)', nested).id, 'e2e');
  // a base name held by two matrix jobs matches neither
  assert.equal(matchJob('u (1)', [fj('u1', { name: 'u', matrix: true }), fj('u2', { name: 'u', matrix: true })]), null);
  // templates: a custom matrix job name, and two templates matching one name
  const tpl = [fj('build', { name: 'Build (${{ matrix.os }})', matrix: true })];
  assert.equal(matchJob('Build (ubuntu)', tpl).id, 'build');
  assert.equal(matchJob('Build ubuntu', tpl), null);
  const two = [fj('a', { name: 'x ${{ m.a }}' }), fj('b', { name: 'x ${{ m.b }}' })];
  assert.equal(matchJob('x 1', two), null);
  // a job named only by a template absorbs nothing: its run jobs stay unmatched (and are listed)
  const wild = [fj('task', { name: '${{ matrix.task }}', matrix: true }), fj('lint')];
  assert.equal(matchJob('docs', wild), null);
  const agg = aggregate([run(90, W, [job('docs', 0, 1, 10), job('lint', 0, 1, 10)])], { [W]: facts(wild) });
  assert.deepEqual(agg.unmatchedJobs, [{ workflow: W, job: 'docs' }]);
  assert.deepEqual(usableJobs({ [W]: facts([fj('a')]) }, W).map((j) => j.id), ['a']);
  assert.equal(usableJobs({ [W]: facts([fj('a')], ['tab indentation in jobs:']) }, W), null);
  assert.equal(usableJobs({}, W), null);
});
