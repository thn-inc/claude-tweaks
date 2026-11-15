'use strict';
// plugin/bin/ci-gate-record.js — the sanctioned writer of #5160's `ci-gate`
// event. Every test drives run(argv, deps) in-process with the real
// resolveTarget, appendEvent and readFile, and a fake gh runner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  run, parseArgs, realDeps, makeRealDeps, computeCiWallMs, VERDICTS, RUN_LIST_FIELDS, CI_GATE_GH_TIMEOUT_MS,
} = require('../../../plugin/bin/ci-gate-record');

const RUN_ID = '2026-11-12T102742-record-5160';
const SHA = 'a'.repeat(40);
const NOW_MS = 1125000;
const { sep } = path;

// Task 2's fixture shape (tests/bin-lib/stage-item/resolve-target-refusals.test.js):
// a fake main checkout (.git directory) holding the real run dir, plus a linked
// worktree (.git FILE) carrying a worktree-local shadow. `worktree` is the cwd of
// the simulated worktree-isolated session; mainRoot is left to resolveTarget.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cigaterecord-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const singleDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(main, '.claude', 'worktrees', 'flow-5160');
  const shadow = path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/flow-5160\n');
  return { singleDir, worktree, shadow, outside };
}

function ghRun(over) {
  return {
    attempt: 1, conclusion: 'success', databaseId: 1, event: 'pull_request',
    status: 'completed', workflowName: 'test', ...over,
  };
}

const A = ghRun({
  databaseId: 101, workflowName: 'test', createdAt: '2026-11-12T10:00:00Z',
  startedAt: '2026-11-12T10:00:05Z', updatedAt: '2026-11-12T10:12:00Z',
});
const B = ghRun({
  databaseId: 102, workflowName: 'lint', conclusion: 'failure', createdAt: '2026-11-12T10:02:00Z',
  startedAt: '2026-11-12T10:02:05Z', updatedAt: '2026-11-12T10:20:00Z',
});
const C = ghRun({
  databaseId: 103, workflowName: 'windows', status: 'in_progress', conclusion: '',
  createdAt: '2026-11-12T09:00:00Z', startedAt: '2026-11-12T09:00:05Z', updatedAt: '2026-11-12T11:00:00Z',
});
const D = ghRun({
  databaseId: 104, workflowName: 'e2e', conclusion: 'cancelled', createdAt: '2026-11-12T10:01:00Z',
  startedAt: '2026-11-12T10:01:05Z', updatedAt: '2026-11-12T10:25:00Z',
});
const RUNS_AC2 = [A, B, C];

function harness(t, { runs = RUNS_AC2, ghStdout } = {}) {
  const fx = fixture(t);
  const calls = []; const out = []; const err = [];
  const fakeGh = (args) => {
    calls.push(args);
    if (args[0] === 'run' && args[1] === 'list') return ghStdout !== undefined ? ghStdout : JSON.stringify(runs);
    throw new Error('unexpected ' + args.join(' '));
  };
  const deps = {
    ...realDeps,
    cwd: () => fx.worktree,
    now: () => NOW_MS,
    gh: fakeGh,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  const eventsPath = path.join(fs.realpathSync(fx.singleDir), 'events.jsonl');
  return { ...fx, calls, out, err, deps, eventsPath };
}

function argvFor(h, over = {}) {
  const v = {
    '--pr': '123', '--head-sha': SHA, '--verdict': 'green', '--gate-start-epoch': '1000', '--run': h.singleDir, ...over,
  };
  const argv = [];
  for (const [k, val] of Object.entries(v)) if (val !== null) argv.push(k, val);
  return argv;
}

function readLines(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function lastEvent(p) {
  const lines = readLines(p);
  return JSON.parse(lines[lines.length - 1]);
}

const SEED = JSON.stringify({ ts: '2026-11-12T09:00:00.000Z', type: 'skill_invoked', skill: 'x' }) + '\n';

for (const verdict of VERDICTS) {
  test(`AC1.1 AC1.3: --verdict ${verdict} appends exactly one ci-gate line with pr, headSha, verdict, gateWaitMs, runsReadAt, runs[], ciWallMs`, (t) => {
    const h = harness(t);
    fs.writeFileSync(h.eventsPath, SEED);
    assert.equal(run(argvFor(h, { '--verdict': verdict }), h.deps), 0, h.err.join(''));
    const lines = readLines(h.eventsPath);
    assert.equal(lines.length, 2);
    const ev = JSON.parse(lines[1]);
    assert.equal(ev.type, 'ci-gate');
    assert.equal(ev.pr, 123);
    assert.equal(ev.headSha, SHA);
    assert.equal(ev.verdict, verdict);
    assert.equal(ev.gateWaitMs, 125000);
    assert.equal(ev.runsReadAt, '1970-01-01T00:18:45.000Z');
    assert.equal(ev.ciWallMs, 1200000);
    assert.equal(ev.runs.length, 3);
    assert.deepEqual(ev.runs[0], {
      workflow: 'test', event: 'pull_request', status: 'completed', createdAt: '2026-11-12T10:00:00Z',
      startedAt: '2026-11-12T10:00:05Z', updatedAt: '2026-11-12T10:12:00Z', attempt: 1, conclusion: 'success', databaseId: 101,
    });
  });
}

test('AC1.2: --gate-start-epoch 1000 with now 1125 s gives gateWaitMs 125000', (t) => {
  const h = harness(t);
  assert.equal(run(argvFor(h, { '--gate-start-epoch': '1000' }), h.deps), 0, h.err.join(''));
  assert.equal(lastEvent(h.eventsPath).gateWaitMs, 125000);
});

test('AC2.1: completed runs created 10:00:00/10:02:00 and updated 10:12:00/10:20:00 give ciWallMs 1200000', (t) => {
  const h = harness(t, { runs: [A, B] });
  assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
  assert.equal(lastEvent(h.eventsPath).ciWallMs, 1200000);
  assert.equal(computeCiWallMs([A, B]), 1200000);
});

test('AC2.2: a still-in_progress run is excluded from both the updatedAt max and the createdAt min', (t) => {
  const h = harness(t, { runs: RUNS_AC2 });
  assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
  const ev = lastEvent(h.eventsPath);
  assert.equal(ev.ciWallMs, 1200000);
  assert.equal(ev.runs.length, 3, 'the in_progress run is still recorded, only excluded from ciWallMs');
});

test('AC2.3: a cancelled completed run is included', (t) => {
  const h = harness(t, { runs: [A, D] });
  assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
  assert.equal(lastEvent(h.eventsPath).ciWallMs, 1500000);
});

test('AC2.4: with no completed run (or gh returns []) ciWallMs is null and the event is still written, exit 0', (t) => {
  for (const runs of [[C], []]) {
    const h = harness(t, { runs });
    assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
    const ev = lastEvent(h.eventsPath);
    assert.equal(ev.type, 'ci-gate');
    assert.equal(ev.ciWallMs, null);
    assert.equal(ev.runs.length, runs.length);
  }
});

test('AC3.1: --verdict timeout-park writes pendingAtBound: true', (t) => {
  const h = harness(t);
  assert.equal(run(argvFor(h, { '--verdict': 'timeout-park' }), h.deps), 0, h.err.join(''));
  assert.equal(lastEvent(h.eventsPath).pendingAtBound, true);
});

test('AC3.2: --verdict green and --verdict red write no pendingAtBound key', (t) => {
  for (const verdict of ['green', 'red']) {
    const h = harness(t);
    assert.equal(run(argvFor(h, { '--verdict': verdict }), h.deps), 0, h.err.join(''));
    assert.equal('pendingAtBound' in lastEvent(h.eventsPath), false, verdict);
  }
});

test('verdict comes from the flag only: green is written even when the snapshot holds a failed run', (t) => {
  const h = harness(t, { runs: [A, B] });
  assert.equal(run(argvFor(h, { '--verdict': 'green' }), h.deps), 0, h.err.join(''));
  const ev = lastEvent(h.eventsPath);
  assert.equal(ev.verdict, 'green');
  assert.equal(ev.runs[1].conclusion, 'failure');
});

test('AC4.1: realDeps.resolveTarget is stage-item/write.js resolveTarget (imported, not re-derived)', () => {
  assert.equal(realDeps.resolveTarget, require('../../../plugin/bin/lib/stage-item/write').resolveTarget);
});

test('AC4.2: the worktree-local shadow exits 3 and its pre-seeded events.jsonl is byte-unchanged', (t) => {
  const h = harness(t);
  const shadowEvents = path.join(h.shadow, 'events.jsonl');
  fs.writeFileSync(shadowEvents, 'sentinel\n');
  assert.equal(run(argvFor(h, { '--run': h.shadow }), h.deps), 3);
  assert.match(h.err.join(''), /not anchored under the main checkout/);
  assert.equal(fs.readFileSync(shadowEvents, 'utf8'), 'sentinel\n');
  assert.equal(fs.existsSync(path.join(h.singleDir, 'events.jsonl')), false);
  assert.equal(h.calls.length, 0, 'no gh call before the anchoring refusal');
});

// The probe-confirmed refusals from tests/bin-lib/stage-item/resolve-target-refusals.test.js,
// minus C1 (AC4.2 above). C3a/C3b/C4 were reported NOT-REFUSED and are not tested here.
test('AC4.3–AC4.5 and AC4.7: each probe-confirmed case exits 3 with nothing written', (t) => {
  const up = (n) => Array(n).fill('..').join(sep);
  const cases = {
    C2a: (h) => ({ runDir: h.singleDir + sep + up(4) + sep + 'outside', reason: /not anchored under the main checkout/ }),
    C2b: (h) => ({ runDir: path.normalize(h.singleDir + sep + up(4) + sep + 'outside'), reason: /not anchored under the main checkout/ }),
    C5a: (h) => ({ runDir: h.outside + sep, reason: /not anchored under the main checkout/ }),
    C5b: (h) => ({ runDir: h.shadow + sep, reason: /not anchored under the main checkout/ }),
    C6: () => ({ runDir: `https://example.com/.claude-tweaks/pipelines/${RUN_ID}`, reason: /run dir does not exist/ }),
  };
  for (const [id, make] of Object.entries(cases)) {
    const h = harness(t);
    const { runDir, reason } = make(h);
    assert.equal(run(argvFor(h, { '--run': runDir }), h.deps), 3, id);
    assert.match(h.err.join(''), reason, id);
    for (const dir of [h.singleDir, h.shadow, h.outside]) {
      assert.equal(fs.existsSync(path.join(dir, 'events.jsonl')), false, `${id}: ${dir}`);
    }
    assert.equal(h.calls.length, 0, id);
  }
});

test('AC4.8: each missing required flag exits 2 and calls no gh', (t) => {
  for (const flag of ['--pr', '--head-sha', '--verdict', '--gate-start-epoch', '--run']) {
    const h = harness(t);
    assert.equal(run(argvFor(h, { [flag]: null }), h.deps), 2, flag);
    assert.match(h.err.join(''), new RegExp(`${flag} .*is required`), flag);
    assert.equal(h.calls.length, 0, flag);
    assert.equal(fs.existsSync(h.eventsPath), false, flag);
  }
});

test('AC9.1: a failing gh run list exits 2 and appends no event', (t) => {
  const h = harness(t);
  h.deps.gh = (args) => {
    h.calls.push(args);
    const e = new Error('Command failed: gh run list');
    e.stderr = 'HTTP 502: Bad Gateway\nsecond line\n';
    throw e;
  };
  assert.equal(run(argvFor(h), h.deps), 2);
  assert.equal(h.err.join(''), 'ci-gate-record.js: gh run list failed: HTTP 502: Bad Gateway\n');
  assert.equal(h.calls.length, 1);
  assert.equal(fs.existsSync(h.eventsPath), false);
});

test('gh argv: exact field list and --repo forwarding', (t) => {
  assert.equal(RUN_LIST_FIELDS, 'createdAt,startedAt,updatedAt,attempt,event,conclusion,status,workflowName,databaseId');
  const base = ['run', 'list', '--commit', SHA, '--limit', '100', '--json', RUN_LIST_FIELDS];
  const h = harness(t);
  assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
  assert.deepEqual(h.calls, [base]);
  const h2 = harness(t);
  assert.equal(run([...argvFor(h2), '--repo', 'o/r'], h2.deps), 0, h2.err.join(''));
  assert.deepEqual(h2.calls, [[...base, '--repo', 'o/r']]);
});

test('malformed invocations exit 2 with nothing written', (t) => {
  const cases = {
    'trailing bare --run': (h) => [...argvFor(h, { '--run': null }), '--run'],
    'empty --gate-start-epoch': (h) => argvFor(h, { '--gate-start-epoch': '' }),
    'short --head-sha': (h) => argvFor(h, { '--head-sha': 'abc' }),
    'unknown --verdict': (h) => argvFor(h, { '--verdict': 'amber' }),
    '--pr 0': (h) => argvFor(h, { '--pr': '0' }),
    '--pr 1.5': (h) => argvFor(h, { '--pr': '1.5' }),
    '--repo -x': (h) => [...argvFor(h), '--repo', '-x'],
    'constructor x': (h) => [...argvFor(h), 'constructor', 'x'],
    'unknown flag': (h) => [...argvFor(h), '--bogus'],
  };
  for (const [label, make] of Object.entries(cases)) {
    const h = harness(t);
    const argv = make(h);
    assert.ok('error' in parseArgs(argv), label);
    assert.equal(run(argv, h.deps), 2, label);
    assert.match(h.err.join(''), /usage: ci-gate-record\.js/, label);
    assert.equal(h.calls.length, 0, label);
    assert.equal(fs.existsSync(h.eventsPath), false, label);
  }
});

test('empty --gate-start-epoch exits 2 (Review Focus 1) — never a gateWaitMs: NaN event', (t) => {
  const h = harness(t);
  assert.equal(run(argvFor(h, { '--gate-start-epoch': '' }), h.deps), 2);
  assert.match(h.err.join(''), /--gate-start-epoch/);
  assert.equal(fs.existsSync(h.eventsPath), false);
});

test('unreadable gh output exits 2: not JSON, not an array, a non-object entry, a completed run with createdAt "nope"', (t) => {
  const cases = {
    'not JSON': 'not json',
    'not an array': '{}',
    'null entry': '[null]',
    'array entry': '[[]]',
    'bad createdAt': JSON.stringify([A, { ...B, createdAt: 'nope' }]),
  };
  for (const [label, ghStdout] of Object.entries(cases)) {
    const h = harness(t, { ghStdout });
    assert.equal(run(argvFor(h), h.deps), 2, label);
    assert.match(h.err.join(''), /^ci-gate-record\.js: /, label);
    assert.equal(fs.existsSync(h.eventsPath), false, label);
  }
  assert.throws(() => computeCiWallMs([{ ...A, createdAt: 'nope' }]), TypeError);
  assert.throws(() => computeCiWallMs([{ ...A, updatedAt: 'nope' }]), TypeError);
  assert.equal(computeCiWallMs([{ ...C, createdAt: 'nope' }]), null, 'a non-completed run is not parsed');
});

test('future epoch: --gate-start-epoch 2000 with now 1125 s records gateWaitMs -875000, exit 0', (t) => {
  const h = harness(t);
  assert.equal(run(argvFor(h, { '--gate-start-epoch': '2000' }), h.deps), 0, h.err.join(''));
  assert.equal(lastEvent(h.eventsPath).gateWaitMs, -875000);
});

test('a write that does not land exits 3: an appendEvent that writes nothing', (t) => {
  const h = harness(t);
  // An unrelated event, an unparseable line, and earlier ci-gate lines that each differ from this
  // call's event in exactly one confirmed field (a multi-PR run dir already holds such lines), so
  // the confirm scan runs and a predicate weakened to any one of those fields still finds no match.
  const near = (over) => JSON.stringify({
    ts: '2026-11-12T09:30:00.000Z', type: 'ci-gate', pr: 123, headSha: SHA, verdict: 'green',
    runsReadAt: '1970-01-01T00:18:45.000Z', ...over,
  }) + '\n';
  fs.writeFileSync(h.eventsPath, SEED + '{not json\n'
    + near({ pr: 124 })
    + near({ runsReadAt: '1970-01-01T00:10:00.000Z' })
    + near({ headSha: 'b'.repeat(40) })
    + near({ verdict: 'red' }));
  h.deps.appendEvent = () => {};
  assert.equal(run(argvFor(h), h.deps), 3);
  assert.equal(h.err.join(''), `ci-gate-record.js: ci-gate event not confirmed in ${h.eventsPath}\n`);
  assert.equal(h.out.join(''), '');
});

test('a write that does not land exits 3: the real appendEvent with events.jsonl as a directory', (t) => {
  const h = harness(t);
  fs.mkdirSync(h.eventsPath);
  assert.equal(h.deps.appendEvent, require('../../../plugin/bin/lib/hooks/context').appendEvent);
  assert.equal(run(argvFor(h), h.deps), 3);
  assert.match(h.err.join(''), /^ci-gate-record\.js: /);
  assert.equal(h.out.join(''), '');
});

test('the real gh spawn: execFileSync-shaped call with a 15 s timeout, quiet stdio and windowsHide', () => {
  assert.equal(CI_GATE_GH_TIMEOUT_MS, 15000);
  // realDeps is makeRealDeps() itself, so its gh is the one this test drives with a recorder.
  assert.equal(realDeps.gh.toString(), makeRealDeps().gh.toString(), 'realDeps.gh must be makeRealDeps\'s gh');
  assert.equal(makeRealDeps().resolveTarget, realDeps.resolveTarget);
  const seen = [];
  const { gh } = makeRealDeps((cmd, args, opts) => { seen.push({ cmd, args, opts }); return '[]'; });
  // --repo makes ghOptions return the options unchanged (no host resolution from the cwd).
  const args = ['run', 'list', '--repo', 'o/r'];
  assert.equal(gh(args), '[]');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cmd, 'gh');
  assert.equal(seen[0].args, args);
  assert.equal(seen[0].opts.timeout, CI_GATE_GH_TIMEOUT_MS, 'a hung gh must not hold the merge path');
  assert.deepEqual(seen[0].opts.stdio, ['ignore', 'pipe', 'pipe'], 'quiet posture: gh stderr is captured, never echoed');
  assert.equal(seen[0].opts.windowsHide, true);
  assert.equal(seen[0].opts.encoding, 'utf8');
});

test('success echoes the events.jsonl path on stdout and --help prints usage with exit 0', (t) => {
  const h = harness(t);
  assert.equal(run(argvFor(h), h.deps), 0, h.err.join(''));
  assert.equal(h.out.join(''), h.eventsPath + '\n');
  assert.equal(h.err.join(''), '');
  for (const flag of ['--help', '-h']) {
    const h2 = harness(t);
    assert.equal(run([flag], h2.deps), 0, flag);
    assert.match(h2.out.join(''), /^usage: ci-gate-record\.js/, flag);
    assert.equal(h2.calls.length, 0, flag);
  }
});
