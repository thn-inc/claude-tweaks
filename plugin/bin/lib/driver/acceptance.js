'use strict';
// The driver's acceptance routing: which acceptance state a finished build gets, decided
// in code from the parent gate's verdict and the oversight floor, never by a worker.
// decideRoute is pure: the caller runs `parent-gate.js --sub-issue N --closing N` and reads
// the record's risk:*/size:* labels, then passes both in.
//
// The closed rule. Exactly these routes; anything else is `route: null` with an `error`:
//   parent-gate state incomplete | gated | resolved        -> try-it-only
//   state due, exceeds === false                           -> try-it-only
//   state due, exceeds === true                            -> due-exceeds (demo:pending on the parent)
//   state no-parent, floor not exceeded                    -> no-parent-exempt
//   state no-parent, floor exceeded (incl. unscored)       -> no-parent-gated (demo:pending on the record)
// A non-zero parent-gate exit, or stdout that did not parse (verdict null), fails open to the
// no-parent rows with `fallback: 'parent-gate failed'` (verification-brief-parent-gate.md,
// "Fail open on every gh call"): never a skip, never `route: null`.

const { exceedsOversightFloor } = require('../issues/oversight-floor');

const DEMO_PENDING = 'demo:pending';
const TRY_IT_STATES = Object.freeze(['incomplete', 'gated', 'resolved']);

function noParentRoute(facets, floors) {
  const { exceeds } = exceedsOversightFloor(facets, floors);
  return exceeds
    ? { route: 'no-parent-gated', labels: [{ on: 'record', label: DEMO_PENDING }] }
    : { route: 'no-parent-exempt', labels: [] };
}

// gate: { code, verdict }; facets: { risk, size }; floors: { riskFloor, sizeFloor }
function decideRoute({ gate, facets, floors }) {
  const code = gate ? gate.code : null;
  const verdict = gate ? gate.verdict : null;
  if (code !== 0 || verdict === null || typeof verdict !== 'object') {
    return { ...noParentRoute(facets, floors), fallback: 'parent-gate failed' };
  }
  const { state, exceeds } = verdict;
  if (TRY_IT_STATES.includes(state)) return { route: 'try-it-only', labels: [] };
  if (state === 'due') {
    if (exceeds === false) return { route: 'try-it-only', labels: [] };
    if (exceeds === true) return { route: 'due-exceeds', labels: [{ on: 'parent', label: DEMO_PENDING }] };
    return { route: null, error: `parent-gate state due with a non-boolean exceeds (${JSON.stringify(exceeds)})` };
  }
  if (state === 'no-parent') return noParentRoute(facets, floors);
  return { route: null, error: `parent-gate state ${JSON.stringify(state)} is not one of the routed states` };
}

module.exports = { decideRoute };
