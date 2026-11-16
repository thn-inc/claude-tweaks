// bin/lib/timing/pair-lines.js — reader for the review reproduction-pair lines (#5556).
//
// The seven pair-line templates are typed by the agent from
// plugin/skills/review/step3-lens-dispatch.md (the only producer; the tiebreak
// forms are written by tiebreak.js and owned by console/resolve.js's
// parseTiebreakLine). This module is their code twin: one pattern set per
// template, pinned to the prose by tests/bin-lib/timing/pair-lines.test.js.
//
// Pair-line patterns are additive: a reworded template adds a pattern to its
// form, never replaces one, so archived runs keep parsing.
//
// Phase 6 of docs/superpowers/specs/2026-11-15-process-efficiency-design.md
// moves the pair-line write into `categorise-reproduction`; this reader and its
// test then follow that writer.
//
// Counters per form (Decision 3 of the step-yield plan, mirrored in
// docs/reference/step-yield.md): `both` = findings both reviewers reported,
// `one` = findings one reviewer reported, `relabel` = a finding already counted
// that changed label (adds to no finding count).
'use strict';

const { DECISION_STATUSES } = require('../log-decision/append');

// A real line is `- {STATUS} {HH:MM:SS} — {location}: {action}`; the location
// (the writer's step label, e.g. `log-decision`) is absent from the bare
// `- AUTO 10:00:00 — Reproduction: …` shape. The head is optional so the
// action text alone also classifies.
const HEAD = `(?:- (?:${DECISION_STATUSES.join('|')}) \\d{2}:\\d{2}:\\d{2} — (?:[^\\n]*?: )?)?`;
const LENS = 'lens "([^"]*)"';
const TAIL = ' Reversibility: [a-z/]+\\.$';

function form(id, counts, template, bodies, groups) {
  return Object.freeze({
    id,
    counts: Object.freeze(counts),
    template,
    groups, // capture-group order → { lens, path, line } indexes (null = absent)
    pattern: Object.freeze(bodies.map((b) => new RegExp(`^${HEAD}${b}${TAIL}`))),
  });
}

const PAIR_FORMS = Object.freeze([
  form('reproduced', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced. Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) reproduced\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 }),
  form('reproduced-severity-contested', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced, severity contested (took the lower of the two). Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) reproduced, severity contested \\(took the lower of the two\\)\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 }),
  form('not-reproduced', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) not reproduced\\. Staged to Review Console as low-confidence\\.`], { lens: 1, path: 2, line: 3 }),
  form('absence-refuted', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {path}:{line}). Not staged. Reversibility: high.',
    [`Reproduction: ${LENS} absence claim (.+):([^\\s:]+) refuted by ground-truth check \\(.+ found it at .+:\\d+\\)\\. Not staged\\.`], { lens: 1, path: 2, line: null }),
  form('vacuity-downgraded', { both: 0, one: 0, relabel: 1 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. Reversibility: high.',
    ['Reproduction: lens "(3f)" vacuity finding (.+):(\\d+) downgraded to unconfirmed — reproduction agreement overridden, no execution evidence\\. Staged to Review Console as low-confidence\\.'], { lens: 1, path: 2, line: 3 }),
  form('vacuity-reconfirmed', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} re-confirmed by executed run: {command} → {observed output}. Confirmed. Reversibility: high.',
    ['Reproduction: lens "(3f)" vacuity finding (.+):(\\d+) re-confirmed by executed run: .+ → .+\\. Confirmed\\.'], { lens: 1, path: 2, line: 3 }),
  form('coincidence', { both: 0, one: 2, relabel: 0 },
    'Reproduction: lens "{lens}" findings {path}:{lineA} / {path}:{lineB} share a location but not substance; both staged unconfirmed. Reversibility: high.',
    [`Reproduction: ${LENS} findings (.+):(\\d+) / \\2:\\d+ share a location but not substance; both staged unconfirmed\\.`], { lens: 1, path: 2, line: 3 }),
]);

// The literal #5541 writes when no judge ran for a review-marked line.
const JUDGE_NONE = 'judge: none';

// A line is review-marked when it belongs to the reproduction/tiebreak family,
// whether or not any reader recognises its wording.
function isReviewMarkedLine(line) {
  const s = String(line);
  return s.includes('Reproduction:') || s.includes('Tiebreak tiebreak:');
}

// A full decisions.md entry line or its action text -> { form, lens, path, line },
// or null when it is not a pair line. null means "not a pair line" only: a line
// isReviewMarkedLine flags that matches nothing is a could-not-parse, which the
// caller buckets as unparsed. A tiebreak line (`confirmed by tiebreak:{id}`) is
// null here — parseTiebreakLine owns it.
function classifyPairLine(line) {
  const s = String(line);
  for (const f of PAIR_FORMS) {
    for (const re of f.pattern) {
      const m = re.exec(s);
      if (!m) continue;
      return {
        form: f.id,
        lens: m[f.groups.lens],
        path: m[f.groups.path],
        line: f.groups.line == null ? null : Number(m[f.groups.line]),
      };
    }
  }
  return null;
}

module.exports = { PAIR_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine };
