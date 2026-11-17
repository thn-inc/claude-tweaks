'use strict';
// #5227 parity (AC7.2 files inputs), D1: the reproduced defect D1 (two pulls in one session per side).
// Split out of queue-pull-parity-ac7.test.js so that neither fault-pool file carries its two sequential
// pulls over the duration ceiling; see queue-pull-helpers.js for the oracle/parity header and the shared
// machinery.
// Pool: runFaultPool([], { d1: true }): D1 alone, no fault rows and no bases.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip } = require('./queue-pull-oracle');
const { OPEN_NUMBERS_ARGV } = require('./queue-pull-fixtures');
const { HIT_MESSAGE, sides, assertClean, registerParityCleanup, assertFaultFiles, runFaultPool } = require('./queue-pull-helpers');

registerParityCleanup();

describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  before(async () => {
    R = (await runFaultPool([], { d1: true })).R;
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
