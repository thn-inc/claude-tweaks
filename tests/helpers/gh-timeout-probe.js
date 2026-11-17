'use strict';
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

// #5050: the per-command twin of captureGhTimeout. Stubs BOTH child_process.execFileSync and
// child_process.execFile (the latter with util.promisify.custom resolving `{ stdout: reply, stderr: '' }`)
// and records EVERY `timeout` each command name carried, in spawn order, so a test asserts each runner's
// spawn separately by index. `env` is `{ ENV_NAME: value }` applied by the `setEnv()` callback handed to
// `exercise` (a value of `undefined` deletes the variable); both bound env vars are cleared first so an
// ambient developer-shell value cannot leak in, and both are restored afterwards with the stubs and cache.
function captureExecTimeouts({ env = {}, modulePaths = [], reply = '{}', exercise }) {
  const cp = require('node:child_process');
  const util = require('node:util');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const origExecFileSync = cp.execFileSync;
  const origExecFile = cp.execFile;
  const saved = new Map();
  for (const key of [ENV_KEY, GIT_ENV_KEY, ...Object.keys(env)]) {
    if (saved.has(key)) continue;
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
  }
  // Run from an empty temp dir: the bound getters read the cwd's policy.yml (gh-timeout-ms, git-timeout-ms),
  // and the env clearing above does not stop a raised value in this checkout's own policy from leaking in.
  const originalCwd = process.cwd();
  const emptyDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ct-exec-bounds-'));
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
  try {
    delete process.env[ENV_KEY];
    delete process.env[GIT_ENV_KEY];
    cp.execFileSync = (cmd, args, opts) => { record(cmd, args, opts); return reply; };
    cp.execFile = execFileStub;
    process.chdir(emptyDir);
    evictModules(modulePaths);
    exercise(setEnv);
    return seen;
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(emptyDir, { recursive: true, force: true });
    cp.execFileSync = origExecFileSync;
    cp.execFile = origExecFile;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    evictModules(modulePaths);
  }
}

module.exports = { captureGhTimeout, captureExecTimeouts, evictModules };
