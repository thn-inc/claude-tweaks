'use strict';
// bin/lib/deferral-route/route.js — where a legitimately-deferred item goes (#5930).
// Pure: no fs, no process. This function is the authority;
// skills/_shared/materiality-floor.md is its explanation, and
// tests/bin-lib/deferral-route/route.test.js pins that prose byte-equal.
//
// routeDeferral({ deferReason, severity, size, priority, risk, agentRaised, digestReasons,
//                 evidenceRequired, evidenceValid, cap, filedCount })
//   -> { verdict, rule, reason? }   (reason only when verdict is 'refused')
// digestReasons is optional (#5932): the resolved policy key deferral-digest-reasons,
// an array of Defer-reason values; anything that is not an array counts as [].
// The four friction inputs are optional (#5933): evidenceRequired and evidenceValid
// count only when === true; cap only when a non-negative integer (the resolved
// run-filed-record-cap; null or unset is no cap); a non-integer filedCount is 0.
//
// Rules, in order — the first match decides (tangential and not-low are then subject to the two frictions below):
//   refused    — deferReason missing or not in DEFER_REASONS; agentRaised not a
//                boolean; severity present but not in SEVERITIES (checked in
//                that order, the first failing check names the reason)
//   human      — agentRaised === false                     -> file
//   severity   — severity 'high' or 'critical'             -> file
//   policy-reason — deferReason in digestReasons (policy key deferral-digest-reasons)
//                -> digest; explained in materiality-floor.md's Overrides section
//   tangential — deferReason 'tangential'                  -> file
//   not-low    — any of size, priority, risk !== 'low'     -> file
//   floor      — otherwise                                 -> digest
// The tangential and not-low outcomes are not final yet: before either returns 'file',
// two frictions (#5933) can turn it into a digest, checked in this order. They never run
// for refused, human, severity, policy-reason or floor, which have already returned:
//   no-evidence — evidenceRequired, deferReason in EVIDENCE_REASONS, evidenceValid !== true -> digest
//   run-cap    — cap set and filedCount >= cap             -> digest
// Otherwise the item files on the tangential or not-low rule. The caller counts (bin/deferral-route.js's
// run tally), so high/critical severity files are counted though never capped.
// Only the exact string 'low' is low; an absent severity counts as not high.

const { DEFER_REASONS } = require('../issues/record');
const { SEVERITIES } = require('../tiebreak');

const VERDICTS = Object.freeze(['file', 'digest', 'refused']);
const RULES = Object.freeze(['refused', 'human', 'severity', 'policy-reason', 'tangential', 'not-low', 'floor', 'no-evidence', 'run-cap']);
// Every DEFER_REASONS member sits in exactly one of these two lists (#5933).
const EVIDENCE_REASONS = Object.freeze(['pre-existing-outside-diff', 'genuinely-larger', 'tangential']);
const EVIDENCE_EXEMPT_REASONS = Object.freeze(['needs-human-decision', 'blocked-external', 'blocked-dependency', 'needs-verification']);

function refused(reason) {
  return { verdict: 'refused', rule: 'refused', reason };
}

function routeDeferral({
  deferReason, severity, size, priority, risk, agentRaised, digestReasons,
  evidenceRequired, evidenceValid, cap, filedCount,
} = {}) {
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
  if (Array.isArray(digestReasons) && digestReasons.includes(deferReason)) return { verdict: 'digest', rule: 'policy-reason' };
  let rule;
  if (deferReason === 'tangential') rule = 'tangential';
  else if (size !== 'low' || priority !== 'low' || risk !== 'low') rule = 'not-low';
  else return { verdict: 'digest', rule: 'floor' };
  if (evidenceRequired === true && EVIDENCE_REASONS.includes(deferReason) && evidenceValid !== true) {
    return { verdict: 'digest', rule: 'no-evidence' };
  }
  const count = Number.isInteger(filedCount) ? filedCount : 0;
  if (Number.isInteger(cap) && cap >= 0 && count >= cap) return { verdict: 'digest', rule: 'run-cap' };
  return { verdict: 'file', rule };
}

module.exports = { routeDeferral, VERDICTS, RULES, EVIDENCE_REASONS, EVIDENCE_EXEMPT_REASONS };
