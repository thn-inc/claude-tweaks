'use strict';
// #5227: the slow whole-fence oracle runs and the oracle cross-checks, split out of queue-pull.test.js
// so that file stays under the per-file duration ceiling. Two runs of queue-pull-script.md over a
// one-record fixture (the fence runs whole; an unmatched gh call fails loudly), and two cross-checks
// that compare the oracle's run of a fixture with the in-process pull harness (queue-pull-helpers.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { REPO, oracleSkip, createSandbox, runOracle, withEscapeGuard } = require('./queue-pull-oracle');
const { S0, S1, SFast } = require('./queue-pull-fixtures');
const { FENCE, pull, entriesOf, FULL, pull4 } = require('./queue-pull-helpers');

test('#5227 oracle: queue-pull-script.md runs whole over a one-record fixture', { skip: oracleSkip() }, async () => {
  const r = await withEscapeGuard(REPO, () => runOracle(createSandbox(S0()), FENCE));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']).flat().map((c) => c.number), [9001]);
  assert.deepEqual(JSON.parse(r.files['dispatch-exclusions.json']), []);
  assert.equal(r.ghArgv.filter((a) => a.tag === 'UNHANDLED').length, 0);
  assert.deepEqual(r.gitArgv.filter((a) => a.tag === 'REFUSED'), [], 'the fence never trips the git shim containment');
  // The write-back reached the sandbox origin, stamped by the preloaded frozen clock.
  assert.equal(r.orderBlob.computedAt, '2026-11-12T12:00:00.000Z');
});

test('#5227 oracle: an unmatched gh call fails loudly (go-red control for the shim table)', { skip: oracleSkip() }, async () => {
  const s = S0(); s.gh = s.gh.filter((e) => !(Array.isArray(e.argv) && e.argv.includes('number') && e.argv.includes('200')));
  const r = await runOracle(createSandbox(s), FENCE);
  assert.match(r.stderr, /gh-shim: no canned response for: issue list --state open --json number --limit 200/);
});

test('#5227 oracle cross-check: the S1 and SFast fixtures give the oracle the same groups, blocked and oversized entries (PF15: the oversized entry is non-empty)', { skip: oracleSkip() }, async () => {
  for (const [scenario, reason] of [[S1(), 'blocked'], [SFast(), 'oversized']]) {
    const r = await withEscapeGuard(REPO, () => runOracle(createSandbox(scenario), FENCE));
    assert.equal(r.status, 0, r.stderr);
    const oracle = JSON.parse(r.files['dispatch-exclusions.json']).filter((e) => e.reason === reason);
    assert.ok(oracle.length > 0, `the oracle run of ${scenario.name} yields a ${reason} entry`);
    const mine = pull(scenario);
    assert.deepEqual(entriesOf(mine, reason), oracle);
    assert.deepEqual(mine.json('dispatch-groups.json'), JSON.parse(r.files['dispatch-groups.json']));
  }
});

test('#5227 oracle cross-check: S1 full gives the oracle the same groups, the four reasons and the staged Close bodies the module yields', { skip: oracleSkip() }, async () => {
  const oracle = await withEscapeGuard(REPO, () => runOracle(createSandbox(FULL()), FENCE));
  assert.equal(oracle.status, 0, oracle.stderr);
  const mine = pull4(FULL());
  const oracleEntries = JSON.parse(oracle.files['dispatch-exclusions.json']);
  for (const reason of ['not-spec-shaped', 'open-pr', 'target-missing', 'shipped']) {
    assert.ok(oracleEntries.some((e) => e.reason === reason), `the oracle yields a ${reason} entry`);
    assert.deepEqual(entriesOf(mine, reason), oracleEntries.filter((e) => e.reason === reason), reason);
  }
  assert.deepEqual(mine.json('dispatch-groups.json'), JSON.parse(oracle.files['dispatch-groups.json']));
  const bodies = (staged) => Object.fromEntries(Object.entries(staged).map(([name, body]) => [name.replace(/\..*$/, ''), body]));
  const myBodies = Object.fromEntries(mine.cap.staged.map((s) => [s.id, s.body]));
  assert.deepEqual(myBodies, bodies(oracle.staged), 'the staged Close bodies match');
  assert.ok(Object.keys(oracle.staged).includes('dispatch-target-missing-9009.md'), `the oracle stages the target-missing item as .md: ${Object.keys(oracle.staged)}`);
  assert.deepEqual(mine.json('dispatch-linked-prs.json'), JSON.parse(oracle.files['dispatch-linked-prs.json']));
  assert.deepEqual(mine.json('dispatch-shipped-probe-prs.json'), JSON.parse(oracle.files['dispatch-shipped-probe-prs.json']));
  assert.equal(mine.text['dispatch-shipped-pr-files.jsonl'], oracle.files['dispatch-shipped-pr-files.jsonl']);
  assert.equal(mine.text['dispatch-named-targets.json'], oracle.files['dispatch-named-targets.json']);
});
