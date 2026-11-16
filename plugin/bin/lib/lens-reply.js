// bin/lib/lens-reply.js — parse one /review lens reviewer's final reply into
// findings (#5598). The reply answers the Output template in
// skills/review/step3-lens-dispatch.md: a `Severity | Path:Line | Finding |
// Evidence` table (or "No findings."), an optional "+N more" row, and a
// trailing `STATUS: {WORD}` line. BRIEF_HEADER and SEVERITIES below are that
// brief's code twin, pinned equal to the live fence by
// tests/bin-lib/lens-reply.test.js.
//
// The `Path:Line` cell is split only by coordination.js's parsePathLine — the
// one location parser; never add a second splitter here.
//
// Closed output shape, and the function never throws (a non-string is ''):
//   { parse: 'ok'|'unparseable', findings: [{ severity, path, line?, text,
//     evidence }], noFindings, overflow, skipped, status: 'ok'|'misplaced'|
//     'missing', statusWord: string|null }
// `parse: 'unparseable'` is its own signal: it never comes back as
// `findings: []` with `noFindings: true`. `skipped` counts every table row
// that is not a header, a separator, an overflow row or a finding — a
// severity row with an empty location cell, a location whose path is empty
// (`:12`) or holds a control or line-separator character (a stray \r would split a log line),
// or a row whose severity cell is outside the five-word scale (`Major`,
// `P1`) — so a dropped row is never silent.
//
// Linearity: each table row is cut into cells by one hand-written forward
// scan (splitRow) — no regex ever runs over a whole row. The regexes left run
// over one cell or one trimmed line, are anchored, and have no nested or
// adjacent overlapping quantifiers. Pinned by perf/lens-reply-linearity.test.js.
'use strict';

const { CANONICAL_RE, LENIENT_RE } = require('./status-line');
const { parsePathLine } = require('./coordination');

const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
const BRIEF_HEADER = Object.freeze(['Severity', 'Path:Line', 'Finding', 'Evidence']);

const HEADER_KEYS = BRIEF_HEADER.map((name) => name.toLowerCase());
const SEVERITY_COL = 0;
const LOCATION_COL = 1;
const FINDING_COL = 2;
const EVIDENCE_COL = 3;
// No header row: cells are taken in BRIEF_HEADER order.
const DEFAULT_COLUMNS = [SEVERITY_COL, LOCATION_COL, FINDING_COL, EVIDENCE_COL];

// C0 controls, DEL, and the line separators NEL, LS and PS. JS multiline `^`/`$` breaks only on \n, \r, LS and PS; NEL is covered because other readers (Java, Python `splitlines`) break on it.
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const SEPARATOR_CELL_RE = /^:?-+:?$/;
const OVERFLOW_RE = /^\+\s*(\d+)\s+more$/i;
const NO_FINDINGS = 'No findings.';
// One surrounding layer at most; `**` is tried before the single characters.
const NO_FINDINGS_WRAPPERS = ['**', '"', '`', '_'];

function stripMarks(cell) {
  return cell.replace(/\*\*|`/g, '').trim();
}

function unwrapOnce(line) {
  for (const w of NO_FINDINGS_WRAPPERS) {
    if (line.length >= 2 * w.length && line.startsWith(w) && line.endsWith(w)) {
      return line.slice(w.length, line.length - w.length);
    }
  }
  return line;
}

// `row` is a trimmed line starting with `|`. Drops that leading boundary and
// one unescaped trailing one, then cuts at every `|` that is neither escaped
// nor inside a backtick span. A span opens on a run of N backticks and closes
// on the next run of exactly N; an unclosed span runs to the end of the row.
// `\|` becomes `|` in the cell text. Cells are trimmed.
function splitRow(row) {
  let end = row.length;
  if (end > 1 && row[end - 1] === '|' && row[end - 2] !== '\\') end -= 1;
  const cells = [];
  let parts = [];
  let segStart = 1;
  let openRun = 0; // backtick run length that opened the current span; 0 = outside
  let i = 1;
  while (i < end) {
    const ch = row[i];
    if (ch === '`') {
      let j = i + 1;
      while (j < end && row[j] === '`') j += 1;
      if (openRun === 0) openRun = j - i;
      else if (openRun === j - i) openRun = 0;
      i = j;
    } else if (ch === '\\' && i + 1 < end && row[i + 1] === '|') {
      parts.push(row.slice(segStart, i), '|');
      i += 2;
      segStart = i;
    } else if (ch === '|' && openRun === 0) {
      parts.push(row.slice(segStart, i));
      cells.push(parts.join('').trim());
      parts = [];
      i += 1;
      segStart = i;
    } else {
      i += 1;
    }
  }
  parts.push(row.slice(segStart, end));
  cells.push(parts.join('').trim());
  return cells;
}

// Header cell index → BRIEF_HEADER index, or -1 for a column the brief does
// not name (dropped, never folded into Evidence). A repeated name keeps its
// first column.
function mapHeader(cells) {
  const used = new Set();
  return cells.map((cell) => {
    const idx = HEADER_KEYS.indexOf(stripMarks(cell).toLowerCase());
    if (idx === -1 || used.has(idx)) return -1;
    used.add(idx);
    return idx;
  });
}

// Cells → the four brief fields; missing cells are ''. Cells past the
// header's width are joined onto Evidence with ' | '.
function mapRow(cells, columns) {
  const out = ['', '', '', ''];
  const width = Math.min(cells.length, columns.length);
  for (let i = 0; i < width; i += 1) {
    if (columns[i] !== -1) out[columns[i]] = cells[i];
  }
  if (cells.length > columns.length) {
    out[EVIDENCE_COL] = [out[EVIDENCE_COL], ...cells.slice(columns.length)].filter((c) => c !== '').join(' | ');
  }
  return out;
}

// The window is the first three and last three of ALL non-empty lines: the same
// size as the SubagentStop hook's detectStatus window, but without its table-row
// filter. `ok` when the last non-empty line is canonical; else `misplaced` when
// that window holds a canonical or lenient status line (the latest such line
// supplies the word); else `missing`.
function readStatus(nonEmpty) {
  if (nonEmpty.length > 0) {
    const last = CANONICAL_RE.exec(nonEmpty[nonEmpty.length - 1]);
    if (last) return { status: 'ok', statusWord: last[1] };
  }
  const window = nonEmpty.slice(0, 3).concat(nonEmpty.slice(-3));
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const m = CANONICAL_RE.exec(window[i]) || LENIENT_RE.exec(window[i]);
    if (m) return { status: 'misplaced', statusWord: m[1] };
  }
  return { status: 'missing', statusWord: null };
}

function parseLensReply(text) {
  const input = typeof text === 'string' ? text : '';
  const findings = [];
  const nonEmpty = [];
  let overflow = 0;
  let skipped = 0;
  let sawNoFindings = false;
  let columns = null;

  for (const raw of input.split('\n')) {
    const trimmed = (raw.endsWith('\r') ? raw.slice(0, -1) : raw).trim();
    if (trimmed === '') continue;
    nonEmpty.push(trimmed);

    if (trimmed[0] !== '|') {
      const over = OVERFLOW_RE.exec(trimmed);
      if (over) overflow = Number(over[1]);
      else if (unwrapOnce(trimmed) === NO_FINDINGS) sawNoFindings = true;
      continue;
    }

    const cells = splitRow(trimmed);
    // Every header row is skipped uncounted; only the first maps the columns.
    if (stripMarks(cells[0]).toLowerCase() === 'severity') {
      if (columns === null) columns = mapHeader(cells);
      continue;
    }
    if (cells.every((cell) => SEPARATOR_CELL_RE.test(cell))) continue;
    const firstFilled = cells.find((cell) => cell !== '');
    const over = firstFilled === undefined ? null : OVERFLOW_RE.exec(firstFilled);
    if (over) {
      overflow = Number(over[1]);
      continue;
    }

    const row = mapRow(cells, columns || DEFAULT_COLUMNS);
    const severity = stripMarks(row[SEVERITY_COL]).toLowerCase();
    const location = stripMarks(row[LOCATION_COL]);
    if (!SEVERITIES.includes(severity) || location === '') {
      skipped += 1;
      continue;
    }
    const loc = parsePathLine(location);
    if (loc.path.trim() === '' || CONTROL_CHAR_RE.test(loc.path)) {
      skipped += 1;
      continue;
    }
    const finding = { severity, path: loc.path };
    if (loc.line !== undefined) finding.line = loc.line;
    finding.text = row[FINDING_COL];
    finding.evidence = row[EVIDENCE_COL];
    findings.push(finding);
  }

  return {
    parse: findings.length > 0 || sawNoFindings ? 'ok' : 'unparseable',
    findings,
    noFindings: sawNoFindings && findings.length === 0,
    overflow,
    skipped,
    ...readStatus(nonEmpty),
  };
}

module.exports = { parseLensReply, SEVERITIES, BRIEF_HEADER };
