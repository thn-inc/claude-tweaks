'use strict';
// #5227 parity (AC4 fetch failures), gh family: the gh fault rows. Split out of queue-pull.test.js (one
// file per parity describe, each its own process); see queue-pull-helpers.js for the oracle/parity
// header and the shared machinery.
// Pool: runFaultPool(['gh'], { d1: false }): the gh fault rows and the bases they read (S1-gh-miss,
// S1-gh-hit, S2-gh-miss, gh-livedep). The files fault rows run in queue-pull-parity-ac7.test.js and D1 in
// queue-pull-parity-d1.test.js, so that no file is over the duration ceiling. AC4.2 and AC4.3 read both
// families, so each is one test per family (Plan Review Clarifications): AC4.2 [gh] reads the files
// rows' exits from FILES_EXPECT (postureView), which queue-pull-parity-ac7's AC7.2 rows pin to the
// files runs; AC4.3 [gh] checks the gh rows' share of the tail-row set.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  oracleSkip, reported, createSandbox, runOracle, runModuleCli, shQuote,
} = require('./queue-pull-oracle');
const { WEAK_PR_FILES, FAULTS } = require('./queue-pull-fixtures');
const {
  FENCE, HIT_MESSAGE, POOL, PARITY_S1, assertEveryJobRan, sides, assertClean, stopMapped, exclusionsIn, groupedIn, registerParityCleanup, faultComparison,
  assertFaultFiles, FOREIGN_UNREADABLE, assertFaultRow, runFaultPool, FAULT_EXPECT, assertFailOpenPostures,
} = require('./queue-pull-helpers');

const VERIFIED_UNREADABLE = 'Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run';
const sortEntries = (entries) => entries.map((e) => JSON.stringify(e)).sort();

registerParityCleanup();

describe('#5227 parity (AC4 fetch failures)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  let pool = null;
  before(async () => {
    pool = await runFaultPool(['gh'], { d1: false });
    R = pool.R;
  });

  // Since the fault pool split, this file's pool holds the gh fault rows and their bases only (no files
  // rows, no D1: see the header); the name is kept as it was.
  test('#5227 fault pool: every job ran (the gh and files fault rows, their bases and D1, in one pool)', (t) => {
    assertEveryJobRan(R);
    t.diagnostic(`fault pool: ${pool.pairs} pairs (${pool.pairs * 2} runs), the gh rows and their bases, pool ${POOL}, wall ${pool.ms} ms`);
  });

  for (const f of FAULTS) {
    test(`AC4.1 [${f.id}]: the module takes the script's path — this fetch's posture, exit category, the same zero or one reported line per channel, exclusions and groups`, () => {
      assert.ok(FAULT_EXPECT[f.id], `${f.id} has an expectation row`);
      assertFaultRow(f, FAULT_EXPECT[f.id], R, 'gh');
    });
  }

  test('AC4.1 detail: each fault\'s own effect, both sides (cache miss, fail-closed foreign state, skipped target-missing pass, unprobed files, no overlap, no blob)', () => {
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
      assert.ok(!exclusionsIn(r).some((e) => e.reason === 'target-missing'), `F-intbranch ${side}: no named target is excluded as absent`);
      assert.ok(r.gitArgv.some((e) => e.tag === 'injected' && e.argv.join(' ') === 'remote show origin'), `F-intbranch ${side}`);
      assert.ok(!r.gitArgv.some((e) => e.argv[0] === 'cat-file'), `F-intbranch ${side}: no git cat-file probe runs against origin/`);
      const proposals = Object.entries(r.staged).filter(([n]) => n.startsWith('dispatch-target-missing-')).map(([, body]) => body);
      assert.equal(proposals.length, 0, `F-intbranch ${side}: no target-missing Close proposal is staged`);
    }
    for (const [side, r] of sides(R['F-headunknown'])) {
      assert.ok(r.gitArgv.some((e) => e.tag === 'delegated' && e.argv.join(' ') === 'remote show origin'), `F-headunknown ${side}: the branch is read from the live remote`);
      assert.ok(!exclusionsIn(r).some((e) => e.reason === 'target-missing'), `F-headunknown ${side}: no named target is excluded as absent`);
      assert.ok(!r.gitArgv.some((e) => e.argv[0] === 'cat-file'), `F-headunknown ${side}: no git cat-file probe runs against origin/(unknown)`);
      const proposals = Object.entries(r.staged).filter(([n]) => n.startsWith('dispatch-target-missing-')).map(([, body]) => body);
      assert.equal(proposals.length, 0, `F-headunknown ${side}: no target-missing Close proposal is staged`);
    }
    for (const [side, r] of sides(R['F-prview'])) assert.equal(r.files['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":null}\n', `F-prview ${side}: a failed probe reads as files:null`);
    assert.equal(R['S1-gh-miss'].oracle.files['dispatch-shipped-pr-files.jsonl'], `{"pr":5016,"files":${JSON.stringify(WEAK_PR_FILES)}}\n`, 'the base probes the files (control)');
    for (const [side, r] of sides(R['F-openprs'])) assert.deepEqual(JSON.parse(r.files['dispatch-crosspr-overlap.json']), [], `F-openprs ${side}`);
    assert.notDeepEqual(JSON.parse(R['S1-gh-miss'].oracle.files['dispatch-crosspr-overlap.json']), [], 'the base reports #9001 against PR #41 (control)');
    for (const [side, r] of sides(R['F-depview'])) assert.ok(!groupedIn(r).includes(9002), `F-depview ${side}: #9002 is held (fail closed)`);
    for (const [side, r] of sides(R['gh-livedep'])) assert.ok(r.ghArgv.some((a) => a.argv.join(' ') === 'issue view 8000 --json state -q .state'), `gh-livedep ${side}: the live check is what holds #9002`);
  });

  test('AC4.2 [gh]: each PASSES failOpen equals the strictest posture observed across that pass\'s fault fixtures (stop if any stops, else open; n/a with no fetch)', (t) => {
    assertFailOpenPostures(pool, 'gh', t);
  });

  test('AC4.3 [gh]: F-corrupt and F-groups stop the pull on both sides (oracle exit 1, CLI exit 4)', () => {
    for (const id of ['F-corrupt', 'F-groups']) {
      const { oracle, module } = R[id];
      stopMapped(oracle, module);
      for (const [side, r] of sides(R[id])) assert.ok(reported(r.stderr).at(-1).startsWith('dispatch: queue-pull stopped -- '), `${id} ${side}: the stop line is the last reported line`);
    }
    for (const [side, r] of sides(R['F-groups'])) assert.equal(r.files['dispatch-groups.json'], '{corrupt', `F-groups ${side}: the unreadable groups file is left as it was`);
    // These two rows are the fault rows that print a `$(cat <err file>)` line; every other row
    // compares both .err files whole (the files rows: AC4.3 [files], queue-pull-parity-ac7.test.js).
    const tailRows = FAULTS.filter((f) => faultComparison(R[f.id], 'gh').tailErr.length).map((f) => f.id);
    assert.deepEqual(tailRows, ['F-corrupt', 'F-groups']);
    for (const id of tailRows) assert.deepEqual(faultComparison(R[id], 'gh').tailErr, ['dispatch-linked-prs.err'], id);
  });

  test('AC4.4: the oracle stops on exactly the observed stop set, and every other fault exits 0', () => {
    const STOP_SET = ['F-claim-neighbour-stop', 'F-claim-stop', 'F-corrupt', 'F-groups', 'F-opennum', 'F-queue'];
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

  test('AC4.7 (#5879, spec AC2): the fence and the module leave no verified-open-deps file when the unresolved-deps read fails, and give the same blocked verdict', async () => {
    // A one-off failure of the verified-open-deps step's read of dispatch-unresolved-deps.json, the blocked
    // pass's later read getting through. Fence: the PATH node fails the loop's `node -e` over that file once.
    // Module: a --require preload fails the first readFileSync of it once. A marker file per sandbox makes it once.
    const made = [];
    try {
      made.push(createSandbox(PARITY_S1(), { name: 'unresolved-read-once' }));
      made.push(createSandbox(PARITY_S1(), { name: 'unresolved-read-once' }));
      const [oracleSb, moduleSb] = made;
      const marker = (sb) => path.join(sb.root, 'unresolved-read-failed');
      const inner = path.join(oracleSb.root, 'shim', 'node-inner');
      fs.renameSync(path.join(oracleSb.bin, 'node'), inner);
      fs.writeFileSync(path.join(oracleSb.bin, 'node'), [
        '#!/bin/sh',
        `if [ "$1" = -e ] && [ "$2" = "console.log(require(process.argv[1]).join(' '))" ] && [ ! -e ${shQuote(marker(oracleSb))} ]; then`,
        `  case "$4" in */dispatch-unresolved-deps.json) : > ${shQuote(marker(oracleSb))}; echo 'node: injected read failure' >&2; exit 1 ;; esac`,
        'fi',
        `exec ${shQuote(inner)} "$@"`,
        '',
      ].join('\n'), { mode: 0o755 });
      const preload = path.join(moduleSb.root, 'unresolved-read-once.js');
      fs.writeFileSync(preload, [
        "'use strict';",
        "const fs = require('fs');",
        `const marker = ${JSON.stringify(marker(moduleSb))};`,
        'const realRead = fs.readFileSync;',
        'fs.readFileSync = function readUnresolvedOnce(file, ...rest) {',
        "  if (String(file).endsWith('dispatch-unresolved-deps.json') && !fs.existsSync(marker)) {",
        "    fs.writeFileSync(marker, '');",
        "    throw Object.assign(new Error('EACCES: permission denied, open dispatch-unresolved-deps.json'), { code: 'EACCES' });",
        '  }',
        '  return realRead.call(this, file, ...rest);',
        '};',
        '',
      ].join('\n'));
      const runEnv = moduleSb.runEnv;
      moduleSb.runEnv = (o) => {
        const env = runEnv(o);
        return { ...env, NODE_OPTIONS: [env.NODE_OPTIONS, `--require ${JSON.stringify(preload)}`].filter(Boolean).join(' ') };
      };
      const [oracle, module] = await Promise.all([runOracle(oracleSb, FENCE), runModuleCli(moduleSb, ['--transport', 'gh'])]);
      const pair = { oracle, module };
      assertClean(pair, 'unresolved-read-once');
      for (const [side, sb] of [['oracle', oracleSb], ['module', moduleSb]]) assert.ok(fs.existsSync(marker(sb)), `${side}: the injected read failure fired`);
      assert.ok(module.stderr.includes('queue-pull: verified-open-deps: EACCES'), module.stderr);
      const base = R['S1-gh-miss'];
      assert.ok(base.oracle.orderBlob, 'the base persists the blob (control)');
      const want = [...exclusionsIn(base.oracle).filter((e) => !(e.reason === 'unlanded-blocker' && e.records[0] === 9011)), { reason: 'blocked', records: [9011], detail: { blockedBy: [8001] } }];
      for (const [side, r] of sides(pair)) {
        assert.equal(r.status, 0, `${side}: ${r.stderr.slice(-2000)}`);
        assert.equal(r.files['dispatch-verified-open-deps.txt'], null, `${side}: no verified-open-deps file`);
        assert.deepEqual(reported(r.stderr).filter((l) => l.startsWith('Warning: ')), [VERIFIED_UNREADABLE], side);
        assert.deepEqual(sortEntries(exclusionsIn(r)), sortEntries(want), `${side}: #9011 held as blocked, nothing else changed`);
        assert.ok(!r.ghArgv.some((a) => a.argv[0] === 'issue' && a.argv[1] === 'view'), `${side}: no dependency is viewed`);
        assert.equal(r.orderBlob, null, `${side}: a fail-closed verdict writes no order blob back`);
      }
      assertFaultFiles(pair, 'gh', 'unresolved-read-once');
    } finally {
      for (const sb of made) sb.cleanup();
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
