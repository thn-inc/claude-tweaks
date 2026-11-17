'use strict';
// #5227 parity (AC5, portability): empty and malformed queues and the portability scenario. Split out of
// queue-pull.test.js (one file per parity describe, each its own process); see queue-pull-helpers.js for
// the oracle/parity header and the shared machinery.
// Pool: this file runs its own six EXTRA pairs (POOL wide) and nothing else.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip, reported, assertParity, runAll } = require('./queue-pull-oracle');
const { SEmpty, SMalformed, SPortable, LANDING_COMMIT, PORTABLE_SLUG } = require('./queue-pull-fixtures');
const {
  FENCE, GROUPING_STOP_RE, POOL, AC1_FILES, pairJobs, assertEveryJobRan, sides, assertClean, stopMapped, exclusionsIn, groupedIn, ghCall,
  registerParityCleanup,
} = require('./queue-pull-helpers');

registerParityCleanup();

describe('#5227 parity (AC5, portability)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  const EXTRA = [
    { name: 'SEmpty-gh-miss', scenario: SEmpty() },
    { name: 'SMalformed-gh-miss', scenario: SMalformed() },
    { name: 'SMalformed-labels', scenario: SMalformed('labels') },
    { name: 'SMalformed-body', scenario: SMalformed('body') },
    { name: 'SMalformed-blocker', scenario: SMalformed('blocker') },
    { name: 'SPortable-gh-miss', scenario: SPortable() },
  ];
  let R = {};
  const timing = {};
  before(async () => {
    const t0 = Date.now();
    R = await runAll(pairJobs(EXTRA), POOL);
    timing.ms = Date.now() - t0;
  });

  test('#5227 parity (AC5, portability): every pair in the pool ran', () => assertEveryJobRan(R));

  test('AC5.1: an empty queue yields the same files as the script', (t) => {
    const pair = R['SEmpty-gh-miss'];
    assertClean(pair, 'SEmpty');
    assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
    assertParity(pair.oracle, pair.module);
    for (const [side, r] of sides(pair)) {
      assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']), [], side);
      assert.deepEqual(exclusionsIn(r), [], side);
    }
    t.diagnostic(`AC5/portability: ${EXTRA.length} pairs (${EXTRA.length * 2} runs), pool ${POOL}, wall ${timing.ms} ms`);
  });

  test('AC5.2: non-array labels, a non-string body and an invalid Blocked-by number are handled as the script handles them, and #9001\'s verdict matches the oracle\'s', () => {
    const verdict = (r) => ({
      grouped: r.files['dispatch-groups.json'] ? groupedIn(r).includes(9001) : null,
      reasons: r.files['dispatch-exclusions.json'] ? exclusionsIn(r).filter((e) => e.records.includes(9001)).map((e) => e.reason) : null,
    });
    // Non-array labels: the script stops the whole pull at the group-building check (header).
    for (const name of ['SMalformed-gh-miss', 'SMalformed-labels']) {
      const pair = R[name];
      assertClean(pair, name);
      assertParity(pair.oracle, stopMapped(pair.oracle, pair.module), { files: AC1_FILES });
      for (const [side, r] of sides(pair)) {
        assert.deepEqual(reported(r.stderr), [`${GROUPING_STOP_RE.exec(FENCE)[1]}1${GROUPING_STOP_RE.exec(FENCE)[2]}`], `${name} ${side}`);
        assert.equal(r.files['dispatch-groups.json'], '', `${name} ${side}: the grouping redirect truncated the groups file`);
      }
      assert.deepEqual(verdict(pair.module), verdict(pair.oracle), `${name}: #9001's verdict`);
    }
    // A non-string body: not-spec-shaped. An invalid Blocked-by number: malformed-blocker.
    const expected = {
      'SMalformed-body': { reason: 'not-spec-shaped', records: [9021], detail: { missing: ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'] } },
      'SMalformed-blocker': { reason: 'malformed-blocker', records: [9022], detail: { cause: 'a Blocked by line names no valid issue number (#99999999999)' } },
    };
    for (const [name, entry] of Object.entries(expected)) {
      const pair = R[name];
      assertClean(pair, name);
      assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
      assertParity(pair.oracle, pair.module, { files: AC1_FILES });
      for (const [side, r] of sides(pair)) {
        assert.deepEqual(exclusionsIn(r), [entry], `${name} ${side}`);
        assert.deepEqual(groupedIn(r), [9001], `${name} ${side}: the clean record is dispatchable`);
      }
      assert.deepEqual(verdict(pair.module), verdict(pair.oracle), `${name}: #9001's verdict`);
      assert.deepEqual(verdict(pair.oracle), { grouped: true, reasons: [] });
    }
  });

  test('#5227 portability: release/next and acme-corp/widgets reach git cat-file, --integration-branch and the GraphQL owner/repo on both sides', () => {
    const pair = R['SPortable-gh-miss'];
    assertClean(pair, 'SPortable');
    assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
    assertParity(pair.oracle, pair.module, { files: AC1_FILES });
    const [owner, repo] = PORTABLE_SLUG.split('/');
    for (const [side, r] of sides(pair)) {
      const catFiles = r.gitArgv.map((e) => e.argv).filter((a) => a.includes('cat-file')).map((a) => a.slice(a.indexOf('cat-file')).join(' ')).sort();
      assert.deepEqual(catFiles, ['cat-file -e origin/release/next:docs/gone.md', 'cat-file -e origin/release/next:docs/kept.md'], side);
      assert.ok(!r.gitArgv.some((e) => e.argv.join(' ').includes('remote show origin')), `${side}: the policy key wins, origin's HEAD (trunk) is never asked`);
      for (const pattern of [/CLOSED_EVENT/, /CROSS_REFERENCED_EVENT/]) {
        const [call] = ghCall(r, pattern);
        assert.ok(call && call.includes(`owner=${owner}`) && call.includes(`repo=${repo}`), `${side}: ${pattern} names ${PORTABLE_SLUG}`);
      }
      assert.ok(r.ghArgv.some((a) => a.argv[1] === `repos/${PORTABLE_SLUG}/compare/release/next...${LANDING_COMMIT}`), `${side}: --integration-branch release/next reached the compare`);
      assert.deepEqual(exclusionsIn(r).map((e) => [e.reason, e.records[0]]), [['target-missing', 9041], ['unlanded-blocker', 9042]], side);
      assert.deepEqual(groupedIn(r), [9040], `${side}: docs/kept.md is present at origin/release/next`);
      assert.ok(r.stderr.includes(`blocker #8001 closed but its closing commit ${LANDING_COMMIT} is not on origin/release/next`), side);
    }
  });
});
