'use strict';
// tests/bin-lib/ci-audit/real-shapes.test.js — #5757: `gather` over run data shaped exactly like the
// forge's (step and job names, synthesized steps, skipped jobs, template-named matrix shards), each
// job body copied from a real `actions/runs/{id}/jobs` read of this repository on 2026-11-16 (runs
// 43954117436 test.yml, 43878742705 test-perf.yml, 43953339539 track-issue-fixes.yml) and the
// workflow texts trimmed from the files those runs ran. These shapes are what the hand-built
// fixtures in gather-cli.test.js never exercised: unnamed steps appear as `Run <first line>`,
// `Set up job` / `Post …` / `Complete job` are the forge's own, an `if:`-skipped job has
// conclusion `skipped` and zero-length times, and `name: shard ${{ matrix.shard }}/…` runs as
// `shard 1/4`. The fake runner answers both the per-workflow runs list and the whole-repository
// one, so the same file also runs against an older CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../../plugin/bin/ci-audit');

const NOW = new Date('2026-11-16T22:00:00Z');
const REPO = 'thn-inc/claude-tweaks';
const lines = (...l) => `${l.join('\n')}\n`;

const TEST = '.github/workflows/test.yml';
const PERF = '.github/workflows/test-perf.yml';
const FIX = '.github/workflows/track-issue-fixes.yml';
const BUILD = '.github/workflows/build.yml';

const APT = 'sudo apt-get install -y --no-install-recommends zsh || (sudo apt-get update && sudo apt-get install -y --no-install-recommends zsh)';
const SHARD_NAME = 'shard ${{ matrix.shard }}/${{ strategy.job-total }}';
const TEST_YML = lines(
  'name: test', 'on:', '  pull_request:', 'concurrency:', '  group: test-${{ github.workflow }}-${{ github.ref }}', '  cancel-in-progress: true',
  'jobs:',
  '  shard:', `    name: ${SHARD_NAME}`, '    runs-on: ubuntu-latest', '    timeout-minutes: 15', '    strategy:', '      fail-fast: false',
  '      matrix:', '        shard: [1, 2, 3, 4]', '    steps:',
  '      - uses: actions/checkout@v7', '        with:', '          fetch-depth: 0',
  '      - uses: actions/setup-node@v7', '        with:', '          node-version: 20',
  `      - run: ${APT}`,
  '      - name: Run this shard of the suite', '        shell: bash',
  '        run: npm test --silent -- --shard ${{ matrix.shard }}/${{ strategy.job-total }} | tee "$RUNNER_TEMP/shard-${{ matrix.shard }}.tap"',
  '      - uses: actions/upload-artifact@v7', '        if: always()', '        with:', '          name: shard-tap-${{ matrix.shard }}',
  '  test:', '    needs: shard', '    if: ${{ !cancelled() }}', '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:',
  '      - uses: actions/checkout@v7', '        with:', '          sparse-checkout: tools',
  '      - uses: actions/download-artifact@v8', '        continue-on-error: true',
  "      - name: Print the whole suite's log", '        run: node tools/merge-shard-logs.js --expect 4 "$RUNNER_TEMP/shards"',
  '      - name: Fail when any shard did not succeed', "        if: needs.shard.result != 'success'", '        run: |',
  '          echo "::error::the shard jobs ended"', '          exit 1',
);
const PERF_YML = lines(
  'name: test-perf', 'on:', '  workflow_dispatch: {}', 'concurrency:', '  group: test-perf-${{ github.ref }}', '  cancel-in-progress: false',
  'jobs:', '  perf:', '    runs-on: ubuntu-latest', '    timeout-minutes: 15', '    steps:',
  '      - uses: actions/checkout@v7', '        with:', '          fetch-depth: 0',
  '      - uses: actions/setup-node@v7', '        with:', '          node-version: 20',
  '      - run: npm run test:perf',
);
const FIX_YML = lines(
  'name: Track issue fixes across branches', 'on:', '  push:', 'concurrency:', '  group: track-issue-fixes-${{ github.ref }}', '  cancel-in-progress: false',
  'jobs:',
  '  label-fix-branch:', "    if: github.ref != 'refs/heads/main'", '    runs-on: ubuntu-latest', '    timeout-minutes: 10', '    steps:',
  '      - name: Extract referenced issues', '        run: |', '          echo extract',
  '      - name: Label and comment on each referenced issue', '        run: |', '          echo label',
  '  cleanup-fix-labels:', "    if: github.ref == 'refs/heads/main'", '    runs-on: ubuntu-latest', '    timeout-minutes: 10', '    steps:',
  '      - name: Extract referenced issues', '        run: |', '          echo extract',
  '      - name: Strip fix-on-* labels from closed issues', '        run: |', '          echo strip',
);
// The reviewer's fixture: a checkout, an unnamed multi-line build, then a named test step.
const BUILD_YML = (block) => lines(
  'on: push', 'concurrency: build', 'jobs:', '  build:', '    runs-on: ubuntu-latest', '    timeout-minutes: 30', '    steps:',
  '      - uses: actions/checkout@v4', `      - run: ${block}`, '          npm ci', '          npm run build',
  '      - name: Test', '        run: npm test',
);

// Run data. Each run repeats the probed run's durations, shifted `k` hours earlier, so every p50 and
// p90 equals the probed figure.
const shift = (iso, k) => new Date(Date.parse(iso) - k * 3600000).toISOString().replace('.000Z', 'Z');
const step = (name, number, start, end, conclusion = 'success') => ({ name, number, conclusion, started_at: start, completed_at: end });
const jobOf = (name, created, started, completed, steps, conclusion = 'success') => ({
  name, conclusion, created_at: created, started_at: started, completed_at: completed, steps,
});
const shiftJob = (j, k) => ({
  ...j,
  created_at: shift(j.created_at, k), started_at: shift(j.started_at, k), completed_at: shift(j.completed_at, k),
  steps: j.steps.map((s) => ({ ...s, started_at: shift(s.started_at, k), completed_at: shift(s.completed_at, k) })),
});

const shardJob = (n, started, aptAt, suiteAt, uploadAt, done) => jobOf(`shard ${n}/4`, '2026-11-16T20:51:41Z', started, done, [
  step('Set up job', 1, started, started),
  step('Run actions/checkout@v7', 2, started, started),
  step('Run actions/setup-node@v7', 3, started, aptAt),
  step(`Run ${APT}`, 4, aptAt, suiteAt),
  step('Run this shard of the suite', 5, suiteAt, uploadAt),
  step('Run actions/upload-artifact@v7', 6, uploadAt, done),
  step('Post Run actions/setup-node@v7', 11, done, done),
  step('Post Run actions/checkout@v7', 12, done, done),
  step('Complete job', 13, done, done),
]);
// Run 43954117436 (test.yml): four shards, then `test` once the last shard completed.
const TEST_JOBS = [
  shardJob(1, '2026-11-16T20:51:43Z', '2026-11-16T20:51:59Z', '2026-11-16T20:52:08Z', '2026-11-16T20:53:34Z', '2026-11-16T20:53:39Z'),
  shardJob(4, '2026-11-16T20:51:43Z', '2026-11-16T20:51:57Z', '2026-11-16T20:52:05Z', '2026-11-16T20:53:27Z', '2026-11-16T20:53:30Z'),
  shardJob(3, '2026-11-16T20:51:43Z', '2026-11-16T20:52:01Z', '2026-11-16T20:52:21Z', '2026-11-16T20:54:30Z', '2026-11-16T20:54:32Z'),
  shardJob(2, '2026-11-16T20:51:43Z', '2026-11-16T20:52:00Z', '2026-11-16T20:52:09Z', '2026-11-16T20:53:36Z', '2026-11-16T20:53:41Z'),
  jobOf('test', '2026-11-16T20:54:33Z', '2026-11-16T20:55:26Z', '2026-11-16T20:55:38Z', [
    step('Set up job', 1, '2026-11-16T20:55:27Z', '2026-11-16T20:55:28Z'),
    step('Run actions/checkout@v7', 2, '2026-11-16T20:55:28Z', '2026-11-16T20:55:30Z'),
    step('Run actions/download-artifact@v8', 3, '2026-11-16T20:55:30Z', '2026-11-16T20:55:31Z'),
    step("Print the whole suite's log", 4, '2026-11-16T20:55:31Z', '2026-11-16T20:55:34Z'),
    step('Fail when any shard did not succeed', 5, '2026-11-16T20:55:34Z', '2026-11-16T20:55:34Z', 'skipped'),
    step('Post Run actions/checkout@v7', 10, '2026-11-16T20:55:34Z', '2026-11-16T20:55:34Z'),
    step('Complete job', 11, '2026-11-16T20:55:34Z', '2026-11-16T20:55:34Z'),
  ]),
];
// Run 43878742705 (test-perf.yml): the unnamed `- run: npm run test:perf` runs as `Run npm run test:perf`.
const PERF_JOBS = [jobOf('perf', '2026-11-16T13:44:52Z', '2026-11-16T13:44:54Z', '2026-11-16T13:45:20Z', [
  step('Set up job', 1, '2026-11-16T13:44:55Z', '2026-11-16T13:44:56Z'),
  step('Run actions/checkout@v7', 2, '2026-11-16T13:44:56Z', '2026-11-16T13:45:06Z'),
  step('Run actions/setup-node@v7', 3, '2026-11-16T13:45:06Z', '2026-11-16T13:45:10Z'),
  step('Run npm run test:perf', 4, '2026-11-16T13:45:10Z', '2026-11-16T13:45:17Z'),
  step('Post Run actions/setup-node@v7', 7, '2026-11-16T13:45:17Z', '2026-11-16T13:45:17Z', 'skipped'),
  step('Post Run actions/checkout@v7', 8, '2026-11-16T13:45:17Z', '2026-11-16T13:45:17Z'),
  step('Complete job', 9, '2026-11-16T13:45:17Z', '2026-11-16T13:45:17Z'),
])];
// Run 43953339539 (track-issue-fixes.yml): one job ran; its `if:` skipped the other.
const FIX_JOBS = [
  jobOf('label-fix-branch', '2026-11-16T20:47:07Z', '2026-11-16T20:47:15Z', '2026-11-16T20:47:56Z', [
    step('Set up job', 1, '2026-11-16T20:47:16Z', '2026-11-16T20:47:16Z'),
    step('Extract referenced issues', 2, '2026-11-16T20:47:16Z', '2026-11-16T20:47:16Z'),
    step('Label and comment on each referenced issue', 3, '2026-11-16T20:47:16Z', '2026-11-16T20:47:54Z'),
    step('Complete job', 4, '2026-11-16T20:47:54Z', '2026-11-16T20:47:54Z'),
  ]),
  jobOf('cleanup-fix-labels', '2026-11-16T20:47:07Z', '2026-11-16T20:47:07Z', '2026-11-16T20:47:07Z', [], 'skipped'),
];
// The build fixture: set up 2 s, checkout 4 s, the unnamed multi-line build 239 s, Test 55 s.
const BUILD_JOBS = [jobOf('build', '2026-11-16T10:00:00Z', '2026-11-16T10:00:00Z', '2026-11-16T10:05:00Z', [
  step('Set up job', 1, '2026-11-16T10:00:00Z', '2026-11-16T10:00:02Z'),
  step('Run actions/checkout@v4', 2, '2026-11-16T10:00:02Z', '2026-11-16T10:00:06Z'),
  step('Run npm ci', 3, '2026-11-16T10:00:06Z', '2026-11-16T10:04:05Z'),
  step('Test', 4, '2026-11-16T10:04:05Z', '2026-11-16T10:05:00Z'),
  step('Post Run actions/checkout@v4', 7, '2026-11-16T10:05:00Z', '2026-11-16T10:05:00Z'),
  step('Complete job', 8, '2026-11-16T10:05:00Z', '2026-11-16T10:05:00Z'),
])];

// `count` runs of one workflow, each its jobs shifted an hour further back; ids from `idBase`.
function series(path, jobs, count, idBase) {
  return Array.from({ length: count }, (_, k) => ({
    row: {
      id: idBase + k, path, status: 'completed', conclusion: 'success', event: 'push',
      created_at: shift(jobs[0].created_at, k), updated_at: shift(jobs[0].completed_at, k),
    },
    jobs: { total_count: jobs.length, jobs: jobs.map((j) => shiftJob(j, k)) },
  }));
}

const PER_WORKFLOW = /^repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs$/;
const WHOLE_REPO = /^repos\/[^/]+\/[^/]+\/actions\/runs$/;
const JOBS = /^repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/;
const argVal = (args, key) => { const a = args.find((x) => x.startsWith(`${key}=`)); return a ? a.slice(key.length + 1) : null; };

function fake(items) {
  const calls = [];
  const byId = new Map(items.map((i) => [i.row.id, i.jobs]));
  const newest = (rows) => [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const page = (rows, args) => {
    const per = Number(argVal(args, 'per_page'));
    const n = Number(argVal(args, 'page'));
    return JSON.stringify({ total_count: rows.length, workflow_runs: rows.slice((n - 1) * per, n * per) });
  };
  const runner = (args) => {
    calls.push(args);
    if (calls.length > 2000) throw new Error('call ceiling');
    let m = PER_WORKFLOW.exec(args[3]);
    if (m) {
      const from = Date.parse(`${argVal(args, 'created').replace(/^>=/, '')}T00:00:00Z`);
      return page(newest(items.map((i) => i.row).filter((r) => r.path.endsWith(`/${m[1]}`) && Date.parse(r.created_at) >= from)), args);
    }
    if (WHOLE_REPO.test(args[3])) {
      const [a, b] = argVal(args, 'created').split('..').map(Date.parse);
      return page(newest(items.map((i) => i.row).filter((r) => Date.parse(r.created_at) >= a && Date.parse(r.created_at) <= b)), args);
    }
    m = JOBS.exec(args[3]);
    if (m && byId.has(Number(m[1]))) return JSON.stringify(byId.get(Number(m[1])));
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { runner, calls };
}

function gather(items, workflows, argv = []) {
  let out = '';
  let err = '';
  const f = fake(items);
  const code = run(['gather', '--repo', REPO, '--days', '7', ...argv], {
    runner: f.runner,
    readWorkflowFiles: () => ({ ok: true, workflows }),
    remoteUrl: () => 'https://github.com/thn-inc/claude-tweaks.git',
    pinHost: () => null,
    gateDeps: { env: {}, homedir: '/nonexistent-home', readFile: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } },
    cwd: () => '/checkout',
    now: NOW,
    clock: null,
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
  });
  assert.equal(code, 0, err);
  return { report: JSON.parse(out), calls: f.calls };
}
const row = (report, workflow, job) => report.jobs.find((j) => j.workflow === workflow && j.job === job);

// ---- I1: unnamed steps are matched by the forge's own name for them ----
test('I1: an unnamed single-line `run:` step is the boundary: perf setup is 16 s, not unknown', () => {
  const { report } = gather(series(PERF, PERF_JOBS, 5, 100), [{ file: PERF, text: PERF_YML }]);
  const perf = row(report, PERF, 'perf');
  // started 13:44:54, `Run npm run test:perf` started 13:45:10, completed 13:45:20
  assert.deepEqual(perf.setup, { p50Ms: 16000, p90Ms: 16000, n: 5 });
  assert.deepEqual(perf.running, { p50Ms: 10000, p90Ms: 10000, n: 5 });
});

test('I1: an unnamed multi-line `run: |` step is the boundary: setup is 6 s, never the build pushed onto Test', () => {
  const { report } = gather(series(BUILD, BUILD_JOBS, 5, 200), [{ file: BUILD, text: BUILD_YML('|') }]);
  const build = row(report, BUILD, 'build');
  assert.deepEqual(build.setup, { p50Ms: 6000, p90Ms: 6000, n: 5 });
  assert.deepEqual(build.running, { p50Ms: 294000, p90Ms: 294000, n: 5 });
  assert.deepEqual(report.breaches.filter((b) => b.check === 'setup-dominance'), []);
});

test('I1: a declared command step whose run-data name cannot be known leaves setup unknown, not moved to Test', () => {
  // A folded `>` block: its first line in run data is not knowable from the file, so setup is null.
  const { report } = gather(series(BUILD, BUILD_JOBS, 5, 300), [{ file: BUILD, text: BUILD_YML('>') }]);
  const build = row(report, BUILD, 'build');
  assert.deepEqual(build.setup, { p50Ms: null, p90Ms: null, n: 0 });
  assert.deepEqual(build.running, { p50Ms: 300000, p90Ms: 300000, n: 5 });
  assert.deepEqual(report.breaches.filter((b) => b.check === 'setup-dominance'), []);
});

// ---- I2: an `if:`-skipped job is no 0 ms run and no evidence of serial jobs ----
test('I2: skipped jobs are left out of every figure, counted, and give no serial-independent-jobs breach', () => {
  const { report } = gather(series(FIX, FIX_JOBS, 5, 400), [{ file: FIX, text: FIX_YML }]);
  assert.deepEqual(report.jobs.map((j) => j.job), ['label-fix-branch']);
  assert.deepEqual(report.notTimed, { skipped: 5, cancelled: 0 });
  assert.deepEqual(report.overlaps, []);
  assert.deepEqual(report.breaches.filter((b) => b.check === 'serial-independent-jobs'), []);
});

// ---- I5: `${{ }}`-named matrix shards are matched to their workflow job ----
test('I5: `shard N/4` shards match `shard ${{ … }}/${{ … }}`: setup, shard skew and the real critical path', () => {
  const { report } = gather(series(TEST, TEST_JOBS, 5, 500), [{ file: TEST, text: TEST_YML }]);
  // Each shard's boundary is its unnamed apt-get step (`Run sudo apt-get …`): 16, 17, 18, 14 s.
  assert.deepEqual(['shard 1/4', 'shard 2/4', 'shard 3/4', 'shard 4/4'].map((n) => row(report, TEST, n).setup.p50Ms),
    [16000, 17000, 18000, 14000]);
  assert.deepEqual(report.unmatchedJobs, []);
  // Totals 118, 120, 171, 109 s: median (nearest rank) 118 s, slowest 171 s.
  assert.deepEqual(report.shardSkews, [{ workflow: TEST, family: SHARD_NAME, ratio: 171000 / 118000, slowest: 'shard 3/4', shards: 4 }]);
  // The path is the slowest shard (171 s) then `test` (65 s): 236 s, not `test` alone (12 s).
  assert.deepEqual(report.criticalPaths, [{ workflow: TEST, pathMs: 236000, sumMs: 236000, chain: [SHARD_NAME, 'test'], allJobsMatched: true }]);
});

test('I5: a run job no workflow job matches is listed in unmatchedJobs and keeps the path unjudged', () => {
  const renamed = TEST_YML.replace(`name: ${SHARD_NAME}`, 'name: part ${{ matrix.shard }}');
  const { report } = gather(series(TEST, TEST_JOBS, 5, 600), [{ file: TEST, text: renamed }]);
  assert.deepEqual(report.unmatchedJobs.map((u) => u.job), ['shard 1/4', 'shard 2/4', 'shard 3/4', 'shard 4/4']);
  assert.equal(report.criticalPaths[0].allJobsMatched, false);
  assert.deepEqual(report.breaches.filter((b) => b.check === 'critical-path-pole'), []);
});

// ---- I4: the runs list stops once the sample is held, and claims no truncation it did not have ----
test('I4: 250 runs in the window take one list page for the 20-run sample, with nothing truncated', () => {
  const { report, calls } = gather(series(PERF, PERF_JOBS, 250, 1000), [{ file: PERF, text: PERF_YML }]);
  const lists = calls.filter((a) => PER_WORKFLOW.test(a[3]) || WHOLE_REPO.test(a[3]));
  assert.equal(lists.length, 1);
  assert.equal(report.window.sampledRuns, 20);
  assert.deepEqual(report.truncated, []);
});
