'use strict';
// tests/bin-lib/ci-audit/source.test.js — #5757: the ci-audit source adapter, the one module that
// reads the forge. A fake runner (no network, no gh) answers the per-workflow runs list and the
// per-run jobs reads with fixtures trimmed from real `actions/workflows/{file}/runs` and
// `actions/runs/{id}/jobs` responses; the real runner's spawn options are pinned through
// makeRunner's spawn parameter; repository resolution runs over injected origin and pin deps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const childProcess = require('child_process');
const os = require('os');
const path = require('path');
const {
  readRunData, readWorkflowFiles, makeRunner, resolveRepo, validRepo, stepRunName, withRunNames,
  DEFAULT_MAX_RUNS, MAX_RUNS, MAX_TOTAL_RUNS, MAX_RUN_PAGES, NO_WORKFLOW_FILES,
} = require('../../../plugin/bin/lib/ci-audit/source');
const { CI_HEALTH_GH_TIMEOUT_MS } = require('../../../plugin/bin/lib/ci-health/constants');
const { LARGE_MAX_BUFFER_BYTES } = require('../../../plugin/bin/lib/shared-primitives');
const { pinExplicitRepoHost, _resetGhHostCache } = require('../../../plugin/bin/lib/repo-resolve');

const NOW = new Date('2026-11-16T18:00:00Z');
const TEST = '.github/workflows/test.yml';
const TRACK = '.github/workflows/track-issue-fixes.yml';

// Trimmed from `gh api repos/thn-inc/claude-tweaks/actions/workflows/test.yml/runs` (2026-11-16):
// real field names, extra fields kept so the adapter is seen dropping them.
function runRow(over = {}) {
  return {
    id: 43904630871,
    name: 'test',
    path: TEST,
    status: 'completed',
    conclusion: 'success',
    event: 'pull_request',
    run_attempt: 1,
    created_at: '2026-11-16T16:10:58Z',
    run_started_at: '2026-11-16T16:10:58Z',
    updated_at: '2026-11-16T16:14:25Z',
    ...over,
  };
}

// Trimmed from `gh api repos/thn-inc/claude-tweaks/actions/runs/43904630871/jobs?per_page=100`:
// `test` needs the `shard` matrix, and its created_at equals the last shard's completed_at.
const TEST_JOBS = {
  total_count: 2,
  jobs: [
    {
      id: 1, run_id: 43904630871, name: 'shard 1/4', status: 'completed', conclusion: 'success', runner_name: 'GitHub Actions 1',
      created_at: '2026-11-16T16:10:59Z', started_at: '2026-11-16T16:11:01Z', completed_at: '2026-11-16T16:14:02Z',
      steps: [
        { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success', started_at: '2026-11-16T16:11:01Z', completed_at: '2026-11-16T16:11:04Z' },
        { name: 'Run actions/checkout@v7', number: 2, status: 'completed', conclusion: 'success', started_at: '2026-11-16T16:11:04Z', completed_at: '2026-11-16T16:11:18Z' },
      ],
    },
    {
      id: 2, run_id: 43904630871, name: 'test', status: 'completed', conclusion: 'success', runner_name: 'GitHub Actions 2',
      created_at: '2026-11-16T16:14:02Z', started_at: '2026-11-16T16:14:08Z', completed_at: '2026-11-16T16:14:24Z',
      steps: [
        { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success', started_at: '2026-11-16T16:14:08Z', completed_at: '2026-11-16T16:14:10Z' },
      ],
    },
  ],
};

const TRACK_RUN = runRow({
  id: 43904882452, name: 'Track issue fixes across branches', path: TRACK, event: 'push',
  created_at: '2026-11-16T16:12:19Z', run_started_at: '2026-11-16T16:12:19Z', updated_at: '2026-11-16T16:12:54Z',
});
const TRACK_JOBS = {
  total_count: 1,
  jobs: [{
    id: 3, run_id: 43904882452, name: 'track', status: 'completed', conclusion: 'success',
    created_at: '2026-11-16T16:12:20Z', started_at: '2026-11-16T16:12:24Z', completed_at: '2026-11-16T16:12:50Z',
    steps: 'not an array',
  }],
};

const LISTING = { ok: true, workflows: [{ file: TEST, text: '' }, { file: TRACK, text: '' }] };
const listingOf = (...files) => ({ ok: true, workflows: files.map((file) => ({ file, text: '' })) });

const LIST_RE = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs$/;
const listedFile = (args) => { const m = args[0] === 'api' ? LIST_RE.exec(args[3]) : null; return m ? m[1] : null; };
const jobsRunId = (args) => {
  const m = args[0] === 'api' ? /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(args[3]) : null;
  return m ? Number(m[1]) : null;
};
const argVal = (args, key) => { const a = args.find((x) => x.startsWith(`${key}=`)); return a ? a.slice(key.length + 1) : null; };
const pageOf = (args) => Number(argVal(args, 'page'));
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

// A fake runner over `runs` (every run row; each workflow's list serves the rows whose path ends in
// its file name, created on or after the `created=>=` day, newest first, paged by per_page) and
// `jobs` (run id -> jobs body, or a function of the page number, or a string body, or an Error).
// `listError` (an Error, or file -> Error|null) fails a workflow's list. Records every call.
function fakeRunner({ runs = [], jobs = {}, listError = null, listBody = null } = {}) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (calls.length > 1000) throw new Error('call ceiling');
    const file = listedFile(args);
    if (file !== null) {
      const err = typeof listError === 'function' ? listError(file, pageOf(args)) : listError;
      if (err) throw err;
      if (listBody !== null) return listBody;
      const from = Date.parse(`${argVal(args, 'created').replace(/^>=/, '')}T00:00:00Z`);
      const mine = runs.filter((r) => typeof r.path === 'string' && base(r.path) === file && Date.parse(r.created_at) >= from)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      const per = Number(argVal(args, 'per_page'));
      const n = pageOf(args);
      return JSON.stringify({ total_count: mine.length, workflow_runs: mine.slice((n - 1) * per, n * per) });
    }
    const id = jobsRunId(args);
    if (id !== null && Object.prototype.hasOwnProperty.call(jobs, id)) {
      const j = jobs[id];
      if (j instanceof Error) throw j;
      if (typeof j === 'string') return j;
      return JSON.stringify(typeof j === 'function' ? j(pageOf(args)) : j);
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { runner, calls };
}
const listCalls = (fake) => fake.calls.filter((c) => listedFile(c.args) !== null);
const jobsCalls = (fake) => fake.calls.map((c) => jobsRunId(c.args)).filter((id) => id !== null);

const read = (fake, over = {}) => readRunData({ runner: fake.runner, repo: 'thn-inc/claude-tweaks', listing: LISTING, days: 7, now: NOW, ...over });
const ZERO = { skipped: 0, neverRun: 0 };

test('two workflows\' runs with jobs and steps map to the exact NormRun / NormJob shape', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  assert.deepEqual(read(fake), {
    ok: true,
    cliAbsent: false,
    truncated: [],
    failures: [],
    unsampled: ZERO,
    workflow: null,
    empty: null,
    runs: [
      {
        id: 43904630871, workflow: TEST, conclusion: 'success', createdAt: '2026-11-16T16:10:58Z',
        jobs: [
          {
            name: 'shard 1/4', createdAt: '2026-11-16T16:10:59Z', startedAt: '2026-11-16T16:11:01Z', completedAt: '2026-11-16T16:14:02Z',
            conclusion: 'success',
            steps: [
              { name: 'Set up job', number: 1, conclusion: 'success', startedAt: '2026-11-16T16:11:01Z', completedAt: '2026-11-16T16:11:04Z' },
              { name: 'Run actions/checkout@v7', number: 2, conclusion: 'success', startedAt: '2026-11-16T16:11:04Z', completedAt: '2026-11-16T16:11:18Z' },
            ],
          },
          {
            name: 'test', createdAt: '2026-11-16T16:14:02Z', startedAt: '2026-11-16T16:14:08Z', completedAt: '2026-11-16T16:14:24Z',
            conclusion: 'success',
            steps: [{ name: 'Set up job', number: 1, conclusion: 'success', startedAt: '2026-11-16T16:14:08Z', completedAt: '2026-11-16T16:14:10Z' }],
          },
        ],
      },
      {
        id: 43904882452, workflow: TRACK, conclusion: 'success', createdAt: '2026-11-16T16:12:19Z',
        jobs: [{
          name: 'track', createdAt: '2026-11-16T16:12:20Z', startedAt: '2026-11-16T16:12:24Z', completedAt: '2026-11-16T16:12:50Z',
          conclusion: 'success', steps: [],
        }],
      },
    ],
  });
});

test('every call is a GET on a literal repos/ path, bounded by the shared timeout', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  read(fake);
  assert.equal(fake.calls.length, 4);
  for (const { args, opts } of fake.calls) {
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    assert.ok(args[3].startsWith('repos/thn-inc/claude-tweaks/'), args[3]);
    assert.equal(opts.timeout, CI_HEALTH_GH_TIMEOUT_MS);
  }
  assert.deepEqual(fake.calls[0].args, [
    'api', '--method', 'GET', 'repos/thn-inc/claude-tweaks/actions/workflows/test.yml/runs',
    '-f', 'created=>=2026-11-09', '-f', 'status=completed', '-f', 'exclude_pull_requests=true', '-f', 'per_page=100', '-f', 'page=1',
  ]);
  assert.deepEqual(fake.calls.find((c) => jobsRunId(c.args) === 43904630871).args, [
    'api', '--method', 'GET', 'repos/thn-inc/claude-tweaks/actions/runs/43904630871/jobs',
    '-f', 'filter=latest', '-f', 'per_page=100', '-f', 'page=1',
  ]);
});

test('a runner whose every call throws ENOENT is ok:false, cliAbsent:true, with the CLI named absent', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', listing: LISTING, days: 7, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, true);
  assert.deepEqual(r.runs, []);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /gh .*not installed/i);
  assert.equal(calls.length, 1);
});

test('every runs list failing (not ENOENT) is ok:false with each failure recorded', () => {
  const r = read(fakeRunner({ listError: Object.assign(new Error('boom'), { stderr: 'HTTP 502: Bad Gateway' }) }));
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.runs, []);
  assert.deepEqual(r.failures, [`runs of ${TEST} page 1: HTTP 502: Bad Gateway`, `runs of ${TRACK} page 1: HTTP 502: Bad Gateway`]);
});

test('one workflow\'s list failing keeps the other\'s runs: ok:true with the failure named', () => {
  const fake = fakeRunner({
    runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS },
    listError: (file) => (file === 'test.yml' ? Object.assign(new Error('x'), { stderr: 'HTTP 500' }) : null),
  });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.workflow), [TRACK]);
  assert.deepEqual(r.failures, [`runs of ${TEST} page 1: HTTP 500`]);
  assert.deepEqual(r.truncated, [], 'a failed read is a failure, never also truncation');
});

// The forge's real answer for a workflow file it has never run (probed 2026-11-16).
const notFound = () => Object.assign(new Error('Command failed'), { stderr: 'gh: Not Found (HTTP 404)' });

test('a listed workflow file the forge has never run (HTTP 404) is an empty read, counted in neverRun, never a failure', () => {
  const fake = fakeRunner({
    runs: [TRACK_RUN], jobs: { 43904882452: TRACK_JOBS },
    listError: (file) => (file === 'test.yml' ? notFound() : null),
  });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.truncated, []);
  assert.deepEqual(r.unsampled, { skipped: 0, neverRun: 1 });
  assert.deepEqual(r.runs.map((x) => x.workflow), [TRACK]);
  // a 404 on a later page is a failed read, not a never-run file
  const rows = many(TEST, 120, () => ({ conclusion: 'skipped' }));
  const later = fakeRunner({ runs: rows, jobs: {}, listError: (file, page) => (page === 2 ? notFound() : null) });
  const l = read(later, { listing: listingOf(TEST) });
  assert.deepEqual(l.failures, [`runs of ${TEST} page 2: gh: Not Found (HTTP 404)`]);
  assert.deepEqual(l.unsampled, { skipped: 100, neverRun: 0 });
});

test('every listed workflow answering 404 stays a failure: the repository itself may be wrong', () => {
  const r = read(fakeRunner({ listError: notFound() }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, [`runs of ${TEST} page 1: not found (HTTP 404)`, `runs of ${TRACK} page 1: not found (HTTP 404)`]);
  assert.deepEqual(r.unsampled, { skipped: 0, neverRun: 0 });
});

test('a runs list body that is not JSON is a fixed failure text that quotes no byte of the body', () => {
  const body = 'Zq<!--9f3aXk-->';
  const r = read(fakeRunner({ listBody: body }), { listing: listingOf(TEST) });
  assert.deepEqual(r.failures, [`runs of ${TEST} page 1: response is not JSON`]);
  for (let i = 0; i + 2 <= body.length; i += 1) assert.ok(!r.failures[0].includes(body.slice(i, i + 2)), `failure quotes ${body.slice(i, i + 2)}`);
});

test('one failing jobs read excludes that run, records one failure, and keeps the rest', () => {
  const fake = fakeRunner({
    runs: [runRow(), TRACK_RUN],
    jobs: { 43904630871: TEST_JOBS, 43904882452: Object.assign(new Error('x'), { stderr: 'HTTP 500: Server Error' }) },
  });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: HTTP 500: Server Error']);
});

test('a jobs body with no jobs array is a failed jobs read, never an empty run', () => {
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: { total_count: 1 } } }));
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: page 1: response has no jobs array']);
});

test('every per-run jobs read failing is ok:false with every failure recorded', () => {
  const err = () => Object.assign(new Error('x'), { stderr: 'HTTP 500: Server Error' });
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: err(), 43904882452: err() } }));
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.runs, []);
  assert.equal(r.failures.filter((f) => /43904630871|43904882452/.test(f)).length, 2);
});

const newestTestRuns = (n) => Array.from({ length: n }, (_, i) => runRow({ id: 100 + i, created_at: `2026-11-16T10:${String(59 - i).padStart(2, '0')}:00Z` }));
const failing = () => Object.assign(new Error('x'), { stderr: 'HTTP 502: Bad Gateway' });

test('five consecutive failed jobs reads stop the per-run reads: later runs are not read and one truncated line counts them', () => {
  const runs = newestTestRuns(9);
  const jobs = Object.fromEntries(runs.map((r) => [r.id, failing()]));
  const fake = fakeRunner({ runs, jobs });
  const r = read(fake, { listing: listingOf(TEST) });
  assert.equal(r.ok, false);
  assert.equal(jobsCalls(fake).length, 5);
  assert.equal(r.failures.length, 5);
  assert.deepEqual(r.truncated, ['jobs of 4 sampled runs: not read (stopped after 5 consecutive failed jobs reads)']);
});

test('a successful jobs read resets the failure streak: four failures, a success, four failures read every run', () => {
  const runs = newestTestRuns(9);
  const jobs = Object.fromEntries(runs.map((r, i) => [r.id, i === 4 ? TEST_JOBS : failing()]));
  const fake = fakeRunner({ runs, jobs });
  const r = read(fake, { listing: listingOf(TEST) });
  assert.equal(jobsCalls(fake).length, 9);
  assert.equal(r.failures.length, 8);
  assert.deepEqual(r.truncated, []);
  assert.equal(r.ok, true);
});

test('a list with zero completed runs that did work is ok:true, runs:[]; skipped and in-progress runs are not sampled', () => {
  const fake = fakeRunner({ runs: [runRow({ status: 'in_progress', conclusion: null }), runRow({ id: 7, conclusion: 'skipped' })] });
  assert.deepEqual(read(fake), {
    ok: true, cliAbsent: false, runs: [], truncated: [], failures: [], unsampled: { skipped: 1, neverRun: 0 }, workflow: null, empty: null,
  });
  assert.deepEqual(jobsCalls(fake), []);
});

test('unsampled is present with zeros on a refusal and on a failed list', () => {
  assert.deepEqual(read(fakeRunner(), { maxRuns: 0 }).unsampled, ZERO);
  const throwing = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); };
  assert.deepEqual(readRunData({ runner: throwing, repo: 'o/r', listing: LISTING, days: 7, now: NOW }).unsampled, ZERO);
});

test('workflow files that could not be listed are a refusal: ok:false, the error named, no call', () => {
  for (const listing of [{ ok: false, workflows: [], error: '.github/workflows is not a directory' }, null]) {
    const f = fakeRunner();
    const r = read(f, { listing });
    assert.equal(r.ok, false);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], /^workflow files: /);
    assert.equal(f.calls.length, 0);
  }
});

test('a checkout with no workflow files is ok:true with an empty reason naming the location, and no call', () => {
  const f = fakeRunner();
  const r = read(f, { listing: { ok: true, workflows: [] } });
  assert.deepEqual([r.ok, r.runs, r.failures, r.empty], [true, [], [], NO_WORKFLOW_FILES]);
  assert.match(NO_WORKFLOW_FILES, /^no workflow files readable at \.github\/workflows\//);
  assert.equal(f.calls.length, 0);
});

test('a non-null workflow filter that normalizes to nothing is refused before any call', () => {
  for (const bad of ['', 42, '/', '//', './', '\\\\']) {
    const f = fakeRunner({ runs: [runRow()], jobs: { 43904630871: TEST_JOBS } });
    const r = read(f, { workflow: bad });
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.failures.length, 1, JSON.stringify(bad));
    assert.match(r.failures[0], /^workflow /, JSON.stringify(bad));
    assert.equal(f.calls.length, 0, JSON.stringify(bad));
  }
  assert.equal(read(fakeRunner(), { workflow: null }).ok, true);
  assert.equal(read(fakeRunner(), { workflow: undefined }).ok, true);
});

test('the workflow filter takes the path, its ./ and backslash forms, or the bare file name — and lists only that workflow', () => {
  // Each raw form differs from the listed path; only the normalization makes it match.
  for (const form of [TEST, `./${TEST}`, TEST.replace(/\//g, '\\'), 'test.yml']) {
    const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
    const r = read(fake, { workflow: form });
    assert.equal(r.ok, true, form);
    assert.equal(r.workflow, TEST, form);
    assert.deepEqual(r.runs.map((x) => x.workflow), [TEST], form);
    assert.deepEqual(listCalls(fake).map((c) => listedFile(c.args)), ['test.yml'], form);
    assert.deepEqual(jobsCalls(fake), [43904630871], form);
  }
});

test('a workflow filter that matches no workflow file says so, with no call', () => {
  const f = fakeRunner({ runs: [runRow()] });
  const r = read(f, { workflow: 'nope.yml' });
  assert.deepEqual([r.ok, r.runs, r.workflow], [true, [], null]);
  assert.equal(r.empty, 'workflow filter "nope.yml" matched no workflow file in .github/workflows/');
  assert.equal(f.calls.length, 0);
});

test('days and now are validated before any call, like maxRuns', () => {
  const bads = [
    ['days', { days: NaN }], ['days', { days: 0 }], ['days', { days: 1.5 }], ['days', { days: '7' }], ['days', { days: 401 }],
    ['now', { now: new Date('not a date') }], ['now', { now: '2026-11-16' }], ['now', { now: 0 }],
  ];
  for (const [field, over] of bads) {
    const f = fakeRunner();
    let r;
    assert.doesNotThrow(() => { r = read(f, over); }, `${field} ${String(Object.values(over)[0])}`);
    assert.equal(r.ok, false);
    assert.equal(r.failures.length, 1);
    assert.match(r.failures[0], new RegExp(`^${field} `));
    assert.equal(f.calls.length, 0);
  }
  assert.equal(read(fakeRunner(), { days: 400 }).ok, true);
});

// ---- the runs list stops as soon as the sample is held (I4) ----
const many = (file, n, over = () => ({})) => Array.from({ length: n }, (_, i) => runRow({
  id: 1000 + i, path: file, created_at: new Date(Date.parse('2026-11-16T12:00:00Z') - i * 60000).toISOString(), ...over(i),
}));
const jobsFor = (rows) => Object.fromEntries(rows.map((x) => [x.id, TRACK_JOBS]));

test('a workflow with 250 runs in the window takes one list page for 20 runs, and nothing is truncated', () => {
  const rows = many(TEST, 250);
  const fake = fakeRunner({ runs: rows, jobs: jobsFor(rows) });
  const r = read(fake, { listing: listingOf(TEST) });
  assert.equal(listCalls(fake).length, 1);
  assert.equal(r.runs.length, 20);
  assert.deepEqual(r.runs.map((x) => x.id), rows.slice(0, 20).map((x) => x.id), 'the newest 20');
  assert.deepEqual(r.truncated, []);
});

test('a list page of mostly skipped runs reads the next page, and stops once maxRuns runs did work', () => {
  // Page 1: 10 usable of 100; page 2: 50 usable. Twenty are held after page 2, so no page 3.
  const rows = many(TEST, 300, (i) => ({ conclusion: (i < 100 ? i % 10 !== 0 : i % 2 !== 0) ? 'skipped' : 'success' }));
  const fake = fakeRunner({ runs: rows, jobs: jobsFor(rows) });
  const r = read(fake, { listing: listingOf(TEST) });
  assert.equal(listCalls(fake).length, 2);
  assert.equal(r.runs.length, 20);
  assert.deepEqual(r.truncated, []);
  assert.equal(r.unsampled.skipped, 90 + 50);
});

test('a window whose runs run out before maxRuns is complete, not truncated', () => {
  const rows = many(TEST, 7);
  const r = read(fakeRunner({ runs: rows, jobs: jobsFor(rows) }), { listing: listingOf(TEST) });
  assert.equal(r.runs.length, 7);
  assert.deepEqual(r.truncated, []);
});

test('pages that run out at the page cap before maxRuns are named in truncated', () => {
  const rows = many(TEST, 600, (i) => ({ conclusion: i % 100 === 0 ? 'success' : 'skipped' }));
  const fake = fakeRunner({ runs: rows, jobs: jobsFor(rows) });
  const r = read(fake, { listing: listingOf(TEST) });
  assert.equal(listCalls(fake).length, MAX_RUN_PAGES);
  assert.equal(r.runs.length, 5);
  assert.deepEqual(r.truncated, [`runs of ${TEST}: 5 runs in ${MAX_RUN_PAGES} pages (page cap; fewer than 20)`]);
});

test('every workflow keeps its own newest maxRuns: a frequent workflow does not starve a rare one', () => {
  const busy = many(TEST, 40);
  const rare = many(TRACK, 2).map((x, i) => ({ ...x, id: 5000 + i, created_at: `2026-11-1${i}T00:00:00Z` }));
  const fake = fakeRunner({ runs: [...busy, ...rare], jobs: { ...jobsFor(busy), ...jobsFor(rare) } });
  const r = read(fake);
  assert.equal(r.runs.filter((x) => x.workflow === TEST).length, 20);
  assert.equal(r.runs.filter((x) => x.workflow === TRACK).length, 2);
  // round-robin order: each workflow's newest first
  assert.deepEqual(r.runs.slice(0, 4).map((x) => x.workflow), [TEST, TRACK, TEST, TRACK]);
});

test('runs past the overall bound are not sampled and are named once in truncated', () => {
  const files = Array.from({ length: 11 }, (_, i) => `.github/workflows/w${i}.yml`);
  const rows = files.flatMap((f, k) => many(f, 30).map((x) => ({ ...x, id: x.id + k * 100 })));
  const fake = fakeRunner({ runs: rows, jobs: jobsFor(rows) });
  const r = read(fake, { listing: listingOf(...files), maxRuns: 30 });
  assert.equal(r.runs.length, MAX_TOTAL_RUNS);
  assert.deepEqual(r.truncated, [`${11 * 30 - MAX_TOTAL_RUNS} listed runs not sampled: the ${MAX_TOTAL_RUNS}-run overall bound`]);
  // round-robin: the cut falls on the last round, so no workflow keeps fewer than 27
  for (const f of files) assert.ok(r.runs.filter((x) => x.workflow === f).length >= 27, f);
});

test('the deadline cuts the list phase short of the jobs reserve and names the workflow it left short', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (listedFile(args) !== null) t = 260000; // past 570 − 300 − 15 s after the first list call
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', listing: LISTING, days: 7, now: NOW, clock: () => t, maxRuns: 2 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.truncated, [`runs of ${TRACK}: 0 runs listed before the deadline (fewer than 2)`]);
  assert.deepEqual(r.runs.map((x) => x.workflow), [TEST]);
});

test('sampled runs the deadline leaves unread are named per workflow in truncated, not failures', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (jobsRunId(args) !== null) t = 570000; // past the whole deadline after the first jobs read
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', listing: LISTING, days: 7, now: NOW, clock: () => t });
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.truncated, [`jobs of 1 sampled run of ${TRACK}: not read (deadline)`]);
});

test('every sampled run cut by the deadline is ok:false with no failures and the unread runs named', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (listedFile(args) === 'track-issue-fixes.yml') t = 560000;
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', listing: LISTING, days: 7, now: NOW, clock: () => t });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.truncated, [`jobs of 1 sampled run of ${TEST}: not read (deadline)`, `jobs of 1 sampled run of ${TRACK}: not read (deadline)`]);
  assert.deepEqual(jobsCalls(fake), []);
});

// ---- jobs pages ----
test('a full jobs page with no total_count is named in truncated; a short one is complete', () => {
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const full = fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: () => ({ jobs: Array.from({ length: 100 }, (_, i) => job(i)) }) } });
  const r = read(full, { listing: listingOf(TRACK) });
  assert.equal(r.ok, true);
  assert.equal(r.runs[0].jobs.length, 100);
  assert.deepEqual(r.truncated, ['jobs of run 43904882452: 100 jobs read, total unknown (no total_count on a full page)']);
  assert.equal(jobsCalls(full).length, 1);
  const short = read(fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: { jobs: [job(1)] } } }), { listing: listingOf(TRACK) });
  assert.equal(short.runs[0].jobs.length, 1);
  assert.deepEqual(short.truncated, []);
});

test('a full last jobs page that reaches total_count stops there: no further page is read', () => {
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const pager = (n) => ({ total_count: 200, jobs: Array.from({ length: 100 }, (_, i) => job((n - 1) * 100 + i)) });
  const fake = fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: pager } });
  const r = read(fake, { listing: listingOf(TRACK) });
  assert.equal(r.runs[0].jobs.length, 200);
  assert.equal(jobsCalls(fake).length, 2);
  assert.deepEqual(r.truncated, []);
});

test('a non-JSON jobs body is a fixed failure text that quotes no byte of the body', () => {
  const body = 'Zq<!--9f3aXk-->';
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: body } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: response is not JSON']);
  for (let i = 0; i + 2 <= body.length; i += 1) assert.ok(!r.failures[0].includes(body.slice(i, i + 2)), `failure quotes ${body.slice(i, i + 2)}`);
});

test('a sampled run with an invalid id is excluded with a failure line and no jobs read', () => {
  for (const id of [0, -3, 1.5, '12', null]) {
    const f = fakeRunner({ runs: [runRow(), runRow({ id, created_at: '2026-11-16T16:13:00Z' })], jobs: { 43904630871: TEST_JOBS } });
    const r = read(f, { listing: listingOf(TEST) });
    assert.equal(r.ok, true, String(id));
    assert.deepEqual(r.runs.map((x) => x.id), [43904630871], String(id));
    assert.deepEqual(r.failures, [`run ${JSON.stringify(id)}: not a run id — excluded`], String(id));
    assert.deepEqual(jobsCalls(f), [43904630871], String(id));
  }
});

test('a listed workflow file whose name is not a plain file name is a failure, never a request path', () => {
  const f = fakeRunner({ runs: [runRow()], jobs: { 43904630871: TEST_JOBS } });
  const r = read(f, { listing: listingOf(TEST, '.github/workflows/-x.yml') });
  assert.deepEqual(r.failures, ['runs of .github/workflows/-x.yml: not a plain file name — not read']);
  assert.deepEqual(listCalls(f).map((c) => listedFile(c.args)), ['test.yml']);
});

test('gh vanishing during a jobs read is a failed jobs read; cliAbsent stays false (gh answered the listing)', () => {
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: enoent } }));
  assert.equal(r.ok, true);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: gh is not installed or not on PATH']);
});

test('maxRuns samples each workflow\'s most recent completed runs and reads only their jobs', () => {
  const older = runRow({ id: 31, created_at: '2026-11-15T10:00:00Z' });
  const fake = fakeRunner({ runs: [older, runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS, 31: TEST_JOBS } });
  const r = read(fake, { maxRuns: 1 });
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871, 43904882452]);
  assert.deepEqual(jobsCalls(fake).sort(), [43904630871, 43904882452]);
});

test('maxRuns defaults to DEFAULT_MAX_RUNS and is refused outside 1..MAX_RUNS', () => {
  assert.equal(DEFAULT_MAX_RUNS, 20);
  const rows = many(TEST, 25);
  assert.equal(read(fakeRunner({ runs: rows, jobs: jobsFor(rows) }), { listing: listingOf(TEST) }).runs.length, 20);
  for (const bad of [0, MAX_RUNS + 1, 1.5, '3']) {
    const f = fakeRunner();
    const r = read(f, { maxRuns: bad });
    assert.equal(r.ok, false, String(bad));
    assert.match(r.failures[0], /maxRuns/);
    assert.equal(f.calls.length, 0);
  }
});

test('a repo that is not owner/name is refused before any call', () => {
  for (const bad of ['-x/y', 'a/b/c', '../x', 'x/..', 'nope']) {
    const f = fakeRunner();
    const r = read(f, { repo: bad });
    assert.equal(r.ok, false, bad);
    assert.equal(f.calls.length, 0, bad);
    assert.equal(validRepo(bad), false, bad);
  }
  assert.equal(validRepo('thn-inc/claude-tweaks'), true);
});

test('a run whose jobs pass the page cap keeps the pages read and is named in truncated', () => {
  const total = 450;
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const pager = (n) => ({ total_count: total, jobs: Array.from({ length: Math.max(0, Math.min(100, total - (n - 1) * 100)) }, (_, i) => job((n - 1) * 100 + i)) });
  const r = read(fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: pager } }), { listing: listingOf(TRACK) });
  assert.equal(r.ok, true);
  assert.equal(r.runs[0].jobs.length, 300);
  assert.deepEqual(r.truncated, ['jobs of run 43904882452: 300 of 450 jobs read (page cap)']);
});

test('a run whose jobs span two pages reads both and is not truncated', () => {
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const pager = (n) => ({ total_count: 130, jobs: Array.from({ length: n === 1 ? 100 : 30 }, (_, i) => job((n - 1) * 100 + i)) });
  const r = read(fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: pager } }), { listing: listingOf(TRACK) });
  assert.equal(r.runs[0].jobs.length, 130);
  assert.deepEqual(r.truncated, []);
});

// ---- step names, the forge's rule for unnamed steps ----
test('stepRunName: a named step by its name, an unnamed one as `Run ` + its first line, else null', () => {
  assert.equal(stepRunName({ name: 'Test', kind: 'command', named: true, value: 'npm test' }), 'Test');
  assert.equal(stepRunName({ name: 'npm run test:perf', kind: 'command', named: false, value: 'npm run test:perf' }), 'Run npm run test:perf');
  assert.equal(stepRunName({ name: 'actions/checkout@v7', kind: 'action', named: false, value: 'actions/checkout@v7' }), 'Run actions/checkout@v7');
  assert.equal(stepRunName({ name: null, kind: 'command', named: false, value: 'npm ci' }), 'Run npm ci');
  assert.equal(stepRunName({ name: null, kind: 'command', named: false, value: null }), null);
  assert.equal(stepRunName(null), null);
  const facts = { jobs: [{ id: 'a', steps: [{ name: 'x', kind: 'command', named: false, value: 'x' }] }], concurrencyDeclared: true, unparsed: [] };
  assert.deepEqual(withRunNames(facts).jobs[0].steps, [{ name: 'x', kind: 'command', named: false, value: 'x', runName: 'Run x' }]);
  assert.equal(facts.jobs[0].steps[0].runName, undefined, 'the input is not mutated');
});

// ---- repository resolution ----
const gateDeps = { env: {}, homedir: '/nonexistent-home', readFile: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } };

test('resolveRepo: --repo is pinned as given; the origin is gated and pinned with its host', () => {
  const pins = [];
  const pinHost = (spec) => { pins.push(spec); };
  assert.deepEqual(resolveRepo({ repo: 'o/r' }, { pinHost, gateDeps }), { slug: 'o/r' });
  const roots = [];
  const remoteUrl = (root) => { roots.push(root); return 'git@github.com:thn-inc/claude-tweaks.git'; };
  assert.deepEqual(resolveRepo({ root: '/other' }, { remoteUrl, pinHost, gateDeps }), { slug: 'thn-inc/claude-tweaks' });
  assert.deepEqual(roots, ['/other']);
  assert.deepEqual(pins, [{ owner: 'o', repo: 'r' }, { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' }]);
});

test('resolveRepo reads the default origin from the injected cwd, not the process directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-audit-origin-'));
  try {
    childProcess.execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    childProcess.execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/injected/cwd-repo.git'], { cwd: dir, windowsHide: true });
    assert.deepEqual(resolveRepo({}, { cwd: () => dir, pinHost: () => {}, gateDeps }), { slug: 'injected/cwd-repo' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveRepo refuses an unreadable, unparseable, unusable or unknown-host origin, and a pin that throws', () => {
  const pinHost = () => {};
  const cases = [
    [{ remoteUrl: () => { throw new Error('no origin'); } }, /origin remote unreadable: no origin/],
    [{ remoteUrl: () => 'not a url' }, /names no GitHub repository/],
    [{ remoteUrl: () => 'https://github.com/-evil/repo.git' }, /unusable owner\/name/],
    [{ remoteUrl: () => 'https://git.corp.example/o/r.git' }, /is not a known GitHub host/],
    [{ remoteUrl: () => 'https://github.com/o/r.git', pinHost: () => { throw new Error('bad config'); } }, /could not pin the repository host: bad config/],
  ];
  for (const [deps, re] of cases) {
    const r = resolveRepo({}, { pinHost, gateDeps, ...deps });
    assert.match(r.error, re);
    assert.equal(r.slug, undefined);
  }
  assert.match(resolveRepo({ repo: '../x' }, { pinHost, gateDeps }).error, /not owner\/name/);
});

test('makeRunner spawns gh with windowsHide, the caller\'s timeout, the large buffer and the pinned host', () => {
  const saved = process.env.GH_HOST;
  delete process.env.GH_HOST;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-audit-source-'));
  try {
    _resetGhHostCache();
    assert.equal(pinExplicitRepoHost({ host: 'ghe.example.com' }, { cwd: dir, env: {} }), 'ghe.example.com');
    const spawned = [];
    const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return '{"ok":1}'; };
    const runner = makeRunner(spawn);
    assert.equal(runner(['api', '--method', 'GET', 'repos/o/r'], { timeout: 1234 }), '{"ok":1}');
    assert.equal(spawned.length, 1);
    const { cmd, args, opts } = spawned[0];
    assert.equal(cmd, 'gh');
    assert.deepEqual(args, ['api', '--method', 'GET', 'repos/o/r']);
    assert.equal(opts.windowsHide, true);
    assert.equal(opts.timeout, 1234);
    assert.equal(opts.maxBuffer, LARGE_MAX_BUFFER_BYTES);
    assert.equal(opts.encoding, 'utf8');
    assert.deepEqual(opts.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(opts.env.GH_HOST, 'ghe.example.com');
    runner(['api', '--method', 'GET', 'repos/o/r']);
    assert.equal(spawned[1].opts.timeout, CI_HEALTH_GH_TIMEOUT_MS, 'a call with no timeout still gets the shared bound');
  } finally {
    _resetGhHostCache();
    if (saved === undefined) delete process.env.GH_HOST; else process.env.GH_HOST = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const WF_A = 'name: a\non: push\njobs:\n  build:\n    runs-on: x\n    steps:\n      - run: echo a\n';
const WF_B = 'name: b\non: pull_request\njobs:\n  test:\n    runs-on: x\n    steps:\n      - run: echo b\n';

function checkout(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-audit-wf-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('readWorkflowFiles returns both workflow texts keyed by their forward-slash path, and ignores other files', () => {
  const root = checkout({ '.github/workflows/a.yml': WF_A, '.github/workflows/b.yaml': WF_B, '.github/workflows/notes.md': 'x' });
  try {
    assert.deepEqual(readWorkflowFiles(root), {
      ok: true,
      workflows: [{ file: '.github/workflows/a.yml', text: WF_A }, { file: '.github/workflows/b.yaml', text: WF_B }],
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a CRLF workflow file reads identically to its LF text', () => {
  const crlf = WF_A.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'));
  const root = checkout({ '.github/workflows/a.yml': crlf });
  try {
    assert.deepEqual(readWorkflowFiles(root), { ok: true, workflows: [{ file: '.github/workflows/a.yml', text: WF_A }] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readWorkflowFiles: no workflow directory is an empty set; an unlistable one is an error, never empty', () => {
  const root = checkout({ 'README.md': 'x' });
  try {
    assert.deepEqual(readWorkflowFiles(root), { ok: true, workflows: [] });
    fs.mkdirSync(path.join(root, '.github'));
    fs.writeFileSync(path.join(root, '.github', 'workflows'), 'not a dir');
    const r = readWorkflowFiles(root);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
    assert.deepEqual(r.workflows, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
