'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchNativeSubIssues, fetchNativeDependencies } = require('../../../plugin/bin/lib/issues/native-dependencies');

const resp = (repository) => JSON.stringify({ data: { repository } });

test('fetchNativeSubIssues maps each alias to its sub-issue numbers', () => {
  const runner = () => resp({
    i1095: { number: 1095, subIssues: { nodes: [{ number: 1097 }, { number: 1101 }], pageInfo: { hasNextPage: false } } },
    i7: { number: 7, subIssues: { nodes: [], pageInfo: { hasNextPage: false } } },
  });
  const out = fetchNativeSubIssues({ numbers: [1095, 7], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.byParent.get(1095), [1097, 1101]);
  assert.deepStrictEqual(out.byParent.get(7), []);
  assert.deepStrictEqual(out.retry, []);
});

test('a missing alias routes that parent to retry, never to an empty byParent entry', () => {
  const runner = () => resp({ i1095: { number: 1095, subIssues: { nodes: [{ number: 1097 }], pageInfo: { hasNextPage: false } } } });
  const out = fetchNativeSubIssues({ numbers: [1095, 8], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.byParent.get(1095), [1097]);
  assert.strictEqual(out.byParent.has(8), false);
  assert.deepStrictEqual(out.retry, [8]);
});

test('hasNextPage routes that parent to retry — a partial first page is never used', () => {
  const runner = () => resp({ i9: { number: 9, subIssues: { nodes: [{ number: 1 }], pageInfo: { hasNextPage: true } } } });
  const out = fetchNativeSubIssues({ numbers: [9], owner: 'o', repo: 'r', runner });
  assert.strictEqual(out.byParent.has(9), false);
  assert.deepStrictEqual(out.retry, [9]);
});

test('null repository throws rather than returning a partial map', () => {
  const runner = () => JSON.stringify({ data: { repository: null }, errors: [{ message: 'boom' }] });
  assert.throws(() => fetchNativeSubIssues({ numbers: [5], owner: 'o', repo: 'r', runner }), /boom|no sub-issue data/);
});

test('a null connection node is dropped from byParent, genuine sub-issue numbers retained in order', () => {
  const runner = () => resp({
    i1095: { number: 1095, subIssues: { nodes: [{ number: 1097 }, null, { number: 1101 }], pageInfo: { hasNextPage: false } } },
  });
  const out = fetchNativeSubIssues({ numbers: [1095], owner: 'o', repo: 'r', runner });
  assert.deepStrictEqual(out.byParent.get(1095), [1097, 1101]);
});

test('empty input returns empty result without calling the runner', () => {
  const out = fetchNativeSubIssues({ numbers: [], owner: 'o', repo: 'r', runner: () => { throw new Error('must not run'); } });
  assert.strictEqual(out.byParent.size, 0);
  assert.deepStrictEqual(out.retry, []);
});

test('fetchNativeDependencies carries a cross-repository blocker beside unchanged blockedBy/openBlocker/openBlockerIds', () => {
  const runner = () => resp({
    i11: { number: 11, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: [
      { number: 5, state: 'OPEN', repository: { nameWithOwner: 'other/repo' } },
      { number: 6, state: 'CLOSED', repository: { nameWithOwner: 'acme/w' } },
    ] } },
  });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner }).get(11), {
    blockedBy: [5, 6], openBlocker: true, openBlockerIds: [5],
    crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }],
  });
});
test('fetchNativeDependencies adds no crossRepoBlockers key when every blocker is this repository\'s, or the field is absent', () => {
  const same = () => resp({ i11: { number: 11, repository: { nameWithOwner: 'acme/w' }, blockedBy: { nodes: [{ number: 6, state: 'OPEN', repository: { nameWithOwner: 'ACME/w' } }] } } });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner: same }).get(11), { blockedBy: [6], openBlocker: true, openBlockerIds: [6] });
  const legacy = () => resp({ i11: { number: 11, blockedBy: { nodes: [{ number: 6, state: 'OPEN' }] } } });
  assert.deepStrictEqual(fetchNativeDependencies({ numbers: [11], owner: 'acme', repo: 'w', runner: legacy }).get(11), { blockedBy: [6], openBlocker: true, openBlockerIds: [6] });
});
test('fetchNativeDependencies compares against the dependent issue\'s canonical name, not the caller\'s owner/repo', () => {
  const runner = () => resp({ i11: { number: 11, repository: { nameWithOwner: 'new-org/w' }, blockedBy: { nodes: [{ number: 6, state: 'CLOSED', repository: { nameWithOwner: 'new-org/w' } }] } } });
  assert.equal('crossRepoBlockers' in fetchNativeDependencies({ numbers: [11], owner: 'old-org', repo: 'w', runner }).get(11), false);
});

const twoRecords = () => resp({
  i11: { number: 11, blockedBy: { nodes: [{ number: 5, state: 'OPEN' }] } },
  i12: { number: 12, blockedBy: { nodes: [] } },
});
const fixedNow = () => new Date('2026-11-19T08:00:00.000Z');

test('fetchNativeDependencies hands each entry to onSnapshot once, in numbers order, with one fetchedAt from now', () => {
  let runs = 0;
  const runner = () => { runs += 1; return twoRecords(); };
  const calls = [];
  let ticks = 0;
  const now = () => new Date(Date.parse('2026-11-19T08:00:00.000Z') + 1000 * ticks++);
  const map = fetchNativeDependencies({
    numbers: [11, 12], owner: 'acme', repo: 'w', host: 'github.com', runner, now,
    onSnapshot: (n, entry, meta) => calls.push([n, entry, meta]),
  });
  assert.strictEqual(runs, 1);
  const meta = { owner: 'acme', repo: 'w', host: 'github.com', fetchedAt: '2026-11-19T08:00:00.000Z' };
  assert.deepStrictEqual(calls, [[11, map.get(11), meta], [12, map.get(12), meta]]);
});

test('a throwing onSnapshot leaves the returned Map identical and still reaches every number', () => {
  const plain = fetchNativeDependencies({ numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords });
  const seen = [];
  const map = fetchNativeDependencies({
    numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords, now: fixedNow,
    onSnapshot: (n) => { seen.push(n); throw new Error('sink boom'); },
  });
  assert.deepStrictEqual([...map], [...plain]);
  assert.deepStrictEqual(seen, [11, 12]);
});

test('a callback that mutates its entry leaves the returned Map unchanged', () => {
  const map = fetchNativeDependencies({
    numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords, now: fixedNow,
    onSnapshot: (n, entry) => { entry.blockedBy.push(99); entry.openBlocker = 'mutated'; },
  });
  assert.deepStrictEqual([...map], [
    [11, { blockedBy: [5], openBlocker: true, openBlockerIds: [5] }],
    [12, { blockedBy: [], openBlocker: false, openBlockerIds: [] }],
  ]);
});

test('a throwing clock makes zero onSnapshot calls and returns the complete Map', () => {
  const calls = [];
  let map;
  assert.doesNotThrow(() => {
    map = fetchNativeDependencies({
      numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords,
      now: () => { throw new Error('clock'); }, onSnapshot: (n) => calls.push(n),
    });
  });
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual([...map], [...fetchNativeDependencies({ numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords })]);
});

test('a duplicated number calls onSnapshot once per unique number, first-occurrence order', () => {
  const calls = [];
  fetchNativeDependencies({
    numbers: [11, 11, 12], owner: 'acme', repo: 'w', runner: twoRecords, now: fixedNow,
    onSnapshot: (n) => calls.push(n),
  });
  assert.deepStrictEqual(calls, [11, 12]);
});

test('an absent onSnapshot returns the same Map as before', () => {
  const map = fetchNativeDependencies({ numbers: [11, 12], owner: 'acme', repo: 'w', runner: twoRecords });
  assert.deepStrictEqual([...map], [
    [11, { blockedBy: [5], openBlocker: true, openBlockerIds: [5] }],
    [12, { blockedBy: [], openBlocker: false, openBlockerIds: [] }],
  ]);
});

test('a partial response that throws calls onSnapshot zero times', () => {
  const calls = [];
  const runner = () => resp({ i11: { number: 11, blockedBy: { nodes: [] } } });
  assert.throws(() => fetchNativeDependencies({
    numbers: [11, 12], owner: 'acme', repo: 'w', runner, now: fixedNow, onSnapshot: (n) => calls.push(n),
  }), /missing dependency data for #12/);
  const malformed = () => JSON.stringify({ data: { repository: null } });
  assert.throws(() => fetchNativeDependencies({
    numbers: [11], owner: 'acme', repo: 'w', runner: malformed, now: fixedNow, onSnapshot: (n) => calls.push(n),
  }), /missing repository/);
  assert.deepStrictEqual(calls, []);
});
