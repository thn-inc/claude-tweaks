'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { neighbourInFlightExclusions } = require('../../../plugin/bin/lib/dispatch/in-flight-neighbours.js');

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

test('AC4.0 (positive control): a live-claimed neighbour sharing a file produces one exclusion', () => {
  const result = run(readerFrom({ 9: { content: live } }));
  assert.deepStrictEqual(result.exclusions, [
    { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
  assert.deepStrictEqual(result.unreadable, []);
});

test('AC4.1: an absent claim blob ({content: null}) produces no exclusion', () => {
  const result = run(readerFrom({ 9: { content: null } }));
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
});

test('AC4.1: an expired claim produces no exclusion', () => {
  const result = run(readerFrom({ 9: { content: expired } }));
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
});

test('AC4.1: an unreadable claim blob (\'not json\') produces no exclusion and is not a read failure', () => {
  const result = run(readerFrom({ 9: { content: 'not json' } }));
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
});

test('AC4.1: a leftover bot:in-progress label with a tombstone claim produces no exclusion', () => {
  const inFlight = [{ ...rec(9, ['a.js']), labels: [{ name: 'bot:in-progress' }] }];
  const result = run(readerFrom({ 9: { content: tombstone } }), { inFlight });
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
});

test('AC4.2: a failed claim read ({failure}) and a thrown read both mean not in flight, and are listed in unreadable', () => {
  const candidates = [rec(1, ['a.js']), rec(2, ['b.js']), rec(3, ['c.js'])];
  const inFlight = [rec(8, ['a.js']), rec(9, ['b.js']), rec(7, ['c.js'])];
  const result = neighbourInFlightExclusions({
    candidates,
    inFlight,
    readClaimContent: readerFrom({ 9: { failure: 'HTTP 500' }, 8: new Error('boom'), 7: { failure: 'HTTP 502' } }),
    now: NOW,
  });
  assert.deepStrictEqual(result.exclusions, []);
  assert.deepStrictEqual(result.unreadable, [7, 8, 9]);
});

test('Review Focus 3: one throwing read does not stop a live neighbour of another candidate from excluding it', () => {
  const candidates = [rec(1, ['a.js']), rec(2, ['b.js'])];
  const inFlight = [rec(9, ['a.js']), rec(8, ['b.js'])];
  const result = neighbourInFlightExclusions({
    candidates,
    inFlight,
    readClaimContent: readerFrom({ 9: new Error('boom'), 8: { content: live } }),
    now: NOW,
  });
  assert.deepStrictEqual(result.exclusions, [
    { reason: 'neighbour-in-flight', records: [2], detail: { neighbours: [{ number: 8, files: ['b.js'] }] } },
  ]);
  assert.deepStrictEqual(result.unreadable, [9]);
});

test('Review Focus 5: an empty inFlight pool yields no exclusions and no reads', () => {
  const result = run(() => assert.fail('readClaimContent must not be called'), { inFlight: [] });
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
});

test('reads each in-flight number at most once even when it neighbours two candidates', () => {
  const calls = [];
  const result = neighbourInFlightExclusions({
    candidates: [rec(1, ['a.js']), rec(2, ['b.js'])],
    inFlight: [rec(9, ['a.js', 'b.js'])],
    readClaimContent: readerFrom({ 9: { content: live } }, calls),
    now: NOW,
  });
  assert.deepStrictEqual(calls, [9]);
  assert.deepStrictEqual(result.exclusions.map((e) => e.records), [[1], [2]]);
});

test('reads claims only for in-flight records that neighbour some candidate', () => {
  const calls = [];
  const result = neighbourInFlightExclusions({
    candidates: [rec(1, ['a.js'])],
    inFlight: [rec(9, ['a.js']), rec(7, ['unrelated.js'])],
    readClaimContent: readerFrom({ 9: { content: live }, 7: { content: live } }, calls),
    now: NOW,
  });
  assert.deepStrictEqual(calls, [9]);
  assert.strictEqual(result.exclusions.length, 1);
});

test('only live neighbours are listed, and exclusions are ordered by candidate number', () => {
  const result = neighbourInFlightExclusions({
    candidates: [rec(5, ['a.js', 'b.js']), rec(3, ['c.js'])],
    inFlight: [rec(9, ['a.js', 'c.js']), rec(8, ['b.js'])],
    readClaimContent: readerFrom({ 9: { content: live }, 8: { content: expired } }),
    now: NOW,
  });
  assert.deepStrictEqual(result.exclusions, [
    { reason: 'neighbour-in-flight', records: [3], detail: { neighbours: [{ number: 9, files: ['c.js'] }] } },
    { reason: 'neighbour-in-flight', records: [5], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
});

test('hubOptions pass through to the neighbour computation', () => {
  const candidates = [rec(1, ['hub.js']), rec(2, ['hub.js']), rec(3, ['hub.js'])];
  const inFlight = [rec(9, ['hub.js'])];
  const reader = readerFrom({ 9: { content: live } });
  const withDefaults = neighbourInFlightExclusions({ candidates, inFlight, readClaimContent: reader, now: NOW });
  const unhubbed = neighbourInFlightExclusions({
    candidates, inFlight, readClaimContent: reader, now: NOW,
    hubOptions: { hubPathMinCount: 100, hubPathFraction: 1.1 },
  });
  assert.strictEqual(unhubbed.exclusions.length, 3);
  assert.notDeepStrictEqual(withDefaults.exclusions, unhubbed.exclusions);
});
