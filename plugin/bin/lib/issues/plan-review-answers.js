// bin/lib/issues/plan-review-answers.js
// Pure: detection of a plan-review question and its `/answer` replies on a record's
// comments, and the writer that folds those replies into the record body (#5053).
// D1: a "reply" is a trusted-author comment created after the newest trusted question
// comment whose first non-blank line starts with `/answer` and carries text. D6: one
// `## Plan-review answers ({question date})` section per question, before
// `## Original request`; each reply is a `**Decision**` paragraph holding the reply text
// in a fence (fenceFor, never hand-rolled), so the placeholder gate and the Original
// request boundary read it as quoted content, and the reply URL makes the write
// idempotent. No I/O: bin/plan-review-answer.js does the gh calls.
'use strict';

const { isTrustedComment } = require('./comment-trust');
const { fenceFor, fencedLineMask } = require('../markdown-blocks');
const { originalRequestOffset } = require('./materialize-format');

const QUESTION_MARKER = '<!-- plan-review-question -->';
const ANSWER_RE = /^\/answer(\s|$)/i;
const SECTION_TITLE = '## Plan-review answers';

function time(comment) {
  const t = Date.parse(comment && comment.createdAt);
  return Number.isNaN(t) ? 0 : t;
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

// A question needs a parseable createdAt: it dates the section heading and bounds the replies.
function hasDate(comment) {
  return !Number.isNaN(Date.parse(comment && comment.createdAt));
}

// The one header line decisionBlock writes; the URL is the reply that block holds.
const DECISION_HEADER_RE = /^\*\*Decision\*\* \(answer by @[^,\s]*, (\S+)\):$/;

// The reply URL of every unfenced `**Decision** (answer by @…, {url}):` line in body, in order,
// repeats kept. This, never a search of the whole body, is what "already ingested" reads: reply
// text sits in the body too, so a reply quoting another reply's URL, or prose citing a comment,
// must not count (#5053 final review I1). The read-back in bin/plan-review-answer.js counts these.
function decisionHeaderUrls(body) {
  const lines = str(body).replace(/\r\n?/g, '\n').split('\n');
  const fenced = fencedLineMask(lines, { unclosedAsText: true });
  const urls = [];
  lines.forEach((line, i) => {
    const m = fenced[i] ? null : DECISION_HEADER_RE.exec(line.trimEnd());
    if (m) urls.push(m[1]);
  });
  return urls;
}

// A comment GitHub shows collapsed (hidden as spam, off-topic, outdated…) never counts.
function isVisible(comment) {
  return comment.isMinimized !== true;
}

// The newest trusted, visible comment whose body starts with the marker, or null.
function findQuestion(comments) {
  let best = null;
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!c || !isVisible(c) || !isTrustedComment(c) || !hasDate(c)) continue;
    if (!str(c.body).trimStart().startsWith(QUESTION_MARKER)) continue;
    if (best === null || time(c) >= time(best)) best = c;
  }
  return best;
}

// The reply body with the leading `/answer` token (and one following space) removed from
// its first non-blank line, trimmed.
function answerText(comment) {
  const lines = str(comment && comment.body).replace(/\r\n?/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i === -1) return '';
  lines[i] = lines[i].replace(/^\s*\/answer ?/i, '');
  return lines.join('\n').trim();
}

function isAnswerShaped(comment) {
  const lines = str(comment && comment.body).replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim() !== '');
  return first !== undefined && ANSWER_RE.test(first.trimStart());
}

// Trusted, visible, strictly after the question, `/answer`-shaped with text; oldest first.
function findAnswerReplies(comments, question) {
  if (!question) return [];
  const after = time(question);
  return (Array.isArray(comments) ? comments : [])
    .filter((c) => c && c !== question && str(c.url) !== '' && isVisible(c) && isTrustedComment(c) && time(c) > after && isAnswerShaped(c) && answerText(c) !== '')
    .sort((a, b) => time(a) - time(b));
}

function answeredState({ comments, body }) {
  const question = findQuestion(comments);
  if (!question) return { state: 'no-question', question: null, replies: [], pending: [] };
  const replies = findAnswerReplies(comments, question);
  const ingested = new Set(decisionHeaderUrls(body));
  const pending = replies.filter((r) => !ingested.has(r.url));
  return { state: replies.length > 0 ? 'answered' : 'unanswered', question, replies, pending };
}

function decisionBlock(reply) {
  const text = answerText(reply);
  const fence = fenceFor(text);
  const login = (reply.author && reply.author.login) || 'unknown';
  return [`**Decision** (answer by @${login}, ${reply.url}):`, '', `${fence}text`, text, fence];
}

// One reply into a body (LF text). Existing section for this question -> one more Decision
// block at the section's end; else a new section before `## Original request` or at the end.
function addOne(body, question, reply) {
  const questionLine = `Question: ${question.url}`;
  const lines = body.split('\n');
  const fenced = fencedLineMask(lines, { unclosedAsText: true });
  const q = lines.findIndex((l, i) => !fenced[i] && l.trimEnd() === questionLine);
  const block = decisionBlock(reply);
  if (q !== -1) {
    let end = lines.length;
    for (let i = q + 1; i < lines.length; i += 1) {
      if (!fenced[i] && /^## /.test(lines[i])) { end = i; break; }
    }
    let at = end;
    while (at > q + 1 && lines[at - 1].trim() === '') at -= 1;
    lines.splice(at, 0, '', ...block);
    return lines.join('\n');
  }
  const date = str(question.createdAt).slice(0, 10);
  const section = [`${SECTION_TITLE} (${date})`, '', questionLine, '', ...block].join('\n');
  const off = originalRequestOffset(body);
  const gap = (s) => (s === '' || s.endsWith('\n\n') ? '' : s.endsWith('\n') ? '\n' : '\n\n');
  if (off === -1) return `${body}${gap(body)}${section}\n`;
  const before = body.slice(0, off);
  return `${before}${gap(before)}${section}\n\n${body.slice(off)}`;
}

// A reply that already has a Decision header (decisionHeaderUrls) is skipped; no pending reply ->
// body unchanged.
function appendAnswers(body, question, replies) {
  const original = str(body);
  if (!hasDate(question)) return original;
  const crlf = original.includes('\r\n');
  let text = crlf ? original.replace(/\r\n/g, '\n') : original;
  const ingested = new Set(decisionHeaderUrls(text));
  let changed = false;
  for (const reply of replies || []) {
    if (!str(reply.url) || ingested.has(reply.url)) continue;
    text = addOne(text, question, reply);
    ingested.add(reply.url);
    changed = true;
  }
  if (!changed) return original;
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

// The first `**Question 1.` line with `**` stripped, else the first non-blank line after the marker.
function questionExcerpt(question) {
  const lines = str(question && question.body).replace(/\r/g, '').split('\n');
  const q1 = lines.find((l) => l.trimStart().startsWith('**Question 1.'));
  if (q1) return q1.trim().replace(/\*\*/g, '').trim();
  const rest = lines.filter((l) => l.trim() !== '' && !l.includes(QUESTION_MARKER));
  return rest.length ? rest[0].trim() : '';
}

module.exports = { QUESTION_MARKER, findQuestion, findAnswerReplies, answerText, answeredState, appendAnswers, questionExcerpt, decisionHeaderUrls };
