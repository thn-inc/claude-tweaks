'use strict';
// #5227 parity (AC1): the matrix. Split out of queue-pull.test.js (one file per parity describe, each
// its own process); see queue-pull-helpers.js for the oracle/parity header and the shared machinery.
// Pool: this file runs its own seven MATRIX pairs (POOL wide) and nothing else. The AC4 and AC7.2 files no
// longer reuse these runs through a shared pair memo; each runs the bases it reads itself.
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO, RUN_DIR_NAME, oracleSkip, normalize, assertParity, runAll } = require('./queue-pull-oracle');
const { fakeSpawnCli } = require('./queue-pull-fixtures');
const { PASSES } = require('../../../plugin/bin/lib/dispatch/queue-pull');
const {
  HIT_MESSAGE, cannedLanding, POOL, PARITY_S1, MATRIX, AC1_FILES, pairJobs, assertEveryJobRan, sides, assertClean, exclusionsIn, groupedIn, ghCall,
  registerParityCleanup,
} = require('./queue-pull-helpers');

registerParityCleanup();

describe('#5227 parity (AC1)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  const timing = {};
  before(async () => {
    const t0 = Date.now();
    R = await runAll(pairJobs(MATRIX), POOL);
    timing.ms = Date.now() - t0;
  });

  test('#5227 parity (AC1): every pair in the matrix pool ran', () => assertEveryJobRan(R));

  for (const cfg of MATRIX) {
    test(`AC1.1 [${cfg.name}]: groups, exclusions and every other output equal the script's`, () => {
      const pair = R[cfg.name];
      assertClean(pair, cfg.name);
      assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
      assert.deepEqual([...new Set(exclusionsIn(pair.oracle).map((e) => e.reason))].sort(), cfg.reasons, 'the reasons this config exercises');
      for (const [side, r] of sides(pair)) assert.equal(r.stderr.includes(HIT_MESSAGE), Boolean(cfg.after), `${side}: a hit config hits and a miss config misses`);
      assertParity(pair.oracle, pair.module, { files: AC1_FILES });
    });
  }

  test('AC1.2: normalize substitutes only the sandbox root and the run id; the staged target-missing ids are byte-equal on both sides', (t) => {
    for (const cfg of MATRIX) {
      const { oracle, module } = R[cfg.name];
      assert.deepEqual(Object.keys(module.staged), Object.keys(oracle.staged), `${cfg.name}: the staged names, before any normalization`);
    }
    for (const name of ['S1-gh-miss', 'S1-files-miss']) {
      const names = Object.keys(R[name].oracle.staged);
      assert.ok(names.includes('dispatch-target-missing-9009.md'), `${name}: the target-missing item is staged as .md: ${names}`);
    }
    assert.ok(Object.keys(R['S1-gh-miss'].oracle.staged).includes('shipped-close-9010.md'));
    const sb = R['S1-gh-miss'].oracle.sandbox;
    const sample = `${sb.root}/proj/.claude-tweaks/pipelines/${RUN_DIR_NAME}/staged x 2026-11-12T12:00:00.000Z ${sb.root}-not`;
    assert.equal(normalize(sample, sb), '<SCR>/proj/.claude-tweaks/pipelines/<RUN>/staged x 2026-11-12T12:00:00.000Z <SCR>-not',
      'the clock is left as it is');
    for (const [side, r] of sides(R['S1-gh-miss'])) assert.equal(r.orderBlob.computedAt, '2026-11-12T12:00:00.000Z', `${side}: the frozen clock, not a normalization`);
    t.diagnostic(`AC1 matrix: ${MATRIX.length} pairs (${MATRIX.length * 2} runs), pool ${POOL}, wall ${timing.ms} ms`);
  });

  test('AC1.1 go-red: assertParity throws when the module result drops one exclusion entry', () => {
    const { oracle, module } = R['S1-gh-miss'];
    assertParity(oracle, module, { files: AC1_FILES });
    const entries = exclusionsIn(module);
    for (const at of [0, entries.length - 1]) {
      const dropped = Object.defineProperty({ ...module, files: { ...module.files, 'dispatch-exclusions.json': JSON.stringify(entries.filter((_, i) => i !== at)) } }, 'sandbox', { value: module.sandbox });
      assert.throws(() => assertParity(oracle, dropped, { files: AC1_FILES }), assert.AssertionError, `dropping entry ${at}`);
    }
  });

  test('AC2.3: removing reasons are absent from dispatch-groups.json while oversized and neighbour-in-flight are present, both sides', () => {
    const removing = PASSES.filter((p) => p.kind === 'exclusion' && p.removes).map((p) => p.reason);
    const staying = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && !p.removes).map((p) => p.reason))].sort();
    assert.deepEqual(staying, ['driver-lane', 'neighbour-in-flight', 'oversized']);
    for (const cfg of MATRIX.filter((c) => c.name.startsWith('S1-'))) {
      for (const [side, r] of sides(R[cfg.name])) {
        const grouped = groupedIn(r);
        const entries = exclusionsIn(r);
        for (const e of entries.filter((x) => removing.includes(x.reason))) {
          for (const n of e.records) assert.ok(!grouped.includes(n), `${cfg.name} ${side}: ${e.reason} #${n} left the groups`);
        }
        // driver-lane (#6119) writes only under express-driver-runner: script; these runs leave it unset (queue-pull.test.js covers the pass).
        for (const reason of staying.filter((x) => x !== 'driver-lane')) {
          const named = entries.filter((e) => e.reason === reason).flatMap((e) => e.records);
          assert.ok(named.length > 0, `${cfg.name} ${side}: a ${reason} entry`);
          for (const n of named) assert.ok(grouped.includes(n), `${cfg.name} ${side}: ${reason} #${n} stays in the groups`);
        }
      }
    }
  });

  test('AC3.1 parity: #9004/#9005/#9006 carry one reason each and the linked-PR GraphQL names no #9004 alias, both sides', () => {
    for (const cfg of MATRIX.filter((c) => c.name.startsWith('S1-'))) {
      for (const [side, r] of sides(R[cfg.name])) {
        const reasonsOf = (n) => exclusionsIn(r).filter((e) => e.records.includes(n)).map((e) => e.reason);
        const label = `${cfg.name} ${side}`;
        assert.deepEqual(reasonsOf(9004), ['not-spec-shaped'], label);
        assert.deepEqual(reasonsOf(9006), ['target-missing'], label);
        if (cfg.transport === 'files') {
          assert.deepEqual(reasonsOf(9005), [], `${label}: no open-PR exclusion on files (the linked-PR query fails open)`);
          continue;
        }
        assert.deepEqual(reasonsOf(9005), ['open-pr'], label);
        const linked = ghCall(r, /CROSS_REFERENCED_EVENT/);
        assert.equal(linked.length, 1, `${label}: one linked-PR query`);
        const query = linked[0].join(' ');
        assert.ok(!/\bi9004\s*:/.test(query), `${label}: the not-spec-shaped #9004 is never queried`);
        assert.ok(/\bi9005\s*:/.test(query) && /\bi9006\s*:/.test(query), `${label}: #9005 and #9006 are (control)`);
        assert.deepEqual(r.ghArgv.filter((a) => a.argv[0] === 'pr' && a.argv[1] === 'view').map((a) => a.argv[2]), ['5016'],
          `${label}: only #9016's weak mention is probed, never an excluded candidate's`);
      }
    }
  });

  test('AC7.1: the files transport writes dispatch-crosspr-overlap.json as [] and dispatch-linked-prs.json as {}, both sides', () => {
    for (const cfg of MATRIX.filter((c) => c.transport === 'files')) {
      for (const [side, r] of sides(R[cfg.name])) {
        const label = `${cfg.name} ${side}`;
        // JSON-equal, AC1's "identical": the oracle's agent writes `echo '[]'` (a newline), the module '[]'.
        assert.deepEqual(JSON.parse(r.files['dispatch-crosspr-overlap.json']), [], label);
        assert.deepEqual(JSON.parse(r.files['dispatch-linked-prs.json']), {}, label);
        assert.deepEqual(r.ghArgv, [], `${label}: zero gh calls`);
        // Claims come from the agent's map (claimReaderFromMap), never a claims-registry read: the
        // sandbox registry would give the same live answer, so only the read itself tells them apart.
        assert.deepEqual(r.gitArgv.filter((e) => e.argv.some((x) => x.startsWith('claims-registry:'))), [], `${label}: no claims-registry read`);
        const PATH = r.sandbox.runEnv({ tmpdir: r.sandbox.root, sessionId: 'unused' }).PATH;
        for (const dir of PATH.split(path.delimiter)) assert.equal(fs.existsSync(path.join(dir, 'gh')), false, `${label}: no gh in ${dir}`);
      }
    }
    // The gh configs are the control: the same passes do call gh there.
    assert.ok(R['S1-gh-miss'].module.ghArgv.length > 0 && R['S1-gh-miss'].oracle.ghArgv.length > 0);
  });

  test('#5227 real-writer: fakeSpawnCli and the canned landing CLI print what the real CLIs printed for the exact inputs S1-gh-miss gave them', () => {
    const { oracle } = R['S1-gh-miss'];
    const cliCalls = (name) => oracle.cliCalls.filter((c) => path.basename(c.argv[0]) === name);
    // resolve-linked-prs.js: the numbers the real CLI queried, in its alias order.
    const [linked] = ghCall(oracle, /CROSS_REFERENCED_EVENT/);
    const numbers = [...linked.join(' ').matchAll(/\bi(\d+)\s*:\s*issue\(/g)].map((m) => m[1]);
    assert.ok(numbers.length > 5, numbers.join());
    assert.equal(fakeSpawnCli(PARITY_S1())('resolve-linked-prs.js', [numbers.join(',')]).stdout, oracle.files['dispatch-linked-prs.json']);

    // dispatch-unlanded-blockers.js: the fence's one call, its argv and its --groups / --exclusions
    // files as they stood when it ran (bin/node logs them). Nothing after it rewrites
    // dispatch-groups.json, so the oracle's final file is the real CLI's stdout; only the neighbour
    // pass appends after it, so the final exclusions without its entries are what the real CLI left.
    const [landing, ...more] = cliCalls('dispatch-unlanded-blockers.js');
    assert.equal(more.length, 0, 'one landing call');
    assert.deepEqual(landing.argv.slice(5), ['--integration-branch', 'main', '--work-links', 'body-text']);
    const preLanding = JSON.parse(landing.groups).flat().map((c) => c.number);
    assert.ok(preLanding.includes(9011) && preLanding.includes(9012), `the real pre-landing pool holds both records the CLI removes: ${preLanding}`);
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-writer-'));
    try {
      const groupsFile = path.join(own, 'groups.json');
      const exclusionsFile = path.join(own, 'exclusions.json');
      fs.writeFileSync(groupsFile, landing.groups);
      fs.writeFileSync(exclusionsFile, landing.exclusions);
      const out = cannedLanding([])(['--groups', groupsFile, '--exclusions', exclusionsFile, ...landing.argv.slice(5)]);
      assert.equal(out.stdout, oracle.files['dispatch-groups.json'], "the canned stdout is the real CLI's for that input");
      assert.deepEqual(JSON.parse(fs.readFileSync(exclusionsFile, 'utf8')), exclusionsIn(oracle).filter((e) => e.reason !== 'neighbour-in-flight'),
        "the canned appends are the real CLI's");
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }

    // resolve-policy.js: every argv the fence passed, through the real CLI in the same sandbox (its
    // policy.yml is the fixture's), prints what fakeSpawnCli answers for the fixture's policy.
    const policyArgs = [...new Set(cliCalls('resolve-policy.js').map((c) => JSON.stringify(c.argv.slice(1))))].map((a) => JSON.parse(a));
    assert.deepEqual(policyArgs.map((a) => a[1]).sort(), ['dispatch-fastlane-bundle-cap', 'dispatch-group-size-guard', 'integration-branch', 'work-links'],
      'the keys the fence reads, set (work-links, the size guard) and unset (the bundle cap, the integration branch)');
    const sb = oracle.sandbox;
    const tmpdir = path.join(sb.root, 'tmp', 'policy-pin');
    fs.mkdirSync(tmpdir, { recursive: true });
    for (const args of policyArgs) {
      const real = spawnSync(process.execPath, [path.join(REPO, 'plugin', 'bin', 'resolve-policy.js'), ...args],
        { cwd: sb.proj, env: sb.runEnv({ tmpdir, sessionId: 'qp-policy-pin' }), encoding: 'utf8' });
      assert.equal(real.status, 0, real.stderr);
      const fake = fakeSpawnCli(PARITY_S1())('resolve-policy.js', args);
      assert.deepEqual({ stdout: fake.stdout, stderr: fake.stderr }, { stdout: real.stdout, stderr: real.stderr }, args.join(' '));
    }
  });

  test('#5227 cwd/env: on the module side the foreign-blocker lookup and the claim-registry reads reach the sandbox shims, and every git call runs inside the sandbox', () => {
    const s2 = R['S2-gh-miss'].module;
    assert.ok(s2.ghArgv.some((a) => a.tag === 'ok' && a.argv.some((x) => /\bc0\s*:\s*repository\(/.test(x)) && a.argv.includes('o0=acme-corp')),
      'resolve-foreign-blockers.js asked the gh shim for acme-corp/other#12');
    const s1 = R['S1-gh-miss'].module;
    assert.ok(s1.ghArgv.some((a) => a.tag === 'ok' && a.argv.join(' ') === 'repo view --json nameWithOwner -q .nameWithOwner'), "the claim reader's slug lookup reached the gh shim");
    assert.ok(s1.gitArgv.some((e) => e.argv.includes('fetch') && e.argv.some((x) => x.startsWith('claims-registry:'))), 'the claim reader fetched the sandbox claims-registry');
    for (const [name, pair] of Object.entries(R)) {
      for (const [side, r] of sides(pair)) {
        for (const e of r.gitArgv) assert.ok(e.cwd === r.sandbox.root || e.cwd.startsWith(r.sandbox.root + path.sep), `${name} ${side}: git ran in ${e.cwd}`);
      }
    }
  });
});
