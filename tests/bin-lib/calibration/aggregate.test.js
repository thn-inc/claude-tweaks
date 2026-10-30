'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregate, runIdTimestamp } = require('../../../plugin/bin/lib/calibration/aggregate.js');

function makeRuns(n, { withFindingsOnRow = null } = {}) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const runId = `2026-08-${String(i + 1).padStart(2, '0')}T000000-run`;
    const decisionLines = [
      '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.',
    ];
    runs.push({ runId, decisionLines, events: { counts: {} } });
  }
  return runs;
}

test('aggregate: a row absent from every run in the window is "no runs in window"', () => {
  const result = aggregate({ tsv: { rows: [] }, runs: makeRuns(3), rowIds: ['skills', 'docs'], windowN: 20 });
  assert.strictEqual(result.perRow.skills, 'no runs in window');
});

test('aggregate: narrowing signal suppressed under 10 appearances, present at >=10', () => {
  const runs5 = makeRuns(5);
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push({ date: '2026-08-01', runId: runs5[i].runId, rowId: 'skills', gate: 'closed', count: '0', outcome: 'na' });
  const under = aggregate({ tsv: { rows }, runs: runs5, rowIds: ['skills'], windowN: 20 });
  assert.ok(under.suppressions.narrowing.includes('skills'));

  const runs10 = makeRuns(10);
  const rowsFull = [];
  for (let i = 0; i < 10; i++) rowsFull.push({ date: '2026-08-01', runId: runs10[i].runId, rowId: 'skills', gate: 'closed', count: '0', outcome: 'na' });
  const over = aggregate({ tsv: { rows: rowsFull }, runs: runs10, rowIds: ['skills'], windowN: 20 });
  assert.ok(!over.suppressions.narrowing.includes('skills'));
  assert.strictEqual(over.perRow.skills.appearances, 10);
  assert.strictEqual(over.perRow.skills.findings, 0);
});

test('aggregate: console distribution counts terminal decisions and buckets unlogged runs', () => {
  const runs = makeRuns(3);
  runs.push({ runId: '2026-08-04T000000-run', decisionLines: ['- AUTO 09:00:00 — Step 1.5: scope-creep.'], events: { counts: {} } });
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.strictEqual(result.consoleDist['approve-all'], 3);
  assert.strictEqual(result.consoleDist.unlogged, 1);
});

test('aggregate: ceiling signal suppressed under 10 console stops', () => {
  const result = aggregate({ tsv: { rows: [] }, runs: makeRuns(9), rowIds: [], windowN: 20 });
  assert.strictEqual(result.suppressions.ceiling, true);
});

test('aggregate: failedCount counts FAILED lines across the window, starting at 0', () => {
  const clean = aggregate({ tsv: { rows: [] }, runs: makeRuns(2), rowIds: [], windowN: 20 });
  assert.strictEqual(clean.failedCount, 0);

  const runs = makeRuns(2);
  runs.push({
    runId: '2026-08-05T000000-run',
    decisionLines: [
      '- FAILED 09:00:00 — apply-refine-labels: priority write failed on #42: HTTP 500.',
      '- FAILED 09:00:05 — apply-refine-labels: grant write failed on #43: HTTP 500.',
    ],
    events: { counts: {} },
  });
  const withFailures = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.strictEqual(withFailures.failedCount, 2);
});

function stubRuns(ids, decisionLines = []) {
  return ids.map((runId) => ({ runId, decisionLines, events: { counts: {} } }));
}

test('AC1.1: with the 2026-10-27 archive shape, the window is the 20 most recent hyphenated-timestamp runs', () => {
  const dated = [];
  for (let d = 1; d <= 25; d++) dated.push(`2026-10-${String(d).padStart(2, '0')}T120000-record-${d}`);
  const undated = ['spec-339', 'spec-852', 'unresolved-provenance'];
  const olderDated = ['20260911T131119-backlog-standalone', '2026-07-19T1900-record-39'];
  // input deliberately unsorted: undated and older ids interleaved
  const ids = [...undated.slice(0, 1), ...dated.slice().reverse(), ...olderDated, ...undated.slice(1)];
  const runs = stubRuns(ids);
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, dated.slice(5));
  assert.strictEqual(result.window.excluded, 3);
});

test('runIdTimestamp: parses hyphenated, minute-precision and compact ids; null for undated', () => {
  assert.strictEqual(runIdTimestamp('2026-10-27T055458-tidy-standalone'), '20261027055458');
  assert.strictEqual(runIdTimestamp('2026-07-19T1900-record-39'), '20260719190000');
  assert.strictEqual(runIdTimestamp('20260911T131119-backlog-standalone'), '20260911131119');
  assert.strictEqual(runIdTimestamp('2026-10-01T120000'), '20261001120000');
  assert.strictEqual(runIdTimestamp('spec-339'), null);
  assert.strictEqual(runIdTimestamp('unresolved-provenance'), null);
  assert.strictEqual(runIdTimestamp('run-1'), null);
});

test('compact and minute-precision ids order by time, not by text', () => {
  const ids = ['2026-10-01T0001-c', '20261001T000000-a', '2026-09-30T235959-b'];
  const runs = stubRuns(ids);
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 2 });
  assert.deepStrictEqual(result.window.runIds, ['20261001T000000-a', '2026-10-01T0001-c']);
  assert.strictEqual(result.window.excluded, 0);
});

test('ties on timestamp break by run id', () => {
  const ids = ['2026-08-09T094731-spec-246-247-254-untracked-halves', '2026-08-09T094731-spec-246-247-254'];
  const runs = stubRuns(ids);
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, ['2026-08-09T094731-spec-246-247-254', '2026-08-09T094731-spec-246-247-254-untracked-halves']);
});

test('undated runs never pad a short window', () => {
  const ids = ['2026-08-01T000000-a', 'run-1', '2026-08-02T000000-b', 'spec-12'];
  const runs = stubRuns(ids, ['- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.']);
  const result = aggregate({ tsv: { rows: [] }, runs, rowIds: [], windowN: 20 });
  assert.deepStrictEqual(result.window.runIds, ['2026-08-01T000000-a', '2026-08-02T000000-b']);
  assert.strictEqual(result.window.excluded, 2);
  assert.strictEqual(result.consoleDist['approve-all'], 2);
});
