// tests/pipeline-cost-report/records.test.js
//
// #5914: tools/pipeline-cost-report/records.js counts created, closed, open and deferred records and merged PRs
// from the forge. Fake gh only — never spawns gh.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { deferReasonOf, collectRecords, countMergedPrs } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'records.js'));

const Q = { repo: 'o/r', since: '2026-11-08', until: '2026-11-18' };
const SEARCH = (q) => `api search/issues?q=repo:o/r+${q}&per_page=1 -q .total_count`;
const LIST = 'issue list --repo o/r --state all --search created:2026-11-08..2026-11-18 --limit 1000 --json number,state,body';

// A fake gh keyed on its space-joined args; an unknown call throws so a wrong invocation fails loudly.
function fakeGh(table, calls = []) {
  return (args) => {
    const key = args.join(' ');
    calls.push(key);
    if (!(key in table)) throw new Error('unexpected gh call: ' + key);
    return table[key];
  };
}

const BODIES = [
  { number: 1, state: 'OPEN', body: 'x\nDefer-reason: tangential\n' },
  { number: 2, state: 'CLOSED', body: '- **Defer-reason:** blocked-dependency' },
  { number: 3, state: 'CLOSED', body: 'ledger row (`Defer-reason: tangential`)' },
  { number: 4, state: 'OPEN', body: 'none' },
];
const table = (created = '4', list = BODIES) => ({
  [SEARCH('is:issue+created:2026-11-08..2026-11-18')]: created + '\n',
  [SEARCH('is:issue+closed:2026-11-08..2026-11-18')]: '2\n',
  [SEARCH('is:issue+is:open')]: '9\n',
  [LIST]: JSON.stringify(list),
});

test('deferReasonOf reads the first word after the first Defer-reason: in any shape', () => {
  assert.strictEqual(deferReasonOf('Defer-reason: tangential'), 'tangential');
  assert.strictEqual(deferReasonOf('- **Defer-reason:** blocked-dependency'), 'blocked-dependency');
  assert.strictEqual(deferReasonOf('(`Defer-reason: tangential`)'), 'tangential');
  assert.strictEqual(deferReasonOf('file.js:93 — Defer-reason: pre-existing-outside-diff'), 'pre-existing-outside-diff');
  assert.strictEqual(deferReasonOf('Defer-reason: a\nDefer-reason: b'), 'a');
  assert.strictEqual(deferReasonOf('Defer-reason:'), 'unnamed');
  assert.strictEqual(deferReasonOf('Defer-reason: 123'), 'unnamed');
  assert.strictEqual(deferReasonOf('Defer-reason: `tangential`'), 'tangential');
  assert.strictEqual(deferReasonOf('Defer-reason: **tangential**'), 'tangential');
  assert.strictEqual(deferReasonOf('no marker'), null);
  assert.strictEqual(deferReasonOf(null), null);
});

test('AC6.1: a created record counts as deferred only when its body holds a line matching Defer-reason:', async () => {
  const r = await collectRecords(Q, { gh: fakeGh(table()) });
  assert.strictEqual(r.deferred.total, 3);
  assert.strictEqual(r.deferred.open, 1);
  assert.strictEqual(r.deferred.closed, 2);
});

test('AC6.2: one row per reason word, split by open or closed', async () => {
  const r = await collectRecords(Q, { gh: fakeGh(table()) });
  assert.deepStrictEqual(r.byReason.tangential, { open: 1, closed: 1 });
  assert.deepStrictEqual(r.byReason['blocked-dependency'], { open: 0, closed: 1 });
  assert.deepStrictEqual(Object.keys(r.byReason).sort(), ['blocked-dependency', 'tangential']);
});

test('created, closed and open counts come from search total_count', async () => {
  const r = await collectRecords(Q, { gh: fakeGh(table()) });
  assert.strictEqual(r.created, 4);
  assert.strictEqual(r.closed, 2);
  assert.strictEqual(r.open, 9);
  assert.deepStrictEqual(r.truncated, []);
});

test('truncated: a body list shorter than the created total_count is marked', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ number: i + 1, state: 'OPEN', body: i < 5 ? 'Defer-reason: tangential' : 'x' }));
  const r = await collectRecords(Q, { gh: fakeGh(table('1200', rows)) });
  assert.strictEqual(r.created, 1200);
  assert.ok(r.truncated.includes('created'));
  assert.strictEqual(r.deferred.total, 5);
});

test('a created count equal to the 1,000-row body list is not truncated', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ number: i + 1, state: 'OPEN', body: 'x' }));
  const r = await collectRecords(Q, { gh: fakeGh(table('1000', rows)) });
  assert.deepStrictEqual(r.truncated, []);
});

test('a state other than OPEN or CLOSED counts as closed (pinned: there is no third bucket)', async () => {
  const rows = [{ number: 1, state: 'MERGED', body: 'Defer-reason: tangential' }, { number: 2, state: 'open', body: 'Defer-reason: tangential' }];
  const r = await collectRecords(Q, { gh: fakeGh(table('2', rows)) });
  assert.deepStrictEqual(r.byReason.tangential, { open: 1, closed: 1 });
});

test('a gh failure propagates', async () => {
  await assert.rejects(() => collectRecords(Q, { gh: () => { throw new Error('gh down'); } }), /gh down/);
});

test('an empty or whitespace gh stdout is a failure, not a count of zero', async () => {
  for (const out of ['', '\n', '  \n']) {
    const gh = () => out;
    await assert.rejects(() => collectRecords(Q, { gh }), /no total_count/);
    await assert.rejects(() => countMergedPrs(Q, { gh }), /no total_count/);
  }
  assert.strictEqual((await countMergedPrs(Q, { gh: () => '0\n' })).count, 0);
});

test('countMergedPrs counts merged pull requests in the window from total_count', async () => {
  const calls = [];
  const gh = fakeGh({ [SEARCH('is:pr+is:merged+merged:2026-11-08..2026-11-18')]: '202\n' }, calls);
  assert.deepStrictEqual(await countMergedPrs(Q, { gh }), { count: 202 });
  assert.strictEqual(calls.length, 1);
});
