// tests/bin-lib/run-liveness/process-probe.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const {
  pidStartTime, ancestorClaudePid, resolveOwnerPid,
} = require('../../../plugin/bin/lib/run-liveness/process-probe');

// A fake `ps -o ppid=,comm= -p <pid>` keyed by pid; counts calls.
function fakePs(map) {
  const calls = [];
  const fn = (cmd, args) => {
    calls.push(args);
    const pid = args[args.indexOf('-p') + 1];
    if (!(pid in map)) throw new Error('no such pid');
    return map[pid] + '\n';
  };
  fn.calls = calls;
  return fn;
}

test('pidStartTime: own pid yields a stable non-empty string (non-win32)', { skip: process.platform === 'win32' }, () => {
  const a = pidStartTime(process.pid);
  assert.strictEqual(typeof a, 'string');
  assert.ok(a.length > 0);
  assert.strictEqual(a, a.trim());
  assert.strictEqual(pidStartTime(process.pid), a);
});

test('pidStartTime: win32 is null', () => {
  assert.strictEqual(pidStartTime(process.pid, { platform: 'win32' }), null);
});

test('pidStartTime: a dead pid is null', { skip: process.platform === 'win32' }, () => {
  const child = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
  assert.ok(Number.isInteger(child.pid));
  assert.strictEqual(pidStartTime(child.pid), null);
});

test('pidStartTime: a throwing runner, empty output, and a non-integer pid are null', () => {
  assert.strictEqual(pidStartTime(1, { platform: 'linux', execFileSync: () => { throw new Error('boom'); } }), null);
  assert.strictEqual(pidStartTime(1, { platform: 'linux', execFileSync: () => '  \n' }), null);
  assert.strictEqual(pidStartTime('12', { platform: 'linux', execFileSync: () => 'x' }), null);
  assert.strictEqual(pidStartTime(1.5, { platform: 'linux', execFileSync: () => 'x' }), null);
});

test('pidStartTime: trims the ps output', () => {
  assert.strictEqual(
    pidStartTime(7, { platform: 'linux', execFileSync: () => 'Sat Oct 24 08:08:15 2026\n' }),
    'Sat Oct 24 08:08:15 2026');
});

test('pidStartTime and ancestorClaudePid pin LC_ALL=C and TZ=UTC for ps, keeping the rest of the environment', () => {
  const seen = [];
  const runner = (cmd, args, opts) => { seen.push(opts); return args.includes('lstart=') ? 'Sat Oct 24 08:08:15 2026\n' : '1 claude\n'; };
  pidStartTime(7, { platform: 'linux', execFileSync: runner });
  ancestorClaudePid({ ppid: 7, platform: 'linux', execFileSync: runner });
  assert.strictEqual(seen.length, 2);
  for (const opts of seen) {
    assert.strictEqual(opts.env.LC_ALL, 'C');
    assert.strictEqual(opts.env.TZ, 'UTC');
    assert.strictEqual(opts.env.PATH, process.env.PATH);
    assert.strictEqual(opts.windowsHide, true);
  }
});

test('AC15.1: resolveOwnerPid prefers env', () => {
  assert.deepStrictEqual(
    resolveOwnerPid({ CLAUDE_PID: '4242' }, { ancestorClaudePid: () => 999 }),
    { pid: 4242, pidSource: 'env' });
  assert.deepStrictEqual(
    resolveOwnerPid({ CLAUDE_PID: 'abc' }, { ancestorClaudePid: () => 777 }),
    { pid: 777, pidSource: 'ancestry' });
});

test('AC15.2: neither source → pid null', () => {
  assert.deepStrictEqual(
    resolveOwnerPid({}, { ancestorClaudePid: () => null }),
    { pid: null, pidSource: null });
});

test('ancestorClaudePid: returns the nearest claude ancestor, matching on the comm basename', () => {
  const runner = fakePs({ 10: '20 zsh', 20: '30 /usr/local/bin/claude', 30: '1 claude' });
  assert.strictEqual(ancestorClaudePid({ ppid: 10, platform: 'linux', execFileSync: runner }), 20);
});

test('ancestorClaudePid: a self-looping ancestry stops after 8 ps calls', () => {
  const runner = fakePs({ 10: '10 zsh' });
  assert.strictEqual(ancestorClaudePid({ ppid: 10, platform: 'linux', execFileSync: runner }), null);
  assert.strictEqual(runner.calls.length, 8);
});

test('ancestorClaudePid: a throwing runner, win32, and a bad start pid are null', () => {
  assert.strictEqual(ancestorClaudePid({ ppid: 10, platform: 'linux', execFileSync: () => { throw new Error('x'); } }), null);
  assert.strictEqual(ancestorClaudePid({ ppid: 10, platform: 'win32', execFileSync: () => '1 claude' }), null);
  assert.strictEqual(ancestorClaudePid({ ppid: 0, platform: 'linux', execFileSync: () => '1 claude' }), null);
});
