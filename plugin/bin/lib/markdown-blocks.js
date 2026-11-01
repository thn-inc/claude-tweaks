// bin/lib/markdown-blocks.js
// Pure: the one CommonMark fence rule (scanFences, behind fencedLineRanges,
// fencedLineMask and unfencedText), the backtick-fence writers that match it
// (fenceFor, fencedBlock), and the heading-section finder (findSection,
// extractSection) — shared across issues/, preflight-records/, and (through
// record.js's re-exports of fenceFor/fencedBlock/extractSection) console/,
// compose-subject.js and the health-sweep issue-payload.js builders. Moved out
// of issues/record-payload.js (#4645) so a consumer that needs only the fence
// rule no longer reaches through the record-payload builder. It requires no
// module, so any lib module can import it without a cycle. No I/O.
'use strict';

// Returns a backtick fence at least one character longer than the longest run
// of backticks found inside `text`, so a fenced code block wrapping arbitrary
// finding content (a docs/skill/rule/CLAUDE.md excerpt) can never be closed
// early by a ``` sequence already present in that content — GitHub's
// fence-matching rule only treats a run of >= the opening fence's length as
// a closer.
function fenceFor(text) {
  const runs = String(text).match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fencedBlock(text) {
  const fence = fenceFor(text);
  return `${fence}\n${text}\n${fence}`;
}

// lines -> { ranges, unclosed }. `ranges` holds one [start, end] inclusive
// line-index pair per fenced block, from the opening fence line through its
// closing fence line, or to lines.length - 1 when the block is unclosed (a
// truncated fence is quoted content, the safer direction). `unclosed` is true
// when the last block found has no closer and so runs to the end of the input;
// only the last block can be unclosed, since an unclosed block consumes every
// line after it. fencedLineRanges returns `ranges` alone; fencedLineMask reads
// `unclosed` for its `unclosedAsText` option.
// The one fence rule shared by stripCodeSpans (materialize-format.js), sectionText
// and extractSection (#4169), mergeStateDemands (merge-gate.js) and
// extractCurrentStateAnchors (near-duplicate.js) (#4369), and the three
// body-metadata extractors extractVerifiedAsOf / extractPremiseCheck /
// extractTemplateStamp (#4368): an opener is an optional U+FEFF byte-order mark,
// 0-3 leading spaces (CommonMark), then a run of 3+ backticks or tildes — a
// backtick run only when no backtick follows it on the line, since CommonMark
// reads "```a`b" as an inline code span, not a fence; the closer is 0-3 leading
// spaces, then the same character, at least the opener's length, and nothing
// else on its line but trailing spaces/tabs (plus the CR a LF-only split leaves
// on a CRLF body). Four or more leading spaces is an indented code block, not a
// fence. Matches what fenceFor and fencedBlock write (column-0 fences).
function scanFences(lines) {
  const ranges = [];
  let unclosed = false;
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^\uFEFF? {0,3}(`{3,}(?=[^`]*$)|~{3,})/);
    if (!fenceMatch) {
      i++;
      continue;
    }
    const fenceChar = fenceMatch[1][0];
    const fenceLen = fenceMatch[1].length;
    const closeRe = new RegExp(`^ {0,3}${fenceChar}{${fenceLen},}[ \\t\\r]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j++;
    unclosed = j >= lines.length;
    const end = unclosed ? lines.length - 1 : j;
    ranges.push([i, end]);
    i = end + 1;
  }
  return { ranges, unclosed };
}

function fencedLineRanges(lines) {
  return scanFences(lines).ranges;
}

// lines -> boolean[] parallel to lines: true for every line inside a fenced
// block, per fencedLineRanges (#4369). `{ unclosedAsText: true }` leaves a
// trailing unclosed fence out of the mask, for a caller that gates on a heading
// and must not lose it to a stray unclosed fence — an unclosed fence is read as
// the prose it likely is rather than as a block swallowing the rest of the body.
function fencedLineMask(lines, { unclosedAsText = false } = {}) {
  const mask = new Array(lines.length).fill(false);
  const { ranges, unclosed } = scanFences(lines);
  const kept = unclosedAsText && unclosed ? ranges.slice(0, -1) : ranges;
  for (const [s, e] of kept) {
    for (let k = s; k <= e; k += 1) mask[k] = true;
  }
  return mask;
}

// body -> body with every line inside a fenced block (per fencedLineRanges)
// blanked to ''. Splits on every CommonMark line ending (CRLF, lone CR, LF)
// keeping the separators, so every unfenced line and every separator stays
// byte-identical and a metadata regex reads unfenced text exactly as it did
// on the raw body (#4368).
function unfencedText(body) {
  const parts = body.split(/(\r\n|\r|\n)/);
  const lines = [];
  for (let i = 0; i < parts.length; i += 2) lines.push(parts[i]);
  for (const [s, e] of fencedLineRanges(lines)) {
    for (let k = s; k <= e; k++) parts[k * 2] = '';
  }
  return parts.join('');
}

// body, heading text, options -> the section text under that heading, or null
// when absent. Shared line-boundary finder behind compose-subject.js's
// Breaking Change/Release Note/Overview extraction, decomposition-crossref.js's
// Gotchas/Prerequisites extraction, and grouping.js's Key Files extraction —
// three independent re-implementations of the same "find a heading, walk
// lines until the next one" loop (#2251 review row 18) — and, called directly
// for its null-on-absent result, materialize-format.js's sectionText (#4367).
//   levelPattern: the `{...}` regex-quantifier body for this heading's own
//     level (default '2,4' — h2 through h4, decomposition-crossref.js's and
//     grouping.js's shared original range).
//   stopPattern: the level-class that terminates the section (default
//     '1,6' — any heading; compose-subject.js overrides to '2' since its own
//     sections may carry nested subsections that must stay inside them).
//   trim: trim the joined result (default false, decomposition-crossref.js's
//     and grouping.js's original behavior; compose-subject.js overrides true).
// CRLF-normalized before matching — none of the three original
// implementations did this, so a CRLF file (this repo has at least one,
// `[IL-160]`) could silently fail every heading match; this fixes that as a
// side effect rather than as its own goal. Headings inside fenced blocks are
// quoted content and never match (#4169); a fenced line never stops the section.
function findSection(body, heading, { levelPattern = '2,4', stopPattern = '1,6', trim = false } = {}) {
  if (typeof body !== 'string') return null;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingRe = new RegExp(`^#{${levelPattern}}[ \\t]+${escaped}[ \\t]*$`);
  const stopRe = new RegExp(`^#{${stopPattern}}[ \\t]`);
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const fenced = fencedLineMask(lines);
  const start = lines.findIndex((line, idx) => !fenced[idx] && headingRe.test(line));
  if (start === -1) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!fenced[i] && stopRe.test(lines[i])) break;
    out.push(lines[i]);
  }
  const joined = out.join('\n');
  return trim ? joined.trim() : joined;
}

// findSection's text, or '' when the heading is absent. A caller that must tell absent
// from empty (sectionText, #4367) calls findSection directly.
function extractSection(body, heading, options) {
  return findSection(body, heading, options) ?? '';
}

module.exports = {
  fenceFor, fencedBlock, fencedLineRanges, fencedLineMask, unfencedText, findSection, extractSection,
};
