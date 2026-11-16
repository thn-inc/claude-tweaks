'use strict';
// #5227 parity (AC4 fetch failures): the gh and files fault rows. Split out of queue-pull.test.js (one
// file per parity describe, each its own process); see queue-pull-helpers.js for the oracle/parity
// header and the shared machinery.
// Pool: the whole fault pool, runFaultPool() with both transports: every gh and files fault row, D1, and
// the matrix bases the rows read (S1-gh-miss, S1-gh-hit, S2-gh-miss, S1-files-miss, S2-files-miss, plus
// the two live-dependency bases). It used to reuse the AC1 matrix's runs of those bases through the
// shared pair memo; in its own process it runs its own copies. AC4.2 and AC4.3 read both families' rows
// (Plan Review Clarifications), so the pool stays whole; if this file is still over the duration
// ceiling, the pool splits by family and those two tests become one per family.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

const { oracleSkip, reported } = require('./queue-pull-oracle');
const { WEAK_PR_FILES, FAULTS, FILES_FAULTS } = require('./queue-pull-fixtures');
const { PASSES } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const {
  HIT_MESSAGE, NATIVE_WARNING_PREFIX, LINKED_WARNING, OPEN_FILTER_WARNING, OPEN_STOP, IN_FLIGHT_POOL_AUTO, POOL, assertEveryJobRan, sides,
  stopMapped, exclusionsIn, groupedIn, registerParityCleanup, faultComparison, STOP_LINE, LANDING_SKIPPED, LANDING_EXITED, CLAIM_READ_FAILED_7001,
  FOREIGN_UNREADABLE, assertFaultRow, runFaultPool,
} = require('./queue-pull-helpers');

registerParityCleanup();

// Per row: `status` the oracle's exit (the CLI's is 4 where it is 1); `base` the un-faulted run it
// is read against (default <transport>-P1); `stderr` / `stdout` the prefixes, in order, of the
// reported lines it adds on that channel, near-duplicate AUTO lines aside (that informational pass
// reports whatever pool reaches it); `entries` its exclusions literally (reason:records), or else
// `drops` / `adds` against the base's.
const FAULT_EXPECT = {
  'F-queue': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-opennum': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-depfresh': { status: 0, stderr: [], drops: [] },
  'F-depview': { status: 0, base: 'gh-livedep', stderr: [], drops: ['blocked:9002'] },
  'F-native': { status: 0, base: 'S2-gh-miss', stderr: [`${NATIVE_WARNING_PREFIX}gh-fault: injected failure`, LANDING_EXITED], drops: ['blocked:9030'] },
  'F-foreign': { status: 0, base: 'S2-gh-miss', stderr: ['Warning: foreign blocker state lookup failed (exit 3: gh-fault: injected failure resolve-foreign-blockers.js: '], drops: [] },
  'F-linked': { status: 0, stderr: [`${LINKED_WARNING}gh-fault: injected failure`], drops: ['open-pr:9005', 'open-pr:9008', 'shipped:9010'] },
  'F-intbranch': {
    status: 0, stderr: [`${LANDING_SKIPPED}no integration branch resolved; no unlanded-blocker exclusions this pull`],
    stdout: [6, 9, 17].map((n) => `- AUTO 12:00:00 — log-decision: dispatch: #90${String(n).padStart(2, '0')} excluded, named target docs/${{ 6: 'gone6', 9: 'gone', 17: 'present' }[n]}.md absent at origin/. Reversibility: n/a.`),
    drops: ['unlanded-blocker:9011'], adds: ['target-missing:9017'],
  },
  'F-prview': { status: 0, stderr: [], drops: [] },
  'F-landing': { status: 0, stderr: [LANDING_EXITED], drops: ['unlanded-blocker:9011'] },
  'F-inflight': { status: 0, stderr: [IN_FLIGHT_POOL_AUTO], drops: ['neighbour-in-flight:9013'] },
  'F-claim': {
    status: 0,
    stderr: ['AUTO — dispatch: shipped-candidate claim read failed for #9010 (network-failure), #9016 (network-failure); release time unknown, no downgrade', CLAIM_READ_FAILED_7001],
    drops: ['neighbour-in-flight:9013'],
  },
  'F-openprs': { status: 0, stderr: [], drops: [] },
  'F-writeback': { status: 0, stderr: ['Queue-order cache write-back failed (non-blocking): Command failed: git -C <SCR>/proj push origin '], drops: [] },
  'F-corrupt': { status: 1, stderr: [OPEN_STOP], entries: '{corrupt' },
  'F-groups': { status: 1, stderr: [OPEN_FILTER_WARNING, STOP_LINE.target], entries: ['blocked:9002', 'oversized:9001+9003+9016', 'not-spec-shaped:9004', 'not-spec-shaped:9007'] },
};
const posture = (r) => (r.status === 0 ? 'open' : 'stop');

describe('#5227 parity (AC4 fetch failures)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  let pool = null;
  before(async () => {
    pool = await runFaultPool();
    R = pool.R;
  });

  test('#5227 fault pool: every job ran (the gh and files fault rows, their bases and D1, in one pool)', (t) => {
    assertEveryJobRan(R);
    t.diagnostic(`fault pool: ${pool.pairs} pairs (${pool.pairs * 2} runs) + D1 (4 runs), pool ${POOL}, wall ${pool.ms} ms`);
  });

  for (const f of FAULTS) {
    test(`AC4.1 [${f.id}]: the module takes the script's path — this fetch's posture, exit category, the same zero or one reported line per channel, exclusions and groups`, () => {
      assert.ok(FAULT_EXPECT[f.id], `${f.id} has an expectation row`);
      assertFaultRow(f, FAULT_EXPECT[f.id], R, 'gh');
    });
  }

  test('AC4.1 detail: each fault\'s own effect, both sides (cache miss, fail-closed foreign state, origin/ targets, unprobed files, no overlap, no blob)', () => {
    // The un-faulted warm control in the same pool: the same scenario on the same miss origin hits,
    // so the miss below is the fault's doing, never a cache that could not hit at all.
    for (const [side, r] of sides(R['S1-gh-hit'])) assert.ok(r.stderr.includes(HIT_MESSAGE), `S1-gh-hit ${side}: the un-faulted warm run hits (control)`);
    for (const [side, r] of sides(R['F-depfresh'])) {
      assert.ok(!r.stderr.includes(HIT_MESSAGE), `F-depfresh ${side}: the failed freshness search turns a warm cache into a miss`);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-gh-miss'].oracle), `F-depfresh ${side}: the recompute reaches the base's groups`);
    }
    for (const [side, r] of sides(R['F-foreign'])) {
      assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9031).detail.blockedBy, [FOREIGN_UNREADABLE], `F-foreign ${side}: fail closed`);
    }
    assert.deepEqual(exclusionsIn(R['S2-gh-miss'].oracle).find((e) => e.records[0] === 9031).detail.blockedBy, ['acme-corp/other#12'], 'the S2 base reads the state (control)');
    for (const [side, r] of sides(R['F-intbranch'])) {
      assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9017).detail, { path: 'docs/present.md' }, `F-intbranch ${side}`);
      assert.ok(r.gitArgv.some((e) => e.tag === 'injected' && e.argv.join(' ') === 'remote show origin'), `F-intbranch ${side}`);
      const proposals = Object.entries(r.staged).filter(([n]) => n.startsWith('dispatch-target-missing-')).map(([, body]) => body);
      assert.equal(proposals.length, 3, `F-intbranch ${side}`);
      assert.ok(proposals.every((body) => body.includes('absent at `origin/`')), `F-intbranch ${side}: every target-missing Close proposal names origin/`);
    }
    for (const [side, r] of sides(R['F-prview'])) assert.equal(r.files['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":[]}\n', `F-prview ${side}: a failed probe reads as no files`);
    assert.equal(R['S1-gh-miss'].oracle.files['dispatch-shipped-pr-files.jsonl'], `{"pr":5016,"files":${JSON.stringify(WEAK_PR_FILES)}}\n`, 'the base probes the files (control)');
    for (const [side, r] of sides(R['F-openprs'])) assert.deepEqual(JSON.parse(r.files['dispatch-crosspr-overlap.json']), [], `F-openprs ${side}`);
    assert.notDeepEqual(JSON.parse(R['S1-gh-miss'].oracle.files['dispatch-crosspr-overlap.json']), [], 'the base reports #9001 against PR #41 (control)');
    for (const [side, r] of sides(R['F-depview'])) assert.ok(groupedIn(r).includes(9002), `F-depview ${side}: #9002 is dispatchable`);
    for (const [side, r] of sides(R['gh-livedep'])) assert.ok(r.ghArgv.some((a) => a.argv.join(' ') === 'issue view 8000 --json state -q .state'), `gh-livedep ${side}: the live check is what holds #9002`);
  });

  test('AC4.2: each PASSES failOpen equals the strictest posture observed across that pass\'s fault fixtures (stop if any stops, else open; n/a with no fetch)', (t) => {
    const strictest = (side) => {
      const out = {};
      for (const rows of [FAULTS, FILES_FAULTS]) {
        for (const row of rows.filter((x) => x.pass !== '(stop)')) {
          const p = posture(R[row.id][side]);
          out[row.pass] = out[row.pass] === 'stop' || p === 'stop' ? 'stop' : 'open';
        }
      }
      return out;
    };
    const observed = strictest('oracle');
    assert.deepEqual(strictest('module'), observed, 'the module\'s exits give the same postures');
    for (const id of Object.keys(observed)) assert.ok(PASSES.some((p) => p.id === id), `fault rows name a registry id: ${id}`);
    for (const p of PASSES) assert.equal(p.failOpen, observed[p.id] || 'n/a', `${p.id} (${p.reason || p.kind})`);
    // PF6: neighbour-in-flight is open on gh and stop on files; the stricter value wins.
    assert.equal(posture(R['F-inflight'].oracle), 'open');
    assert.equal(posture(R['files-inFlightRaw-missing'].oracle), 'stop');
    t.diagnostic(`postures: ${JSON.stringify(observed)}`);
  });

  test('AC4.3: F-corrupt and F-groups stop the pull on both sides (oracle exit 1, CLI exit 4)', () => {
    for (const id of ['F-corrupt', 'F-groups']) {
      const { oracle, module } = R[id];
      stopMapped(oracle, module);
      for (const [side, r] of sides(R[id])) assert.ok(reported(r.stderr).at(-1).startsWith('dispatch: queue-pull stopped -- '), `${id} ${side}: the stop line is the last reported line`);
    }
    for (const [side, r] of sides(R['F-groups'])) assert.equal(r.files['dispatch-groups.json'], '{corrupt', `F-groups ${side}: the unreadable groups file is left as it was`);
    // These two rows are the fault rows that print a `$(cat <err file>)` line; every other row
    // compares both .err files whole.
    const tailRows = [...FAULTS, ...FILES_FAULTS].filter((f) => faultComparison(R[f.id], FAULTS.includes(f) ? 'gh' : 'files').tailErr.length).map((f) => f.id);
    assert.deepEqual(tailRows, ['F-corrupt', 'F-groups']);
    for (const id of tailRows) assert.deepEqual(faultComparison(R[id], 'gh').tailErr, ['dispatch-linked-prs.err'], id);
  });

  test('AC4.4: the oracle stops on exactly the observed stop set, and every other fault exits 0', () => {
    const STOP_SET = ['F-corrupt', 'F-groups', 'F-opennum', 'F-queue'];
    assert.deepEqual(FAULTS.filter((f) => R[f.id].oracle.status !== 0).map((f) => f.id).sort(), STOP_SET, 'the oracle');
    assert.deepEqual(FAULTS.filter((f) => R[f.id].module.status !== 0).map((f) => f.id).sort(), STOP_SET, 'the module');
    for (const f of FAULTS) {
      const want = STOP_SET.includes(f.id) ? [1, 4] : [0, 0];
      assert.deepEqual([R[f.id].oracle.status, R[f.id].module.status], want, f.id);
    }
  });

  test('AC4.5: F-writeback exits 0 on both sides with the non-blocking write-back line', () => {
    assert.ok(R['S1-gh-miss'].oracle.orderBlob, 'the base persists the blob (control)');
    for (const [side, r] of sides(R['F-writeback'])) {
      assert.equal(r.status, 0, `${side}: ${r.stderr.slice(-2000)}`);
      assert.equal(reported(r.stderr).filter((l) => l.startsWith('Queue-order cache write-back failed (non-blocking): ')).length, 1, side);
      assert.equal(r.orderBlob, null, `${side}: the push failed, so origin holds no blob`);
      assert.ok(r.gitArgv.some((e) => e.tag === 'injected' && e.argv.includes('push')), side);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-gh-miss'].oracle), `${side}: the pull went on to the base's groups`);
    }
  });

  test('AC4.6 parity: after F-corrupt the CLI exits 4, the exclusions file is byte-identical to the oracle\'s, and no later pass wrote its file', () => {
    const { oracle, module } = R['F-corrupt'];
    assert.equal(module.status, 4);
    assert.equal(module.files['dispatch-exclusions.json'], oracle.files['dispatch-exclusions.json']);
    assert.equal(oracle.files['dispatch-exclusions.json'], '{corrupt');
    const LATER = ['dispatch-named-targets.json', 'dispatch-shipped-probe-prs.json', 'dispatch-shipped-pr-files.jsonl', 'dispatch-shipped-releases.json',
      'dispatch-in-flight-raw.json', 'dispatch-open-prs.json', 'dispatch-crosspr-overlap.json', 'dispatch-near-dup-pairs.json'];
    for (const [side, r] of sides(R['F-corrupt'])) {
      for (const name of LATER) assert.equal(r.files[name], null, `${side}: ${name} (a pass after open-pr)`);
      assert.deepEqual(r.staged, {}, `${side}: no Close proposal staged`);
      assert.equal(r.decisions, '', `${side}: no decision logged`);
    }
    for (const name of LATER) assert.notEqual(R['S1-gh-miss'].oracle.files[name], null, `the base writes ${name} (control)`);
  });
});
