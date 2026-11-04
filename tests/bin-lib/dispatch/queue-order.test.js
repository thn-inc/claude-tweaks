'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  readOrder, writeOrder, buildFreshnessSignal, signalsMatch, composeOrderBlob, cacheUsable, GROUPING_MODE, groupingMode,
} = require('../../../plugin/bin/lib/dispatch/queue-order.js');

// Same minimal fake git runner shape as merge-lane-breaker.test.js's own
// (kept independent rather than importing it — this suite only needs
// read/write wiring proof, not the full CAS-loop coverage
// durable-state.test.js already owns).
function fakeRunner(script) {
  function run(cmd, args) {
    for (const rule of script) {
      if (rule.match(cmd, args)) {
        const throwsVal = typeof rule.throws === 'function' ? rule.throws(cmd, args) : rule.throws;
        if (throwsVal) throw new Error(throwsVal);
        return typeof rule.returns === 'function' ? rule.returns(cmd, args) : rule.returns;
      }
    }
    throw new Error(`fakeRunner: no rule matched ${cmd} ${JSON.stringify(args)}`);
  }
  return { run };
}

function matchArgs(args, needle) {
  return args.join(' ').includes(needle);
}

function baseWriteRules() {
  return [
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), returns: '' },
  ];
}

// --- buildFreshnessSignal ---

test('buildFreshnessSignal: extracts number/updatedAt/state, dropping any extra fields', () => {
  const signal = buildFreshnessSignal([
    { number: 1, updatedAt: '2026-01-01T00:00:00Z', state: 'OPEN', title: 'ignored', body: 'ignored' },
  ]);
  assert.deepStrictEqual(signal, { issues: [{ number: 1, updatedAt: '2026-01-01T00:00:00Z', state: 'OPEN' }] });
});

test('buildFreshnessSignal: dedupes by number, last write wins', () => {
  const signal = buildFreshnessSignal([
    { number: 1, updatedAt: 'old', state: 'OPEN' },
    { number: 1, updatedAt: 'new', state: 'OPEN' },
  ]);
  assert.deepStrictEqual(signal, { issues: [{ number: 1, updatedAt: 'new', state: 'OPEN' }] });
});

test('buildFreshnessSignal: non-array input yields an empty issue list, never throws', () => {
  assert.deepStrictEqual(buildFreshnessSignal(undefined), { issues: [] });
  assert.deepStrictEqual(buildFreshnessSignal(null), { issues: [] });
});

// --- signalsMatch (AC6's four required cases) ---

test('signalsMatch: exact match', () => {
  const persisted = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }, { number: 2, updatedAt: 't2', state: 'CLOSED' }] };
  const current = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }, { number: 2, updatedAt: 't2', state: 'CLOSED' }] };
  assert.equal(signalsMatch(persisted, current), true);
});

test('signalsMatch: mismatch when an auto:build issue\'s updatedAt changed', () => {
  const persisted = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }] };
  const current = { issues: [{ number: 1, updatedAt: 't2', state: 'OPEN' }] };
  assert.equal(signalsMatch(persisted, current), false);
});

test('signalsMatch: mismatch when an auto:build issue was added to the set', () => {
  const persisted = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }] };
  const current = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }, { number: 2, updatedAt: 't2', state: 'OPEN' }] };
  assert.equal(signalsMatch(persisted, current), false);
});

test('signalsMatch: mismatch when an auto:build issue was removed from the set', () => {
  const persisted = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }, { number: 2, updatedAt: 't2', state: 'OPEN' }] };
  const current = { issues: [{ number: 1, updatedAt: 't1', state: 'OPEN' }] };
  assert.equal(signalsMatch(persisted, current), false);
});

test('signalsMatch: mismatch when a recorded dependency\'s state flips OPEN->CLOSED (AC3)', () => {
  const persisted = { issues: [{ number: 99, updatedAt: 't1', state: 'OPEN' }] };
  const current = { issues: [{ number: 99, updatedAt: 't1', state: 'CLOSED' }] };
  assert.equal(signalsMatch(persisted, current), false);
});

test('signalsMatch: malformed/missing input is always a mismatch, never a throw', () => {
  assert.equal(signalsMatch(null, { issues: [] }), false);
  assert.equal(signalsMatch({ issues: [] }, null), false);
  assert.equal(signalsMatch({}, {}), false);
  assert.equal(signalsMatch(undefined, undefined), false);
});

// --- composeOrderBlob ---

test('composeOrderBlob: states the blob field list once', () => {
  const blob = composeOrderBlob({
    computedAt: '2026-08-30T00:00:00Z', runId: 'spec-1571', freshnessSignal: { issues: [] }, groups: [], excluded: [],
  });
  assert.deepStrictEqual(blob, {
    computedAt: '2026-08-30T00:00:00Z', runId: 'spec-1571', freshnessSignal: { issues: [] }, groups: [], excluded: [], grouping: 'per-record',
  });
});

test('composeOrderBlob: carries an optional bundles field through unchanged', () => {
  const blob = composeOrderBlob({
    computedAt: '2026-09-11T00:00:00Z', runId: 'spec-2066', freshnessSignal: { issues: [] }, groups: [], excluded: [], bundles: [{ records: [10, 11] }],
  });
  assert.deepStrictEqual(blob, {
    computedAt: '2026-09-11T00:00:00Z', runId: 'spec-2066', freshnessSignal: { issues: [] }, groups: [], excluded: [], bundles: [{ records: [10, 11] }], grouping: 'per-record',
  });
});

test('composeOrderBlob carries grouping: per-record', () => {
  const blob = composeOrderBlob({
    computedAt: '2026-10-17T00:00:00Z', runId: 'spec-3278', freshnessSignal: { issues: [] }, groups: [], excluded: [],
  });
  assert.equal(blob.grouping, 'per-record');
  assert.equal(GROUPING_MODE, 'per-record');
});

// --- cacheUsable ---

const SIGNAL = { issues: [{ number: 1, updatedAt: 'a', state: 'OPEN' }] };

test('Review Focus 1: cacheUsable rejects a blob with no grouping field even when signals match', () => {
  const legacy = { computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [] };
  assert.equal(signalsMatch(legacy.freshnessSignal, SIGNAL), true);
  assert.equal(cacheUsable(legacy, SIGNAL), false);
});

test('cacheUsable accepts a per-record blob whose signals match', () => {
  const blob = composeOrderBlob({
    computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [],
  });
  assert.equal(cacheUsable(blob, SIGNAL), true);
});

test('cacheUsable rejects mismatched signals', () => {
  const blob = composeOrderBlob({
    computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [],
  });
  const changed = { issues: [{ number: 1, updatedAt: 'b', state: 'OPEN' }] };
  assert.equal(cacheUsable(blob, changed), false);
});

test('cacheUsable rejects a blob stamped with any other grouping value', () => {
  const blob = { freshnessSignal: SIGNAL, grouping: 'transitive' };
  assert.equal(cacheUsable(blob, SIGNAL), false);
});

test('groupingMode names the express variant only when express is enabled; GROUPING_MODE is unchanged', () => {
  assert.equal(groupingMode(true), 'per-record+express');
  assert.equal(groupingMode(false), 'per-record');
  assert.equal(GROUPING_MODE, 'per-record');
});

test('composeOrderBlob stamps a passed grouping, and the stamp gates cacheUsable (#4025)', () => {
  const express = composeOrderBlob({
    computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [], grouping: 'per-record+express',
  });
  assert.equal(express.grouping, 'per-record+express');
  assert.equal(cacheUsable(express, SIGNAL, 'per-record+express'), true);
  assert.equal(cacheUsable(express, SIGNAL), false);
  const plain = composeOrderBlob({ computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded: [] });
  assert.equal(cacheUsable(plain, SIGNAL, 'per-record+express'), false);
  assert.equal(cacheUsable(plain, SIGNAL, 'per-record'), true);
  assert.equal(cacheUsable(express, { issues: [{ number: 1, updatedAt: 'b', state: 'OPEN' }] }, 'per-record+express'), false);
});

test('cacheUsable(null, x) is false and never throws on malformed input', () => {
  assert.equal(cacheUsable(null, SIGNAL), false);
  assert.equal(cacheUsable(undefined, SIGNAL), false);
  assert.equal(cacheUsable({ grouping: 'per-record' }, SIGNAL), false);
  assert.equal(cacheUsable({ grouping: 'per-record', freshnessSignal: SIGNAL }, null), false);
});

// #4793: a foreign issue closing changes nothing in the freshness signal, so a hit would replay a
// stale foreign verdict. A queue whose body declares 'Blocked by owner/name#N' is never a hit.
test('#4793: the same queue is a cache hit without a qualified foreign Blocked by line, and a miss with one', () => {
  const queue = (body) => [{ number: 1, updatedAt: 'a', state: 'OPEN', body }];
  const persistedFor = (issues) => composeOrderBlob({
    computedAt: 'x', runId: 'y', freshnessSignal: buildFreshnessSignal(issues), groups: [], excluded: [],
  });
  for (const body of ['Blocked by #7', 'see other/repo#5 for context', '', undefined]) {
    assert.equal(cacheUsable(persistedFor(queue(body)), buildFreshnessSignal(queue(body))), true, `body ${JSON.stringify(body)}`);
  }
  for (const body of ['Blocked by other/repo#5', 'intro\nBlocked by Other/Repo#5\n']) {
    const foreign = queue(body);
    assert.equal(cacheUsable(persistedFor(foreign), buildFreshnessSignal(foreign)), false, `body ${JSON.stringify(body)}`);
  }
  // Any one candidate declaring it is enough, and the flag is the only extra key on the signal.
  const mixed = [...queue(''), { number: 2, updatedAt: 'b', state: 'OPEN', body: 'Blocked by acme/x#2' }];
  assert.deepStrictEqual(buildFreshnessSignal(mixed).foreignDeclared, true);
  assert.equal('foreignDeclared' in buildFreshnessSignal(queue('')), false, 'absent when no body declares one');
});

// signalsMatch pairs entries by issue number: two signals of the same length that differ only in one
// number must not match (an absent number is a mismatch, not "compare against itself").
test('signalsMatch and cacheUsable reject two same-length signals with one issue number swapped', () => {
  const persisted = { issues: [{ number: 1, updatedAt: 'a', state: 'OPEN' }, { number: 2, updatedAt: 'b', state: 'OPEN' }] };
  const current = { issues: [{ number: 1, updatedAt: 'a', state: 'OPEN' }, { number: 3, updatedAt: 'b', state: 'OPEN' }] };
  assert.equal(signalsMatch(persisted, current), false);
  const blob = composeOrderBlob({ computedAt: 'x', runId: 'y', freshnessSignal: persisted, groups: [], excluded: [] });
  assert.equal(cacheUsable(blob, current), false);
  assert.equal(cacheUsable(blob, persisted), true, 'the identical signal is still a hit');
});

// #4793: a native or body-declared foreign blocker closing changes nothing in the freshness signal, so
// a hit must not replay a persisted exclusion that names one.
test('#4793: cacheUsable misses when a persisted exclusion names a foreign blocker, and hits when it names only this repository\'s #N', () => {
  const blobWith = (excluded) => composeOrderBlob({ computedAt: 'x', runId: 'y', freshnessSignal: SIGNAL, groups: [], excluded });
  assert.equal(cacheUsable(blobWith([{ number: 1, blockedBy: ['other/repo#5'] }]), SIGNAL), false);
  assert.equal(cacheUsable(blobWith([{ number: 1, blockedBy: ['other/repo#5 (state unreadable)'] }]), SIGNAL), false);
  assert.equal(cacheUsable(blobWith([{ number: 2, blockedBy: [4, 'Other/Repo#5'] }]), SIGNAL), false, 'one foreign entry among local ones');
  assert.equal(cacheUsable(blobWith([{ number: 1, blockedBy: [5] }]), SIGNAL), true);
  assert.equal(cacheUsable(blobWith([{ number: 1, blockedBy: ['#5', 'not a ref'] }]), SIGNAL), true, 'strings that are not owner/name#N are not foreign');
  assert.equal(cacheUsable(blobWith([]), SIGNAL), true);
});

// --- readOrder / writeOrder wiring ---

test('readOrder: resolves null against a genuinely never-written namespace (missing ref)', () => {
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), throws: "couldn't find remote ref health-state" },
  ]);
  const order = readOrder('/repo', { run, sleep: () => {} });
  assert.equal(order, null);
});

test('readOrder: parses a persisted order.json blob back out', () => {
  const blob = { computedAt: 'x', runId: 'y', freshnessSignal: { issues: [] }, groups: [], excluded: [] };
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), returns: JSON.stringify(blob) },
  ]);
  const order = readOrder('/repo', { run, sleep: () => {} });
  assert.deepStrictEqual(order, blob);
});

test('writeOrder: writes the given blob unconditionally, ignoring any existing namespace content', () => {
  const written = { value: null };
  const { run: baseRun } = fakeRunner(baseWriteRules());
  function run(cmd, args, opts) {
    if (cmd === 'git' && matchArgs(args, 'hash-object')) {
      written.value = opts && opts.input;
    }
    return baseRun(cmd, args, opts);
  }
  const blob = { computedAt: 'now', runId: 'r', freshnessSignal: { issues: [] }, groups: [[{ id: 1 }]], excluded: [] };
  const result = writeOrder('/repo', blob, { run, sleep: () => {} });
  assert.deepStrictEqual(result, { ok: true });
  assert.deepStrictEqual(JSON.parse(written.value), blob);
});

test('readOrder/writeOrder: a bundles field round-trips through the cache unchanged', () => {
  const blob = {
    computedAt: 'now', runId: 'r', freshnessSignal: { issues: [] }, groups: [], excluded: [], bundles: [{ records: [1, 2] }],
  };
  const { run: writeRun } = fakeRunner(baseWriteRules());
  const writeResult = writeOrder('/repo', blob, { run: writeRun, sleep: () => {} });
  assert.deepStrictEqual(writeResult, { ok: true });

  const { run: readRun } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), returns: JSON.stringify(blob) },
  ]);
  const readBack = readOrder('/repo', { run: readRun, sleep: () => {} });
  assert.deepStrictEqual(readBack.bundles, [{ records: [1, 2] }]);
});

test('readOrder: a pre-upgrade blob with no bundles field reads back with bundles undefined (caller applies the [] fallback)', () => {
  const blob = {
    computedAt: 'x', runId: 'y', freshnessSignal: { issues: [] }, groups: [], excluded: [],
  };
  const { run } = fakeRunner([
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), returns: JSON.stringify(blob) },
  ]);
  const order = readOrder('/repo', { run, sleep: () => {} });
  assert.equal(order.bundles, undefined);
});

test('writeOrder: a persistent write failure returns {ok:false}, never throws — a cache write is best-effort', () => {
  const rules = [
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'rev-parse') && matchArgs(args, '^{tree}'), returns: 'commit-sha-1\ntree-sha-1\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'fetch'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'show'), throws: 'fatal: path does not exist' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'ls-tree'), returns: '' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'hash-object'), returns: 'blob-sha\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'mktree'), returns: 'tree-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'commit-tree'), returns: 'commit-sha-2\n' },
    { match: (cmd, args) => cmd === 'git' && matchArgs(args, 'push'), throws: 'fatal: failed to push some refs' },
  ];
  const { run } = fakeRunner(rules);
  const blob = { computedAt: 'now', runId: 'r', freshnessSignal: { issues: [] }, groups: [], excluded: [] };
  const result = writeOrder('/repo', blob, { run, sleep: () => {} });
  assert.equal(result.ok, false);
});
