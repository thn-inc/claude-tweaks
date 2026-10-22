// The merge-check verdict backstop (#2429 bundle path, #2941 singleton path): one place that
// owns the decisions.md marker a passing `assess-agent-autonomy merge-check` verdict is logged
// under, and the check every merge site re-runs against decisions.md before merging — so the
// bundle path (dispatch/settle-and-merge.md) and the singleton path
// (wrap-up/auto-merge-short-circuit.md) cannot drift apart on the marker text.
//
// A verdict line is `{step}: #{n} assess-agent-autonomy verdict {verdict}` with {step} one of
// VERDICT_STEPS — exactly what `bin/log-decision.js --step "{step}" --text "{verdictText}"`
// writes. A line only counts when it parses as a real log-decision entry (`log-decision/
// append.js`'s `parseEntry`, the writer's own anchored inverse) whose `location` is exactly one
// of VERDICT_STEPS (or ends with ` — {step}` under `--spec`) AND whose `action` STARTS WITH the
// verdict text — anchored at the start, never a bare substring match anywhere in the line, so a
// narrative line elsewhere that merely quotes a verdict marker (a /review or /reflect write-up,
// say) can never be mistaken for a logged verdict (#2941). A passing verdict is additionally
// anchored at the end against the writer's whole emitted action, so a tail-carrying or truncated
// pass line reads as `unparsed`, never as a pass. The LATEST verdict line per record
// wins, so a needs-human logged after an auto-merge is never overridden by the earlier pass.
// Record numbers are matched exactly (`#29` never satisfies `#2941`). The post-merge `Fast-lane
// auto-merge: issue #{n}, ...` line deliberately does not match.
'use strict';

const fs = require('fs');
const { parseEntry } = require('../log-decision/append');

const VERDICT_STEPS = Object.freeze({ gate: 'Auto-merge gate', shortCircuit: 'Auto-merge short-circuit' });
const PASS_VERDICT = 'auto-merge';

const STEP_VALUES = Object.values(VERDICT_STEPS);
// Anchored at the start of the entry's action: the verdict verb must open the action, never
// appear after other narrative text that merely mentions or quotes one.
const ACTION_RE = /^#(\d+) assess-agent-autonomy verdict ([a-z][a-z-]*[a-z])/;
// A pass relaxes the merge gate, so it must also match the writer's whole emitted action
// (formatEntry's `{text}. Reversibility: {r}.` plus an optional lever suffix; `{r}` may carry one
// parenthesized note, as `log-decision.js` accepts, except one containing `). `, so a tail riding
// behind a note still reads as `unparsed` (#3870). A pass line with anything else after it — a
// tail, or a write cut short — reads as `unparsed`. A line cut immediately after a `).` inside a
// nested-paren note can still confirm; that is tolerated because writes are atomic (writeFileAtomic).
const PASS_ACTION_RE = /^#\d+ assess-agent-autonomy verdict auto-merge\. Reversibility: [a-z/]+(?: \((?:(?!\)\. ).)+\))?\.(?: \[lever: [^\]]*\])?$/;

function verdictText(n, verdict = PASS_VERDICT) {
  return `#${n} assess-agent-autonomy verdict ${verdict}`;
}

function verdictMarker(step, n, verdict = PASS_VERDICT) {
  return `${step}: ${verdictText(n, verdict)}`;
}

// `location` is formatEntry's `{step}` or `spec #{spec} — {step}` — a VERDICT_STEPS value
// exactly, or ending with ` — {step}`.
function isVerdictLocation(location) {
  return STEP_VALUES.some((step) => location === step || location.endsWith(` — ${step}`));
}

// "latest" means last in file order; callers write verdict lines without --section, so file
// order is write order (log-decision.js's --section can splice a line earlier in the file).
function latestVerdicts(content) {
  const latest = new Map();
  for (const ln of String(content).split(/\r?\n/)) {
    const entry = parseEntry(ln);
    if (!entry || !isVerdictLocation(entry.location)) continue;
    const m = ACTION_RE.exec(entry.action);
    if (!m) continue;
    const pass = m[2] === PASS_VERDICT;
    latest.set(Number(m[1]), pass && !PASS_ACTION_RE.test(entry.action) ? 'unparsed' : m[2]);
  }
  return latest;
}

function confirmPassingVerdicts(content, members) {
  const latest = latestVerdicts(content);
  const out = {};
  for (const raw of members) {
    const n = Number(raw);
    const v = latest.get(n) ?? null;
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
