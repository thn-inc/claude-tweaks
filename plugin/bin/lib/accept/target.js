// bin/lib/accept/target.js
// Pure: where a human's acceptance check runs (#4615) — `local` (the worktree) or `dev`
// (a deployed dev environment). Precedence: a kept risk flag forces local; then a
// per-item override (only `local` is honoured); then the policy default; then local. An optional
// `tripwire` ({ status, newFlags }, #4619) sits ahead of all of it: a tripwire that could not run
// forces local with reason `tripwire`, and a flag it newly found counts as a kept risk flag.
// `dev` is reachable only through an affirmative, valid `policyDefault: 'dev'` with no
// kept flag and no item override — every unreadable or invalid input fails closed to
// `local` with reason `invalid-input`. No I/O.
'use strict';

const TARGETS = ['local', 'dev'];
const REASONS = ['risk-flag', 'item-override', 'policy', 'default', 'invalid-input', 'tripwire'];

const INVALID = () => ({ target: 'local', reason: 'invalid-input' });

function validTripwire(tripwire) {
  return tripwire !== null && typeof tripwire === 'object'
    && (tripwire.status === 'ok' || tripwire.status === 'could-not-run')
    && Array.isArray(tripwire.newFlags) && tripwire.newFlags.every((f) => typeof f === 'string');
}

function resolveAcceptanceTarget(input = {}) {
  if (input === null || typeof input !== 'object') return INVALID();
  const { keptRiskFlags, itemOverride, policyDefault, tripwire } = input;
  if (!Array.isArray(keptRiskFlags) || keptRiskFlags.some((f) => typeof f !== 'string')) return INVALID();
  if (tripwire !== undefined && !validTripwire(tripwire)) return INVALID();
  if (tripwire !== undefined && tripwire.status === 'could-not-run') return { target: 'local', reason: 'tripwire' };
  if (keptRiskFlags.length > 0 || (tripwire !== undefined && tripwire.newFlags.length > 0)) return { target: 'local', reason: 'risk-flag' };
  if (itemOverride !== undefined) {
    return itemOverride === 'local' ? { target: 'local', reason: 'item-override' } : INVALID();
  }
  if (policyDefault === undefined) return { target: 'local', reason: 'default' };
  if (policyDefault === 'local' || policyDefault === 'dev') return { target: policyDefault, reason: 'policy' };
  return INVALID();
}

module.exports = { resolveAcceptanceTarget, TARGETS, REASONS };
