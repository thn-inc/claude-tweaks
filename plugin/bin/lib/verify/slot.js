// plugin/bin/lib/verify/slot.js — pure helpers for verify.js's machine-wide
// suite slot (#5119): how many slots a project's runs may hold at once, which
// lane a run queues in, and how many test workers one slot may use. The lock
// itself lives in plugin/bin/lib/suite-slot.js.
'use strict';

// A declared concurrency.suiteSlots wins, then --default-suite-slots, then one
// slot. `declared` and `flag` are positive integers or null (validated by
// declaration.js and args.js).
function resolveSuiteSlots({ declared, flag }) {
  if (declared !== null && declared !== undefined) return { slots: declared, source: 'declaration' };
  if (flag !== null && flag !== undefined) return { slots: flag, source: 'flag' };
  return { slots: 1, source: 'default' };
}

// The lane follows the commands that run, not the selection mode: no local
// check means nothing to queue for (null); a run whose local checks include a
// full-suite command takes the 'full' lane; any other run queues as 'subset'.
// The caller computes fullSuiteRuns.
function chooseLane({ localCheckCount, fullSuiteRuns }) {
  if (localCheckCount === 0) return null;
  return fullSuiteRuns ? 'full' : 'subset';
}

// Test-worker cap per slot: half the cores split across the slots, at least 1.
function workerCap(cores, slots) {
  return Math.max(1, Math.floor(cores / (2 * slots)));
}

module.exports = { resolveSuiteSlots, chooseLane, workerCap };
