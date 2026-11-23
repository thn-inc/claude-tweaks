'use strict';

// Pure: decide from a record's comments whether `/claude-tweaks:specify`'s
// planning step holds it (#6059). The source is the held-comment template and
// the Held-questions schema in `plugin/skills/specify/planning.md` (`## Hold`):
// `Held-by: specify-planning` on the line directly above a
// `<!-- held-questions:start -->` ... `<!-- held-questions:end -->` block of
// `- Question:` / `  Option:` x2 / `  Recommended:` groups, inside the canonical
// `<!-- needs-decision: specify -->` comment.
//
// Selection follows `_shared/work-record.md`'s Resolution rule: a decision
// comment carries `<!-- needs-decision: `, it is unresolved when its body has no
// `**Resolved:**`, only a trusted author's comment counts (comment-trust.js; each
// untrusted decision comment adds its skip note), and the newest unresolved one
// decides. No timestamp, an unparseable one, or a tie for newest is `ambiguous`:
// the reader never guesses which of two comments is the hold. Option, question
// and Recommended values are trimmed before they are compared or returned.
//
// `otherUnresolved` and `supersededHolds` are meaningful only on a `held`
// verdict. There, `supersededHolds` lists the other unresolved trusted
// comments that are themselves specify planning holds (the specify marker and
// the Held-by line: an older hold a failed re-hold left behind), which the
// answer path resolves with the newest; `otherUnresolved` counts only the
// remaining unresolved trusted decision comments (another unit's, or any that
// is not a planning hold), which keep `needs:decision` on the record. On a `not-held` verdict
// `supersededHolds` is `[]` and `otherUnresolved` is not a label decision.

const { isTrustedComment, untrustedSkipNote } = require('./comment-trust');

const HELD_BY_LINE = 'Held-by: specify-planning';
const BLOCK_START = '<!-- held-questions:start -->';
const BLOCK_END = '<!-- held-questions:end -->';
const DECISION_MARKER = '<!-- needs-decision: ';
const SPECIFY_MARKER = '<!-- needs-decision: specify -->';
const RESOLVED = '**Resolved:**';

const QUESTION = '- Question: ';
const OPTION = '  Option: ';
const RECOMMENDED = '  Recommended: ';

function bodyOf(comment) {
  return comment && typeof comment.body === 'string' ? comment.body.replace(/\r\n/g, '\n') : '';
}

function stamp(comment) {
  const raw = comment.createdAt ?? comment.created_at;
  if (typeof raw !== 'string' || raw === '') return NaN;
  return Date.parse(raw);
}

function notHeld(reason, extra = {}) {
  return { verdict: 'not-held', reason, comment: null, otherUnresolved: 0, supersededHolds: [], questions: [], skipped: [], ...extra };
}

// The questions in `lines` (the block's interior), or null when any line breaks the schema.
function parseQuestions(lines) {
  if (lines.length % 4 !== 0) return null;
  const questions = [];
  for (let i = 0; i < lines.length; i += 4) {
    const [q, a, b, r] = lines.slice(i, i + 4);
    if (!q.startsWith(QUESTION) || !a.startsWith(OPTION) || !b.startsWith(OPTION) || !r.startsWith(RECOMMENDED)) return null;
    const question = q.slice(QUESTION.length).trim();
    const first = a.slice(OPTION.length).trim();
    const second = b.slice(OPTION.length).trim();
    const recommended = r.slice(RECOMMENDED.length).trim();
    if (question === '' || first === '' || second === '' || recommended === '' || recommended !== first) return null;
    questions.push({ question, options: [first, second], recommended });
  }
  return questions;
}

// The held questions of a planning hold body, or null when the block does not parse.
function parseBlock(body) {
  const lines = body.split('\n');
  const starts = lines.reduce((acc, line, i) => (line.trim() === BLOCK_START ? [...acc, i] : acc), []);
  if (starts.length !== 1) return null;
  const start = starts[0];
  if (start === 0 || lines[start - 1].trim() !== HELD_BY_LINE) return null;
  const end = lines.findIndex((line, i) => i > start && line.trim() === BLOCK_END);
  if (end === -1) return null;
  return parseQuestions(lines.slice(start + 1, end));
}

function carriesHeldBy(body) {
  return body.split('\n').some((line) => line.trim() === HELD_BY_LINE);
}

// A specify planning hold: the specify unit's marker and the Held-by line.
function isSpecifyHold(body) {
  return carriesHeldBy(body) && body.includes(SPECIFY_MARKER);
}

function ref(comment) {
  return { id: comment.node_id ?? comment.id ?? null, url: comment.url ?? comment.html_url ?? null };
}

// comments: a `gh issue view --json comments` array (camelCase) or a REST/MCP
// array (snake_case). -> { verdict, reason, comment: { id, url } | null,
// otherUnresolved, supersededHolds: [{ id, url }], questions, skipped }.
function readPlanningHold(comments) {
  const list = Array.isArray(comments) ? comments.filter((c) => c !== null && typeof c === 'object') : [];
  const unresolved = list.filter((c) => bodyOf(c).includes(DECISION_MARKER) && !bodyOf(c).includes(RESOLVED));
  const trusted = unresolved.filter(isTrustedComment);
  const untrusted = unresolved.filter((c) => !isTrustedComment(c));
  const skipped = untrusted.map(untrustedSkipNote);

  if (trusted.length === 0) {
    return notHeld(untrusted.some((c) => carriesHeldBy(bodyOf(c))) ? 'untrusted' : 'no-decision-comment', { skipped });
  }

  const stamps = trusted.map(stamp);
  if (stamps.some(Number.isNaN)) return notHeld('ambiguous', { skipped });
  const newestStamp = Math.max(...stamps);
  const newest = trusted.filter((c, i) => stamps[i] === newestStamp);
  if (newest.length !== 1) return notHeld('ambiguous', { skipped });

  const selected = newest[0];
  const body = bodyOf(selected);
  const otherUnresolved = trusted.length - 1;
  if (!isSpecifyHold(body)) return notHeld('not-planning', { skipped, otherUnresolved });

  const questions = parseBlock(body);
  if (questions === null) return notHeld('unparseable', { skipped, otherUnresolved });
  const superseded = trusted.filter((c) => c !== selected && isSpecifyHold(bodyOf(c)));
  return {
    verdict: 'held',
    reason: null,
    comment: ref(selected),
    otherUnresolved: otherUnresolved - superseded.length,
    supersededHolds: superseded.map(ref),
    questions,
    skipped,
  };
}

module.exports = { readPlanningHold, HELD_BY_LINE, BLOCK_START, BLOCK_END };
