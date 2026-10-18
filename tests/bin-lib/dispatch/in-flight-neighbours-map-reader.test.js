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

// A reader that serves a fixed table of { content } / { failure } results.
function readerFrom(table) {
  return (number) => table[number];
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
  const result = run(claimReaderFromMap({ 9: live }));
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
  const claim = { runId: 'r', claimedAt: new Date(NOW).toISOString() };
  const read = claimReaderFromMap({ 1: null, 2: 'x', 3: { failure: 'boom' }, 4: 7, 6: claim, 7: [1] });
  assert.deepStrictEqual(read(6), { content: JSON.stringify(claim) });
  assert.deepStrictEqual(read(7), { failure: 'malformed-claim-entry' });
  assert.deepStrictEqual(read(1), { content: null });
  assert.deepStrictEqual(read(2), { content: 'x' });
  assert.deepStrictEqual(read(3), { failure: 'boom' });
  assert.deepStrictEqual(read(4), { failure: 'malformed-claim-entry' });
  assert.deepStrictEqual(read(5), { failure: 'claim-not-read' });
});

test('a JSON entry that is neither a claim nor a tombstone is a failed read, never a live claim', () => {
  // classifyClaimBlob calls any JSON object without `released` live, so these would otherwise exclude.
  const shapes = [{ message: 'Not Found' }, { error: 'boom' }, {}, { content: live, sha: 'abc' }];
  for (const shape of shapes) {
    for (const entry of [shape, JSON.stringify(shape)]) {
      assert.deepStrictEqual(run(claimReaderFromMap({ 9: entry })), { exclusions: [], unreadable: [9] });
    }
  }
});

test('a missing map reads as an empty one: every entry unread, nothing excluded', () => {
  for (const map of [null, undefined]) {
    assert.deepStrictEqual(run(claimReaderFromMap(map)), { exclusions: [], unreadable: [9] });
  }
});

test('neighbourClaimTargets names exactly the numbers neighbourInFlightExclusions reads', () => {
  const candidates = [rec(1, ['a.js']), rec(2, ['b.js']), rec(3, ['c.js'])];
  const inFlight = [rec(9, ['a.js', 'b.js']), rec(8, ['c.js']), rec(7, ['z.js'])];
  const read = [];
  neighbourInFlightExclusions({
    candidates, inFlight, now: NOW, readClaimContent: (n) => { read.push(n); return { content: null }; },
  });
  assert.deepStrictEqual(neighbourClaimTargets({ candidates, inFlight }), [...new Set(read)].sort((a, b) => a - b));
});
