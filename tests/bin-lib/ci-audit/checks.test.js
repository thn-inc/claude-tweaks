'use strict';
// tests/bin-lib/ci-audit/checks.test.js — #5757: the checklist table's mechanical breaches. One
// fixture per check pins its exact breach; a sibling at or just under the threshold gives none;
// each guard (the minSample floor, the unparsed-workflow skip, the needs-link exclusion, the
// overlap-evidence floor) has a fixture on which only that guard decides.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CHECK_IDS, DEFAULTS, parseThresholds, evaluate } = require('../../../plugin/bin/lib/ci-audit/checks');
const { aggregate } = require('../../../plugin/bin/lib/ci-audit/aggregate');

const W = 'workflows/ci.yml';
const S = 1000;
const st = (p50s, n, p90s = p50s) => ({ p50Ms: p50s === null ? null : p50s * S, p90Ms: p90s === null ? null : p90s * S, n });
// An aggregate job row; seconds in, ms out. setupN defaults to runs.
function row(job, runs, waiting, setup, running, { workflow = W, runningP90 = running, setupN = runs } = {}) {
  return {
    workflow,
    job,
    runs,
    waiting: st(waiting, runs),
    setup: setup === null ? st(null, 0) : st(setup, setupN),
    running: st(running, runs, runningP90),
    slowestSteps: [],
  };
}
const agg = (over = {}) => ({ jobs: [], excluded: 0, criticalPaths: [], shardSkews: [], repeatedSteps: [], overlaps: [], ...over });
const fj = (id, over = {}) => ({ id, name: id, needs: [], timeoutDeclared: true, matrix: false, steps: [], ...over });
const facts = (jobs, { concurrencyDeclared = true, unparsed = [] } = {}) => ({ jobs, concurrencyDeclared, unparsed });
const only = (breaches, check) => breaches.filter((b) => b.check === check);

test('CHECK_IDS is exactly the eight checks; DEFAULTS holds the six numeric thresholds', () => {
  assert.deepEqual(CHECK_IDS, [
    'queue-wait', 'setup-dominance', 'critical-path-pole', 'serial-independent-jobs',
    'shard-skew', 'repeated-work', 'missing-timeout', 'missing-concurrency',
  ]);
  assert.deepEqual(DEFAULTS, {
    'queue-wait': 0.4, 'setup-dominance': 0.4, 'critical-path-pole': 0.5,
    'shard-skew': 2, 'repeated-work': 3, 'missing-timeout': 3,
  });
});

test('parseThresholds reads id=value pairs and refuses unknown ids, non-numbers and fixed checks', () => {
  assert.deepEqual(parseThresholds('shard-skew=3'), { ok: true, values: { 'shard-skew': 3 } });
  assert.deepEqual(parseThresholds(' queue-wait=0.25 , missing-timeout=4 '), { ok: true, values: { 'queue-wait': 0.25, 'missing-timeout': 4 } });
  assert.deepEqual(parseThresholds(''), { ok: true, values: {} });
  for (const bad of ['bogus=1', 'shard-skew=x', 'shard-skew=', 'shard-skew', 'shard-skew=-1', 'shard-skew=0',
    'shard-skew=1e3', 'shard-skew=3,shard-skew=4', 'missing-concurrency=1', 'serial-independent-jobs=0', 'shard-skew=3,']) {
    const r = parseThresholds(bad);
    assert.equal(r.ok, false, bad);
    assert.equal(typeof r.error, 'string', bad);
  }
});

// ---- queue-wait ----
test('queue-wait fires above 0.4 of the job total, not at it, and not below minSample', () => {
  const f = { [W]: facts([]) };
  const fire = evaluate(agg({ jobs: [row('a', 5, 50, 10, 40)] }), f, {}, 5);
  assert.deepEqual(only(fire, 'queue-wait'), [{ check: 'queue-wait', workflow: W, job: 'a', metric: 'waitingShare', value: 0.5, threshold: 0.4 }]);
  // exactly at the threshold: no breach
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 40, 10, 50)] }), f, {}, 5), 'queue-wait'), []);
  // minSample floor alone decides
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 4, 50, 10, 40)] }), f, {}, 5), 'queue-wait'), []);
  assert.equal(only(evaluate(agg({ jobs: [row('a', 4, 50, 10, 40)] }), f, {}, 4), 'queue-wait').length, 1);
  // an override raises the threshold
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 50, 10, 40)] }), f, { 'queue-wait': 0.5 }, 5), 'queue-wait'), []);
  // minSample defaults to 5
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 4, 50, 10, 40)] }), f), 'queue-wait'), []);
  assert.equal(only(evaluate(agg({ jobs: [row('a', 5, 50, 10, 40)] }), f), 'queue-wait').length, 1);
});

// ---- setup-dominance ----
test('setup-dominance fires above 0.4, not at it, and not when setup has fewer than minSample values', () => {
  const f = { [W]: facts([]) };
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 10, 50, 40)] }), f, {}, 5), 'setup-dominance'),
    [{ check: 'setup-dominance', workflow: W, job: 'a', metric: 'setupShare', value: 0.5, threshold: 0.4 }]);
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 10, 40, 50)] }), f, {}, 5), 'setup-dominance'), []);
  // runs reach minSample, setup's own n does not: only the floor on setup.n decides
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 10, 50, 40, { setupN: 4 })] }), f, {}, 5), 'setup-dominance'), []);
  // no setup figure at all
  assert.deepEqual(only(evaluate(agg({ jobs: [row('a', 5, 10, null, 40)] }), f, {}, 5), 'setup-dominance'), []);
});

// ---- critical-path-pole ----
test('critical-path-pole names the workflow job holding more than half the path', () => {
  const f = { [W]: facts([fj('build'), fj('test', { needs: ['build'] }), fj('unit', { matrix: true })]) };
  const cp = [{ workflow: W, pathMs: 200 * S, sumMs: 300 * S, chain: ['build', 'test'] }];
  const jobs = [row('build', 5, 0, 20, 100), row('test', 5, 0, 10, 70)];
  assert.deepEqual(only(evaluate(agg({ jobs, criticalPaths: cp }), f, {}, 5), 'critical-path-pole'),
    [{ check: 'critical-path-pole', workflow: W, job: 'build', metric: 'criticalPathShare', value: 0.6, threshold: 0.5 }]);
  // exactly half: no breach
  const at = [row('build', 5, 0, 20, 80), row('test', 5, 0, 10, 70)];
  assert.deepEqual(only(evaluate(agg({ jobs: at, criticalPaths: cp }), f, {}, 5), 'critical-path-pole'), []);
  // build below minSample: no breach
  const few = [row('build', 4, 0, 20, 100), row('test', 5, 0, 10, 70)];
  assert.deepEqual(only(evaluate(agg({ jobs: few, criticalPaths: cp }), f, {}, 5), 'critical-path-pole'), []);
});

test('critical-path-pole weighs a matrix job by its slowest shard that reaches minSample', () => {
  const f = { [W]: facts([fj('unit', { matrix: true }), fj('pack', { needs: ['unit'] })]) };
  const cp = [{ workflow: W, pathMs: 200 * S, sumMs: 200 * S, chain: ['unit', 'pack'] }];
  const jobs = [row('unit (a)', 5, 0, 10, 60), row('unit (b)', 5, 0, 10, 100), row('pack', 5, 0, 10, 20)];
  assert.deepEqual(only(evaluate(agg({ jobs, criticalPaths: cp }), f, {}, 5), 'critical-path-pole'),
    [{ check: 'critical-path-pole', workflow: W, job: 'unit', metric: 'criticalPathShare', value: 0.55, threshold: 0.5 }]);
  // the slow shard below minSample: only shard a (70 of 200) counts — the floor alone decides
  const few = [row('unit (a)', 5, 0, 10, 60), row('unit (b)', 4, 0, 10, 100), row('pack', 5, 0, 10, 20)];
  assert.deepEqual(only(evaluate(agg({ jobs: few, criticalPaths: cp }), f, {}, 5), 'critical-path-pole'), []);
});

// ---- serial-independent-jobs ----
const BASE = Date.parse('2026-11-16T00:00:00Z');
const iso = (s) => new Date(BASE + s * 1000).toISOString();
const rj = (name, s, e) => ({ name, createdAt: iso(s), startedAt: iso(s), completedAt: iso(e), conclusion: 'success', steps: [] });
const runsOf = (n, jobsAt) => Array.from({ length: n }, (_, i) => ({ id: i + 1, workflow: W, conclusion: 'success', createdAt: iso(0), jobs: jobsAt() }));
// lint, unit and pack never overlap; pack needs unit, deploy needs pack and lint.
const SERIAL_FACTS = () => facts([fj('lint'), fj('unit'), fj('pack', { needs: ['unit'] }), fj('deploy', { needs: ['pack', 'lint'] })]);
const serialRuns = (n) => runsOf(n, () => [rj('lint', 0, 10), rj('unit', 20, 30), rj('pack', 40, 50), rj('deploy', 60, 70)]);

test('serial-independent-jobs fires for a never-overlapping pair with no needs path either way', () => {
  const f = { [W]: SERIAL_FACTS() };
  const a = aggregate(serialRuns(5), f);
  assert.equal(a.overlaps.length, 6);
  assert.ok(a.overlaps.every((o) => o.everOverlapped === false));
  // unit–pack (direct), unit–deploy (transitive), lint–deploy, pack–deploy are needs-linked
  assert.deepEqual(only(evaluate(a, f, {}, 5), 'serial-independent-jobs'), [
    { check: 'serial-independent-jobs', workflow: W, job: 'lint + pack', metric: 'overlappingRuns', value: 0, threshold: 0 },
    { check: 'serial-independent-jobs', workflow: W, job: 'lint + unit', metric: 'overlappingRuns', value: 0, threshold: 0 },
  ]);
});

test('serial-independent-jobs: needs link, overlap, minSample, missing pair and unparsed each decide alone', () => {
  // needs link alone: same runs, but unit now needs lint — lint–unit and lint–pack become linked
  const linked = { [W]: facts([fj('lint'), fj('unit', { needs: ['lint'] }), fj('pack', { needs: ['unit'] }), fj('deploy', { needs: ['pack', 'lint'] })]) };
  assert.deepEqual(only(evaluate(aggregate(serialRuns(5), linked), linked, {}, 5), 'serial-independent-jobs'), []);
  // overlap alone: lint overlaps unit in one run only
  const f = { [W]: SERIAL_FACTS() };
  const overlapRuns = serialRuns(5);
  overlapRuns[0].jobs[0] = rj('lint', 0, 25);
  assert.deepEqual(only(evaluate(aggregate(overlapRuns, f), f, {}, 5), 'serial-independent-jobs').map((b) => b.job), ['lint + pack']);
  // minSample alone: four runs
  assert.deepEqual(only(evaluate(aggregate(serialRuns(4), f), f, {}, 5), 'serial-independent-jobs'), []);
  // missing pair alone: five runs each, but lint never shares a run with unit or pack
  const apart = [
    ...runsOf(5, () => [rj('lint', 0, 10), rj('deploy', 60, 70)]),
    ...runsOf(5, () => [rj('unit', 20, 30), rj('pack', 40, 50)]),
  ];
  const ap = aggregate(apart, f);
  assert.ok(ap.jobs.every((j) => j.runs === 5));
  assert.deepEqual(only(evaluate(ap, f, {}, 5), 'serial-independent-jobs'), []);
  // unparsed alone: the aggregate's overlaps are hand-carried from the parsed case
  const a = aggregate(serialRuns(5), f);
  const bad = { [W]: { ...SERIAL_FACTS(), unparsed: ['tab indentation in jobs:'] } };
  assert.deepEqual(only(evaluate(a, bad, {}, 5), 'serial-independent-jobs'), []);
});

test('serial-independent-jobs maps matrix shards to their workflow job and skips shard pairs of one job', () => {
  const f = { [W]: facts([fj('unit', { matrix: true }), fj('lint'), fj('pack', { needs: ['unit'] })]) };
  const runs = runsOf(5, () => [rj('unit (a)', 0, 10), rj('unit (b)', 20, 30), rj('pack', 40, 50), rj('lint', 60, 70)]);
  assert.deepEqual(only(evaluate(aggregate(runs, f), f, {}, 5), 'serial-independent-jobs').map((b) => b.job),
    ['lint + pack', 'lint + unit (a)', 'lint + unit (b)']);
});

// ---- shard-skew ----
test('shard-skew fires above 2, not at it, and not when any shard is below minSample', () => {
  const sk = (ratio) => [{ workflow: W, family: 'unit', ratio, slowest: 'unit (c)', shards: 3 }];
  const shards = (cRuns = 5) => [row('unit (a)', 5, 0, 0, 10), row('unit (b)', 5, 0, 0, 10), row('unit (c)', cRuns, 0, 0, 25)];
  const f = { [W]: facts([]) };
  assert.deepEqual(only(evaluate(agg({ jobs: shards(), shardSkews: sk(2.5) }), f, {}, 5), 'shard-skew'),
    [{ check: 'shard-skew', workflow: W, job: 'unit', metric: 'shardSkewRatio', value: 2.5, threshold: 2 }]);
  assert.deepEqual(only(evaluate(agg({ jobs: shards(), shardSkews: sk(2) }), f, {}, 5), 'shard-skew'), []);
  assert.deepEqual(only(evaluate(agg({ jobs: shards(4), shardSkews: sk(2.5) }), f, {}, 5), 'shard-skew'), []);
});

// ---- repeated-work ----
test('repeated-work fires at 3 holder jobs that reach minSample, in parsed workflows only', () => {
  const step = { name: 'Install', kind: 'command' };
  const f = { [W]: facts(['a', 'b', 'c'].map((id) => fj(id, { steps: [step] }))) };
  const rs = [{ name: 'Install', jobs: ['a', 'b', 'c'] }];
  const jobs = (cRuns = 5) => [row('a', 5, 0, 0, 10), row('b', 5, 0, 0, 10), row('c', cRuns, 0, 0, 10)];
  assert.deepEqual(only(evaluate(agg({ jobs: jobs(), repeatedSteps: rs }), f, {}, 5), 'repeated-work'),
    [{ check: 'repeated-work', workflow: null, job: null, step: 'Install', metric: 'jobsDeclaringStep', value: 3, threshold: 3 }]);
  // two holders: under the threshold
  const two = { [W]: facts(['a', 'b'].map((id) => fj(id, { steps: [step] }))) };
  assert.deepEqual(only(evaluate(agg({ jobs: jobs(), repeatedSteps: [{ name: 'Install', jobs: ['a', 'b'] }] }), two, {}, 5), 'repeated-work'), []);
  // c below minSample: two eligible holders
  assert.deepEqual(only(evaluate(agg({ jobs: jobs(4), repeatedSteps: rs }), f, {}, 5), 'repeated-work'), []);
  // the workflow unparsed: its holders do not count
  const bad = { [W]: { ...f[W], unparsed: ['anchor or alias in jobs:'] } };
  assert.deepEqual(only(evaluate(agg({ jobs: jobs(), repeatedSteps: rs }), bad, {}, 5), 'repeated-work'), []);
});

test('repeated-work counts holders across workflows', () => {
  const W2 = 'workflows/release.yml';
  const step = { name: 'Install', kind: 'command' };
  const f = { [W]: facts([fj('a', { steps: [step] }), fj('b', { steps: [step] })]), [W2]: facts([fj('a', { steps: [step] })]) };
  const jobs = [row('a', 5, 0, 0, 10), row('b', 5, 0, 0, 10), row('a', 5, 0, 0, 10, { workflow: W2 })];
  assert.deepEqual(only(evaluate(agg({ jobs, repeatedSteps: [{ name: 'Install', jobs: ['a', 'a', 'b'] }] }), f, {}, 5), 'repeated-work').map((b) => b.value), [3]);
});

// ---- missing-timeout ----
test('missing-timeout fires on running p90/p50 above 3 for a job with no declared timeout', () => {
  const f = (over = {}, opts) => ({ [W]: facts([fj('a', { timeoutDeclared: false, ...over })], opts) });
  const r = (runs, p90) => agg({ jobs: [row('a', runs, 0, 0, 10, { runningP90: p90 })] });
  assert.deepEqual(only(evaluate(r(5, 40), f(), {}, 5), 'missing-timeout'),
    [{ check: 'missing-timeout', workflow: W, job: 'a', metric: 'runningP90ToP50', value: 4, threshold: 3 }]);
  assert.deepEqual(only(evaluate(r(5, 30), f(), {}, 5), 'missing-timeout'), []); // exactly 3
  assert.deepEqual(only(evaluate(r(5, 40), f({ timeoutDeclared: true }), {}, 5), 'missing-timeout'), []);
  assert.deepEqual(only(evaluate(r(4, 40), f(), {}, 5), 'missing-timeout'), []);
  assert.deepEqual(only(evaluate(r(5, 40), f({}, { unparsed: ['tab indentation in jobs:'] }), {}, 5), 'missing-timeout'), []);
  // a run job matching no workflow job: nothing known about its timeout
  assert.deepEqual(only(evaluate(r(5, 40), { [W]: facts([fj('other', { timeoutDeclared: false })]) }, {}, 5), 'missing-timeout'), []);
});

// ---- missing-concurrency ----
test('missing-concurrency fires for a parsed workflow with no concurrency and a job at minSample', () => {
  const jobs = (runs) => agg({ jobs: [row('a', runs, 0, 0, 10)] });
  assert.deepEqual(only(evaluate(jobs(5), { [W]: facts([fj('a')], { concurrencyDeclared: false }) }, {}, 5), 'missing-concurrency'),
    [{ check: 'missing-concurrency', workflow: W, job: null, metric: 'concurrencyDeclared', value: 0, threshold: 0 }]);
  assert.deepEqual(only(evaluate(jobs(5), { [W]: facts([fj('a')]) }, {}, 5), 'missing-concurrency'), []);
  // concurrencyDeclared false only because the region could not be read: the unparsed guard alone decides
  assert.deepEqual(only(evaluate(jobs(5), { [W]: facts([fj('a')], { concurrencyDeclared: false, unparsed: ['concurrency not read'] }) }, {}, 5), 'missing-concurrency'), []);
  assert.deepEqual(only(evaluate(jobs(4), { [W]: facts([fj('a')], { concurrencyDeclared: false }) }, {}, 5), 'missing-concurrency'), []);
});

test('evaluate orders breaches by check, then workflow, then job, and tolerates empty input', () => {
  const f = { [W]: facts([fj('a', { timeoutDeclared: false })], { concurrencyDeclared: false }) };
  const out = evaluate(agg({ jobs: [row('b', 5, 50, 10, 40), row('a', 5, 60, 30, 10, { runningP90: 40 })] }), f, {}, 5);
  assert.deepEqual(out.map((b) => `${b.check}:${b.job}`), [
    'queue-wait:a', 'queue-wait:b', 'missing-timeout:a', 'missing-concurrency:null',
  ]);
  assert.deepEqual(evaluate(agg(), {}, {}, 5), []);
  assert.deepEqual(evaluate(null, null), []);
});
