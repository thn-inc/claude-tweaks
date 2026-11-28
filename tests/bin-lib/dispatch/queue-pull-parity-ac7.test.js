'use strict';
// #5227 parity (AC7.2 files inputs) and the files family of #5227 parity (AC4 fetch failures): the
// files-input fault rows and the reproduced defects D3, D4. Split out of queue-pull.test.js (one file per
// parity describe, each its own process); see queue-pull-helpers.js for the oracle/parity header and the
// shared machinery.
// Pool: runFaultPool(['files'], { d1: false }): the files fault rows and the files bases they read
// (S1-files-miss, S2-files-miss, files-livedep, files-opendeps), one pool for both describes. The gh fault rows run in
// queue-pull-parity-ac4.test.js and D1 (and its test) in queue-pull-parity-d1.test.js. AC4.2 [files]
// reads the gh rows' exits from FAULT_EXPECT (postureView), which queue-pull-parity-ac4's AC4.1 rows pin
// to the gh runs; AC4.3 [files] checks the files rows' share of the tail-row set.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip, reported } = require('./queue-pull-oracle');
const { FILES_FAULTS } = require('./queue-pull-fixtures');
const { SESSION_FILES } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const {
  sides, stopMapped, exclusionsIn, groupedIn, registerParityCleanup, faultComparison, STOP_LINE, CLAIM_READ_FAILED_7001, FOREIGN_UNREADABLE,
  assertFaultRow, runFaultPool, FILES_EXPECT, assertFailOpenPostures,
} = require('./queue-pull-helpers');

registerParityCleanup();

describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  before(async () => {
    R = (await runFaultPool(['files'], { d1: false })).R;
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
        assert.equal(reported(r.stderr).filter((l) => l.startsWith('Warning: foreign blocker')).length, 1, `${id} ${side}: one foreign-states Warning, the ignored file's (#5304)`);
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
      'files-queueRaw-missing': inFlight, 'files-queueRaw-malformed': inFlight, 'files-queueRaw-wrapper': inFlight,
      'files-queueRaw-string': inFlight,
      'files-depFreshness-missing': cacheStop, 'files-depFreshness-malformed': cacheStop, 'files-depFreshness-wrapper': cacheStop,
      'files-depFreshness-string': cacheStop,
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
      assert.deepEqual(groupedIn(r), groupedIn(R['files-opendeps'].oracle), `cold ${side}: the pull itself is the base's`);
    }
    for (const [side, r] of sides(R['files-depFreshness-wrapper-cold'])) {
      assert.equal(r.status, 0, `cold wrapper ${side}`);
      // The cold base also prints its own gh-absent Warnings (linked PRs, unlanded blockers): count the file's only.
      const warnings = reported(r.stderr).filter((l) => l.includes('/dispatch-dep-freshness.json is not a JSON array'));
      assert.equal(warnings.length, 1, `cold wrapper ${side}: one Warning naming the file`);
      assert.equal(r.orderBlob, null, `cold wrapper ${side}: the write-back cannot read the wrapper and persists nothing`);
      assert.deepEqual(groupedIn(r), groupedIn(R['files-opendeps'].oracle), `cold wrapper ${side}: the pull itself is the base's`);
    }
  });

  test('#5307 D3: a wrapper-object queue or dependency-freshness file is a failed read on both sides: exit 1, one Warning naming the file, the matching stop last', () => {
    for (const [id, file, stop] of [['files-queueRaw-wrapper', 'dispatch-queue-raw.json', STOP_LINE.grouping], ['files-queueRaw-string', 'dispatch-queue-raw.json', STOP_LINE.grouping], ['files-depFreshness-wrapper', 'dispatch-dep-freshness.json', STOP_LINE.cacheHit], ['files-depFreshness-string', 'dispatch-dep-freshness.json', STOP_LINE.cacheHit]]) {
      stopMapped(R[id].oracle, R[id].module);
      for (const [side, r] of sides(R[id])) {
        const warnings = reported(r.stderr).filter((l) => l.startsWith('Warning: '));
        assert.equal(warnings.length, 1, `${id} ${side}: one Warning`);
        assert.ok(warnings[0].includes(`/${file} is not a JSON array`), `${id} ${side}: names the file`);
        assert.equal(reported(r.stderr).at(-1), stop, `${id} ${side}`);
      }
    }
    // The queue stop truncates dispatch-groups.json and writes nothing into it; the dependency stop
    // comes before any groups file, so there is none. Neither leaves a clean empty pool.
    for (const [side, r] of sides(R['files-queueRaw-wrapper'])) assert.equal(r.files['dispatch-groups.json'], '', `${side}: no pool written`);
    for (const [side, r] of sides(R['files-depFreshness-wrapper'])) assert.equal(r.files['dispatch-groups.json'], null, `${side}: no groups file`);
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
});

describe('#5227 parity (AC4 fetch failures)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  let pool = null;
  before(async () => {
    pool = await runFaultPool(['files'], { d1: false });
    R = pool.R;
  });

  test('AC4.2 [files]: each PASSES failOpen equals the strictest posture observed across that pass\'s fault fixtures (stop if any stops, else open; n/a with no fetch)', (t) => {
    assertFailOpenPostures(pool, 'files', t);
  });

  test('AC4.3 [files]: no files fault row prints a $(cat <err file>) tail line, so each compares both .err files whole', () => {
    // The files share of AC4.3: the F-corrupt and F-groups stops are gh rows, asserted in AC4.3 [gh]
    // (queue-pull-parity-ac4.test.js).
    const tailRows = FILES_FAULTS.filter((f) => faultComparison(R[f.id], 'files').tailErr.length).map((f) => f.id);
    assert.deepEqual(tailRows, []);
  });
});
