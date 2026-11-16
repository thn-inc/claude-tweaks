// bin/lib/accept/target.js
// Pure: where a human's acceptance check runs (#4615) — `local` (the worktree) or `dev`
// (a deployed dev environment). Precedence: a kept risk flag forces local; then a
// per-item override (only `local` is honoured); then the policy default; then local.
// `dev` is reachable only through an affirmative, valid `policyDefault: 'dev'` with no
// kept flag and no item override — every unreadable or invalid input fails closed to
// `local` with reason `invalid-input`. No I/O.
'use strict';

const TARGETS = ['local', 'dev'];
const REASONS = ['risk-flag', 'item-override', 'policy', 'default', 'invalid-input'];

const INVALID = () => ({ target: 'local', reason: 'invalid-input' });

function resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault } = {}) {
  if (!Array.isArray(keptRiskFlags) || keptRiskFlags.some((f) => typeof f !== 'string')) return INVALID();
  if (keptRiskFlags.length > 0) return { target: 'local', reason: 'risk-flag' };
  if (itemOverride !== undefined) {
    return itemOverride === 'local' ? { target: 'local', reason: 'item-override' } : INVALID();
  }
  if (policyDefault === undefined) return { target: 'local', reason: 'default' };
  if (policyDefault === 'local' || policyDefault === 'dev') return { target: policyDefault, reason: 'policy' };
  return INVALID();
}

module.exports = { resolveAcceptanceTarget, TARGETS, REASONS };
