// bin/lib/express/queue.js — the express lane's (#4025) and the driver's (#6011)
// queue-pull policy: dispatch's queue-pull-script.md keeps express-eligible and
// driver-routable fast-lane records out of bundles (buildDispatchGroups's
// keepSingleton) and stamps the queue-order cache with the matching grouping
// mode, so a blob computed under another mode is never reused.
'use strict';

const { evaluateRecordEligibility } = require('./eligibility');
const { defaultResolvePolicy, sensitivePathsOf } = require('./policy');
const { groupingMode } = require('../dispatch/queue-order');

const DISABLED = Object.freeze({ enabled: false, grouping: groupingMode(false), keepSingleton: () => false });

const FIRST_KEYS = ['express-lane', 'express-driver'];
const SECOND_KEYS = ['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-review'];
const ROUTINGS = ['on', 'off', 'split'];

const collapse = (value) => String(value).replace(/\s+/g, ' ');
const oneLine = (err) => collapse(err && err.message);

// deps: { resolvePolicy?, stderr? } -> { enabled, grouping, keepSingleton }.
// Two resolver calls, project policy only (no run dir exists at queue-pull time).
// The first reads `express-lane` and `express-driver`; the second, made only when
// either half is on, reads the keys the halves need: the lanes are opt-in, and an
// unpinned `integration-model` costs a `gh repo view` probe that a queue pull (up
// to three of these per pull) should not pay for a disabled feature. `enabled` is
// the express half's flag; the driver half is on for `express-driver` `on` or
// `split`, and keeps a record the driver would route (routing, eligibility and
// reviewer rules, the driver modules loaded only then). A failed resolution, or an
// `express-driver` value that is not on/off/split, behaves as disabled for the
// whole pull (fail toward bundling, the pre-#4025 behavior) with one stderr line;
// so does a throwing check, for that one record in that half.
function expressQueuePolicy(deps = {}) {
  const resolvePolicy = deps.resolvePolicy || defaultResolvePolicy;
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  const readFailed = (keys, err) => {
    stderr(`express-lane: policy read failed (${keys.join(', ')}), fast-lane bundling unchanged this pull: ${oneLine(err)}\n`);
    return DISABLED;
  };

  let expressOn;
  let routing;
  try {
    const first = resolvePolicy(FIRST_KEYS, { runDir: null });
    expressOn = first['express-lane'].value === true;
    routing = first['express-driver'].value;
  } catch (err) {
    return readFailed(FIRST_KEYS, err);
  }
  if (!ROUTINGS.includes(routing)) {
    stderr(`express-driver: value not recognised (${collapse(routing)}), fast-lane bundling unchanged this pull\n`);
    return DISABLED;
  }
  const driverOn = routing !== 'off';
  if (!expressOn && !driverOn) return DISABLED;

  let expressOpts;
  let policy;
  try {
    policy = resolvePolicy(SECOND_KEYS, { runDir: null });
    if (expressOn) {
      expressOpts = { enabled: true, integrationModel: policy['integration-model'].value, sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']) };
    }
  } catch (err) {
    return readFailed(SECOND_KEYS, err);
  }
  let driver;
  if (driverOn) {
    try {
      // Lazy: a project using neither lane must not load the driver graph, and budget.js
      // requires dispatch/queue-pull, the module that calls this one.
      const { routingReason, reviewerGateReason } = require('../driver/admission');
      const { preScreen } = require('../driver/budget');
      const { eligibilityOptions } = require('../driver/steps');
      const { reviewRequired } = require('../driver/review');
      const { extractKeyFiles } = require('../issues/grouping');
      driver = {
        routingReason, reviewerGateReason, preScreen, reviewRequired, extractKeyFiles,
        eligibility: eligibilityOptions(policy),
        bounds: { sizeCeiling: policy['express-driver-max-size'].value, maxKeyFiles: policy['express-driver-max-key-files'].value },
        reviewPolicy: policy['express-driver-review'].value,
      };
    } catch (err) {
      stderr(`express-driver: driver modules failed to load, fast-lane bundling unchanged this pull: ${oneLine(err)}\n`);
      return DISABLED;
    }
  }

  // The driver's own rules; any failure answers false.
  const driverRoutable = (issue) => {
    if (driver.routingReason(routing, issue.number) !== null) return false;
    if (driver.preScreen(issue, driver.eligibility, { evaluateRecordEligibility }).verdict !== 'pass') return false;
    const keyFiles = driver.extractKeyFiles(issue);
    if (!Array.isArray(keyFiles)) return false;
    const reviewerOn = driver.reviewRequired({ issue, keyFiles, policyValue: driver.reviewPolicy }).on;
    return driver.reviewerGateReason({ labels: issue.labels, keyFiles, bounds: driver.bounds, reviewerOn }) === null;
  };

  return {
    enabled: expressOn,
    grouping: groupingMode(expressOn, driverOn),
    keepSingleton: (issue) => {
      if (expressOn) {
        try {
          if (evaluateRecordEligibility(issue, expressOpts).eligible) return true;
        } catch (err) {
          stderr(`express-lane: eligibility check failed for #${issue && issue.number}, fast-lane bundling unchanged for it: ${oneLine(err)}\n`);
        }
      }
      if (driverOn) {
        try {
          return driverRoutable(issue);
        } catch (err) {
          stderr(`express-driver: queue eligibility check failed for #${issue && issue.number}, fast-lane bundling unchanged for it: ${oneLine(err)}\n`);
        }
      }
      return false;
    },
  };
}

module.exports = { expressQueuePolicy };
