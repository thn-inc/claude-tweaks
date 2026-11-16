// tests/efficiency-report.test.js
//
// #4029: tools/efficiency-report.js reads archived pipeline timing.json files and reports weekly and
// per-ceremony-profile medians. The fixture archive (tests/fixtures/efficiency-report/archive/) holds
// seven runs over two ISO weeks (2026-W53 and 2027-W01, so the week year differs from the calendar
// year) — three of them (record-6..8) carry a review phase with per-file procedure reads, record-8's
// unreached — a malformed timing.json, a run dir without one, and a spec-9/timing.json nested inside a run
// that must never be read. AC3.1's real-archive probe is machine-local state and is not an automated test.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'efficiency-report', 'archive');
const { run, collectRuns, median, summarize, isoWeek, reviewFilesOf } = require(path.join(ROOT, 'tools', 'efficiency-report.js'));

function runCli(argv, extra = {}) {
  const out = [];
  const errs = [];
  const code = run({ argv, deps: { log: (s) => out.push(s), err: (s) => errs.push(s), ...extra } });
  return { code, out: out.join('\n'), errs: errs.join('\n') };
}

test('#4029: efficiency report computes medians, ISO weeks and per-profile groups over a fixture archive', () => {
  const { runs, skipped } = collectRuns(FIXTURE, fs);
  assert.strictEqual(skipped, 1);
  assert.deepStrictEqual(runs.map((r) => r.runId).sort(), [
    '2026-12-31T090000-record-1', '2027-01-01T090000-record-2', '2027-01-04T090000-record-3', '2027-01-05T090000-record-4',
    '2027-01-07T090000-record-6', '2027-01-08T090000-record-7', '2027-01-09T090000-record-8',
  ]);
  const byId = Object.fromEntries(runs.map((r) => [r.runId, r]));
  assert.deepStrictEqual(byId['2026-12-31T090000-record-1'], {
    runId: '2026-12-31T090000-record-1', week: '2026-W53', profile: 'standard',
    minutes: 10, roundTrips: 100, procedureKb: 10, verifyMinutes: 2, ceremonyShare: 0.2, reviewFiles: null,
  });
  // No totals.verifyMinutes: summed from phases[].verify[].durationMs (90s + 90s = 3 min); no ceremonyShare: null.
  assert.deepStrictEqual(byId['2027-01-01T090000-record-2'], {
    runId: '2027-01-01T090000-record-2', week: '2026-W53', profile: 'standard',
    minutes: 20, roundTrips: 300, procedureKb: 20, verifyMinutes: 3, ceremonyShare: null, reviewFiles: null,
  });
  // No toolRoundTrips / procedureBytes: null, not zero.
  assert.deepStrictEqual(byId['2027-01-04T090000-record-3'], {
    runId: '2027-01-04T090000-record-3', week: '2027-W01', profile: 'fast-lane',
    minutes: 40, roundTrips: null, procedureKb: null, verifyMinutes: 5, ceremonyShare: 0.4, reviewFiles: null,
  });
  // No config.yml: profile null. No verifyMinutes and no verify durations: null. A 0-minute run still counts.
  assert.deepStrictEqual(byId['2027-01-05T090000-record-4'], {
    runId: '2027-01-05T090000-record-4', week: '2027-W01', profile: null,
    minutes: 0, roundTrips: 500, procedureKb: 5, verifyMinutes: null, ceremonyShare: null, reviewFiles: null,
  });
  // A reached review phase carries its procedureFiles; record-8's span-less, unattributed review row does not count.
  assert.deepStrictEqual(byId['2027-01-07T090000-record-6'].reviewFiles, {
    'skills/review/code-mode-steps.md': 4, 'skills/review/step3-lens-dispatch.md': 2,
  });
  assert.deepStrictEqual(byId['2027-01-08T090000-record-7'].reviewFiles, { 'skills/review/code-mode-steps.md': 2 });
  assert.strictEqual(byId['2027-01-09T090000-record-8'].reviewFiles, null);

  const s = summarize(runs);
  assert.deepStrictEqual(s.overall, {
    runs: 7,
    // minutes [0,10,10,20,30,40,50] is an odd count: the middle value. Records 6-8 carry only minutes.
    medians: { minutes: 20, roundTrips: 300, procedureKb: 10, verifyMinutes: 3, ceremonyShare: 0.3 },
  });
  assert.deepStrictEqual(Object.keys(s.byProfile), ['fast-lane', 'none', 'standard']);
  assert.deepStrictEqual(s.byProfile.standard, {
    runs: 2, medians: { minutes: 15, roundTrips: 200, procedureKb: 15, verifyMinutes: 2.5, ceremonyShare: 0.2 },
  });
  assert.deepStrictEqual(s.byProfile['fast-lane'].medians, {
    minutes: 40, roundTrips: null, procedureKb: null, verifyMinutes: 5, ceremonyShare: 0.4,
  });
  // record-4 plus records 6-8 (no config.yml): minutes [0,10,30,50] → 20.
  assert.deepStrictEqual(s.byProfile.none, {
    runs: 4, medians: { minutes: 20, roundTrips: 500, procedureKb: 5, verifyMinutes: null, ceremonyShare: null },
  });
  assert.deepStrictEqual(Object.keys(s.byWeek), ['2026-W53', '2027-W01']);
  assert.strictEqual(s.byWeek['2026-W53'].runs, 2);
  // 2027-W01 holds records 3, 4, 6, 7 and 8 (Jan 4-9): minutes [0,10,30,40,50] → 30.
  assert.strictEqual(s.byWeek['2027-W01'].runs, 5);
  assert.deepStrictEqual(s.byWeek['2027-W01'].medians, {
    minutes: 30, roundTrips: 500, procedureKb: 5, verifyMinutes: 5, ceremonyShare: 0.4,
  });

  const { code, out, errs } = runCli(['--archive', FIXTURE]);
  assert.strictEqual(code, 0, errs);
  const lines = out.split('\n');
  assert.strictEqual(
    lines[0],
    'runs: 7 (3 with round-trip data, 1 skipped) · median minutes 20 · median round trips 300 · median procedure KB 10 · median verify minutes 3',
  );
  assert.ok(lines.includes('| Profile | Runs | Minutes | Round trips | Proc. KB | Verify min | Ceremony share |'), out);
  assert.ok(lines.includes('| standard | 2 | 15 | 200 | 15 | 2.5 | 20% |'), out);
  assert.ok(lines.includes('| none | 4 | 20 | 500 | 5 | — | — |'), out);
  assert.ok(lines.includes('| Week | Runs | Minutes | Round trips | Proc. KB | Verify min | Ceremony share |'), out);
  const weekRows = lines.filter((l) => /^\| \d{4}-W\d\d /.test(l));
  assert.deepStrictEqual(weekRows, [
    '| 2026-W53 | 2 | 15 | 200 | 15 | 2.5 | 20% |',
    '| 2027-W01 | 5 | 30 | 500 | 5 | 5 | 40% |',
  ]);
});

test('#4029: --json prints the summary as JSON', () => {
  const { code, out } = runCli(['--archive', FIXTURE, '--json']);
  assert.strictEqual(code, 0);
  const j = JSON.parse(out);
  assert.strictEqual(j.skipped, 1);
  assert.strictEqual(j.roundTripRuns, 3);
  assert.strictEqual(j.overall.medians.minutes, 20);
  assert.strictEqual(j.byProfile.standard.runs, 2);
  assert.deepStrictEqual(Object.keys(j.byWeek), ['2026-W53', '2027-W01']);
});

test('#4359: review-phase per-file reads: median over runs with data, missing key counts as 0', () => {
  const { code, out } = runCli(['--archive', FIXTURE, '--json']);
  assert.strictEqual(code, 0);
  const r = JSON.parse(out).reviewFileReads;
  // Only records 6 and 7 reached review with per-file data; record-8's review never started and the
  // older runs carry no procedureFiles at all.
  assert.strictEqual(r.runs, 2);
  // Sorted by total descending: code-mode-steps (6) before step3-lens-dispatch (2).
  assert.deepStrictEqual(Object.keys(r.files), ['skills/review/code-mode-steps.md', 'skills/review/step3-lens-dispatch.md']);
  assert.deepStrictEqual(r.files['skills/review/code-mode-steps.md'], { median: 3, total: 6 });
  // record-7 lacks the key and counts as 0: median of [2, 0] is 1.
  assert.deepStrictEqual(r.files['skills/review/step3-lens-dispatch.md'], { median: 1, total: 2 });

  const md = runCli(['--archive', FIXTURE]);
  assert.strictEqual(md.code, 0, md.errs);
  const lines = md.out.split('\n');
  const at = lines.indexOf('## Review-phase skill-file reads');
  assert.ok(at > lines.indexOf('## By week'), md.out);
  assert.ok(lines.includes('runs with per-file data: 2'), md.out);
  assert.ok(lines.includes('| File | Median reads/run | Total reads |'), md.out);
  assert.ok(lines.includes('| skills/review/code-mode-steps.md | 3 | 6 |'), md.out);
  assert.ok(lines.includes('| skills/review/step3-lens-dispatch.md | 1 | 2 |'), md.out);
});

test('#4359: review-phase per-file reads sum every reached review row, tie-break by key, and say so when no run has data', () => {
  const reviewRow = (procedureFiles, extra = {}) => ({
    phase: 'review', start: '2027-01-07T09:00:00.000Z', end: '2027-01-07T09:10:00.000Z', source: 'skill_invoked', procedureFiles, ...extra,
  });
  const runOf = (phases) => reviewFilesOf({ phases });
  // Two reached review rows sum; a non-review row and a span-less or unattributed review row do not.
  assert.deepStrictEqual(runOf([
    reviewRow({ a: 1, b: 2 }),
    reviewRow({ a: 3 }),
    { phase: 'build', start: '2027-01-07T08:00:00.000Z', source: 'skill_invoked', procedureFiles: { a: 100 } },
    reviewRow({ a: 50 }, { start: null }),
    reviewRow({ a: 70 }, { source: 'unattributed' }),
  ]), { a: 4, b: 2 });
  // A reached review row with no procedureFiles object is no data.
  assert.strictEqual(runOf([reviewRow(undefined)]), null);
  assert.strictEqual(runOf([reviewRow([1])]), null);
  assert.strictEqual(reviewFilesOf({}), null);
  // An empty object on a reached row is data: the run counts with zero reads.
  assert.deepStrictEqual(runOf([reviewRow({})]), {});

  const s = summarize([
    { reviewFiles: { z: 2, a: 2, m: 5 } },
    { reviewFiles: {} },
    { reviewFiles: null },
  ]);
  assert.strictEqual(s.reviewFileReads.runs, 2);
  // Total descending, then key: m (5), then a and z tied at 2 in key order. Medians over [x, 0].
  assert.deepStrictEqual(s.reviewFileReads.files, {
    m: { median: 2.5, total: 5 }, a: { median: 1, total: 2 }, z: { median: 1, total: 2 },
  });
  assert.deepStrictEqual(Object.keys(s.reviewFileReads.files), ['m', 'a', 'z']);

  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'effrep-'));
  try {
    fs.mkdirSync(path.join(root, '2027-01-07T090000-old'));
    fs.writeFileSync(path.join(root, '2027-01-07T090000-old', 'timing.json'), JSON.stringify({ totals: { minutes: 3 } }));
    const { code, out } = runCli(['--archive', root]);
    assert.strictEqual(code, 0);
    const lines = out.split('\n');
    assert.ok(lines.includes('## Review-phase skill-file reads'), out);
    assert.ok(lines.includes('runs with per-file data: 0'), out);
    assert.ok(lines.includes('no run carries per-file read data'), out);
    assert.ok(!lines.includes('| File | Median reads/run | Total reads |'), out);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('#4029: missing archive exits 1', () => {
  const { code, errs } = runCli(['--archive', path.join(FIXTURE, 'does-not-exist')]);
  assert.strictEqual(code, 1);
  assert.match(errs, /archive/);
});

test('#4029: a malformed invocation exits 2', () => {
  assert.strictEqual(runCli(['--bogus']).code, 2);
  assert.strictEqual(runCli(['--archive']).code, 2);
  assert.strictEqual(runCli(['--archive', '--json']).code, 2);
});

test('#4029: the default archive is resolved from git rev-parse --git-common-dir (absolute) in the main checkout', () => {
  const calls = [];
  const git = (args, opts) => {
    calls.push(args);
    return '/some/checkout/.git\n';
  };
  const seen = [];
  const fakeFs = {
    readdirSync: (dir) => {
      seen.push(dir);
      return [];
    },
    readFileSync: () => {
      throw new Error('unexpected read');
    },
  };
  const { code } = runCli([], { git, fs: fakeFs, cwd: '/some/checkout/.claude/worktrees/w' });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(calls, [['rev-parse', '--path-format=absolute', '--git-common-dir']]);
  assert.deepStrictEqual(seen, [path.join('/some/checkout', '.claude-tweaks', 'pipelines', 'archive')]);
});

test('#4029: an unresolvable default archive exits 1 rather than guessing', () => {
  const { code, errs } = runCli([], { git: () => { throw new Error('not a git repo'); } });
  assert.strictEqual(code, 1);
  assert.match(errs, /--archive/);
});

test('#4029: isoWeek puts a date near New Year in the ISO week-year it belongs to', () => {
  assert.strictEqual(isoWeek(new Date(Date.UTC(2026, 0, 1))), '2026-W01'); // Thursday
  assert.strictEqual(isoWeek(new Date(Date.UTC(2027, 0, 1))), '2026-W53'); // Friday: previous week-year
  assert.strictEqual(isoWeek(new Date(Date.UTC(2024, 11, 30))), '2025-W01'); // Monday: next week-year
  assert.strictEqual(isoWeek(new Date(Date.UTC(2021, 0, 3))), '2020-W53'); // Sunday
  assert.strictEqual(isoWeek(new Date(Date.UTC(2026, 5, 15))), '2026-W25');
});

test('#4029: median is numeric-only, averages the middle pair and is null on nothing', () => {
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(median([4, 1, 3, 2]), 2.5);
  assert.strictEqual(median([0, 0, 10]), 0);
  assert.strictEqual(median([null, 5, undefined, 'x', NaN, 7]), 6);
  assert.strictEqual(median([]), null);
  assert.strictEqual(median([null, undefined]), null);
});

test('#4029: a run falls back to generatedAt for its week when the run id carries no date', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'effrep-'));
  try {
    fs.mkdirSync(path.join(root, 'adhoc-run'));
    fs.writeFileSync(path.join(root, 'adhoc-run', 'timing.json'), JSON.stringify({ generatedAt: '2027-01-01T12:00:00Z', totals: { minutes: 7 } }));
    fs.mkdirSync(path.join(root, 'no-date-at-all'));
    fs.writeFileSync(path.join(root, 'no-date-at-all', 'timing.json'), JSON.stringify({ totals: 'nope' }));
    fs.writeFileSync(path.join(root, 'stray-file.txt'), 'x');
    const { runs, skipped } = collectRuns(root, fs);
    assert.strictEqual(skipped, 0);
    const byId = Object.fromEntries(runs.map((r) => [r.runId, r]));
    assert.strictEqual(byId['adhoc-run'].week, '2026-W53');
    assert.strictEqual(byId['adhoc-run'].minutes, 7);
    assert.strictEqual(byId['no-date-at-all'].week, null);
    assert.strictEqual(byId['no-date-at-all'].minutes, null);
    assert.deepStrictEqual(Object.keys(summarize(runs).byWeek), ['2026-W53', 'unknown']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
