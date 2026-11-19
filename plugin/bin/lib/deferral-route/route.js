'use strict';
// bin/lib/deferral-route/route.js — where a legitimately-deferred item goes (#5930).
// Pure: no fs, no process. This function is the authority;
// skills/_shared/materiality-floor.md is its explanation, and
// tests/bin-lib/deferral-route/route.test.js pins that prose byte-equal.
//
// routeDeferral({ deferReason, severity, size, priority, risk, agentRaised })
//   -> { verdict, rule, reason? }   (reason only when verdict is 'refused')
//
// Rules, in order — the first match decides:
//   refused    — deferReason missing or not in DEFER_REASONS; agentRaised not a
//                boolean; severity present but not in SEVERITIES (checked in
//                that order, the first failing check names the reason)
//   human      — agentRaised === false                     -> file
//   severity   — severity 'high' or 'critical'             -> file
//   tangential — deferReason 'tangential'                  -> file
//   not-low    — any of size, priority, risk !== 'low'     -> file
//   floor      — otherwise                                 -> digest
// Only the exact string 'low' is low; an absent severity counts as not high.

const { DEFER_REASONS } = require('../issues/record');
const { SEVERITIES } = require('../tiebreak');

const VERDICTS = Object.freeze(['file', 'digest', 'refused']);
const RULES = Object.freeze(['refused', 'human', 'severity', 'tangential', 'not-low', 'floor']);

function refused(reason) {
  return { verdict: 'refused', rule: 'refused', reason };
}

function routeDeferral({ deferReason, severity, size, priority, risk, agentRaised }) {
  if (deferReason === undefined || deferReason === null) {
    return refused(`--defer-reason is required; one of: ${DEFER_REASONS.join(', ')}`);
  }
  if (!DEFER_REASONS.includes(deferReason)) {
    return refused(`--defer-reason "${deferReason}" is not one of: ${DEFER_REASONS.join(', ')}`);
  }
  if (typeof agentRaised !== 'boolean') {
    return refused('exactly one of --agent-raised or --human is required');
  }
  if (severity !== undefined && severity !== null && !SEVERITIES.includes(severity)) {
    return refused(`--severity "${severity}" is not one of: ${SEVERITIES.join(', ')}`);
  }
  if (agentRaised === false) return { verdict: 'file', rule: 'human' };
  if (severity === 'high' || severity === 'critical') return { verdict: 'file', rule: 'severity' };
  if (deferReason === 'tangential') return { verdict: 'file', rule: 'tangential' };
  if (size !== 'low' || priority !== 'low' || risk !== 'low') return { verdict: 'file', rule: 'not-low' };
  return { verdict: 'digest', rule: 'floor' };
}

module.exports = { routeDeferral, VERDICTS, RULES };
