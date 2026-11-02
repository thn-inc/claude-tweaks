'use strict';

// Pure: the machine-readable verdict comment, a cross-repository contract with
// Dispatch, which writes this exact format (_shared/pr-run-comments.md holds the
// contract). One HTML comment, alone on its line and starting at column 0, with no
// run of 3 or more backticks or tildes anywhere before it (write the marker first
// when a comment also holds code):
//
//   <!-- accept-verdict: {"v":1,"verdict":"changes-requested","choice":"fix-forward","note":"text"} -->
//
// A marker shown as code must never count, and this module does not model Markdown
// to tell: a line-based fence tracker drifts from the real parser on list items, HTML
// blocks and a leading BOM. The two rules above need no model. Column 0 excludes
// indented code, inline spans, blockquotes and list items, and a fence cannot enclose
// a marker without opening earlier. A column-0 `<!--` line is always an HTML block,
// which an inline span cannot cross, so spans need no rule of their own. The cost is
// deliberate: a closed code block before the marker also rejects.
//
// A comment is writable by anyone who can comment, so a marker's presence proves
// nothing. Trust comes only from GitHub's attested author association, and every
// doubt resolves to { ok: false, reason }.
//
// Trust limit (#3358, comment-trust.js): the association cannot tell the maintainer
// from an agent running under the maintainer's account. The plugin therefore never
// authors a verdict marker itself; only Dispatch or the human does.
//
// A reason never echoes comment text, since a caller may print it.

const { isTrustedComment } = require('./comment-trust');
const { dispositionState } = require('./acceptance');
const { normalizeLabelNames } = require('./record-vocabulary');

const VERDICTS = new Set(['approved', 'changes-requested']);
const CHOICES = new Set(['fix-forward', 'revert-now']);
const FIELDS = new Set(['v', 'verdict', 'choice', 'note']);
const NOTE_LIMIT = 2000;
const DISAGREE_NOTE = 'verdict label and comment disagree';

// Each holds a backslash followed by u003c/u003e, which JSON.parse decodes.
const ESCAPED_LT = '\\u003c';
const ESCAPED_GT = '\\u003e';

// Every spelling a reader might take for a block, so a near-miss counts toward the
// duplicate check and then fails MARKER_LINE, instead of being ignored.
const OPENER = /<!--\s*accept-verdict/gi;
// Applied to one line without the m flag, so U+2028 is not taken for a line start;
// it is not a Markdown line ending.
const MARKER_LINE = /^<!-- accept-verdict: ([^\n]*) -->[ \t]*$/;
const FENCE_RUN = /`{3,}|~{3,}/;
// Where Markdown starts an HTML-block comment. A `<!--` later in a line of prose
// starts nothing, because the marker's own line would interrupt that paragraph.
const COMMENT_LINE = /^ {0,3}<!--/;

// Whether a comment opened at the start of a line is still open after these lines.
// `-->` closes it wherever it sits, since an HTML block has no inline code.
function endsInOpenComment(lines) {
  let open = false;
  for (const line of lines) {
    if (open ? line.includes('-->') : COMMENT_LINE.test(line)) {
      open = line.lastIndexOf('<!--') > line.lastIndexOf('-->');
    }
  }
  return open;
}

// JSON.parse keeps the last of a repeated key, so only the text can show one. Call
// with text JSON.parse has accepted: every string then terminates, and a string
// followed by a colon is a key. The result has only scalar fields, so a nested
// object is rejected later and keys need no per-object scoping.
function hasRepeatedKey(json) {
  const seen = new Set();
  let i = 0;
  while (i < json.length) {
    if (json[i] !== '"') {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (json[end] !== '"') end += json[end] === '\\' ? 2 : 1;
    let next = end + 1;
    while (json[next] === ' ' || json[next] === '\t') next += 1;
    if (json[next] === ':') {
      const key = JSON.parse(json.slice(i, end + 1));
      if (seen.has(key)) return true;
      seen.add(key);
    }
    i = end + 1;
  }
  return false;
}

// The reason an object is not a valid verdict, or null when it is.
function verdictProblem(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'verdict JSON is not an object';
  if (Object.keys(obj).some((key) => !FIELDS.has(key))) return 'unknown field in verdict';
  if (obj.v !== 1) return 'unsupported verdict version';
  if (!VERDICTS.has(obj.verdict)) return 'unknown verdict word';
  if (obj.verdict === 'changes-requested') {
    if (!CHOICES.has(obj.choice)) return 'changes-requested needs a known choice';
  } else if ('choice' in obj) {
    return 'choice is not allowed with approved';
  }
  if ('note' in obj) {
    if (typeof obj.note !== 'string') return 'note is not a string';
    if (obj.note.length > NOTE_LIMIT) return `note is over ${NOTE_LIMIT} characters`;
  }
  return null;
}

function renderVerdictMarker(obj) {
  const problem = verdictProblem(obj);
  if (problem) throw new Error(`renderVerdictMarker: ${problem}`);
  const ordered = { v: obj.v, verdict: obj.verdict };
  if ('choice' in obj) ordered.choice = obj.choice;
  if ('note' in obj) ordered.note = obj.note;
  const json = JSON.stringify(ordered).replace(/</g, ESCAPED_LT).replace(/>/g, ESCAPED_GT);
  return `<!-- accept-verdict: ${json} -->`;
}

function parseVerdictMarker(input) {
  const { body, authorAssociation } = input || {};
  const reject = (reason) => ({ ok: false, reason });

  if (!isTrustedComment({ authorAssociation })) return reject('untrusted comment author');
  if (typeof body !== 'string') return reject('comment body is not a string');

  const text = body.replace(/\r\n?/g, '\n');
  const openers = [...text.matchAll(OPENER)];
  if (openers.length === 0) return reject('no verdict marker');
  if (openers.length > 1) return reject('more than one verdict marker');

  const before = text.slice(0, openers[0].index);
  if (FENCE_RUN.test(before)) return reject('code fence text before the verdict marker');

  if (endsInOpenComment(before.split('\n'))) return reject('verdict marker inside another HTML comment');

  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = text.indexOf('\n', lineStart);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const match = line.match(MARKER_LINE);
  if (!match) return reject('malformed verdict marker');

  const json = match[1];
  if (/[<>]/.test(json)) return reject('raw < or > in verdict JSON');

  let verdict;
  try {
    verdict = JSON.parse(json);
  } catch {
    return reject('verdict JSON does not parse');
  }
  if (hasRepeatedKey(json)) return reject('repeated key in verdict JSON');

  const problem = verdictProblem(verdict);
  if (problem) return reject(problem);
  return { ok: true, verdict };
}

// verdict is parseVerdictMarker's result.verdict. The marker counts only when its
// word equals the record's current disposition. Without a marker nothing disagreed,
// so that case takes no action and carries no note. labels may be strings or gh's
// { name } objects. No caller yet: #4614's verdict handler is the consumer, acting
// only on 'proceed' and showing the note.
function verdictAgreement(input) {
  const { labels, verdict } = input || {};
  const word = verdict && verdict.verdict;
  if (!VERDICTS.has(word)) return { action: 'none' };
  const names = Array.isArray(labels) ? normalizeLabelNames(labels) : [];
  return dispositionState(names) === word ? { action: 'proceed' } : { action: 'none', note: DISAGREE_NOTE };
}

module.exports = { renderVerdictMarker, parseVerdictMarker, verdictAgreement };
