'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyClaimRaceOutcome } = require('../../../plugin/bin/lib/smoke-test/verify-claim-race');

test('exactly one attempt holds the live claim, bot:in-progress applied once -> pass', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-b'],
    { runId: '2026-09-07T120000-smoke-a' },
    1
  );
  assert.strictEqual(result.pass, true);
  assert.strictEqual(result.winner, '2026-09-07T120000-smoke-a');
});

test('neither attempt holds a live claim -> fail (the race protection has a hole)', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-b'],
    null,
    0
  );
  assert.strictEqual(result.pass, false);
  assert.match(result.reason, /neither attempt holds a live claim/);
});

test('live claim belongs to a run id outside the two attempts -> fail', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-b'],
    { runId: 'some-unrelated-run' },
    1
  );
  assert.strictEqual(result.pass, false);
  assert.match(result.reason, /neither attempting run id/);
});

test('bot:in-progress applied twice (double-apply bug) -> fail even though the claim itself is correct', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-b'],
    { runId: '2026-09-07T120000-smoke-a' },
    2
  );
  assert.strictEqual(result.pass, false);
  assert.match(result.reason, /exactly once/);
  assert.strictEqual(result.winner, '2026-09-07T120000-smoke-a', 'winner is still reported even on the label-count failure, for diagnosis');
});

test('bot:in-progress missing entirely (0) -> fail', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-b'],
    { runId: '2026-09-07T120000-smoke-b' },
    0
  );
  assert.strictEqual(result.pass, false);
});

test('the two attempts must be distinct run ids -- one process racing itself is not a genuine race', () => {
  const result = verifyClaimRaceOutcome(
    ['2026-09-07T120000-smoke-a', '2026-09-07T120000-smoke-a'],
    { runId: '2026-09-07T120000-smoke-a' },
    1
  );
  assert.strictEqual(result.pass, false);
  assert.match(result.reason, /distinct run ids/);
});

test('missing either attempt id is a malformed call, not a race result', () => {
  const result = verifyClaimRaceOutcome(['only-one'], { runId: 'only-one' }, 1);
  assert.strictEqual(result.pass, false);
  assert.match(result.reason, /two distinct attempting run ids/);
});
