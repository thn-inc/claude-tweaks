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
const { run } = require('../plugin/bin/friction-events');

function fakeDeps(overrides = {}) {
  const calls = { findRunsByWorktreePath: [], stdout: [], stderr: [] };
  return {
    calls,
    isDirectory: () => true,
    cwd: () => '/wt/current',
    readEvents: (runDir, source) => (runDir === '/run/primary' ? [{ type: 'gate-denial', ts: 't1', _tag: 'primary-fixture' }] : []),
    findRunsByWorktreePath: (cwd, target, excludeDir) => { calls.findRunsByWorktreePath.push({ cwd, target, excludeDir }); return []; },
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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents } = require('../plugin/bin/friction-events');
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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents } = require('../plugin/bin/friction-events');
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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents } = require('../plugin/bin/friction-events');
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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents } = require('../plugin/bin/friction-events');
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

// --- friction-lens vocabulary filter (#2016) --------------------------------
//
// readEvents itself stays general-purpose (the #1337/#1402 filters above are
// about event fidelity, not vocabulary) — the friction-lens vocabulary filter
// is applied once, in run(), against the merged primary+adhoc event list, so
// every other event type a run logs (`commit`, `push`, `pre-compact`,
// `session-end`, `skill_invoked`, …) never reaches stdout.

test('#2016: run() filters the merged event stream to only the five Friction Lens vocabulary types', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents: realReadEvents } = require('../plugin/bin/friction-events');
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
  const deps = fakeDeps({ readEvents: (runDir, source) => (runDir === dir ? realReadEvents(runDir, source) : []) });
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  const out = JSON.parse(deps.calls.stdout[0]);
  assert.deepEqual(
    out.map((e) => e.type).sort(),
    ['ask-user-question', 'bookkeeping-stamp-deny', 'contract-violation', 'gate-denial', 'wd-deny'],
  );
});

test('#2016: a run dir whose events.jsonl holds only commit rows prints []', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { readEvents: realReadEvents } = require('../plugin/bin/friction-events');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-fe-vocab-commits-'));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    ['{"type":"commit","ts":"t1"}', '{"type":"commit","ts":"t2"}'].join('\n') + '\n',
  );
  const deps = fakeDeps({ readEvents: (runDir, source) => (runDir === dir ? realReadEvents(runDir, source) : []) });
  const code = run(['--run', dir], deps);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(deps.calls.stdout[0]), []);
});
