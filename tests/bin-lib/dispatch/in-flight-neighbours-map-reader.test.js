'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  neighbourInFlightExclusions,
  neighbourClaimTargets,
  claimReaderFromMap,
} = require('../../../plugin/bin/lib/dispatch/in-flight-neighbours.js');

const NOW = Date.parse('2026-10-17T12:00:00Z');
const HOUR = 3600 * 1000;

function rec(number, files) {
  return {
    number,
    labels: [{ name: 'priority:medium' }],
    body: '## Technical Approach\n\n### Key Files\n\n' + files.map((f) => `- \`${f}\` — x`).join('\n') + '\n',
  };
}

const live = JSON.stringify({ runId: 'r', claimedAt: new Date(NOW).toISOString(), ttlHours: 72 });
const expired = JSON.stringify({ runId: 'r', claimedAt: new Date(NOW - 100 * HOUR).toISOString(), ttlHours: 72 });
const tombstone = JSON.stringify({ released: true });

// A reader that serves a fixed table; a value of Error throws, anything else is returned.
function readerFrom(table, calls = []) {
  return (number) => {
    calls.push(number);
    const value = table[number];
    if (value instanceof Error) throw value;
    return value;
  };
}

function run(readClaimContent, extra = {}) {
  return neighbourInFlightExclusions({
    candidates: [rec(1, ['a.js'])],
    inFlight: [rec(9, ['a.js'])],
    readClaimContent,
    now: NOW,
    ...extra,
  });
}

test('neighbourClaimTargets lists only in-flight records that neighbour a candidate, sorted and unique', () => {
  // No file is shared by 3+ records (that would make it a hub path and no neighbour edge).
  // 9 neighbours both candidates (listed once), 8 neighbours candidate 3, 7 neighbours none.
  const candidates = [rec(1, ['a.js']), rec(2, ['b.js']), rec(3, ['c.js'])];
  const inFlight = [rec(9, ['a.js', 'b.js']), rec(8, ['c.js']), rec(7, ['z.js'])];
  assert.deepStrictEqual(neighbourClaimTargets({ candidates, inFlight }), [8, 9]);
  assert.deepStrictEqual(neighbourClaimTargets({ candidates, inFlight: [] }), []);
});

test('AC1.1: an MCP-read live claim (map-backed reader) produces the neighbour-in-flight exclusion', () => {
  const map = JSON.parse(JSON.stringify({ 9: live }));
  const result = run(claimReaderFromMap(map));
  assert.deepStrictEqual(result.exclusions, [
    { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
  assert.deepStrictEqual(result.unreadable, []);
});

test('AC2.1: a stale bot:in-progress label with no live claim never excludes, on either transport', () => {
  const inFlight = [{ ...rec(9, ['a.js']), labels: [{ name: 'bot:in-progress' }] }];
  for (const blob of [null, expired, tombstone]) {
    const gh = run(readerFrom({ 9: { content: blob } }), { inFlight });
    const mcp = run(claimReaderFromMap({ 9: blob }), { inFlight });
    assert.deepStrictEqual(gh, { exclusions: [], unreadable: [] });
    assert.deepStrictEqual(mcp, { exclusions: [], unreadable: [] });
  }
});

test('AC3.1: a failed MCP claim read (failure entry or never-read key) writes no exclusion and is reported unreadable', () => {
  for (const map of [{ 9: { failure: 'HTTP 500' } }, {}, { 9: 42 }]) {
    const result = run(claimReaderFromMap(map));
    assert.deepStrictEqual(result, { exclusions: [], unreadable: [9] });
  }
});

test('an object-valued live claim (the parsed blob embedded in the map) produces the exclusion, not an unreadable read', () => {
  const map = { 9: JSON.parse(live) };
  assert.deepStrictEqual(run(claimReaderFromMap(map)), {
    exclusions: [
      { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
    ],
    unreadable: [],
  });
  assert.deepStrictEqual(run(claimReaderFromMap({ 9: JSON.parse(tombstone) })), { exclusions: [], unreadable: [] });
});

test('claimReaderFromMap maps each entry shape', () => {
  const read = claimReaderFromMap({ 1: null, 2: 'x', 3: { failure: 'boom' }, 4: 7, 6: { runId: 'r' }, 7: [1] });
  assert.deepStrictEqual(read(6), { content: JSON.stringify({ runId: 'r' }) });
  assert.deepStrictEqual(read(7), { failure: 'malformed-claim-entry' });
  assert.deepStrictEqual(read(1), { content: null });
  assert.deepStrictEqual(read(2), { content: 'x' });
  assert.deepStrictEqual(read(3), { failure: 'boom' });
  assert.deepStrictEqual(read(4), { failure: 'malformed-claim-entry' });
  assert.deepStrictEqual(read(5), { failure: 'claim-not-read' });
});
