// tests/friction-events-cli.test.js — in-process tests for
// bin/friction-events.js's run(argv, deps), mirroring
// tests/resolve-blockers-cli.test.js's deps-injection style. Covers
// argument parsing and the merged-events output shape (#500); the
// underlying findRunsByWorktreePath lookup already has coverage in
// tests/hooks-context.test.js and is not re-verified here beyond its own
// call shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, readEvents } = require('../plugin/bin/friction-events');

function fakeDeps(overrides = {}) {
  const calls = { findRunsByWorktreePath: [], findAdHocRunsBySessionId: [], stdout: [], stderr: [] };
  return {
    calls,
    isDirectory: () => true,
    cwd: () => '/wt/current',
    readEvents: (runDir, source) => (runDir === '/run/primary' ? [{ type: 'gate-denial', ts: 't1', _tag: 'primary-fixture' }] : []),
    findRunsByWorktreePath: (cwd, target, excludeDir) => { calls.findRunsByWorktreePath.push({ cwd, target, excludeDir }); return []; },
    sessionId: () => null,
    findAdHocRunsBySessionId: (cwd, sessionId, excludeDir) => { calls.findAdHocRunsBySessionId.push({ cwd, sessionId, excludeDir }); return []; },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

// --- argument parsing -----------------------------------------------------

test('missing --run is a malformed invocation — exit 1, usage on stderr', () => {
  const deps = fakeDeps({ isDirectory: () => { throw new Error('should not be called'); } });
  const code = run([], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /missing required --run/);
  assert.match(deps.calls.stderr.join(''), /usage: friction-events\.js/);
});

test('unknown flag is a malformed invocation — exit 1', () => {
  const deps = fakeDeps();
  const code = run(['--run', '/run/primary', '--bogus'], deps);
  assert.equal(code, 1);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('--help prints usage and exits 0 without touching the filesystem', () => {
  const deps = fakeDeps({ isDirectory: () => { throw new Error('should not be called'); } });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: friction-events\.js/);
});

test('--run naming a non-directory — exit 2', () => {
  const deps = fakeDeps({ isDirectory: () => false });
  const code = run(['--run', '/nope'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /is not a directory/);
});

// --- worktree resolution ---------------------------------------------------

test('defaults --worktree to deps.cwd() when omitted', () => {
  const deps = fakeDeps();
  run(['--run', '/run/primary'], deps);
  assert.equal(deps.calls.findRunsByWorktreePath[0].target, '/wt/current');
});

test('an explicit --worktree overrides deps.cwd()', () => {
  const deps = fakeDeps();
  run(['--run', '/run/primary', '--worktree', '/wt/explicit'], deps);
  assert.equal(deps.calls.findRunsByWorktreePath[0].target, '/wt/explicit');
});

test('excludes the primary run dir from the sibling lookup', () => {
  const deps = fakeDeps();
  run(['--run', '/run/primary'], deps);
  assert.equal(deps.calls.findRunsByWorktreePath[0].excludeDir, '/run/primary');
});

// --- output shape ------------------------------------------------------

test('success: primary events on stdout as a JSON array, tagged _source primary, exit 0', () => {
  const deps = fakeDeps();
  const code = run(['--run', '/run/primary'], deps);
  assert.equal(code, 0);
  const out = JSON.parse(deps.calls.stdout[0]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'gate-denial');
  assert.equal(out[0]._tag, 'primary-fixture');
});

test('no primary events and no siblings — empty JSON array, not an error', () => {
  const deps = fakeDeps({ readEvents: () => [] });
  const code = run(['--run', '/run/other'], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), []);
});

test('unions sibling (ad-hoc) run events with the primary run\'s, tagged _source adhoc', () => {
  const deps = fakeDeps({
    findRunsByWorktreePath: () => [{ runDir: '/run/adhoc-1', state: { worktree: '/wt/current' } }],
    readEvents: (runDir, source) => (runDir === '/run/primary'
      ? [{ type: 'gate-denial', ts: 't1', _source: source }]
      : runDir === '/run/adhoc-1' ? [{ type: 'wd-deny', ts: 't0', _source: source }] : []),
  });
  const code = run(['--run', '/run/primary'], deps);
  assert.equal(code, 0);
  const out = JSON.parse(deps.calls.stdout[0]);
  assert.equal(out.length, 2);
  assert.equal(out.find((e) => e.type === 'gate-denial')._source, 'primary');
  assert.equal(out.find((e) => e.type === 'wd-deny')._source, 'adhoc');
});

test('unions events from more than one sibling ad-hoc run dir', () => {
  const deps = fakeDeps({
    readEvents: () => [],
    findRunsByWorktreePath: () => [
      { runDir: '/run/adhoc-2', state: {} },
      { runDir: '/run/adhoc-1', state: {} },
    ],
  });
  deps.readEvents = (runDir) => (
    runDir === '/run/adhoc-1' ? [{ type: 'wd-deny', ts: 't0' }]
      : runDir === '/run/adhoc-2' ? [{ type: 'ask-user-question', ts: 't2' }]
        : []
  );
  const code = run(['--run', '/run/primary'], deps);
  assert.equal(code, 0);
  const out = JSON.parse(deps.calls.stdout[0]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((e) => e.type).sort(), ['ask-user-question', 'wd-deny']);
});

// --- real readEvents behavior (against the actual filesystem-reading impl) ---

test('the real readEvents helper parses events.jsonl, skips malformed lines, returns [] on a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-events-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    '{"type":"gate-denial","ts":"t1"}\nnot json\n{"type":"wd-deny","ts":"t2"}\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 2);
  assert.equal(events[0]._source, 'primary');
  assert.equal(events[0]._runDir, dir);
  assert.deepEqual(readEvents(path.join(dir, 'does-not-exist'), 'primary'), []);
});

// #1337: a gate-denial event the test suite's own exercise of the deny logic
// produced (tagged `test: true` by pre-tool-use.js's CT_HOOKS_TEST_MODE gate)
// must not inflate the aggregate gate-denial count readEvents feeds into
// friction-events.js's output — while a real, untagged gate-denial (or any
// other event type, even one that happens to carry `test: true`) still comes
// through unfiltered.
test('#1337: readEvents drops a test-tagged gate-denial event but keeps a real one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-events-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"gate-denial","ts":"t1","tool":"Write","test":true}',
      '{"type":"gate-denial","ts":"t2","tool":"Edit"}',
      '{"type":"wd-deny","ts":"t3","test":true}',
    ].join('\n') + '\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 2, 'the test-tagged gate-denial must be dropped, the other two kept');
  assert.equal(events.filter((e) => e.type === 'gate-denial').length, 1);
  assert.equal(events.find((e) => e.type === 'gate-denial').tool, 'Edit');
  assert.equal(events.find((e) => e.type === 'wd-deny').test, true, 'filter is scoped to gate-denial, not event type generally');
});

// #1402: a fallback-attributed event is "evidence that may belong to another
// session" by appendEvent's own doc comment (context.js) — a run's own
// events.jsonl can carry one that was actually misattributed from a
// concurrent sibling worktree (the #1033 shape). readEvents drops any such
// event from the `primary` source, since this CLI has no way to recover
// which worktree an already-written one actually belongs to; a real,
// unattributed event (or any event on the `adhoc` source, already
// worktree-validated by findRunsByWorktreePath) still comes through.
test('#1402: readEvents drops a primary fallback-attributed event but keeps a real one and an adhoc fallback one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-events-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"commit","ts":"t1","attribution":"fallback"}',
      '{"type":"worktree-staleness","ts":"t2"}',
    ].join('\n') + '\n',
  );
  const primary = readEvents(dir, 'primary');
  assert.equal(primary.length, 1, 'the fallback-attributed primary event must be dropped, the real one kept');
  assert.equal(primary[0].type, 'worktree-staleness');

  const adhoc = readEvents(dir, 'adhoc');
  assert.equal(adhoc.length, 2, 'the adhoc source is unaffected — already worktree-validated by findRunsByWorktreePath');
});

// #2350: a lenient-variant contract-violation event is subagent-stop.js's
// own COMPLIANT case (an old-shape dispatch template, tracked for migration
// visibility only) — it must never inflate the Friction lens's count the
// same way a genuine violation does.
test('#2350: readEvents drops a lenient-variant contract-violation event but keeps a genuine violation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-events-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"contract-violation","ts":"t1","firstLine":"- **Status:** DONE","variant":"lenient"}',
      '{"type":"contract-violation","ts":"t2","firstLine":"The call site is compatible."}',
    ].join('\n') + '\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'the lenient-variant event must be dropped, the genuine violation kept');
  assert.equal(events[0].firstLine, 'The call site is compatible.');
});

// --- pre-claim window exclusion (#2989) -------------------------------------
//
// A run directory can be mkdir-only minted well before the pipeline that
// owns it ever claims it. These tests reproduce that window — a canonical
// `{ISO-timestamp}-{slug}` run-id directory name plus a decisions.md whose
// first entry logs the real claim time — and assert readEvents excludes any
// events.jsonl line timestamped earlier than that claim.

function withTz(tz, fn) {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

test('#2989: readEvents excludes an event timestamped before the run dir\'s first decisions.md entry', () => withTz('UTC', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  // Minted at 12:00:00Z; claimed (decisions.md's first entry) at 12:02:00Z.
  const dir = path.join(parent, '2026-01-01T120000-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"ask-user-question","ts":"2026-01-01T12:01:00.000Z"}',
      '{"type":"ask-user-question","ts":"2026-01-01T12:03:00.000Z"}',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '## /flow\n- AUTO 12:02:00 — Step 2.8: claimed #999. Reversibility: high.\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'only the post-claim event should survive');
  assert.equal(events[0].ts, '2026-01-01T12:03:00.000Z');
}));

test('#2989: readEvents applies no pre-claim filtering when the run dir has no decisions.md yet', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  const dir = path.join(parent, '2026-01-01T120000-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"ask-user-question","ts":"2026-01-01T12:00:30.000Z"}\n');
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'no decisions.md yet — fail open, no exclusion');
});

test('#2989: readEvents applies no pre-claim filtering on a non-canonical directory name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-noncanonical-'));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"ask-user-question","ts":"2026-01-01T12:00:30.000Z"}\n');
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'no run-id-shaped name — mint time can\'t be established, so no exclusion');
});

test('#2989: readEvents handles a mint/claim pair that straddles a UTC midnight rollover', () => withTz('UTC', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  // Minted at 23:59:00Z on 2026-01-01; decisions.md's first entry logs only
  // HH:MM:SS (00:00:30), which is actually the next calendar day.
  const dir = path.join(parent, '2026-01-01T235900-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"ask-user-question","ts":"2026-01-01T23:59:30.000Z"}',
      '{"type":"ask-user-question","ts":"2026-01-02T00:01:00.000Z"}',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '## /flow\n- AUTO 00:00:30 — Step 2.8: claimed #999. Reversibility: high.\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'the pre-claim event (23:59:30) must be excluded even across the midnight rollover');
  assert.equal(events[0].ts, '2026-01-02T00:01:00.000Z');
}));

// #3442: decisions.md logs the claim as the writer's LOCAL wall-clock time,
// while the run-dir mint name is UTC. The two tests below pin a non-UTC
// machine (Europe/Copenhagen, CEST) so a regression to a UTC reading of the
// claim time fails here.

test('#3442 AC1.1: readEvents reads the decisions.md claim time as local time (TZ=Europe/Copenhagen)', () => withTz('Europe/Copenhagen', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  // Minted at 18:39:00Z (20:39 local); claimed at 20:39:18 local = 18:39:18Z.
  const dir = path.join(parent, '2026-10-17T183900-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"ask-user-question","ts":"2026-10-17T18:38:00.000Z"}',
      '{"type":"ask-user-question","ts":"2026-10-17T18:40:00.000Z"}',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '## /flow\n- AUTO 20:39:18 — Step 2.8: claimed #999. Reversibility: high.\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'the pre-claim event (18:38Z) must be excluded; the post-claim event kept');
  assert.equal(events[0].ts, '2026-10-17T18:40:00.000Z');
}));

test('#3442: a mint/claim pair straddling a local (non-UTC) midnight lands on the correct local day', () => withTz('Europe/Copenhagen', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  // Minted at 22:30:00Z on 2026-10-17 (00:30 local on 2026-10-18); the
  // first decisions.md entry logs 00:31:00 local, which is 22:31:00Z.
  const dir = path.join(parent, '2026-10-17T223000-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"ask-user-question","ts":"2026-10-17T22:30:30.000Z"}',
      '{"type":"ask-user-question","ts":"2026-10-17T22:32:00.000Z"}',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '## /flow\n- AUTO 00:31:00 — Step 2.8: claimed #999. Reversibility: high.\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'the pre-claim event (22:30:30Z) must be excluded across the local midnight');
  assert.equal(events[0].ts, '2026-10-17T22:32:00.000Z');
}));

test('#3442: a claim logged after local midnight, past a mint before it, rolls to the next local day', () => withTz('Europe/Copenhagen', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-claim-'));
  // Minted at 21:50:00Z on 2026-10-17 (23:50 local on 10-17); the first
  // decisions.md entry logs 00:05:00 local, which is 10-18 00:05 local
  // (22:05:00Z) — read on the mint's own local day it lands before the mint,
  // so computeClaimBoundary must take its rollover branch.
  const dir = path.join(parent, '2026-10-17T215000-record-999');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"ask-user-question","ts":"2026-10-17T21:55:00.000Z"}',
      '{"type":"ask-user-question","ts":"2026-10-17T22:10:00.000Z"}',
    ].join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '## /flow\n- AUTO 00:05:00 — Step 2.8: claimed #999. Reversibility: high.\n',
  );
  const events = readEvents(dir, 'primary');
  assert.equal(events.length, 1, 'the pre-claim event (21:55Z, 23:55 local) must be excluded; the post-claim event kept');
  assert.equal(events[0].ts, '2026-10-17T22:10:00.000Z');
}));

// --- friction-lens vocabulary filter (#2016) --------------------------------
//
// readEvents itself stays general-purpose (the #1337/#1402 filters above are
// about event fidelity, not vocabulary) — the friction-lens vocabulary filter
// is applied once, in run(), against the merged primary+adhoc event list, so
// every other event type a run logs (`commit`, `push`, `pre-compact`,
// `session-end`, `skill_invoked`, …) never reaches stdout.

test('#2016: run() filters the merged event stream to only the five Friction Lens vocabulary types', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-vocab-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    [
      '{"type":"commit","ts":"t1"}',
      '{"type":"pre-compact","ts":"t2"}',
      '{"type":"session-end","ts":"t3"}',
      '{"type":"skill_invoked","ts":"t4"}',
      '{"type":"push","ts":"t5"}',
      '{"type":"wd-deny","ts":"t6"}',
      '{"type":"gate-denial","ts":"t7"}',
      '{"type":"bookkeeping-stamp-deny","ts":"t8"}',
      '{"type":"contract-violation","ts":"t9"}',
      '{"type":"ask-user-question","ts":"t10"}',
    ].join('\n') + '\n',
  );
  const deps = fakeDeps({ readEvents: (runDir, source) => (runDir === dir ? readEvents(runDir, source) : []) });
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  const out = JSON.parse(deps.calls.stdout[0]);
  assert.deepEqual(
    out.map((e) => e.type).sort(),
    ['ask-user-question', 'bookkeeping-stamp-deny', 'contract-violation', 'gate-denial', 'wd-deny'],
  );
});

test('#2016: a run dir whose events.jsonl holds only commit rows prints []', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-vocab-commits-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    ['{"type":"commit","ts":"t1"}', '{"type":"commit","ts":"t2"}'].join('\n') + '\n',
  );
  const deps = fakeDeps({ readEvents: (runDir, source) => (runDir === dir ? readEvents(runDir, source) : []) });
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), []);
});

// --- #2783: union ad-hoc dirs owned by the current session -----------------

test('--session unions this session\'s ad-hoc dirs even when the worktree path no longer matches (#2783)', () => {
  const deps = fakeDeps({
    readEvents: (runDir, source) => (runDir === '/run/adhoc-1' ? [{ type: 'wd-guard-refusal', reason: 'harness-worktree-isolation', _source: source, _runDir: runDir }] : []),
    findAdHocRunsBySessionId: () => [{ runDir: '/run/adhoc-1', state: { sessionId: 'S1' } }],
  });
  assert.strictEqual(run(['--run', '/run/primary', '--session', 'S1'], deps), 0);
  const out = JSON.parse(deps.calls.stdout.join(''));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0]._source, 'adhoc');
  assert.strictEqual(out[0].type, 'wd-guard-refusal');
});

test('session id defaults to deps.sessionId() (CLAUDE_CODE_SESSION_ID) and excludes the primary run', () => {
  const deps = fakeDeps({ sessionId: () => 'S-env' });
  run(['--run', '/run/primary'], deps);
  assert.deepStrictEqual(deps.calls.findAdHocRunsBySessionId.map((c) => c.sessionId), ['S-env']);
  assert.strictEqual(deps.calls.findAdHocRunsBySessionId[0].excludeDir, '/run/primary');
});

test('no session id at all: the session lookup is not attempted', () => {
  const deps = fakeDeps();
  run(['--run', '/run/primary'], deps);
  assert.deepStrictEqual(deps.calls.findAdHocRunsBySessionId, []);
});

test('an ad-hoc dir found by BOTH the worktree and the session lookup is read once', () => {
  let reads = 0;
  const deps = fakeDeps({
    readEvents: (runDir, source) => {
      if (runDir !== '/run/adhoc-1') return [];
      reads += 1;
      return [{ type: 'gate-denial', _source: source, _runDir: runDir }];
    },
    findRunsByWorktreePath: () => [{ runDir: '/run/adhoc-1' }],
    findAdHocRunsBySessionId: () => [{ runDir: '/run/adhoc-1' }],
  });
  run(['--run', '/run/primary', '--session', 'S1'], deps);
  assert.strictEqual(reads, 1);
  assert.strictEqual(JSON.parse(deps.calls.stdout.join('')).length, 1);
});
