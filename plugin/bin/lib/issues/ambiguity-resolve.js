// bin/lib/issues/ambiguity-resolve.js — pure record-body transform for resolving
// one staged red-team finding (#2699). No network I/O — the CLI wrapper
// (bin/resolve-ambiguity.js) and its caller own fetching/writing the body via
// `gh`/MCP; this module only knows how to edit a body string in memory.
'use strict';

const {
  shapeGate, stripCodeSpans, ORIGINAL_REQUEST_RE,
} = require('./materialize-format');

// The opening of a red-team marker (specify/red-team.md's write-back). Same
// pattern the spec-shaped gate uses (materialize-format.js's
// PLACEHOLDER_PATTERNS), so an unterminated `<!-- ambiguity:` still counts.
const AMBIGUITY_OPEN_RE = /<!--\s*ambiguity:/g;

// spec-template.md's `## Open Questions (optional)` heading, at levels 2-4, in
// any case, with or without a trailing qualifier. Matching loosely fails
// closed: a surviving variant heading keeps `ready` off rather than letting it
// back on.
const OPEN_QUESTIONS_HEADING_RE = /^(#{2,4})[ \t]+open questions\b.*$/im;

// The authored part of a body — everything before `## Original request`, with
// fenced blocks and inline code spans stripped — exactly the text
// materialize-format.js's shapeGate tests for placeholders. A marker quoted
// in a code span or inherited in the original request is not an open one.
function authoredText(body) {
  const at = body.search(ORIGINAL_REQUEST_RE);
  return stripCodeSpans(at === -1 ? body : body.slice(0, at));
}

function countAmbiguityMarkers(body) {
  if (typeof body !== 'string') return 0;
  const matches = authoredText(body).match(AMBIGUITY_OPEN_RE);
  return matches ? matches.length : 0;
}

function hasOpenQuestionsSection(body) {
  if (typeof body !== 'string') return false;
  return OPEN_QUESTIONS_HEADING_RE.test(authoredText(body));
}

// `ready` is restorable when the body passes the spec-shaped gate `ready`
// itself asserts (_shared/work-record.md, implemented by shapeGate: required
// sections present and no TBD/TODO/ambiguity placeholder) and no Open
// Questions section survives (spec-template.md: resolve every row, then
// delete the section).
function readyRestorable(body) {
  if (typeof body !== 'string') return false;
  return shapeGate(body).ok && !hasOpenQuestionsSection(body);
}

// Deletes an Open Questions section whose table has no data rows left (only
// the header and separator rows, plus blank lines) — spec-template.md's "When
// all rows are resolved, delete the section". A section with any other
// content is left alone.
function dropEmptyOpenQuestions(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => OPEN_QUESTIONS_HEADING_RE.test(l.replace(/\r$/, '')));
  if (start === -1) return { body, removed: false };
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const m = lines[end].match(/^(#+)[ \t]/);
    if (m && m[1].length <= level) break;
    end++;
  }
  const content = lines.slice(start + 1, end).map((l) => l.trim()).filter((l) => l !== '');
  const tableRows = content.filter((l) => l.startsWith('|'));
  const separator = (l) => /^\|[\s:|-]+\|$/.test(l);
  const dataRows = tableRows.filter((l, i) => i > 0 && !separator(l));
  if (content.length !== tableRows.length || dataRows.length > 0) return { body, removed: false };
  let from = start;
  while (from > 0 && lines[from - 1].trim() === '') from--;
  return { body: [...lines.slice(0, from), ...lines.slice(end)].join('\n'), removed: true };
}

// Replaces the single verbatim occurrence of `markerText` — the full
// `<!-- ambiguity: ... -->` comment, or a whole `## Open Questions` table row
// — with `resolutionText`, then drops the Open Questions section if that left
// it with no rows. Throws (err.code NOT_FOUND or AMBIGUOUS) unless the text
// occurs exactly once: a near-miss or a repeated string must stop, never
// edit the wrong place or silently leave the marker in.
function resolveAmbiguityMarker(body, markerText, resolutionText) {
  if (typeof body !== 'string') {
    throw new Error('resolveAmbiguityMarker: body must be a string');
  }
  if (typeof markerText !== 'string' || markerText === '') {
    throw new Error('resolveAmbiguityMarker: markerText must be a non-empty string');
  }
  if (typeof resolutionText !== 'string') {
    throw new Error('resolveAmbiguityMarker: resolutionText must be a string');
  }
  const idx = body.indexOf(markerText);
  if (idx === -1) {
    const err = new Error(`resolveAmbiguityMarker: markerText not found verbatim in body: ${JSON.stringify(markerText)}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (body.indexOf(markerText, idx + 1) !== -1) {
    const err = new Error(`resolveAmbiguityMarker: markerText occurs more than once in body — pass the full marker comment or row: ${JSON.stringify(markerText)}`);
    err.code = 'AMBIGUOUS';
    throw err;
  }
  let end = idx + markerText.length;
  // An empty resolution for text that fills its whole line (an Open Questions
  // row) deletes the line, newline included, so the table stays contiguous.
  const wholeLine = (idx === 0 || body[idx - 1] === '\n') && /^\r?\n/.test(body.slice(end));
  if (resolutionText === '' && wholeLine) end += body[end] === '\r' ? 2 : 1;
  const replaced = body.slice(0, idx) + resolutionText + body.slice(end);
  const { body: newBody, removed } = dropEmptyOpenQuestions(replaced);
  return {
    body: newBody,
    markersRemaining: countAmbiguityMarkers(newBody),
    openQuestionsRemaining: hasOpenQuestionsSection(newBody),
    openQuestionsRemoved: removed,
    readyRestorable: readyRestorable(newBody),
  };
}

module.exports = {
  countAmbiguityMarkers,
  hasOpenQuestionsSection,
  readyRestorable,
  resolveAmbiguityMarker,
};
