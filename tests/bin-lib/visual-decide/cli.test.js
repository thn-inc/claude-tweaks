'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const util = require('node:util');
const { readText } = require('../../helpers/read-skill');
const { MODE_BITS_HONORED } = require('../../helpers/root');

const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'visual-decide.js');
const CLI_LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'visual-decide', 'cli.js');
const execFileAsync = util.promisify(execFile);

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status, out: err.stdout || '', err: err.stderr || '' };
  }
}

async function stopQuiet(stateDir) {
  try {
    run(['stop', '--state', stateDir]);
  } catch {
    // best-effort cleanup
  }
}

test('AC1: start returns detached-running server-info (mode 0600, url has ?key=); second start refuses naming the URL', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const first = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '2']);
  try {
    assert.equal(first.code, 0, first.err);
    const info = JSON.parse(first.out);
    assert.match(info.url, /\?key=/);

    const infoPath = path.join(stateDir, 'server-info');
    assert.equal(fs.existsSync(infoPath), true);
    if (MODE_BITS_HONORED) {
      // win32 does not represent POSIX mode bits — Node reports 0o666 whatever mode was requested.
      const mode = fs.statSync(infoPath).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const second = run(['start', '--dir', dir, '--state', stateDir]);
    assert.notEqual(second.code, 0);
    assert.match(second.err, new RegExp(info.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await stopQuiet(stateDir);
  }
});

test('status: never-started, running, stopped, crashed', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');

  const neverStarted = run(['status', '--state', stateDir]);
  assert.equal(neverStarted.out.trim(), 'never-started');

  const started = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5']);
  assert.equal(started.code, 0, started.err);
  const info = JSON.parse(started.out);

  const running = run(['status', '--state', stateDir]);
  assert.equal(running.out.trim(), 'running');

  // crashed: SIGKILL the daemon directly, bypassing stop's own marker write
  process.kill(info.pid, 'SIGKILL');
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const crashed = run(['status', '--state', stateDir]);
  assert.equal(crashed.out.trim(), 'crashed');

  // stopped: start again, then stop cleanly
  const restarted = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5']);
  assert.equal(restarted.code, 0, restarted.err);
  const stopResult = run(['stop', '--state', stateDir]);
  assert.equal(stopResult.code, 0);
  const stoppedStatus = run(['status', '--state', stateDir]);
  assert.equal(stoppedStatus.out.trim(), 'stopped');
});

test('review fix: --idle-minutes 0 is honored by the daemon, not silently replaced by the 240min default', async () => {
  // idleMinutes=0 makes the daemon self-exit within ~1ms of starting — too
  // fast for `start`'s own probe to reliably observe as "running" (a race
  // inherent to the value itself, not the bug under test), so this checks
  // the effect (the stopped marker appears promptly) rather than gating on
  // `start`'s own exit code.
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '0']);
  await new Promise((resolve) => {
    setTimeout(resolve, 1000);
  });
  assert.equal(
    fs.existsSync(path.join(stateDir, 'server-stopped')),
    true,
    'idleMinutes=0 must self-exit almost immediately, not run for 240 minutes',
  );
});

test('stop is stale-PID tolerant (dead PID -> already-stopped, exit 0)', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const started = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5']);
  const info = JSON.parse(started.out);
  process.kill(info.pid, 'SIGKILL');
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const stopResult = run(['stop', '--state', stateDir]);
  assert.equal(stopResult.code, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'server-stopped')), true);
});

test(
  'stop writes server-stopped marker defensively when waitFor times out on a still-signalable PID',
  {
    // win32: process.kill(pid, 'SIGTERM') unconditionally terminates the
    // target process there (no handler runs) -- the opposite of the
    // still-signalable-but-unresponsive shape this test simulates, so the
    // simulation below does not hold on a Windows checkout
    // (windows-checkout-test-parity skill).
    skip: process.platform === 'win32' && 'win32: SIGTERM is unconditional, cannot simulate a still-signalable stuck PID',
  },
  async () => {
    const stateDir = mkTmp('vd-state-');
    fs.mkdirSync(stateDir, { recursive: true });

    // Simulate a PID that stays signalable (kill(pid, 0) keeps succeeding) but
    // never exits and never writes the marker itself -- the same shape a
    // zombie child presents to pidAlive() under a non-reaping init, without
    // needing an actual zombie (this sandbox's PID 1 reaps normally).
    const stuck = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], {
      stdio: 'ignore',
    });
    await new Promise((resolve) => {
      stuck.once('spawn', resolve);
    });

    fs.writeFileSync(
      path.join(stateDir, 'server-info'),
      JSON.stringify({ pid: stuck.pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }),
    );

    try {
      const stopResult = run(['stop', '--state', stateDir]);
      assert.equal(stopResult.code, 0, stopResult.err);
      assert.equal(stopResult.out.trim(), 'stopped');
      assert.equal(
        fs.existsSync(path.join(stateDir, 'server-stopped')),
        true,
        'server-stopped marker must be written even when waitFor times out on a still-signalable PID',
      );
    } finally {
      stuck.kill('SIGKILL');
    }
  },
);

test('stop leaves server-stopped and status reports stopped when the daemon exits without running its SIGTERM handler', async () => {
  const stateDir = mkTmp('vd-state-');

  // No SIGTERM handler: SIGTERM kills this child outright, so nothing writes
  // the marker on its behalf on any platform.
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  await new Promise((resolve) => {
    victim.once('spawn', resolve);
  });

  fs.writeFileSync(
    path.join(stateDir, 'server-info'),
    JSON.stringify({ pid: victim.pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }),
  );

  try {
    // Async, not the sync run() helper: the victim is a child of this test
    // process, and only the event loop lets libuv reap it once it dies. An
    // unreaped zombie still answers kill(pid, 0), so waitFor would time out
    // and the timeout branch would write the marker, masking the handler-less
    // exit this test is about.
    const { stdout } = await execFileAsync(process.execPath, [BIN, 'stop', '--state', stateDir], { encoding: 'utf8' });
    assert.equal(stdout.trim(), 'stopped');
    assert.equal(
      fs.existsSync(path.join(stateDir, 'server-stopped')),
      true,
      'server-stopped marker must be written when the PID exits without its handler running',
    );
    const status = run(['status', '--state', stateDir]);
    assert.equal(status.out.trim(), 'stopped');
  } finally {
    try {
      victim.kill('SIGKILL');
    } catch {
      // the child may already be gone
    }
  }
});

test('AC6 (CLI path): fractional --idle-minutes self-exits and status reflects stopped', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const started = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '0.05']);
  assert.equal(started.code, 0, started.err);
  await new Promise((resolve) => {
    setTimeout(resolve, 4000);
  });
  const status = run(['status', '--state', stateDir]);
  assert.equal(status.out.trim(), 'stopped');
});

test('#1231: pidAlive treats EPERM as alive (unsignalable, not dead) and ESRCH as dead', () => {
  // eslint-disable-next-line global-require
  const { pidAlive } = require(CLI_LIB);
  const originalKill = process.kill;
  try {
    process.kill = (pid, signal) => {
      if (signal !== 0) return originalKill(pid, signal);
      const err = new Error('EPERM test double');
      err.code = 'EPERM';
      throw err;
    };
    assert.equal(pidAlive(1), true, 'EPERM must be reported as alive (live-but-unsignalable)');

    process.kill = (pid, signal) => {
      if (signal !== 0) return originalKill(pid, signal);
      const err = new Error('ESRCH test double');
      err.code = 'ESRCH';
      throw err;
    };
    assert.equal(pidAlive(999999), false, 'ESRCH must still be reported as dead');
  } finally {
    process.kill = originalKill;
  }
});

test('#1232: server-info persists a real key, and readInfo (the function cmdStatus reads info.key through) resolves it — never undefined', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const started = run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5']);
  try {
    assert.equal(started.code, 0, started.err);
    const info = JSON.parse(started.out);
    assert.notEqual(info.key, undefined, 'server-info must persist a key field');
    assert.match(info.url, new RegExp(`\\?key=${info.key}$`), 'persisted key must match the key embedded in url');

    // eslint-disable-next-line global-require
    const { readInfo } = require(CLI_LIB);
    const reread = readInfo(stateDir);
    assert.notEqual(reread.key, undefined, 'readInfo (cmdStatus\'s own read path) must resolve a real, non-undefined key');
    assert.equal(reread.key, info.key);
  } finally {
    await stopQuiet(stateDir);
  }
});

test('AC8: cli.js and bin entry have zero non-builtin imports', () => {
  for (const file of [
    BIN,
    path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'visual-decide', 'cli.js'),
  ]) {
    const src = readText(file);
    const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    for (const spec of requires) {
      if (spec.startsWith('.')) continue; // local module references
      assert.match(spec, /^node:/, `unexpected non-builtin import in ${file}: ${spec}`);
    }
  }
});
