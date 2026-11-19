'use strict';
const { scratchDir } = require('./tmp-dir');
// Shared probe for the batched-`gh` bound (#4815): what `timeout` does a consumer's `gh` call carry
// when CLAUDE_TWEAKS_GH_TIMEOUT_MS holds `envValue`?
//
// The bound is memoized once per process and some consumers destructure it at require time, so each
// probe stubs child_process.execFileSync, evicts the consumer and shared-primitives from the require
// cache, and hands `exercise` a `setEnv` callback — the caller decides whether the env var is set
// before the consumer loads (read at require time) or after its factory runs (read per call). The
// stub, the env var and the cache are all restored before the probe returns.
//
// 45000 is above the 30000 floor (batch == single-call bound); 10000 is below it, so only
// GH_BATCH_TIMEOUT_MS (not GH_TIMEOUT_MS) yields 30000.
const ENV_KEY = 'CLAUDE_TWEAKS_GH_TIMEOUT_MS';
const GIT_ENV_KEY = 'CLAUDE_TWEAKS_GIT_TIMEOUT_MS';

function captureGhTimeout({ envValue, modulePaths, reply = '{}', exercise }) {
  const cp = require('node:child_process');
  const origExec = cp.execFileSync;
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY);
  const origEnv = process.env[ENV_KEY];
  const primitivesPath = require.resolve('../../plugin/bin/lib/shared-primitives');
  const evict = () => { for (const p of [...modulePaths, primitivesPath]) delete require.cache[p]; };
  let seen = null;
  try {
    cp.execFileSync = (cmd, args, opts) => { if (cmd === 'gh') seen = opts.timeout; return reply; };
    evict();
    exercise(() => { process.env[ENV_KEY] = envValue; });
    return seen;
  } finally {
    cp.execFileSync = origExec;
    if (hadEnv) process.env[ENV_KEY] = origEnv; else delete process.env[ENV_KEY];
    evict();
  }
}

// Evict `modulePaths` and shared-primitives from the require cache — the evict step alone, for a test
// that injects fake `deps` and only needs a fresh module load (#5050).
function evictModules(modulePaths) {
  const primitivesPath = require.resolve('../../plugin/bin/lib/shared-primitives');
  for (const p of [...modulePaths, primitivesPath]) delete require.cache[p];
}

// #5050: runs `fn` with both bound env vars (and `extraKeys`) cleared, from an empty temp cwd, and restores
// the env and the cwd afterwards. The bound getters read the env first and then the cwd's policy.yml
// (gh-timeout-ms, git-timeout-ms), so clearing the env alone would still let a raised value in this
// checkout's own policy leak in. `fn` may return a promise; the restore then runs once it settles.
function isolateExecBounds(extraKeys, fn) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const saved = new Map([ENV_KEY, GIT_ENV_KEY, ...extraKeys].map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  const emptyDir = scratchDir('ct-exec-bounds-', { realpath: true });
  const restore = () => {
    process.chdir(originalCwd);
    fs.rmSync(emptyDir, { recursive: true, force: true });
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  let result;
  try {
    delete process.env[ENV_KEY];
    delete process.env[GIT_ENV_KEY];
    process.chdir(emptyDir);
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') return result.finally(restore);
  restore();
  return result;
}

// #5050: the per-command twin of captureGhTimeout. Stubs BOTH child_process.execFileSync and
// child_process.execFile (the latter with util.promisify.custom resolving `{ stdout: reply, stderr: '' }`)
// and records EVERY `timeout` each command name carried, in spawn order, so a test asserts each runner's
// spawn separately by index. `env` is `{ ENV_NAME: value }` applied by the `setEnv()` callback handed to
// `exercise` (a value of `undefined` deletes the variable); both bound env vars are cleared first so an
// ambient developer-shell value cannot leak in, and both are restored afterwards with the stubs and cache.
function captureExecTimeouts({ env = {}, modulePaths = [], reply = '{}', exercise }) {
  const cp = require('node:child_process');
  const util = require('node:util');
  const path = require('node:path');
  const origExecFileSync = cp.execFileSync;
  const origExecFile = cp.execFile;
  const seen = { gh: [], git: [], node: [] };
  const record = (cmd, args, opts) => {
    const name = path.basename(String(cmd)).replace(/\.exe$/i, '');
    if (!Object.prototype.hasOwnProperty.call(seen, name)) return;
    const options = [args, opts].find((a) => a && typeof a === 'object' && !Array.isArray(a));
    seen[name].push(options ? options.timeout : undefined);
  };
  const execFileStub = (cmd, args, opts, cb) => {
    record(cmd, args, opts);
    const done = [args, opts, cb].find((a) => typeof a === 'function');
    if (done) done(null, reply, '');
    return { kill() {}, on() {}, once() {} };
  };
  execFileStub[util.promisify.custom] = (cmd, args, opts) => {
    record(cmd, args, opts);
    return Promise.resolve({ stdout: reply, stderr: '' });
  };
  const setEnv = () => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  return isolateExecBounds(Object.keys(env), () => {
    try {
      cp.execFileSync = (cmd, args, opts) => { record(cmd, args, opts); return reply; };
      cp.execFile = execFileStub;
      evictModules(modulePaths);
      exercise(setEnv);
      return seen;
    } finally {
      cp.execFileSync = origExecFileSync;
      cp.execFile = origExecFile;
      evictModules(modulePaths);
    }
  });
}

module.exports = { captureGhTimeout, captureExecTimeouts, evictModules, isolateExecBounds };
