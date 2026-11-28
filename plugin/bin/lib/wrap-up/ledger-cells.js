// bin/lib/wrap-up/ledger-cells.js — the cell codec for the pipeline ledger's
// 5-column markdown table (_shared/ledger-format.md's Format section). A `|`
// inside a cell is written as `\|` so it cannot split the row; readers split
// on the unescaped `|` only, then unescape each cell. Used by ./ledger-write.js
// when it flips a row, and by any reader that needs the cell text back.
'use strict';

// Splits on a `|` not preceded by a backslash.
const UNESCAPED_PIPE = /(?<!\\)\|/;

function escapeLedgerCell(text) {
  return String(text).replace(/\|/g, '\\|');
}

function unescapeLedgerCell(text) {
  return String(text).replace(/\\\|/g, '|');
}

// A raw line break would split the row across lines: every whitespace run that holds a `\n` becomes one
// space, and the result is trimmed. Byte-identical to `text.replace(/\s*\r?\n\s*/g, ' ').trim()`, which
// is quadratic on a long run of spaces (`a`, 40k spaces, `b`: over a second) — the run is trimmed in code
// instead (.claude/skills/regex-scan-linearity). Pinned against that regex in
// tests/bin-lib/wrap-up/ledger-cells.test.js and against the clock in perf/ledger-row-linearity.test.js.
function collapseLineBreaks(text) {
  const parts = [];
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') parts.push(trimmed);
  }
  return parts.join(' ');
}

// Raw, untrimmed, still-escaped cells with the same slot semantics as
// `row.split('|')`: slot 0 is the text before the leading `|`, the last slot
// the text after the trailing `|`. A well-formed row has 7 slots.
function splitLedgerRow(row) {
  return row.split(UNESCAPED_PIPE);
}

// The five logical cells of a well-formed row — `#`, Phase, Item, Status,
// Resolution — each trimmed and unescaped.
function ledgerRowCells(row) {
  return splitLedgerRow(row).slice(1, -1).map((cell) => unescapeLedgerCell(cell.trim()));
}

module.exports = { escapeLedgerCell, unescapeLedgerCell, collapseLineBreaks, splitLedgerRow, ledgerRowCells };
