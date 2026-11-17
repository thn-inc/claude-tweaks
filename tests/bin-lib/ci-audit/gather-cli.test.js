'use strict';
// tests/bin-lib/ci-audit/gather-cli.test.js — #5757: ci-audit.js's `gather` verb. Every side effect
// is a fake dep: a runner answering the runs list and per-run jobs reads with forge-shaped JSON,
// a workflow-files reader, the origin read and the host pin, a fixed `now` and an optional clock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/ci-audit');
const { DEFAULTS } = require('../../../plugin/bin/lib/ci-audit/checks');
const { NO_WORKFLOW_FILES } = require('../../../plugin/bin/lib/ci-audit/source');

const NOW = new Date('2026-11-16T18:00:00Z');
const REPO = 'thn-inc/claude-tweaks';

const BUILD_YML = [
  'name: build', 'on: push', 'jobs:',
  '  lint:', '    runs-on: x', '    timeout-minutes: 10', '    steps:',
  '      - uses: actions/checkout@v4', '      - name: Lint', '        run: npm run lint',
  '  test:', '    needs: lint', '    runs-on: x', '    steps:',
  '      - uses: actions/checkout@v4', '      - name: Test', '        run: npm test', '',
].join('\n');
const SHARD_YML = [
  'on: push', 'jobs:', '  shard:', '    strategy:', '      matrix:', '        n: [1, 2]',
  '    steps:', '      - name: Test', '        run: npm test', '',
].join('\n');
const TABBED_YML = 'on: push\njobs:\n\tslow:\n\t\truns-on: x\n';

const BUILD = '.github/workflows/build.yml';
const SHARD = '.github/workflows/shard.yml';
const TABBED = '.github/workflows/tabbed.yml';

const runRow = (id, path, createdAt, over = {}) => ({ id, path, status: 'completed', conclusion: 'success', created_at: createdAt, ...over });
// A job: created, started, completed, and the command step's start (steps before it are setup).
function job(name, created, started, completed, commandStep, commandAt) {
  const steps = [{ name: 'Set up job', number: 1, started_at: started, completed_at: started }];
  if (commandStep) steps.push({ name: commandStep, number: 2, started_at: commandAt, completed_at: completed });
  return { name, created_at: created, started_at: started, completed_at: completed, conclusion: 'success', steps };
}
const jobsBody = (jobs) => ({ total_count: jobs.length, jobs });

// Two runs of the two-job build workflow. Hand-computed phases (seconds):
//   run 101 lint: waiting 10, setup 10, running 40  | test: waiting 30, setup 20, running 120
//   run 102 lint: waiting 20, setup 15, running 60  | test: waiting 10, setup 30, running 60
const BUILD_RUNS = [runRow(101, BUILD, '2026-11-15T10:00:00Z'), runRow(102, BUILD, '2026-11-15T12:00:00Z')];
const BUILD_JOBS = {
  101: jobsBody([
    job('lint', '2026-11-15T10:00:00Z', '2026-11-15T10:00:10Z', '2026-11-15T10:01:00Z', 'Lint', '2026-11-15T10:00:20Z'),
    job('test', '2026-11-15T10:01:00Z', '2026-11-15T10:01:30Z', '2026-11-15T10:03:50Z', 'Test', '2026-11-15T10:01:50Z'),
  ]),
  102: jobsBody([
    job('lint', '2026-11-15T12:00:00Z', '2026-11-15T12:00:20Z', '2026-11-15T12:01:35Z', 'Lint', '2026-11-15T12:00:35Z'),
    job('test', '2026-11-15T12:01:35Z', '2026-11-15T12:01:45Z', '2026-11-15T12:03:15Z', 'Test', '2026-11-15T12:02:15Z'),
  ]),
};

const LIST_RE = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs$/;
const isRunsList = (args) => args[0] === 'api' && LIST_RE.test(args[3]);
const jobsRunId = (args) => {
  const m = args[0] === 'api' ? /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(args[3]) : null;
  return m ? Number(m[1]) : null;
};
const argVal = (args, key) => args.find((a) => a.startsWith(`${key}=`)).slice(key.length + 1);
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

// Each workflow's runs list serves the rows whose path ends in its file name, newest first.
function fakeRunner({ runs = [], jobs = {}, runsError = null } = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (calls.length > 200) throw new Error('call ceiling');
    if (isRunsList(args)) {
      if (runsError) throw runsError;
      if (Number(argVal(args, 'page')) > 1) return JSON.stringify({ total_count: 0, workflow_runs: [] });
      const file = LIST_RE.exec(args[3])[1];
      const from = Date.parse(`${argVal(args, 'created').replace(/^>=/, '')}T00:00:00Z`);
      const mine = runs.filter((r) => typeof r.path === 'string' && base(r.path) === file && Date.parse(r.created_at) >= from)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return JSON.stringify({ total_count: mine.length, workflow_runs: mine });
    }
    const id = jobsRunId(args);
    if (id !== null && Object.prototype.hasOwnProperty.call(jobs, id)) {
      if (jobs[id] instanceof Error) throw jobs[id];
      return JSON.stringify(jobs[id]);
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { runner, calls };
}

const files = (entries) => () => ({ ok: true, workflows: entries });

function gather(argv, { fake = fakeRunner(), workflows = files([{ file: BUILD, text: BUILD_YML }]), ...over } = {}) {
  let out = '';
  let err = '';
  const pins = [];
  const roots = [];
  const deps = {
    runner: fake.runner,
    readWorkflowFiles: (root) => { roots.push(root); return workflows(root); },
    remoteUrl: () => 'https://github.com/thn-inc/claude-tweaks.git',
    pinHost: (spec) => { pins.push(spec); return null; },
    // A fake host environment: no exported host, no host config file, so the gate reads nothing real.
    gateDeps: { env: {}, homedir: '/nonexistent-home', readFile: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } },
    cwd: () => '/checkout',
    now: NOW,
    clock: null,
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    ...over,
  };
  const code = run(argv, deps);
  const lines = out.split('\n').filter((l) => l !== '');
  return { code, out, err, lines, report: lines.length === 1 ? JSON.parse(lines[0]) : null, pins, roots, calls: fake.calls };
}

const buildFake = () => fakeRunner({ runs: BUILD_RUNS, jobs: BUILD_JOBS });

test('AC1.1: two runs of a two-job workflow give the hand-computed per-job phase figures', () => {
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake: buildFake() });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.lines.length, 1);
  const [lint, tst] = r.report.jobs;
  assert.deepEqual([lint.workflow, lint.job, lint.runs], [BUILD, 'lint', 2]);
  // Nearest rank over two values: p50 is the smaller, p90 the larger.
  assert.deepEqual(lint.waiting, { p50Ms: 10000, p90Ms: 20000, n: 2 });
  assert.deepEqual(lint.setup, { p50Ms: 10000, p90Ms: 15000, n: 2 });
  assert.deepEqual(lint.running, { p50Ms: 40000, p90Ms: 60000, n: 2 });
  assert.deepEqual([tst.job, tst.runs], ['test', 2]);
  assert.deepEqual(tst.waiting, { p50Ms: 10000, p90Ms: 30000, n: 2 });
  assert.deepEqual(tst.setup, { p50Ms: 20000, p90Ms: 30000, n: 2 });
  assert.deepEqual(tst.running, { p50Ms: 60000, p90Ms: 120000, n: 2 });
  // Totals: lint 60 s and 95 s (p50 60 s), test 170 s and 100 s (p50 100 s); the path is lint → test.
  assert.deepEqual(r.report.criticalPaths, [{ workflow: BUILD, pathMs: 160000, sumMs: 160000, chain: ['lint', 'test'], allJobsMatched: true }]);
  assert.deepEqual(r.report.workflows, [{ file: BUILD, unparsed: [] }]);
  assert.deepEqual(r.report.window, {
    days: 7, from: '2026-11-09', maxRuns: 20, workflow: null, minSample: 5, thresholds: DEFAULTS, sampledRuns: 2,
  });
  assert.equal(r.report.excluded, 0);
  assert.deepEqual(r.report.notTimed, { skipped: 0, cancelled: 0 });
  assert.deepEqual(r.report.breaches, []); // two runs sit below the default minimum sample
  assert.deepEqual(r.report.underSampled, [{ workflow: BUILD, job: 'lint', runs: 2 }, { workflow: BUILD, job: 'test', runs: 2 }]);
  assert.deepEqual(r.report.unmatchedJobs, []);
  assert.deepEqual(r.report.overlaps, []); // lint and test share 2 runs, under the minimum sample
  assert.equal(r.report.droppedBreaches, 0);
  assert.equal(r.report.noData, null);
  assert.deepEqual(r.report.failures, []);
  assert.deepEqual(r.report.truncated, []);
  assert.deepEqual(r.report.unsampled, { skipped: 0, neverRun: 0 });
  assert.deepEqual(Object.keys(r.report), [
    'definitions', 'window', 'workflows', 'jobs', 'criticalPaths', 'shardSkews', 'repeatedSteps', 'overlaps',
    'breaches', 'underSampled', 'unmatchedJobs', 'droppedBreaches', 'excluded', 'notTimed', 'truncated', 'failures',
    'unsampled', 'noData',
  ]);
  assert.equal(r.err, '');
  assert.deepEqual(r.pins, [{ owner: 'thn-inc', repo: 'claude-tweaks' }]);
});

test('AC1.2: definitions holds all three phase definitions verbatim', () => {
  const r = gather(['gather', '--repo', REPO], { fake: buildFake() });
  assert.deepEqual(r.report.definitions, {
    waiting: 'job started − job created',
    setup: 'job started → start of the first step the workflow file declares as a command (steps with no declaration count as setup when they precede it)',
    running: 'that boundary → job completed',
  });
});

test('AC2.1: a runner that always throws ENOENT exits 3 with failures naming the CLI absent', () => {
  const fake = { calls: [], runner: () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); } };
  const r = gather(['gather', '--repo', REPO], { fake });
  assert.equal(r.code, 3);
  assert.equal(r.report.failures.length, 1);
  assert.match(r.report.failures[0], /not installed or not on PATH/);
  assert.deepEqual(r.report.jobs, []);
});

test('AC2.1: every runs read failing exits 2 with the failure in the report', () => {
  const fake = fakeRunner({ runsError: Object.assign(new Error('boom'), { stderr: 'HTTP 502: Bad Gateway' }) });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 2);
  assert.ok(r.report.failures.length >= 1);
  assert.ok(r.report.failures.every((f) => /HTTP 502/.test(f)), r.report.failures.join('\n'));
  assert.equal(r.err, '');
});

test('AC2.2: neither failed read prints an empty or clean report', () => {
  const absent = gather(['gather', '--repo', REPO], { fake: { calls: [], runner: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } } });
  const failed = gather(['gather', '--repo', REPO], { fake: fakeRunner({ runsError: Object.assign(new Error('boom'), { stderr: 'HTTP 502' }) }) });
  for (const r of [absent, failed]) {
    assert.notEqual(r.code, 0);
    assert.equal(r.lines.length, 1);
    assert.ok(r.report.failures.length > 0);
  }
});

test('AC2.2: a succeeded read with zero completed runs exits 0 with noData.reason saying why, jobs []', () => {
  const fake = fakeRunner({ runs: [runRow(201, BUILD, '2026-11-15T10:00:00Z', { conclusion: 'skipped' })] });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.report.jobs, []);
  assert.deepEqual(r.report.unsampled, { skipped: 1, neverRun: 0 });
  assert.equal(r.report.noData.reason, 'no completed run was sampled in the 7-day window: 1 run did no work (skipped)');
  assert.deepEqual(r.report.failures, []);
});

test('a workflow file the forge has never run is no failure and no partiality; the noData reason names it', () => {
  const fake = fakeRunner({ runs: [runRow(201, BUILD, '2026-11-15T10:00:00Z', { conclusion: 'skipped' })] });
  const runner = (args) => {
    if (isRunsList(args) && LIST_RE.exec(args[3])[1] === 'shard.yml') throw Object.assign(new Error('x'), { stderr: 'gh: Not Found (HTTP 404)' });
    return fake.runner(args);
  };
  const two = files([{ file: BUILD, text: BUILD_YML }, { file: SHARD, text: SHARD_YML }]);
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake: { runner, calls: [] }, workflows: two });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.report.failures, r.report.truncated], [[], []]);
  assert.deepEqual(r.report.unsampled, { skipped: 1, neverRun: 1 });
  assert.equal(r.report.noData.reason,
    'no completed run was sampled in the 7-day window: 1 run did no work (skipped); 1 workflow file has never run');
});

test('a checkout with no workflow files exits 0 with noData naming the adapter\'s location, and reads no run', () => {
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake: buildFake(), workflows: files([]) });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.report.noData.reason, NO_WORKFLOW_FILES);
  assert.equal(r.calls.length, 0);
});

test('--workflow takes a bare file name; one that matches no workflow file says so in noData', () => {
  const two = files([{ file: BUILD, text: BUILD_YML }, { file: SHARD, text: SHARD_YML }]);
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--workflow', 'build.yml'], { fake: buildFake(), workflows: two });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.report.window.workflow, BUILD);
  assert.deepEqual([...new Set(r.report.jobs.map((j) => j.workflow))], [BUILD]);
  const none = gather(['gather', '--repo', REPO, '--days', '7', '--workflow', 'test.yml'], { fake: buildFake(), workflows: two });
  assert.equal(none.code, 0);
  assert.equal(none.report.window.workflow, 'test.yml');
  assert.equal(none.report.noData.reason, 'workflow filter "test.yml" matched no workflow file in .github/workflows/');
  assert.equal(none.calls.length, 0);
});

test('window.thresholds echoes every threshold and floor applied, an override included', () => {
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--thresholds', 'queue-wait-floor-ms=1000,shard-skew=3'], { fake: buildFake() });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.report.window.thresholds, { ...DEFAULTS, 'queue-wait-floor-ms': 1000, 'shard-skew': 3 });
});

test('noData for a mix of runs with no jobs and runs whose every job is excluded names both', () => {
  const broken = jobsBody([{ name: 'lint', created_at: '2026-11-15T10:00:10Z', started_at: '2026-11-15T10:00:00Z', completed_at: null, steps: [] }]);
  const fake = fakeRunner({ runs: BUILD_RUNS, jobs: { 101: broken, 102: jobsBody([]) } });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 0);
  assert.equal(r.report.noData.reason,
    'the 2 sampled runs gave no job with phases: 1 run of them had no jobs; 1 job excluded (a missing or out-of-order instant)');
});

test('AC2.2: a read whose every job is excluded exits 0 with noData.reason', () => {
  const broken = jobsBody([{ name: 'lint', created_at: '2026-11-15T10:00:10Z', started_at: '2026-11-15T10:00:00Z', completed_at: null, steps: [] }]);
  const fake = fakeRunner({ runs: [BUILD_RUNS[0]], jobs: { 101: broken } });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 0);
  assert.deepEqual(r.report.jobs, []);
  assert.equal(r.report.excluded, 1);
  assert.equal(r.report.noData.reason, 'the 1 sampled run gave no job with phases: 1 job excluded (a missing or out-of-order instant)');
});

test('AC2.2: sampled runs that carry no jobs say so, never "0 jobs excluded"', () => {
  const fake = fakeRunner({ runs: [BUILD_RUNS[0]], jobs: { 101: jobsBody([]) } });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 0);
  assert.equal(r.report.excluded, 0);
  assert.equal(r.report.noData.reason, 'the 1 sampled run had no jobs');
});

test('AC2.2: every jobs read failing exits 2 with each failure in the report', () => {
  const e = () => Object.assign(new Error('x'), { stderr: 'HTTP 500: Server Error' });
  const fake = fakeRunner({ runs: BUILD_RUNS, jobs: { 101: e(), 102: e() } });
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake });
  assert.equal(r.code, 2);
  assert.deepEqual(r.report.jobs, []);
  assert.equal(r.report.failures.length, 2);
  assert.match(r.report.failures.join('\n'), /run 101[\s\S]*run 102|run 102[\s\S]*run 101/);
  assert.equal(r.report.noData, null);
});

test('usage errors exit 2 with one stderr line, nothing on stdout and no read', () => {
  const cases = [
    ['gather', '--bogus'],
    ['gather', '--days', '0'],
    ['gather', '--days', 'x'],
    ['gather', '--days', '401'],
    ['gather', '--runs', '2.5'],
    ['gather', '--runs', '31'],
    ['gather', '--min-sample', '0'],
    ['gather', '--min-sample', '-1'],
    ['gather', '--thresholds', 'nope=1'],
    ['gather', '--thresholds'],
    ['gather', '--thresholds', 'shard-skew=3', '--thresholds', 'queue-wait=0.5'],
    ['gather', '--days', '7', '--days', '7'],
    ['gather', '--repo', REPO, '--repo', REPO],
    ['gather', '--repo', 'not-a-slug'],
    ['gather', '--workflow'],
    ['gather', '--repo', REPO, '--root', '/elsewhere'],
    ['gather', '--root', '   '],
    ['gather', '--root', ''],
    [],
    ['scatter'],
  ];
  for (const argv of cases) {
    const fake = fakeRunner();
    const r = gather(argv, { fake });
    assert.equal(r.code, 2, argv.join(' '));
    assert.equal(r.out, '', argv.join(' '));
    assert.equal(r.err.split('\n').filter(Boolean).length, 1, `${argv.join(' ')}: ${r.err}`);
    assert.equal(fake.calls.length, 0, argv.join(' '));
  }
});

test('--repo and --root together are refused, naming both', () => {
  const r = gather(['gather', '--root', '/elsewhere', '--repo', REPO]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--repo and --root/);
});

test('--runs 1 samples only the newest run', () => {
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--runs', '1'], { fake: buildFake() });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.report.window.maxRuns, 1);
  assert.equal(r.report.jobs[0].runs, 1);
});

// One run of a two-shard matrix: shard totals 10 s and 50 s, so the skew ratio is 50 ÷ 10 = 5.
const SHARD_FAKE = () => fakeRunner({
  runs: [runRow(301, SHARD, '2026-11-15T10:00:00Z')],
  jobs: {
    301: jobsBody([
      job('shard (1)', '2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z', '2026-11-15T10:00:10Z', 'Test', '2026-11-15T10:00:00Z'),
      job('shard (2)', '2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z', '2026-11-15T10:00:50Z', 'Test', '2026-11-15T10:00:00Z'),
    ]),
  },
});

test('--thresholds shard-skew=9 changes breaches for the same fixture', () => {
  const opts = { workflows: files([{ file: SHARD, text: SHARD_YML }]) };
  const base = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '1'], { fake: SHARD_FAKE(), ...opts });
  const high = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '1', '--thresholds', 'shard-skew=9'], { fake: SHARD_FAKE(), ...opts });
  assert.equal(base.code, 0, base.err);
  assert.deepEqual(base.report.shardSkews, [{ workflow: SHARD, family: 'shard', ratio: 5, slowest: 'shard (2)', shards: 2 }]);
  assert.deepEqual(base.report.breaches.filter((b) => b.check === 'shard-skew'), [
    { check: 'shard-skew', workflow: SHARD, job: 'shard', metric: 'shardSkewRatio', value: 5, threshold: 2 },
  ]);
  assert.deepEqual(high.report.breaches.filter((b) => b.check === 'shard-skew'), []);
});

test('--min-sample is echoed as applied; a job below it is underSampled with no breach, one at it is judged', () => {
  const opts = { workflows: files([{ file: SHARD, text: SHARD_YML }]) };
  const above = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '2'], { fake: SHARD_FAKE(), ...opts });
  assert.equal(above.report.window.minSample, 2);
  assert.deepEqual(above.report.breaches, []);
  assert.deepEqual(above.report.underSampled, [{ workflow: SHARD, job: 'shard (1)', runs: 1 }, { workflow: SHARD, job: 'shard (2)', runs: 1 }]);
  const at = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '1'], { fake: SHARD_FAKE(), ...opts });
  assert.equal(at.report.window.minSample, 1);
  assert.deepEqual(at.report.underSampled, []);
  assert.ok(at.report.breaches.length > 0);
  const absent = gather(['gather', '--repo', REPO, '--days', '7'], { fake: SHARD_FAKE(), ...opts });
  assert.equal(absent.report.window.minSample, 5);
});

test('a missing --thresholds value says the flag needs a value', () => {
  const r = gather(['gather', '--thresholds']);
  assert.match(r.err, /--thresholds requires a value/);
});

test('a repeated flag is refused, naming it', () => {
  const r = gather(['gather', '--thresholds', 'shard-skew=3', '--thresholds', 'queue-wait=0.5']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--thresholds given twice/);
});

test('an injected invalid now is refused by the read: exit 2 with the report, no throw', () => {
  const r = gather(['gather', '--repo', REPO], { now: new Date('not a date') });
  assert.equal(r.code, 2);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.report.failures, ['now must be a valid Date']);
  assert.equal(r.report.window.from, null);
});

test('an unparsed or unreadable workflow appears in workflows[].unparsed and never in breaches', () => {
  // A job that waited 50 s of 60 s would cross queue-wait if its workflow were judged.
  const fake = fakeRunner({
    runs: [runRow(401, TABBED, '2026-11-15T10:00:00Z')],
    jobs: { 401: jobsBody([job('slow', '2026-11-15T10:00:00Z', '2026-11-15T10:00:50Z', '2026-11-15T10:01:00Z', null, null)]) },
  });
  const workflows = files([
    { file: '.github/workflows/gone.yml', unreadable: 'unreadable: EACCES' },
    { file: TABBED, text: TABBED_YML },
  ]);
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '1'], { fake, workflows });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.report.workflows, [
    { file: '.github/workflows/gone.yml', unparsed: ['unreadable: EACCES'] },
    { file: TABBED, unparsed: ['tab indentation in jobs:'] },
  ]);
  assert.equal(r.report.jobs.length, 1);
  assert.deepEqual(r.report.breaches, []);
  assert.equal(r.report.droppedBreaches, 1); // the queue-wait breach the tabbed workflow would get
});

test('workflow files that could not be listed make the read unavailable: exit 2, the failure named, no run read', () => {
  const r = gather(['gather', '--repo', REPO, '--days', '7'], {
    fake: buildFake(), workflows: () => ({ ok: false, workflows: [], error: 'not a directory' }),
  });
  assert.equal(r.code, 2);
  assert.equal(r.lines.length, 1);
  assert.deepEqual(r.report.failures, ['workflow files: not a directory']);
  assert.deepEqual(r.report.workflows, []);
  assert.equal(r.report.noData, null);
  assert.equal(r.calls.length, 0);
});

const BOTH = files([{ file: BUILD, text: BUILD_YML }, { file: SHARD, text: SHARD_YML }]);

test('a listing the deadline cut names the workflow it left short in truncated', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [runRow(101, BUILD, '2026-11-16T10:00:00Z')], jobs: { 101: BUILD_JOBS[101] } });
  const runner = (args) => {
    const out = fake.runner(args);
    if (isRunsList(args)) t = 260000; // the first list call used up the listing's share of the deadline
    return out;
  };
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--runs', '2'], { fake: { runner, calls: [] }, clock: () => t, workflows: BOTH });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.report.truncated, [`runs of ${SHARD}: 0 runs listed before the deadline (fewer than 2)`]);
  assert.equal(r.report.jobs.length, 2);
});

test('a zero-run read inside a truncated window says the window was truncated', () => {
  let t = 0;
  const fake = fakeRunner({ runs: [] });
  const runner = (args) => {
    const out = fake.runner(args);
    if (isRunsList(args)) t = 260000;
    return out;
  };
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--runs', '2'], { fake: { runner, calls: [] }, clock: () => t, workflows: BOTH });
  assert.equal(r.code, 0);
  assert.equal(r.report.noData.reason, 'no completed run was sampled in the 7-day window — the window was truncated (see truncated)');
});

test('a zero-run read where one workflow list failed says part of the read failed, never just empty', () => {
  const fake = fakeRunner({ runs: [] });
  const runner = (args) => {
    if (isRunsList(args) && LIST_RE.exec(args[3])[1] === 'shard.yml') throw Object.assign(new Error('x'), { stderr: 'gh: Bad Gateway (HTTP 502)' });
    return fake.runner(args);
  };
  const r = gather(['gather', '--repo', REPO, '--days', '7'], { fake: { runner, calls: [] }, workflows: BOTH });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.report.failures.length, 1);
  assert.equal(r.report.noData.reason,
    'no completed run was sampled in the 7-day window — part of the read failed (see failures), so the window may not be empty');
});

test('a repeated-work breach (workflow null) is kept beside an unparsed workflow whose breaches are dropped', () => {
  // Three parsed jobs declare `Setup` (a repeated-work lead with workflow null); the tabbed workflow's
  // queue-wait lead is dropped. Only the `b.workflow === null` clause keeps the first.
  const REP_YML = [
    'on: push', 'concurrency: rep', 'jobs:',
    ...['a', 'b', 'c'].flatMap((id) => [`  ${id}:`, '    steps:', '      - name: Setup', '        run: make setup']),
    '',
  ].join('\n');
  const REP = '.github/workflows/rep.yml';
  const rj = (name, s) => job(name, s, s, '2026-11-15T10:10:00Z', 'Setup', s);
  const runs = [runRow(501, REP, '2026-11-15T10:00:00Z'), runRow(502, TABBED, '2026-11-15T10:00:00Z')];
  const fake = fakeRunner({
    runs,
    jobs: {
      501: jobsBody(['a', 'b', 'c'].map((n) => rj(n, '2026-11-15T10:00:00Z'))),
      502: jobsBody([job('slow', '2026-11-15T10:00:00Z', '2026-11-15T10:01:00Z', '2026-11-15T10:01:10Z', null, null)]),
    },
  });
  const workflows = files([{ file: REP, text: REP_YML }, { file: TABBED, text: TABBED_YML }]);
  const r = gather(['gather', '--repo', REPO, '--days', '7', '--min-sample', '1'], { fake, workflows });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.report.breaches.map((b) => [b.check, b.workflow, b.step]), [['repeated-work', null, 'Setup']]);
  assert.equal(r.report.droppedBreaches, 1);
});

test('without --repo the origin names the repository; --root is read for origin and workflow files', () => {
  const remotes = [];
  const r = gather(['gather', '--root', '/other', '--days', '7'], {
    fake: buildFake(), remoteUrl: (root) => { remotes.push(root); return 'git@github.com:thn-inc/claude-tweaks.git'; },
  });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(remotes, ['/other']);
  assert.deepEqual(r.roots, ['/other']);
  assert.deepEqual(r.pins, [{ host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' }]);
  const here = gather(['gather', '--days', '7'], { fake: buildFake() });
  assert.deepEqual(here.roots, ['/checkout']);
});

test('an unreadable or unusable origin is a usage-path error: exit 2, stderr, nothing on stdout', () => {
  const thrown = gather(['gather'], { remoteUrl: () => { throw new Error('no origin'); } });
  const junk = gather(['gather'], { remoteUrl: () => 'not a url' });
  const badSlug = gather(['gather'], { remoteUrl: () => 'https://github.com/-evil/repo.git' });
  assert.match(badSlug.err, /unusable owner\/name/);
  const unknownHost = gather(['gather'], { remoteUrl: () => 'https://git.corp.example/o/r.git' });
  assert.match(unknownHost.err, /not a known/);
  for (const r of [thrown, junk, badSlug, unknownHost]) {
    assert.equal(r.code, 2);
    assert.equal(r.out, '');
    assert.equal(r.err.split('\n').filter(Boolean).length, 1, r.err);
    assert.equal(r.calls.length, 0);
  }
});

test('the origin gate reads the injected host environment: a host config key admits an enterprise origin', () => {
  const gateDeps = { env: {}, homedir: '/nonexistent-home', readFile: () => 'git.corp.example:\n    user: x\n' };
  const r = gather(['gather', '--days', '7'], { fake: buildFake(), gateDeps, remoteUrl: () => 'https://git.corp.example/o/r.git' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.pins, [{ host: 'git.corp.example', owner: 'o', repo: 'r' }]);
});

test('a host pin that throws is exit 2 with nothing on stdout', () => {
  const r = gather(['gather', '--repo', REPO], { pinHost: () => { throw new Error('bad config'); } });
  assert.equal(r.code, 2);
  assert.equal(r.out, '');
  assert.match(r.err, /bad config/);
});

test('--help prints usage and exits 0', () => {
  const r = gather(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: ci-audit\.js gather/);
});
