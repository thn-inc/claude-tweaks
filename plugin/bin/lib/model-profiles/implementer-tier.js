// bin/lib/model-profiles/implementer-tier.js
//
// Pure decision module for the implementer tier (#5996): given a record's
// `size:` and Key Files count, which work profile its implementer runs at.
// Two rules — `lane` (the default: today's size-only mapping to
// fast/standard/capable, the standard lane's rule) and `record` (the opt-in:
// size low + 1-2 files steps down to fast, everything else standard).
// Consumers: the driver (#5997) and the standard lane (#5999).
//
// #6002 adds the effort ladder: `startEffort` (the first attempt's effort from
// the record's risk and the profile's launchEffort, clamped to high) and
// `nextAttempt` (the next profile/effort rung after a failure trigger, at most
// two escalations, never above high).
//
// A throw is the consumer's to act on — this module never falls back to a
// default profile on bad input.
'use strict';

const { inspect } = require('node:util');
const { extractKeyFilesSection } = require('../issues/grouping');
const { PROFILES, PROFILE_ORDER, EFFORT_SCALE } = require('./profiles');

const POLICY_KEY = 'implementer-tier';
const RULES = ['lane', 'record'];
const SIZES = ['low', 'medium', 'high'];
// The step-up ladder stops at capable: frontier is never a step-up target.
const LADDER = PROFILE_ORDER.filter((p) => p !== 'frontier');
const LANE_PROFILE = { low: 'fast', medium: 'standard', high: 'capable' };

// A directory, a glob, or a brace list names several files at once.
const BRACE_LIST_RE = /\{[^{},]*,[^{}]*\}/;
const MULTI_FILE_FLOOR = 3;

// Names a bad value in a refusal: strings quoted, everything else through
// util.inspect, which prints NaN, Infinity, 1n, Symbol(x), [ 'lane' ], {} and a
// null-prototype object as themselves and never throws (JSON.stringify prints
// NaN as null and throws on a BigInt; String() flattens arrays and throws on a
// null-prototype object).
function describe(v) {
  return typeof v === 'string' ? JSON.stringify(v) : inspect(v);
}

function namesSeveralFiles(p) {
  return p.endsWith('/') || p.includes('*') || p.includes('?') || BRACE_LIST_RE.test(p);
}

function keyFileCount(body) {
  const paths = new Set(extractKeyFilesSection(body));
  for (const p of paths) {
    if (namesSeveralFiles(p)) return Math.max(paths.size, MULTI_FILE_FLOOR);
  }
  return paths.size;
}

function implementerProfile({ size, keyFileCount: count, rule } = {}) {
  if (!RULES.includes(rule)) {
    throw new Error(`implementer-tier: unknown rule ${describe(rule)} — expected lane or record`);
  }
  if (size !== undefined && size !== null && !SIZES.includes(size)) {
    throw new Error(`implementer-tier: unknown size ${describe(size)} — expected low, medium or high`);
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`implementer-tier: invalid keyFileCount ${describe(count)} — expected a non-negative safe integer`);
  }
  if (rule === 'record') {
    return size === 'low' && (count === 1 || count === 2) ? 'fast' : 'standard';
  }
  return size === undefined || size === null ? null : LANE_PROFILE[size];
}

function stepUp(profile) {
  if (profile === null) return null;
  if (typeof profile !== 'string' || !Object.hasOwn(PROFILES, profile)) {
    throw new Error(`implementer-tier: unknown profile ${describe(profile)}`);
  }
  const idx = LADDER.indexOf(profile);
  if (idx === -1 || idx === LADDER.length - 1) return null; // frontier or capable
  return LADDER[idx + 1];
}

const TRIGGERS = Object.freeze(['red-tests', 'fix-round-failed', 'blocked', 'cannot-complete']);
const MAX_ESCALATIONS = 2;
const EFFORT_CAP = 'high';
const CAP_IDX = EFFORT_SCALE.indexOf(EFFORT_CAP);

// A launchEffort clamped to the cap; null/undefined stay null.
function clampEffort(launchEffort) {
  if (launchEffort === null || launchEffort === undefined) return null;
  const i = EFFORT_SCALE.indexOf(launchEffort);
  if (i === -1) throw new Error(`implementer-tier: unknown launchEffort ${describe(launchEffort)}`);
  return EFFORT_SCALE[Math.min(i, CAP_IDX)];
}

// The one valid risk among the given `risk:` values: exactly one value, low/medium/high; else undefined
// (zero, two or more, or an invalid value all read as no risk, so startEffort never lowers on a guess).
function riskOf(values) {
  return Array.isArray(values) && values.length === 1 && SIZES.includes(values[0]) ? values[0] : undefined;
}

function startEffort({ risk, launchEffort } = {}) {
  const base = clampEffort(launchEffort);
  if (base === null) return null;
  if (risk !== 'low' && risk !== 'medium') return base;
  return EFFORT_SCALE[Math.min(EFFORT_SCALE.indexOf(base), EFFORT_SCALE.indexOf(risk))];
}

function nextAttempt({ profile, effort, escalations, trigger, resolveProfile } = {}) {
  if (typeof profile !== 'string' || !Object.hasOwn(PROFILES, profile)) {
    throw new Error(`implementer-tier: unknown profile ${describe(profile)}`);
  }
  if (!TRIGGERS.includes(trigger)) {
    throw new Error(`implementer-tier: unknown trigger ${describe(trigger)} — expected ${TRIGGERS.join(', ')}`);
  }
  if (!Number.isSafeInteger(escalations) || escalations < 0 || escalations > MAX_ESCALATIONS) {
    throw new Error(`implementer-tier: invalid escalations ${describe(escalations)} — expected an integer 0..${MAX_ESCALATIONS}`);
  }
  if (effort !== null && !EFFORT_SCALE.includes(effort)) {
    throw new Error(`implementer-tier: unknown effort ${describe(effort)}`);
  }
  if (typeof resolveProfile !== 'function') {
    throw new Error(`implementer-tier: resolveProfile must be a function, got ${describe(resolveProfile)}`);
  }
  if (escalations >= MAX_ESCALATIONS) return null;
  if (escalations === 0 && (trigger === 'red-tests' || trigger === 'fix-round-failed')
      && effort !== null && EFFORT_SCALE.indexOf(effort) < CAP_IDX) {
    return { profile, effort: EFFORT_SCALE[EFFORT_SCALE.indexOf(effort) + 1], escalations: 1 };
  }
  const to = stepUp(profile);
  if (to === null) return null;
  const target = resolveProfile(to);
  if (target.model === resolveProfile(profile).model) return null;
  return { profile: to, effort: clampEffort(target.launchEffort), escalations: escalations + 1 };
}

module.exports = {
  POLICY_KEY, RULES, SIZES, TRIGGERS, MAX_ESCALATIONS, EFFORT_CAP,
  keyFileCount, implementerProfile, stepUp, startEffort, nextAttempt, riskOf,
};
