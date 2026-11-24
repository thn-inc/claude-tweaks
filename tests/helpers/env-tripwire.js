'use strict';
// Env tripwire (#5377): while `fn` runs, process.env is a Proxy over the real object that records
// reads of it made while a frame under plugin/bin is on the stack. A hook event run in-process must
// see only the `env` the test injected, so a read of the real process.env from the plugin is a defect
// the test can report.
//
// Limits (it is a tripwire, not a proof):
// - A reference to process.env captured before the tripwire arms bypasses it (plugin/bin/lib/color.js
//   keeps one in a module-level `let activeEnv = process.env;`).
// - A module first loaded while the tripwire is armed keeps the Proxy after it is restored.
// - runHookCli requires hooks.js before arming, so top-level reads in hooks.js and its static imports
//   are not checked.
// - A false positive is possible: a test's own fake in `deps` that reads process.env while hooks.js
//   is calling it has a plugin/bin frame below it and is reported.
//
// - Traps: get, has, getOwnPropertyDescriptor and ownKeys (recorded under the key '*').
// - A read counts only when the stack holds a frame under plugin/bin/ (matched with path.sep): a read
//   by the test itself, by the test runner, or by node internals with no plugin frame above them is
//   not recorded. `frame` is the first such stack line.
// - process.env is the original object again afterwards, also when `fn` throws. A write through the
//   proxy reaches the real object, so a leak the runCli leak guard reports is still reported.

const path = require('path');

const PLUGIN_BIN = path.resolve(__dirname, '..', '..', 'plugin', 'bin') + path.sep;

function pluginFrame() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 60;
  try {
    const lines = String(new Error().stack).split('\n');
    return lines.find((line) => line.includes(PLUGIN_BIN)) || null;
  } finally {
    Error.stackTraceLimit = limit;
  }
}

async function withEnvTripwire(fn) {
  const original = process.env;
  const reads = [];
  const record = (key) => {
    const frame = pluginFrame();
    if (frame) reads.push({ key: typeof key === 'symbol' ? key.toString() : String(key), frame: frame.trim() });
  };
  const proxy = new Proxy(original, {
    get(target, key) { record(key); return Reflect.get(target, key); },
    has(target, key) { record(key); return Reflect.has(target, key); },
    getOwnPropertyDescriptor(target, key) { record(key); return Reflect.getOwnPropertyDescriptor(target, key); },
    ownKeys(target) { record('*'); return Reflect.ownKeys(target); },
  });
  process.env = proxy;
  try {
    const value = await fn();
    return { value, reads };
  } finally {
    process.env = original;
  }
}

module.exports = { withEnvTripwire };
