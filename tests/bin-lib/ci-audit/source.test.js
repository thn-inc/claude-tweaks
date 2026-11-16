'use strict';
// tests/bin-lib/ci-audit/source.test.js — #5757: the ci-audit source adapter, the one module that
// reads the forge. A fake runner (no network, no gh) answers the runs list and the per-run jobs
// reads with fixtures trimmed from a real `actions/runs` and `actions/runs/{id}/jobs` response;
// the real runner's spawn options are pinned through makeRunner's spawn parameter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readRunData, readWorkflowFiles, makeRunner, DEFAULT_MAX_RUNS, MAX_RUNS,
} = require('../../../plugin/bin/lib/ci-audit/source');
const { CI_HEALTH_GH_TIMEOUT_MS } = require('../../../plugin/bin/lib/ci-health/constants');
const { LARGE_MAX_BUFFER_BYTES } = require('../../../plugin/bin/lib/shared-primitives');
const { pinExplicitRepoHost, _resetGhHostCache } = require('../../../plugin/bin/lib/repo-resolve');

const NOW = new Date('2026-11-16T18:00:00Z');

// Trimmed from `gh api repos/thn-inc/claude-tweaks/actions/runs?per_page=5&status=completed`
// (2026-11-16): real field names, extra fields kept so the adapter is seen dropping them.
function runRow(over = {}) {
  return {
    id: 43904630871,
    name: 'test',
    path: '.github/workflows/test.yml',
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
  id: 43904882452, name: 'Track issue fixes across branches', path: '.github/workflows/track-issue-fixes.yml', event: 'push',
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

const createdRange = (args) => {
  const f = args.find((a) => a.startsWith('created='));
  const [a, b] = f.slice('created='.length).split('..');
  return [Date.parse(a), Date.parse(b)];
};
const isRunsList = (args) => args[0] === 'api' && /^repos\/[^/]+\/[^/]+\/actions\/runs$/.test(args[3]);
const jobsRunId = (args) => {
  const m = args[0] === 'api' ? /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(args[3]) : null;
  return m ? Number(m[1]) : null;
};
const pageOf = (args) => Number(args.find((a) => a.startsWith('page=')).slice(5));

// A fake runner over `runs` (the listing) and `jobs` (run id -> jobs body, or a function of the
// page number, or an Error to throw). Records every call; throws on anything it does not know.
function fakeRunner({ runs = [], jobs = {}, runsError = null } = {}) {
  const calls = [];
  const runner = (args, opts) => {
    calls.push({ args, opts });
    if (calls.length > 200) throw new Error('call ceiling');
    if (isRunsList(args)) {
      if (runsError) throw runsError;
      if (pageOf(args) > 1) return JSON.stringify({ total_count: 0, workflow_runs: [] });
      const [from, to] = createdRange(args);
      const inRange = runs.filter((r) => Date.parse(r.created_at) >= from && Date.parse(r.created_at) <= to);
      return JSON.stringify({ total_count: inRange.length, workflow_runs: inRange });
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

const read = (fake, over = {}) => readRunData({ runner: fake.runner, repo: 'thn-inc/claude-tweaks', days: 7, now: NOW, ...over });

test('two runs with jobs and steps map to the exact NormRun / NormJob shape, newest first', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const r = read(fake);
  assert.deepEqual(r, {
    ok: true,
    cliAbsent: false,
    truncated: [],
    failures: [],
    unsampled: { skipped: 0, outsideWorkflows: 0, noWorkflowPath: 0 },
    runs: [
      {
        id: 43904882452, workflow: '.github/workflows/track-issue-fixes.yml', conclusion: 'success', createdAt: '2026-11-16T16:12:19Z',
        jobs: [{
          name: 'track', createdAt: '2026-11-16T16:12:20Z', startedAt: '2026-11-16T16:12:24Z', completedAt: '2026-11-16T16:12:50Z',
          conclusion: 'success', steps: [],
        }],
      },
      {
        id: 43904630871, workflow: '.github/workflows/test.yml', conclusion: 'success', createdAt: '2026-11-16T16:10:58Z',
        jobs: [
          {
            name: 'shard 1/4', createdAt: '2026-11-16T16:10:59Z', startedAt: '2026-11-16T16:11:01Z', completedAt: '2026-11-16T16:14:02Z',
            conclusion: 'success',
            steps: [
              { name: 'Set up job', number: 1, startedAt: '2026-11-16T16:11:01Z', completedAt: '2026-11-16T16:11:04Z' },
              { name: 'Run actions/checkout@v7', number: 2, startedAt: '2026-11-16T16:11:04Z', completedAt: '2026-11-16T16:11:18Z' },
            ],
          },
          {
            name: 'test', createdAt: '2026-11-16T16:14:02Z', startedAt: '2026-11-16T16:14:08Z', completedAt: '2026-11-16T16:14:24Z',
            conclusion: 'success',
            steps: [{ name: 'Set up job', number: 1, startedAt: '2026-11-16T16:14:08Z', completedAt: '2026-11-16T16:14:10Z' }],
          },
        ],
      },
    ],
  });
});

test('every call is a GET on a literal repos/ path, bounded by the shared timeout', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  read(fake);
  assert.ok(fake.calls.length >= 4);
  for (const { args, opts } of fake.calls) {
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    assert.ok(args[3].startsWith('repos/thn-inc/claude-tweaks/'), args[3]);
    assert.equal(opts.timeout, CI_HEALTH_GH_TIMEOUT_MS);
  }
  const jobsCall = fake.calls.find((c) => jobsRunId(c.args) === 43904630871);
  assert.deepEqual(jobsCall.args, [
    'api', '--method', 'GET', 'repos/thn-inc/claude-tweaks/actions/runs/43904630871/jobs',
    '-f', 'filter=latest', '-f', 'per_page=100', '-f', 'page=1',
  ]);
});

test('a runner whose every call throws ENOENT is ok:false, cliAbsent:true, with the CLI named absent', () => {
  const calls = [];
  const runner = (args) => { calls.push(args); throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', days: 7, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, true);
  assert.deepEqual(r.runs, []);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /gh .*not installed|gh .*absent/i);
  assert.equal(calls.length, 1);
});

test('a runs read that fails (not ENOENT) is ok:false, cliAbsent:false, with the failure recorded', () => {
  const fake = fakeRunner({ runsError: Object.assign(new Error('boom'), { stderr: 'HTTP 502: Bad Gateway' }) });
  const r = read(fake);
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.runs, []);
  assert.ok(r.failures.length >= 1);
  assert.ok(r.failures.every((f) => /HTTP 502/.test(f)), r.failures.join('\n'));
});

test('one failing jobs read excludes that run, records one failure, and keeps the rest', () => {
  const fake = fakeRunner({
    runs: [runRow(), TRACK_RUN],
    jobs: { 43904630871: TEST_JOBS, 43904882452: Object.assign(new Error('x'), { stderr: 'HTTP 500: Server Error' }) },
  });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /43904882452/);
  assert.match(r.failures[0], /HTTP 500/);
});

test('a jobs body with no jobs array is a failed jobs read, never an empty run', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: { total_count: 1 } } });
  const r = read(fake);
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /^jobs of run 43904882452: page 1: response has no jobs array$/);
});

test('every per-run jobs read failing is ok:false with every failure recorded', () => {
  const err = () => Object.assign(new Error('x'), { stderr: 'HTTP 500: Server Error' });
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: err(), 43904882452: err() } });
  const r = read(fake);
  assert.equal(r.ok, false);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.runs, []);
  assert.equal(r.failures.filter((f) => /43904630871|43904882452/.test(f)).length, 2);
});

test('a runs read that succeeds with zero completed runs is ok:true, runs:[] (in-progress and skipped runs are not sampled)', () => {
  const fake = fakeRunner({
    runs: [runRow({ status: 'in_progress', conclusion: null }), runRow({ id: 7, conclusion: 'skipped' })],
  });
  const r = read(fake);
  assert.deepEqual(r, {
    ok: true, cliAbsent: false, runs: [], truncated: [], failures: [], unsampled: { skipped: 1, outsideWorkflows: 0, noWorkflowPath: 0 },
  });
  assert.equal(fake.calls.filter((c) => jobsRunId(c.args) !== null).length, 0);
});

test('an empty window is ok:true, runs:[]', () => {
  const r = read(fakeRunner());
  assert.deepEqual(r, {
    ok: true, cliAbsent: false, runs: [], truncated: [], failures: [], unsampled: { skipped: 0, outsideWorkflows: 0, noWorkflowPath: 0 },
  });
});

const ZERO = { skipped: 0, outsideWorkflows: 0, noWorkflowPath: 0 };

test('unsampled counts each exclusion, each pinned by an input where only it decides', () => {
  const cases = [
    ['skipped', runRow({ conclusion: 'skipped' }), { ...ZERO, skipped: 1 }],
    ['outsideWorkflows', runRow({ path: 'dynamic/dependabot/dependabot-updates' }), { ...ZERO, outsideWorkflows: 1 }],
    ['noWorkflowPath', runRow({ path: undefined }), { ...ZERO, noWorkflowPath: 1 }],
  ];
  for (const [name, run, want] of cases) {
    const r = read(fakeRunner({ runs: [run] }));
    assert.equal(r.ok, true, name);
    assert.deepEqual(r.runs, [], name);
    assert.deepEqual(r.unsampled, want, name);
    assert.deepEqual(r.failures, name === 'noWorkflowPath' ? ['1 run carries no workflow path — excluded'] : [], name);
  }
});

test('unsampled is present with zeros on a refusal and on a failed runs read', () => {
  assert.deepEqual(read(fakeRunner(), { maxRuns: 0 }).unsampled, ZERO);
  const throwing = () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); };
  assert.deepEqual(readRunData({ runner: throwing, repo: 'o/r', days: 7, now: NOW }).unsampled, ZERO);
});

test('a non-null workflow filter that normalizes to nothing is refused before any call, like maxRuns', () => {
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

test('a full jobs page with no total_count is named in truncated; a short one is complete', () => {
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const full = fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: () => ({ jobs: Array.from({ length: 100 }, (_, i) => job(i)) }) } });
  const r = read(full);
  assert.equal(r.ok, true);
  assert.equal(r.runs[0].jobs.length, 100);
  assert.deepEqual(r.truncated, ['jobs of run 43904882452: 100 jobs read, total unknown (no total_count on a full page)']);
  assert.equal(full.calls.filter((c) => jobsRunId(c.args) !== null).length, 1);
  const short = read(fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: { jobs: [job(1)] } } }));
  assert.equal(short.runs[0].jobs.length, 1);
  assert.deepEqual(short.truncated, []);
});

test('a non-JSON jobs body is a fixed failure text that quotes no byte of the body', () => {
  const body = 'Zq<!--9f3aXk-->';
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: body } }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: response is not JSON']);
  // No 2-byte run of the body appears (the run id and the fixed words share none with it).
  for (let i = 0; i + 2 <= body.length; i += 1) assert.ok(!r.failures[0].includes(body.slice(i, i + 2)), `failure quotes ${body.slice(i, i + 2)}`);
});

test('a sampled run with an invalid id is excluded with a failure line and no jobs read', () => {
  for (const id of [0, -3, 1.5, '12', null]) {
    const f = fakeRunner({ runs: [runRow(), runRow({ id, created_at: '2026-11-16T16:13:00Z' })], jobs: { 43904630871: TEST_JOBS } });
    const r = read(f);
    assert.equal(r.ok, true, String(id));
    assert.deepEqual(r.runs.map((x) => x.id), [43904630871], String(id));
    assert.deepEqual(r.failures, [`run ${JSON.stringify(id)}: not a run id — excluded`], String(id));
    assert.deepEqual(f.calls.map((c) => jobsRunId(c.args)).filter((x) => x !== null), [43904630871], String(id));
  }
});

test('gh vanishing during a jobs read is a failed jobs read; cliAbsent stays false (gh answered the listing)', () => {
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  const r = read(fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: enoent } }));
  assert.equal(r.ok, true);
  assert.equal(r.cliAbsent, false);
  assert.deepEqual(r.failures, ['jobs of run 43904882452: gh is not installed or not on PATH']);
});

test('every sampled run cut by the deadline is ok:false with no failures and every unread run named', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (isRunsList(args) && pageOf(args) === 1 && createdRange(args)[0] < Date.parse('2026-11-10T00:00:00Z')) t = 560000;
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', days: 7, now: NOW, clock: () => t, maxRuns: 2 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.runs, []);
  assert.deepEqual(r.truncated, ['jobs of run 43904882452: not read (deadline)', 'jobs of run 43904630871: not read (deadline)']);
  assert.equal(fake.calls.filter((c) => jobsRunId(c.args) !== null).length, 0);
});

test('a workflow filter keeps one file\'s runs and reads no other run\'s jobs', () => {
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const r = read(fake, { workflow: '.github/workflows/test.yml' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.workflow), ['.github/workflows/test.yml']);
  assert.deepEqual(fake.calls.map((c) => jobsRunId(c.args)).filter((id) => id !== null), [43904630871]);
});

test('a run with no workflow path is excluded and counted in a failure line, never given a guessed key', () => {
  const noPath = runRow({ id: 11, path: undefined, created_at: '2026-11-16T16:13:00Z' });
  const emptyPath = runRow({ id: 12, path: '', created_at: '2026-11-16T16:13:30Z' });
  const fake = fakeRunner({ runs: [runRow(), noPath, emptyPath], jobs: { 43904630871: TEST_JOBS } });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.id), [43904630871]);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /^2 runs? .*no workflow path/);
});

test('a backslash workflow path is normalized to forward slashes; a path outside the workflow directory is not sampled', () => {
  const dynamic = runRow({ id: 21, path: 'dynamic/dependabot/dependabot-updates', created_at: '2026-11-16T16:13:00Z' });
  const fake = fakeRunner({ runs: [runRow({ path: '.github\\workflows\\test.yml' }), dynamic], jobs: { 43904630871: TEST_JOBS } });
  const r = read(fake);
  assert.deepEqual(r.runs.map((x) => x.workflow), ['.github/workflows/test.yml']);
  assert.deepEqual(r.failures, []);
});

test('maxRuns samples the most recent completed runs and reads only their jobs', () => {
  const older = runRow({ id: 31, path: '.github/workflows/test.yml', created_at: '2026-11-15T10:00:00Z' });
  const fake = fakeRunner({
    runs: [older, runRow(), TRACK_RUN],
    jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS, 31: TEST_JOBS },
  });
  const r = read(fake, { maxRuns: 2 });
  assert.deepEqual(r.runs.map((x) => x.id), [43904882452, 43904630871]);
  assert.deepEqual(fake.calls.map((c) => jobsRunId(c.args)).filter((id) => id !== null).sort(), [43904630871, 43904882452]);
});

test('maxRuns defaults to DEFAULT_MAX_RUNS and is refused outside 1..MAX_RUNS', () => {
  assert.equal(DEFAULT_MAX_RUNS, 20);
  const runs = Array.from({ length: 25 }, (_, i) => runRow({ id: 100 + i, created_at: `2026-11-16T15:${String(i).padStart(2, '0')}:00Z` }));
  const jobs = Object.fromEntries(runs.map((x) => [x.id, TRACK_JOBS]));
  const fake = fakeRunner({ runs, jobs });
  assert.equal(read(fake).runs.length, 20);
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
  }
});

test('a runs range the deadline leaves unread is named in truncated', () => {
  let t = 0;
  const clock = () => t;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (isRunsList(args)) t = 530000; // the first range used up the runs read's share of the deadline
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', days: 7, now: NOW, clock, maxRuns: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.truncated.length, 1);
  assert.match(r.truncated[0], /^runs 2026-11-09\.\.2026-11-15: budget/);
});

test('a jobs read the deadline leaves unread is named in truncated, not failures', () => {
  let t = 0;
  const clock = () => t;
  const fake = fakeRunner({ runs: [runRow(), TRACK_RUN], jobs: { 43904630871: TEST_JOBS, 43904882452: TRACK_JOBS } });
  const runner = (args, opts) => {
    const out = fake.runner(args, opts);
    if (jobsRunId(args) !== null) t = 570000; // past the whole deadline after the first jobs read
    return out;
  };
  const r = readRunData({ runner, repo: 'thn-inc/claude-tweaks', days: 7, now: NOW, clock });
  assert.equal(r.ok, true);
  assert.deepEqual(r.runs.map((x) => x.id), [43904882452]);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.truncated, ['jobs of run 43904630871: not read (deadline)']);
});

test('a run whose jobs pass the page cap keeps the pages read and is named in truncated', () => {
  const total = 450;
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const pager = (n) => ({ total_count: total, jobs: Array.from({ length: Math.max(0, Math.min(100, total - (n - 1) * 100)) }, (_, i) => job((n - 1) * 100 + i)) });
  const fake = fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: pager } });
  const r = read(fake);
  assert.equal(r.ok, true);
  assert.equal(r.runs[0].jobs.length, 300);
  assert.deepEqual(r.truncated, ['jobs of run 43904882452: 300 of 450 jobs read (page cap)']);
});

test('a run whose jobs span two pages reads both and is not truncated', () => {
  const job = (i) => ({ ...TRACK_JOBS.jobs[0], id: i, name: `j${i}` });
  const pager = (n) => ({ total_count: 130, jobs: Array.from({ length: n === 1 ? 100 : 30 }, (_, i) => job((n - 1) * 100 + i)) });
  const fake = fakeRunner({ runs: [TRACK_RUN], jobs: { 43904882452: pager } });
  const r = read(fake);
  assert.equal(r.runs[0].jobs.length, 130);
  assert.deepEqual(r.truncated, []);
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
