// bin/lib/timing/pair-lines.js — reader for the review reproduction-pair lines (#5556).
//
// The eight pair-line templates are typed by the agent from two producer files:
// plugin/skills/review/step3-lens-dispatch.md (seven forms) and
// plugin/skills/review/step3-tier-variants.md (the single-read-coverage notice).
// The tiebreak forms are written by tiebreak.js and owned by console/resolve.js's
// parseTiebreakLine. This module is their code twin: one pattern set per
// template, pinned to the prose by tests/bin-lib/timing/pair-lines.test.js.
//
// Pair-line patterns are additive: a reworded template adds a pattern to its
// form, never replaces one, so archived runs keep parsing. Two kinds of legacy
// wording are read, both discovered by measuring the archive (tools/step-yield-report.js):
//   - each PAIR_FORMS form also carries a LOOSE pattern per body: a writer label that
//     does not end in a colon (`Delta Reproduction:`), a `Reproduction: delta:` or
//     `Reproduction: #4169:` tag, an unquoted lens, a parenthetical on the location
//     (`(agent B, zero-read)`), a `Stage path:` clause, and the writer's own
//     `Reversibility:` tail repeated;
//   - LEGACY_FORMS are line shapes no current template produces (a controller's
//     direct-verification override, a "no findings" notice, a Review Console
//     disposition of an already-staged finding). They are not pinned to prose.
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

// Loose wording (see the header): the label before the body, the tail after it.
const HEAD_LOOSE = `(?:- (?:${DECISION_STATUSES.join('|')})(?: \\d{2}:\\d{2}:\\d{2})? — )?(?:(?:(?!Review Console:)[^\\n])*? )?`;
const TAIL_LOOSE = '(?: Stage path: \\S+\\.)?(?: Reversibility: [a-z/]+\\.)+$';
const LENS_LOOSE = 'lens "?([^" ]+)"?';
// Free wording: the agent adds its own commentary around the sentence that carries the
// verdict. The pattern pins the head and the verdict phrase and takes the rest of the line
// as commentary, so it is the one place a pair pattern is not whole-input anchored.
const HEAD_FREE = `(?:- (?:${DECISION_STATUSES.join('|')})(?: \\d{2}:\\d{2}:\\d{2})? — )?(?:(?:(?!Review Console:)[^\\n])*? )?`;
// A lens id may carry a label (`3b (Security)`) but never a colon or a comma: those mark a
// list of findings (`lens 3a findings a.js:1, …`), which is not one lens.
const LENS_FREE = 'lens "?([^":,]{1,30}?)"?:?';
const NOTE_FREE = '(?: \\(.*?\\))?';
const REST = '[^\\n]*$';
const AT = '(.+?):(\\d+)(?:-\\d+)?';
// The earliest archived lines name a file with no line number.
const AT_OPT = '(.+?)(?::(\\d+)(?:-\\d+)?)?';
const TAG = '(?: #?\\w+:)?';
const NOTE = '(?: \\([^)]*\\))?';

// bodies: the template's own patterns (strict). looseBodies: extra bodies read with the
// loose head and tail; defaults to each strict body that names a quoted lens, with the
// lens, tag and Reproduction prefix loosened.
function form(id, counts, template, bodies, groups, looseBodies, freeBodies = []) {
  const loose = looseBodies || bodies.filter((b) => b.includes(LENS))
    .map((b) => b.split(LENS).join(LENS_LOOSE).replace('Reproduction: ', `Reproduction:${TAG} `));
  return Object.freeze({
    id,
    counts: Object.freeze(counts),
    template,
    groups, // capture-group order → { lens, path, line } indexes (null = absent)
    pattern: Object.freeze([
      ...bodies.map((b) => new RegExp(`^${HEAD}${b}${TAIL}`)),
      ...loose.map((b) => new RegExp(`^${HEAD_LOOSE}${b}${TAIL_LOOSE}`)),
      ...freeBodies.map((b) => new RegExp(`^${HEAD_FREE}${b}${REST}`)),
    ]),
  });
}

const PAIR_FORMS = Object.freeze([
  form('reproduced', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced. Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) reproduced\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 },
    [`Reproduction:${TAG} ${LENS_LOOSE} finding (.+):(\\d+)${NOTE} reproduced\\. Confirmed\\.`],
    [`Reproduction:${TAG} ${LENS_FREE} finding ${AT}(?: \\(.*?\\)) reproduced${NOTE_FREE}\\. Confirmed`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${AT}${NOTE_FREE} reproduced(?: \\(.*?\\))?(?:\\.|,) Confirmed(?:;|,| —| \\()`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${AT}${NOTE_FREE} reproduced(?: \\(.*?\\))\\. Confirmed`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${AT}${NOTE_FREE} reproduced by both agents[^\\n]*?\\. Confirmed`]),
  form('reproduced-severity-contested', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced, severity contested (took the lower of the two). Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) reproduced, severity contested \\(took the lower of the two\\)\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 },
    undefined,
    [`Reproduction:${TAG} ${LENS_FREE} finding ${AT}${NOTE_FREE} reproduced, severity contested \\(.*?\\)\\. Confirmed`]),
  form('not-reproduced', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
    [`Reproduction: ${LENS} finding (.+):(\\d+) not reproduced\\. Staged to Review Console as low-confidence\\.`], { lens: 1, path: 2, line: 3 },
    [`Reproduction:${TAG} ${LENS_LOOSE} finding (.+):(\\d+)${NOTE} not reproduced\\. Staged to Review Console as low-confidence\\.`],
    [`Reproduction:${TAG} ${LENS_FREE} finding ${AT}(?: \\(.*?\\)) not reproduced${NOTE_FREE}[.;]`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${AT_OPT}${NOTE_FREE} not reproduced(?: \\(.*?\\)|;)`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${AT} not reproduced\\. Staged to Review Console as low-confidence(?: \\(|;|,)`]),
  form('absence-refuted', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {path}:{line}). Not staged. Reversibility: high.',
    [`Reproduction: ${LENS} absence claim (.+):([^\\s:]+) refuted by ground-truth check \\(.+ found it at .+:\\d+\\)\\. Not staged\\.`], { lens: 1, path: 2, line: null }),
  form('vacuity-downgraded', { both: 0, one: 0, relabel: 1 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. Reversibility: high.',
    ['Reproduction: lens "(3f)" vacuity finding (.+):(\\d+) downgraded to unconfirmed — reproduction agreement overridden, no execution evidence\\. Staged to Review Console as low-confidence\\.'], { lens: 1, path: 2, line: 3 }),
  form('vacuity-reconfirmed', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} re-confirmed by executed run: {command} → {observed output}. Confirmed. Reversibility: high.',
    ['Reproduction: lens "(3f)" vacuity finding (.+):(\\d+) re-confirmed by executed run: .+ → .+\\. Confirmed\\.'], { lens: 1, path: 2, line: 3 }),
  form('single-read-coverage', { both: 0, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" {session limit twice | unavailable | timed out}; single-read coverage. Reversibility: high.',
    [`Reproduction: ${LENS} (?:session limit twice|unavailable|timed out); single-read coverage\\.`], { lens: 1, path: null, line: null }),
  form('coincidence', { both: 0, one: 2, relabel: 0 },
    'Reproduction: lens "{lens}" findings {path}:{lineA} / {path}:{lineB} share a location but not substance; both staged unconfirmed. Reversibility: high.',
    [`Reproduction: ${LENS} findings (.+):(\\d+) / \\2:\\d+ share a location but not substance; both staged unconfirmed\\.`], { lens: 1, path: 2, line: 3 }),
]);

// Line shapes no current template produces, read so an archive's counts and its unparsed
// share stay honest. Each is additive and pinned by a real archived line in pair-lines.test.js
// (not to prose: nothing live produces them).
//   direct-verification-elevated — a finding the controller confirmed by reading the source,
//     of 267 archived lines only 23 sit beside a not-reproduced line for the same
//     location, so each counts as one reviewer's finding (those 23 count twice, as
//     vacuity-reconfirmed does).
//   no-findings — a lens whose both agents returned nothing; counts no finding.
//   console-disposition — the Review Console's keep-staged restatement of an already-staged
//     finding; counts no finding (the finding's own not-reproduced line did).
function legacy(id, counts, template, body, groups, head = HEAD_LOOSE, rest = TAIL_LOOSE) {
  return Object.freeze({
    id, counts: Object.freeze(counts), template, groups,
    pattern: Object.freeze([new RegExp(`^${head}${body}${rest}`)]),
  });
}

const LEGACY_FORMS = Object.freeze([
  legacy('direct-verification-elevated', { both: 0, one: 1, relabel: 0 },
    'Reproduction: [lens "{lens}"] finding {path}:{line} elevated via direct-verification override ({how}). Confirmed.',
    `Reproduction:${TAG} (?:${LENS_FREE} )?(?:finding )?(.+?):(\\d+)(?:-\\d+)?${NOTE_FREE} elevated via direct-verification override`,
    { lens: 1, path: 2, line: 3 }, HEAD_FREE, REST),
  legacy('no-findings', { both: 0, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" both agents returned No findings.',
    `Reproduction:${TAG} ${LENS_LOOSE}(?: and lens "?[^" ]+"?)?(?: —)? both agents returned No findings\\.`,
    { lens: 1, path: null, line: null }),
  legacy('console-disposition', { both: 0, one: 0, relabel: 0 },
    'Review Console: Console item decision:{status} {time} — … (Low-confidence findings): keep-staged — …',
    'Review Console: Console item decision:[A-Z-]+ \\d{2}:\\d{2}:\\d{2} — .*\\(Low-confidence findings\\): keep-staged — .*?\\.',
    { lens: null, path: null, line: null },
    `(?:- (?:${DECISION_STATUSES.join('|')}) \\d{2}:\\d{2}:\\d{2} — )?`),
]);

const ALL_FORMS = Object.freeze([...PAIR_FORMS, ...LEGACY_FORMS]);

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
  for (const f of ALL_FORMS) {
    for (const re of f.pattern) {
      const m = re.exec(s);
      if (!m) continue;
      return {
        form: f.id,
        lens: f.groups.lens == null || m[f.groups.lens] == null ? null : m[f.groups.lens],
        path: f.groups.path == null ? null : m[f.groups.path],
        line: f.groups.line == null || m[f.groups.line] == null ? null : Number(m[f.groups.line]),
      };
    }
  }
  return null;
}

module.exports = { PAIR_FORMS, LEGACY_FORMS, ALL_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine };
