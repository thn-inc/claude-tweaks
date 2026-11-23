// The shared in-flight predicate (#6143): a pipeline run is in flight while its
// run-state.json is non-terminal (status !== 'clean') and its build or test phase
// has not finished. A PR phases-checklist row that is checked, or absent (no span,
// or a removed row), counts as finished; only a present unchecked row sends the
// check to the run's decisions.md set, where a phase-exit record
// (lib/phase-exit/exit-record.js) decides. Consumed by the PreToolUse merge gate
// (fails open) and reconcile (fails closed) -- so a readDecisions throw propagates.
'use strict';

const { uncheckedBuildOrTest } = require('./pr-checklist');
const { phaseExitRecorded } = require('../phase-exit/exit-record');

// { runState, body, readDecisions: () => string[] } -> 'build' | 'test' | null.
function inFlightPhase({ runState, body, readDecisions }) {
  if (!runState || typeof runState !== 'object' || runState.status === 'clean') return null;
  const unchecked = uncheckedBuildOrTest(body);
  if (!unchecked.length) return null;
  const texts = readDecisions();
  for (const phase of unchecked) {
    if (!texts.some((text) => phaseExitRecorded(text, phase))) return phase;
  }
  return null;
}

module.exports = { inFlightPhase };
