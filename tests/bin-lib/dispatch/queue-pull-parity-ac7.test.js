'use strict';
// #5227 parity (AC7.2 files inputs): the files-input fault rows and the reproduced defects D1, D3, D4.
// Split out of queue-pull.test.js (one file per parity describe, each its own process); see
// queue-pull-helpers.js for the oracle/parity header and the shared machinery.
// Pool: runFaultPool(['files']): the files fault rows, the files bases they read (S1-files-miss,
// S2-files-miss, files-livedep) and D1 (read by the D1 test). The gh fault rows and gh bases are not run
// here: no assertion in this file reads them.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip, reported } = require('./queue-pull-oracle');
const { OPEN_NUMBERS_ARGV, FILES_FAULTS } = require('./queue-pull-fixtures');
const { SESSION_FILES } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const {
  HIT_MESSAGE, sides, assertClean, stopMapped, exclusionsIn, groupedIn, registerParityCleanup, faultComparison, assertFaultFiles, STOP_LINE,
  CLAIM_READ_FAILED_7001, FOREIGN_LOOKUP_NO_GH, FOREIGN_UNREADABLE, assertFaultRow, runFaultPool,
} = require('./queue-pull-helpers');

registerParityCleanup();

const FILES_STOPPED_NEIGHBOUR = { status: 1, stderr: [STOP_LINE.neighbour], drops: ['neighbour-in-flight:9013'] };
const FILES_FOREIGN = (why) => ({ status: 0, base: 'S2-files-miss', stderr: [`Warning: foreign blocker states file <SCR>/agent/foreign-states.json ignored (${why}`, FOREIGN_LOOKUP_NO_GH], drops: [] });
const FILES_EXPECT = {
  'files-queueRaw-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-queueRaw-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-depFreshness-missing': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-malformed': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-missing-cold': { status: 0, stderr: [], drops: [] },
  'files-openNumbers-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-openNumbers-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-verifiedOpenDeps-missing': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-verifiedOpenDeps-malformed': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-inFlightRaw-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightRaw-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-queueRaw-wrapper': { status: 0, stderr: [], entries: [] },
  'files-inFlightRaw-empty': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-empty': { status: 0, stderr: [CLAIM_READ_FAILED_7001], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-string': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-foreignStates-missing': FILES_FOREIGN('ENOENT: '),
  'files-foreignStates-malformed': FILES_FOREIGN('not valid JSON) — supplied states not used (fail closed)'),
};

describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  before(async () => {
    R = (await runFaultPool(['files'])).R;
  });

  for (const f of FILES_FAULTS) {
    test(`AC7.2 [${f.input} ${f.mode}]: module and oracle agree on the outcome`, () => {
      assert.ok(FILES_EXPECT[f.id], `${f.id} has an expectation row`);
      assertFaultRow(f, FILES_EXPECT[f.id], R, 'files');
    });
  }

  test('AC7.2: in-flight raw and claims FILE missing or malformed stop the pull; [] and {} values fail open; a bad foreign-states file excludes as (state unreadable) with a fail-closed Warning (Plan Review Clarifications, criterion 7)', () => {
    for (const id of ['files-inFlightRaw-missing', 'files-inFlightRaw-malformed', 'files-inFlightClaims-missing', 'files-inFlightClaims-malformed']) {
      stopMapped(R[id].oracle, R[id].module);
      for (const [side, r] of sides(R[id])) assert.equal(reported(r.stderr).at(-1), STOP_LINE.neighbour, `${id} ${side}`);
    }
    for (const id of ['files-inFlightRaw-empty', 'files-inFlightClaims-empty']) {
      for (const [side, r] of sides(R[id])) {
        assert.equal(r.status, 0, `${id} ${side}`);
        assert.deepEqual(exclusionsIn(r).filter((e) => e.reason === 'neighbour-in-flight'), [], `${id} ${side}: excludes nothing`);
      }
    }
    assert.deepEqual(exclusionsIn(R['S1-files-miss'].oracle).filter((e) => e.reason === 'neighbour-in-flight').map((e) => e.records[0]), [9013], 'the base excludes #9013 (control)');
    for (const id of ['files-foreignStates-missing', 'files-foreignStates-malformed']) {
      for (const [side, r] of sides(R[id])) {
        assert.equal(r.status, 0, `${id} ${side}`);
        assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9031).detail.blockedBy, [FOREIGN_UNREADABLE], `${id} ${side}: fail closed`);
        assert.ok(reported(r.stderr).some((l) => l.startsWith('Warning: ') && l.endsWith('(fail closed)')), `${id} ${side}: a fail-closed Warning`);
      }
    }
    assert.deepEqual(exclusionsIn(R['S2-files-miss'].oracle).find((e) => e.records[0] === 9031).detail.blockedBy, ['acme-corp/other#12'], 'a readable file answers the state (control)');
  });

  test('#5227 AC7.2: the agent-input carve-out covers only the rows that stop before an agent write point, and only the inputs written after it', () => {
    const carved = {};
    for (const f of FILES_FAULTS) {
      const { files } = faultComparison(R[f.id], 'files');
      const left = SESSION_FILES.filter((n) => !files.includes(n));
      if (left.length) carved[f.id] = left;
    }
    const inFlight = ['dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json'];
    // The grouping-block stops come before the neighbour pass's two writes; the warm cache-check
    // stop comes before the open-numbers and verified-open-deps writes as well.
    const cacheStop = ['dispatch-open-numbers.json', 'dispatch-verified-open-deps.txt', ...inFlight];
    assert.deepEqual(carved, {
      'files-queueRaw-missing': inFlight, 'files-queueRaw-malformed': inFlight,
      'files-depFreshness-missing': cacheStop, 'files-depFreshness-malformed': cacheStop,
      'files-openNumbers-missing': inFlight, 'files-openNumbers-malformed': inFlight,
    });
  });

  test('AC7.2: a dependency-freshness file the agent never wrote stops a warm-cache pull at the cache check, and on a cold cache only leaves the write-back unwritten', () => {
    for (const [side, r] of sides(R['files-depFreshness-missing'])) {
      assert.equal(reported(r.stderr).at(-1), STOP_LINE.cacheHit, `warm ${side}`);
      assert.equal(r.files['dispatch-groups.json'], null, `warm ${side}: the stop came before any groups file`);
    }
    assert.ok(R['S1-files-miss'].oracle.orderBlob, 'the cold base persists its blob (control)');
    for (const [side, r] of sides(R['files-depFreshness-missing-cold'])) {
      assert.equal(r.status, 0, `cold ${side}`);
      assert.equal(r.files['dispatch-dep-freshness.json'], null, `cold ${side}: the agent wrote none, so the session file is gone`);
      assert.equal(r.orderBlob, null, `cold ${side}: the write-back cannot read the freshness and persists nothing`);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-files-miss'].oracle), `cold ${side}: the pull itself is the base's`);
    }
  });

  test('#5227 D3: a wrapper-object queue file yields an empty pool, exit 0, no Warning, both sides', () => {
    for (const [side, r] of sides(R['files-queueRaw-wrapper'])) {
      assert.equal(r.status, 0, side);
      assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']), [], `${side}: an empty pool`);
      assert.equal(r.files['dispatch-queue-raw.json'], '[]', `${side}: aliasMcpTimestamps rewrote the wrapper as []`);
      assert.deepEqual([...reported(r.stderr), ...reported(r.stdout)].filter((l) => l.startsWith('Warning: ')), [], `${side}: no Warning`);
    }
    assert.ok(groupedIn(R['S1-files-miss'].oracle).length > 0, 'the same records unwrapped are dispatchable (control)');
  });

  test('#5227 D4: a non-JSON claim string yields no exclusion and no AUTO line, both sides', () => {
    for (const [side, r] of sides(R['files-inFlightClaims-string'])) {
      assert.equal(r.status, 0, side);
      assert.deepEqual(exclusionsIn(r).filter((e) => e.reason === 'neighbour-in-flight'), [], side);
      assert.ok(!r.stderr.includes('neighbour-in-flight claim read failed'), `${side}: no AUTO line`);
    }
    // A number left out of the map ({}) is a failed read and does print it (control).
    for (const [side, r] of sides(R['files-inFlightClaims-empty'])) assert.ok(reported(r.stderr).includes(CLAIM_READ_FAILED_7001), side);
  });

  test('#5227 D1: a second pull in the same session whose open-numbers fetch returns empty reuses the first pull\'s eligible files, both sides', () => {
    const { first, second } = R.D1;
    assertClean(first, 'D1 first');
    assertClean(second, 'D1 second');
    for (const [side] of sides(second)) {
      const one = first[side];
      const two = second[side];
      assert.equal(one.status, 0, `${side} first: ${one.stderr.slice(-2000)}`);
      assert.equal(two.status, 0, `${side} second: exit 0 on stale data: ${two.stderr.slice(-2000)}`);
      assert.equal(two.files['dispatch-open-numbers.json'], '', `${side}: the second open-numbers fetch returned nothing`);
      assert.ok(two.ghArgv.some((a) => a.tag === 'injected' && a.argv.join(' ') === OPEN_NUMBERS_ARGV.join(' ')), side);
      assert.ok(!two.stderr.includes(HIT_MESSAGE), `${side}: the changed #9003 makes the cache miss`);
      for (const name of ['dispatch-eligible-pre-dep.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json']) {
        assert.equal(two.files[name], one.files[name], `${side}: ${name} is the first pull's`);
      }
      assert.ok(JSON.parse(two.files['dispatch-queue-raw.json']).some((c) => c.title === 'Retitled after the first pull'), `${side}: the second queue holds the new title`);
      const title9003 = (groups) => groups.flat().find((c) => c.number === 9003).title;
      assert.equal(title9003(JSON.parse(two.files['dispatch-groups.json'])), 'Fixture record 9003', `${side}: the groups carry the first pull's record`);
      // Beyond the session files: the write-back persists those stale groups under the second
      // pull's freshness signal, so a third pull over the same queue would hit the cache on them.
      assert.equal(title9003(two.orderBlob.groups), 'Fixture record 9003', `${side}: the blob holds the stale groups`);
      assert.equal(two.orderBlob.freshnessSignal.issues.find((i) => i.number === 9003).updatedAt, '2026-11-12T11:00:00Z', `${side}: under the new freshness`);
    }
    assert.deepEqual(assertFaultFiles(first, 'gh', 'D1 first'), [], 'D1 first: no tail line, every file compared whole');
    assert.deepEqual(assertFaultFiles(second, 'gh', 'D1 second'), [], 'D1 second: no tail line, every file compared whole');
  });
});
