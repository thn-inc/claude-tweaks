'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readText } = require('../../helpers/read-skill');
const { MODE_BITS_HONORED } = require('../../helpers/root');
const { runCli, spawnCli } = require('../../helpers/run-cli');

const BIN = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'visual-decide.js');
const CLI_LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'visual-decide', 'cli.js');
const SERVER_LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'visual-decide', 'server.js');

function mkTmp(prefix) {
  return scratchDir(prefix);
}

async function run(args, { cwd, env, deps } = {}) {
  const { code, stdout, stderr } = await runCli(BIN, args, { cwd, env, deps });
  return { code, out: stdout, err: stderr };
}

// Cleanup stop; its output is ignored. run never rejects, so a rejection here is the helper's
// leak guard, and it fails the test.
async function stopQuiet(stateDir, opts) {
  await run(['stop', '--state', stateDir], opts);
}

// A cwd() that throws the way process.cwd() does once the working directory has been deleted.
const UNREADABLE_CWD = () => {
  throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' });
};

// In-process stand-in for start's detached daemon. The fake spawn runs the server in this
// process with the resolved args start gave it; the fake kill answers signal 0 as alive and
// calls that server's own stop for SIGTERM. The server records this process's pid in
// server-info, so these deps must never fall through to the real process.kill.
function inProcessDaemon() {
  // eslint-disable-next-line global-require
  const { parseArgs } = require(CLI_LIB);
  // eslint-disable-next-line global-require
  const { startServer } = require(SERVER_LIB);
  let current = null;
  const started = [];
  const closes = [];
  const spawnOpts = [];
  const spawnArgs = [];
  const deps = {
    spawn: (cmd, args, options) => {
      spawnOpts.push(options);
      spawnArgs.push(args);
      const { opts } = parseArgs(args.slice(1));
      const serving = startServer({ dir: opts.dir, stateDir: opts.state, port: 0, idleMinutes: Number(opts['idle-minutes']) }).then(
        (server) => {
          current = server;
          started.push(server);
          return new Promise((resolve) => {
            server.server.once('close', resolve);
          });
        },
      );
      // A startServer rejection is kept in `serving` and rethrown by closed(); this branch only
      // stops it surfacing as an unhandled rejection before the test gets there.
      serving.catch(() => {});
      closes.push(serving);
      return { unref() {} };
    },
    kill: (pid, signal) => {
      if (signal === 'SIGTERM') current.stop();
      return true;
    },
  };
  return {
    opts: { deps },
    // The options each fake spawn call received, in call order.
    spawnOpts,
    // The daemon flags each fake spawn call received, parsed as the daemon parses its argv.
    spawnArgs: () => spawnArgs.map((args) => parseArgs(args.slice(1)).opts),
    // The latest server's own http.Server, for closing it without the marker.
    server: () => current.server,
    // Stops every server this stand-in started (stop is idempotent): cleanup for a test whose
    // CLI stop may have missed the server, so closed() cannot hang on it.
    stopAll: () => started.forEach((server) => server.stop()),
    // Resolves once every server this stand-in started has closed; rejects with the error of
    // a server that failed to start.
    closed: () => Promise.all(closes),
  };
}

test('AC4.1: an in-process daemon start-and-stop leaves SIGTERM/SIGINT listener counts unchanged', { timeout: 10000 }, async () => {
  const D = mkTmp('vd-content-');
  const S = mkTmp('vd-state-');
  const resources = (type) => process.getActiveResourcesInfo().filter((r) => r === type).length;
  const before = {
    sigterm: process.listenerCount('SIGTERM'),
    sigint: process.listenerCount('SIGINT'),
    servers: resources('TCPServerWrap'),
    timeouts: resources('Timeout'),
  };
  // stop lands well after a loop turn, so a run that resolves without waiting
  // for the server to close is caught whatever the timer/immediate order.
  const res = await runCli(BIN, ['start', '--dir', D, '--state', S, '--port', '0', '--idle-minutes', '5', '--__daemon__'], {
    cwd: D,
    deps: { onStarted: ({ stop }) => setTimeout(stop, 50) },
  });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(process.listenerCount('SIGTERM'), before.sigterm);
  assert.equal(process.listenerCount('SIGINT'), before.sigint);
  assert.equal(fs.existsSync(path.join(S, 'server-stopped')), true);
  assert.ok(resources('TCPServerWrap') <= before.servers, 'the daemon server must be closed before run resolves');
  assert.ok(resources('Timeout') <= before.timeouts, 'run must leave no timer behind');
});

test('AC5.1: require() of visual-decide.js prints nothing and leaves process.exitCode undefined', async () => {
  const D = mkTmp('vd-state-');
  // fresh: true re-requires the CLI inside the helper's snapshot, so a require-time
  // stdout/stderr write or process.exitCode change fails this call.
  const res = await runCli(BIN, ['status', '--state', D], { fresh: true });
  assert.equal(res.code, 0);
  assert.equal(process.exitCode, undefined);
});

test('AC9.1: relative --state resolves against the injected cwd', async () => {
  const D = mkTmp('vd-cwd-');
  assert.notEqual(fs.realpathSync(D), fs.realpathSync(process.cwd()));
  const neverStarted = await runCli(BIN, ['status', '--state', 'st'], { cwd: D });
  assert.equal(neverStarted.stdout, 'never-started\n');

  // A port nothing listens on: bind an ephemeral one, then close it.
  const closedPort = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  fs.mkdirSync(path.join(D, 'st'));
  fs.writeFileSync(
    path.join(D, 'st', 'server-info'),
    JSON.stringify({ pid: 0, port: closedPort, url: `http://127.0.0.1:${closedPort}/`, key: 'test' }),
  );
  fs.writeFileSync(path.join(D, 'st', 'server-stopped'), '');
  const stopped = await runCli(BIN, ['status', '--state', 'st'], { cwd: D });
  assert.equal(stopped.stdout, 'stopped\n');
});

test('AC9.1: relative --dir/--state resolve against the injected cwd for start, its daemon argv and stop', { timeout: 10000 }, async () => {
  const D = mkTmp('vd-cwd-');
  assert.notEqual(fs.realpathSync(D), fs.realpathSync(process.cwd()));
  fs.mkdirSync(path.join(D, 'content'));
  const daemon = inProcessDaemon();
  const opts = { ...daemon.opts, cwd: D };
  let stopped;
  try {
    const started = await run(['start', '--dir', 'content', '--state', 'st', '--idle-minutes', '2'], opts);
    assert.equal(started.code, 0, started.err);
    const [daemonArgs] = daemon.spawnArgs();
    assert.equal(daemonArgs.dir, path.resolve(D, 'content'));
    assert.equal(daemonArgs.state, path.resolve(D, 'st'));
    assert.equal(daemon.spawnOpts[0].cwd, D);
    assert.equal(fs.existsSync(path.join(D, 'st', 'server-info')), true);
    stopped = await run(['stop', '--state', 'st'], opts);
  } finally {
    daemon.stopAll();
    await daemon.closed();
  }
  assert.equal(stopped.code, 0, stopped.err);
  assert.equal(stopped.out, 'stopped\n');
  assert.equal(fs.existsSync(path.join(D, 'st', 'server-stopped')), true);

  // The daemon path itself, run in-process with idleMinutes=0 so it stops at once. start creates
  // the state dir before it spawns the daemon, so the test does too.
  fs.mkdirSync(path.join(D, 'st2'));
  const ran = await run(['start', '--dir', 'content', '--state', 'st2', '--idle-minutes', '0', '--__daemon__'], { cwd: D });
  assert.equal(ran.code, 0, ran.err);
  assert.equal(fs.existsSync(path.join(D, 'st2', 'server-stopped')), true);
});

// A deleted working directory makes the real cwd() throw. Absolute --dir/--state never needed it,
// and the daemon then inherits the working directory, as before the entry contract.
test('an unreadable cwd leaves absolute --dir/--state working: status, start, stop and the daemon', { timeout: 10000 }, async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const never = await run(['status', '--state', stateDir], { deps: { cwd: UNREADABLE_CWD } });
  assert.equal(never.code, 0, never.err);
  assert.equal(never.out, 'never-started\n');

  const daemon = inProcessDaemon();
  const opts = { deps: { ...daemon.opts.deps, cwd: UNREADABLE_CWD } };
  let stopped;
  try {
    const started = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '2'], opts);
    assert.equal(started.code, 0, started.err);
    assert.equal(daemon.spawnOpts[0].cwd, undefined);
    assert.equal(daemon.spawnArgs()[0].state, stateDir);
    stopped = await run(['stop', '--state', stateDir], opts);
  } finally {
    daemon.stopAll();
    await daemon.closed();
  }
  assert.equal(stopped.code, 0, stopped.err);
  assert.equal(stopped.out, 'stopped\n');

  const daemonState = mkTmp('vd-state-');
  const ran = await run(['start', '--dir', dir, '--state', daemonState, '--idle-minutes', '0', '--__daemon__'], {
    deps: { cwd: UNREADABLE_CWD },
  });
  assert.equal(ran.code, 0, ran.err);
  assert.equal(fs.existsSync(path.join(daemonState, 'server-stopped')), true);
});

test('AC1: start returns detached-running server-info (mode 0600, url has ?key=); second start refuses naming the URL', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const daemon = inProcessDaemon();
  const first = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '2'], {
    ...daemon.opts,
    cwd: dir,
    env: { VD_SENTINEL: 'ac1' },
  });
  try {
    assert.equal(first.code, 0, first.err);
    // The daemon child gets the injected cwd and env, detached and with no console window.
    const [spawned] = daemon.spawnOpts;
    assert.equal(spawned.cwd, dir);
    assert.equal(spawned.env.VD_SENTINEL, 'ac1');
    assert.equal(spawned.detached, true);
    assert.equal(spawned.windowsHide, true);
    // ...and its argv carries the requested --idle-minutes, marked as the daemon path.
    const [daemonArgs] = daemon.spawnArgs();
    assert.equal(daemonArgs['idle-minutes'], '2');
    assert.equal(daemonArgs.daemon, true);
    const info = JSON.parse(first.out);
    assert.match(info.url, /\?key=/);

    const infoPath = path.join(stateDir, 'server-info');
    assert.equal(fs.existsSync(infoPath), true);
    if (MODE_BITS_HONORED) {
      // win32 does not represent POSIX mode bits — Node reports 0o666 whatever mode was requested.
      const mode = fs.statSync(infoPath).mode & 0o777;
      assert.equal(mode, 0o600);
    }

    const second = await run(['start', '--dir', dir, '--state', stateDir], daemon.opts);
    assert.notEqual(second.code, 0);
    assert.match(second.err, new RegExp(info.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await stopQuiet(stateDir, daemon.opts);
    await daemon.closed();
  }
});

test('status: never-started, running, stopped, crashed', async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');

  const daemon = inProcessDaemon();

  try {
    const neverStarted = await run(['status', '--state', stateDir]);
    assert.equal(neverStarted.out.trim(), 'never-started');

    const started = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5'], daemon.opts);
    assert.equal(started.code, 0, started.err);

    const running = await run(['status', '--state', stateDir]);
    assert.equal(running.out.trim(), 'running');

    // crashed: close the server directly, bypassing stop's own marker write
    // (its unref'd idle and watch timers stay armed and cannot hold the process)
    await new Promise((resolve) => {
      daemon.server().close(resolve);
    });
    const crashed = await run(['status', '--state', stateDir]);
    assert.equal(crashed.out.trim(), 'crashed');

    // stopped: start again, then stop cleanly
    const restarted = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5'], daemon.opts);
    assert.equal(restarted.code, 0, restarted.err);
    const stopResult = await run(['stop', '--state', stateDir], daemon.opts);
    assert.equal(stopResult.code, 0);
    const stoppedStatus = await run(['status', '--state', stateDir]);
    assert.equal(stoppedStatus.out.trim(), 'stopped');
  } finally {
    daemon.stopAll();
    await daemon.closed();
  }
});

test('review fix: --idle-minutes 0 is honored by the daemon, not silently replaced by the 240min default', { timeout: 10000 }, async () => {
  // The daemon path runs in-process: run resolves only once the server has
  // stopped, so with idleMinutes=0 it resolves within ~1ms of starting, and
  // the 240-minute default would instead hit this test's timeout.
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  const res = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '0', '--__daemon__']);
  assert.equal(res.code, 0, res.err);
  assert.equal(
    fs.existsSync(path.join(stateDir, 'server-stopped')),
    true,
    'idleMinutes=0 must self-exit almost immediately, not run for 240 minutes',
  );
});

test('stop is stale-PID tolerant (dead PID -> already-stopped, exit 0)', async () => {
  const stateDir = mkTmp('vd-state-');
  // A dead pid: a non-CLI child this test spawned, SIGKILLed and saw exit.
  const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  await new Promise((resolve) => {
    victim.once('spawn', resolve);
  });
  const exited = new Promise((resolve) => {
    victim.once('exit', resolve);
  });
  victim.kill('SIGKILL');
  await exited;
  fs.writeFileSync(
    path.join(stateDir, 'server-info'),
    JSON.stringify({ pid: victim.pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }),
  );
  const stopResult = await run(['stop', '--state', stateDir]);
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
    // It prints once its handler is installed: the in-process stop below signals
    // at once, and a SIGTERM that lands before the handler would kill it.
    const stuck = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.stdout.write("ready");'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    await new Promise((resolve) => {
      stuck.stdout.once('data', resolve);
    });

    fs.writeFileSync(
      path.join(stateDir, 'server-info'),
      JSON.stringify({ pid: stuck.pid, port: 0, url: 'http://127.0.0.1:0/', key: 'test' }),
    );

    try {
      const stopResult = await run(['stop', '--state', stateDir]);
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
    // In-process with the real kill, and awaited: the victim is a child of this
    // test process, and only the event loop lets libuv reap it once it dies. An
    // unreaped zombie still answers kill(pid, 0), so waitFor would time out
    // and the timeout branch would write the marker, masking the handler-less
    // exit this test is about.
    const { out: stdout } = await run(['stop', '--state', stateDir]);
    assert.equal(stdout.trim(), 'stopped');
    assert.equal(
      fs.existsSync(path.join(stateDir, 'server-stopped')),
      true,
      'server-stopped marker must be written when the PID exits without its handler running',
    );
    const status = await run(['status', '--state', stateDir]);
    assert.equal(status.out.trim(), 'stopped');
  } finally {
    try {
      victim.kill('SIGKILL');
    } catch {
      // the child may already be gone
    }
  }
});

test('AC6 (daemon path, in-process): fractional --idle-minutes self-exits and status reflects stopped', { timeout: 10000 }, async () => {
  const dir = mkTmp('vd-content-');
  const stateDir = mkTmp('vd-state-');
  // The daemon path in-process: run resolves once the 3s idle timeout has stopped the server.
  const started = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '0.05', '--__daemon__']);
  assert.equal(started.code, 0, started.err);
  const status = await run(['status', '--state', stateDir]);
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
  const daemon = inProcessDaemon();
  const started = await run(['start', '--dir', dir, '--state', stateDir, '--idle-minutes', '5'], daemon.opts);
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
    await stopQuiet(stateDir, daemon.opts);
    await daemon.closed();
  }
});

// real process: a detached daemon stopped by a real SIGTERM — AC4.2
test('AC4.2: a real start detaches a daemon that an in-process stop ends with a real SIGTERM', async () => {
  // eslint-disable-next-line global-require
  const { pidAlive, waitFor, readInfo } = require(CLI_LIB);
  const D = mkTmp('vd-content-');
  const S = mkTmp('vd-state-');
  const started = spawnCli(BIN, ['start', '--dir', D, '--state', S]);
  const daemonPid = (readInfo(S) || {}).pid;
  try {
    assert.equal(started.code, 0, started.stderr);
    const info = JSON.parse(started.stdout);
    assert.match(info.url, /\?key=/);
    assert.equal(info.pid, daemonPid);
    assert.notEqual(daemonPid, process.pid);

    const stopped = await run(['stop', '--state', S]);
    assert.equal(stopped.code, 0, stopped.err);
    assert.equal(stopped.out, 'stopped\n');
    assert.equal(fs.existsSync(path.join(S, 'server-stopped')), true);
    assert.ok(await waitFor(() => !pidAlive(daemonPid), { timeoutMs: 3000 }), 'the daemon must exit on the SIGTERM stop sent it');
  } finally {
    // Never leave the daemon running: SIGKILL the pid captured above if the stop did not end it.
    if (Number.isInteger(daemonPid) && daemonPid !== process.pid && pidAlive(daemonPid)) process.kill(daemonPid, 'SIGKILL');
  }
});

// Real process: proves the script entry turns run's unknown-command refusal into the exit code (AC6.1).
test('AC6.1: no arguments is an unknown-command refusal — exit 1, empty stdout, the baseline stderr', () => {
  const res = spawnCli(BIN, []);
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, 'visual-decide: unknown command: (none) — expected start|stop|status\n');
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
