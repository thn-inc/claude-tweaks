'use strict';
// Event vocabulary for the pipeline driver (drive.js, record #5218).
//
// The step-name list below IS the event vocabulary: event lines carry `step` drawn from it
// (plus FINAL_STEP for the closing line). Fields may be added to an event, never renamed.
//
// This module holds no step logic. It holds:
//   - the step, outcome and stop-class constants,
//   - the event sink (stdout line + {run-dir}/driver-events.jsonl),
//   - the neutralizers for text the headless worker controls, so that text cannot close an
//     issue (or backlink one), mention a user, open a code fence or an HTML comment, or break a
//     line in a commit, PR body or event,
//   - the small helpers the run loop, steps and settle share (settle.js never requires
//     steps.js or run.js; steps.js may require settle.js):
//     CLI_TIMEOUT_MS (the bound on one plugin/bin CLI call) and firstLine and errorText
//     (an execFileSync error's own words), shared by steps.js and settle.js;
//     yieldToEventLoop (lets a pending signal be delivered between steps and between
//     settle calls), shared by run.js and settle.js; and outcomeFor (stop class to outcome
//     word), used by run.js and settle.js.

const path = require('node:path');
const { CLOSING_KEYWORD_ALTERNATION } = require('../issue-branch-tracking');

const STEP_NAMES = Object.freeze([
  'policy', 'fetch', 'eligibility', 'admission', 'claim', 'run-dir', 'worktree', 'worker',
  'commit', 'test', 'check', 'push', 'pr', 'record-pr', 'set-config', 'summary', 'ci',
]);
const FINAL_STEP = 'final';

// Bound on one plugin/bin CLI call (claim-targets.js talks to GitHub; the rest are local).
// Shared by steps.js and settle.js (settle.js never requires steps.js).
const CLI_TIMEOUT_MS = 120000;

// An execFileSync error's own words: gh and git put the cause on stderr, while the
// message leads with "Command failed: …". First non-empty line of whichever has text.
function firstLine(s) {
  return String(s || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
}
function errorText(err) {
  return firstLine(err && err.stderr) || firstLine(err && err.message) || String(err);
}

// The calls the driver's own settle makes for a stopped run (settle.js). Kept apart from
// STEP_NAMES: these are cleanup calls, not pipeline steps, and the step list is pinned.
const SETTLE_STEP_NAMES = Object.freeze([
  'settle-escalate', 'settle-comment-pr', 'settle-comment-record', 'settle-label',
  'settle-release', 'settle-remove-worktree', 'settle-delete-branch', 'settle-close',
]);

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

// Lets the event loop deliver a pending signal: every step before the worker makes only
// synchronous calls, and an await that settles on microtasks alone never turns the loop, so
// without this a SIGINT during the claim would wait for the worker. Used by run.js between
// steps and by settle.js between calls.
function yieldToEventLoop() {
  return new Promise((resolve) => { setImmediate(resolve); });
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
// trailing punctuation (`)`, `.`, `,` …), which belongs to the sentence.
// A `www.` URL (any host, optional port) and a bare `github.com` URL start where GitHub's
// www-autolink does: at the start, after whitespace, or after `*`, `_`, `~` or `(`. A digit is
// admitted too, as for the scheme: it is where the previous reference ended, so back-to-back
// references go in one pass instead of one per loop pass.
// A `www.` domain cannot run across a later `www.` start (`[\d_](?!www\.)`). Without that guard,
// every `_www.` or `1www.` in a long run rescans the run to its end.
// Each alternative scans at most its host and the path segments that follow it.
const URL_REF = /(?:(?<![A-Za-z])https?:\/\/[^\s/]+|(?<![^\s*_~(\d])(?:www\.(?:[A-Za-z.-]|[\d_](?!www\.))+(?::\d+)?|github\.com))\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/\d+(?:[/#?]\S*[^\s)\].,;:!?'">])?/gi;
// GitHub renders `owner/repo/issues/N` (or `/pull/N`) as a reference whatever precedes it: no host,
// any host, or a scheme URL it does not autolink. It refuses only a word character before the owner.
// The boundary refuses letters and `_` but admits a digit, for the back-to-back reason above.
// The owner (at most 39 characters) and the repo (at most 100) are bounded at GitHub's own limits,
// so a long `a-a-…` or digit run is scanned a bounded span from each start.
// It runs once, after the loop. Inside the loop it would take the path out of a rebuilt URL that the
// next pass removes whole. Its replacement is a space, which no pattern spans, so it splices
// nothing; the comment opener is escaped after it.
const PATH_REF = /(?<![A-Za-z_])[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/(?:issues|pull)\/\d+/gi;
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
// A keyword whose token is itself a removable keyword goes too (`Fixes fixes #4`): removing the
// later one makes its token the earlier one's, so the fixed-point loop below would remove the chain
// anyway, one keyword per pass over the whole text (quadratic in the chain length). Deciding the
// chain right to left, in one pass over the collected matches, reaches that same result at once.
const KEYWORD = new RegExp('\\b(' + CLOSING_KEYWORD_ALTERNATION + ')\\b(?:\\s*:)?\\s*', 'gi');
const REF_MARKER = /#\d|\/(?:issues|pull)\/\d/gi;
const WHITESPACE = /\s/g;
function removeKeywordsBeforeReferences(text, replacement) {
  const markers = [];
  for (const m of text.matchAll(REF_MARKER)) markers.push(m.index);
  if (markers.length === 0) return text;
  // Left to right: each keyword's span, and whether its own token carries a marker. A keyword past
  // the last marker can neither carry one nor lead a chain to one, so collection stops there.
  const keywords = [];
  let mi = 0;
  let tokenEnd = -1;
  for (const m of text.matchAll(KEYWORD)) {
    const tokenStart = m.index + m[0].length;
    while (mi < markers.length && markers[mi] < tokenStart) mi++;
    if (mi === markers.length) break;
    const segment = text[m.index - 1] === '/' && text[m.index + m[1].length] === '/';
    let marked = false;
    if (!segment) {
      if (tokenEnd < tokenStart) {
        WHITESPACE.lastIndex = tokenStart;
        const ws = WHITESPACE.exec(text);
        tokenEnd = ws ? ws.index : text.length;
      }
      marked = markers[mi] < tokenEnd;
    }
    keywords.push({ start: m.index, tokenStart, segment, removable: marked });
  }
  // Right to left: a keyword whose token starts exactly at a removable keyword is removable too.
  for (let i = keywords.length - 2; i >= 0; i--) {
    const k = keywords[i];
    const next = keywords[i + 1];
    if (!k.removable && !k.segment && next.removable && next.start === k.tokenStart) k.removable = true;
  }
  let out = '';
  let last = 0;
  for (const k of keywords) {
    if (!k.removable) continue;
    out += text.slice(last, k.start) + replacement;
    last = k.tokenStart;
  }
  return last === 0 ? text : out + text.slice(last);
}

// Removing a reference can splice the text around it into a new one (`h#7ttps://…` becomes a URL,
// `Clo#5ses` a keyword). The removal passes therefore repeat until the text stops changing. Inside
// the loop each removal leaves a single space, which no reference, keyword or URL pattern can span,
// so a removal cannot splice again across the gap and a nested splice settles in a few passes (a
// plain deletion would peel one nesting layer per pass, quadratic); back-to-back URLs do not peel
// either, as the URL boundary admits a digit before the scheme, `www.` and `github.com`, and nor do keyword chains, which
// removeKeywordsBeforeReferences decides whole in one pass. The final whitespace collapse
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
  const firstPass = removeKeywordsBeforeReferences(text.replace(/[\r\n\t]+/g, ' '), '')
    .replace(URL_REF, '')
    .replace(GH_REF, '')
    .replace(/`/g, "'")
    .replace(/@/g, '@\u200B')
    .replace(QUALIFIED_REF, '')
    .replace(BARE_REF, '');
  // The comment opener is escaped after the loop: a removal can splice `<!` and `--` together.
  return removeReferencesToFixedPoint(firstPass)
    .replace(PATH_REF, ' ')
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
  CLI_TIMEOUT_MS, firstLine, errorText,
  STEP_NAMES, SETTLE_STEP_NAMES, FINAL_STEP, STEP, OUTCOMES, STOP_CLASSES,
  outcomeFor, yieldToEventLoop, neutralize, normalizeTitle, createEventSink,
};
