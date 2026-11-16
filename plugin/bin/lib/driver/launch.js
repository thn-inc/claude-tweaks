'use strict';

// The launch wiring the pipeline driver's two worker launches share (#5222): steps.js's
// runImplementer (the worker step, and the review step's fix round) and review.js's reviewer.
// It reads the run's two ceilings and launches one worker through deps.launchWorker with the
// first runner handle as shared.activeWorker, so run.js's signal handler can forward an
// interrupt to the worker's process group (headless-worker-launch, "What the consumer owes").
// steps.js and review.js both require it; review.js never requires steps.js.

// On win32 the worker launcher's default `bin` (`claude`) does not find an npm-installed
// `claude.cmd`, so a win32 caller passes this explicitly.
const WIN32_CLAUDE_BIN = 'claude.cmd';
const MINUTES_KEY = 'express-driver-wall-clock-minutes';
const DOLLARS_KEY = 'express-driver-spend-ceiling-dollars';

// A positive finite number from a policy value (a number, or a numeric string); else NaN.
// `Number('')` and `Number(null)` are 0, so neither passes.
function positiveNumber(value) {
  const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}

// The two ceilings from the run's resolved policy: { minutes, dollars }, or { bad } naming each
// key that is not a positive number, with its value, for the caller's stop detail.
function readCeilings(policy) {
  const minutes = positiveNumber(policy[MINUTES_KEY].value);
  const dollars = positiveNumber(policy[DOLLARS_KEY].value);
  const bad = [[MINUTES_KEY, minutes], [DOLLARS_KEY, dollars]].filter(([, v]) => Number.isNaN(v)).map(([k]) => k);
  if (bad.length) return { bad: bad.map((k) => `${k} (${JSON.stringify(policy[k].value)})`).join(', ') };
  return { minutes, dollars };
}

// Launches one worker: the caller's opts plus the ceilings, the platform, the environment and, on
// win32, WIN32_CLAUDE_BIN. Only the first runner call is the worker: on win32 the launcher's
// ceiling kill runs taskkill through the same runner, and that handle must not replace the
// worker's. shared.activeWorker is reset however the launch ends; a throw reaches the caller.
async function launchTracked(shared, deps, { minutes, dollars }, opts) {
  let captured = false;
  const runner = (call) => {
    const handle = deps.runner(call);
    if (!captured) {
      captured = true;
      shared.activeWorker = handle;
    }
    return handle;
  };
  try {
    return await deps.launchWorker({
      ...opts,
      ceilings: { wallClockMs: minutes * 60000, spendCeiling: dollars },
      platform: deps.platform,
      env: deps.env,
      ...(deps.platform === 'win32' ? { bin: WIN32_CLAUDE_BIN } : {}),
    }, { runner });
  } finally {
    shared.activeWorker = null;
  }
}

module.exports = { WIN32_CLAUDE_BIN, readCeilings, launchTracked };
