'use strict';
// The driver lane's record bounds and the options the eligibility step hands
// evaluateRecordEligibility (#5224), as a leaf module: steps.js re-exports eligibilityOptions,
// and plan-lane.js reads both from here without loading the driver's step graph (#6053).

const { sensitivePathsOf } = require('../express/policy');

// The driver lane's record bounds (#5224), as eligibility and admission both get them.
function laneBounds(policy) {
  return { sizeCeiling: policy['express-driver-max-size'].value, maxKeyFiles: policy['express-driver-max-key-files'].value };
}

// The options the eligibility step hands deps.evaluateRecordEligibility, lane bounds included, so a
// caller that pre-screens a record (the budget loop) asks the same question the step does.
function eligibilityOptions(policy) {
  const bounds = laneBounds(policy);
  return {
    enabled: true,
    allowAbsentCeremony: true,
    integrationModel: policy['integration-model'].value,
    sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']),
    sizeCeiling: bounds.sizeCeiling,
    maxKeyFiles: bounds.maxKeyFiles,
    riskCeiling: policy['express-driver-max-risk'].value,
    // Ceremony widening is allowed only with the reviewer forced on (#6018's Decision Rationale: the
    // default beyond-express must reproduce today, and a ceremony-widened record needs the reviewer).
    allowAnyCeremony: policy['express-driver-review'].value === 'on',
  };
}

module.exports = { laneBounds, eligibilityOptions };
