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

module.exports = { captureGhTimeout };
