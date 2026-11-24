// tests/bin-lib/station-events/failure-isolation.test.js — the cross-cutting proof for #5902:
// the REAL appendStationEvent pointed at an unwritable main checkout drops every event with one
// stderr line each, and the CLIs it is wired into print the same stdout and exit with the same
// code as a run with no stationEvent at all. The driver's case lives in
// tests/bin-lib/driver/run.test.js beside the run harness it needs. Also pins one real v1 line
// per kind field by field. Fakes follow the gh-api-module-pattern skill: never real gh or git.
'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { chmodDenialSkip } = require('../../helpers/root');
const { appendStationEvent, buildLine, stationEventPath } = require('../../../plugin/bin/lib/station-events/emit');
const { BLOCKER_SNAPSHOT_STATION } = require('../../../plugin/bin/lib/station-events/stations');
const { makeBlockerSnapshotSink } = require('../../../plugin/bin/lib/station-events/blockers');
const claimTargets = require('../../../plugin/bin/lib/claim-targets/claim-targets');
const releaseClaim = require('../../../plugin/bin/release-claim');
const resolveBlockers = require('../../../plugin/bin/resolve-blockers');

const readOnlyDirs = [];
after(() => {
  for (const d of readOnlyDirs) fs.chmodSync(d, 0o755); // root-safe: restores the fixture's own chmod
});

// win32 and root never deny a read-only directory (tests/helpers/root.js).
const DENIAL = chmodDenialSkip('read-only directory not enforceable: running as root');

// A main checkout the emitter cannot write into: read-only before the call, restored in after().
function unwritableRoot() {
  const dir = scratchDir('station-ro-', { realpath: true });
  fs.chmodSync(dir, 0o555);
  readOnlyDirs.push(dir);
  return dir;
}

// A writable main checkout whose existing `.claude-tweaks` is read-only: the recursive mkdir
// succeeds, withLock cannot make its lock dir and fails open, and the append itself is refused.
function readOnlyClaudeTweaksRoot() {
  const root = scratchDir('station-rodir-', { realpath: true });
  const dir = path.join(root, '.claude-tweaks');
  fs.mkdirSync(dir);
  fs.chmodSync(dir, 0o555);
  readOnlyDirs.push(dir);
  return root;
}

const DROP = /^claude-tweaks: station event dropped: append failed: /;
const linesOf = (chunks) => chunks.join('').split('\n').filter(Boolean);

// The real emitter bound to `root`, reporting through the CLI's own injected stderr; counts calls.
function realEmitterAt(root, stderr) {
  const counter = { calls: 0 };
  counter.stationEvent = (e) => { counter.calls += 1; return appendStationEvent(e, { mainRoot: root, stderr }); };
  return counter;
}

// Every emitted event dropped with exactly one stderr line, nothing written, and the CLI's own
// stderr otherwise unchanged.
function assertDroppedOnce(emitter, root, withErr, plainErr) {
  assert.ok(emitter.calls > 0, 'the real emitter was reached');
  const lines = linesOf(withErr);
  assert.equal(lines.filter((l) => DROP.test(l)).length, emitter.calls, lines.join('\n'));
  assert.deepEqual(lines.filter((l) => !DROP.test(l)), linesOf(plainErr));
  assert.equal(fs.existsSync(path.join(root, '.claude-tweaks')), false, 'the read-only root stayed empty');
}

// ---- claim-targets fakes (tests/bin-lib/claim-targets/claim-targets.test.js's shapes) ----
const CT_REPO = 'acme/w';
const CT_NOW = Date.parse('2026-08-17T00:00:00.000Z');

function claimFakes(issues) {
  const marker = JSON.stringify({ runId: 'r1', sessionId: 's', claimedAt: new Date(CT_NOW).toISOString(), ttlHours: 72, host: 'h' });
  const readIdx = {};
  const ghApi = (args) => {
    for (const n of issues) {
      if (args[0] === `repos/${CT_REPO}/contents/claims/issue-${n}.json?ref=claims-registry`) {
        readIdx[n] = (readIdx[n] || 0) + 1;
        return readIdx[n] === 1
          ? { stdout: null, failure: null, status: 404 }
          : { stdout: JSON.stringify({ content: marker, sha: 'sha-confirm' }), failure: null, status: null };
      }
      if (args[0] === '--method' && args[1] === 'PUT' && args[2] === `repos/${CT_REPO}/contents/claims/issue-${n}.json`) {
        return { stdout: '{}', failure: null, status: null };
      }
    }
    throw new Error(`unexpected ghApi ${args.join(' ')}`);
  };
  const gh = (args) => {
    if (args[0] === 'repo' && args[1] === 'view') return `${CT_REPO}\n`;
    if (args[0] === 'label' && (args[1] === 'list' || args[1] === 'create')) return '';
    if (args[0] === 'issue' && (args[1] === 'edit' || args[1] === 'comment')) return '';
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { ghApi, gh };
}

function claimOnce(stationEventFor) {
  const out = []; const err = [];
  const deps = {
    ...claimFakes([720, 721]), now: () => CT_NOW, stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    hostname: 'host1', sessionId: 'sess1', sleep: () => {},
  };
  const emitter = stationEventFor ? stationEventFor(deps.stderr) : null;
  if (emitter) deps.stationEvent = emitter.stationEvent;
  const code = claimTargets.run(['--run-id', 'r1', '--targets', '720,721'], deps);
  return { code, out, err, emitter };
}

// ---- release-claim fakes (tests/bin-lib/release-claim/cli.test.js's shapes) ----
const RC_RUN = '2026-08-16T100000-spec-999';

function releaseRunDir() {
  const root = scratchDir('station-rc-', { realpath: true });
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RC_RUN);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  return { root, runDir };
}

function releaseOnce(stationEventFor) {
  const { root, runDir } = releaseRunDir();
  const out = []; const err = [];
  const blob = JSON.stringify({ runId: RC_RUN, sessionId: 's', claimedAt: '2026-08-16T11:00:00.000Z', ttlHours: 72, host: 'h' });
  const runner = (a) => {
    if (a[0] === 'api' && String(a[1]).startsWith('repos/acme/w/contents/claims/issue-999.json?ref=')) return JSON.stringify({ content: blob, sha: 'blobsha1' });
    if (a[0] === 'api' && a[1] === '--method' && a[2] === 'PUT') return '{}';
    if (a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment')) return '';
    throw new Error(`unexpected ${a.join(' ')}`);
  };
  const deps = {
    runner, ghAvailable: () => true, remoteUrl: () => 'git@github.com:acme/w.git', now: () => Date.parse('2026-08-16T12:00:00Z'),
    cwd: () => process.cwd(), mainRoot: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s), sessionId: 'sess-1',
  };
  const emitter = stationEventFor ? stationEventFor(deps.stderr) : null;
  if (emitter) deps.stationEvent = emitter.stationEvent;
  const code = releaseClaim.run(['999', '--run', runDir, '--reason', 'merged', '--link', 'https://x/1'], deps);
  return { code, out, err, emitter };
}

// ---- resolve-blockers fakes (tests/resolve-blockers-cli.test.js's shapes) ----
const twelveThirteen = () => JSON.stringify({
  data: {
    repository: {
      i12: { number: 12, repository: { nameWithOwner: 'acme/widgets' }, blockedBy: { nodes: [{ number: 6, state: 'OPEN', repository: { nameWithOwner: 'acme/widgets' } }] } },
      i13: { number: 13, repository: { nameWithOwner: 'acme/widgets' }, blockedBy: { nodes: [] } },
    },
  },
});

function resolveOnce(stationEventFor) {
  const out = []; const err = [];
  const deps = {
    ghAvailable: () => true, remoteUrl: () => 'https://github.com/acme/widgets.git', runner: twelveThirteen,
    stdout: (s) => out.push(s), stderr: (s) => err.push(s),
  };
  const emitter = stationEventFor ? stationEventFor(deps.stderr) : null;
  if (emitter) deps.onSnapshot = makeBlockerSnapshotSink({ stationEvent: emitter.stationEvent, sessionId: 's-1', runId: null });
  const code = resolveBlockers.run(['12,13'], deps);
  return { code, out, err, emitter };
}

describe('an unwritable station file never changes a CLI result', () => {
  const cases = [
    ['claim-targets', claimOnce, 8],
    ['release-claim', releaseOnce, 1],
    ['resolve-blockers (onSnapshot)', resolveOnce, 2],
  ];
  for (const [name, once, expectedEvents] of cases) {
    test(`${name}: stdout and exit code match a run without stationEvent; each dropped event is one stderr line`, DENIAL, () => {
      const plain = once(null);
      const root = unwritableRoot();
      const dropped = once((stderr) => realEmitterAt(root, stderr));

      assert.equal(plain.code, 0, linesOf(plain.err).join('\n'));
      assert.equal(dropped.code, plain.code);
      assert.equal(dropped.out.join(''), plain.out.join(''), 'stdout is byte-identical');
      assert.equal(dropped.emitter.calls, expectedEvents);
      assertDroppedOnce(dropped.emitter, root, dropped.err, plain.err);
    });
  }

  const existingDirCases = [
    ['claim-targets', claimOnce, 8],
    ['release-claim', releaseOnce, 1],
  ];
  for (const [name, once, expectedEvents] of existingDirCases) {
    test(`${name}: an existing read-only .claude-tweaks drops each event with one stderr line; stdout and exit code unchanged`, DENIAL, () => {
      const plain = once(null);
      const root = readOnlyClaudeTweaksRoot();
      const dropped = once((stderr) => realEmitterAt(root, stderr));

      assert.equal(plain.code, 0, linesOf(plain.err).join('\n'));
      assert.equal(dropped.code, plain.code);
      assert.equal(dropped.out.join(''), plain.out.join(''), 'stdout is byte-identical');
      assert.equal(dropped.emitter.calls, expectedEvents);
      const lines = linesOf(dropped.err);
      const drops = lines.filter((l) => DROP.test(l));
      assert.equal(drops.length, dropped.emitter.calls, lines.join('\n'));
      for (const l of drops) assert.match(l, /EACCES.*station-events\.jsonl/, 'the append itself was refused, not the mkdir');
      assert.deepEqual(lines.filter((l) => !DROP.test(l)), linesOf(plain.err));
      assert.equal(fs.existsSync(stationEventPath(root)), false, 'no station-events.jsonl was created');
    });
  }
});

describe('the v1 line, one real line per kind', () => {
  const NOW = () => new Date('2026-11-19T10:00:00.000Z');
  const line = (event) => {
    const built = buildLine(event, { now: NOW });
    assert.notEqual(built, null, JSON.stringify(event));
    assert.match(built.at, /Z$/);
    assert.match(built.eventKey, /^[0-9a-f]{32}$/);
    return built;
  };

  test('entered: outcome is null even when the caller passed one; discriminator never reaches the line', () => {
    assert.deepStrictEqual(line({
      repoName: 'acme/widgets', recordNumber: 5902, kind: 'entered', station: 'build', outcome: 'passed',
      lane: 'standard', sessionId: 'sess-1', runId: 'run-1', discriminator: 'd-entered', payload: {},
    }), {
      v: 1, eventKey: line({ repoName: 'acme/widgets', recordNumber: 5902, kind: 'entered', station: 'build', lane: 'standard', runId: 'run-1', discriminator: 'd-entered' }).eventKey,
      repoName: 'acme/widgets', recordNumber: 5902, kind: 'entered', station: 'build',
      at: '2026-11-19T10:00:00.000Z', outcome: null, lane: 'standard', sessionId: 'sess-1', runId: 'run-1', payload: {},
    });
  });

  test('started: a caller at with an offset is written as UTC ending Z', () => {
    const built = line({
      repoName: 'acme/widgets', recordNumber: 7, kind: 'started', station: 'test', at: '2026-11-19T11:30:00+01:00',
      lane: 'driver', sessionId: null, runId: '2026-11-12T100000-drive-7', discriminator: 'test@1', payload: { step: 'test' },
    });
    assert.deepStrictEqual(built, {
      v: 1, eventKey: built.eventKey, repoName: 'acme/widgets', recordNumber: 7, kind: 'started', station: 'test',
      at: '2026-11-19T10:30:00.000Z', outcome: null, lane: 'driver', sessionId: null, runId: '2026-11-12T100000-drive-7',
      payload: { step: 'test' },
    });
  });

  test('exited: the only kind that keeps its outcome', () => {
    const built = line({
      repoName: 'acme/widgets', recordNumber: 7, kind: 'exited', station: 'review', outcome: 'returned',
      lane: 'express', sessionId: 'sess-2', runId: 'run-2', discriminator: 'review@2', payload: { step: 'review' },
    });
    assert.deepStrictEqual(built, {
      v: 1, eventKey: built.eventKey, repoName: 'acme/widgets', recordNumber: 7, kind: 'exited', station: 'review',
      at: '2026-11-19T10:00:00.000Z', outcome: 'returned', lane: 'express', sessionId: 'sess-2', runId: 'run-2',
      payload: { step: 'review' },
    });
  });

  test('session_bound: no lane is unknown, an empty runId is null, an absent payload is {}', () => {
    const built = line({
      repoName: 'acme/widgets', recordNumber: 5902, kind: 'session_bound', station: 'build',
      sessionId: 'sess-host', runId: '', discriminator: '2026-11-19T09:00:00.000Z',
    });
    assert.deepStrictEqual(built, {
      v: 1, eventKey: built.eventKey, repoName: 'acme/widgets', recordNumber: 5902, kind: 'session_bound', station: 'build',
      at: '2026-11-19T10:00:00.000Z', outcome: null, lane: 'unknown', sessionId: 'sess-host', runId: null, payload: {},
    });
  });

  test('blockers: filed under BLOCKER_SNAPSHOT_STATION with the snapshot as payload', () => {
    const payload = { blockedBy: [700], openBlocker: true };
    const built = line({
      repoName: 'acme/widgets', recordNumber: 12, kind: 'blockers', station: BLOCKER_SNAPSHOT_STATION,
      lane: 'unknown', sessionId: 's-1', runId: null, discriminator: 'blockers@1', payload,
    });
    assert.deepStrictEqual(built, {
      v: 1, eventKey: built.eventKey, repoName: 'acme/widgets', recordNumber: 12, kind: 'blockers', station: 'authorize',
      at: '2026-11-19T10:00:00.000Z', outcome: null, lane: 'unknown', sessionId: 's-1', runId: null, payload,
    });
  });

  test('eventKey: the same fact keys the same at any time, and differs by discriminator', () => {
    const base = { repoName: 'acme/widgets', recordNumber: 7, kind: 'exited', station: 'review', outcome: 'returned', runId: 'run-2', discriminator: 'review@2' };
    assert.equal(buildLine({ ...base, at: '2026-01-01T00:00:00Z' }).eventKey, buildLine({ ...base, at: '2026-12-31T00:00:00Z' }).eventKey);
    assert.notEqual(buildLine(base).eventKey, buildLine({ ...base, discriminator: 'review@3' }).eventKey);
  });

  test('a main checkout with no .claude-tweaks directory gets one: the line is written, no stderr', () => {
    const root = scratchDir('station-fresh-', { realpath: true });
    assert.equal(fs.existsSync(path.join(root, '.claude-tweaks')), false);
    const err = [];
    const event = {
      repoName: 'acme/widgets', recordNumber: 5902, kind: 'entered', station: 'build', at: '2026-11-19T10:00:00.000Z',
      lane: 'standard', sessionId: 'sess-1', runId: 'run-1', discriminator: 'd-entered',
    };
    assert.deepStrictEqual(appendStationEvent(event, { mainRoot: root, stderr: (s) => err.push(s) }), { written: true });
    assert.deepStrictEqual(err, []);
    const text = fs.readFileSync(stationEventPath(root), 'utf8');
    assert.equal(text, `${JSON.stringify(buildLine(event))}\n`);
  });
});
