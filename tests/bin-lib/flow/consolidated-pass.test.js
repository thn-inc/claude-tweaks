// tests/bin-lib/flow/consolidated-pass.test.js — checkPassReentry (#3497): the
// one eligibility rule for re-entering a multi-spec run's consolidated pass.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPassReentry, REENTRY_REASONS } = require('../../../plugin/bin/lib/flow/consolidated-pass');
const { gitRepo, linkedWorktreeOf, fixtureGit } = require('../../helpers/git-fixtures');
const { runLiveness } = require('../../../plugin/bin/lib/run-liveness');
const { pidStartTime } = require('../../../plugin/bin/lib/run-liveness/process-probe');

const NOT_LANDED = () => ({ landed: false, evidence: { branch: 'b', merged: false } });
const NO_PR = () => { throw new Error('PR resolver must not be called'); };
const OLD_ENV = { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' };

function manifestText(statuses) {
  const ids = [11, 12, 13, 14];
  const lines = ['multispec:', '  parent: .claude-tweaks/pipelines/2026-08-01T090000-spec-11-12/', '  specs:'];
  statuses.forEach((status, i) => {
    lines.push(`    - id: ${ids[i]}`, `      status: ${status}`, `      subdir: spec-${ids[i]}/`);
  });
  return lines.join('\n') + '\n';
}

// Builds {tmp}/.claude-tweaks/pipelines[/archive]/<run>/ with the files the
// rule reads. Pass `null` for a file to omit it.
function makeRun(o = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pass-reentry-'));
  const parent = path.join(tmp, '.claude-tweaks', 'pipelines', ...(o.archived ? ['archive'] : []));
  const runDir = path.join(parent, '2026-08-01T090000-spec-11-12');
  fs.mkdirSync(runDir, { recursive: true });
  const manifest = 'manifest' in o ? o.manifest : manifestText(o.statuses || ['complete', 'complete']);
  if (manifest !== null) fs.writeFileSync(path.join(runDir, 'manifest.yml'), manifest);
  const config = 'config' in o ? o.config : 'mode: auto\n';
  if (config !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), config);
  const runState = 'runState' in o ? o.runState : { status: 'active' };
  if (runState !== null) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  if (o.console) fs.writeFileSync(path.join(runDir, 'console.json'), '{}');
  return runDir;
}

const deps = (over = {}) => ({ checkBranchLanded: NOT_LANDED, ...over });

test('AC4.1 eligible run -> eligible, specIds [11, 12]', () => {
  const r = checkPassReentry(makeRun(), { deps: deps() });
  assert.equal(r.eligible, true);
  assert.equal(r.reason, 'eligible');
  assert.deepEqual(r.specIds, [11, 12]);
});

test('AC4.1 console.json present -> console-exists', () => {
  const r = checkPassReentry(makeRun({ console: true }), { deps: deps() });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'console-exists');
});

test('#3497 console.json as a directory -> console-exists', () => {
  const run = makeRun();
  fs.mkdirSync(path.join(run, 'console.json'));
  const r = checkPassReentry(run, { deps: deps() });
  assert.equal(r.reason, 'console-exists');
  assert.match(r.detail, /directory/);
});

test('AC4.1 a spec running -> spec-unfinished naming #12 running', () => {
  const r = checkPassReentry(makeRun({ statuses: ['complete', 'running'] }), { deps: deps() });
  assert.equal(r.reason, 'spec-unfinished');
  assert.match(r.detail, /#12 running/);
  assert.doesNotMatch(r.detail, /#11/);
});

test('AC4.1 a spec pending -> spec-unfinished', () => {
  const r = checkPassReentry(makeRun({ statuses: ['pending', 'complete'] }), { deps: deps() });
  assert.equal(r.reason, 'spec-unfinished');
  assert.match(r.detail, /#11 pending/);
});

test('AC4.1 mode interactive -> mode; config.yml without a mode line -> mode', () => {
  assert.equal(checkPassReentry(makeRun({ config: 'mode: interactive\n' }), { deps: deps() }).reason, 'mode');
  assert.equal(checkPassReentry(makeRun({ config: 'other: x\n' }), { deps: deps() }).reason, 'mode');
  assert.equal(checkPassReentry(makeRun({ config: null }), { deps: deps() }).reason, 'mode');
  assert.equal(checkPassReentry(makeRun({ config: 'mode: hybrid\n' }), { deps: deps() }).reason, 'eligible');
});

test('AC4.1 no manifest.yml -> no-manifest', () => {
  const r = checkPassReentry(makeRun({ manifest: null }), { deps: deps() });
  assert.equal(r.reason, 'no-manifest');
  assert.deepEqual(r.specIds, []);
});

test('#3497 archived dir -> archived', () => {
  const r = checkPassReentry(makeRun({ archived: true }), { deps: deps() });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'archived');
});

test('#3497 run-state clean -> closed; missing run-state is not closed', () => {
  assert.equal(checkPassReentry(makeRun({ runState: { status: 'clean' } }), { deps: deps() }).reason, 'closed');
  assert.equal(checkPassReentry(makeRun({ runState: null }), { deps: deps() }).reason, 'eligible');
});

test('#3497 failed + not-run specs alongside complete -> eligible', () => {
  const r = checkPassReentry(makeRun({ statuses: ['complete', 'failed', 'not-run'] }), { deps: deps() });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.specIds, [11, 12, 13]);
});

test('#3497 landed true -> landed; landed null -> landed-unknown', () => {
  const run = makeRun();
  const landed = checkPassReentry(run, { deps: deps({ checkBranchLanded: () => ({ landed: true, evidence: {} }) }) });
  assert.equal(landed.reason, 'landed');
  const unknown = checkPassReentry(run, { deps: deps({ checkBranchLanded: () => ({ landed: null, evidence: {} }) }) });
  assert.equal(unknown.reason, 'landed-unknown');
  const thrown = checkPassReentry(run, { deps: deps({ checkBranchLanded: () => { throw new Error('boom'); } }) });
  assert.equal(thrown.reason, 'landed-unknown');
});

test('#3497 cache option is passed through to checkBranchLanded', () => {
  const cache = {};
  let seen;
  checkPassReentry(makeRun(), { cache, deps: deps({ checkBranchLanded: (_d, o) => { seen = o; return { landed: false }; } }) });
  assert.equal(seen.cache, cache);
});

test('#3497 real checkBranchLanded in a non-git tmp project -> landed-unknown, no throw', () => {
  const r = checkPassReentry(makeRun());
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'landed-unknown');
});

test('#3497 online + PR MERGED -> landed even when merge evidence says false', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  let args;
  const r = checkPassReentry(run, {
    online: true,
    deps: deps({ resolvePrStateByNumber: (root, n) => { args = [root, n]; return { number: n, state: 'MERGED' }; } }),
  });
  assert.equal(r.reason, 'landed');
  assert.match(r.detail, /PR #4242 merged/);
  assert.equal(args[1], 4242);
  assert.equal(args[0], path.resolve(run, '..', '..', '..'));
});

test('#3497 online + OPEN PR -> continues to merge evidence', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, { online: true, deps: deps({ resolvePrStateByNumber: () => ({ state: 'OPEN' }) }) });
  assert.equal(r.reason, 'eligible');
});

test('#3497 online + gh-absent -> falls back to merge evidence, detail names the degrade', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, { online: true, deps: deps({ resolvePrStateByNumber: () => 'gh-absent' }) });
  assert.equal(r.eligible, true);
  assert.match(r.detail, /online PR check unavailable \(gh-absent\)/);
  const landed = checkPassReentry(run, {
    online: true,
    deps: deps({ resolvePrStateByNumber: () => 'network-failure', checkBranchLanded: () => ({ landed: true }) }),
  });
  assert.equal(landed.reason, 'landed');
  assert.match(landed.detail, /network-failure/);
});

test('#3497 online without pr.number in run-state -> resolver not called', () => {
  const r = checkPassReentry(makeRun(), { online: true, deps: deps({ resolvePrStateByNumber: NO_PR }) });
  assert.equal(r.reason, 'eligible');
});

test('#3497 offline never calls the PR resolver', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, { deps: deps({ resolvePrStateByNumber: NO_PR }) });
  assert.equal(r.reason, 'eligible');
  const r2 = checkPassReentry(run, { online: false, deps: deps({ resolvePrStateByNumber: NO_PR }) });
  assert.equal(r2.reason, 'eligible');
});

// #3497 I1: a run whose parent session is still live is never re-entered.
// The lock and last-commit probes are injected through deps.probes, so no live pid is needed.
const WT = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pass-reentry-wt-'));
const OLD = Date.parse('2026-01-01T00:00:00Z');
const thrower = (message) => () => { throw new Error(message); };
const NO_CALL = (name) => () => { throw new Error(`${name} must not be called`); };

test('#3497 I1 live worktree lock -> parent-live', () => {
  const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT } });
  const r = checkPassReentry(run, { deps: deps({ probes: { lockInUse: () => true, lastCommitAt: () => OLD } }) });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'parent-live');
  assert.equal(r.detail, 'worktree lock in-use');
  const unknown = checkPassReentry(run, { deps: deps({ probes: { lockInUse: thrower('worktree lock state is unknown for W'), lastCommitAt: () => OLD } }) });
  assert.equal(unknown.reason, 'parent-live');
  const failed = checkPassReentry(run, { deps: deps({ probes: { lockInUse: thrower('could not list worktrees from R: git timeout'), lastCommitAt: () => OLD } }) });
  assert.equal(failed.reason, 'parent-live');
  assert.match(failed.detail, /indeterminate/);
});

test('AC1.2: an unlisted worktree now blocks the pass', () => {
  const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT } });
  const r = checkPassReentry(run, { deps: deps({ probes: { lockInUse: thrower('W is not listed by git worktree list in R'), lastCommitAt: () => OLD } }) });
  assert.equal(r.reason, 'parent-live');
  assert.match(r.detail, /^indeterminate: .*not listed/);
  // Real git, no injected probe: a plain subdirectory of a repo resolves a main
  // checkout that does not list it. The old code read that as eligible (null).
  const main = gitRepo();
  fixtureGit(['-C', main, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
  const sub = path.join(main, 'sub');
  fs.mkdirSync(sub);
  const real = checkPassReentry(makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: sub } }), { deps: deps() });
  assert.equal(real.reason, 'parent-live');
  assert.match(real.detail, /^indeterminate: .*not listed/);
});

// A real, unlocked linked worktree: the pre-#4420 code listed it, found a free
// lock and returned null, so a test on it goes red against that code.
function unlockedRealWorktreeRun() {
  return makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: linkedWorktreeOf(gitRepo()) } });
}

test('AC1.2: a commit under 10 minutes old now blocks a non-interrupted parent', () => {
  const run = unlockedRealWorktreeRun();
  const r = checkPassReentry(run, { deps: deps({ probes: { lockInUse: () => false, lastCommitAt: () => Date.now() - 60000 } }) });
  assert.equal(r.reason, 'parent-live');
  assert.equal(r.detail, 'worktree recently committed to');
});

test('AC4.1: owner-probe noise never blocks a non-interrupted parent (parentLiveDetail)', () => {
  const quiet = { lockInUse: () => false, lastCommitAt: () => OLD };
  const liveOwner = {
    sessionId: 'parent', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T1',
    heartbeatAt: new Date().toISOString(),
  };
  const ownerProbes = { hostname: () => 'h', pidAlive: () => true, pidStartTime: () => 'T1' };
  const rows = [
    ['fresh heartbeat and live owner pid', { owner: liveOwner }, { ...quiet, ...ownerProbes }],
    ['owner block from another session', { owner: { ...liveOwner, sessionId: 'other' } }, { ...quiet, ...ownerProbes }],
  ];
  for (const [label, state, probes] of rows) {
    const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT, ...state } });
    const r = checkPassReentry(run, { deps: deps({ probes }) });
    assert.notEqual(r.reason, 'parent-live', label);
    assert.equal(r.reason, 'eligible', label);
  }
});

// Spec Deliverable 7: the real runLiveness on real probes, with and without an owner
// block. The block names this live test process, so its owner-pid and heartbeat
// entries read positive on the real host, and still must not block the pass.
test('AC4.1: real probes — a quiet non-interrupted parent is eligible with or without a live owner block', () => {
  for (const withOwner of [false, true]) {
    const wt = linkedWorktreeOf(gitRepo());
    fixtureGit(['-C', wt, 'commit', '--allow-empty', '-m', 'old work', '-q'], { env: OLD_ENV });
    const owner = {
      sessionId: 'parent', host: os.hostname(), pid: process.pid, pidSource: 'env',
      pidStartedAt: pidStartTime(process.pid), heartbeatAt: new Date().toISOString(),
    };
    const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: wt, ...(withOwner ? { owner } : {}) } });
    if (withOwner) {
      const results = Object.fromEntries(runLiveness(run).evidence.map((e) => [e.probe, e.result]));
      assert.equal(results.heartbeat, 'positive', 'fixture: the heartbeat reads live');
      if (owner.pidStartedAt) assert.equal(results['owner-pid'], 'positive', 'fixture: the owner pid reads live');
    }
    assert.equal(checkPassReentry(run, { deps: deps() }).reason, 'eligible', `owner block: ${withOwner}`);
  }
});

test('AC3.2: a real unborn-HEAD parent worktree is indeterminate: no-commits', () => {
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pass-reentry-unborn-'));
  fixtureGit(['init', '-q', wt]);
  const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: wt } });
  const r = checkPassReentry(run, { deps: deps() });
  assert.equal(r.reason, 'parent-live');
  assert.equal(r.detail, 'indeterminate: no-commits');
});

test('AC1.2: a failed last-commit read now blocks a non-interrupted parent', () => {
  const run = unlockedRealWorktreeRun();
  const r = checkPassReentry(run, { deps: deps({ probes: { lockInUse: () => false, lastCommitAt: thrower('could not read the last commit time of W: git error') } }) });
  assert.equal(r.reason, 'parent-live');
  assert.match(r.detail, /^indeterminate: /);
});

test('AC3.2: parentLiveDetail is non-null for every old indeterminate source', () => {
  // Already indeterminate before #4420 (behaviour pins): the worktree listing failed.
  const pinRun = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT } });
  for (const probes of [
    { lockInUse: thrower('could not resolve the main checkout of W') },
    { lockInUse: thrower('could not list worktrees from R: git timeout') },
  ]) {
    const r = checkPassReentry(pinRun, { deps: deps({ probes }) });
    assert.equal(r.reason, 'parent-live', JSON.stringify(Object.keys(probes)));
    assert.match(r.detail, /^indeterminate: ./);
  }
  // Changed rows: the old code read these as eligible (null) on a free lock.
  for (const lastCommitAt of [
    thrower('could not read the last commit time of W: git error'),
    () => null,
    () => NaN,
  ]) {
    const r = checkPassReentry(unlockedRealWorktreeRun(), { deps: deps({ probes: { lockInUse: () => false, lastCommitAt } }) });
    assert.equal(r.reason, 'parent-live');
    assert.match(r.detail, /^indeterminate: ./);
  }
});

test('#3497 I1 own session skips the liveness check', () => {
  const active = makeRun({ runState: { status: 'active', sessionId: 'me', worktree: WT } });
  const r = checkPassReentry(active, { sessionId: 'me', deps: deps({ probes: { lockInUse: NO_CALL('probes.lockInUse') } }) });
  assert.equal(r.reason, 'eligible');
  const interrupted = makeRun({ runState: { status: 'interrupted', sessionId: 'me', worktree: WT } });
  const r2 = checkPassReentry(interrupted, { sessionId: 'me', deps: deps({ checkResumeFreshness: NO_CALL('checkResumeFreshness') }) });
  assert.equal(r2.reason, 'eligible');
});

test('#3497 I1 interrupted + recent commit -> parent-live', () => {
  const run = makeRun({ runState: { status: 'interrupted', sessionId: 'parent', worktree: WT } });
  let seen;
  const r = checkPassReentry(run, {
    sessionId: 'other',
    deps: deps({
      probes: { lockInUse: NO_CALL('probes.lockInUse') },
      checkResumeFreshness: (dir, o) => { seen = [dir, o]; return { safe: false, verdict: 'recent-commit', reason: 'worktree committed to within the last 10 minutes' }; },
    }),
  });
  assert.equal(r.reason, 'parent-live');
  assert.match(r.detail, /recent-commit/);
  assert.match(r.detail, /within the last 10 minutes/);
  assert.equal(seen[0], run);
  assert.equal(seen[1].sessionId, 'other');
  const stale = checkPassReentry(run, { deps: deps({ checkResumeFreshness: () => ({ safe: true, verdict: 'stale' }) }) });
  assert.equal(stale.reason, 'eligible');
});

// An orphaned lock reads as a free one inside run-liveness's lock probe
// (tests/bin-lib/run-liveness/probes.test.js); here the probe's free answer is stubbed.
test('#3497 I1 a free lock and an old commit -> continues to landed check', () => {
  const run = makeRun({ runState: { status: 'active', sessionId: 'parent', worktree: WT } });
  const landedTrue = () => ({ landed: true, evidence: {} });
  const r = checkPassReentry(run, { deps: deps({ probes: { lockInUse: () => false, lastCommitAt: () => OLD }, checkBranchLanded: landedTrue }) });
  assert.equal(r.reason, 'landed');
  const gone = makeRun({ runState: { status: 'active', worktree: path.join(WT, 'gone') } });
  assert.equal(checkPassReentry(gone, { deps: deps({ probes: { lockInUse: NO_CALL('probes.lockInUse') } }) }).reason, 'eligible');
});

test('#3497 M3 online OPEN PR + indeterminate merge evidence -> eligible, detail names the PR', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, {
    online: true,
    deps: deps({ resolvePrStateByNumber: () => ({ state: 'OPEN' }), checkBranchLanded: () => ({ landed: null }) }),
  });
  assert.equal(r.eligible, true);
  assert.equal(r.detail, 'PR #4242 open');
});

test('#3497 T2 an empty mode: value never reads the next line', () => {
  assert.equal(checkPassReentry(makeRun({ config: 'mode:\nauto\n' }), { deps: deps() }).reason, 'mode');
  assert.equal(checkPassReentry(makeRun({ config: 'mode: \tauto\n' }), { deps: deps() }).reason, 'eligible');
});

test('REENTRY_REASONS is frozen and lists every reason the rule can return', () => {
  assert.ok(Object.isFrozen(REENTRY_REASONS));
  assert.deepEqual([...REENTRY_REASONS], [
    'archived', 'no-manifest', 'closed', 'mode', 'console-exists',
    'spec-unfinished', 'parent-live', 'landed', 'landed-unknown', 'eligible',
  ]);
});

test('#3497 review a symlink into pipelines/archive/ still reads as archived', () => {
  const archived = makeRun({ archived: true });
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-pass-link-')), 'run');
  fs.symlinkSync(archived, link);
  assert.equal(checkPassReentry(link, { deps: deps() }).reason, 'archived');
});

test('AC7.1: online + pr-not-found -> no throw, degraded text names it (#3543)', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, { online: true, deps: deps({ resolvePrStateByNumber: () => 'pr-not-found' }) });
  assert.equal(r.eligible, true);
  assert.match(r.detail, /online PR check unavailable \(pr-not-found\)/);
});

test('#3497 review a throwing PR resolver degrades like a transport failure', () => {
  const run = makeRun({ runState: { status: 'active', pr: { number: 4242 } } });
  const r = checkPassReentry(run, { online: true, deps: deps({ resolvePrStateByNumber: () => { throw new Error('boom'); } }) });
  assert.equal(r.reason, 'eligible');
  assert.match(r.detail, /online PR check unavailable \(threw\)/);
  const none = checkPassReentry(run, { online: true, deps: deps({ resolvePrStateByNumber: () => undefined }) });
  assert.match(none.detail, /online PR check unavailable \(no result\)/);
});

test('#3497 review landed-unknown names a missing run-state.json', () => {
  const unknown = () => ({ landed: null, evidence: {} });
  const missing = checkPassReentry(makeRun({ runState: null }), { deps: deps({ checkBranchLanded: unknown }) });
  assert.equal(missing.reason, 'landed-unknown');
  assert.match(missing.detail, /no valid run-state\.json/);
  const present = checkPassReentry(makeRun(), { deps: deps({ checkBranchLanded: unknown }) });
  assert.equal(present.detail, 'merge evidence indeterminate');
});
