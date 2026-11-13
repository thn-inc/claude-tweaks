'use strict';
// In-process CLI test helper (#5374).
//
// Measured: tests started a fresh node process for every plugin CLI call. A CLI
// that meets the entry contract — `run(argv, deps)` plus `realDeps`, reaching the
// outside world only through `deps` (.claude/skills/gh-api-module-pattern/
// cli-wrapper-contract.md) — can instead be called inside the test process:
//
// - `runCli` / `runCliSync` require the CLI, merge `{ ...realDeps, ...fakes, ...deps }`
//   (fakes: stdout/stderr collectors, cwd, a frozen env, stdin, homeDir) and call
//   `run`. A real value left in the merge under a FAIL_CLOSED_KEYS name throws when
//   reached unless `allowRealRunner: true`, and the reach is also recorded, so a
//   CLI that catches its runner's error (the per-call fail-safe posture) still
//   fails the call.
// - `cliPath` must be absolute: `require` resolves a relative path against this
//   helper's own directory, not the test's.
// - `fresh: true` deletes every `require.cache` entry under `plugin/bin` before the
//   require, so the CLI and every module it loads start from a clean module state.
//   Module-level state under `plugin/bin` (the forge probe's memos in repo-resolve.js,
//   for example) otherwise survives from one in-process call to the next in the same
//   test file; a case whose answer depends on that state passes `fresh: true`.
// - Failure precedence after `run` returns: an error `run` threw or rejected with
//   is rethrown first; then a recorded real-runner reach; then (runCliSync only)
//   the refusal of a promise-returning `run`; then the leak report; then the
//   integer exit-code check.
// - A leak guard fails the call when the CLI touches process state the contract
//   forbids: process.exitCode, process.cwd(), process.env, signal/exit listeners,
//   a direct process.stdout/stderr write, or os.homedir() under an injected HOME.
//   Its snapshot is taken before the require, so what a module does while it loads
//   is inside the guard too. The state is put back first (listeners through
//   process.rawListeners, so a `once` listener comes back as one, in its place), so
//   one leaky CLI cannot break later tests. Writes and homedir calls are attributed
//   to the CLI through an AsyncLocalStorage, so the test runner's own output in the
//   same window is not counted.
// - When runCliSync refuses a promise-returning `run`, that `run` keeps going after
//   the state was restored, so anything it changes after its first `await` is
//   neither reported nor undone.
// - `spawnCli` runs the same file as a real child, for the few smoke tests that
//   prove the script entry.
//
// `env` defaults to `{}` and is the complete environment the CLI sees. A CLI that
// starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` a
// test passes, or the failure reads as "git not found" rather than as a CLI defect;
// a test that wants the ambient environment passes `{ ...process.env }`.

const os = require('os');
const path = require('path');
const util = require('util');
const { spawnSync } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');

const PLUGIN_BIN = path.resolve(__dirname, '..', '..', 'plugin', 'bin') + path.sep;
const CONTRACT = '.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md';
// The fail-closed rule: after merging `realDeps` with the test's fakes, a key named here that
// still holds the CLI's real value is replaced with a function that throws, and the reach is
// recorded so a CLI that catches the throw still fails the test; `allowRealRunner: true` lifts
// it for one call. The list is by key name: a `realDeps` key that can start `gh` or an
// arbitrary command carries one of these names, and a record converting a CLI whose `realDeps`
// holds such a seam under another name (for example `execFileSync`, `runPremiseCheck`) adds that
// name here in the same change. A git-only seam (`git`, `gitRunner`) is deliberately not on the
// list: it runs real git against the injected `cwd` and `env`, which is the behaviour under test.
const FAIL_CLOSED_KEYS = ['runner', 'gh', 'spawn'];
const LISTENER_EVENTS = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException'];

const storage = new AsyncLocalStorage();
let pending = false;

// Takes the leak-guard snapshot, requires the CLI inside it and builds the merged deps.
// Shared by runCli and runCliSync. -> { call, snap }; on a throw the snapshot is already
// restored and the call is no longer pending.
function prepare(cliPath, opts) {
  if (pending) throw new Error('runCli: another runCli call is still pending');
  const { env = {}, cwd = process.cwd(), stdin = '', deps = {}, fresh = false, allowRealRunner = false } = opts;
  if (fresh) {
    for (const key of Object.keys(require.cache)) if (key.startsWith(PLUGIN_BIN)) delete require.cache[key];
  }
  const name = path.basename(cliPath);
  const snap = snapshot(env);
  let cli;
  try {
    cli = storage.run(snap.token, () => require(cliPath));
    for (const key of ['run', 'realDeps']) {
      const ok = key === 'run' ? typeof cli.run === 'function' : cli.realDeps !== null && typeof cli.realDeps === 'object';
      if (!ok) throw new Error(`runCli: ${name} exports no ${key} — see the entry contract in ${CONTRACT}`);
    }
  } catch (err) {
    finish(snap, name);
    throw err;
  }
  const out = { stdout: '', stderr: '' };
  const fakes = {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
    cwd: () => cwd,
    env: Object.freeze({ ...env }),
    stdin: () => stdin,
    homeDir: () => {
      const home = env.HOME || env.USERPROFILE;
      if (!home) throw new Error('runCli: env has no HOME or USERPROFILE');
      return home;
    },
  };
  const merged = { ...cli.realDeps, ...fakes, ...deps };
  const reached = new Set();
  if (!allowRealRunner) {
    for (const key of FAIL_CLOSED_KEYS) {
      if (merged[key] !== undefined && merged[key] === cli.realDeps[key]) {
        merged[key] = () => {
          reached.add(key);
          throw realReached(key);
        };
      }
    }
  }
  return { call: { cli, name, merged, out, reached }, snap };
}

function realReached(key) {
  return new Error(`runCli: real ${key} reached — pass a fake in deps or allowRealRunner: true`);
}

// The recorded real-runner reach that outranks the leak report, or null.
function reachedError(call) {
  const [key] = call.reached;
  return key === undefined ? null : realReached(key);
}

// Records process state and installs the recorders; marks a call pending. `env` is the
// call's injected environment, read for whether HOME or USERPROFILE differs from the real one.
function snapshot(env) {
  const token = {};
  const hits = { stdout: false, stderr: false, homedir: false };
  const injected = ['HOME', 'USERPROFILE'].some((k) => env[k] !== undefined && env[k] !== process.env[k]);
  const streams = ['stdout', 'stderr'].map((name) => {
    const stream = process[name];
    const own = Object.prototype.hasOwnProperty.call(stream, 'write');
    const original = stream.write;
    stream.write = function write(...args) {
      if (storage.getStore() !== token) return original.apply(this, args);
      hits[name] = true;
      return true;
    };
    return { stream, own, original };
  });
  const homedir = os.homedir;
  os.homedir = function recordedHomedir(...args) {
    if (storage.getStore() === token && injected) hits.homedir = true;
    return homedir.apply(this, args);
  };
  pending = true;
  return {
    token,
    hits,
    streams,
    homedir,
    exitCode: process.exitCode,
    cwd: process.cwd(),
    env: { ...process.env },
    listeners: LISTENER_EVENTS.map((event) => [event, process.rawListeners(event)]),
  };
}

// Restores everything snapshot() recorded and returns the leak error, or null.
function finish(snap, name) {
  const diffs = [];
  try {
    for (const { stream, own, original } of snap.streams) {
      if (own) stream.write = original; else delete stream.write;
    }
    os.homedir = snap.homedir;
    if (process.exitCode !== snap.exitCode) {
      diffs.push(`process.exitCode changed (${snap.exitCode} -> ${process.exitCode})`);
      process.exitCode = snap.exitCode;
    }
    if (process.cwd() !== snap.cwd) {
      diffs.push('process.cwd() changed');
      process.chdir(snap.cwd);
    }
    for (const key of new Set([...Object.keys(snap.env), ...Object.keys(process.env)])) {
      const before = snap.env[key];
      const now = process.env[key];
      if (before === now) continue;
      if (before === undefined) {
        diffs.push(`process.env.${key} added`);
        delete process.env[key];
      } else {
        diffs.push(`process.env.${key} ${now === undefined ? 'removed' : 'changed'}`);
        process.env[key] = before;
      }
    }
    // Raw listeners: a `once` listener is its wrapper, which re-registered with `on` still
    // removes itself when it fires, so the list comes back exactly, in its original order.
    for (const [event, before] of snap.listeners) {
      const now = process.rawListeners(event);
      if (now.length === before.length && now.every((fn, i) => fn === before[i])) continue;
      diffs.push(`${event} listeners ${before.length} -> ${now.length}`);
      process.removeAllListeners(event);
      for (const fn of before) process.on(event, fn);
    }
    if (snap.hits.stdout) diffs.push('wrote to process.stdout directly');
    if (snap.hits.stderr) diffs.push('wrote to process.stderr directly');
    if (snap.hits.homedir) diffs.push('called os.homedir() while env.HOME was injected');
  } finally {
    pending = false;
  }
  return diffs.length ? new Error(`runCli: ${name} leaked process state: ${diffs.join('; ')}`) : null;
}

function result(call, code) {
  if (!Number.isInteger(code)) throw new Error(`runCli: run returned ${util.inspect(code)}, expected an integer exit code`);
  return { code, stdout: call.out.stdout, stderr: call.out.stderr };
}

// Deliberately not `async`: the pending check throws to the caller synchronously.
function runCli(cliPath, argv, opts = {}) {
  if (pending) throw new Error('runCli: another runCli call is still pending');
  let prepared;
  try { prepared = prepare(cliPath, opts); } catch (err) { return Promise.reject(err); }
  const { call, snap } = prepared;
  let ret;
  try { ret = storage.run(snap.token, () => call.cli.run(argv, call.merged)); } catch (err) { ret = Promise.reject(err); }
  return (async () => {
    let code;
    let error;
    let threw = false;
    try { code = await ret; } catch (err) { threw = true; error = err; }
    const leak = finish(snap, call.name);
    if (threw) throw error;
    const reach = reachedError(call);
    if (reach) throw reach;
    if (leak) throw leak;
    return result(call, code);
  })();
}

function runCliSync(cliPath, argv, opts = {}) {
  const { call, snap } = prepare(cliPath, opts);
  let ret;
  let error;
  let threw = false;
  try { ret = storage.run(snap.token, () => call.cli.run(argv, call.merged)); } catch (err) { threw = true; error = err; }
  const leak = finish(snap, call.name);
  if (threw) throw error;
  const reach = reachedError(call);
  if (reach) throw reach;
  if (ret && typeof ret.then === 'function') {
    ret.then(() => {}, () => {}); // the abandoned promise must not surface as an unhandled rejection
    throw new Error('runCliSync: run returned a promise — use runCli');
  }
  if (leak) throw leak;
  return result(call, ret);
}

function spawnCli(cliPath, argv, { env = process.env, cwd, stdin } = {}) {
  const res = spawnSync(process.execPath, [cliPath, ...argv], { encoding: 'utf8', windowsHide: true, cwd, env, input: stdin });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

module.exports = { runCli, runCliSync, spawnCli };
