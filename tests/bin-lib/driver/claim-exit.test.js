'use strict';
// The driver's reading of a claim-targets.js exit code: one kind per exit, the documented stop
// reason, and the reason read back.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { CLAIM_KIND, readClaimExit, readClaimReason } = require(
  path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'driver', 'claim-exit'),
);

test('readClaimExit: one kind and one reason per exit code', () => {
  const rows = [
    [0, 'ok', 'claim-exit-0'],
    [1, 'failed', 'claim-exit-1'],
    [2, 'shared-cause', 'claim-exit-2'],
    [3, 'contested', 'claim-exit-3'],
    [4, 'failed', 'claim-exit-4'],
    [5, 'unverified', 'claim-exit-5'],
    [6, 'shared-cause', 'claim-exit-6'],
    [7, 'permission-denied', 'claim-exit-7'],
    [8, 'failed', 'claim-exit-8'],
    [-1, 'failed', 'claim-exit--1'],
  ];
  for (const [code, kind, reason] of rows) {
    assert.deepEqual(readClaimExit(code), { exit: code, kind, reason }, `exit ${code}`);
  }
});

test('readClaimExit: a code that is not an integer is no exit, a claim that may have been written', () => {
  for (const code of [null, undefined, 'x', 1.5, '3', NaN]) {
    assert.deepEqual(readClaimExit(code), { exit: null, kind: 'unverified', reason: 'claim-exit-none' }, String(code));
  }
});

test('CLAIM_KIND is frozen and holds every kind readClaimExit returns', () => {
  assert.ok(Object.isFrozen(CLAIM_KIND));
  assert.deepEqual(Object.values(CLAIM_KIND).sort(), ['contested', 'failed', 'ok', 'permission-denied', 'shared-cause', 'unverified']);
});

test('readClaimReason: reads back every reason readClaimExit writes', () => {
  for (const code of [0, 1, 2, 3, 4, 5, 6, 7, 8, 42, null]) {
    const claim = readClaimExit(code);
    assert.deepEqual(readClaimReason(claim.reason), claim, claim.reason);
  }
});

test('readClaimReason: any other reason is null', () => {
  for (const reason of ['fail', 'failing-test', 'express-error', '', null, undefined, 'claim-exit-', 'claim-exit-03', 'claim-exit--1', 'claim-exit-3 ', 'xclaim-exit-3', 'claim-exit-x']) {
    assert.equal(readClaimReason(reason), null, JSON.stringify(reason));
  }
});
