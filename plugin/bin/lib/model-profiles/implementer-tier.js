// bin/lib/model-profiles/implementer-tier.js
//
// Pure decision module for the implementer tier (#5996): given a record's
// `size:` and Key Files count, which work profile its implementer runs at.
// Two rules — `record` (the default, size low + 1-2 files steps down to fast)
// and `lane` (size maps straight to fast/standard/capable, the standard
// lane's rule). Consumers: the driver (#5997) and the standard lane (#5999).
//
// A throw is the consumer's to act on — this module never falls back to a
// default profile on bad input.
'use strict';

const { extractKeyFilesSection } = require('../issues/grouping');
const { PROFILES } = require('./profiles');

const POLICY_KEY = 'implementer-tier';
const RULES = ['lane', 'record'];
const SIZES = ['low', 'medium', 'high'];
const LADDER = ['fast', 'standard', 'capable'];
const LANE_PROFILE = { low: 'fast', medium: 'standard', high: 'capable' };

// A directory, a glob, or a brace list names several files at once.
const BRACE_LIST_RE = /\{[^}]*,[^}]*\}/;
const MULTI_FILE_FLOOR = 3;

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
    throw new Error(`implementer-tier: unknown rule ${JSON.stringify(rule)} — expected lane or record`);
  }
  if (size !== undefined && size !== null && !SIZES.includes(size)) {
    throw new Error(`implementer-tier: unknown size ${JSON.stringify(size)} — expected low, medium or high`);
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`implementer-tier: invalid keyFileCount ${JSON.stringify(count)} — expected a non-negative safe integer`);
  }
  if (rule === 'record') {
    return size === 'low' && (count === 1 || count === 2) ? 'fast' : 'standard';
  }
  return size === undefined || size === null ? null : LANE_PROFILE[size];
}

function stepUp(profile) {
  if (profile === null) return null;
  if (typeof profile !== 'string' || !Object.hasOwn(PROFILES, profile)) {
    throw new Error(`implementer-tier: unknown profile ${JSON.stringify(profile)}`);
  }
  const idx = LADDER.indexOf(profile);
  if (idx === -1 || idx === LADDER.length - 1) return null; // frontier or capable
  return LADDER[idx + 1];
}

module.exports = { POLICY_KEY, RULES, SIZES, keyFileCount, implementerProfile, stepUp };
