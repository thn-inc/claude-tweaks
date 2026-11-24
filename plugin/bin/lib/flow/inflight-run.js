// The shared in-flight predicate (#6143): a pipeline run is in flight while its
// run-state.json is non-terminal (status !== 'clean') and its build or test phase
// has not finished. A PR phases-checklist row that is checked, or absent (no span,
// or a removed row), counts as finished; only a present unchecked row sends the
// check to the run's decisions.md set, where a phase-exit record
// (lib/phase-exit/exit-record.js) of that phase or a later one decides. A run
// whose set holds no phase-exit record at all may have started on a release
// that wrote none: an entry under /review or /wrap-up then shows it got past
// test. (A run that has not exited build yet holds none either, so the absence
// alone proves nothing.) A multi-spec run (one with a
// manifest.yml) is judged per spec instead: its checklist rows and its
// decisions.md set are run-wide, so one spec's exit would read as every spec's
// (flow/multispec-pr-checklist.md: a checked row means "at least one spec").
// Consumed by the PreToolUse merge gate (fails open) and reconcile (fails
// closed) -- so a readDecisions or readSpecs throw propagates.
'use strict';

const { uncheckedBuildOrTest } = require('./pr-checklist');
const {
  PHASES, phaseExitReached, anyPhaseExitRecorded, postTestSectionRecorded,
} = require('../phase-exit/exit-record');

// manifest.yml statuses after which a spec does no more work in this run.
const SPEC_SETTLED = new Set(['complete', 'failed', 'not-run']);

// The first spec, in manifest order, still owing build or test -> that phase, else null. A `pending`
// spec has not started (build). Any other unsettled status is judged from the spec's own decisions.md:
// a phase is finished when it or a later phase recorded its exit, or when the spec's manifest `phase`
// (spec-status names each phase as it starts) is past it.
function specInFlightPhase(specs) {
  for (const spec of specs) {
    if (SPEC_SETTLED.has(spec.status)) continue;
    if (spec.status === 'pending') return 'build';
    for (const phase of ['build', 'test']) {
      if (PHASES.indexOf(spec.phase) > PHASES.indexOf(phase)) continue;
      if (!phaseExitReached(spec.decisions, phase)) return phase;
    }
  }
  return null;
}

// { runState, body, readDecisions: () => string[], readSpecs?: () => specs[] | null } -> 'build' | 'test' | null.
// readSpecs is exit-record.js's readRunSpecs shape: null for a single-spec run.
function inFlightPhase({ runState, body, readDecisions, readSpecs }) {
  if (!runState || typeof runState !== 'object' || runState.status === 'clean') return null;
  const specs = typeof readSpecs === 'function' ? readSpecs() : null;
  if (specs) return specInFlightPhase(specs);
  const unchecked = uncheckedBuildOrTest(body);
  if (!unchecked.length) return null;
  const texts = readDecisions();
  if (!texts.some(anyPhaseExitRecorded) && texts.some(postTestSectionRecorded)) return null;
  for (const phase of unchecked) {
    if (!texts.some((text) => phaseExitReached(text, phase))) return phase;
  }
  return null;
}

module.exports = { inFlightPhase };
