'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PROBE_ORDER, gatherEvidence, decideVerdict, runLiveness } = require('../../../plugin/bin/lib/run-liveness');
const { pidStartTime } = require('../../../plugin/bin/lib/run-liveness/process-probe');
const ctxLib = require('../../../plugin/bin/lib/hooks/context');
const { isDeadRunDir } = require('../../../plugin/bin/lib/hooks/run-dir-resolve');
const { checkResumeFreshness } = require('../../../plugin/bin/lib/hooks/resume-freshness');
const { skipUnderRoot } = require('../../helpers/root');

const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function runIdAt(ms, slug = 'record-1') {
  return `${new Date(ms).toISOString().slice(0, 19).replace(/:/g, '')}-${slug}`;
}

// Every live probe a clean negative unless a test overrides it.
function baseProbes(over = {}) {
  return {
    hostname: () => 'h',
    pidAlive: () => false,
    pidStartTime: () => 'T1',
    lockInUse: () => false,
    lastCommitAt: () => null,
    ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null }),
    ...over,
  };
}
function owner(over = {}) {
  return { sessionId: 's', host: 'h', pid: 4242, pidSource: 'env', pidStartedAt: 'T1', heartbeatAt: new Date(NOW - HOUR).toISOString(), ...over };
}
// Writes run-state.json (+ empty events.jsonl) into a temp pipelines dir. The
// state's `worktree` defaults to a real directory so the lock/commit probes are
// reached; pass `worktree: undefined` for a run that records none.
function fixture({ state = {}, runId = runIdAt(NOW - HOUR), probes = {}, raw } = {}) {
  const runDir = path.join(tmp('ct-liveness-'), '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const full = 'worktree' in state ? { ...state } : { ...state, worktree: tmp('ct-liveness-wt-') };
  fs.writeFileSync(path.join(runDir, 'run-state.json'), raw !== undefined ? raw : JSON.stringify(full));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  return { runDir, now: NOW, probes: baseProbes(probes) };
}
function verdictOf(fx) {
  return runLiveness(fx.runDir, { now: fx.now, probes: fx.probes });
}
function entry(res, probe) {
  return res.evidence.find((e) => e.probe === probe);
}

// ---- AC4 ----
test('AC4.1 owner pid alive with a matching start time is live', () => {
  const fx = fixture({ state: { owner: owner() }, probes: { pidAlive: () => true, pidStartTime: () => 'T1' } });
  const res = verdictOf(fx);
  assert.strictEqual(res.verdict, 'live');
  assert.strictEqual(entry(res, 'owner-pid').result, 'positive');
});

test('AC4.2 owner pid gone with every other probe a clean negative is dead', () => {
  const res = verdictOf(fixture({ state: { owner: owner() } }));
  assert.strictEqual(res.verdict, 'dead');
  assert.strictEqual(entry(res, 'owner-pid').detail, 'gone');
});

test('AC4.3 pid alive with a different start time (pid reuse) is not live, verdict dead', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { pidAlive: () => true, pidStartTime: () => 'OTHER' } }));
  assert.notStrictEqual(entry(res, 'owner-pid').result, 'positive');
  assert.strictEqual(entry(res, 'owner-pid').detail, 'pid-reused');
  assert.strictEqual(res.verdict, 'dead');
});

// ---- AC5 ----
test('AC5.1 a heartbeat under 10 minutes alone is live', () => {
  const res = verdictOf(fixture({ state: { owner: owner({ heartbeatAt: new Date(NOW - 9 * MIN).toISOString() }) } }));
  assert.strictEqual(res.verdict, 'live');
  assert.strictEqual(entry(res, 'heartbeat').result, 'positive');
});

test('AC5.1 an in-use worktree lock alone is live', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { lockInUse: () => true } }));
  assert.strictEqual(res.verdict, 'live');
  assert.strictEqual(entry(res, 'worktree-lock').result, 'positive');
});

test('AC5.1 a last commit under 10 minutes old alone is live', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { lastCommitAt: () => NOW - 9 * MIN } }));
  assert.strictEqual(res.verdict, 'live');
  assert.strictEqual(entry(res, 'last-commit').result, 'positive');
});

// ---- AC6 ----
const interrupted = { status: 'interrupted', lastEvent: 'session-end' };
const SESSION_END = NOW - 30 * MIN;
const sessionEndProbe = { pidAlive: () => true, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: SESSION_END }) };

test('AC6.1 alive pid, no start time, interrupted, heartbeat before the session-end event is dead', () => {
  const res = verdictOf(fixture({
    state: { ...interrupted, owner: owner({ pidStartedAt: null, heartbeatAt: new Date(SESSION_END - 5 * MIN).toISOString() }) },
    probes: sessionEndProbe,
  }));
  assert.strictEqual(entry(res, 'owner-pid').detail, 'alive-no-start-time');
  assert.strictEqual(res.verdict, 'dead');
});

test('AC6.2 heartbeat after the session-end event and 5 minutes old is live', () => {
  const res = verdictOf(fixture({
    state: { ...interrupted, owner: owner({ pidStartedAt: null, heartbeatAt: new Date(NOW - 5 * MIN).toISOString() }) },
    probes: sessionEndProbe,
  }));
  assert.strictEqual(res.verdict, 'live');
});

test('AC6.2 heartbeat after the session-end event but 20 minutes old is unknown, never dead', () => {
  const res = verdictOf(fixture({
    state: { ...interrupted, owner: owner({ pidStartedAt: null, heartbeatAt: new Date(NOW - 20 * MIN).toISOString() }) },
    probes: { pidAlive: () => true, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: NOW - 25 * MIN }) },
  }));
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC6.3 no owner block with the same interrupted shape, run id 1 hour old, is unknown', () => {
  const res = verdictOf(fixture({ state: { ...interrupted }, runId: runIdAt(NOW - HOUR), probes: sessionEndProbe }));
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC6.4 alive pid with a matching start time is live whatever the status', () => {
  const res = verdictOf(fixture({
    state: { ...interrupted, owner: owner() },
    probes: { pidAlive: () => true, pidStartTime: () => 'T1', ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: NOW - HOUR }) },
  }));
  assert.strictEqual(res.verdict, 'live');
});

// ---- AC7 ----
test('AC7.1 legacy run silent 73 hours, commit 73 hours old, no lock is dead', () => {
  const res = verdictOf(fixture({
    state: {},
    probes: { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }), lastCommitAt: () => NOW - 73 * HOUR },
  }));
  assert.strictEqual(res.verdict, 'dead');
});

test('AC7.1 legacy run silent 73 hours with a last commit only 11 hours old is unknown', () => {
  const res = verdictOf(fixture({
    state: {},
    probes: { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }), lastCommitAt: () => NOW - 11 * HOUR },
  }));
  assert.strictEqual(entry(res, 'last-commit').result, 'negative');
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC7.2 legacy run with 71 hours of event silence is unknown', () => {
  const res = verdictOf(fixture({
    state: {},
    probes: { ownEventAt: () => ({ lastOwnMs: NOW - 71 * HOUR, lastSessionEndMs: null }), lastCommitAt: () => NOW - 73 * HOUR },
  }));
  assert.strictEqual(res.verdict, 'unknown');
});

// ---- AC8 / AC9 ----
function boom() { throw new Error('probe exploded'); }

// One fixture per probe, reached and with every other evidence pointing at dead.
const PROBE_ERROR_CASES = {
  hostname: () => fixture({ state: { owner: owner() }, probes: { hostname: boom } }),
  pidAlive: () => fixture({ state: { owner: owner() }, probes: { pidAlive: boom } }),
  pidStartTime: () => fixture({ state: { owner: owner() }, probes: { pidAlive: () => true, pidStartTime: boom } }),
  lockInUse: () => fixture({ state: { owner: owner() }, probes: { lockInUse: boom } }),
  lastCommitAt: () => fixture({ state: { owner: owner() }, probes: { lastCommitAt: boom } }),
  ownEventAt: () => fixture({ state: { owner: owner() }, probes: { ownEventAt: boom } }),
};
const ERRORING_ENTRY = {
  hostname: 'owner-pid', pidAlive: 'owner-pid', pidStartTime: 'owner-pid',
  lockInUse: 'worktree-lock', lastCommitAt: 'last-commit', ownEventAt: 'owner-events',
};

// The AC8.1 assertions, parameterised over the decision function so AC9.1 can
// point them at a fail-open variant.
function assertProbeErrorsYieldUnknown(decide) {
  for (const [name, make] of Object.entries(PROBE_ERROR_CASES)) {
    const fx = make();
    const gathered = gatherEvidence(fx.runDir, { now: fx.now, probes: fx.probes });
    const e = gathered.evidence.find((x) => x.probe === ERRORING_ENTRY[name]);
    assert.strictEqual(e.result, 'error', `${name}: ${ERRORING_ENTRY[name]} entry is error`);
    assert.strictEqual(e.detail, 'probe exploded', `${name}: detail carries the message`);
    assert.strictEqual(decide(gathered), 'unknown', `${name}: a throwing probe yields unknown`);
  }
}

test('AC8.1 a throwing probe yields unknown, for each probe in turn', () => {
  assertProbeErrorsYieldUnknown(decideVerdict);
  for (const make of Object.values(PROBE_ERROR_CASES)) {
    const fx = make();
    assert.strictEqual(verdictOf(fx).verdict, 'unknown');
  }
});

test('AC8.1 pidStartTime returning null (probe failed) is an error entry, verdict unknown', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { pidAlive: () => true, pidStartTime: () => null } }));
  assert.deepStrictEqual({ result: entry(res, 'owner-pid').result, detail: entry(res, 'owner-pid').detail }, { result: 'error', detail: 'start-time-unavailable' });
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC8.2 a different host is unknown', () => {
  const res = verdictOf(fixture({ state: { owner: owner({ host: 'elsewhere' }) } }));
  assert.strictEqual(entry(res, 'owner-pid').detail, 'other-host');
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC8.2 alive pid with a null start time and status active is unknown', () => {
  const res = verdictOf(fixture({ state: { status: 'active', owner: owner({ pidStartedAt: null }) }, probes: { pidAlive: () => true } }));
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC9.1 a fail-open variant (probe error mapped to dead) fails the probe-error assertions', () => {
  const failOpen = (g) => (g.evidence.some((e) => e.result === 'error') ? 'dead' : decideVerdict(g));
  assert.throws(
    () => assertProbeErrorsYieldUnknown(failOpen),
    (err) => err instanceof assert.AssertionError && /a throwing probe yields unknown/.test(err.message),
  );
});

// ---- AC11 ----
test('AC11.1 a run-state with no owner key reads cleanly everywhere and is legacy to runLiveness', () => {
  const fx = fixture({ state: { status: 'active' } });
  assert.doesNotThrow(() => ctxLib.readRunState(fx.runDir));
  assert.doesNotThrow(() => isDeadRunDir(fx.runDir));
  assert.doesNotThrow(() => checkResumeFreshness(fx.runDir));
  const res = verdictOf(fx);
  assert.strictEqual(entry(res, 'owner-pid').detail, 'no-owner-block');
  assert.strictEqual(entry(res, 'heartbeat').detail, 'no-owner-block');
});

test('AC11.2 an absent run-state.json is a legacy run: no owner block, judged by the legacy route', () => {
  const fx = fixture({ runId: runIdAt(NOW - 73 * HOUR), probes: { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }) } });
  fs.rmSync(path.join(fx.runDir, 'run-state.json'));
  const res = verdictOf(fx);
  assert.strictEqual(entry(res, 'owner-pid').detail, 'no-owner-block');
  assert.strictEqual(entry(res, 'heartbeat').detail, 'no-owner-block');
  assert.strictEqual(res.verdict, 'dead');
});

test('AC11.2 a run-state.json that exists but is corrupt reads as unreadable, not legacy: unknown even when the legacy route would say dead', () => {
  const legacyDead = { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }) };
  for (const raw of ['{ not json', '[]', '"s"', 'null']) {
    const fx = fixture({ raw, runId: runIdAt(NOW - 73 * HOUR), probes: legacyDead });
    assert.doesNotThrow(() => checkResumeFreshness(fx.runDir));
    const res = verdictOf(fx);
    for (const probe of ['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit']) {
      assert.deepStrictEqual({ r: entry(res, probe).result, d: entry(res, probe).detail }, { r: 'error', d: 'unreadable-run-state' }, `${probe} for ${raw}`);
    }
    assert.strictEqual(res.verdict, 'unknown', raw);
  }
});

test('AC11.2 a run-state.json that cannot be read at all (a directory in its place) is unreadable too', () => {
  const fx = fixture({ runId: runIdAt(NOW - 73 * HOUR), probes: { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }) } });
  fs.rmSync(path.join(fx.runDir, 'run-state.json'));
  fs.mkdirSync(path.join(fx.runDir, 'run-state.json'));
  const res = verdictOf(fx);
  assert.strictEqual(entry(res, 'owner-pid').detail, 'unreadable-run-state');
  assert.strictEqual(res.verdict, 'unknown');
});

// ---- AC12 ----
test('AC12.1 every verdict carries one evidence entry per probe, in PROBE_ORDER', () => {
  const fixtures = [
    fixture({ state: { owner: owner() }, probes: { pidAlive: () => true } }),
    fixture({ state: { owner: owner() } }),
    fixture({ state: {} }),
    fixture({ state: { owner: owner({ host: 'elsewhere' }) } }),
    fixture({ state: { owner: owner() }, probes: { lockInUse: boom } }),
    fixture({ raw: 'garbage' }),
  ];
  for (const fx of fixtures) {
    const res = verdictOf(fx);
    assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
    for (const e of res.evidence) assert.ok(['positive', 'negative', 'error'].includes(e.result));
  }
  assert.deepStrictEqual(PROBE_ORDER, ['owner-pid', 'heartbeat', 'worktree-lock', 'last-commit', 'owner-events']);
});

test('AC12.2 a throwing lockInUse is an error entry (not negative) and verdict unknown', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { lockInUse: boom } }));
  assert.strictEqual(entry(res, 'worktree-lock').result, 'error');
  assert.strictEqual(res.verdict, 'unknown');
});

// ---- AC13 ----
test('AC13.1 a positive heartbeat beats an erroring lock probe: live', () => {
  const res = verdictOf(fixture({
    state: { owner: owner({ heartbeatAt: new Date(NOW - MIN).toISOString() }) },
    probes: { lockInUse: boom },
  }));
  assert.strictEqual(res.verdict, 'live');
  assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
});

test('AC13.2 a death witness with an erroring commit probe is unknown', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { lastCommitAt: boom } }));
  assert.strictEqual(entry(res, 'owner-pid').detail, 'gone');
  assert.strictEqual(res.verdict, 'unknown');
  assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
});

// ---- AC14 ----
test('AC14.1 no worktree in the run-state: lock and commit are negative no-worktree, not error', () => {
  const res = verdictOf(fixture({ state: { worktree: undefined, owner: owner() } }));
  assert.deepStrictEqual({ r: entry(res, 'worktree-lock').result, d: entry(res, 'worktree-lock').detail }, { r: 'negative', d: 'no-worktree' });
  assert.deepStrictEqual({ r: entry(res, 'last-commit').result, d: entry(res, 'last-commit').detail }, { r: 'negative', d: 'no-worktree' });
});

test('AC14.1 a recorded worktree that is gone from disk is also no-worktree', () => {
  const res = verdictOf(fixture({ state: { worktree: path.join(os.tmpdir(), 'ct-liveness-does-not-exist-xyz'), owner: owner() } }));
  assert.strictEqual(entry(res, 'worktree-lock').detail, 'no-worktree');
  assert.strictEqual(entry(res, 'last-commit').detail, 'no-worktree');
});

test('AC14.2 legacy run with an empty events log ages from its run id: 73 hours dead, 71 hours unknown', () => {
  assert.strictEqual(verdictOf(fixture({ state: {}, runId: runIdAt(NOW - 73 * HOUR) })).verdict, 'dead');
  assert.strictEqual(verdictOf(fixture({ state: {}, runId: runIdAt(NOW - 71 * HOUR) })).verdict, 'unknown');
});

test('AC14.2 a run id with no timestamp and no events is an error (no-reference-time), verdict unknown', () => {
  const res = verdictOf(fixture({ state: {}, runId: 'not-a-run-id' }));
  assert.deepStrictEqual({ r: entry(res, 'owner-events').result, d: entry(res, 'owner-events').detail }, { r: 'error', d: 'no-reference-time' });
  assert.strictEqual(res.verdict, 'unknown');
});

// ---- unreadable / non-directory worktree is unknown evidence, never absent ----
const LEGACY_SILENT = { ownEventAt: () => ({ lastOwnMs: NOW - 73 * HOUR, lastSessionEndMs: null }) };

test('an unreadable worktree path is error for lock and commit: a legacy death witness plus in-use lock stays unknown, not dead', () => {
  const res = verdictOf(fixture({
    state: {},
    probes: { ...LEGACY_SILENT, pathType: () => ({ type: 'unreadable', code: 'EACCES' }), lockInUse: () => true, lastCommitAt: () => NOW - MIN },
  }));
  assert.strictEqual(entry(res, 'worktree-lock').result, 'error');
  assert.strictEqual(entry(res, 'last-commit').result, 'error');
  assert.match(entry(res, 'worktree-lock').detail, /unreadable.*EACCES/);
  assert.strictEqual(res.verdict, 'unknown');
});

test('an unreadable worktree path plus a pid death witness is unknown', () => {
  const res = verdictOf(fixture({ state: { owner: owner() }, probes: { pathType: () => ({ type: 'unreadable', code: 'EIO' }) } }));
  assert.strictEqual(entry(res, 'owner-pid').detail, 'gone');
  assert.strictEqual(entry(res, 'worktree-lock').result, 'error');
  assert.strictEqual(res.verdict, 'unknown');
});

test('a worktree path that is a file, or a type lookup that throws, is error for lock and commit', () => {
  for (const pathType of [() => ({ type: 'file', code: null }), () => ({ type: 'other', code: null }), boom]) {
    const res = verdictOf(fixture({ state: { owner: owner() }, probes: { pathType } }));
    assert.strictEqual(entry(res, 'worktree-lock').result, 'error');
    assert.strictEqual(entry(res, 'last-commit').result, 'error');
    assert.strictEqual(res.verdict, 'unknown');
  }
});

test('a worktree path the type lookup reports missing is the no-worktree negative; a symlink is probed', () => {
  const gone = verdictOf(fixture({ state: { owner: owner() }, probes: { pathType: () => ({ type: 'missing', code: 'ENOENT' }) } }));
  assert.strictEqual(entry(gone, 'worktree-lock').detail, 'no-worktree');
  assert.strictEqual(gone.verdict, 'dead');
  const link = verdictOf(fixture({ state: { owner: owner() }, probes: { pathType: () => ({ type: 'symlink', code: null }), lockInUse: () => true } }));
  assert.strictEqual(entry(link, 'worktree-lock').result, 'positive');
  assert.strictEqual(link.verdict, 'live');
});

test('a real chmod 000 parent makes the default type lookup unreadable, not absent', { skip: process.platform === 'win32' || skipUnderRoot('chmod 000 is not a denial under root').skip }, () => {
  const parent = tmp('ct-liveness-locked-');
  const wt = path.join(parent, 'wt');
  fs.mkdirSync(wt);
  fs.chmodSync(parent, 0o000);
  try {
    const res = verdictOf(fixture({
      state: { worktree: wt },
      probes: { ...LEGACY_SILENT, lockInUse: () => true, lastCommitAt: () => NOW - MIN },
    }));
    assert.strictEqual(entry(res, 'worktree-lock').result, 'error');
    assert.strictEqual(entry(res, 'last-commit').result, 'error');
    assert.strictEqual(res.verdict, 'unknown');
  } finally {
    fs.chmodSync(parent, 0o700);
  }
});

// ---- non-finite probe values are errors ----
test('a NaN lastOwnMs, NaN lastSessionEndMs or non-numeric event time is an owner-events error, verdict unknown', () => {
  for (const bad of [{ lastOwnMs: NaN, lastSessionEndMs: null }, { lastOwnMs: null, lastSessionEndMs: NaN }, { lastOwnMs: 'x', lastSessionEndMs: null }, { lastOwnMs: Infinity, lastSessionEndMs: null }]) {
    const res = verdictOf(fixture({ state: { owner: owner() }, probes: { ownEventAt: () => bad } }));
    assert.strictEqual(entry(res, 'owner-events').result, 'error', JSON.stringify(bad));
    assert.strictEqual(res.verdict, 'unknown');
  }
});

test('a NaN or non-numeric lastCommitAt is a last-commit error, never a clean negative', () => {
  for (const bad of [NaN, Infinity, 'x', undefined]) {
    const res = verdictOf(fixture({ state: { owner: owner() }, probes: { lastCommitAt: () => bad } }));
    assert.strictEqual(entry(res, 'last-commit').result, 'error', String(bad));
    assert.strictEqual(res.verdict, 'unknown');
  }
});

// ---- AC15 ----
test('AC15.2 an owner with a null pid is no-pid and never dead through the PID row', () => {
  const res = verdictOf(fixture({ state: { status: 'active', owner: owner({ pid: null, pidSource: null }) } }));
  assert.strictEqual(entry(res, 'owner-pid').detail, 'no-pid');
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC15.2 a stored pid above int32 is no-pid, not a gone pid: it never reaches dead through the PID row', () => {
  // process.kill throws on such a pid, which the real isPidAlive reads as false.
  for (const pid of [2 ** 31, 4294988075, Number.MAX_SAFE_INTEGER]) {
    const res = verdictOf(fixture({ state: { owner: owner({ pid }) }, probes: { pidAlive: () => false } }));
    assert.deepStrictEqual({ r: entry(res, 'owner-pid').result, d: entry(res, 'owner-pid').detail }, { r: 'negative', d: 'no-pid' }, String(pid));
    assert.strictEqual(res.verdict, 'unknown', String(pid));
  }
});

test('AC8.1 an unparseable heartbeatAt is a heartbeat error, so a gone pid beside it is unknown, not dead', () => {
  for (const heartbeatAt of ['not-a-date', '', null, undefined, {}]) {
    const res = verdictOf(fixture({ state: { owner: owner({ heartbeatAt }) } }));
    assert.deepStrictEqual({ r: entry(res, 'heartbeat').result, d: entry(res, 'heartbeat').detail }, { r: 'error', d: 'unparseable heartbeatAt' }, String(heartbeatAt));
    assert.strictEqual(entry(res, 'owner-pid').detail, 'gone');
    assert.strictEqual(res.verdict, 'unknown', String(heartbeatAt));
  }
});

test('AC6.1 the SessionEnd route also judges an owner with a null pid: dead before the session-end, not after', () => {
  const mk = (heartbeatAt) => verdictOf(fixture({
    state: { ...interrupted, owner: owner({ pid: null, pidSource: null, pidStartedAt: null, heartbeatAt: new Date(heartbeatAt).toISOString() }) },
    probes: { ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: SESSION_END }) },
  }));
  const before = mk(SESSION_END - 5 * MIN);
  assert.strictEqual(entry(before, 'owner-pid').detail, 'no-pid');
  assert.strictEqual(before.verdict, 'dead');
  assert.strictEqual(mk(NOW - 20 * MIN).verdict, 'unknown');
  assert.strictEqual(mk(NOW - 5 * MIN).verdict, 'live');
});

// ---- AC3.1 (verdict half) ----
test('AC3.1 a re-stamped owner block for the running process reads live through the PID row', { skip: process.platform === 'win32' }, () => {
  const restamped = {
    sessionId: 's', host: os.hostname(), pid: process.pid, pidSource: 'env',
    pidStartedAt: pidStartTime(process.pid), heartbeatAt: new Date(NOW - 20 * MIN).toISOString(),
  };
  assert.ok(restamped.pidStartedAt, 'the real start-time probe answers for this process');
  const fx = fixture({ state: { owner: restamped } });
  const res = runLiveness(fx.runDir, {
    now: NOW,
    probes: { lockInUse: () => false, lastCommitAt: () => null, ownEventAt: () => ({ lastOwnMs: null, lastSessionEndMs: null }) },
  });
  assert.strictEqual(res.verdict, 'live');
  assert.strictEqual(entry(res, 'owner-pid').result, 'positive');
});

// ---- final review: unjudgeable evidence never reaches dead ----
test('AC12.2 an owner block from another session than the run-state sessionId is error owner-session-mismatch, verdict unknown', () => {
  const res = verdictOf(fixture({ state: { sessionId: 'B', owner: owner({ sessionId: 'A' }) } }));
  assert.deepStrictEqual({ r: entry(res, 'owner-pid').result, d: entry(res, 'owner-pid').detail }, { r: 'error', d: 'owner-session-mismatch' });
  assert.deepStrictEqual({ r: entry(res, 'heartbeat').result, d: entry(res, 'heartbeat').detail }, { r: 'error', d: 'owner-session-mismatch' });
  assert.strictEqual(res.verdict, 'unknown');
});

test('AC12.2 a session mismatch does not mask a positive live probe, and a matching or absent sessionId is judged as before', () => {
  const live = verdictOf(fixture({ state: { sessionId: 'B', owner: owner({ sessionId: 'A' }) }, probes: { lockInUse: () => true } }));
  assert.strictEqual(live.verdict, 'live');
  assert.strictEqual(verdictOf(fixture({ state: { sessionId: 's', owner: owner() } })).verdict, 'dead');
  assert.strictEqual(verdictOf(fixture({ state: { sessionId: '', owner: owner() } })).verdict, 'dead');
  assert.strictEqual(verdictOf(fixture({ state: { sessionId: null, owner: owner() } })).verdict, 'dead');
});

test('AC8.1 a now that is not a finite number is unknown with every probe an invalid-now error', () => {
  const fx = fixture({ state: { owner: owner() } });
  for (const now of [NaN, Infinity, '2026-10-24T12:00:00Z', null, {}]) {
    const res = runLiveness(fx.runDir, { now, probes: fx.probes });
    assert.strictEqual(res.verdict, 'unknown', String(now));
    assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
    for (const e of res.evidence) assert.deepStrictEqual({ r: e.result, d: e.detail }, { r: 'error', d: 'invalid-now' });
  }
});

test('AC8.1 a live pid whose stored pidStartedAt is not a string is error invalid-start-time, never pid-reused dead', () => {
  for (const bad of [12345, {}, true]) {
    const res = verdictOf(fixture({ state: { owner: owner({ pidStartedAt: bad }) }, probes: { pidAlive: () => true, pidStartTime: () => 'T1' } }));
    assert.deepStrictEqual({ r: entry(res, 'owner-pid').result, d: entry(res, 'owner-pid').detail }, { r: 'error', d: 'invalid-start-time' }, JSON.stringify(bad));
    assert.strictEqual(res.verdict, 'unknown');
  }
});

test('AC6.1 the owner-events probe is asked for the owner block session id (null when the block has none)', () => {
  const seen = [];
  const ownEventAt = (runDir, sid) => { seen.push(sid); return { lastOwnMs: null, lastSessionEndMs: null }; };
  verdictOf(fixture({ state: { owner: owner({ sessionId: 'A' }) }, probes: { ownEventAt } }));
  verdictOf(fixture({ state: { owner: owner({ sessionId: undefined }) }, probes: { ownEventAt } }));
  verdictOf(fixture({ state: {}, probes: { ownEventAt } }));
  assert.deepStrictEqual(seen, ['A', null, undefined]);
});

test('AC6.1 a session-end event written by another session is not a death witness for the owner', () => {
  const { DEFAULT_PROBES } = require('../../../plugin/bin/lib/run-liveness/probes');
  const mk = (eventSession) => {
    const fx = fixture({
      state: { ...interrupted, owner: owner({ sessionId: 'A', pidStartedAt: null, heartbeatAt: new Date(SESSION_END - 5 * MIN).toISOString() }) },
      probes: { pidAlive: () => true, ownEventAt: DEFAULT_PROBES.ownEventAt },
    });
    fs.writeFileSync(path.join(fx.runDir, 'events.jsonl'), JSON.stringify({ type: 'session-end', ts: new Date(SESSION_END).toISOString(), sessionId: eventSession, attribution: 'owner' }) + '\n');
    return fx;
  };
  assert.strictEqual(verdictOf(mk('A')).verdict, 'dead');
  assert.strictEqual(verdictOf(mk('B')).verdict, 'unknown');
});

// ---- never throws ----
test('runLiveness never throws for any second argument', () => {
  const fx = fixture({ state: { owner: owner() } });
  for (const opts of [null, undefined, 'x', 42, [], { probes: null }, { now: undefined, probes: undefined }]) {
    let res;
    assert.doesNotThrow(() => { res = runLiveness(fx.runDir, opts); }, String(opts));
    assert.ok(['live', 'dead', 'unknown'].includes(res.verdict));
    assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
  }
});

test('runLiveness never throws, even for a missing run directory', () => {
  const res = runLiveness(path.join(os.tmpdir(), 'ct-liveness-missing-dir-xyz'), { now: NOW, probes: baseProbes() });
  assert.ok(['live', 'dead', 'unknown'].includes(res.verdict));
  assert.deepStrictEqual(res.evidence.map((e) => e.probe), PROBE_ORDER);
});
