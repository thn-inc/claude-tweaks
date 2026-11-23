'use strict';
// The plan-lane predicate (#6053): from a record's lane bounds alone, whether a lane that composes
// no plan will take it — the pipeline driver, the express lane (`_shared/express-lane.md`: "the
// lane composes no plan") or /build's micro-plan path — so /specify can skip writing a plan.
// No I/O: the caller passes the labels, the body, `extractKeyFileEntries(body)` and the resolved
// policy entries for POLICY_KEYS.
//
// Advisory. The verdict means eligible by bounds, not admitted: a record a lane later refuses is
// built by /build, which composes its own micro-plan or full plan. So the facts specify cannot
// know yet are neutralised rather than read:
//   grants (`auto:*`)            granted after shaping; admission is given buildAuthority 'typed'
//                                and the express lane never sees `auto:merge-pending`
//   state (`bot:*`, `parked`)    claim, block and park state changes after shaping
//   blockers, open linked PRs    passed as none: they settle on their own, not by the plan
//   driver escalation            passed as not escalated: it happens during a run
//   `express-driver: split`      read as `on`: issue-number parity is a routing experiment,
//                                not a bound; `off` means the driver lane never matches
//
// The driver bounds are read through the helpers the driver's own eligibility and admission steps
// use (lane-bounds.js's eligibilityOptions and laneBounds, evaluateRecordEligibility, widenings,
// reviewRequired, evaluateAdmission), never re-derived, so a change to admission's bounds is followed
// here; the express bounds likewise through the express gate's expressGateOptions.
// reviewRequired and admission get the eligibility verdict's own Key File paths and the record's
// widenings (#6018: above low risk under `express-driver-max-risk`, or a non-fast-lane ceremony when
// `express-driver-review` is `on`, or a merge-time protected Key File under
// `express-driver-protected-paths: reviewer`, #6019), as steps.js's eligibility step does. Every
// input those helpers read is a label, the body or a policy value, so shaping time reads
// the answer the driver will.
// lane-bounds.js is a leaf module, so this file never loads steps.js.
//
// Precedence: driver, then express, then micro-plan. Fail closed: every input is validated before
// any lane is tried, so a missing, unreadable or malformed input returns lane null with its own
// reason and never falls through to a later lane. A policy entry resolve-policy marks `invalid`
// (a malformed policy.yml value resolved to the schema default) or that carries an `error` field
// is unreadable even though the driver would run on the default (spec Plan Review Clarification 1).

const { normalizeLabelNames, parseRecordFacets, LABELS } = require('../issues/record');
const { parseRiskFlags } = require('../issues/record-risk-flags');
const { evaluateMicroPlanGate } = require('../issues/micro-plan-gate');
const {
  evaluateRecordEligibility, isReadableSizeCeiling, isReadableKeyFileLimit, isReadableRiskCeiling, widenedByFor,
} = require('../express/eligibility');
const { expressGateOptions } = require('../express/policy');
const { evaluateAdmission } = require('./admission');
const { reviewRequired } = require('./review');
const { laneBounds, eligibilityOptions } = require('./lane-bounds');

const POLICY_KEYS = Object.freeze([
  'express-driver', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-risk', 'express-driver-review',
  'express-driver-protected-paths', 'express-lane', 'integration-model', 'merge-sensitive-paths',
  'protected-paths',
]);

const PLAN_LANE_REASONS = Object.freeze({
  driver: 'inside-driver-bounds',
  express: 'inside-express-bounds',
  microPlan: 'passes-micro-plan-gate',
  outside: 'outside-every-lane',
  labelsUnreadable: 'labels-unreadable',
  bodyUnreadable: 'body-unreadable',
  keyFilesMissing: 'key-files-missing',
  keyFilesUnreadable: 'key-files-unreadable',
  policyUnreadable: 'policy-unreadable',
  riskFlagsUnreadable: 'risk-flags-unreadable',
});

const R = PLAN_LANE_REASONS;
const DRIVER_ROUTINGS = ['off', 'split', 'on'];
const REVIEW_VALUES = ['off', 'on', 'beyond-express'];
const PROTECTED_PATHS_VALUES = ['refuse', 'reviewer'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// sensitivePathsOf reads any other value as no sensitive paths, so it is refused here first.
const isReadableSensitivePaths = (v) => typeof v === 'string' || (Array.isArray(v) && v.every((p) => typeof p === 'string'));
// extractKeyFileEntries's element shape; anything else cannot be counted.
const isKeyFileEntry = (e) => isObject(e) && typeof e.path === 'string';

function policyReadable(policy) {
  if (!isObject(policy)) return false;
  const entriesReadable = POLICY_KEYS.every((key) => {
    const entry = policy[key];
    // protected-paths alone tolerates `invalid: true` and an unusable value: protectedPathGlobsOf applies the
    // shipped list to them, as the gates do (#6020 AC5). A missing entry, a non-object or an `error` stays unreadable.
    return isObject(entry) && Object.prototype.hasOwnProperty.call(entry, 'value')
      && (key === 'protected-paths' || entry.invalid !== true) &&!Object.prototype.hasOwnProperty.call(entry, 'error');
  });
  if (!entriesReadable) return false;
  const value = (key) => policy[key].value;
  return DRIVER_ROUTINGS.includes(value('express-driver'))
    && REVIEW_VALUES.includes(value('express-driver-review'))
    && PROTECTED_PATHS_VALUES.includes(value('express-driver-protected-paths'))
    && isReadableSizeCeiling(value('express-driver-max-size'))
    && isReadableKeyFileLimit(value('express-driver-max-key-files'))
    && isReadableRiskCeiling(value('express-driver-max-risk'))
    && typeof value('express-lane') === 'boolean'
    && typeof value('integration-model') === 'string' && value('integration-model') !== ''
    && isReadableSensitivePaths(value('merge-sensitive-paths'));
}

// -> null when every input reads, else the reason it does not.
function unreadableReason({ labels, keyFiles, body, policy }) {
  if (!Array.isArray(labels)) return R.labelsUnreadable;
  if (typeof body !== 'string') return R.bodyUnreadable;
  if (keyFiles === null) return R.keyFilesMissing;
  if (!isObject(keyFiles) || !Array.isArray(keyFiles.entries) || !keyFiles.entries.every(isKeyFileEntry)
    || !Number.isSafeInteger(keyFiles.unparsed) || keyFiles.unparsed !== 0) {
    return R.keyFilesUnreadable;
  }
  if (!policyReadable(policy)) return R.policyUnreadable;
  if (parseRiskFlags(body).status === 'unknown') return R.riskFlagsUnreadable;
  return null;
}

function insideDriverBounds(issue, policy) {
  const opts = eligibilityOptions(policy);
  const eligibility = evaluateRecordEligibility(issue, { ...opts, escalated: false });
  if (!eligibility.eligible) return false;
  const widenedBy = widenedByFor(issue.labels, eligibility.keyFiles, opts);
  const reviewer = reviewRequired({ issue, keyFiles: eligibility.keyFiles, policyValue: policy['express-driver-review'].value, widenedBy });
  return evaluateAdmission({
    state: 'OPEN',
    labels: issue.labels,
    openBlockerRefs: [],
    openLinkedPRs: [],
    // `off` never reaches here, and `split` reads as `on`.
    routing: 'on',
    driverEscalated: false,
    keyFiles: eligibility.keyFiles,
    bounds: laneBounds(policy),
    reviewerOn: reviewer.on,
    widenedBy,
    buildAuthority: 'typed',
  }).admitted;
}

// The express gate's own options (express/policy.js's expressGateOptions, as runGate reads them);
// needsNoPlan calls this only when express-lane is true, so `enabled` is true here.
function insideExpressBounds(issue, policy) {
  return evaluateRecordEligibility(issue, { ...expressGateOptions(policy), escalated: false }).eligible;
}

// { labels, keyFiles, body, policy } -> { lane: 'driver'|'express'|'micro-plan'|null, reason }.
function needsNoPlan(facts) {
  const { labels, keyFiles, body, policy } = isObject(facts) ? facts : {};
  const unreadable = unreadableReason({ labels, keyFiles, body, policy });
  if (unreadable) return { lane: null, reason: unreadable };

  const neutral = normalizeLabelNames(labels).filter((n) => !/^(auto|bot):/.test(n) && n !== LABELS.PARKED);
  const issue = { body, labels: neutral };

  if (policy['express-driver'].value !== 'off' && insideDriverBounds(issue, policy)) return { lane: 'driver', reason: R.driver };
  if (policy['express-lane'].value === true && insideExpressBounds(issue, policy)) return { lane: 'express', reason: R.express };
  const facets = parseRecordFacets(labels);
  if (evaluateMicroPlanGate({ ceremony: facets.ceremony, size: facets.size, keyFileEntries: keyFiles, body }).passes) {
    return { lane: 'micro-plan', reason: R.microPlan };
  }
  return { lane: null, reason: R.outside };
}

module.exports = { POLICY_KEYS, PLAN_LANE_REASONS, needsNoPlan };
