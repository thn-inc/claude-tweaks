// The merge-check verdict backstop (#2429 bundle path, #2941 singleton path): one place that
// owns the decisions.md marker a passing `assess-agent-autonomy merge-check` verdict is logged
// under, and the check every merge site re-runs against decisions.md before merging — so the
// bundle path (dispatch/settle-and-merge.md) and the singleton path
// (wrap-up/auto-merge-short-circuit.md) cannot drift apart on the marker text.
//
// A verdict line is `{step}: #{n} assess-agent-autonomy verdict {verdict}` with {step} one of
// VERDICT_STEPS — exactly what `bin/log-decision.js --step "{step}" --text "{verdictText}"`
// writes. The LATEST verdict line per record wins, so a needs-human logged after an auto-merge
// is never overridden by the earlier pass. Record numbers are matched exactly (`#29` never
// satisfies `#2941`). The post-merge `Fast-lane auto-merge: issue #{n}, ...` line deliberately
// does not match.
'use strict';

const fs = require('fs');

const VERDICT_STEPS = Object.freeze({ gate: 'Auto-merge gate', shortCircuit: 'Auto-merge short-circuit' });
const PASS_VERDICT = 'auto-merge';

const STEP_ALT = Object.values(VERDICT_STEPS).map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
const VERDICT_RE = new RegExp(`(?:${STEP_ALT}): #(\\d+) assess-agent-autonomy verdict ([a-z][a-z-]*[a-z])`, 'g');

function verdictText(n, verdict = PASS_VERDICT) {
  return `#${n} assess-agent-autonomy verdict ${verdict}`;
}

function verdictMarker(step, n, verdict = PASS_VERDICT) {
  return `${step}: ${verdictText(n, verdict)}`;
}

// "latest" means last in file order; callers write verdict lines without --section, so file
// order is write order (log-decision.js's --section can splice a line earlier in the file).
function latestVerdicts(content) {
  const latest = new Map();
  for (const ln of String(content).split(/\r?\n/)) {
    for (const m of ln.matchAll(VERDICT_RE)) latest.set(Number(m[1]), m[2]);
  }
  return latest;
}

function confirmPassingVerdicts(content, members) {
  const latest = latestVerdicts(content);
  const out = {};
  for (const raw of members) {
    const n = Number(raw);
    const v = latest.has(n) ? latest.get(n) : null;
    out[n] = { confirmed: v === PASS_VERDICT, latest: v };
  }
  return out;
}

// Fails closed: an unreadable decisions.md confirms nothing.
function confirmFromFile(file, members) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const out = {};
    for (const raw of members) out[Number(raw)] = { confirmed: false, latest: null, error: err.message };
    return out;
  }
  return confirmPassingVerdicts(content, members);
}

module.exports = { VERDICT_STEPS, PASS_VERDICT, verdictText, verdictMarker, confirmPassingVerdicts, confirmFromFile };
