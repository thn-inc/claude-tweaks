'use strict';
// Record #5161 — plugin/bin/lib/ci-health/fetch.js: the repo read and the paged
// `repos/{o}/{r}/actions/runs` read behind an injected runner, plus the error helpers billing reuses.
// Fake runners record argv and opts inside and branch on the args shape; anything unhandled throws.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { errorText, httpStatusOf, isGhAbsent, readRepo, fetchRuns } = require('../../../plugin/bin/lib/ci-health/fetch');
const {
  CI_HEALTH_GH_TIMEOUT_MS, MAX_RUN_PAGES, RUN_PAGE_BUDGET, DEFAULT_DAYS,
} = require('../../../plugin/bin/lib/ci-health/constants');
const { weekCount, bucketIndex, computeStats } = require('../../../plugin/bin/lib/ci-health/stats');
const { actionsRunsSim } = require('../../helpers/ci-health-actions-sim');

const REPO_ORG = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'ci-health', 'repo-org.json'), 'utf8');
const RUNS_PATH = 'repos/acme/widgets/actions/runs';
// Under 7 days the window is one range: 2026-10-13T00:00:00Z..2026-10-19T23:59:59Z. A range's
// label names both ends as inclusive UTC days, as GitHub's own `created=a..b` reads them.
const FROM = new Date('2026-10-13T00:00:00Z');
const DAYS = 6;
const ONE_RANGE = '2026-10-13..2026-10-19';
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const dayBefore = (ymd) => new Date(Date.parse(`${ymd}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

function ghError(stderr, extra = {}) {
  const err = new Error(`Command failed: gh api\n${stderr}`);
  err.stderr = stderr;
  return Object.assign(err, extra);
}

function enoent() {
  const err = new Error('spawnSync gh ENOENT');
  err.code = 'ENOENT';
  return err;
}

// Page n's runs carry ids (n - 1) * 100 + 1 onward, so no two pages share an id.
function pageBody(count, n = 1) {
  const workflow_runs = Array.from({ length: count }, (_, i) => ({ id: (n - 1) * 100 + i + 1 }));
  return JSON.stringify({ total_count: count, workflow_runs });
}

// pages: array indexed from page 1; each entry is a run count, an Error to throw, or a raw string body.
function runsRunner(pages) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[3] !== RUNS_PATH) throw new Error('unexpected ' + args.join(' '));
    const n = Number(args[args.length - 1].replace('page=', ''));
    const entry = pages[n - 1];
    if (entry === undefined) throw new Error('unexpected ' + args.join(' '));
    if (entry instanceof Error) throw entry;
    if (typeof entry === 'string') return entry;
    return pageBody(entry, n);
  };
  return { runner, calls };
}

test('page 1 argv is the exact GET read with the range\'s created timestamps, 100 per page, and the 15 s timeout', () => {
  const { runner, calls } = runsRunner([3]);
  fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.deepStrictEqual(calls[0].args, [
    'api', '--method', 'GET', 'repos/acme/widgets/actions/runs',
    '-f', 'created=2026-10-13T00:00:00Z..2026-10-19T23:59:59Z', '-f', 'per_page=100', '-f', 'page=1',
  ]);
  assert.deepStrictEqual(calls[0].opts, { timeout: 15000 });
  assert.strictEqual(CI_HEALTH_GH_TIMEOUT_MS, 15000);
});

test('a short page 1 is the whole window: one call, runs returned, not truncated', () => {
  const { runner, calls } = runsRunner([3]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(r, {
    available: true, runs: [{ id: 1 }, { id: 2 }, { id: 3 }], pages: 1, truncated: false, truncatedRanges: [], ghAbsent: false, failures: [],
  });
});

test('AC7.1: page 2 throwing HTTP 503 keeps page 1, names the failed range and page, and stops that range', () => {
  const { runner, calls } = runsRunner([100, ghError('HTTP 503: Service Unavailable (https://api.github.com/...)'), 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(r.runs.length, 100);
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.pages, 1);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.failures.length, 1);
  assert.strictEqual(r.failures[0].query, `runs ${ONE_RANGE} page 2`);
  assert.strictEqual(r.failures[0].status, 503);
  assert.match(r.failures[0].error, /HTTP 503/);
  assert.strictEqual(calls.length, 2, 'no page 3 call');
});

test('AC7.3: ten full pages hit the cap — that range truncated with reason cap, exactly 10 calls, 1,000 runs', () => {
  const { runner, calls } = runsRunner(Array(11).fill(100));
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(r.truncated, true);
  assert.deepStrictEqual(r.truncatedRanges, [{ from: '2026-10-13', to: '2026-10-19', reason: 'cap' }]);
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(r.runs.length, 1000);
  assert.strictEqual(r.pages, 10);
  assert.deepStrictEqual(calls.map((c) => c.args[c.args.length - 1]), Array.from({ length: 10 }, (_, i) => `page=${i + 1}`));
});

test('AC7.3: a 40-run page 3 ends the range — 3 calls, not truncated', () => {
  const { runner, calls } = runsRunner([100, 100, 40, 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.runs.length, 240);
  assert.strictEqual(r.pages, 3);
});

test('a short page 10 is not truncated', () => {
  const { runner, calls } = runsRunner([...Array(9).fill(100), 99]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(calls.length, 10);
  assert.strictEqual(r.truncated, false);
  assert.deepStrictEqual(r.truncatedRanges, []);
  assert.strictEqual(r.runs.length, 999);
});

// ── One created range per stats bucket (#5161 review follow-up 1) ──────────────────────────────
const FROM30 = new Date('2026-10-13T00:00:00Z');
const RANGES30 = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'];

let poolSeq = 0;
// `count` runs inside the week starting at `weekStart` (a YYYY-MM-DD), one a minute from 01:00Z.
function weekRuns(weekStart, count) {
  const base = Date.parse(`${weekStart}T01:00:00Z`);
  return Array.from({ length: count }, (_, i) => {
    poolSeq += 1;
    return { id: poolSeq, created_at: new Date(base + i * 60 * 1000).toISOString().replace('.000Z', 'Z') };
  });
}

function simRunner(pool) {
  const sim = actionsRunsSim(pool);
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[3] !== RUNS_PATH) throw new Error('unexpected ' + args.join(' '));
    return JSON.stringify(sim.answer(args));
  };
  return { runner, calls, served: sim.served };
}

const createdOf = (call) => call.args.find((a) => a.startsWith('created=')).slice('created='.length);

test('a 30-day window reads five created ranges newest first, each ending one second before the next begins', () => {
  const { runner, calls } = simRunner([]);
  fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.deepStrictEqual(calls.map(createdOf), [
    '2026-11-10T00:00:00Z..2026-11-16T23:59:59Z',
    '2026-11-03T00:00:00Z..2026-11-09T23:59:59Z',
    '2026-10-27T00:00:00Z..2026-11-02T23:59:59Z',
    '2026-10-20T00:00:00Z..2026-10-26T23:59:59Z',
    '2026-10-13T00:00:00Z..2026-10-19T23:59:59Z',
  ]);
  assert.strictEqual(weekCount(30), 5);
});

test('more than 1,000 runs in the window with no range at the cap: every run read, not truncated', () => {
  const pool = RANGES30.flatMap((week) => weekRuns(week, 400));
  const { runner, calls } = simRunner(pool);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.strictEqual(r.runs.length, 2000);
  assert.deepStrictEqual(new Set(r.runs.map((run) => run.id)), new Set(pool.map((run) => run.id)));
  assert.strictEqual(r.truncated, false);
  assert.deepStrictEqual(r.truncatedRanges, []);
  assert.deepStrictEqual(r.failures, []);
  // Four full pages and a short (empty) fifth per range.
  assert.strictEqual(calls.length, 25);
  assert.strictEqual(r.pages, 25);
});

test('one range over the cap: only that range is truncated (reason cap), every other range read whole', () => {
  const capped = weekRuns('2026-11-03', 1200);
  const others = ['2026-10-13', '2026-10-20', '2026-10-27', '2026-11-10'].flatMap((week) => weekRuns(week, 150));
  const { runner } = simRunner([...capped, ...others]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.strictEqual(r.truncated, true);
  assert.deepStrictEqual(r.truncatedRanges, [{ from: '2026-11-03', to: '2026-11-09', reason: 'cap' }]);
  const ids = new Set(r.runs.map((run) => run.id));
  for (const run of others) assert.ok(ids.has(run.id), `run ${run.id} of an uncapped range is missing`);
  assert.strictEqual(capped.filter((run) => ids.has(run.id)).length, 1000, 'the capped range keeps its newest 1,000');
  assert.strictEqual(r.runs.length, 1600);
});

test('the read budget: ranges it leaves unread are named budget, oldest first in read order', () => {
  assert.strictEqual(RUN_PAGE_BUDGET, weekCount(DEFAULT_DAYS) * MAX_RUN_PAGES, 'the default window can never run out of budget');
  assert.strictEqual(RUN_PAGE_BUDGET, 50);
  // --days 400 is 58 ranges; an empty repo spends one call per range until the budget is gone.
  const { runner, calls } = simRunner([]);
  const from = new Date('2025-10-08T00:00:00Z');
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from, days: 400 }, { runner });
  assert.strictEqual(weekCount(400), 58);
  assert.strictEqual(calls.length, RUN_PAGE_BUDGET);
  assert.strictEqual(r.truncated, true);
  assert.strictEqual(r.truncatedRanges.length, 58 - RUN_PAGE_BUDGET);
  assert.ok(r.truncatedRanges.every((t) => t.reason === 'budget'), JSON.stringify(r.truncatedRanges));
  assert.deepStrictEqual(r.truncatedRanges[0], { from: '2025-10-08', to: '2025-10-14', reason: 'budget' });
  // Chronological: each entry starts the day after the previous one's inclusive last day.
  for (let i = 1; i < r.truncatedRanges.length; i += 1) assert.strictEqual(dayBefore(r.truncatedRanges[i].from), r.truncatedRanges[i - 1].to);
});

test('all five default-window weeks over the cap: 50 calls, and every week named cap, the oldest included', () => {
  // The oldest week's page 10 is call 50, the budget's last; the cap check runs first, so that
  // week reads `cap`, not `budget`.
  const pool = RANGES30.flatMap((week) => weekRuns(week, 1200));
  const { runner, calls } = simRunner(pool);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.strictEqual(calls.length, 50);
  assert.strictEqual(r.runs.length, 5000);
  assert.deepStrictEqual(r.truncatedRanges, RANGES30.map((from) => ({ from, to: dayBefore(new Date(Date.parse(`${from}T00:00:00Z`) + WEEK).toISOString().slice(0, 10)), reason: 'cap' })));
  // Each label names the days its query covered: the created range's own first and last day.
  const queried = [...new Set(calls.map(createdOf))].map((c) => c.split('..').map((end) => end.slice(0, 10)).join('..')).reverse();
  assert.deepStrictEqual(r.truncatedRanges.map((t) => `${t.from}..${t.to}`), queried);
});

test('the deadline: no runs page starts that could finish past it, and the ranges it leaves are named budget', () => {
  // Every call takes the full 15 s bound on a fake clock; four full pages and an empty fifth per
  // range. With the deadline at 100 s, calls start at 0, 15, …, 75 s (the last ends at 90 s); a
  // call at 90 s could end at 105 s, so none starts.
  const pool = RANGES30.flatMap((week) => weekRuns(week, 400));
  const sim = simRunner(pool);
  let t = 0;
  const runner = (args, opts) => { t += CI_HEALTH_GH_TIMEOUT_MS; return sim.runner(args, opts); };
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner, clock: () => t, runsDeadlineMs: 100000 });
  assert.strictEqual(sim.calls.length, 6);
  assert.ok(t <= 100000, `the last runs call ended at ${t} ms, past the 100 s deadline`);
  // The newest range read whole (5 calls); the next one's page 1 read, its page 2 never requested.
  assert.strictEqual(r.runs.length, 500);
  assert.deepStrictEqual(r.truncatedRanges, [
    { from: '2026-10-13', to: '2026-10-19', reason: 'budget' },
    { from: '2026-10-20', to: '2026-10-26', reason: 'budget' },
    { from: '2026-10-27', to: '2026-11-02', reason: 'budget' },
    { from: '2026-11-03', to: '2026-11-09', reason: 'budget' },
  ]);
  assert.deepStrictEqual(r.failures, []);
  // Without a clock there is no deadline: the same window reads whole.
  const whole = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner: simRunner(pool).runner });
  assert.deepStrictEqual(whole.truncatedRanges, []);
});

test('every call failing on a long window: unavailable, and no range is named truncated', () => {
  // gh present but every read failing is the same "nothing read" state as gh absent: the report
  // says runs unavailable, never that durations were sampled from runs that were never read.
  const calls = [];
  const from = new Date('2025-10-08T00:00:00Z');
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from, days: 400 }, { runner: (args) => { calls.push(args); throw ghError('HTTP 500'); } });
  assert.strictEqual(calls.length, RUN_PAGE_BUDGET);
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.pages, 0);
  assert.strictEqual(r.failures.length, RUN_PAGE_BUDGET);
  assert.deepStrictEqual(r.truncatedRanges, []);
  assert.strictEqual(r.truncated, false);
});

test('the read budget cut mid-range: that range is named budget and its pages read so far are kept', () => {
  // Nine newest ranges of 450 runs spend 5 calls each (45); the tenth holds 900 runs, so its
  // fifth full page spends the last call and its sixth is never read.
  const from = new Date('2025-10-08T00:00:00Z');
  const starts = Array.from({ length: 58 }, (_, i) => new Date(from.getTime() + i * WEEK).toISOString().slice(0, 10));
  const newest = starts.slice().reverse();
  const full = newest.slice(0, 9).flatMap((week) => weekRuns(week, 450));
  const cut = weekRuns(newest[9], 900);
  const { runner, calls } = simRunner([...full, ...cut]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from, days: 400 }, { runner });
  assert.strictEqual(calls.length, RUN_PAGE_BUDGET);
  assert.strictEqual(r.runs.length, 9 * 450 + 500);
  const cutEntry = r.truncatedRanges.find((t) => t.from === newest[9]);
  assert.deepStrictEqual(cutEntry, { from: newest[9], to: dayBefore(newest[8]), reason: 'budget' });
  assert.strictEqual(r.truncatedRanges.length, 58 - 9);
  assert.ok(r.truncatedRanges.every((t) => t.reason === 'budget'));
});

test('a run created exactly on a range boundary is served by one range only, and that range is its stats bucket', () => {
  const at = (s) => ({ id: s.length + Date.parse(s), created_at: s });
  const boundary = [
    at('2026-10-19T23:59:59Z'), at('2026-10-20T00:00:00Z'),
    at('2026-11-02T23:59:59Z'), at('2026-11-03T00:00:00Z'), at('2026-11-10T00:00:00Z'),
  ];
  const { runner, served } = simRunner(boundary);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.strictEqual(r.runs.length, boundary.length);
  for (const run of boundary) {
    const servedBy = served.filter((s) => s.ids.includes(run.id));
    assert.strictEqual(servedBy.length, 1, `${run.created_at} served by ${servedBy.length} ranges`);
    const rangeIndex = (Date.parse(servedBy[0].created.split('..')[0]) - FROM30.getTime()) / WEEK;
    assert.strictEqual(rangeIndex, bucketIndex(Date.parse(run.created_at), FROM30.getTime()), run.created_at);
  }
});

test('one range failing is named and the other ranges still read; every range failing leaves the half unavailable', () => {
  const pool = RANGES30.flatMap((week) => weekRuns(week, 30));
  const sim = simRunner(pool);
  const failing = (args, opts) => {
    if (createdOf({ args }).startsWith('2026-10-27')) throw ghError('HTTP 502: Bad Gateway');
    return sim.runner(args, opts);
  };
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner: failing });
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.runs.length, 120);
  assert.deepStrictEqual(r.failures, [{ query: 'runs 2026-10-27..2026-11-02 page 1', status: 502, error: 'HTTP 502: Bad Gateway' }]);
  assert.strictEqual(r.truncated, false);
  const all = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner: () => { throw ghError('HTTP 500'); } });
  assert.strictEqual(all.available, false);
  assert.strictEqual(all.pages, 0);
  assert.deepStrictEqual(all.failures.map((f) => f.query), RANGES30.slice().reverse().map((start, i, a) =>
    `runs ${start}..${dayBefore(i === 0 ? '2026-11-17' : a[i - 1])} page 1`));
});

test('a fully read busy window gives every full bucket a weekly p50 and a trend', () => {
  // 300 working pull_request runs per week, 1,500 in all: past the old single-query cap.
  const pool = RANGES30.flatMap((week, w) => weekRuns(week, 300).map((run) => ({
    ...run, name: 'ci.yml', path: '.github/workflows/ci.yml', event: 'pull_request', status: 'completed', conclusion: 'success',
    run_started_at: run.created_at, updated_at: new Date(Date.parse(run.created_at) + (100 + 10 * w) * 1000).toISOString(),
  })));
  const { runner } = simRunner(pool);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner });
  assert.strictEqual(r.truncated, false);
  const [ci] = computeStats(r.runs, { from: FROM30, days: 30, defaultBranch: 'main' });
  assert.deepStrictEqual(ci.weeklyP50Seconds, [100, 110, 120, 130]);
  assert.deepStrictEqual(ci.trend, { ratio: 1.3, label: 'rising' });
});

for (const [label, stderr, status] of [
  ['401', 'HTTP 401: Bad credentials (https://api.github.com/repos/acme/widgets/actions/runs)', 401],
  ['403', 'HTTP 403: Resource not accessible by integration', 403],
  ['429', 'API rate limit exceeded for user ID 1. (HTTP 429)', 429],
]) {
  test(`page 1 throwing HTTP ${label} leaves the runs half unavailable with status ${status}`, () => {
    const { runner, calls } = runsRunner([ghError(stderr)]);
    const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
    assert.strictEqual(r.available, false);
    assert.strictEqual(r.ghAbsent, false);
    assert.strictEqual(r.pages, 0);
    assert.deepStrictEqual(r.runs, []);
    assert.strictEqual(r.failures[0].query, `runs ${ONE_RANGE} page 1`);
    assert.strictEqual(r.failures[0].status, status);
    assert.strictEqual(calls.length, 1);
  });
}

test('ENOENT on the first call signals gh absent with no failure row, and stops every range', () => {
  const { runner, calls } = runsRunner([enoent(), 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(r.ghAbsent, true);
  assert.strictEqual(r.available, false);
  assert.deepStrictEqual(r.failures, []);
  assert.deepStrictEqual(r.runs, []);
  assert.strictEqual(calls.length, 1);
  const wide = [];
  const absent = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM30, days: 30 }, { runner: (args) => { wide.push(args); throw enoent(); } });
  assert.strictEqual(absent.ghAbsent, true);
  assert.deepStrictEqual(absent.failures, []);
  assert.deepStrictEqual(absent.truncatedRanges, [], 'gh absent reads as unavailable, never as a truncated window');
  assert.strictEqual(wide.length, 1, 'no later range is tried once gh is absent');
});

test('ENOENT on page 2 is a failed page, never gh absent: page 1 kept, the page named, and stops', () => {
  const { runner, calls } = runsRunner([100, enoent(), 100]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(r.available, true);
  assert.strictEqual(r.ghAbsent, false);
  assert.strictEqual(r.runs.length, 100);
  assert.strictEqual(r.pages, 1);
  assert.deepStrictEqual(r.failures, [{ query: `runs ${ONE_RANGE} page 2`, status: null, error: 'spawnSync gh ENOENT' }]);
  assert.strictEqual(calls.length, 2, 'no page 3 call');
});

test('a run repeated across a page boundary (page drift) is counted once, first occurrence kept', () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, n: 1 }));
  const page2 = [{ id: 100, n: 2 }, { id: 101, n: 2 }, { id: 102, n: 2 }];
  const { runner } = runsRunner([
    JSON.stringify({ total_count: 102, workflow_runs: page1 }),
    JSON.stringify({ total_count: 102, workflow_runs: page2 }),
  ]);
  const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
  assert.strictEqual(r.runs.length, 102);
  assert.deepStrictEqual(r.runs.filter((run) => run.id === 100), [{ id: 100, n: 1 }]);
  assert.deepStrictEqual(r.runs.map((run) => run.id), Array.from({ length: 102 }, (_, i) => i + 1));
  assert.strictEqual(r.pages, 2);
});

for (const [label, body] of [
  ['an unparseable body', 'not json'],
  ['a non-array workflow_runs', JSON.stringify({ total_count: 1, workflow_runs: { id: 1 } })],
  ['a body without workflow_runs', JSON.stringify({ message: 'ok' })],
]) {
  test(`${label} on page 2 is a failed page with a null status, and stops`, () => {
    const { runner, calls } = runsRunner([100, body, 100]);
    const r = fetchRuns({ owner: 'acme', repo: 'widgets', from: FROM, days: DAYS }, { runner });
    assert.strictEqual(r.available, true);
    assert.strictEqual(r.runs.length, 100);
    assert.strictEqual(r.failures.length, 1);
    assert.strictEqual(r.failures[0].query, `runs ${ONE_RANGE} page 2`);
    assert.strictEqual(r.failures[0].status, null);
    assert.ok(r.failures[0].error.length > 0);
    assert.strictEqual(calls.length, 2);
  });
}

test('readRepo issues the exact GET and maps the org fixture', () => {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (args[3] !== 'repos/example-org/widgets') throw new Error('unexpected ' + args.join(' '));
    return REPO_ORG;
  };
  const r = readRepo({ owner: 'example-org', repo: 'widgets' }, { runner });
  assert.deepStrictEqual(r, { ok: true, ownerType: 'Organization', ownerLogin: 'example-org', defaultBranch: 'main' });
  assert.deepStrictEqual(calls, [{ args: ['api', '--method', 'GET', 'repos/example-org/widgets'], opts: { timeout: 15000 } }]);
});

test('readRepo maps a throw to ok: false with the HTTP status and error text', () => {
  const runner = () => { throw ghError('HTTP 404: Not Found (https://api.github.com/repos/acme/gone)'); };
  const r = readRepo({ owner: 'acme', repo: 'gone' }, { runner });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 404);
  assert.match(r.error, /HTTP 404: Not Found/);
  assert.strictEqual(r.ghAbsent, false);
});

test('readRepo maps ENOENT to ghAbsent: true with a null status', () => {
  const r = readRepo({ owner: 'acme', repo: 'widgets' }, { runner: () => { throw enoent(); } });
  assert.deepStrictEqual({ ok: r.ok, status: r.status, ghAbsent: r.ghAbsent }, { ok: false, status: null, ghAbsent: true });
});

for (const [label, body] of [
  ['an owner type', { default_branch: 'main', owner: { login: 'acme' } }],
  ['an owner login', { default_branch: 'main', owner: { type: 'Organization' } }],
  ['a default branch', { owner: { login: 'acme', type: 'Organization' } }],
]) {
  test(`readRepo maps a body without ${label} to ok: false, never ok with an undefined field`, () => {
    const r = readRepo({ owner: 'acme', repo: 'widgets' }, { runner: () => JSON.stringify(body) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.status, null);
    assert.strictEqual(r.ghAbsent, false);
  });
}

test('errorText prefers stderr, else the message, trimmed and capped at 300 chars — never stdout', () => {
  assert.strictEqual(errorText(ghError('  HTTP 403: nope \n')), 'HTTP 403: nope');
  const noStderr = Object.assign(new Error(' boom '), { stdout: '{"netAmount": 123}\n' });
  assert.strictEqual(errorText(noStderr), 'boom');
  assert.doesNotMatch(errorText(noStderr), /123/);
  assert.strictEqual(errorText(new Error('only message')), 'only message');
  assert.strictEqual(errorText(ghError('x'.repeat(500))).length, 300);
});

test('httpStatusOf reads stderr first, then message, else null', () => {
  assert.strictEqual(httpStatusOf(ghError('HTTP 410: Gone')), 410);
  assert.strictEqual(httpStatusOf(new Error('gh: HTTP 502 bad gateway')), 502);
  const both = Object.assign(new Error('HTTP 500'), { stderr: 'HTTP 404: Not Found' });
  assert.strictEqual(httpStatusOf(both), 404);
  assert.strictEqual(httpStatusOf(new Error('socket hang up')), null);
  assert.strictEqual(httpStatusOf(enoent()), null);
});

test('isGhAbsent is true only for ENOENT', () => {
  assert.strictEqual(isGhAbsent(enoent()), true);
  assert.strictEqual(isGhAbsent(ghError('HTTP 404')), false);
  assert.strictEqual(isGhAbsent(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })), false);
  assert.strictEqual(isGhAbsent(undefined), false);
});
