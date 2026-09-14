'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  readOrder, writeOrder, buildFreshnessSignal, signalsMatch, composeOrderBlob,
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
    computedAt: '2026-08-30T00:00:00Z', runId: 'spec-1571', freshnessSignal: { issues: [] }, groups: [], excluded: [],
  });
});

test('composeOrderBlob: carries an optional bundles field through unchanged', () => {
  const blob = composeOrderBlob({
    computedAt: '2026-09-11T00:00:00Z', runId: 'spec-2066', freshnessSignal: { issues: [] }, groups: [], excluded: [], bundles: [{ records: [10, 11] }],
  });
  assert.deepStrictEqual(blob, {
    computedAt: '2026-09-11T00:00:00Z', runId: 'spec-2066', freshnessSignal: { issues: [] }, groups: [], excluded: [], bundles: [{ records: [10, 11] }],
  });
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
