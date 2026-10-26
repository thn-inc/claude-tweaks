// tests/skill-graph-table-structure.test.js
//
// Conformance lint for docs/skill-graph.md's (and docs/plugin-structure.md's) table
// structure (#1432). #1274's build shipped an unescaped `|` inside a code span in a
// two-column row (`^CEREMONY: (fast-lane|standard)$`) — GFM splits table cells on every
// raw `|` in the source line WITHOUT regard to backtick code spans, so that single
// unescaped pipe was parsed as a phantom third cell, silently truncating the row's
// load-bearing clause from the rendered table (finding Important 1, fixed in `4a80c44f`).
// Nothing mechanically checked this before now — tests/skill-catalog-completeness.test.js
// and tests/skill-conventions.test.js check section presence only, never cell counts.
//
// This suite counts unescaped pipes per data row (a pipe not preceded by `\`) and asserts
// each row's resulting cell count equals its table's header cell count, naming file:line
// for every offender. docs/skill-graph.md is CLAUDE.md's single source of truth for every
// skill relationship (~400 rows across 33 two-column tables); docs/plugin-structure.md's
// Skill/Sub-files/Purpose table (a 3-column table, ~30 rows) is the other load-bearing
// table this repo relies on humans and agents reading correctly — both are swept by the
// same general (not skill-graph-specific) helper below, so no separate scope-narrowing
// rationale is needed.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

const TARGET_FILES = ['docs/skill-graph.md', 'docs/plugin-structure.md'];

/**
 * Counts unescaped pipe characters in one line — a `|` not immediately preceded by `\`.
 * This mirrors GFM's actual table-cell split (raw pipes, backtick-blind) rather than a
 * backtick-aware split, since a backtick-aware split would under-count exactly the defect
 * class #1274 shipped: an unescaped `|` sitting inside a code span still splits the cell.
 */
function countUnescapedPipes(line) {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '|' && line[i - 1] !== '\\') count++;
  }
  return count;
}

/**
 * A well-formed `| a | b | c |` row's leading and trailing `|` are delimiters, not content
 * separators, so an N-pipe row that starts and ends with `|` yields N-1 cells.
 */
function cellCountFromPipes(unescapedPipeCount) {
  return Math.max(unescapedPipeCount - 1, 0);
}

function isTableRow(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

// A GFM header-separator row: pipe-delimited cells of only `-`/`:` (at least one `-`).
function isSeparatorRow(line) {
  return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

/**
 * Finds every markdown table in `text` — a row immediately followed by a GFM separator
 * row, then zero or more subsequent table-shaped rows as data. Returns one entry per
 * table: `{ headerLineNumber, headerCellCount, dataRows: [{ line, lineNumber }] }`.
 */
function findTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let i = 0;
  while (i < lines.length - 1) {
    if (isTableRow(lines[i]) && isSeparatorRow(lines[i + 1])) {
      const headerCellCount = cellCountFromPipes(countUnescapedPipes(lines[i]));
      const headerLineNumber = i + 1;
      const dataRows = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        dataRows.push({ line: lines[j], lineNumber: j + 1 });
        j++;
      }
      tables.push({ headerLineNumber, headerCellCount, dataRows });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

/**
 * Returns one offender entry per data row whose unescaped-pipe cell count does not match
 * its own table's header cell count.
 */
function findOffenders(filePath, text) {
  const offenders = [];
  for (const table of findTables(text)) {
    for (const row of table.dataRows) {
      const rowCellCount = cellCountFromPipes(countUnescapedPipes(row.line));
      if (rowCellCount !== table.headerCellCount) {
        offenders.push({
          file: filePath,
          line: row.lineNumber,
          headerLine: table.headerLineNumber,
          expectedCells: table.headerCellCount,
          actualCells: rowCellCount,
        });
      }
    }
  }
  return offenders;
}

function formatOffenders(offenders) {
  return offenders
    .map(
      (o) =>
        `${o.file}:${o.line} — expected ${o.expectedCells} cells (per header at line ` +
        `${o.headerLine}), got ${o.actualCells} (an unescaped \`|\` inside the row, likely ` +
        'inside a code span, is being parsed as a phantom cell boundary)'
    )
    .join('\n');
}

for (const relPath of TARGET_FILES) {
  test(`${relPath}: every table row has an unescaped-pipe cell count matching its header`, () => {
    const text = readText(path.join(ROOT, relPath));
    const tables = findTables(text);
    assert.ok(tables.length > 0, `${relPath}: table finder found zero tables — extraction is broken, not the file`);
    const offenders = findOffenders(relPath, text);
    assert.deepStrictEqual(offenders, [], `Unescaped-pipe cell-count mismatch:\n${formatOffenders(offenders)}`);
  });
}

// Go-red proof: the counting helper must actually discriminate a planted defect, not just
// pass vacuously on live prose that happens to already be clean. Synthetic minimal pair —
// a valid two-column row (pipe correctly escaped inside the code span) vs. the same row
// with that pipe left unescaped — run through the same findTables/findOffenders pipeline
// the live-file assertions above use.
const VALID_TABLE = [
  '| Target | Relationship |',
  '|---|---|',
  '| `/backlog` | matches `^CEREMONY: (fast-lane\\|standard)$` — escaped pipe, one cell |',
].join('\n');

const BROKEN_TABLE = [
  '| Target | Relationship |',
  '|---|---|',
  '| `/backlog` | matches `^CEREMONY: (fast-lane|standard)$` — unescaped pipe, phantom cell |',
].join('\n');

test('go-red proof: findOffenders is clean on an escaped-pipe row', () => {
  const offenders = findOffenders('synthetic.md', VALID_TABLE);
  assert.deepStrictEqual(offenders, [], 'a correctly escaped-pipe row must not be reported as an offender');
});

test('go-red proof: findOffenders catches an unescaped pipe inside a code span', () => {
  const offenders = findOffenders('synthetic.md', BROKEN_TABLE);
  assert.strictEqual(offenders.length, 1, 'the row with an unescaped pipe inside a code span must be reported exactly once');
  assert.strictEqual(offenders[0].line, 3);
  assert.strictEqual(offenders[0].expectedCells, 2);
  assert.strictEqual(offenders[0].actualCells, 3);
});

test('go-red proof: countUnescapedPipes distinguishes escaped from unescaped pipes', () => {
  assert.strictEqual(countUnescapedPipes('a\\|b'), 0, 'a backslash-escaped pipe must not count as unescaped');
  assert.strictEqual(countUnescapedPipes('a|b'), 1, 'a bare pipe must count as unescaped');
  assert.strictEqual(countUnescapedPipes('a\\|b|c'), 1, 'one escaped pipe and one unescaped pipe on the same line must count only the unescaped one');
});
