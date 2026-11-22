'use strict';

// Pure: the shared "is this too risky/large for machine origination" predicate.
// Compares a record's risk:*/size:* facets against a policy's risk-floor/size-floor
// keys. Two consumers: grant-gate.js's gate 5 (replaces its old hardcoded
// risk:high-only check) and the acceptance gate (a companion sub-issue that
// decides whether a record gets an acceptance state at all). See #366.

const { TIERS } = require('./record.js');

// undefined on a floor defaults to the schema default ('high') as a fail-safe
// for a caller that forgot to resolve the key. null is a distinct, deliberate
// "this axis is not evaluated for this call" — never defaulted.
function normalizedFloor(floor) {
  if (floor === null) return null;
  return floor === undefined ? 'high' : floor;
}

// facets: { risk?: 'low'|'medium'|'high', size?: 'low'|'medium'|'high' }
// policy: { riskFloor: 'low'|'medium'|'high'|'always'|null|undefined,
//           sizeFloor: 'low'|'medium'|'high'|'always'|null|undefined }
// returns: { exceeds: boolean, reason: 'risk' | 'size' | 'unscored' | null }
function exceedsOversightFloor(facets, policy) {
  const pol = policy || {};
  const f = facets || {};
  const riskFloor = normalizedFloor(pol.riskFloor);
  const sizeFloor = normalizedFloor(pol.sizeFloor);

  // 1. 'always' short-circuits regardless of tier. Risk wins ties throughout
  // this function, so it is checked first at every step.
  if (riskFloor === 'always') return { exceeds: true, reason: 'risk' };
  if (sizeFloor === 'always') return { exceeds: true, reason: 'size' };

  // 2. Unscored check — a missing or out-of-vocabulary facet on any evaluated
  // (non-null-floor) axis fails closed, before either tier comparison runs.
  if (riskFloor !== null && !TIERS.includes(f.risk)) return { exceeds: true, reason: 'unscored' };
  if (sizeFloor !== null && !TIERS.includes(f.size)) return { exceeds: true, reason: 'unscored' };

  // 3. Risk-floor comparison (skipped when riskFloor is null).
  if (riskFloor !== null && TIERS.indexOf(f.risk) >= TIERS.indexOf(riskFloor)) {
    return { exceeds: true, reason: 'risk' };
  }

  // 4. Size-floor comparison (skipped when sizeFloor is null).
  if (sizeFloor !== null && TIERS.indexOf(f.size) >= TIERS.indexOf(sizeFloor)) {
    return { exceeds: true, reason: 'size' };
  }

  return { exceeds: false, reason: null };
}

// The parent-aggregation input: the max risk tier across a decomposition parent's
// sub-issues, for the caller to pass as `facets.risk` alongside `sizeFloor: null`
// (see #367/#368 — size is never read at the parent level). `leaves` is an array
// of per-sub-issue facets objects (`{ risk?: ... }`, as returned by
// `parseRecordFacets`); any entry missing or out-of-vocabulary on `risk` makes the
// whole aggregate unscored (returns `undefined`, which `exceedsOversightFloor`'s own
// TIERS.includes check then fails closed on) — a single unscored sub-issue must not
// be silently outvoted by its siblings' valid tiers.
function maxRiskTier(leaves) {
  const risks = (Array.isArray(leaves) ? leaves : []).map((leaf) => leaf && leaf.risk);
  if (risks.length === 0 || risks.some((r) => !TIERS.includes(r))) return undefined;
  return risks.reduce((max, r) => (TIERS.indexOf(r) > TIERS.indexOf(max) ? r : max), risks[0]);
}

module.exports = { exceedsOversightFloor, maxRiskTier };
