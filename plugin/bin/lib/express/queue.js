// bin/lib/express/queue.js — the express lane's (#4025) and the driver's (#6011)
// queue-pull policy: dispatch's queue-pull-script.md keeps express-eligible and
// driver-routable fast-lane records out of bundles (buildDispatchGroups's
// keepSingleton) and stamps the queue-order cache with the matching grouping
// mode, so a blob computed under another mode is never reused. expressQueuePolicy
// also returns the settings `fingerprint` (groupingFingerprint over GROUPING_INPUTS)
// that keys the queue-order cache beside the stamp (#6062).
'use strict';

const { evaluateRecordEligibility, widenedByFor } = require('./eligibility');
const { defaultResolvePolicy, sensitivePathsOf, protectedPathGlobsOf } = require('./policy');
const { groupingMode } = require('../dispatch/queue-order');
const crypto = require('node:crypto');

const FIRST_KEYS = ['express-lane', 'express-driver', 'dispatch-fastlane-bundle-cap', 'work-links'];
const SECOND_KEYS = ['integration-model', 'merge-sensitive-paths', 'express-driver-max-size', 'express-driver-max-key-files', 'express-driver-max-risk', 'express-driver-protected-paths', 'express-driver-review', 'protected-paths'];
const ROUTINGS = ['on', 'off', 'split'];
const UNREADABLE = '<unreadable>';

// The one list of policy keys that decide how the queue is grouped: every key this
// module requests. The queue-order cache's settings fingerprint hashes exactly these.
const GROUPING_INPUTS = Object.freeze([...FIRST_KEYS, ...SECOND_KEYS]);

// values: { [key]: raw resolved value } -> 16 hex chars. Only own keys of GROUPING_INPUTS count,
// in list order; the sensitive-path list is normalized, sorted and deduped so a reordered
// or comma-string spelling of the same set hashes alike; undefined hashes as null.
function groupingFingerprint(values) {
  const pairs = GROUPING_INPUTS.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).map((key) => {
    let value = values[key];
    if (key === 'merge-sensitive-paths') {
      // An unreadable list must not throw out of the policy read; it hashes as a sentinel no real list equals.
      try { value = [...new Set(sensitivePathsOf({ value }))].sort(); } catch { value = UNREADABLE; }
    }
    return [key, value === undefined ? null : value];
  });
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex').slice(0, 16);
}

// The disabled shape (fail toward bundling), carrying the fingerprint of whatever was read.
const disabled = (fingerprint) => Object.freeze({ enabled: false, grouping: groupingMode(false), fingerprint, keepSingleton: () => false });
const DISABLED = disabled(groupingFingerprint({}));

const collapse = (value) => String(value).replace(/\s+/g, ' ');
const oneLine = (err) => collapse(err && err.message);

// The raw resolved value of each requested key, so a key added to FIRST_KEYS or SECOND_KEYS
// reaches the fingerprint with no further edit.
// With `failed` given (the second call) a throwing read records its error there (the caller rethrows it where
// the old code did) and hashes as a sentinel, and a missing entry reads as undefined; without it, either throws.
const valuesOf = (keys, result, failed) => Object.fromEntries(keys.map((k) => {
  try { return [k, failed ? (result[k] && result[k].value) : result[k].value]; } catch (err) {
    if (!failed) throw err;
    failed[k] = err;
    return [k, UNREADABLE];
  }
}));

// deps: { resolvePolicy?, stderr? } -> { enabled, grouping, fingerprint, keepSingleton }.
// `fingerprint` is groupingFingerprint over every value the resolver calls returned, the
// queue-order cache's key beside the `grouping` stamp (#6062): a policy change that leaves
// the queue unchanged must not replay a stale order. Only a throwing resolver call carries
// groupingFingerprint({}); every path past a successful first call (an unrecognised
// `express-driver`, lanes off, driver modules failing to load) carries the fingerprint of the
// values read, since queue-pull still uses `work-links` and the bundle cap in those states.
// Two resolver calls, project policy only (no run dir exists at queue-pull time).
// The first reads `express-lane`, `express-driver`, `dispatch-fastlane-bundle-cap` and `work-links`; the second, made only when
// either half is on, reads the keys the halves need: the driver lane is opt-in, the express lane is on unless a project sets it `false`, and an
// unpinned `integration-model` costs a `gh repo view` probe that a queue pull (up
// to three of these per pull) should not pay for a disabled feature. `enabled` is
// the express half's flag; the driver half is on for `express-driver` `on` or
// `split`, and keeps a record the driver would route (routing, eligibility and
// reviewer rules, a risk-, ceremony- or protected-path-widened record needing the reviewer on, the
// driver modules loaded only then). A failed resolution, or an
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
  let read;
  try {
    const first = resolvePolicy(FIRST_KEYS, { runDir: null });
    read = valuesOf(FIRST_KEYS, first);
    expressOn = read['express-lane'] === true;
    routing = read['express-driver'];
  } catch (err) {
    return readFailed(FIRST_KEYS, err);
  }
  if (!ROUTINGS.includes(routing)) {
    stderr(`express-driver: value not recognised (${collapse(routing)}), fast-lane bundling unchanged this pull\n`);
    return disabled(groupingFingerprint(read));
  }
  const driverOn = routing !== 'off';
  if (!expressOn && !driverOn) return disabled(groupingFingerprint(read));

  let expressOpts;
  let policy;
  const failed = {};
  // A second-call value read once up front; a throwing or missing entry fails here as a direct read would.
  const need = (key) => {
    if (key in failed) throw failed[key];
    if (!policy[key]) throw new TypeError(`policy entry ${key} missing`);
    return read[key];
  };
  try {
    policy = resolvePolicy(SECOND_KEYS, { runDir: null });
    Object.assign(read, valuesOf(SECOND_KEYS, policy, failed));
    if (expressOn) {
      if ('merge-sensitive-paths' in failed) throw failed['merge-sensitive-paths'];
      expressOpts = { enabled: true, integrationModel: need('integration-model'), sensitivePaths: sensitivePathsOf({ value: read['merge-sensitive-paths'] }), protectedPathGlobs: protectedPathGlobsOf(policy['protected-paths']) };
    }
  } catch (err) {
    return readFailed(SECOND_KEYS, err);
  }
  let driver;
  if (driverOn) {
    try {
      // Lazy: a project using neither lane must not load the driver graph, and budget.js
      // requires dispatch/queue-pull, the module that calls this one.
      const { routingReason, reviewerGateReason, widenedReviewerReason } = require('../driver/admission');
      const { preScreen } = require('../driver/budget');
      const { eligibilityOptions } = require('../driver/steps');
      const { reviewRequired } = require('../driver/review');
      const { extractKeyFiles } = require('../issues/grouping');
      driver = {
        routingReason, reviewerGateReason, widenedReviewerReason, preScreen, reviewRequired, extractKeyFiles,
        eligibility: eligibilityOptions(policy),
        bounds: { sizeCeiling: need('express-driver-max-size'), maxKeyFiles: need('express-driver-max-key-files') },
        reviewPolicy: need('express-driver-review'),
      };
    } catch (err) {
      stderr(`express-driver: driver modules failed to load, fast-lane bundling unchanged this pull: ${oneLine(err)}\n`);
      return disabled(groupingFingerprint(read));
    }
  }

  // The driver's own rules; any failure answers false.
  const driverRoutable = (issue) => {
    if (driver.routingReason(routing, issue.number) !== null) return false;
    if (driver.preScreen(issue, driver.eligibility, { evaluateRecordEligibility }).verdict !== 'pass') return false;
    const keyFiles = driver.extractKeyFiles(issue);
    if (!Array.isArray(keyFiles)) return false;
    const widenedBy = widenedByFor(issue.labels, keyFiles, driver.eligibility);
    const reviewerOn = driver.reviewRequired({ issue, keyFiles, policyValue: driver.reviewPolicy, widenedBy }).on;
    return driver.reviewerGateReason({ labels: issue.labels, keyFiles, bounds: driver.bounds, reviewerOn }) === null
      && driver.widenedReviewerReason({ widenedBy, reviewerOn }) === null;
  };

  return {
    enabled: expressOn,
    grouping: groupingMode(expressOn, driverOn),
    fingerprint: groupingFingerprint(read),
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

module.exports = { expressQueuePolicy, GROUPING_INPUTS, groupingFingerprint };
