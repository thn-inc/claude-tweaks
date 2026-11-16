'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { runCli } = require('../../helpers/run-cli');
const { appendStop, appendWait, stopsPath } = require('../../../plugin/bin/lib/wait-for/marker');

const CLI = path.resolve(__dirname, '../../../plugin/bin/wait-for.js');
const MARKER_JS = path.resolve(__dirname, '../../../plugin/bin/lib/wait-for/marker.js');
const { USAGE } = require('../../../plugin/bin/lib/wait-for/index');

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
// number of sleeps so far. Bounded: the 1,001st sleep throws.
function clock(startMs, onSleep = () => {}) {
  let t = startMs;
  const sleeps = [];
  return {
    sleeps,
    now: () => t,
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
  const res = await runCli(CLI, argv, { env, deps: { now: c.now, sleep: c.sleep, tmpDir: () => dir } });
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
  const r2 = await call(argv, { c, dir });
  assert.equal(r2.code, 3, r2.stderr);
  assert.equal(r2.out.bound, 'deadline');
  assert.equal(r2.out.deadlineEpoch, T / 1000 + 60);
  assert.equal(c.sleeps.length - before, 0);
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

test('two sessions\' siblings: a window for a,b is not joined by a call for c', async (t) => {
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

test('AC10.3: a symlink or a directory at the marker path exits 2 and is not read', async (t) => {
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
