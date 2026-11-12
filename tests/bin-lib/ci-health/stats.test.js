'use strict';
// Record #5161 — plugin/bin/lib/ci-health/stats.js: nearest-rank percentiles, the weekly trend,
// superseded and cancelled runs, push-run coverage, and the skipped and no-work run counts, all
// over synthetic workflow-runs arrays shaped like `repos/{o}/{r}/actions/runs` entries.
const { test } = require('node:test');
const assert = require('node:assert');

const { durationSeconds, nearestRank, computeStats } = require('../../../plugin/bin/lib/ci-health/stats');
const { P90_BREACH_MIN_RUNS } = require('../../../plugin/bin/lib/ci-health/constants');

const NOW = new Date('2026-11-12T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const CI = '.github/workflows/ci.yml';

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

let seq = 0;
// run_started_at = created, updated_at = created + seconds (a negative `seconds` is clock skew).
function run({
  name = 'CI', path = CI, event = 'pull_request', created, seconds,
  conclusion = 'success', status = 'completed', branch = 'main', sha, headRepo = 'o/r',
}) {
  seq += 1;
  const start = new Date(created).getTime();
  return {
    id: seq,
    name,
    path,
    event,
    status,
    conclusion,
    head_branch: branch,
    head_sha: sha === undefined ? `sha-${seq}` : sha,
    head_repository: headRepo === null ? null : { full_name: headRepo },
    repository: { full_name: 'o/r' },
    created_at: iso(start),
    run_started_at: iso(start),
    updated_at: iso(start + seconds * 1000),
  };
}

const OPTS30 = { from: new Date(NOW.getTime() - 30 * DAY), days: 30, defaultBranch: 'main' };
const FROM21 = new Date('2026-10-22T00:00:00Z');
const OPTS21 = { from: FROM21, days: 21, defaultBranch: 'main' };
const at = (dayOffset, hour = 12) => FROM21.getTime() + dayOffset * DAY + hour * HOUR;

const only = (workflows) => {
  assert.strictEqual(workflows.length, 1, `expected one workflow, got ${workflows.length}`);
  return workflows[0];
};

// AC1.1: one week of pull_request runs on ci.yml.
const ac11Runs = () => [600, 700, 800, 1200, 1300].map((seconds, i) =>
  run({ created: NOW.getTime() - 3 * DAY + i * HOUR, seconds }));

// AC2.2: five runs a week for three full weeks from 2026-10-22.
function trendRuns([s1, s2, s3], week3Count = 5, week1Count = 5) {
  const out = [];
  for (let i = 0; i < week1Count; i++) out.push(run({ created: at(i), seconds: s1 }));
  for (let i = 0; i < 5; i++) out.push(run({ created: at(7 + i), seconds: s2 }));
  for (let i = 0; i < week3Count; i++) out.push(run({ created: at(14 + i), seconds: s3 }));
  return out;
}

test('durationSeconds: completed runs with both timestamps only', () => {
  assert.strictEqual(durationSeconds(run({ created: NOW, seconds: 90 })), 90);
  assert.strictEqual(durationSeconds(run({ created: NOW, seconds: 0 })), 0);
  assert.strictEqual(durationSeconds(run({ created: NOW, seconds: 90, status: 'in_progress' })), null);
  assert.strictEqual(durationSeconds(run({ created: NOW, seconds: -5 })), null);
  assert.strictEqual(durationSeconds({ ...run({ created: NOW, seconds: 90 }), updated_at: 'not-a-date' }), null);
  assert.strictEqual(durationSeconds({ ...run({ created: NOW, seconds: 90 }), run_started_at: null }), null);
});

test('nearestRank: rank ceil(p/100*n), 1-based; empty input is null', () => {
  assert.strictEqual(nearestRank([], 50), null);
  assert.strictEqual(nearestRank([600, 700, 800, 1200, 1300], 50), 800);
  assert.strictEqual(nearestRank([600, 700, 800, 1200, 1300], 90), 1300);
  assert.strictEqual(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.strictEqual(nearestRank([7], 0), 7);
});

test('AC1.1: nearest-rank p50 and p90 over one week of runs', () => {
  const w = only(computeStats(ac11Runs(), OPTS30));
  assert.strictEqual(w.path, CI);
  assert.strictEqual(w.name, 'CI');
  assert.deepStrictEqual(w.events, ['pull_request']);
  assert.strictEqual(w.runs, 5);
  assert.strictEqual(w.completedRuns, 5);
  assert.strictEqual(w.skippedRuns, 0);
  assert.strictEqual(w.noWorkRuns, 0);
  assert.strictEqual(w.p50Seconds, 800);
  assert.strictEqual(w.p90Seconds, 1300);
});

test('Workflow carries exactly the documented fields, workflows sorted by path, events sorted distinct', () => {
  const runs = [
    run({ path: '.github/workflows/z.yml', event: 'push', created: NOW.getTime() - DAY, seconds: 10 }),
    run({ path: '.github/workflows/a.yml', event: 'push', created: NOW.getTime() - DAY, seconds: 10 }),
    run({ path: '.github/workflows/a.yml', event: 'pull_request', created: NOW.getTime() - DAY, seconds: 10 }),
    run({ path: '.github/workflows/a.yml', event: 'push', created: NOW.getTime() - DAY, seconds: 10 }),
  ];
  const out = computeStats(runs, OPTS30);
  assert.deepStrictEqual(out.map((w) => w.path), ['.github/workflows/a.yml', '.github/workflows/z.yml']);
  assert.deepStrictEqual(out[0].events, ['pull_request', 'push']);
  assert.deepStrictEqual(Object.keys(out[0]), [
    'name', 'path', 'events', 'runs', 'completedRuns', 'skippedRuns', 'noWorkRuns',
    'p50Seconds', 'p90Seconds', 'weeklyP50Seconds', 'trend', 'superseded', 'supersededShare',
    'cancelled', 'pushRunRate', 'pushesOnNearlyEveryPush',
  ]);
});

test('AC2.1: superseded runs per head repo + branch, default-branch runs never superseded', () => {
  const t = NOW.getTime() - 2 * DAY;
  const runs = [
    run({ branch: 'f', sha: 'sha1', created: t, seconds: 60 }),
    run({ branch: 'f', sha: 'sha2', created: t + HOUR, seconds: 60 }),
    run({ branch: 'f', sha: 'sha3', created: t + 2 * HOUR, seconds: 60 }),
    run({ branch: 'f', sha: 'sha3', created: t + 3 * HOUR, seconds: 60, conclusion: 'cancelled' }),
  ];
  const w = only(computeStats(runs, OPTS30));
  assert.strictEqual(w.superseded, 2);
  assert.strictEqual(w.supersededShare, 0.5);
  assert.strictEqual(w.cancelled, 1);

  const withMain = only(computeStats(
    [...runs, run({ branch: 'main', sha: 'shaM', created: t - HOUR, seconds: 60 })], OPTS30));
  assert.strictEqual(withMain.runs, 5);
  assert.strictEqual(withMain.superseded, 2);
  assert.strictEqual(withMain.supersededShare, 0.5);
  assert.strictEqual(withMain.cancelled, 1);
});

test('AC2.2: weekly p50 per full bucket, rising trend; the partial tail moves p90 but not the trend', () => {
  const runs = trendRuns([400, 450, 600]);
  const w = only(computeStats(runs, OPTS21));
  assert.deepStrictEqual(w.weeklyP50Seconds, [400, 450, 600]);
  assert.deepStrictEqual(w.trend, { ratio: 1.5, label: 'rising' });
  assert.strictEqual(w.p90Seconds, 600);

  const tail = [0, 1, 2].map((i) => run({ created: Date.parse('2026-11-12T08:00:00Z') + i * 60 * 1000, seconds: 9000 }));
  const t = only(computeStats([...runs, ...tail], OPTS21));
  assert.deepStrictEqual(t.weeklyP50Seconds, [400, 450, 600]);
  assert.deepStrictEqual(t.trend, { ratio: 1.5, label: 'rising' });
  assert.strictEqual(t.completedRuns, 18);
  assert.strictEqual(t.p90Seconds, 9000);
});

test('AC2.3 / AC2.4: falling and flat trends', () => {
  assert.deepStrictEqual(only(computeStats(trendRuns([600, 500, 400]), OPTS21)).trend,
    { ratio: 0.67, label: 'falling' });
  assert.deepStrictEqual(only(computeStats(trendRuns([500, 520, 540]), OPTS21)).trend,
    { ratio: 1.08, label: 'flat' });
});

test('trend thresholds: exactly 1.25 is rising, exactly 0.8 is falling', () => {
  assert.deepStrictEqual(only(computeStats(trendRuns([400, 450, 500]), OPTS21)).trend,
    { ratio: 1.25, label: 'rising' });
  assert.deepStrictEqual(only(computeStats(trendRuns([500, 450, 400]), OPTS21)).trend,
    { ratio: 0.8, label: 'falling' });
});

test('trend label compares the rounded ratio it reports: 1.248 is rising, 0.803 is falling', () => {
  assert.deepStrictEqual(only(computeStats(trendRuns([500, 550, 624]), OPTS21)).trend,
    { ratio: 1.25, label: 'rising' });
  assert.deepStrictEqual(only(computeStats(trendRuns([1000, 900, 803]), OPTS21)).trend,
    { ratio: 0.8, label: 'falling' });
});

test('trend: under 5 working runs in the first full bucket is insufficient', () => {
  assert.strictEqual(only(computeStats(trendRuns([400, 450, 600], 5, 4), OPTS21)).trend, 'insufficient');
});

test('trend: a first full bucket with a p50 of 0 is insufficient, never an infinite ratio', () => {
  assert.strictEqual(only(computeStats(trendRuns([0, 450, 600]), OPTS21)).trend, 'insufficient');
});

test('AC2.5: fewer than two full buckets, or under 5 completed runs in the last one, is insufficient', () => {
  const ten = only(computeStats(trendRuns([400, 450, 600]), { ...OPTS21, days: 10 }));
  assert.strictEqual(ten.trend, 'insufficient');
  assert.deepStrictEqual(ten.weeklyP50Seconds, [400]);
  assert.strictEqual(only(computeStats(trendRuns([400, 450, 600], 4), OPTS21)).trend, 'insufficient');
});

test('AC3.1 / AC3.2 / AC3.3: push-run rate against every workflow\'s distinct push shas', () => {
  const shas = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
  const t = NOW.getTime() - 5 * DAY;
  const pushes = (path, list) => list.map((sha, i) =>
    run({ path, event: 'push', sha, created: t + i * HOUR, seconds: 60 }));
  const runs = [
    ...pushes('.github/workflows/a.yml', shas.slice(0, 19)),
    ...pushes('.github/workflows/b.yml', shas.slice(0, 5)),
    ...pushes('.github/workflows/c.yml', shas.slice(19)),
    run({ path: '.github/workflows/d.yml', event: 'pull_request', created: t, seconds: 60 }),
  ];
  const byPath = Object.fromEntries(computeStats(runs, OPTS30).map((w) => [w.path, w]));
  assert.strictEqual(byPath['.github/workflows/a.yml'].pushRunRate, 0.95);
  assert.strictEqual(byPath['.github/workflows/a.yml'].pushesOnNearlyEveryPush, true);
  assert.strictEqual(byPath['.github/workflows/b.yml'].pushRunRate, 0.25);
  assert.strictEqual(byPath['.github/workflows/b.yml'].pushesOnNearlyEveryPush, false);
  assert.strictEqual(byPath['.github/workflows/d.yml'].pushRunRate, null);
  assert.strictEqual(byPath['.github/workflows/d.yml'].pushesOnNearlyEveryPush, false);

  const small = computeStats([
    ...pushes('.github/workflows/a.yml', shas.slice(0, 6)),
    ...pushes('.github/workflows/b.yml', shas.slice(0, 6)),
  ], OPTS30);
  for (const w of small) {
    assert.strictEqual(w.pushRunRate, null, `${w.path} rate below the sample floor`);
    assert.strictEqual(w.pushesOnNearlyEveryPush, false);
  }
});

test('push flag boundaries: 9 of 10 shas is 0.9 and flagged; a rate rounding to 0.90 is flagged', () => {
  const t = NOW.getTime() - 5 * DAY;
  const pushes = (path, list) => list.map((sha, i) =>
    run({ path, event: 'push', sha, created: t + i * HOUR, seconds: 60 }));
  const shas = (n) => Array.from({ length: n }, (_, i) => `q${i + 1}`);

  const ten = shas(10);
  const atFloor = computeStats([
    ...pushes('.github/workflows/a.yml', ten.slice(0, 9)),
    ...pushes('.github/workflows/b.yml', ten.slice(9)),
  ], OPTS30)[0];
  assert.strictEqual(atFloor.pushRunRate, 0.9);
  assert.strictEqual(atFloor.pushesOnNearlyEveryPush, true);

  // 26 / 29 = 0.8966, reported as 0.9.
  const twentyNine = shas(29);
  const rounded = computeStats([
    ...pushes('.github/workflows/a.yml', twentyNine.slice(0, 26)),
    ...pushes('.github/workflows/b.yml', twentyNine.slice(26)),
  ], OPTS30)[0];
  assert.strictEqual(rounded.pushRunRate, 0.9);
  assert.strictEqual(rounded.pushesOnNearlyEveryPush, true);
});

test('AC6.2: completed runs missing run_started_at or updated_at are skipped, not percentiled', () => {
  const base = ac11Runs();
  const noStart = { ...run({ created: NOW.getTime() - DAY, seconds: 5 }) };
  delete noStart.run_started_at;
  const noUpdate = { ...run({ created: NOW.getTime() - DAY, seconds: 99999 }) };
  delete noUpdate.updated_at;
  const clean = only(computeStats(base, OPTS30));
  const w = only(computeStats([...base, noStart, noUpdate], OPTS30));
  assert.strictEqual(w.runs, 7);
  assert.strictEqual(w.skippedRuns, 2);
  assert.strictEqual(w.completedRuns, 5);
  assert.strictEqual(w.p50Seconds, clean.p50Seconds);
  assert.strictEqual(w.p90Seconds, clean.p90Seconds);
});

test('Review Focus 1: run_started_at after updated_at is skipped, never a negative duration', () => {
  const w = only(computeStats([...ac11Runs(), run({ created: NOW.getTime() - DAY, seconds: -120 })], OPTS30));
  assert.strictEqual(w.skippedRuns, 1);
  assert.strictEqual(w.completedRuns, 5);
  assert.strictEqual(w.p50Seconds, 800);
});

test('Review Focus 2: a renamed workflow is one workflow keyed by path, named from its newest run', () => {
  const t = NOW.getTime() - 4 * DAY;
  const out = computeStats([
    run({ name: 'Tests', created: t + DAY, seconds: 60 }),
    run({ name: 'CI', created: t, seconds: 60 }),
  ], OPTS30);
  const w = only(out);
  assert.strictEqual(w.name, 'Tests');
  assert.strictEqual(w.runs, 2);
});

test('newest run: an equal created_at falls to the higher run id, whatever the array order', () => {
  const t = NOW.getTime() - 4 * DAY;
  const older = run({ name: 'Old', created: t, seconds: 60 });
  const newer = run({ name: 'New', created: t, seconds: 60 });
  assert.ok(newer.id > older.id);
  assert.strictEqual(only(computeStats([older, newer], OPTS30)).name, 'New');
  assert.strictEqual(only(computeStats([newer, older], OPTS30)).name, 'New');
});

test('Review Focus 3: a fork run with head_repository null does not throw and counts in the denominator', () => {
  const t = NOW.getTime() - 2 * DAY;
  const runs = [
    run({ branch: 'f', sha: 'a', created: t, seconds: 60 }),
    run({ branch: 'f', sha: 'b', created: t + HOUR, seconds: 60 }),
    run({ branch: 'f', sha: 'c', created: t + 2 * HOUR, seconds: 60, headRepo: null }),
  ];
  const w = only(computeStats(runs, OPTS30));
  assert.strictEqual(w.superseded, 1);
  assert.strictEqual(w.supersededShare, 0.33);
});

test('a fork run on a branch named like the default branch is non-default work; base-repo runs on it are not', () => {
  const t = NOW.getTime() - 2 * DAY;
  const w = only(computeStats([
    run({ branch: 'main', sha: 'a', created: t, seconds: 60, headRepo: 'x/r' }),
    run({ branch: 'main', sha: 'b', created: t + HOUR, seconds: 60, headRepo: 'x/r' }),
    run({ branch: 'main', sha: 'c', created: t - HOUR, seconds: 60 }),
    run({ branch: 'main', sha: 'd', created: t - 2 * HOUR, seconds: 60, headRepo: null }),
  ], OPTS30));
  assert.strictEqual(w.superseded, 1);
  assert.strictEqual(w.supersededShare, 0.5);
});

test('defaultBranch null: superseded and supersededShare are null', () => {
  const t = NOW.getTime() - 2 * DAY;
  const w = only(computeStats([
    run({ branch: 'f', sha: 'a', created: t, seconds: 60 }),
    run({ branch: 'f', sha: 'b', created: t + HOUR, seconds: 60 }),
  ], { ...OPTS30, defaultBranch: null }));
  assert.strictEqual(w.superseded, null);
  assert.strictEqual(w.supersededShare, null);
});

test('no-work runs: counted in runs and noWorkRuns, out of the percentiles and completedRuns', () => {
  const w = only(computeStats(
    [...ac11Runs(), run({ created: NOW.getTime() - 2 * DAY, seconds: 5, conclusion: 'skipped' })], OPTS30));
  assert.strictEqual(w.runs, 6);
  assert.strictEqual(w.noWorkRuns, 1);
  assert.strictEqual(w.completedRuns, 5);
  assert.strictEqual(w.skippedRuns, 0);
  assert.strictEqual(w.p50Seconds, 800);
  assert.strictEqual(w.p90Seconds, 1300);
});

test('no-work runs: out of the weekly buckets and the trend', () => {
  const skipped = [0, 1, 2].map((i) => run({ created: at(5, i), seconds: 5, conclusion: 'skipped' }));
  const w = only(computeStats([...trendRuns([400, 450, 600]), ...skipped], OPTS21));
  assert.deepStrictEqual(w.weeklyP50Seconds, [400, 450, 600]);
  assert.deepStrictEqual(w.trend, { ratio: 1.5, label: 'rising' });
  assert.strictEqual(w.noWorkRuns, 3);
});

test('no-work runs: a skipped run does not meet the per-bucket floor', () => {
  const w = only(computeStats(
    [...trendRuns([400, 450, 600], 4), run({ created: at(19), seconds: 5, conclusion: 'skipped' })], OPTS21));
  assert.strictEqual(w.trend, 'insufficient');
});

test('no-work runs: a skipped run does not lift completedRuns to the p90 breach floor', () => {
  const t = NOW.getTime() - 3 * DAY;
  const runs = [
    ...[1000, 1100, 1200, 1300].map((seconds, i) => run({ created: t + i * HOUR, seconds })),
    run({ created: t + 5 * HOUR, seconds: 5, conclusion: 'skipped' }),
  ];
  const w = only(computeStats(runs, OPTS30));
  assert.strictEqual(w.runs, 5);
  assert.strictEqual(w.completedRuns, 4);
  assert.ok(w.completedRuns < P90_BREACH_MIN_RUNS);
});

test('runs not yet completed count in runs only', () => {
  const w = only(computeStats(
    [...ac11Runs(), run({ created: NOW.getTime() - HOUR, seconds: 30, status: 'in_progress', conclusion: null })], OPTS30));
  assert.strictEqual(w.runs, 6);
  assert.strictEqual(w.completedRuns, 5);
  assert.strictEqual(w.skippedRuns, 0);
  assert.strictEqual(w.p90Seconds, 1300);
});
