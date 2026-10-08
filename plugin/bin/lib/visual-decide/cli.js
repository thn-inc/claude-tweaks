// bin/lib/visual-decide/cli.js — argv parsing, start/stop/status, daemonization,
// state-file IO. `start` self-daemonizes: it spawns the server as a detached
// child (this same entry file, re-invoked with --__daemon__) and returns once
// the child's server-info file exists and its port answers. Node builtins
// only (#1202 AC 8).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

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

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
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

async function cmdStart(opts) {
  const dir = opts.dir;
  const stateDir = opts.state;
  if (!dir || !stateDir) throw new Error('start requires --dir and --state');
  fs.mkdirSync(stateDir, { recursive: true });

  const existing = readInfo(stateDir);
  if (existing && pidAlive(existing.pid) && (await probePort(existing.port)) !== null) {
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

  const child = spawn(
    process.execPath,
    [
      BIN_ENTRY,
      'start',
      '--dir',
      path.resolve(dir),
      '--state',
      path.resolve(stateDir),
      '--port',
      String(requestedPort),
      '--idle-minutes',
      String(idleMinutes),
      '--__daemon__',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  const infoPath = path.join(stateDir, 'server-info');
  const info = await waitFor(async () => {
    const parsed = (() => {
      try {
        return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      } catch {
        return null;
      }
    })();
    if (!parsed) return null;
    return (await probePort(parsed.port)) !== null ? parsed : null;
  });

  if (!info) throw new Error('server did not start within 5s');
  process.stdout.write(`${JSON.stringify(info)}\n`);
}

async function runDaemon(opts) {
  // eslint-disable-next-line global-require
  const { startServer } = require('./server.js');
  const { stop } = await startServer({
    dir: path.resolve(opts.dir),
    stateDir: path.resolve(opts.state),
    port: Number(opts.port) || 0,
    // `|| DEFAULT` would silently replace an explicit `--idle-minutes 0`
    // (Number('0') is falsy) with the 240-minute default — check presence,
    // not truthiness (review finding).
    idleMinutes: opts['idle-minutes'] !== undefined ? Number(opts['idle-minutes']) : DEFAULT_IDLE_MINUTES,
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function cmdStop(opts) {
  const stateDir = opts.state;
  if (!stateDir) throw new Error('stop requires --state');
  const info = readInfo(stateDir);
  if (!info || !pidAlive(info.pid)) {
    try {
      fs.writeFileSync(path.join(stateDir, 'server-stopped'), '');
    } catch {
      // best-effort
    }
    process.stdout.write('already stopped\n');
    return;
  }
  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    // TOCTOU: the process could have died between the pidAlive check above
    // and this call (its own idle timeout fired, or an independent crash) —
    // that's still "already stopped", not a failure (review finding).
    try {
      fs.writeFileSync(path.join(stateDir, 'server-stopped'), '');
    } catch {
      // best-effort
    }
    process.stdout.write('already stopped\n');
    return;
  }
  await waitFor(
    () => fs.existsSync(path.join(stateDir, 'server-stopped')) || !pidAlive(info.pid),
    { timeoutMs: 3000, intervalMs: 50 },
  );
  process.stdout.write('stopped\n');
}

async function cmdStatus(opts) {
  const stateDir = opts.state;
  if (!stateDir) throw new Error('status requires --state');
  const info = readInfo(stateDir);
  if (!info) {
    process.stdout.write('never-started\n');
    return;
  }
  if ((await probePort(info.port, info.key)) !== null) {
    process.stdout.write('running\n');
    return;
  }
  const stoppedMarker = fs.existsSync(path.join(stateDir, 'server-stopped'));
  process.stdout.write(stoppedMarker ? 'stopped\n' : 'crashed\n');
}

async function main(argv) {
  const { command, opts } = parseArgs(argv);
  if (opts.daemon) return runDaemon(opts);
  if (command === 'start') return cmdStart(opts);
  if (command === 'stop') return cmdStop(opts);
  if (command === 'status') return cmdStatus(opts);
  throw new Error(`unknown command: ${command || '(none)'} — expected start|stop|status`);
}

module.exports = { main, parseArgs, readInfo, probePort, pidAlive, findFreePortFrom, waitFor };
