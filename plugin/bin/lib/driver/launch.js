'use strict';

// The launch wiring the pipeline driver's two worker launches share (#5222): steps.js's
// runImplementer (the worker step, and the review step's fix round) and review.js's reviewer.
// It reads the run's two ceilings and launches one worker through deps.launchWorker with the
// first runner handle as shared.activeWorker, so run.js's signal handler can forward an
// interrupt to the worker's process group (headless-worker-launch, "What the consumer owes").
// steps.js and review.js both require it; review.js never requires steps.js.
// The model each launch gets is resolved here (#5917), from `express-driver-models` and the
// shared `model-profiles` / `model-ceiling` policy keys, never left to the account default.
// So is its launch effort (#5942): `model-effort: profile` passes resolve()'s `launchEffort` as
// `--effort`; unset (`inherit`) or a profile with no effort for that model launches at the harness default.
// A launch may also name its profile explicitly (#5997): `roleLaunch`'s `{ profile }` replaces the role-map lookup, and
// `recordImplementerProfile` is the `implementer-tier: record` rule that picks the implementer's first profile from the record.

const { DRIVER_ROLE_PROFILES, POLICY_DRIVER_ROLES } = require('./roles');
const { resolve } = require('../model-profiles/profiles');
const { neutralize } = require('./events');
const { parseRecordFacets } = require('../issues/record');
const { keyFileCount, implementerProfile } = require('../model-profiles/implementer-tier');

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

const IMPLEMENTER_TIER_KEY = 'implementer-tier';
const MODEL_POLICY_KEYS = Object.freeze(['express-driver-models', 'model-profiles', 'model-ceiling', 'model-effort', IMPLEMENTER_TIER_KEY]);
const MODEL_REFUSED_CODE = 'DRIVER_MODEL_REFUSED';

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// True when the policy step marked this key's entry `invalid`.
const isInvalidEntry = (policy, key) => Boolean(policy && policy[key] && policy[key].invalid === true);

function refuse(role, why) {
  const err = new Error(`no model for driver role ${neutralize(String(role))}: ${why}`);
  err.code = MODEL_REFUSED_CODE;
  return err;
}

// One role's launch values, `{ model, effort, profile }`: the model (a family alias) and the launch effort
// (`resolve().launchEffort`, a string or null), from the policy step's `{ [key]: { value, source } }`.
// A policy-settable role reads its profile from `express-driver-models`; any other role in
// DRIVER_ROLE_PROFILES (`explorer`) takes its code-only default; an explicit `{ profile }` replaces that lookup for this
// call. `profile` is the profile name resolved. Anything unreadable throws a
// DRIVER_MODEL_REFUSED error naming the role: the launch never falls back to the account default.
function roleLaunch(role, policy, { profile: explicit } = {}) {
  let profile;
  if (explicit !== undefined) {
    profile = explicit;
  } else if (POLICY_DRIVER_ROLES.includes(role)) {
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
  // These keys shape every role's resolution, so a malformed one fails the launch closed here, not
  // only in modelPolicyRefusal: an invalid model-ceiling reads as no ceiling and would launch unclamped.
  for (const key of ['model-profiles', 'model-ceiling', 'model-effort']) {
    if (isInvalidEntry(policy, key)) throw refuse(role, `driver model policy invalid: ${key}`);
  }
  const resolvePolicy = {};
  const profiles = policy && policy['model-profiles'] && policy['model-profiles'].value;
  if (isPlainObject(profiles)) resolvePolicy['model-profiles'] = profiles;
  const ceiling = policy && policy['model-ceiling'] && policy['model-ceiling'].value;
  if (typeof ceiling === 'string' && ceiling !== '') resolvePolicy['model-ceiling'] = ceiling;
  const effortMode = policy && policy['model-effort'] && policy['model-effort'].value;
  if (typeof effortMode === 'string' && effortMode !== '') resolvePolicy['model-effort'] = effortMode;
  try {
    const r = resolve(profile, { policy: resolvePolicy, unattended: true });
    return { model: r.model, effort: r.launchEffort, profile };
  } catch (err) {
    throw refuse(role, `profile ${neutralize(String(profile))} did not resolve (${neutralize(err.message)})`);
  }
}

// One role's model alone: roleLaunch's `model`.
const roleModel = (role, policy) => roleLaunch(role, policy).model;

// The refusal for a throw from #5996's implementer-tier functions; their messages already open with `implementer-tier: `.
function tierRefusal(err) {
  const msg = neutralize(err.message);
  return refuse('implementer', msg.startsWith('implementer-tier: ') ? msg : `implementer-tier: ${msg}`);
}

// The implementer's first profile under `implementer-tier: record` (#5997): the record's size label and
// Key Files count through #5996's rule. A throw from the rule refuses the launch, never a default profile.
// `profileFor` is a test seam.
function recordImplementerProfile({ labels, body }, { profileFor = implementerProfile } = {}) {
  try {
    return profileFor({
      size: parseRecordFacets(labels || []).size,
      keyFileCount: keyFileCount(typeof body === 'string' ? body : ''),
      rule: 'record',
    });
  } catch (err) {
    throw tierRefusal(err);
  }
}

// The reason a driver launch cannot get a model from this policy, or null: the first invalid
// model key, else the first role that does not resolve.
function modelPolicyRefusal(policy) {
  for (const key of MODEL_POLICY_KEYS) {
    if (isInvalidEntry(policy, key)) return `driver model policy invalid: ${key}`;
  }
  for (const role of Object.keys(DRIVER_ROLE_PROFILES)) {
    try {
      roleLaunch(role, policy);
    } catch (err) {
      return err.message;
    }
  }
  return null;
}

// Launches one worker: the caller's opts plus the role's resolved model and effort, the ceilings, the platform, the environment and, on
// win32, WIN32_CLAUDE_BIN. Only the first runner call is the worker: on win32 the launcher's
// ceiling kill runs taskkill through the same runner, and that handle must not replace the
// worker's. shared.activeWorker is reset however the launch ends; a throw reaches the caller.
// `opts.profile` (optional) goes to roleLaunch and is stripped from what reaches the launcher.
// `opts.effort` (#6002): `undefined` keeps roleLaunch's effort; any other value, `null` included, is the launch's effort.
// Resolves `{ envelope, model, effort, profile }`; a launcher throw is rethrown with `model`, `effort` and `profile` attached.
async function launchTracked(shared, deps, { minutes, dollars }, { profile: explicitProfile, effort: explicitEffort, ...opts }) {
  // Resolved before anything is touched: a refusal leaves the runner, the launcher and
  // shared.activeWorker as they were. `model`, `effort` and `profile` are resolved here and `profile` is
  // stripped from `opts`, so no caller can override them and the launcher never sees `profile`; `effort` is overridable only through the explicit option.
  const resolved = roleLaunch(opts.role, shared.policy, { profile: explicitProfile });
  const { model, profile } = resolved;
  const effort = explicitEffort === undefined ? resolved.effort : explicitEffort;
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
      effort,
      ceilings: { wallClockMs: minutes * 60000, spendCeiling: dollars },
      platform: deps.platform,
      env: deps.env,
      ...(deps.platform === 'win32' ? { bin: WIN32_CLAUDE_BIN } : {}),
    }, { runner });
    return { envelope, model, effort, profile };
  } catch (err) {
    // A throw after the launch values resolved carries them, so the caller's event line can still name
    // them. A refusal from roleLaunch above never reaches here, so it carries neither.
    const e = err instanceof Error ? err : new Error(String(err));
    e.model = model;
    e.effort = effort;
    e.profile = profile;
    throw e;
  } finally {
    shared.activeWorker = null;
  }
}

module.exports = { WIN32_CLAUDE_BIN, MODEL_POLICY_KEYS, MODEL_REFUSED_CODE, tierRefusal, readCeilings, roleLaunch, roleModel, modelPolicyRefusal, recordImplementerProfile, IMPLEMENTER_TIER_KEY, launchTracked };
