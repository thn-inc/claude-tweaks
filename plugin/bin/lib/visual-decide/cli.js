// bin/lib/visual-decide/cli.js — argv parsing, start/stop/status, daemonization,
// state-file IO. `start` self-daemonizes: it spawns the server as a detached
// child (this same entry file, re-invoked with --__daemon__) and returns once
// the child's server-info file exists and its port answers. Node builtins
// only (#1202 AC 8).
// Exports { run, realDeps, … }: run(argv, deps) resolves the exit code and
// reaches the outside world only through deps (stdout, stderr, cwd, env, spawn,
// kill, onStarted) — the entry contract is
// .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md. The daemon path
// resolves only once its server has closed and its SIGTERM/SIGINT handlers are
// removed, so an in-process call leaves no listener or open server behind.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { cwdOrUndefined } = require('../health-core/io.js');

const DEFAULT_PORT_BASE = 4173;
const DEFAULT_IDLE_MINUTES = 240;
const BIN_ENTRY = path.join(__dirname, '..', '..', 'visual-decide.js');

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--__daemon__') {
      opts.daemon = true;
      continue;
    }
    if (token.startsWith('--')) {
      opts[token.slice(2)] = rest[i + 1];
      i += 1;
    }
  }
  return { command, opts };
}

function readInfo(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, 'server-info'), 'utf8'));
  } catch {
    return null;
  }
}

// Shared --flag presence check for the three commands below — each lists
// which opts it needs; the thrown message always names the full required
// set, regardless of which of them is actually missing.
function requireOpts(opts, names, command) {
  if (names.some((name) => !opts[name])) {
    throw new Error(`${command} requires ${names.map((name) => `--${name}`).join(' and ')}`);
  }
}

// A --dir/--state value as one absolute, normalized path. An absolute value never reads d.cwd(),
// so a deleted working directory fails only a relative one.
function resolveFrom(d, p) {
  return path.isAbsolute(p) ? path.resolve(p) : path.resolve(d.cwd(), p);
}

function pidAlive(pid, kill = (p, s) => process.kill(p, s)) {
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH means the pid genuinely doesn't exist — dead. Any other error
    // (notably EPERM) means the process exists but we can't signal it —
    // alive, just unsignalable. Matches worktree-reap.js's isPidAlive /
    // residue/probes/worktrees.js's defaultIsPidAlive.
    return err && err.code !== 'ESRCH';
  }
}

// Resolves once the port answers at all (any status code) — liveness only;
// callers that need the specific status inspect the return value.
function probePort(port, key) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/?key=${encodeURIComponent(key || '')}`, timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
}

const MAX_PORT_PROBE_ATTEMPTS = 1000;

// Upward port probe: bind a throwaway server at each candidate until one
// succeeds. Starts at `base` and probes past any port that answers, up to
// MAX_PORT_PROBE_ATTEMPTS — an unbounded loop would spin forever against an
// environment with the whole range occupied (review finding).
async function findFreePortFrom(base) {
  let port = base;
  for (let attempt = 0; attempt < MAX_PORT_PROBE_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => {
        probe.close(() => resolve(true));
      });
    });
    if (free) return port;
    port += 1;
  }
  throw new Error(`no free port found in ${base}..${port - 1} (${MAX_PORT_PROBE_ATTEMPTS} attempts)`);
}

async function cmdStart(opts, d) {
  requireOpts(opts, ['dir', 'state'], 'start');
  const dir = resolveFrom(d, opts.dir);
  const stateDir = resolveFrom(d, opts.state);
  fs.mkdirSync(stateDir, { recursive: true });

  const existing = readInfo(stateDir);
  if (existing && pidAlive(existing.pid, d.kill) && (await probePort(existing.port)) !== null) {
    throw new Error(`already running at ${existing.url}`);
  }

  // Clear a stale server-info/server-stopped pair from a previous round
  // before writing fresh ones (spec's pinned Process model).
  for (const name of ['server-info', 'server-stopped']) {
    try {
      fs.unlinkSync(path.join(stateDir, name));
    } catch {
      // absent is the common case
    }
  }

  const requestedPort = opts.port ? Number(opts.port) : await findFreePortFrom(DEFAULT_PORT_BASE);
  const idleMinutes = opts['idle-minutes'] ? Number(opts['idle-minutes']) : DEFAULT_IDLE_MINUTES;

  // The daemon's cwd is undefined when d.cwd() throws (a deleted working directory): the child
  // then inherits it, as before the entry contract; its --dir/--state are absolute either way.
  const child = d.spawn(
    process.execPath,
    [
      BIN_ENTRY,
      'start',
      '--dir',
      dir,
      '--state',
      stateDir,
      '--port',
      String(requestedPort),
      '--idle-minutes',
      String(idleMinutes),
      '--__daemon__',
    ],
    { cwd: cwdOrUndefined(d), env: d.env, detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  const info = await waitFor(async () => {
    const parsed = readInfo(stateDir);
    if (!parsed) return null;
    return (await probePort(parsed.port)) !== null ? parsed : null;
  });

  if (!info) throw new Error('server did not start within 5s');
  d.stdout(`${JSON.stringify(info)}\n`);
  return 0;
}

// Runs the server in this process until it stops — on SIGTERM/SIGINT, on its
// idle timeout, or through the `stop` handed to d.onStarted — and resolves 0
// only after the server has closed and both signal handlers are removed.
async function runDaemon(opts, d) {
  // eslint-disable-next-line global-require
  const { startServer } = require('./server.js');
  const { server, info, stop } = await startServer({
    dir: resolveFrom(d, opts.dir),
    stateDir: resolveFrom(d, opts.state),
    port: Number(opts.port) || 0,
    // `|| DEFAULT` would silently replace an explicit `--idle-minutes 0`
    // (Number('0') is falsy) with the 240-minute default — check presence,
    // not truthiness (review finding).
    idleMinutes: opts['idle-minutes'] !== undefined ? Number(opts['idle-minutes']) : DEFAULT_IDLE_MINUTES,
  });
  // Attached before anything can call stop: no await sits between startServer
  // resolving and this line, so the idle timer cannot fire first.
  const closed = new Promise((resolve) => {
    server.once('close', resolve);
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  try {
    d.onStarted({ info, stop });
    await closed;
    // 'close' fires while libuv is still closing the listening handle; it is
    // released in the loop's close phase, which runs before the next timers
    // phase — so resolve from there, with no server handle left behind.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
  return 0;
}

function writeStoppedMarker(stateDir) {
  try {
    fs.writeFileSync(path.join(stateDir, 'server-stopped'), '');
  } catch {
    // best-effort
  }
}

function reportAlreadyStopped(stateDir, d) {
  writeStoppedMarker(stateDir);
  d.stdout('already stopped\n');
  return 0;
}

async function cmdStop(opts, d) {
  requireOpts(opts, ['state'], 'stop');
  const stateDir = resolveFrom(d, opts.state);
  const info = readInfo(stateDir);
  if (!info || !pidAlive(info.pid, d.kill)) {
    return reportAlreadyStopped(stateDir, d);
  }
  try {
    d.kill(info.pid, 'SIGTERM');
  } catch {
    // TOCTOU: the process could have died between the pidAlive check above
    // and this call (its own idle timeout fired, or an independent crash) —
    // that's still "already stopped", not a failure (review finding).
    return reportAlreadyStopped(stateDir, d);
  }
  await waitFor(
    () => fs.existsSync(path.join(stateDir, 'server-stopped')) || !pidAlive(info.pid, d.kill),
    { timeoutMs: 3000, intervalMs: 50 },
  );
  // The daemon's SIGTERM handler normally writes the marker, but the wait can
  // settle without it in two cases: a timeout on a zombie PID (no reaping
  // init, #3130), where pidAlive(pid) keeps answering true via kill(pid, 0),
  // and a handler-less exit (win32 SIGTERM is unconditional, outside SIGKILL;
  // #3265), where the PID is gone without the marker ever being written. Write
  // it here unconditionally, matching the dead-PID branch above -- the marker
  // is an empty presence-only file, so rewriting one the daemon already wrote
  // is a no-op, and stop is a stale-PID-tolerant contract regardless of which
  // path gets there.
  writeStoppedMarker(stateDir);
  d.stdout('stopped\n');
  return 0;
}

async function cmdStatus(opts, d) {
  requireOpts(opts, ['state'], 'status');
  const stateDir = resolveFrom(d, opts.state);
  const info = readInfo(stateDir);
  if (!info) {
    d.stdout('never-started\n');
    return 0;
  }
  if ((await probePort(info.port, info.key)) !== null) {
    d.stdout('running\n');
    return 0;
  }
  const stoppedMarker = fs.existsSync(path.join(stateDir, 'server-stopped'));
  d.stdout(stoppedMarker ? 'stopped\n' : 'crashed\n');
  return 0;
}

async function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  try {
    const { command, opts } = parseArgs(argv);
    if (opts.daemon) return await runDaemon(opts, d);
    if (command === 'start') return await cmdStart(opts, d);
    if (command === 'stop') return await cmdStop(opts, d);
    if (command === 'status') return await cmdStatus(opts, d);
    throw new Error(`unknown command: ${command || '(none)'} — expected start|stop|status`);
  } catch (err) {
    d.stderr(`visual-decide: ${err.message}\n`);
    return 1;
  }
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  get env() {
    return process.env;
  },
  // The real spawn names windowsHide in its own argument text so
  // tests/windows-hide-spawn-conformance.test.js sees it; cmdStart passes it too.
  spawn: (cmd, args, opts) => spawn(cmd, args, { ...opts, windowsHide: true }),
  kill: (pid, sig) => process.kill(pid, sig),
  onStarted: () => {},
};

module.exports = { run, realDeps, parseArgs, readInfo, probePort, pidAlive, findFreePortFrom, waitFor };
