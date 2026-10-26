// bin/lib/express/queue.js — the express lane's (#4025) queue-pull policy:
// dispatch's queue-pull-script.md keeps express-eligible fast-lane records out
// of bundles (buildDispatchGroups's keepSingleton) and stamps the queue-order
// cache with the matching grouping mode, so a blob computed under the other
// mode is never reused.
'use strict';

const { evaluateRecordEligibility } = require('./eligibility');
const { defaultResolvePolicy, sensitivePathsOf } = require('./policy');
const { groupingMode } = require('../dispatch/queue-order');

const DISABLED = Object.freeze({ enabled: false, grouping: groupingMode(false), keepSingleton: () => false });

// deps: { resolvePolicy?, stderr? } -> { enabled, grouping, keepSingleton }.
// Reads `express-lane` first and the other two keys only when it is on: the lane is
// opt-in, and an unpinned `integration-model` costs a `gh repo view` probe that a
// queue pull (up to three of these per pull) should not pay for a disabled feature.
// No run dir exists at queue-pull time, so the resolution is project policy only.
// A failed resolution behaves as disabled (fail toward bundling, the pre-#4025
// behavior) with one stderr line; so does a throwing eligibility check, for that
// one record.
function expressQueuePolicy(deps = {}) {
  const resolvePolicy = deps.resolvePolicy || defaultResolvePolicy;
  const stderr = deps.stderr || ((s) => process.stderr.write(s));
  let opts;
  try {
    if (resolvePolicy(['express-lane'], { runDir: null })['express-lane'].value !== true) return DISABLED;
    const policy = resolvePolicy(['integration-model', 'merge-sensitive-paths'], { runDir: null });
    opts = { enabled: true, integrationModel: policy['integration-model'].value, sensitivePaths: sensitivePathsOf(policy['merge-sensitive-paths']) };
  } catch (err) {
    stderr(`express-lane: policy read failed, fast-lane bundling unchanged this pull: ${String(err && err.message).replace(/\s+/g, ' ')}\n`);
    return DISABLED;
  }
  return {
    enabled: true,
    grouping: groupingMode(true),
    keepSingleton: (issue) => {
      try {
        return evaluateRecordEligibility(issue, opts).eligible;
      } catch (err) {
        stderr(`express-lane: eligibility check failed for #${issue && issue.number}, fast-lane bundling unchanged for it: ${String(err && err.message).replace(/\s+/g, ' ')}\n`);
        return false;
      }
    },
  };
}

module.exports = { expressQueuePolicy };
