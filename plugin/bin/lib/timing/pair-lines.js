// bin/lib/timing/pair-lines.js — reader for the review reproduction-pair lines (#5556).
//
// Eight pair-line templates: seven forms composed by plugin/bin/lib/reproduction-log.js
// (#5595, written by review-coordination.js categorise-reproduction --run and
// log-reproduction-judgment), and the single-read-coverage notice the agent types from
// plugin/skills/review/step3-tier-variants.md. The tiebreak forms are written by
// tiebreak.js and owned by console/resolve.js's parseTiebreakLine. This module reads
// them: one pattern set per template, each PAIR_FORMS template pinned to the composer
// (or, for the notice, to the prose) by tests/bin-lib/timing/pair-lines.test.js.
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
// Phase 6 of docs/superpowers/specs/2026-11-15-process-efficiency-design.md moved
// the pair-line write into code (#5595): reproduction-log.js composes the seven forms
// and this reader's test pins each PAIR_FORMS template to that composer.
//
// Counters per form (the "Pair lines" section of docs/reference/step-yield.md):
// `both` = findings both reviewers reported, `one` = findings one reviewer
// reported, `relabel` = a finding already counted that changed label (adds to
// no finding count).
'use strict';

const { DECISION_STATUSES } = require('../log-decision/append');

// A real line is `- {STATUS} {HH:MM:SS} — {location}: {action}`; the location
// (the writer's step label, e.g. `log-decision`) is absent from the bare
// `- AUTO 10:00:00 — Reproduction: …` shape. The head is optional so the
// action text alone also classifies.
//
// The label before `Reproduction:` is one of an allow-list: the writer labels measured in the
// archive (a census of the label before every classified `Reproduction:`). A label outside the
// list (`wrap-up: carried forward from review`, `Routing: quoting`, a dispatch notice that only
// mentions a reproduction pair) is a quoted or carried line, not a new finding: it is not a pair line.
// `spec #N — ` / `spec #N: ` may prefix a writer label (a multi-spec run's per-spec writer).
const WRITER_LABEL = '(?:log-decision: |Reproduction: |Step 3(?: lens [\\w-]+| \\(?[Rr]eproduction\\)?)?:? |Delta(?:-\\d+| review)? )';
const LABEL = `(?:spec #\\d+(?: — |: ))?${WRITER_LABEL}?`;
// The strict tier takes only the colon-terminated labels (`log-decision: `, `Step 3: `, `spec #N: `);
// the others (`Delta `, `Step 3 `, `spec #N — `) are read by the loose tier.
const LABEL_STRICT = '(?:(?:spec #\\d+ — )?(?:log-decision|Reproduction|Step 3(?: lens [\\w-]+| \\(?[Rr]eproduction\\)?)?): |spec #\\d+: )?';
const HEAD = `(?:- (?:${DECISION_STATUSES.join('|')}) \\d{2}:\\d{2}:\\d{2} — ${LABEL_STRICT})?`;
const LENS = 'lens "([^"]*)"';
// A path may hold spaces, but never the start of a verdict: `a.js:1 not reproduced; … b.js:2` is two findings.
const PATH_STRICT = '((?:(?!\\s(?:not )?reproduced\\b)[^\\n])+)';
// The path of a finding with no line (`finding {path} not reproduced.`): never a `:{digits}` (that is a located
// finding, read by its own pattern) and never a trailing note (` (…)`, ` — …`), which only a located line carries.
// So an unlocated path holding ` (` (`docs/a (b).md`) is not read: it cannot be told from a note, and reading it
// would move archive verdicts (a located line is unaffected, its path is read by the located patterns).
const PATH_UNLOCATED = '((?:(?!\\s(?:not )?reproduced\\b|:\\d| \\(| — )[^\\n])+)';
const TAIL = ' Reversibility: [a-z/]+\\.$';

// Loose wording (see the header): the label before the body, the tail after it.
// The status head itself is read as the archive spelled it: a bullet or none, a time with or
// without seconds or a date, an em dash or a hyphen. That is the writer's clock and separator,
// not a label.
const STATUS_HEAD = `(?:(?:- )?(?:${DECISION_STATUSES.join('|')})(?: \\d{2}:\\d{2}(?::\\d{2})?| \\d{4}-\\d{2}-\\d{2})? [—-] )?`;
const HEAD_LOOSE = `${STATUS_HEAD}${LABEL}`;
const TAIL_LOOSE = '(?: Stage path: \\S+\\.)?(?: Reversibility: [a-z/]+\\.)+$';
// A lens id is one token (`3a`, `convention`); a label may follow it (`3b (Security)`,
// `3c Error handling`) and is dropped. A colon, a comma, a slash or `and` after the id means
// the line names several lenses or findings, which is not one pair line.
const LENS_LOOSE = 'lens "?([\\w-]+)(?: \\(?[A-Z][A-Za-z ]{0,24}\\)?)?"?';
const LENS_FREE = 'lens "?([\\w-]+)(?: \\(?[A-Z][A-Za-z ]{0,24}\\)?)?"?:?';
// Free wording: the agent adds commentary around the sentence that carries the verdict. A free
// pattern pins the head, ONE location (`path:line`, no whitespace) and ONE verdict, needs a
// delimiter plus content after the verdict, and refuses a second verdict, a second finding or
// a nested Reproduction line in the commentary (parse-signal-discipline item 6).
const HEAD_FREE = HEAD_LOOSE;
const NOT_COMMENTARY = '(?!\\b(?:not )?reproduced\\b|elevated via|Reproduction:|\\b[Ff]indings?\\b)';
const TEMPER = `(?:${NOT_COMMENTARY}[^\\n])*`;
const SOME_CONTENT = '(?=[^\\n]*[A-Za-z0-9])';
// `. Confirmed.` may carry commentary (`Confirmed. Fixed in 746e2b5a0.`) but not just the writer's own tail.
const AFTER_VERDICT = `(?:(?:;|,|\\s—|\\s\\()${SOME_CONTENT}|\\.(?= (?!Reversibility:)${SOME_CONTENT}))${TEMPER}$`;
const AFTER_VERDICT_DOT = `(?:[.;,]|\\s—|\\s\\()${SOME_CONTENT}${TEMPER}$`;
// A note is one parenthesis (one nested level allowed) that holds no second verdict.
const NOTE_FREE = `(?: \\((?:(?!\\b(?:not )?reproduced\\b)(?:[^()\\n]|\\([^()\\n]*\\)))*\\))`;
const NOTE_OPT = `${NOTE_FREE}?`;
const LOC = '(\\S+?):(\\d+)(?:-\\d+)?';
const TAG = '(?: #?\\w+:)?';
// A review-marked line longer than this is not tried against any loose, free or legacy
// pattern (the longest real one is 1,355 characters): it counts as unparsed.
const LEGACY_LINE_MAX = 2000;

// bodies: the template's own patterns (strict). looseBodies: extra bodies read with the
// loose head and tail; defaults to each strict body that names a quoted lens, with the
// lens, path, tag and Reproduction prefix loosened. freeBodies: commentary-bearing bodies
// that end in their own delimiter rule.
function form(id, counts, template, bodies, groups, looseBodies, freeBodies = []) {
  const loose = looseBodies || bodies.filter((b) => b.includes(LENS))
    .map((b) => b.split(LENS).join(LENS_LOOSE).split(PATH_STRICT).join('(\\S+?)').replace('Reproduction: ', `Reproduction:${TAG} `));
  return Object.freeze({
    id,
    counts: Object.freeze(counts),
    template,
    groups, // capture-group order → { lens, path, line } indexes (null = absent)
    strict: bodies.length,
    pattern: Object.freeze([
      ...bodies.map((b) => new RegExp(`^${HEAD}${b}${TAIL}`)),
      ...loose.map((b) => new RegExp(`^${HEAD_LOOSE}${b}${TAIL_LOOSE}`)),
      ...freeBodies.map((b) => new RegExp(`^${HEAD_FREE}${b}`)),
    ]),
  });
}

const PAIR_FORMS = Object.freeze([
  form('reproduced', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced. Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding ${PATH_STRICT}:(\\d+) reproduced\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 },
    [`Reproduction:${TAG} ${LENS_LOOSE} finding ${LOC}${NOTE_OPT} reproduced${NOTE_OPT}\\. Confirmed\\.`],
    [`Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} reproduced${NOTE_OPT}[.,] Confirmed${AFTER_VERDICT}`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} reproduced by both agents(?: at \\w+)?[.,] Confirmed${AFTER_VERDICT_DOT}`]),
  form('reproduced-severity-contested', { both: 1, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} reproduced, severity contested (took the lower of the two). Confirmed. Reversibility: high.',
    [`Reproduction: ${LENS} finding ${PATH_STRICT}:(\\d+) reproduced, severity contested \\(took the lower of the two\\)\\. Confirmed\\.`], { lens: 1, path: 2, line: 3 },
    [`Reproduction:${TAG} ${LENS_LOOSE} finding ${LOC} reproduced, severity contested${NOTE_FREE}\\. Confirmed\\.`],
    [`Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} reproduced, severity contested${NOTE_FREE}[.,] Confirmed${AFTER_VERDICT}`]),
  form('not-reproduced', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" finding {path}:{line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
    [`Reproduction: ${LENS} finding ${PATH_STRICT}:(\\d+) not reproduced\\. Staged to Review Console as low-confidence\\.`,
      // A finding with no line (reproduction-log.js writes `finding {path} not reproduced.`, #5595): line null.
      `Reproduction: ${LENS} finding ${PATH_UNLOCATED} not reproduced\\. Staged to Review Console as low-confidence\\.`], { lens: 1, path: 2, line: 3 },
    [`Reproduction:${TAG} ${LENS_LOOSE} finding ${LOC}${NOTE_OPT} not reproduced\\. Staged to Review Console as low-confidence\\.`],
    [`Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} not reproduced(?:;|${NOTE_FREE})${SOME_CONTENT}${TEMPER}$`,
      `Reproduction:${TAG} ${LENS_FREE} finding ${LOC} not reproduced\\. Staged to Review Console as low-confidence(?:;|,|${NOTE_FREE})${SOME_CONTENT}${TEMPER}$`,
      // commentary after the whole sentence (the writer's tail may follow it)
      `Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} not reproduced\\. Staged to Review Console as low-confidence\\.(?= (?!Reversibility:)${SOME_CONTENT})${TEMPER}$`,
      // the whole sentence with no Reversibility tail
      `Reproduction:${TAG} ${LENS_FREE} finding ${LOC}${NOTE_OPT} not reproduced\\. Staged to Review Console as low-confidence\\.$`]),
  form('absence-refuted', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "{lens}" absence claim {path}:{symbol} refuted by ground-truth check ({command} found it at {path}:{line}). Not staged. Reversibility: high.',
    // Each group stops at its own delimiter (path before ` refuted by ground-truth check`, command before
    // ` found it at `), so a line that repeats a delimiter is read in time linear in its length.
    [`Reproduction: ${LENS} absence claim ((?:(?! refuted by ground-truth check)[^\\n])+):([^\\s:]+) refuted by ground-truth check \\((?:(?! found it at )[^\\n])+ found it at [^\\n]+:\\d+\\)\\. Not staged\\.`], { lens: 1, path: 2, line: null }),
  form('vacuity-downgraded', { both: 0, one: 0, relabel: 1 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. Reversibility: high.',
    ['Reproduction: lens "(3f)" vacuity finding (.+):(\\d+) downgraded to unconfirmed — reproduction agreement overridden, no execution evidence\\. Staged to Review Console as low-confidence\\.'], { lens: 1, path: 2, line: 3 }),
  form('vacuity-reconfirmed', { both: 0, one: 1, relabel: 0 },
    'Reproduction: lens "3f" vacuity finding {path}:{line} re-confirmed by executed run: {command} → {observed output}. Confirmed. Reversibility: high.',
    // Path and command stop at their own delimiters (as in absence-refuted): linear in the line's length.
    ['Reproduction: lens "(3f)" vacuity finding ((?:(?! re-confirmed by executed run: )[^\\n])+):(\\d+) re-confirmed by executed run: (?:(?! → )[^\\n])+ → [^\\n]+\\. Confirmed\\.'], { lens: 1, path: 2, line: 3 }),
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
//   direct-verification-elevated — a finding the controller confirmed by reading the source.
//     It changes the confidence of a finding a pair line already counted, so it is a
//     relabel: it adds to no finding count. One location, one verdict.
//   no-findings — a lens whose both agents returned nothing; counts no finding.
//   console-disposition — the Review Console's keep-staged restatement of an already-staged
//     finding; counts no finding (the finding's own not-reproduced line did).
function legacy(id, counts, template, body, groups, head = HEAD_LOOSE, rest = TAIL_LOOSE) {
  return Object.freeze({
    id, counts: Object.freeze(counts), template, groups, strict: 0,
    pattern: Object.freeze([new RegExp(`^${head}${body}${rest}`)]),
  });
}

const ELEVATED_END = `(?:[.;,:]|\\s—)${SOME_CONTENT}(?:(?!\\b(?:not )?reproduced\\b|elevated via|Reproduction:)[^\\n])*$`;
const LEGACY_FORMS = Object.freeze([
  legacy('direct-verification-elevated', { both: 0, one: 0, relabel: 1 },
    'Reproduction: [lens "{lens}"] finding {path}:{line} elevated via direct-verification override ({how}). Confirmed.',
    `Reproduction:${TAG} (?:${LENS_FREE} )?(?:finding )?${LOC}${NOTE_OPT} elevated via direct-verification override(?: \\((?:(?!Reproduction:)[^\\n])*?\\))?`,
    { lens: 1, path: 2, line: 3 }, HEAD_FREE, ELEVATED_END),
  legacy('no-findings', { both: 0, one: 0, relabel: 0 },
    'Reproduction: lens "{lens}" both agents returned No findings.',
    `Reproduction:${TAG} ${LENS_LOOSE}(?: —)? both agents returned No findings\\.`,
    { lens: 1, path: null, line: null }),
  legacy('console-disposition', { both: 0, one: 0, relabel: 0 },
    'Review Console: Console item decision:{status} {time} — … (Low-confidence findings): keep-staged — …',
    'Review Console: Console item decision:[A-Z-]+ \\d{2}:\\d{2}:\\d{2} — [^\\n]*?\\(Low-confidence findings\\): keep-staged — [^\\n]*?\\.',
    { lens: null, path: null, line: null },
    `${STATUS_HEAD}`),
]);

const ALL_FORMS = Object.freeze([...PAIR_FORMS, ...LEGACY_FORMS]);

// The literal #5541 writes when no judge ran for a review-marked line.
const JUDGE_NONE = 'judge: none';

// The decisions.md entry line a reader hands to the line parsers: a dash-less status
// line (archived logs carry them) gains the `- ` the parsers' heads expect.
function entryLine(rawLine) {
  return rawLine.startsWith('- ') ? rawLine : `- ${rawLine}`;
}

// `judge: none` is the line's own marker, never text inside a quoted ` Evidence: `
// clause, so only the part before that delimiter counts.
function isJudgeNone(rawLine) {
  const evidenceAt = rawLine.indexOf(' Evidence: ');
  return (evidenceAt === -1 ? rawLine : rawLine.slice(0, evidenceAt)).includes(JUDGE_NONE);
}

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
  const long = s.length > LEGACY_LINE_MAX;
  for (const f of ALL_FORMS) {
    // A long line is tried against the strict (prose-pinned) patterns only, which come first.
    for (let i = 0; i < (long ? f.strict : f.pattern.length); i++) {
      const m = f.pattern[i].exec(s);
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

module.exports = { PAIR_FORMS, LEGACY_FORMS, ALL_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine, entryLine, isJudgeNone };
