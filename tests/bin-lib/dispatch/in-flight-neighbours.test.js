'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { neighbourInFlightExclusions, neighbourClaimTargets } = require('../../../plugin/bin/lib/dispatch/in-flight-neighbours.js');

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

// #3520: a record with no `### Key Files` whose `## Current State` cites each anchor in backticks.
function nd(number, title, anchors, labels = [{ name: 'priority:medium' }]) {
  return {
    number,
    title,
    labels,
    body: '## Current State\n\n' + anchors.map((a) => `- \`${a}\` is involved`).join('\n') + '\n',
  };
}

const AC1_ANCHORS = ['docs/donts.md', 'fs.realpathSync', 'fs.realpathSync.native'];

function runNd(candidates, inFlight, readClaimContent) {
  return neighbourInFlightExclusions({ candidates, inFlight, readClaimContent, now: NOW });
}

test('AC1: a #3417/#3419-shaped pair with no Key Files and three shared anchors excludes', () => {
  const result = runNd(
    [nd(1, 'Alpha widget gate', AC1_ANCHORS)],
    [nd(9, 'Zeta ledger sweep', AC1_ANCHORS)],
    readerFrom({ 9: { content: live } }),
  );
  assert.deepStrictEqual(result.exclusions, [
    {
      reason: 'neighbour-in-flight',
      records: [1],
      detail: {
        neighbours: [
          { number: 9, files: [], signals: ['body-anchor-overlap'], sharedAnchors: [...AC1_ANCHORS].sort() },
        ],
      },
    },
  ]);
  assert.deepStrictEqual(result.unreadable, []);
});

test('AC2: one shared non-generic anchor (a #3417/#3012 shape) does not exclude', () => {
  const calls = [];
  const anchor = ['plugin/bin/lib/hooks/pre-tool-use.js'];
  const result = runNd(
    [nd(1, 'Alpha widget gate', anchor)],
    [nd(9, 'Zeta ledger sweep', anchor)],
    readerFrom({ 9: { content: live } }, calls),
  );
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
  assert.deepStrictEqual(calls, []);
});

test('AC2: two shared anchors exclude', () => {
  const anchors = ['plugin/bin/a.js', 'plugin/bin/b.js'];
  const result = runNd(
    [nd(1, 'Alpha widget gate', anchors)],
    [nd(9, 'Zeta ledger sweep', anchors)],
    readerFrom({ 9: { content: live } }),
  );
  assert.deepStrictEqual(result.exclusions.map((e) => e.records), [[1]]);
  assert.deepStrictEqual(result.exclusions[0].detail.neighbours[0].sharedAnchors, anchors);
});

test('AC2: shared anchors that are all generic do not exclude', () => {
  const anchors = ['--run-dir', '/claude-tweaks:dispatch', 'auto:build'];
  const calls = [];
  const result = runNd(
    [nd(1, 'Alpha widget gate', anchors)],
    [nd(9, 'Zeta ledger sweep', anchors)],
    readerFrom({ 9: { content: live } }, calls),
  );
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
  assert.deepStrictEqual(calls, []);
});

test('AC3: a strong near-duplicate with an expired or tombstoned claim does not exclude; a failed read lists it in unreadable', () => {
  const candidates = [
    nd(1, 'Alpha widget gate', AC1_ANCHORS),
    nd(2, 'Bravo cache layer', ['x/one.js', 'x/two.js']),
    nd(3, 'Charlie parser pass', ['y/one.js', 'y/two.js']),
    nd(4, 'Delta report view', ['z/one.js', 'z/two.js']),
  ];
  const inFlight = [
    nd(9, 'Zeta ledger sweep', AC1_ANCHORS),
    nd(8, 'Yankee ledger sweep', ['x/one.js', 'x/two.js']),
    nd(7, 'Xray ledger sweep', ['y/one.js', 'y/two.js']),
    nd(6, 'Whiskey ledger sweep', ['z/one.js', 'z/two.js']),
  ];
  const result = runNd(
    candidates,
    inFlight,
    readerFrom({ 9: { content: expired }, 8: { content: tombstone }, 7: { failure: 'HTTP 500' }, 6: new Error('boom') }),
  );
  assert.deepStrictEqual(result.exclusions, []);
  assert.deepStrictEqual(result.unreadable, [6, 7]);
});

test('AC5: a file-only neighbour element carries no signals key', () => {
  const result = run(readerFrom({ 9: { content: live } }));
  assert.deepStrictEqual(Object.keys(result.exclusions[0].detail.neighbours[0]), ['number', 'files']);
});

test('Review Focus 1: a record matching both rules yields one element with files and signals', () => {
  const withFiles = (n, title) => ({
    ...rec(n, ['a.js']),
    title,
    body: rec(n, ['a.js']).body + '\n## Current State\n\n- `anchor/one.js`\n- `anchor/two.js`\n',
  });
  const calls = [];
  const result = runNd(
    [withFiles(1, 'Alpha widget gate')],
    [withFiles(9, 'Zeta ledger sweep')],
    readerFrom({ 9: { content: live } }, calls),
  );
  assert.deepStrictEqual(result.exclusions, [
    {
      reason: 'neighbour-in-flight',
      records: [1],
      detail: {
        neighbours: [
          {
            number: 9,
            files: ['a.js'],
            signals: ['key-files-overlap', 'body-anchor-overlap'],
            sharedAnchors: ['anchor/one.js', 'anchor/two.js'],
          },
        ],
      },
    },
  ]);
  assert.deepStrictEqual(calls, [9]);
});

test('Review Focus 2: an in-flight record that is also a candidate is never a near-duplicate neighbour', () => {
  const calls = [];
  const result = runNd(
    [nd(1, 'Alpha widget gate', AC1_ANCHORS), nd(9, 'Zeta ledger sweep', AC1_ANCHORS)],
    [nd(9, 'Zeta ledger sweep', AC1_ANCHORS)],
    readerFrom({ 9: { content: live } }, calls),
  );
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
  assert.deepStrictEqual(calls, []);
});

test('Review Focus 3: a parked in-flight near-duplicate is not a neighbour', () => {
  const calls = [];
  const result = runNd(
    [nd(1, 'Alpha widget gate', AC1_ANCHORS)],
    [nd(9, 'Zeta ledger sweep', AC1_ANCHORS, [{ name: 'parked' }])],
    readerFrom({ 9: { content: live } }, calls),
  );
  assert.deepStrictEqual(result, { exclusions: [], unreadable: [] });
  assert.deepStrictEqual(calls, []);
});

test('near-duplicate-only neighbours follow file neighbours, ordered by ascending number, each read once', () => {
  const fileRec = (n) => ({ ...rec(n, ['a.js']), title: `File neighbour ${n}` });
  const candidate = {
    ...rec(1, ['a.js']),
    title: 'Alpha widget gate',
    body: rec(1, ['a.js']).body + '\n## Current State\n\n- `p/one.js`\n- `p/two.js`\n',
  };
  const calls = [];
  const result = runNd(
    [candidate],
    [fileRec(20), nd(12, 'Zeta ledger sweep', ['p/one.js', 'p/two.js']), nd(10, 'Yankee ledger sweep', ['p/one.js', 'p/two.js'])],
    readerFrom({ 20: { content: live }, 12: { content: live }, 10: { content: live } }, calls),
  );
  assert.deepStrictEqual(result.exclusions[0].detail.neighbours.map((n) => n.number), [20, 10, 12]);
  assert.deepStrictEqual([...calls].sort((a, b) => a - b), [10, 12, 20]);
});

test('neighbourClaimTargets includes near-duplicate neighbours', () => {
  const targets = neighbourClaimTargets({
    candidates: [nd(1, 'Alpha widget gate', AC1_ANCHORS)],
    inFlight: [nd(9, 'Zeta ledger sweep', AC1_ANCHORS)],
  });
  assert.deepStrictEqual(targets, [9]);
});

test('a score-only strong pair (one shared anchor plus similar titles, no Key Files) excludes', () => {
  const anchor = ['plugin/skills/dispatch/drain-pr-overlap.md'];
  const result = runNd(
    [nd(1, 'Fix drain hold prose in dispatch skill', anchor)],
    [nd(9, 'Fix drain hold line in dispatch skill', anchor)],
    readerFrom({ 9: { content: live } }),
  );
  assert.strictEqual(result.exclusions.length, 1);
  assert.strictEqual(result.exclusions[0].reason, 'neighbour-in-flight');
  const [neighbour] = result.exclusions[0].detail.neighbours;
  assert.strictEqual(neighbour.number, 9);
  assert.deepStrictEqual(neighbour.files, []);
  assert.ok(neighbour.signals.includes('title-similarity'));
  assert.ok(neighbour.signals.includes('body-anchor-overlap'));
  assert.strictEqual(neighbour.sharedAnchors.length, 1);
});

test('accepted gap (#3520): a hub Key File dropped by findInFlightNeighbours still counts as a key-files-overlap signal', () => {
  const withHub = (n, title) => ({ ...rec(n, ['hub.js']), title });
  const result = runNd(
    [withHub(1, 'Fix drain hold prose in dispatch skill')],
    [
      withHub(9, 'Fix drain hold line in dispatch skill'),
      withHub(8, 'Zeta ledger sweep'),
      withHub(7, 'Yankee cache layer'),
    ],
    readerFrom({ 9: { content: live }, 8: { content: live }, 7: { content: live } }),
  );
  assert.deepStrictEqual(result.exclusions, [
    {
      reason: 'neighbour-in-flight',
      records: [1],
      detail: {
        neighbours: [
          { number: 9, files: [], signals: ['key-files-overlap', 'title-similarity'], sharedAnchors: [] },
        ],
      },
    },
  ]);
});
