'use strict';

// Pure: the machine-readable verdict comment, a cross-repository contract with
// Dispatch, which writes this exact format. One HTML comment, alone on its line
// and starting at column 0:
//
//   <!-- accept-verdict: {"v":1,"verdict":"changes-requested","choice":"fix-forward","note":"text"} -->
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

const VERDICTS = new Set(['approved', 'changes-requested']);
const CHOICES = new Set(['fix-forward', 'revert-now']);
const FIELDS = new Set(['v', 'verdict', 'choice', 'note']);
const NOTE_LIMIT = 2000;
const DISAGREE_NOTE = 'verdict label and comment disagree';

// Each holds a backslash followed by u003c/u003e, which JSON.parse decodes.
const ESCAPED_LT = '\\u003c';
const ESCAPED_GT = '\\u003e';

// Every spelling a reader might take for a block, so a near-miss counts toward the
// duplicate and code-region checks and then fails MARKER_LINE, instead of being ignored.
const OPENER = /<!--\s*accept-verdict/gi;
// Column 0 and alone on the line, which also rules out a blockquote, a list item and
// a fence nested in either: constructs the line-based mask below does not model.
// Applied to one line without the m flag, so U+2028 is not taken for a line start;
// it is not a Markdown line ending.
const MARKER_LINE = /^<!-- accept-verdict: ([^\n]*) -->[ \t]*$/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const INDENTED = /^(?: {4}| {0,3}\t)/;

function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

function maskFencesAndIndents(text) {
  let fence = null;
  return text.split('\n').map((line) => {
    if (fence) {
      const close = line.match(FENCE_CLOSE);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return blank(line);
    }
    const open = line.match(FENCE_OPEN);
    // A backtick fence's info string cannot hold a backtick; that line is inline code.
    if (open && !(open[1][0] === '`' && line.slice(open[0].length).includes('`'))) {
      fence = open[1];
      return blank(line);
    }
    return INDENTED.test(line) ? blank(line) : line;
  }).join('\n');
}

// A span runs between two backtick runs of equal length, across lines if it must.
// Markdown would end a span at a blank line; ignoring that can only over-mask, and an
// over-masked block is rejected rather than trusted.
function maskInlineSpans(text) {
  const runs = [...text.matchAll(/`+/g)];
  let out = '';
  let cursor = 0;
  let i = 0;
  while (i < runs.length) {
    const start = runs[i];
    let j = i + 1;
    while (j < runs.length && runs[j][0].length !== start[0].length) j += 1;
    if (j === runs.length) {
      i += 1;
      continue;
    }
    const end = runs[j].index + runs[j][0].length;
    out += text.slice(cursor, start.index) + blank(text.slice(start.index, end));
    cursor = end;
    i = j + 1;
  }
  return out + text.slice(cursor);
}

// Same length as the input with code regions blanked, so the opener counts compare.
function maskCode(text) {
  return maskInlineSpans(maskFencesAndIndents(text));
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

  // Before masking: a CRLF line would otherwise fail the fence-closer match, which
  // would leave the fence open past its end.
  const text = body.replace(/\r\n?/g, '\n');
  const openers = [...text.matchAll(OPENER)];
  if (openers.length === 0) return reject('no verdict marker');

  const masked = maskCode(text);
  if ([...masked.matchAll(OPENER)].length !== openers.length) return reject('verdict marker inside a code region');
  if (openers.length > 1) return reject('more than one verdict marker');

  const lineStart = text.lastIndexOf('\n', openers[0].index) + 1;
  const before = masked.slice(0, lineStart);
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return reject('verdict marker inside another HTML comment');

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
// word equals the record's current disposition; anything else takes no action.
function verdictAgreement(input) {
  const { labels, verdict } = input || {};
  const word = verdict && verdict.verdict;
  if (VERDICTS.has(word) && dispositionState(labels) === word) return { action: 'proceed' };
  return { action: 'none', note: DISAGREE_NOTE };
}

module.exports = { renderVerdictMarker, parseVerdictMarker, verdictAgreement };
