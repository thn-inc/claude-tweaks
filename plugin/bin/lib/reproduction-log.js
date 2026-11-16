// bin/lib/reproduction-log.js — the one home of the seven /claude-tweaks:review reproduction decision-log lines (#5595).
// Review step 3 used to carry each line as a prose template an agent typed by hand; this module composes them, so the
// agent states findings and a CLI writes the lines. Each composer returns a log-decision entry
// `{ status, step: 'Reproduction', text, reversibility: 'high' }`; log-decision's formatEntry adds the clock, the
// `Reproduction: ` label and the ` Reversibility: high.` tail. Pure, no I/O. The composers do not validate their
// inputs: the callers (review-coordination.js's CLI) check every required field before composing, so a missing
// `lens` or `path` is refused there rather than printed as `undefined`.
//
// Readers of these lines (a change to a form's wording must keep each one reading it):
//   - timing/pair-lines.js classifyPairLine — the pair-line counters (#5556), one pattern set per form
//   - console/finding-path.js (readsLocation, parseCoincidence) and console/resolve.js's findingKey/lineKeys —
//     the `{lens}|{path}:{line}` key a STAGED line is settled by
//   - console/backfill.js splitDecisionLine (analyseLine) — the legacy line splitter
//   - log-decision/aggregate-reproduction.js — refuses a STAGED line naming several findings
// tests/bin-lib/reproduction-log.test.js exercises: classifyPairLine and the PAIR_FORMS counters on every form;
// lineKeys, findingKey, splitDecisionLine and aggregateReproductionProblem on the STAGED forms (3, 4, 6);
// readsLocation and parseCoincidence on form 4 only; findingItems over all seven (form 5 makes no item).
'use strict';

const STEP = 'Reproduction';
// The forms whose line records a controller's judgment rather than a pair's agreement.
const JUDGMENT_KINDS = Object.freeze(['absence-refuted', 'vacuity-downgraded', 'vacuity-reconfirmed']);

// `{path}:{line}` for an integer line, the bare path for a finding with none.
function location(path, line) {
  return Number.isInteger(line) ? `${path}:${line}` : String(path);
}

function entry(status, text) {
  return { status, step: STEP, text, reversibility: 'high' };
}

// Form 1, or form 2 when the pair straddled a severity bucket (`severityContested`).
function reproduced({ lens, path, line, severityContested }) {
  const contested = severityContested === true ? ', severity contested (took the lower of the two)' : '';
  return entry('AUTO', `lens "${lens}" finding ${location(path, line)} reproduced${contested}. Confirmed.`);
}

// Form 3.
function notReproduced({ lens, path, line }) {
  return entry('STAGED', `lens "${lens}" finding ${location(path, line)} not reproduced. Staged to Review Console as low-confidence.`);
}

// Form 4.
function coincidence({ lens, path, lineA, lineB }) {
  return entry('STAGED', `lens "${lens}" findings ${location(path, lineA)} / ${location(path, lineB)} share a location but not substance; both staged unconfirmed.`);
}

// Form 5.
function absenceRefuted({ lens, path, symbol, command, foundAt }) {
  return entry('AUTO', `lens "${lens}" absence claim ${path}:${symbol} refuted by ground-truth check (${command} found it at ${location(foundAt.path, foundAt.line)}). Not staged.`);
}

// Form 6. The lens is the literal `3f`, as the template wrote it.
function vacuityDowngraded({ path, line }) {
  return entry('STAGED', `lens "3f" vacuity finding ${location(path, line)} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence.`);
}

// Form 7. The lens is the literal `3f`, as the template wrote it.
function vacuityReconfirmed({ path, line, command, output }) {
  return entry('AUTO', `lens "3f" vacuity finding ${location(path, line)} re-confirmed by executed run: ${command} → ${output}. Confirmed.`);
}

// The key a held finding is matched by (the CLI's --hold entries are findings of this shape).
function holdKey(finding) {
  return JSON.stringify([finding.source ?? null, finding.path ?? null, finding.line ?? null, finding.text ?? null]);
}

// A coincidence is an A finding whose `nearLocation` names the next entry, which points back at it
// (coordination.js's categoriseReproduction pushes the two sides adjacently).
function isCoincidence(a, b) {
  return Boolean(a && b && a.nearLocation && b.nearLocation
    && a.nearLocation.path === b.path && a.nearLocation.line === b.line
    && b.nearLocation.path === a.path && b.nearLocation.line === a.line
    && a.path === b.path && Number.isInteger(a.line) && Number.isInteger(b.line));
}

// categoriseReproduction's `{ confirmed, unconfirmed }` -> the lines for one write: `only: 'confirmed'` the
// forms 1/2, `only: 'unconfirmed'` the forms 3/4 minus any `hold` finding (one the tiebreak already settled, or the
// cross-lens pass promoted). `unlocated` is every unconfirmed finding with no integer line, in both modes, so the
// caller can say which findings carry no `{path}:{line}` key.
function pairEntries({ confirmed, unconfirmed }, { lens, only, hold = [] }) {
  if (only !== 'confirmed' && only !== 'unconfirmed') throw new TypeError(`only must be 'confirmed' or 'unconfirmed', got ${String(only)}`);
  const unlocated = unconfirmed.filter((f) => !Number.isInteger(f.line));
  if (only === 'confirmed') {
    return { entries: confirmed.map((f) => reproduced({ lens, path: f.path, line: f.line, severityContested: f.severityContested })), unlocated };
  }
  const held = new Set(hold.map(holdKey));
  const entries = [];
  for (let i = 0; i < unconfirmed.length; i++) {
    const a = unconfirmed[i];
    if (isCoincidence(a, unconfirmed[i + 1])) {
      const b = unconfirmed[i + 1];
      i += 1;
      const aHeld = held.has(holdKey(a));
      const bHeld = held.has(holdKey(b));
      // With one side held (settled elsewhere: refuted, or promoted by corroboration) the other is a plain
      // single-reviewer finding, so it gets form 3 and no coincidence line (spec AC4); both held writes nothing.
      if (!aHeld && !bHeld) entries.push(coincidence({ lens, path: a.path, lineA: a.line, lineB: b.line }));
      else if (!aHeld) entries.push(notReproduced({ lens, path: a.path, line: a.line }));
      else if (!bHeld) entries.push(notReproduced({ lens, path: b.path, line: b.line }));
      continue;
    }
    if (!held.has(holdKey(a))) entries.push(notReproduced({ lens, path: a.path, line: a.line }));
  }
  return { entries, unlocated };
}

module.exports = {
  STEP, JUDGMENT_KINDS, location, reproduced, notReproduced, coincidence, absenceRefuted, vacuityDowngraded, vacuityReconfirmed, pairEntries, holdKey,
};
