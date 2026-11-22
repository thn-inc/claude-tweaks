'use strict';
// #5227 parity (AC7.2 files inputs), D1: D1 (three pulls in one session per side, fixed by #5314) and
// EmptyAfterS1 (two pulls). Split out of queue-pull-parity-ac7.test.js so that neither fault-pool file
// carries the sequential pulls over the duration ceiling; see queue-pull-helpers.js for the oracle/parity
// header and the shared machinery.
// Pool: runFaultPool([], { d1: true }): the session jobs D1 and EmptyAfterS1 alone, no fault rows and no bases.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip, reported, assertParity } = require('./queue-pull-oracle');
const {
  FENCE, GROUPING_STOP_RE, AC1_FILES, HIT_MESSAGE, sides, assertClean, stopMapped, registerParityCleanup, runFaultPool,
} = require('./queue-pull-helpers');

registerParityCleanup();

describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  before(async () => {
    R = (await runFaultPool([], { d1: true })).R;
  });

  test('#5314 D1 (AC1.1, AC2.1): a second pull whose open-numbers fetch fails reads no earlier pull\'s eligibility file and stops at group-building; a third pull does not hit the cache on the first pull\'s groups', () => {
    const { first, second, third } = R.D1;
    for (const [label, pair] of [['D1 first', first], ['D1 second', second], ['D1 third', third]]) assertClean(pair, label);
    const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
    const mapped = stopMapped(second.oracle, second.module); // fence exit 1, CLI exit 4
    assertParity(second.oracle, mapped, { files: AC1_FILES });
    for (const [side] of sides(second)) {
      const one = first[side]; const two = second[side]; const three = third[side];
      assert.equal(one.status, 0, side);
      assert.ok(reported(two.stderr).includes(`${head}1${tail}`), `${side}: the group-building stop`);
      assert.equal(two.files['dispatch-open-numbers.json'], '', `${side}: the second open-numbers fetch returned nothing`);
      for (const name of ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json']) {
        assert.notEqual(one.files[name], null, `${side} first: ${name} written`);
        assert.equal(two.files[name], null, `${side}: no ${name} from the first pull`);
      }
      assert.equal(two.files['dispatch-groups.json'], '', `${side}: groups truncated, never the first pull's`);
      assert.deepEqual(two.orderBlob, one.orderBlob, `${side}: no write-back after the stop`);
      // AC2: a third, healthy pull over the second pull's queue misses the cache and groups the new record.
      assert.equal(three.status, 0, `${side} third: ${three.stderr.slice(-2000)}`);
      assert.ok(!three.stderr.includes(HIT_MESSAGE), `${side} third: no cache hit on the first pull's groups`);
      const title9003 = (groups) => groups.flat().find((c) => c.number === 9003).title;
      assert.equal(title9003(JSON.parse(three.files['dispatch-groups.json'])), 'Retitled after the first pull', `${side} third: this pull's record`);
      assert.equal(title9003(three.orderBlob.groups), 'Retitled after the first pull', `${side} third: the blob holds this pull's groups`);
    }
    assertParity(third.oracle, third.module, { files: AC1_FILES });
  });

  test('#5314 (AC1.1, cache hit path): a [] queue after a non-empty pull that persisted a blob never reuses its groups — empty eligible set, exit 0, both sides', () => {
    const { first, second } = R.EmptyAfterS1;
    for (const [label, pair] of [['first', first], ['second', second]]) assertClean(pair, label);
    assertParity(second.oracle, second.module, { files: AC1_FILES });
    for (const [side] of sides(second)) {
      assert.equal(first[side].status, 0, side);
      assert.ok(first[side].orderBlob && first[side].orderBlob.groups.flat().length > 0, `${side}: the first pull persisted non-empty groups`);
      const two = second[side];
      assert.equal(two.status, 0, `${side}: ${two.stderr.slice(-2000)}`);
      assert.ok(!two.stderr.includes(HIT_MESSAGE), `${side}: no cache hit on the earlier pull's groups`);
      assert.deepEqual(JSON.parse(two.files['dispatch-groups.json']), [], `${side}: empty groups`);
      assert.equal(two.files['dispatch-eligible.json'], '[]', `${side}: empty eligible set, nothing from the earlier pull`);
    }
  });
});
