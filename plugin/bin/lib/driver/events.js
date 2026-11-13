'use strict';
// Event vocabulary for the pipeline driver (drive.js, record #5218).
//
// The step-name list below IS the event vocabulary: event lines carry `step` drawn from it
// (plus FINAL_STEP for the closing line). Fields may be added to an event, never renamed.
//
// This module holds three things and no step logic:
//   - the step, outcome and stop-class constants,
//   - the event sink (stdout line + {run-dir}/driver-events.jsonl),
//   - the neutralizers for text the headless worker controls, so that text cannot close an
//     issue (or backlink one), mention a user, open a code fence or an HTML comment, or break a
//     line in a commit, PR body or event.

const path = require('node:path');
const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');

const STEP_NAMES = Object.freeze([
  'policy', 'fetch', 'eligibility', 'admission', 'claim', 'run-dir', 'worktree', 'worker',
  'commit', 'test', 'check', 'push', 'pr', 'record-pr', 'set-config', 'summary', 'ci',
]);
const FINAL_STEP = 'final';

const STEP = Object.freeze(Object.fromEntries(
  STEP_NAMES.map((name) => [name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), name]),
));

const OUTCOMES = Object.freeze({
  PENDING_REVIEW: 'pending-review',
  EXPRESS_ESCALATED: 'express-escalated',
  BLOCKED: 'blocked',
  REFUSED: 'refused',
});

const STOP_CLASSES = Object.freeze({
  REFUSED: 'refused',
  CLAIM: 'claim',
  PRE_PUSH: 'pre-push',
  BLOCKED: 'blocked',
  NONE: 'none',
});

const OUTCOME_BY_CLASS = Object.freeze({
  [STOP_CLASSES.REFUSED]: OUTCOMES.REFUSED,
  [STOP_CLASSES.CLAIM]: OUTCOMES.BLOCKED,
  [STOP_CLASSES.PRE_PUSH]: OUTCOMES.EXPRESS_ESCALATED,
  [STOP_CLASSES.BLOCKED]: OUTCOMES.BLOCKED,
  [STOP_CLASSES.NONE]: OUTCOMES.PENDING_REVIEW,
});

function outcomeFor(stopClass) {
  if (typeof stopClass !== 'string' || !Object.prototype.hasOwnProperty.call(OUTCOME_BY_CLASS, stopClass)) {
    throw new Error(`unknown stop class: ${String(stopClass)}`);
  }
  return OUTCOME_BY_CLASS[stopClass];
}

// A match may start only where an owner name can start: at the start of an identifier run, or
// right after any `#\d+` (a superset of "where a previous match ended" — a global replace resumes
// there, so back-to-back references like `a/b#1x/y#2` both go; the extra starts never match where
// the replace would not have). A match from any other start implies a match from an earlier
// allowed start, so refusing them changes no result but stops a long identifier run being
// rescanned from every start (quadratic). The cheap `(?!\d)` keeps the variable-length
// `(?<=#\d+)` scan-back from running at every digit of a long digit run.
const QUALIFIED_REF = /(?:(?<![A-Za-z0-9_.-])|(?!\d)(?<=#\d+))[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+/g;
const BARE_REF = /#\d+/g;
// An issue or PR URL on any host, with any tail (`/files`, `#issuecomment-…`): it backlinks like
// `#N`. The left boundary rewinds over letters only, as GitHub's autolinker does: `1https://…` and
// `_https://…` link and are removed, `xhttps://…` does not link and stays. The tail stops before
// trailing punctuation (`)`, `.`, `,` …), which belongs to the sentence. Other URL forms
// (`www.…`, bare `github.com/…`) are not removed here; their closing keyword still is, below.
const URL_REF = /(?<![A-Za-z])https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/\d+(?:[/#?]\S*[^\s)\].,;:!?'">])?/gi;
const GH_REF = /\bGH-\d+\b/gi;
// An HTML comment opener hides the rest of a rendered body; `<\!--` renders as the text `<!--`.
const COMMENT_OPENER = /<!--/g;

// A closing keyword (and an optional colon) is removed when the whitespace-delimited token that
// starts right after it carries a reference marker: `#N`, or an `/issues/N` or `/pull/N` path. That
// is a superset of "a reference follows", and it does not depend on the reference grammar modelling
// every way GitHub autolinks one (`Closes (#4)`, `Fix foo#1` lose the keyword too: the safe side).
// A keyword that is a whole path segment (`/fix/`) stays, since removing it would empty the segment
// and stop URL_REF matching. The decision is made in code, linearly: the markers are collected once,
// and the marker pointer and the end of the current token only ever move forward, so each keyword
// costs O(1) amortized (a lookahead regex, or a fresh whitespace search per keyword, rescans a long
// non-space run from every keyword).
const KEYWORD = new RegExp('\\b(' + CLOSING_KEYWORD_ALTERNATION + ')\\b(?:\\s*:)?\\s*', 'gi');
const REF_MARKER = /#\d|\/(?:issues|pull)\/\d/gi;
const WHITESPACE = /\s/g;
function removeKeywordsBeforeReferences(text, replacement) {
  const markers = [];
  for (const m of text.matchAll(REF_MARKER)) markers.push(m.index);
  if (markers.length === 0) return text;
  let out = '';
  let last = 0;
  let mi = 0;
  let tokenEnd = -1;
  for (const m of text.matchAll(KEYWORD)) {
    const tokenStart = m.index + m[0].length;
    while (mi < markers.length && markers[mi] < tokenStart) mi++;
    if (mi === markers.length) break;
    if (text[m.index - 1] === '/' && text[m.index + m[1].length] === '/') continue;
    if (tokenEnd < tokenStart) {
      WHITESPACE.lastIndex = tokenStart;
      const ws = WHITESPACE.exec(text);
      tokenEnd = ws ? ws.index : text.length;
    }
    if (markers[mi] < tokenEnd) {
      out += text.slice(last, m.index) + replacement;
      last = tokenStart;
    }
  }
  return last === 0 ? text : out + text.slice(last);
}

// Removing a reference can splice the text around it into a new one (`h#7ttps://…` becomes a URL,
// `Clo#5ses` a keyword). The removal passes therefore repeat until the text stops changing. Inside
// the loop each removal leaves a single space, which no reference, keyword or URL pattern can span,
// so a removal cannot splice again across the gap and a nested splice settles in a few passes (a
// plain deletion would peel one nesting layer per pass, quadratic); back-to-back URLs do not peel
// either, as the URL boundary admits a digit before the scheme. The final whitespace collapse
// normalizes the spaces. Every removed match is at least two characters and is replaced by one, so
// each changing pass strictly shortens the text and the loop terminates. Only removals loop: the
// `@` transform is not idempotent, so it runs once, before the loop.
function removeReferencesToFixedPoint(text) {
  let out = text;
  for (;;) {
    const next = removeKeywordsBeforeReferences(out, ' ')
      .replace(URL_REF, ' ')
      .replace(GH_REF, ' ')
      .replace(QUALIFIED_REF, ' ')
      .replace(BARE_REF, ' ');
    if (next === out) return out;
    out = next;
  }
}

function neutralize(text) {
  if (typeof text !== 'string') return '';
  // The comment opener is escaped after the loop: a removal can splice `<!` and `--` together.
  return removeReferencesToFixedPoint(removeKeywordsBeforeReferences(text.replace(/[\r\n\t]+/g, ' '), '')
    .replace(URL_REF, '')
    .replace(GH_REF, '')
    .replace(/`/g, "'")
    .replace(/@/g, '@\u200B')
    .replace(QUALIFIED_REF, '')
    .replace(BARE_REF, ''))
    .replace(COMMENT_OPENER, '<\\!--')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(raw) {
  if (typeof raw !== 'string') return '';
  const firstLine = raw.split(/\r\n|\r|\n/)[0];
  // A removed trailing reference can leave a stranded " ." behind, so drop the whole tail.
  return neutralize(firstLine).replace(/(?:\s*\.)+\s*$/, '').trim();
}

// Every line reaches stdout at once. The file side is a queue: lines are held until the
// run directory is bound, then appended in order, each removed only once its append
// succeeds. A failed append never throws to the caller: the line stays queued and is
// tried again at the next emit, so the file stays an in-order prefix of stdout. The
// first failure is kept for fileError(), which the caller reports on the final line.
function createEventSink({ stdout, appendFile }) {
  const emitted = [];
  const held = [];
  let eventsFile = null;
  let firstError = null;

  function flush() {
    while (held.length > 0) {
      try {
        appendFile(eventsFile, held[0]);
      } catch (err) {
        if (firstError === null) firstError = (err && err.message) || String(err);
        return;
      }
      held.shift();
    }
  }

  function emit(event) {
    const line = JSON.stringify(event) + '\n';
    emitted.push(event);
    stdout(line);
    held.push(line);
    if (eventsFile !== null) flush();
  }

  function bindRunDir(runDir) {
    eventsFile = path.join(runDir, 'driver-events.jsonl');
    flush();
  }

  return { emit, bindRunDir, events: () => emitted.slice(), fileError: () => firstError };
}

module.exports = {
  STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, neutralize, normalizeTitle, createEventSink,
};
