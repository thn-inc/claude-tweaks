'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { runCli } = require('../../helpers/run-cli');
const { appendStop, appendWait, stopsPath, waitsPath } = require('../../../plugin/bin/lib/wait-for/marker');

const CLI = path.resolve(__dirname, '../../../plugin/bin/wait-for.js');
const MARKER_JS = path.resolve(__dirname, '../../../plugin/bin/lib/wait-for/marker.js');
const { USAGE, TARGETS } = require('../../../plugin/bin/lib/wait-for/index');

const T = Date.parse('2026-11-16T00:00:00Z');
const SID = 'sess-1';
const ENV = { CLAUDE_CODE_SESSION_ID: SID };
const final = (agentId) => ({ agentId, at: 1, blocked: false, pending: 0 });

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wait-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A fake clock: sleep(ms) records ms, advances the clock, then calls onSleep with the
// number of sleeps so far. Bounded: the 1,001st sleep throws. `now` (epoch) and
// `monotonicNow` advance together; stepEpoch(ms) moves only the epoch, as a wall-clock
// step does.
function clock(startMs, onSleep = () => {}) {
  let t = startMs;
  let epochOffset = 0;
  const sleeps = [];
  return {
    sleeps,
    now: () => t + epochOffset,
    monotonicNow: () => t,
    stepEpoch: (ms) => { epochOffset += ms; },
    advance: (ms) => { t += ms; },
    sleep: async (ms) => {
      if (sleeps.length >= 1000) throw new Error('fake sleep called more than 1000 times');
      sleeps.push(ms);
      t += ms;
      onSleep(sleeps.length);
    },
  };
}

async function call(argv, { c, dir, env = ENV }) {
  const res = await runCli(CLI, argv, { env, deps: { now: c.now, monotonicNow: c.monotonicNow, sleep: c.sleep, tmpDir: () => dir } });
  const out = res.stdout ? JSON.parse(res.stdout) : null;
  return { ...res, out };
}

test('AC2.1: agents exits 0 after three sleeps when one of two ids gains a final stop', async (t) => {
  const dir = tmp(t);
  const c = clock(T, (n) => { if (n === 3) appendStop(SID, final('a'), { tmpDir: dir }); });
  const r = await call(['agents', '--ids', 'a,b'], { c, dir });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(c.sleeps.length, 3);
  assert.deepEqual(r.out.reported, ['a']);
  assert.deepEqual(r.out.pending, ['b']);
  assert.equal(r.out.changed, true);
  assert.equal(r.out.state, 'reported');
  assert.equal(r.out.stops, 1);
  assert.equal(r.out.bound, undefined);
  assert.equal(r.stdout.split('\n').length, 2, 'one line');
});

test('AC2.2: blocked, pending above 0 and pending null are not final', async (t) => {
  const dir = tmp(t);
  appendStop(SID, { agentId: 'a', at: 1, blocked: true, pending: 0 }, { tmpDir: dir });
  appendStop(SID, { agentId: 'a', at: 1, blocked: false, pending: 2 }, { tmpDir: dir });
  appendStop(SID, { agentId: 'a', at: 1, blocked: false, pending: null }, { tmpDir: dir });
  const c = clock(T);
  const r1 = await call(['agents', '--ids', 'a', '--max-seconds', '3'], { c, dir });
  assert.equal(r1.code, 3, r1.stderr);
  assert.equal(r1.out.bound, 'call');
  assert.equal(r1.out.stops, 3);
  assert.equal(r1.out.changed, false);
  assert.equal(r1.out.state, 'pending');
  appendStop(SID, final('a'), { tmpDir: dir });
  const r2 = await call(['agents', '--ids', 'a', '--max-seconds', '3'], { c, dir });
  assert.equal(r2.code, 0, r2.stderr);
  assert.deepEqual(r2.out.reported, ['a']);
});

test('AC3.1: agents with no change exits 3 at the call bound after ceil(max/interval) sleeps', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const r = await call(['agents', '--ids', 'a'], { c, dir });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.deepEqual(c.sleeps, new Array(100).fill(1000));
  assert.equal(r.out.elapsedSeconds, 100);
  assert.equal(r.out.stops, 0);
  assert.equal(r.out.window, 1);
  assert.equal(r.out.deadlineEpoch, T / 1000 + 1200);
});

test('AC4.1/AC4.2/AC4.3: three identical calls share one window; a fourth opens window 2', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const argv = ['agents', '--ids', 'a,b', '--max-seconds', '150', '--window-seconds', '400'];
  const r1 = await call(argv, { c, dir });
  const r2 = await call(argv, { c, dir });
  const r3 = await call(argv, { c, dir });
  for (const r of [r1, r2, r3]) {
    assert.equal(r.code, 3, r.stderr);
    assert.equal(r.out.deadlineEpoch, T / 1000 + 400);
    assert.equal(r.out.window, 1);
  }
  assert.equal(r1.out.bound, 'call');
  assert.equal(r1.out.elapsedSeconds, 150);
  assert.equal(r2.out.bound, 'call');
  assert.equal(r2.out.elapsedSeconds, 150);
  assert.equal(r3.out.bound, 'deadline');
  assert.equal(r3.out.elapsedSeconds, 100);
  const start4 = c.now();
  const r4 = await call(argv, { c, dir });
  assert.equal(r4.out.window, 2);
  assert.equal(r4.out.deadlineEpoch, start4 / 1000 + 400);
});

// Spec: "The nearer bound ends the call; when both pass at the same poll, `bound` is `deadline`."
test('AC4.2: when the call bound and the window deadline pass at the same poll, bound is deadline', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const argv = ['agents', '--ids', 'a', '--max-seconds', '100', '--window-seconds', '100'];
  const r1 = await call(argv, { c, dir });
  assert.equal(r1.code, 3, r1.stderr);
  assert.equal(r1.out.bound, 'deadline');
  assert.equal(r1.out.elapsedSeconds, 100);
  const r2 = await call(argv, { c, dir });
  assert.equal(r2.out.window, 2);
});

test('AC4.4: a call after an open window\'s deadline exits 3 after one poll and zero sleeps', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const argv = ['agents', '--ids', 'a', '--max-seconds', '10', '--window-seconds', '60'];
  const r1 = await call(argv, { c, dir });
  assert.equal(r1.out.bound, 'call');
  c.advance(120000);
  const before = c.sleeps.length;
  // Count polls by wrapping the agents target's poll for this one call.
  const poll = TARGETS.agents.poll;
  let polls = 0;
  TARGETS.agents.poll = (ctx) => { polls += 1; return poll(ctx); };
  let r2;
  try {
    r2 = await call(argv, { c, dir });
  } finally {
    TARGETS.agents.poll = poll;
  }
  assert.equal(r2.code, 3, r2.stderr);
  assert.equal(r2.out.bound, 'deadline');
  assert.equal(r2.out.deadlineEpoch, T / 1000 + 60);
  assert.equal(c.sleeps.length - before, 0);
  assert.equal(polls, 1);
});

test('the last sleep before a bound is clamped to the time left', async (t) => {
  const dir = tmp(t);
  // Starts half a second past T: openedAt floors to T/1000, so the deadline is 59.5 s away.
  const c = clock(T + 500);
  const r = await call(['agents', '--ids', 'a', '--window-seconds', '60'], { c, dir });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'deadline');
  assert.deepEqual(c.sleeps, [...new Array(59).fill(1000), 500]);
});

test('a backward wall-clock step does not extend the call bound', async (t) => {
  const dir = tmp(t);
  const c = clock(T, (n) => { if (n === 3) c.stepEpoch(-3600 * 1000); });
  const r = await call(['agents', '--ids', 'a', '--max-seconds', '10'], { c, dir });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.equal(r.out.elapsedSeconds, 10);
  assert.deepEqual(c.sleeps, new Array(10).fill(1000));
});

test('a window closed done and later deadline does not count toward window', async (t) => {
  const dir = tmp(t);
  const w = 'agents:a,b:1';
  appendWait(SID, { kind: 'open', window: w, target: 'agents', key: 'a,b', ids: ['a', 'b'], openedAt: 0, deadline: 60, n: 1 }, { tmpDir: dir });
  appendWait(SID, { kind: 'close', window: w, reason: 'done', at: 10 }, { tmpDir: dir });
  appendWait(SID, { kind: 'close', window: w, reason: 'deadline', at: 60 }, { tmpDir: dir });
  const r = await call(['agents', '--ids', 'a,b', '--max-seconds', '1'], { c: clock(T), dir });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.window, 1);
});

test('AC4.5: a call listing an id outside the open window opens a new window 1', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const r1 = await call(['agents', '--ids', 'a,b', '--max-seconds', '5'], { c, dir });
  const start2 = c.now();
  const r2 = await call(['agents', '--ids', 'a,c', '--max-seconds', '5'], { c, dir });
  assert.equal(r2.out.deadlineEpoch, start2 / 1000 + 1200);
  assert.notEqual(r2.out.deadlineEpoch, r1.out.deadlineEpoch);
  assert.equal(r2.out.window, 1);
  const r3 = await call(['agents', '--ids', 'b', '--max-seconds', '5'], { c, dir });
  assert.equal(r3.out.deadlineEpoch, r1.out.deadlineEpoch);
});

test('two sibling subagents of one root session: a window for a,b is not joined by a call for c', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const r1 = await call(['agents', '--ids', 'a,b', '--max-seconds', '5'], { c, dir });
  const start2 = c.now();
  const r2 = await call(['agents', '--ids', 'c', '--max-seconds', '5'], { c, dir });
  assert.equal(r2.out.deadlineEpoch, start2 / 1000 + 1200);
  assert.notEqual(r2.out.deadlineEpoch, r1.out.deadlineEpoch);
  assert.equal(r2.out.window, 1);
});

test('AC13.1/AC13.2: each final stop is returned once', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  appendStop(SID, final('x'), { tmpDir: dir });
  const argv = ['agents', '--ids', 'x', '--max-seconds', '5'];
  const r1 = await call(argv, { c, dir });
  assert.equal(r1.code, 0, r1.stderr);
  assert.deepEqual(r1.out.reported, ['x']);
  const r2 = await call(argv, { c, dir });
  assert.equal(r2.code, 3, r2.stderr);
  assert.equal(r2.out.bound, 'call');
  appendStop(SID, final('x'), { tmpDir: dir });
  const r3 = await call(argv, { c, dir });
  assert.equal(r3.code, 0, r3.stderr);
  assert.deepEqual(r3.out.reported, ['x']);
  assert.equal(r3.out.stops, 2);
});

test('two undelivered finals deliver once', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  appendStop(SID, final('x'), { tmpDir: dir });
  appendStop(SID, final('x'), { tmpDir: dir });
  const argv = ['agents', '--ids', 'x', '--max-seconds', '5'];
  const r1 = await call(argv, { c, dir });
  assert.equal(r1.code, 0, r1.stderr);
  const r2 = await call(argv, { c, dir });
  assert.equal(r2.code, 3, r2.stderr);
});

test('two overlapping agents calls: the call whose delivered line lands second keeps waiting', async (t) => {
  const dir = tmp(t);
  appendStop(SID, final('x'), { tmpDir: dir });
  const wp = waitsPath(SID, { tmpDir: dir });
  const realWrite = fs.writeSync;
  let raced = false;
  t.mock.method(fs, 'writeSync', (fd, data, ...rest) => {
    if (!raced && typeof data === 'string' && data.includes('"kind":"delivered"')) {
      raced = true;
      fs.appendFileSync(wp, JSON.stringify({ kind: 'delivered', agentId: 'x', stop: 0, claim: 'the-other-call' }) + '\n');
    }
    return realWrite(fd, data, ...rest);
  });
  const r = await call(['agents', '--ids', 'x', '--max-seconds', '3'], { c: clock(T), dir });
  assert.equal(raced, true, 'the other call appended first');
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.deepEqual(r.out.reported, []);
  assert.deepEqual(r.out.pending, ['x']);
});

test('the done close: a call that reports every listed id closes its window', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  appendStop(SID, final('a'), { tmpDir: dir });
  const r1 = await call(['agents', '--ids', 'a'], { c, dir });
  assert.equal(r1.code, 0, r1.stderr);
  assert.deepEqual(r1.out.pending, []);
  c.advance(7000);
  const start2 = c.now();
  const r2 = await call(['agents', '--ids', 'a', '--max-seconds', '5'], { c, dir });
  assert.equal(r2.out.deadlineEpoch, start2 / 1000 + 1200);
  assert.notEqual(r2.out.deadlineEpoch, r1.out.deadlineEpoch);
  assert.equal(r2.out.window, 1);
});

test('AC10.2: a missing marker file runs to the bound with stops 0', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const r = await call(['agents', '--ids', 'a', '--max-seconds', '3'], { c, dir });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.stops, 0);
});

test('AC10.3: a symlink or a directory at the marker path exits 2 and is not read', { skip: process.platform === 'win32' && 'creating a symlink needs a privilege on win32' }, async (t) => {
  const dir = tmp(t);
  const p = stopsPath(SID, { tmpDir: dir });
  const argv = ['agents', '--ids', 'a', '--max-seconds', '3'];

  // (a) a symlink to a file holding a final stop: following it would exit 0.
  const target = path.join(dir, 'elsewhere.jsonl');
  fs.writeFileSync(target, JSON.stringify(final('a')) + '\n');
  fs.symlinkSync(target, p);
  const ra = await call(argv, { c: clock(T), dir });
  assert.equal(ra.code, 2);
  assert.ok(ra.stderr.includes(p), ra.stderr);
  assert.equal(ra.stdout, '');

  // (b) a dangling symlink.
  fs.unlinkSync(p);
  fs.symlinkSync(path.join(dir, 'missing.jsonl'), p);
  const rb = await call(argv, { c: clock(T), dir });
  assert.equal(rb.code, 2);
  assert.ok(rb.stderr.includes(p), rb.stderr);
  assert.equal(rb.stdout, '');

  // (c) a directory.
  fs.unlinkSync(p);
  fs.mkdirSync(p);
  const rc = await call(argv, { c: clock(T), dir });
  assert.equal(rc.code, 2);
  assert.ok(rc.stderr.includes(p), rc.stderr);
  assert.equal(rc.stdout, '');
});

test('AC10.4: a bad JSON line is skipped and the final stop after it is read', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(stopsPath(SID, { tmpDir: dir }), 'garbage\n' + JSON.stringify(final('a')) + '\n');
  const r = await call(['agents', '--ids', 'a', '--max-seconds', '3'], { c: clock(T), dir });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.out.reported, ['a']);
});

test('a corrupt delivered line does not hide a later stop', async (t) => {
  const dir = tmp(t);
  appendWait(SID, { kind: 'delivered', agentId: 'x', stop: 'x' }, { tmpDir: dir });
  appendStop(SID, final('x'), { tmpDir: dir });
  const r = await call(['agents', '--ids', 'x', '--max-seconds', '3'], { c: clock(T), dir });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.out.reported, ['x']);
});

test('AC12.1: agents with no session id exits 2 and names it', async (t) => {
  const dir = tmp(t);
  const r = await call(['agents', '--ids', 'a'], { c: clock(T), dir, env: {} });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /CLAUDE_CODE_SESSION_ID/);
  assert.match(r.stderr, /--session/);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing touched');
  const r2 = await call(['agents', '--ids', 'a', '--max-seconds', '1', '--session', 'other'], { c: clock(T), dir, env: {} });
  assert.equal(r2.code, 3, r2.stderr);
});

test('AC12.2: a session id outside [A-Za-z0-9_-] exits 2', async (t) => {
  const dir = tmp(t);
  const r1 = await call(['agents', '--ids', 'a'], { c: clock(T), dir, env: { CLAUDE_CODE_SESSION_ID: 'a.b' } });
  assert.equal(r1.code, 2);
  const r2 = await call(['agents', '--ids', 'a', '--session', '../x'], { c: clock(T), dir });
  assert.equal(r2.code, 2);
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing touched');
});

test('AC7.1: malformed invocations exit 2 with the usage', async (t) => {
  const dir = tmp(t);
  const bad = [
    ['bogus'],
    ['agents', '--ids', 'a', '--bogus', '1'],
    ['agents', '--ids'],
    ['agents', '--ids', 'a', '--max-seconds', '151'],
    ['agents', '--ids', 'a', '--window-seconds', '3601'],
    ['agents'],
    ['agents', '--ids', ''],
    ['ci', '--pr', '1', '--run', '2'],
    ['agents', '--ids', 'a', 'constructor', 'x'],
    ['agents', '--ids', 'a', '--max-seconds', '0'],
    [],
  ];
  for (const argv of bad) {
    const r = await call(argv, { c: clock(T), dir });
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes(USAGE), JSON.stringify(argv));
    assert.match(r.stderr, /^wait-for\.js: /, JSON.stringify(argv));
    assert.equal(r.stdout, '', JSON.stringify(argv));
  }
  const ok1 = await call(['agents', '--ids', 'a', '--max-seconds', '150'], { c: clock(T), dir });
  assert.equal(ok1.code, 3, ok1.stderr);
  const ok2 = await call(['agents', '--ids', 'a', '--max-seconds', '1', '--window-seconds', '3600'], { c: clock(T), dir });
  assert.equal(ok2.code, 3, ok2.stderr);
});

test('AC7.2: --help exits 0 with the usage on stdout', async (t) => {
  const dir = tmp(t);
  for (const argv of [['--help'], ['agents', '--help']]) {
    const r = await runCli(CLI, argv, { env: ENV, deps: { tmpDir: () => dir } });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, USAGE);
    assert.equal(r.stderr, '');
  }
  assert.ok(USAGE.includes('verify.js'));
  assert.ok(USAGE.includes('--max-seconds 150'));
});

test('AC9.1: a real process exits 0 when a second process appends a final stop after one second', { timeout: 60000 }, async (t) => {
  const dir = tmp(t);
  const sid = `ac9-${process.pid}`;
  const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir };
  const waiter = spawn(process.execPath, [CLI, 'agents', '--ids', 'x', '--max-seconds', '30', '--session', sid], { env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  waiter.stdout.on('data', (d) => { stdout += d; });
  waiter.stderr.on('data', (d) => { stderr += d; });
  const closed = new Promise((resolve) => waiter.on('close', resolve));
  const script =
    'setTimeout(() => { require(process.argv[1]).appendStop(process.argv[3], ' +
    "{ agentId: 'x', at: 1, blocked: false, pending: 0 }, { tmpDir: process.argv[2] }); }, 1000);";
  const writer = spawn(process.execPath, ['-e', script, MARKER_JS, dir, sid], { windowsHide: true });
  const written = new Promise((resolve) => writer.on('close', resolve));
  const [code, writerCode] = await Promise.all([closed, written]);
  assert.equal(writerCode, 0);
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout).reported, ['x']);
});

// ---- pid and ci targets (Task 4) ----

// A bounded fake runner: returns or throws the next answer, throws past the end, records each query.
function scripted(answers) {
  const queries = [];
  const optsSeen = [];
  const runner = (query, opts) => {
    queries.push(query);
    optsSeen.push(opts);
    if (queries.length > answers.length) throw new Error('unexpected call');
    const a = answers[queries.length - 1];
    if (a instanceof Error) throw a;
    return a;
  };
  return { runner, queries, optsSeen };
}

// call() with extra deps (runner, isPidAlive, cwd) merged in.
async function callWith(argv, { c, dir, env = ENV, deps = {} }) {
  const res = await runCli(CLI, argv, { env, deps: { now: c.now, monotonicNow: c.monotonicNow, sleep: c.sleep, tmpDir: () => dir, ...deps } });
  return { ...res, out: res.stdout ? JSON.parse(res.stdout) : null };
}

test('AC3.1: pid with no change exits 3 at the call bound', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  let calls = 0;
  const r = await callWith(['pid', '--pid', '42'], { c, dir, deps: { isPidAlive: () => { calls += 1; return true; } } });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.equal(r.out.state, 'alive');
  assert.deepEqual(c.sleeps, new Array(100).fill(1000));
  assert.equal(calls, 101);
});

test('AC3.1: ci with no change sleeps ceil(100/30) times, the last cut to the time left', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner, queries } = scripted(new Array(10).fill({ state: 'pending' }));
  const r = await callWith(['ci', '--pr', '7', '--max-seconds', '100'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.deepEqual(c.sleeps, [30000, 30000, 30000, 10000]);
  assert.equal(queries.length, 5);
  assert.equal(r.out.readFailures, 0);
});

test('AC6.1: pid exits 0 once the process is gone, and 2 for a pid that is not a positive integer', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const answers = [true, true, false];
  let i = 0;
  const r = await callWith(['pid', '--pid', '42'], { c, dir, deps: { isPidAlive: () => answers[i++] } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(c.sleeps.length, 2);
  assert.equal(r.out.state, 'gone');
  assert.equal(r.out.changed, true);
  for (const bad of ['0', '-3', '1.5', 'abc', '99999999999']) {
    const rb = await callWith(['pid', '--pid', bad], { c: clock(T), dir, deps: { isPidAlive: () => false } });
    assert.equal(rb.code, 2, bad);
    assert.equal(rb.stdout, '', bad);
  }
});

test('AC6.2: a real process — wait-for.js pid exits 0 after a child that lives one second exits', { timeout: 60000 }, async (t) => {
  const dir = tmp(t);
  const sid = `ac6-${process.pid}`;
  const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir };
  const target = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { windowsHide: true });
  const targetClosed = new Promise((resolve) => target.on('close', resolve));
  const waiter = spawn(process.execPath, [CLI, 'pid', '--pid', String(target.pid), '--max-seconds', '30', '--session', sid], { env, windowsHide: true });
  let stdout = '';
  let stderr = '';
  waiter.stdout.on('data', (d) => { stdout += d; });
  waiter.stderr.on('data', (d) => { stderr += d; });
  const closed = new Promise((resolve) => waiter.on('close', resolve));
  const [code] = await Promise.all([closed, targetClosed]);
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).state, 'gone');
});

test('AC5.1: ci --pr exits 0 with green after two sleeps', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner, queries } = scripted([{ state: 'pending' }, { state: 'pending' }, { state: 'green' }]);
  const r = await callWith(['ci', '--pr', '7'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.state, 'green');
  assert.equal(r.out.changed, true);
  assert.equal(c.sleeps.length, 2);
  assert.deepEqual(queries, [{ pr: 7 }, { pr: 7 }, { pr: 7 }]);
});

for (const state of ['red', 'inherited-red', 'no-ci', 'stale']) {
  test(`AC5.2: ci --pr exits 0 on the first poll for ${state}`, async (t) => {
    const dir = tmp(t);
    const c = clock(T);
    const { runner } = scripted([{ state }]);
    const r = await callWith(['ci', '--pr', '7'], { c, dir, deps: { runner, cwd: () => dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.state, state);
    assert.equal(c.sleeps.length, 0);
  });
}

test('AC5.3: ci --run exits 0 when the run completes and prints its conclusion', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner, queries } = scripted([{ status: 'in_progress', conclusion: '' }, { status: 'completed', conclusion: 'success' }]);
  const r = await callWith(['ci', '--run', '99'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.state, 'completed');
  assert.equal(r.out.conclusion, 'success');
  assert.deepEqual(queries, [{ run: '99' }, { run: '99' }]);
});

test('AC5.4: a runner that throws on the first read exits 2', async (t) => {
  const dir = tmp(t);
  const { runner } = scripted([new Error('gh exploded')]);
  const r = await callWith(['ci', '--pr', '7'], { c: clock(T), dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /gh exploded/);
  assert.equal(r.stdout, '');
});

test('AC5.5: a throw after a good read counts as pending', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner } = scripted([{ state: 'pending' }, new Error('flaky'), { state: 'green' }]);
  const r = await callWith(['ci', '--pr', '7'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.readFailures, 1);
  assert.equal(r.out.state, 'green');
});

test('a read-failed envelope is a failed read', async (t) => {
  const dir = tmp(t);
  const first = scripted([{ state: 'read-failed' }]);
  const r1 = await callWith(['ci', '--pr', '7'], { c: clock(T), dir, deps: { runner: first.runner, cwd: () => dir } });
  assert.equal(r1.code, 2);
  assert.equal(r1.stdout, '');
  for (const bad of ['gh-absent', 'no-pr']) {
    const { runner } = scripted([{ state: 'pending' }, { state: bad }, { state: 'green' }]);
    const r = await callWith(['ci', '--pr', '7'], { c: clock(T), dir, deps: { runner, cwd: () => dir } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.readFailures, 1, bad);
  }
});

test('a non-object answer, a non-string state and a non-string status are failed reads', async (t) => {
  const dir = tmp(t);
  for (const [argv, answer] of [
    [['ci', '--pr', '7'], 'green'],
    [['ci', '--pr', '7'], { state: 3 }],
    [['ci', '--run', '9'], { status: null }],
    [['ci', '--run', '9'], null],
  ]) {
    const { runner } = scripted([answer]);
    const r = await callWith(argv, { c: clock(T), dir, deps: { runner, cwd: () => dir } });
    assert.equal(r.code, 2, JSON.stringify(answer));
  }
});

test('AC12.1: ci and pid with no session id exit 2 and name it', async (t) => {
  const dir = tmp(t);
  const boom = () => { throw new Error('must not be called'); };
  for (const argv of [['ci', '--pr', '7'], ['pid', '--pid', '42']]) {
    const r = await callWith(argv, { c: clock(T), dir, env: {}, deps: { runner: boom, isPidAlive: boom, cwd: boom } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /CLAUDE_CODE_SESSION_ID/);
  }
});

// Calls realDeps.runner with child_process.execFileSync replaced by a recorder.
function runRealRunner(query, callOpts, answer) {
  const cp = require('child_process');
  const real = cp.execFileSync;
  const seen = [];
  const key = require.resolve('../../../plugin/bin/wait-for.js');
  const saved = require.cache[key];
  let out;
  try {
    cp.execFileSync = (...a) => { seen.push(a); return answer; };
    delete require.cache[key];
    out = require(key).realDeps.runner(query, callOpts);
  } finally {
    cp.execFileSync = real;
    if (saved) require.cache[key] = saved; else delete require.cache[key];
  }
  assert.equal(seen.length, 1);
  return { out, file: seen[0][0], args: seen[0][1], opts: seen[0][2] };
}

test('realDeps.runner\'s gh call passes ghOptions, windowsHide and the gh timeout', () => {
  const { GH_TIMEOUT_MS } = require('../../../plugin/bin/lib/shared-primitives');
  const r = runRealRunner({ run: 5 }, { cwd: os.tmpdir(), env: {}, timeoutMs: 600000 }, '{"conclusion":"","status":"queued"}');
  assert.deepEqual(r.out, { conclusion: '', status: 'queued' });
  assert.equal(r.file, 'gh');
  assert.deepEqual(r.args, ['run', 'view', '5', '--json', 'status,conclusion']);
  assert.equal(r.opts.windowsHide, true);
  assert.equal(r.opts.timeout, GH_TIMEOUT_MS);
  const short = runRealRunner({ run: 5 }, { cwd: os.tmpdir(), env: {}, timeoutMs: 1500 }, '{"conclusion":"","status":"queued"}');
  assert.equal(short.opts.timeout, 1500, 'the gh timeout is capped by the poll timeout');
});

test('realDeps.runner spawns pr-checks.js as a child with the poll timeout, cwd and env', () => {
  const env = { PATH: '/x', GH_HOST: 'h.example' };
  const r = runRealRunner({ pr: 7 }, { cwd: os.tmpdir(), env, timeoutMs: 23456 }, '{"state":"pending"}');
  assert.deepEqual(r.out, { state: 'pending' });
  assert.equal(r.file, process.execPath);
  assert.deepEqual(r.args, [path.resolve(__dirname, '../../../plugin/bin/pr-checks.js'), '--pr', '7']);
  assert.equal(r.opts.timeout, 23456);
  assert.equal(r.opts.windowsHide, true);
  assert.equal(r.opts.env, env);
  assert.equal(r.opts.cwd, os.tmpdir());
});

test('each ci poll gets timeoutMs = the time left until the call bound plus 20 s', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner, optsSeen } = scripted(new Array(10).fill({ state: 'pending' }));
  const r = await callWith(['ci', '--pr', '7', '--max-seconds', '100'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.deepEqual(optsSeen.map((o) => o.timeoutMs), [120000, 90000, 60000, 30000, 20000]);
});

test('a window deadline nearer than the call bound sets the ci poll timeout', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  const { runner, optsSeen } = scripted(new Array(10).fill({ state: 'pending' }));
  const r = await callWith(['ci', '--pr', '7', '--max-seconds', '100', '--window-seconds', '60'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'deadline');
  assert.deepEqual(optsSeen.map((o) => o.timeoutMs), [80000, 50000, 20000]);
});

test('USAGE states the real longest call for agents/pid and for ci', () => {
  assert.ok(USAGE.includes('150 s, and a ci call up to 170 s'));
  assert.ok(!/stays under the measured/.test(USAGE));
});

test('slow ci polls cannot hold a call past --max-seconds + 20 s', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  // One good read, then reads that each take as long as their timeout allows and are killed.
  let n = 0;
  const slow = (query, { timeoutMs }) => {
    n += 1;
    if (n === 1) return { state: 'pending' };
    c.advance(timeoutMs);
    throw new Error('killed at the timeout');
  };
  const r = await callWith(['ci', '--pr', '8', '--max-seconds', '100'], { c, dir, deps: { runner: slow, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.out.bound, 'call');
  assert.ok(c.monotonicNow() - T <= (100 + 20) * 1000, `ended at ${(c.monotonicNow() - T) / 1000}s`);
  assert.ok(r.out.readFailures >= 1);
});

test('a ci call joining an unclosed window past its deadline gets one full-grace read, exits 3 deadline and closes it (#5602)', async (t) => {
  const dir = tmp(t);
  const c = clock(T);
  appendWait(SID, { kind: 'open', window: 'ci:pr:7:1', target: 'ci', key: 'pr:7', openedAt: T / 1000 - 3000, deadline: T / 1000 - 1800, n: 1 }, { tmpDir: dir });
  // A read that takes 3 s of fake time, like a real pr-checks.js --pr, and is killed below that.
  const slowRead = (query, { timeoutMs }) => {
    c.advance(3000);
    if (timeoutMs < 3000) throw new Error(`spawnSync ETIMEDOUT (timeout ${timeoutMs} ms)`);
    return { state: 'pending' };
  };
  const argv = ['ci', '--pr', '7', '--max-seconds', '10'];
  const r1 = await callWith(argv, { c, dir, deps: { runner: slowRead, cwd: () => dir } });
  assert.equal(r1.code, 3, r1.stderr);
  assert.equal(r1.out.bound, 'deadline');
  assert.equal(r1.out.window, 1);
  assert.ok(require('../../../plugin/bin/lib/wait-for/marker').readWaits(SID, { tmpDir: dir }).some((w) => w.kind === 'close' && w.window === 'ci:pr:7:1' && w.reason === 'deadline'), 'the window is closed');
  const r2 = await callWith(argv, { c, dir, deps: { runner: slowRead, cwd: () => dir } });
  assert.equal(r2.out.window, 2);
});

test('a --run read without a conclusion prints conclusion null', async (t) => {
  const dir = tmp(t);
  const { runner } = scripted([{ status: 'completed' }]);
  const r = await callWith(['ci', '--run', '9'], { c: clock(T), dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.conclusion, null);
});

// A fractional monotonic clock (performance.now() returns fractional ms) must not reach a
// child-process timeout as a fraction: execFileSync rejects any non-integer timeout.
function fractionalClock() {
  const c = clock(T);
  // Each read drifts a little, as real elapsed time does between two performance.now() calls.
  let drift = 1234.5678;
  return { ...c, monotonicNow: () => { drift += 0.3217; return c.monotonicNow() + drift; } };
}

test('fractional monotonic time: every ci poll timeoutMs is an integer', async (t) => {
  const dir = tmp(t);
  const c = fractionalClock();
  const { runner, optsSeen } = scripted(new Array(10).fill({ state: 'pending' }));
  const r = await callWith(['ci', '--pr', '7', '--max-seconds', '100'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.ok(optsSeen.length > 1);
  for (const o of optsSeen) assert.ok(Number.isInteger(o.timeoutMs), `timeoutMs ${o.timeoutMs}`);
  assert.ok(optsSeen.every((o) => o.timeoutMs >= 20000), 'the 20 s floor holds after rounding');
});

test('fractional monotonic time through the real runner: execFileSync only ever sees integer timeouts', async (t) => {
  const dir = tmp(t);
  const cp = require('child_process');
  const real = cp.execFileSync;
  const key = require.resolve('../../../plugin/bin/wait-for.js');
  const saved = require.cache[key];
  const timeouts = [];
  let runner;
  try {
    cp.execFileSync = (_f, _a, o) => {
      timeouts.push(o.timeout);
      if (!Number.isInteger(o.timeout)) throw new RangeError(`The value of "timeout" is out of range. It must be an integer. Received ${o.timeout}`);
      return '{"state":"pending"}';
    };
    delete require.cache[key];
    runner = require(key).realDeps.runner;
  } finally {
    cp.execFileSync = real;
    if (saved) require.cache[key] = saved; else delete require.cache[key];
  }
  // `runner` destructured the patched execFileSync when wait-for.js loaded, so it keeps it.
  const c = fractionalClock();
  const r = await callWith(['ci', '--pr', '7', '--max-seconds', '100'], { c, dir, deps: { runner, cwd: () => dir } });
  assert.equal(r.code, 3, r.stderr);
  assert.ok(timeouts.length > 1);
  assert.ok(timeouts.every(Number.isInteger), timeouts.join(','));
});
