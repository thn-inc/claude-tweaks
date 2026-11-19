'use strict';

// The launch wiring the pipeline driver's two worker launches share (#5222): steps.js's
// runImplementer (the worker step, and the review step's fix round) and review.js's reviewer.
// It reads the run's two ceilings and launches one worker through deps.launchWorker with the
// first runner handle as shared.activeWorker, so run.js's signal handler can forward an
// interrupt to the worker's process group (headless-worker-launch, "What the consumer owes").
// steps.js and review.js both require it; review.js never requires steps.js.
// The model each launch gets is resolved here (#5917), from `express-driver-models` and the
// shared `model-profiles` / `model-ceiling` policy keys, never left to the account default.

const { DRIVER_ROLE_PROFILES, POLICY_DRIVER_ROLES } = require('./roles');
const { resolve } = require('../model-profiles/profiles');
const { neutralize } = require('./events');

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

const MODEL_POLICY_KEYS = Object.freeze(['express-driver-models', 'model-profiles', 'model-ceiling']);
const MODEL_REFUSED_CODE = 'DRIVER_MODEL_REFUSED';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function refuse(role, why) {
  const err = new Error(`no model for driver role ${neutralize(String(role))}: ${why}`);
  err.code = MODEL_REFUSED_CODE;
  return err;
}

// One role's model (a family alias) from the policy step's `{ [key]: { value, source } }`. A
// policy-settable role reads its profile from `express-driver-models`; any other role in
// DRIVER_ROLE_PROFILES (`explorer`) takes its code-only default. Anything unreadable throws a
// DRIVER_MODEL_REFUSED error naming the role: the launch never falls back to the account default.
function roleModel(role, policy) {
  let profile;
  if (POLICY_DRIVER_ROLES.includes(role)) {
    const entry = policy && policy['express-driver-models'];
    const map = entry && entry.value;
    if (!isPlainObject(map)) throw refuse(role, 'role map unreadable');
    if (!hasOwn(map, role)) throw refuse(role, 'no work profile in the role map');
    profile = map[role];
  } else if (hasOwn(DRIVER_ROLE_PROFILES, role)) {
    profile = DRIVER_ROLE_PROFILES[role];
  } else {
    throw refuse(role, 'no work profile in the role map');
  }
  // Both keys shape every role's resolution, so a malformed one fails the launch closed here, not
  // only in modelPolicyRefusal: an invalid model-ceiling reads as no ceiling and would launch unclamped.
  for (const key of ['model-profiles', 'model-ceiling']) {
    if (policy && policy[key] && policy[key].invalid === true) throw refuse(role, `driver model policy invalid: ${key}`);
  }
  const resolvePolicy = {};
  const profiles = policy && policy['model-profiles'] && policy['model-profiles'].value;
  if (isPlainObject(profiles)) resolvePolicy['model-profiles'] = profiles;
  const ceiling = policy && policy['model-ceiling'] && policy['model-ceiling'].value;
  if (typeof ceiling === 'string' && ceiling !== '') resolvePolicy['model-ceiling'] = ceiling;
  try {
    return resolve(profile, { policy: resolvePolicy, unattended: true }).model;
  } catch (err) {
    throw refuse(role, `profile ${profile} did not resolve (${neutralize(err.message)})`);
  }
}

// The reason a driver launch cannot get a model from this policy, or null: the first invalid
// model key, else the first role that does not resolve.
function modelPolicyRefusal(policy) {
  for (const key of MODEL_POLICY_KEYS) {
    if (policy && policy[key] && policy[key].invalid === true) return `driver model policy invalid: ${key}`;
  }
  for (const role of Object.keys(DRIVER_ROLE_PROFILES)) {
    try {
      roleModel(role, policy);
    } catch (err) {
      return err.message;
    }
  }
  return null;
}

// Launches one worker: the caller's opts plus the role's resolved model, the ceilings, the platform, the environment and, on
// win32, WIN32_CLAUDE_BIN. Only the first runner call is the worker: on win32 the launcher's
// ceiling kill runs taskkill through the same runner, and that handle must not replace the
// worker's. shared.activeWorker is reset however the launch ends; a throw reaches the caller.
// Resolves `{ envelope, model }`; a launcher throw is rethrown with `model` attached.
async function launchTracked(shared, deps, { minutes, dollars }, opts) {
  // Resolved before anything is touched: a refusal leaves the runner, the launcher and
  // shared.activeWorker as they were. `model` follows the opts spread, so no caller can override it.
  const model = roleModel(opts.role, shared.policy);
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
    const envelope = await deps.launchWorker({
      ...opts,
      model,
      ceilings: { wallClockMs: minutes * 60000, spendCeiling: dollars },
      platform: deps.platform,
      env: deps.env,
      ...(deps.platform === 'win32' ? { bin: WIN32_CLAUDE_BIN } : {}),
    }, { runner });
    return { envelope, model };
  } catch (err) {
    // A throw after the model resolved carries it, so the caller's event line can still name it. A
    // refusal from roleModel above never reaches here, so it carries no `model`.
    const e = err instanceof Error ? err : new Error(String(err));
    e.model = model;
    throw e;
  } finally {
    shared.activeWorker = null;
  }
}

module.exports = { WIN32_CLAUDE_BIN, MODEL_POLICY_KEYS, MODEL_REFUSED_CODE, readCeilings, roleModel, modelPolicyRefusal, launchTracked };
